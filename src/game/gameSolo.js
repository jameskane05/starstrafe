/**
 * gameSolo.js - SOLO PLAY MODE SETUP AND ENTRY
 * =============================================================================
 *
 * ROLE: Enters solo (single-player) play: loads level, spawns player, enemies,
 * and missile pickups; shows game canvas and hides menu. Optional VR entry.
 *
 * KEY RESPONSIBILITIES:
 * - startSoloDebug(game): set isMultiplayer false, update lights for level, init engine audio
 * - Optional XR enter; preload level and enemy ship assets; create local Player
 * - Spawn enemies (gameEnemies), missile pickups; start game loop in PLAYING state
 * - Used when starting from menu or debug; multiplayer flow is in gameMultiplayer.js
 *
 * RELATED: gameLevel.js, gameEnemies.js, Player.js, Enemy.js, ShipDestruction.js,
 * EngineAudio.js, MenuManager.js, LightManager.js.
 *
 * GPU / LOADING: Training uses prewarmCheckpointPoolDuringFirstView alongside waitForFirstViewReady
 * so checkpoint shaders compile under the overlay (MissionManager.js “Checkpoint GPU pipeline”).
 * Mission enemy pool is prewarmed earlier in startSoloDebug via initTrainingMissionEnemyPool
 * or initCharonMissionEnemyPool (same pooled path as training); add a first-view pass if a
 * campaign step shows cold enemy shaders after splats finish loading.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { Player } from "../entities/Player.js";
import { AllyShip } from "../entities/AllyShip.js";
import {
  applyEnemyShipEnvironmentMap,
  applyEnemyShipEnvironmentMapToModels,
  loadShipModels,
  shipModels,
  reapplyShipMaterials,
} from "../entities/Enemy.js";
import {
  applyEnvironmentAmbientToLight,
  applyEnvironmentMapToObject,
  getEnemyEnvMapConfigForLevel,
  loadEnvironmentMap,
} from "../utils/envMapAssets.js";
import { initializeCockpitEnvZones } from "../utils/cockpitEnvZones.js";
import {
  cleanupDestruction,
  getShipDestructionDebrisMaterials,
  prefractureModelsAsync,
  spawnDestruction,
} from "../vfx/ShipDestruction.js";
import { Explosion } from "../entities/Explosion.js";
import { prewarmSpawnWarp } from "../vfx/spawnWarp.js";
import { Missile } from "../entities/Missile.js";
import { KineticMissile } from "../entities/KineticMissile.js";
import { Projectile } from "../entities/Projectile.js";
import { initLevelBoosters } from "./levelBoosters.js";
import { GAME_STATES } from "../data/gameData.js";
import MenuManager from "../ui/MenuManager.js";
import engineAudio from "../audio/EngineAudio.js";
import * as gameEnemies from "./gameEnemies.js";
import MissionManager, {
  warmGpuProgramsForPlay,
  prewarmCheckpointPoolDuringFirstView,
} from "../missions/MissionManager.js";
import {
  setHidePilotChrome,
  updateLeaderboardButtonVisibility,
} from "./gameInGameUI.js";
import {
  showFirstViewLoading,
  hideFirstViewLoading,
  fadeFirstViewLoadingToBlack,
  waitForFirstViewReady,
} from "./gameFirstViewLoading.js";
import {
  mountCharonOpeningOverlayBlack,
  runCharonIntroTypewriterAndFade,
} from "./charonIntroSequence.js";
import {
  mountSaturnaliaOpeningOverlayBlack,
  runSaturnaliaIntroTypewriterAndFade,
} from "./saturnaliaIntroSequence.js";
import { applyAuthoredPlayerSpawn } from "../utils/playerSpawnOrientation.js";
import { createPathRailFromScene, closestDistanceOnPath, samplePath } from "../utils/pathRail.js";
import { getPrimaryWeaponUnlocks } from "./weaponUnlocks.js";

const _allySpawnPos = new THREE.Vector3();
const _allySpawnTangent = new THREE.Vector3();
const ALLY_ESCORT_MISSIONS = {
  saturnalia: "saturnaliaLevelData",
  "capital-ship-earth-defense": "earthdefenseLevelData",
};
const ALLY_PATH_LEAD_SPAWN_AHEAD = 24;
import { stopCharonEscapeSequenceForLevelChange } from "./charonEscapeSequence.js";
import { stopSaturnaliaCollapseForLevelChange } from "./saturnaliaCollapseSequence.js";

function clearAlliedShips(game) {
  if (!game.alliedShips) game.alliedShips = [];
  for (const ally of game.alliedShips) {
    ally.dispose?.(game.scene, game);
  }
  game.alliedShips.length = 0;
}

function unloadCampaignLevelAssets(game, levelId) {
  for (const suffix of ["Level", "LevelData"]) {
    const id = `${levelId}${suffix}`;
    if (game.sceneManager?.hasObject?.(id)) {
      game.sceneManager.removeObject(id);
    }
  }
}

export async function handoffSoloCampaign(game, missionId, levelId) {
  // Show pages-loading immediately so Continue isn't stuck on a black screen
  // while sync teardown / scene unload runs.
  document.getElementById("mission-complete-overlay")?.remove();
  game._missionCompleteOverlayEl = null;
  document.getElementById("charon-outro-overlay")?.remove();
  document.getElementById("saturnalia-outro-overlay")?.remove();
  MenuManager.showBackgroundLoading();
  // Above mission-complete / outro overlays (3200 / 3100) until they fully clear.
  showFirstViewLoading({ zIndex: 4000 });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  stopCharonEscapeSequenceForLevelChange(game);
  stopSaturnaliaCollapseForLevelChange(game);
  cleanupDestruction(game.scene);
  gameEnemies.resetSoloCampaignEnemyState(game);
  clearAlliedShips(game);

  for (const list of [
    game.projectiles,
    game.missiles,
    game.explosions,
  ]) {
    if (!list?.length) continue;
    for (let i = list.length - 1; i >= 0; i--) {
      list[i]?.dispose?.();
    }
    list.length = 0;
  }

  game.missionManager?.stopMission();
  game.levelTriggerManager?.resetSession?.();

  const prevLevel = game.gameManager?.getState?.()?.currentLevel;
  if (prevLevel && prevLevel !== levelId) {
    unloadCampaignLevelAssets(game, prevLevel);
  }
  unloadCampaignLevelAssets(game, levelId);

  game.levelLoadPromise = null;
  game._levelSpawnCache = null;
  game.trainingGoalPoints = [];
  game.trainingGoalQuaternions = [];
  game._saturnaliaChaseGpuWarmed = false;
  game.player = null;

  game.pendingMissionConfig = { missionId, levelId };
  game.gameManager.setState({
    currentLevel: levelId,
    missionLevelId: levelId,
    isRunning: false,
  });

  await startSoloDebug(game);
}

function spawnAlliedEscort(game, missionConfig = null) {
  clearAlliedShips(game);
  const missionId = missionConfig?.missionId;
  const levelDataId = ALLY_ESCORT_MISSIONS[missionId];
  if (!levelDataId) return;
  const allyPreset = game.gameManager.getDifficultyPreset?.()?.ally;
  if (allyPreset?.enabled === false) return;
  const playerPos = game.xrManager?.isPresenting && game.xrManager.rig
    ? game.xrManager.rig.position
    : game.camera.position;
  const offset = new THREE.Vector3(8, 3, -18).applyQuaternion(
    game.camera.quaternion,
  );
  const pathRail = createPathRailFromScene(
    game.sceneManager?.getObject?.(levelDataId),
  );
  let spawnPos = playerPos.clone().add(offset);
  if (pathRail && missionId === "capital-ship-earth-defense") {
    const playerAlong = closestDistanceOnPath(pathRail, playerPos);
    samplePath(
      pathRail,
      Math.min(pathRail.total, playerAlong + ALLY_PATH_LEAD_SPAWN_AHEAD),
      _allySpawnPos,
      _allySpawnTangent,
    );
    spawnPos.copy(_allySpawnPos);
  }
  const enableLights =
    game.gameManager.getPerformanceSetting("rendering", "enemyLights") ?? true;
  const ally = new AllyShip(
    game.scene,
    spawnPos,
    game.level,
    game._levelBounds,
    {
      enableLights,
      game,
      fireRate: allyPreset?.fireRate ?? 1.1,
      damage: allyPreset?.damage ?? 14,
      cloneMaterials: false,
      pathRail,
    },
  );
  if (pathRail && missionId === "capital-ship-earth-defense") {
    ally.pathAlong = closestDistanceOnPath(pathRail, spawnPos);
    ally.pathRecovery = true;
    ally.pathInfluence = 1;
  }
  game.alliedShips.push(ally);
}

export async function startSoloDebug(game) {
  game.isMultiplayer = false;
  updateLeaderboardButtonVisibility(game);
  game.dynamicSceneElementManager?.setElements([]);
  const missionConfig = game.pendingMissionConfig;
  const loadingTracker = game.levelLoadingTracker;

  if (!game.levelLoadPromise) {
    loadingTracker?.reset();
  }
  MenuManager.showBackgroundLoading();
  loadingTracker?.registerTask("solo-xr");
  loadingTracker?.registerTask("solo-enemy-assets");
  loadingTracker?.registerTask("solo-player-setup");
  showFirstViewLoading();
  game.musicManager?.reshuffleAndPlay(2.0);

  const level = game.gameManager.getState().currentLevel;
  game.lightManager?.updateAmbientForLevel(level);

  engineAudio.init();

  const xrActive = game.xrManager?.supported
    ? await game.xrManager.enterVR(game.scene, game.camera)
    : false;
  loadingTracker?.completeTask("solo-xr");

  await game.preloadLevel();
  await ensureEnemyShipAssetsLoaded(game, loadingTracker);

  game.player = new Player(game.camera, game.input, game.level, game.scene, {
    game,
    primaryWeaponUnlocks: getPrimaryWeaponUnlocks(),
  });
  const difficulty = game.gameManager.getDifficultyPreset?.();
  const playerHealth = difficulty?.player?.maxHealth ?? 100;
  const playerMissiles = difficulty?.player?.missiles ?? 6;
  game.player.health = playerHealth;
  game.player.maxHealth = playerHealth;
  game.player.missiles = playerMissiles;
  game.player.maxMissiles = playerMissiles;
  game.camera.quaternion.setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    (-70 * Math.PI) / 180,
  );

  if (xrActive) {
    game.player.setXRMode(game.xrManager);
  }

  // Pass level geometry to the automap so it can build the wire dataset
  const _soloLevelId = game.gameManager.getState().currentLevel;
  const _soloGeomRoot = _soloLevelId
    ? game.sceneManager.getGeometryRoot(`${_soloLevelId}LevelData`)
    : null;
  if (_soloGeomRoot) game.player.automap.setLevel(_soloGeomRoot);

  game._extractSpawnPoints();
  initLevelBoosters(game);

  if (missionConfig?.missionId === "trainingGrounds") {
    await gameEnemies.initTrainingMissionEnemyPool(game);
  } else if (missionConfig?.missionId === "charon") {
    game._charonInitialEnemyPositions =
      game.spawnPoints.length > 0 ? game.spawnPoints.map((p) => p.clone()) : [];
    const hf = game.enemySpawnHeavyFlags;
    game._charonEnemyPerSlotOptions =
      game._charonInitialEnemyPositions.length > 0
        ? game._charonInitialEnemyPositions.map((_, i) => ({
            isHeavy: hf?.[i] === true,
          }))
        : null;
    if (game._charonInitialEnemyPositions.length > 0) {
      await gameEnemies.initCharonMissionEnemyPool(
        game,
        game._charonInitialEnemyPositions,
      );
    } else {
      game._charonInitialEnemyPositions = null;
      game._charonEnemyPerSlotOptions = null;
    }
  } else {
    game._charonInitialEnemyPositions = null;
    game._charonEnemyPerSlotOptions = null;
  }

  const debugSpawnIdx = missionConfig?.debugSpawnIndex ?? null;
  if (debugSpawnIdx != null) {
    game.gameManager.setState({ debugSpawnActive: true });
  }

  if (
    missionConfig?.missionId === "trainingGrounds" ||
    missionConfig?.missionId === "charon" ||
    missionConfig?.missionId === "saturnalia" ||
    missionConfig?.missionId === "earthdefense" ||
    missionConfig?.missionId === "capital-ship-earth-defense"
  ) {
    if (!applyAuthoredPlayerSpawn(game, debugSpawnIdx ?? 0)) {
      game.camera.position.set(0, 0, 0);
      game.player.velocity.set(0, 0, 0);
    }
  } else if (game.playerSpawnPoints.length > 0) {
    applyAuthoredPlayerSpawn(
      game,
      debugSpawnIdx ??
        Math.floor(Math.random() * game.playerSpawnPoints.length),
    );
  }
  spawnAlliedEscort(game, missionConfig);
  void initializeCockpitEnvZones(game).then((zones) => {
    if (!zones) void applyCockpitEnvironmentForCurrentLevel(game);
  });

  const spawnN = game.spawnPoints?.length ?? 0;
  const extraPointLights = Math.min(48, Math.max(6, spawnN * 2));
  game.dynamicLights?.warmupShaders(
    game.renderer,
    game.camera,
    extraPointLights,
  );
  prewarmMissileVisuals(game);
  if (!game.missionManager) {
    game.missionManager = new MissionManager(game);
  }

  await game._checkpointVisualPoolInitPromise?.catch?.(() => {});

  if (missionConfig?.missionId === "trainingGrounds") {
    await prewarmCheckpointPoolDuringFirstView(game);
  }

  if (!missionConfig) {
    game.missionManager.stopMission();
    gameEnemies.clearDeferredEnemySpawnState(game);
    await gameEnemies.spawnEnemiesFromLevelSpawnPointsWithPrewarm(game);
    gameEnemies.spawnMissilePickups(game);
    gameEnemies.spawnWeaponPickups(game);
  } else {
    if (game._missilePickups) {
      for (const pickup of game._missilePickups) {
        pickup.collectible?.dispose?.();
      }
      game._missilePickups = [];
    }
    if (game._weaponPickups) {
      for (const pickup of game._weaponPickups) {
        pickup.collectible?.dispose?.();
      }
      game._weaponPickups = [];
    }
    gameEnemies.spawnWeaponPickups(game);
    game.enemyRespawnQueue.length = 0;
    game.gameManager.clearMissionState({
      currentMissionId: missionConfig.missionId,
      missionLevelId: missionConfig.levelId,
      missionStatus: "starting",
    });
    gameEnemies.clearDeferredEnemySpawnState(game);
  }

  if (!xrActive && !game.input.mobile.shouldSkipPointerLock()) {
    document.body.requestPointerLock?.()?.catch?.(() => {});
  }
  setHidePilotChrome(game, false);
  document.getElementById("hud").classList.add("active");

  warmGpuProgramsForPlay(game);

  game.gameManager.setState({
    currentState: GAME_STATES.PLAYING,
    isRunning: true,
    isMultiplayer: false,
  });

  if (missionConfig) {
    game.levelTriggerManager?.resetSession?.();
    await game.missionManager.startMission(
      missionConfig.missionId,
      missionConfig,
    );
  }
  game.pendingMissionConfig = null;
  loadingTracker?.completeTask("solo-player-setup");

  game.renderer.domElement.style.display = "block";

  // First-view overlay stays until splats/cockpit ready AND (training) checkpoint pool GPU prewarm.
  // Add other mission-specific prewarms here with Promise.all — see MissionManager checkpoint header.
  (async () => {
    const missionId = game.gameManager?.getState?.()?.currentMissionId;
    const checkpointPoolPrewarm =
      missionId === "trainingGrounds"
        ? prewarmCheckpointPoolDuringFirstView(game)
        : Promise.resolve();
    await Promise.all([waitForFirstViewReady(game), checkpointPoolPrewarm]);
    const debugSpawn = Boolean(
      game.gameManager?.getState?.()?.debugSpawnActive,
    );
    const hasIntro =
      !debugSpawn && (missionId === "charon" || missionId === "saturnalia");

    if (hasIntro) {
      await fadeFirstViewLoadingToBlack();
    }
    MenuManager.enterPlayingMode();
    if (hasIntro) {
      if (missionId === "charon") {
        mountCharonOpeningOverlayBlack();
      } else {
        mountSaturnaliaOpeningOverlayBlack();
      }
    }
    hideFirstViewLoading();
    if (missionId === "charon") {
      if (debugSpawn) {
        game.gameManager.setState({ charonIntroTextDone: true });
      } else if (hasIntro) {
        await runCharonIntroTypewriterAndFade(game);
      }
    } else if (missionId === "saturnalia") {
      if (debugSpawn) {
        game.gameManager.setState({ saturnaliaIntroTextDone: true });
      } else if (hasIntro) {
        await runSaturnaliaIntroTypewriterAndFade(game);
      }
    }
  })();
}

async function applyEnemyShipEnvironmentForCurrentLevel(game) {
  const levelId = game.gameManager?.getState?.()?.currentLevel;
  const config = getEnemyEnvMapConfigForLevel(levelId);
  const loaded = config
    ? await loadEnvironmentMap(config, game.renderer).catch((err) => {
        console.warn(
          `[EnemyEnvMap] Failed to load env map "${config.id}" for ${levelId}`,
          err,
        );
        return null;
      })
    : null;
  const envMap = loaded?.texture ?? null;
  const intensity = loaded?.intensity ?? 1;

  applyEnvironmentAmbientToLight(
    game.lightManager?.getLight?.("ambient"),
    loaded,
    config,
  );
  applyEnemyShipEnvironmentMapToModels(envMap, intensity);
  for (const enemy of game.enemies ?? []) {
    applyEnemyShipEnvironmentMap(enemy.mesh, envMap, intensity);
  }
  for (const enemy of game._missionEnemyPool ?? []) {
    applyEnemyShipEnvironmentMap(enemy.mesh, envMap, intensity);
  }
  for (const ally of game.alliedShips ?? []) {
    applyEnemyShipEnvironmentMap(ally.mesh, envMap, intensity);
  }
  for (const entry of game._networkBotPool ?? []) {
    applyEnemyShipEnvironmentMap(entry.mesh, envMap, intensity);
  }
}

async function applyCockpitEnvironmentForCurrentLevel(game) {
  const levelId = game.gameManager?.getState?.()?.currentLevel;
  const config = getEnemyEnvMapConfigForLevel(levelId);
  const loaded = config
    ? await loadEnvironmentMap(config, game.renderer).catch((err) => {
        console.warn(
          `[CockpitEnvMap] Failed to load env map "${config.id}" for ${levelId}`,
          err,
        );
        return null;
      })
    : null;
  const envMap = loaded?.texture ?? null;
  const intensity = loaded?.intensity ?? 1;

  await game.player?.cockpitLoaded?.catch?.(() => {});
  applyEnvironmentMapToObject(game.player?.cockpit, envMap, intensity);
}

function enemyShipAssetSourceKey() {
  return `legacy:${shipModels.length}`;
}

export async function ensureEnemyShipAssetsLoaded(game, loadingTracker = null) {
  await loadShipModels();
  const sourceKey = enemyShipAssetSourceKey();
  if (
    game.enemyShipAssetsPromise &&
    game._enemyShipAssetSourceKey === sourceKey
  ) {
    await game.enemyShipAssetsPromise;
    await applyEnemyShipEnvironmentForCurrentLevel(game);
    prewarmShipDestructionDebrisMaterials(game);
    if (!game._spawnWarpPrewarmed) {
      prewarmEnemySpawnWarp(game);
    }
    loadingTracker?.completeTask("solo-enemy-assets");
    return;
  }
  game._enemyShipAssetSourceKey = sourceKey;
  game.enemyShipAssetsPromise = (async () => {
    await prefractureModelsAsync(shipModels);
    await reapplyShipMaterials(shipModels);
    await applyEnemyShipEnvironmentForCurrentLevel(game);
    prewarmShipDestructionDebrisMaterials(game);
  })();
  await game.enemyShipAssetsPromise;
  prewarmEnemySpawnWarp(game);
  loadingTracker?.completeTask("solo-enemy-assets");
}

function prewarmMissileVisuals(game) {
  if (!game.renderer || !game.camera || !game.scene) return;
  const dir = new THREE.Vector3(0, 0, -1);
  const pos = new THREE.Vector3(0, -12000, 0);
  const quat = new THREE.Quaternion();
  const m1 = new Missile(game.scene, pos, dir, {
    trailsEffect: game.trailsEffect,
  });
  const m2 = new KineticMissile(
    game.scene,
    pos.clone().add(new THREE.Vector3(8, 0, 0)),
    dir,
    { trailsEffect: game.trailsEffect },
  );
  const enemyLaserVisual = {
    color: shipModels[0]?.userData?.enemyLaserColor ?? 0xff8800,
    intensity: shipModels[0]?.userData?.enemyLaserIntensity ?? 1,
  };
  const p1 = new Projectile(
    game.scene,
    pos.clone().add(new THREE.Vector3(-8, 0, 0)),
    dir,
    false,
    null,
    enemyLaserVisual,
  );
  for (let i = 0; i < 28; i++) {
    game.trailsEffect?.emitMissileExhaust(pos, quat, dir);
  }
  for (let i = 0; i < 24; i++) {
    game.trailsEffect?.emitEngineExhaust(
      pos.clone().add(new THREE.Vector3((i % 3) - 1, 0, (i % 4) * 0.2)),
      dir,
    );
  }
  game.renderer.compile(game.scene, game.camera);
  if (game.composer && game._bloomActive) {
    game.composer.render();
    game.composer.render();
  } else {
    game.renderer.render(game.scene, game.camera);
    game.renderer.render(game.scene, game.camera);
  }
  m1.dispose(game.scene);
  m2.dispose(game.scene);
  p1.dispose(game.scene);
}

function prewarmShipDestructionDebrisMaterials(game) {
  if (!game.renderer || !game.camera || !game.scene) return;
  const materials = getShipDestructionDebrisMaterials();
  const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const root = new THREE.Group();
  root.position.set(0, -12000, 0);
  for (let i = 0; i < materials.length; i++) {
    const mesh = new THREE.Mesh(geometry, materials[i]);
    mesh.position.x = i * 0.2;
    root.add(mesh);
  }
  game.scene.add(root);
  game.renderer.compile(game.scene, game.camera);
  game.scene.remove(root);
  geometry.dispose();

  const pos = new THREE.Vector3(0, -12000, 0);
  const quat = new THREE.Quaternion();
  const explosion = new Explosion(game.scene, pos, 0xff8844, game.dynamicLights, {
    big: true,
  });
  game.explosionEffect?.emitBigExplosion(pos);
  if (shipModels.length > 0) {
    spawnDestruction(game.scene, pos, quat, 0);
  }
  game.renderer.compile(game.scene, game.camera);
  if (game.composer && game._bloomActive) {
    game.composer.render();
    game.composer.render();
  } else {
    game.renderer.render(game.scene, game.camera);
    game.renderer.render(game.scene, game.camera);
  }
  explosion.dispose();
  cleanupDestruction(game.scene);
}

function prewarmEnemySpawnWarp(game) {
  if (game._spawnWarpPrewarmed) return;
  const template = shipModels[0];
  if (!template || !game.renderer || !game.camera) return;

  const clone = template.clone();
  clone.scale.setScalar(2.0);
  clone.rotation.set(0, Math.PI, 0);

  prewarmSpawnWarp(game.renderer, game.camera, clone, {
    color: template.userData?.enemyLaserColor ?? 0xff8800,
    materialEffect: false,
  });
  game._spawnWarpPrewarmed = true;
}
