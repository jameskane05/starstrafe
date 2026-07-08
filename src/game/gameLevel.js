/**
 * gameLevel.js - LEVEL LOADING AND SCENE OBJECT RESOLUTION
 * =============================================================================
 *
 * ROLE: Preloads level content for play (solo or multiplayer). Resolves which
 * scene objects to load from sceneData.js for PLAYING state and delegates
 * loading to SceneManager. Extracts spawn points and bounds from level meshes.
 *
 * KEY RESPONSIBILITIES:
 * - preloadLevel(game): get scene objects for PLAYING, load via SceneManager
 * - getLevelOcclusion(game): resolve level occlusion / level data object for rendering
 * - Export getSceneObjectsForState, getSceneObject, LEVEL_OBJECT_IDS (re-exports from sceneData)
 * - Used by gameInit, gameSolo, gameMultiplayer for level setup
 *
 * RELATED: sceneData.js, SceneManager.js, GameManager.js, gameData.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { GAME_STATES } from "../data/gameData.js";
import {
  getSceneObjectsForState,
  getSceneObject,
  LEVEL_OBJECT_IDS,
} from "../data/sceneData.js";
import NetworkManager from "../network/NetworkManager.js";
import MenuManager from "../ui/MenuManager.js";
import { bindCharonReactorCoreFromLevelData } from "./charonReactorCore.js";
import {
  cacheCharonEscapeRoomAabb,
  stopCharonEscapeSequenceForLevelChange,
} from "./charonEscapeSequence.js";
import { stopSaturnaliaCollapseForLevelChange } from "./saturnaliaCollapseSequence.js";
import { setupLevelBarriers, clearLevelBarriers } from "./levelBarriers.js";
import { stopEarthBossFightForLevelChange } from "./earthBossFight.js";
import { stopEarthEscapeSequenceForLevelChange } from "./earthEscapeSequence.js";
import { readAuthoredEnemyMarkerScale } from "../entities/Enemy.js";
import { finalizeEnemySpawnScales } from "./gameEnemies.js";

function readLevelTriggerVolumes(game, levelData) {
  if (levelData && game.sceneManager?.extractLevelTriggerVolumes) {
    const live = game.sceneManager.extractLevelTriggerVolumes(levelData);
    if (live.length > 0) return live;
  }
  return levelData?.userData?.levelTriggerVolumes ?? [];
}

function readWeaponPickupPoints(game, levelData) {
  const cached = levelData?.userData?.extractedSpawnPoints?.weaponPickups;
  if (cached?.length) {
    return cached.map((entry) => ({
      type: entry.type,
      position: entry.position.clone(),
    }));
  }
  if (levelData && game.sceneManager?.extractWeaponPickupPoints) {
    const live = game.sceneManager.extractWeaponPickupPoints(levelData);
    if (live.length > 0) {
      return live.map((entry) => ({
        type: entry.type,
        position: entry.position.clone(),
      }));
    }
  }
  return [];
}

function getLevelOcclusion(game) {
  const level = game.gameManager.getState().currentLevel;
  const levelDataId = level ? `${level}LevelData` : null;
  return (
    (levelDataId && game.sceneManager.getObject(levelDataId)) ||
    game.sceneManager.getObject("levelOcclusion") ||
    game.sceneManager.getObject("newworldLevelData") ||
    game.sceneManager.getObject("newworldOcclusion")
  );
}

export async function preloadLevel(game) {
  if (game.levelLoadPromise) {
    return game.levelLoadPromise;
  }

  console.log("[Game] Preloading level...");
  game.isLoadingLevel = true;

  const tracker = game.levelLoadingTracker || null;
  if (tracker && tracker.getTaskCount() === 0) {
    tracker.reset();
  }

  game.levelLoadPromise = (async () => {
    try {
      const state = game.gameManager.getState();
      const objectsToLoad = getSceneObjectsForState({
        ...state,
        currentState: GAME_STATES.PLAYING,
      });

      const loads = [];
      for (const obj of objectsToLoad) {
        if (game.sceneManager.hasObject(obj.id)) continue;

        const taskId = `level_${obj.id}`;
        tracker?.registerTask(taskId);

        loads.push(
          game.sceneManager
            .loadObject(obj, (progress) =>
              tracker?.updateTask(taskId, progress),
            )
            .then((result) => {
              tracker?.completeTask(taskId);
              return result;
            })
            .catch((err) => {
              tracker?.completeTask(taskId);
              console.warn(`[Game] Failed to load ${obj.id}:`, err.message);
              throw err;
            }),
        );
      }

      await Promise.all(loads);
      console.log("[Game] Level preloaded successfully");
    } catch (err) {
      console.warn(
        "[Game] Level preload failed, falling back to newworld:",
        err?.message,
      );
      const current = game.gameManager.getState().currentLevel;
      if (current && current !== "newworld") {
        game.gameManager.setState({ currentLevel: "newworld" });
        if (game.isMultiplayer && NetworkManager.isHost()) {
          NetworkManager.setLevel("newworld");
        }
      }
    } finally {
      game.isLoadingLevel = false;
      game.levelLoadPromise = null;
    }
  })();

  return game.levelLoadPromise;
}

export async function loadLevelAndStart(game) {
  game.musicManager?.reshuffleAndPlay(2.0);
  game.gameManager.setState({
    currentState: GAME_STATES.PLAYING,
  });

  const objectsToLoad = getSceneObjectsForState(game.gameManager.getState());
  const toLoad = objectsToLoad.filter(
    (obj) => !game.sceneManager.hasObject(obj.id),
  );
  const n = toLoad.length;
  const progressByIndex = n ? new Array(n).fill(0) : [];
  const report = (index, p) => {
    progressByIndex[index] = Math.min(1, p);
    const total = progressByIndex.reduce((a, b) => a + b, 0);
    MenuManager.updateLoadingProgress(total / n);
  };

  const loads = toLoad.map((obj, i) =>
    game.sceneManager.loadObject(obj, (p) => report(i, p)),
  );
  if (loads.length > 0) {
    console.log("[Game] Loading level objects...");
    try {
      await Promise.all(loads);
      console.log("[Game] Level loaded successfully");
    } catch (err) {
      console.error("[Game] Level load failed:", err);
    }
  } else {
    MenuManager.updateLoadingProgress(1);
  }

  MenuManager.loadingComplete();
}

function parseEnemySpawnIsHeavy(name) {
  const n = (name || "").trim();
  // Blender often exports "Enemy.027-Heavy"; authors may also use "Enemy.027 - Heavy".
  return /(?:\s-\s*|-\s*)Heavy\s*$/i.test(n);
}

function parseEnemySpawnIsPortal(name) {
  return /^EnemyPortal(?:$|[.\s_-])/i.test((name || "").trim());
}

function saveLevelSpawnCache(
  game,
  level,
  enemyArr,
  playerArr,
  missileArr,
  goalArr = [],
  playerMarkerQuats = null,
  goalQuats = null,
  enemyHeavyFlags = null,
  boostArr = [],
  boostQuats = null,
  weaponPickupArr = [],
  enemyPortalFlags = null,
  enemyScaleArr = null,
) {
  if (
    enemyArr.length === 0 &&
    playerArr.length === 0 &&
    missileArr.length === 0 &&
    goalArr.length === 0 &&
    boostArr.length === 0
  ) {
    return;
  }
  const markerQuats =
    playerMarkerQuats && playerMarkerQuats.length === playerArr.length
      ? playerMarkerQuats
      : playerArr.map((_, i) => playerMarkerQuats?.[i] ?? null);
  const goalQuatList =
    goalQuats && goalQuats.length === goalArr.length
      ? goalQuats
      : goalArr.map((_, i) => goalQuats?.[i] ?? null);
  game._levelSpawnCache = {
    level,
    enemy: enemyArr.map((v) => v.clone()),
    player: playerArr.map((v) => v.clone()),
    missile: missileArr.map((v) => v.clone()),
    goals: goalArr.map((v) => v.clone()),
    goalQuats: goalQuatList.map((q) => (q ? q.clone() : null)),
    boosts: boostArr.map((v) => v.clone()),
    boostQuats: (boostQuats || boostArr.map(() => null)).map((q) =>
      q ? q.clone() : null,
    ),
    weaponPickups: weaponPickupArr.map((entry) => ({
      type: entry.type,
      position: entry.position.clone(),
    })),
    playerMarkerQuats: markerQuats.map((q) => (q ? q.clone() : null)),
    enemyHeavy:
      enemyHeavyFlags &&
      enemyHeavyFlags.length === enemyArr.length &&
      enemyArr.length > 0
        ? enemyHeavyFlags.slice()
        : null,
    enemyPortal:
      enemyPortalFlags &&
      enemyPortalFlags.length === enemyArr.length &&
      enemyArr.length > 0
        ? enemyPortalFlags.slice()
        : null,
    enemyScales:
      enemyScaleArr &&
      enemyScaleArr.length === enemyArr.length &&
      enemyArr.length > 0
        ? enemyScaleArr.slice()
        : null,
  };
}

function applyLevelBounds(game) {
  const levelMesh = getLevelOcclusion(game);
  if (levelMesh) {
    const box = new THREE.Box3().setFromObject(levelMesh);
    game._levelBounds = {
      center: box.getCenter(new THREE.Vector3()),
      size: box.getSize(new THREE.Vector3()),
    };
  }
}

function extractOrderedGoalsFromObject(root) {
  if (!root?.traverse) return [];
  const goalOrder = ["Goal", "Goal.001", "Goal.002"];
  const goalMap = new Map();
  root.updateMatrixWorld?.(true);
  root.traverse((child) => {
    const name = child?.name;
    if (!goalOrder.includes(name)) return;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    child.getWorldPosition(pos);
    child.getWorldQuaternion(quat);
    goalMap.set(name, {
      position: pos.clone(),
      quaternion: quat.clone(),
    });
  });
  return goalOrder
    .map((name) => goalMap.get(name))
    .filter(Boolean)
    .map((entry) => ({
      position: entry.position.clone(),
      quaternion: entry.quaternion.clone(),
    }));
}

export function extractSpawnPoints(game) {
  stopCharonEscapeSequenceForLevelChange(game);
  stopSaturnaliaCollapseForLevelChange(game);
  stopEarthBossFightForLevelChange(game);
  stopEarthEscapeSequenceForLevelChange(game);
  game.spawnPoints = [];
  game.enemySpawnHeavyFlags = [];
  game.enemySpawnPortalFlags = [];
  game.enemySpawnScales = [];
  game.enemySpawnShipScales = null;
  game._enemySpawnRandomFactors = null;
  game.playerSpawnPoints = [];
  game.playerSpawnMarkerQuaternions = [];
  game.missileSpawnPoints = [];
  game.trainingGoalPoints = [];
  game.trainingGoalQuaternions = [];
  game.levelBoostPoints = [];
  game.levelBoostQuaternions = [];
  game.weaponPickupPoints = [];
  game._levelTriggerVolumes = [];
  clearLevelBarriers(game);
  game.dynamicSceneElementManager?.setElements([]);

  const level = game.gameManager.getState().currentLevel;
  const levelDataId = level ? `${level}LevelData` : null;
  const levelData = levelDataId
    ? game.sceneManager.getObject(levelDataId)
    : null;

  if (game._levelSpawnCache && game._levelSpawnCache.level !== level) {
    game._levelSpawnCache = null;
  }

  if (levelData?.userData?.extractedSpawnPoints) {
    const {
      enemy,
      enemyScales,
      enemyIsHeavy,
      enemyIsPortal,
      player,
      playerMarkerQuaternions = [],
      missile,
      goals = [],
      goalQuaternions = [],
      boosts = [],
      boostQuaternions = [],
      weaponPickups = [],
    } = levelData.userData.extractedSpawnPoints;
    game.spawnPoints = enemy.map((v) => v.clone());
    game.enemySpawnHeavyFlags =
      enemyIsHeavy?.length === enemy.length
        ? enemyIsHeavy.slice()
        : enemy.map(() => false);
    game.enemySpawnPortalFlags =
      enemyIsPortal?.length === enemy.length
        ? enemyIsPortal.slice()
        : enemy.map(() => false);
    game.enemySpawnScales =
      enemyScales?.length === enemy.length
        ? enemyScales.slice()
        : enemy.map(() => 1);
    game.playerSpawnPoints = player.map((v) => v.clone());
    game.playerSpawnMarkerQuaternions = game.playerSpawnPoints.map((_, i) =>
      playerMarkerQuaternions[i]
        ? playerMarkerQuaternions[i].clone()
        : null,
    );
    game.missileSpawnPoints = missile.map((v) => v.clone());
    if (goals.length > 0) {
      game.trainingGoalPoints = goals.map((v) => v.clone());
      game.trainingGoalQuaternions = goals.map((_, i) =>
        goalQuaternions[i] ? goalQuaternions[i].clone() : null,
      );
    } else {
      const orderedGoals = extractOrderedGoalsFromObject(levelData);
      game.trainingGoalPoints = orderedGoals.map((e) => e.position.clone());
      game.trainingGoalQuaternions = orderedGoals.map((e) =>
        e.quaternion.clone(),
      );
    }
    game.levelBoostPoints = boosts.map((v) => v.clone());
    game.levelBoostQuaternions = game.levelBoostPoints.map((_, i) =>
      boostQuaternions[i] ? boostQuaternions[i].clone() : null,
    );
    game.weaponPickupPoints = readWeaponPickupPoints(game, levelData);
    saveLevelSpawnCache(
      game,
      level,
      game.spawnPoints,
      game.playerSpawnPoints,
      game.missileSpawnPoints,
      game.trainingGoalPoints,
      game.playerSpawnMarkerQuaternions,
      game.trainingGoalQuaternions,
      game.enemySpawnHeavyFlags,
      game.levelBoostPoints,
      game.levelBoostQuaternions,
      game.weaponPickupPoints,
      game.enemySpawnPortalFlags,
      game.enemySpawnScales,
    );
    game.dynamicSceneElementManager?.setElements(
      levelData.userData.dynamicSceneElements || [],
    );
    game._levelTriggerVolumes = readLevelTriggerVolumes(game, levelData);
    finalizeEnemySpawnScales(game);
    console.log(
      `[Game] Parsed ${levelDataId}: ${game.spawnPoints.length} enemies, ${game.playerSpawnPoints.length} player spawns, ${game.missileSpawnPoints.length} missile pickups, ${game.weaponPickupPoints.length} weapon pickups, ${game.trainingGoalPoints.length} goals, ${game.levelBoostPoints.length} boosts, ${game._levelTriggerVolumes.length} trigger volumes`,
    );
    applyLevelBounds(game);
    setupLevelBarriers(game, levelData);
    bindCharonReactorCoreFromLevelData(game);
    cacheCharonEscapeRoomAabb(game);
    return;
  }

  if (
    game._levelSpawnCache &&
    game._levelSpawnCache.level === level &&
    (game._levelSpawnCache.enemy.length > 0 ||
      game._levelSpawnCache.player.length > 0 ||
      game._levelSpawnCache.goals?.length > 0 ||
      game._levelSpawnCache.boosts?.length > 0)
  ) {
    const c = game._levelSpawnCache;
    game.spawnPoints = c.enemy.map((v) => v.clone());
    game.enemySpawnHeavyFlags =
      c.enemyHeavy?.length === c.enemy.length
        ? c.enemyHeavy.slice()
        : game.spawnPoints.map(() => false);
    game.enemySpawnPortalFlags =
      c.enemyPortal?.length === c.enemy.length
        ? c.enemyPortal.slice()
        : game.spawnPoints.map(() => false);
    game.enemySpawnScales =
      c.enemyScales?.length === c.enemy.length
        ? c.enemyScales.slice()
        : game.spawnPoints.map(() => 1);
    game.playerSpawnPoints = c.player.map((v) => v.clone());
    game.playerSpawnMarkerQuaternions = game.playerSpawnPoints.map((_, i) => {
      const q = c.playerMarkerQuats?.[i];
      return q ? q.clone() : null;
    });
    game.missileSpawnPoints = c.missile.map((v) => v.clone());
    game.trainingGoalPoints = (c.goals || []).map((v) => v.clone());
    const cachedGoalQuats = c.goalQuats || [];
    game.trainingGoalQuaternions = game.trainingGoalPoints.map((_, i) =>
      cachedGoalQuats[i] ? cachedGoalQuats[i].clone() : null,
    );
    game.levelBoostPoints = (c.boosts || []).map((v) => v.clone());
    const cachedBoostQuats = c.boostQuats || [];
    game.levelBoostQuaternions = game.levelBoostPoints.map((_, i) =>
      cachedBoostQuats[i] ? cachedBoostQuats[i].clone() : null,
    );
    game.weaponPickupPoints = (c.weaponPickups || []).map((entry) => ({
      type: entry.type,
      position: entry.position.clone(),
    }));
    console.log(
      `[Game] Restored ${level} spawns from cache (${game.spawnPoints.length} enemies, ${game.playerSpawnPoints.length} player spawns, ${game.missileSpawnPoints.length} missile pickups, ${game.trainingGoalPoints.length} goals, ${game.levelBoostPoints.length} boosts)`,
    );
    {
      const ld =
        levelDataId && game.sceneManager?.getObject
          ? game.sceneManager.getObject(levelDataId)
          : null;
      game._levelTriggerVolumes = readLevelTriggerVolumes(game, ld);
      game.weaponPickupPoints = readWeaponPickupPoints(game, ld);
      setupLevelBarriers(game, ld);
    }
    finalizeEnemySpawnScales(game);
    applyLevelBounds(game);
    bindCharonReactorCoreFromLevelData(game);
    cacheCharonEscapeRoomAabb(game);
    return;
  }

  const spawnId = game.sceneManager.hasObject("newworldSpawns")
    ? "newworldSpawns"
    : game.sceneManager.hasObject("levelSpawns")
      ? "levelSpawns"
      : null;
  const spawnModel = spawnId ? game.sceneManager.getObject(spawnId) : null;

  if (spawnModel) {
    spawnModel.updateMatrixWorld(true);
    const spawnEntries = [];
    const enemyEntries = [];
    spawnModel.traverse((child) => {
      const name = child.name || "";
      if (
        !name.startsWith("Enemy") &&
        !name.startsWith("Spawn") &&
        !name.startsWith("Missile") &&
        !name.startsWith("Charging") &&
        !name.startsWith("Gatling")
      ) {
        return;
      }
      const pos = new THREE.Vector3();
      child.getWorldPosition(pos);
      if (name.startsWith("Enemy")) {
        enemyEntries.push({
          name,
          position: pos.clone(),
          scale: readAuthoredEnemyMarkerScale(child, spawnModel),
        });
      } else if (name.startsWith("Spawn")) {
        const quat = new THREE.Quaternion();
        child.getWorldQuaternion(quat);
        spawnEntries.push({
          name,
          position: pos.clone(),
          quaternion: quat.clone(),
        });
      } else if (name.startsWith("Missile"))
        game.missileSpawnPoints.push(pos.clone());
      else if (name.startsWith("Charging") || name.startsWith("Gatling")) {
        game.weaponPickupPoints.push({
          type: name.startsWith("Charging") ? "charging_laser" : "gatling",
          position: pos.clone(),
        });
      }
    });
    enemyEntries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    for (const e of enemyEntries) {
      game.spawnPoints.push(e.position);
      game.enemySpawnHeavyFlags.push(parseEnemySpawnIsHeavy(e.name));
      game.enemySpawnPortalFlags.push(parseEnemySpawnIsPortal(e.name));
      game.enemySpawnScales.push(e.scale ?? 1);
    }
    spawnEntries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    for (const e of spawnEntries) {
      game.playerSpawnPoints.push(e.position);
      game.playerSpawnMarkerQuaternions.push(e.quaternion);
    }
    game.sceneManager.removeObject(spawnId);
    saveLevelSpawnCache(
      game,
      level,
      game.spawnPoints,
      game.playerSpawnPoints,
      game.missileSpawnPoints,
      game.trainingGoalPoints,
      game.playerSpawnMarkerQuaternions,
      game.trainingGoalQuaternions,
      game.enemySpawnHeavyFlags,
      game.levelBoostPoints,
      game.levelBoostQuaternions,
      game.weaponPickupPoints,
      game.enemySpawnPortalFlags,
      game.enemySpawnScales,
    );
    console.log(
      `[Game] Parsed ${spawnId}: ${game.spawnPoints.length} enemies, ${game.playerSpawnPoints.length} player spawns, ${game.missileSpawnPoints.length} missile pickups`,
    );
  } else {
    const fallbackMesh = getLevelOcclusion(game);
    if (!fallbackMesh) {
      console.warn(
        "[Game] No spawn GLB and no occlusion mesh — cannot extract spawn points",
      );
      return;
    }

    fallbackMesh.updateMatrixWorld(true);
    const toRemove = [];
    fallbackMesh.traverse((child) => {
      if (!child.isMesh || !child.name?.startsWith("Cube")) return;
      const pos = new THREE.Vector3();
      child.getWorldPosition(pos);
      game.spawnPoints.push(pos.clone());
      game.enemySpawnHeavyFlags.push(false);
      game.enemySpawnPortalFlags.push(false);
      game.enemySpawnScales.push(readAuthoredEnemyMarkerScale(child, fallbackMesh));
      toRemove.push(child);
    });

    for (const obj of toRemove) {
      obj.removeFromParent();
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    saveLevelSpawnCache(
      game,
      level,
      game.spawnPoints,
      game.playerSpawnPoints,
      game.missileSpawnPoints,
      game.trainingGoalPoints,
      game.playerSpawnMarkerQuaternions,
      game.trainingGoalQuaternions,
      game.enemySpawnHeavyFlags,
      game.levelBoostPoints,
      game.levelBoostQuaternions,
      game.weaponPickupPoints,
      game.enemySpawnPortalFlags,
      game.enemySpawnScales,
    );
    console.log(
      `[Game] Extracted ${game.spawnPoints.length} spawn points from occlusion mesh (fallback)`,
    );
  }

  finalizeEnemySpawnScales(game);
  applyLevelBounds(game);
  bindCharonReactorCoreFromLevelData(game);
  cacheCharonEscapeRoomAabb(game);
}

export { LEVEL_OBJECT_IDS, getSceneObject, getSceneObjectsForState };
