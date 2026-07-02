/**
 * gameMultiplayer.js - MULTIPLAYER MODE SETUP AND NETWORK HANDLERS
 * =============================================================================
 *
 * ROLE: Connects game to NetworkManager for multiplayer. Registers room/player
 * join/leave/update listeners, spawns local player and remote players, syncs
 * projectiles and collectibles, and handles game start from room state.
 *
 * KEY RESPONSIBILITIES:
 * - setupNetworkListeners(game): roomJoined, playerJoin, playerLeave, playerUpdate
 * - addRemotePlayer / removeRemotePlayer; sync local player stats from server
 * - startMultiplayerGame(game): create local Player, spawn remotes, preload level
 * - Handle projectile and collectible spawn/remove/pickup from network events
 *
 * RELATED: NetworkManager.js, Player.js, RemotePlayer.js, gameLevel.js,
 * gameNetworkProjectiles.js, gamePlayerLifecycle.js, ShipDestruction.js, gameData.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { Player } from "../entities/Player.js";
import { RemotePlayer } from "../entities/RemotePlayer.js";
import { Explosion } from "../entities/Explosion.js";
import {
  spawnDestruction,
  PLAYER_SHIP_MODEL_INDEX,
} from "../vfx/ShipDestruction.js";
import NetworkManager from "../network/NetworkManager.js";
import MenuManager from "../ui/MenuManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import sfxManager from "../audio/sfxManager.js";
import engineAudio from "../audio/EngineAudio.js";
import { GAME_STATES, SHIP_CLASSES } from "../data/gameData.js";
import {
  setHidePilotChrome,
  updateLeaderboardButtonVisibility,
} from "./gameInGameUI.js";
import {
  getSceneObjectsForState,
  getSceneObject,
  LEVEL_OBJECT_IDS,
} from "./gameLevel.js";
import {
  showFirstViewLoading,
  hideFirstViewLoading,
  waitForFirstViewReady,
} from "./gameFirstViewLoading.js";
import { prewarmEnemyMeshesInPlace } from "./gameEnemies.js";
import { markerQuaternionToCameraQuaternion } from "../utils/playerSpawnOrientation.js";
import { loadShipModels, shipModels } from "../entities/Enemy.js";
import { getPrimaryWeaponUnlocks } from "./weaponUnlocks.js";
import {
  allocateCheckpointDissolveBatchSerial,
  beginCheckpointDissolve,
  ENEMY_SPAWN_DISSOLVE_DURATION,
  precookCheckpointDissolveMaterials,
} from "../vfx/checkpointDissolveWarp.js";

/** In-flight addNetworkBot per id (async); syncNetworkBotsWithState may call every frame until done. */
const pendingNetworkBotAdds = new Set();
const NETWORK_BOT_POOL_HIDE_Y = -200000;
const NETWORK_BOT_POOL_MAX = 8;

function createBotPlaceholderMesh() {
  const geometry = new THREE.CylinderGeometry(0.35, 0.45, 1.8, 8);
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x1a0a0a,
    emissive: 0xff4400,
    emissiveIntensity: 0.4,
    metalness: 0.3,
    roughness: 0.7,
  });
  return new THREE.Mesh(geometry, material);
}

function cloneBotShipTemplate(template) {
  const clone = template.clone();
  clone.scale.setScalar(2.0);
  clone.rotation.set(0, Math.PI, 0);
  clone.traverse((child) => {
    if (!child.isMesh) return;
    const name = child.name?.toLowerCase?.() || "";
    if (name.startsWith("thruster_") || name.startsWith("weapon_")) {
      child.visible = false;
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material = child.material.map((m) => (m?.clone ? m.clone() : m));
      } else if (child.material.clone) {
        child.material = child.material.clone();
      }
    }
  });
  return clone;
}

function buildBotShipGroup(poolIndex) {
  const root = new THREE.Group();
  const n = shipModels.length;
  if (n === 0) return { root, usesSharedGeometry: false };

  const template = shipModels[poolIndex % n];
  const clone = cloneBotShipTemplate(template);
  root.add(clone);
  return { root, usesSharedGeometry: true };
}

const NETWORK_BOT_DISSOLVE_COLOR = 0xff6600;

/** One serial for all MP bot ships so dissolve shaders compile once, not per respawn id. */
function ensureNetworkBotDissolveBatchSerial(game) {
  if (game._networkBotDissolveBatchSerial == null) {
    game._networkBotDissolveBatchSerial = allocateCheckpointDissolveBatchSerial();
  }
  return game._networkBotDissolveBatchSerial;
}

function attachNetworkBotSpawnDissolve(game, root, options = {}) {
  const batchSerial = ensureNetworkBotDissolveBatchSerial(game);
  const precooked = precookCheckpointDissolveMaterials(root, {
    sharedDissolveBatchSerial: batchSerial,
    edgeColor: NETWORK_BOT_DISSOLVE_COLOR,
    edgeColor2: NETWORK_BOT_DISSOLVE_COLOR,
  });
  return beginCheckpointDissolve(root, game, {
    duration: ENEMY_SPAWN_DISSOLVE_DURATION,
    edgeColor: NETWORK_BOT_DISSOLVE_COLOR,
    particleColor: NETWORK_BOT_DISSOLVE_COLOR,
    particleDecimation: 8,
    particleSize: 26,
    dissolvePrecooked: precooked,
    deferParticleAttach: true,
    retainDissolveMaterials: options.retainDissolveMaterials === true,
  });
}

function parkNetworkBotEntry(entry) {
  if (!entry?.mesh) return;
  entry.assignedId = null;
  entry.mesh.visible = false;
  entry.mesh.position.set(0, NETWORK_BOT_POOL_HIDE_Y, 0);
  entry.mesh.quaternion.identity();
  entry.spawnWarp?.freeze?.();
}

function disposeNetworkBotEntry(game, entry) {
  if (!entry?.mesh) return;
  entry.spawnWarp?.dispose?.();
  game.scene.remove(entry.mesh);
  entry.mesh.traverse?.((child) => {
    if (!child.isMesh) return;
    if (!entry.usesSharedGeometry) {
      child.geometry?.dispose?.();
    }
    const mats = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const m of mats) m?.dispose?.();
  });
}

function createPooledNetworkBotEntry(game, poolIndex) {
  const { root, usesSharedGeometry } = buildBotShipGroup(poolIndex);
  const mesh = root.children.length > 0 ? root : createBotPlaceholderMesh();
  const entry = {
    mesh,
    usesSharedGeometry: root.children.length > 0 ? usesSharedGeometry : false,
    spawnWarp: null,
    assignedId: null,
  };
  game.scene.add(mesh);
  entry.spawnWarp = attachNetworkBotSpawnDissolve(game, mesh, {
    retainDissolveMaterials: true,
  });
  while (!entry.spawnWarp.finished) {
    entry.spawnWarp.update(0.25);
  }
  entry.spawnWarp.restart({ hold: true });
  parkNetworkBotEntry(entry);
  return entry;
}

function getNetworkBotPoolSize(game, state) {
  const liveCount = state?.bots?.size ?? 0;
  const authoredCount = Math.max(
    game.spawnPoints?.length ?? 0,
    game.playerSpawnPoints?.length ?? 0,
  );
  if (authoredCount > 0) {
    return Math.max(liveCount, Math.min(NETWORK_BOT_POOL_MAX, authoredCount));
  }
  return Math.max(liveCount, NETWORK_BOT_POOL_MAX);
}

function getNetworkBotPrewarmPositions(game, state, poolSize) {
  const positions = [];
  state?.bots?.forEach((bot) => {
    positions.push(new THREE.Vector3(bot.x, bot.y, bot.z));
  });
  const authored =
    game.spawnPoints?.length > 0
      ? game.spawnPoints
      : game.playerSpawnPoints?.length > 0
        ? game.playerSpawnPoints
        : null;
  if (authored) {
    for (const p of authored) {
      positions.push(new THREE.Vector3(p.x, p.y, p.z));
    }
  }
  if (positions.length === 0) {
    positions.push(new THREE.Vector3(0, 4, -45));
  }
  while (positions.length < poolSize) {
    positions.push(positions[positions.length - 1].clone());
  }
  return positions;
}

async function ensureNetworkBotPool(game, state = NetworkManager.getState()) {
  if (game._networkBotPool?.length) return game._networkBotPool;
  if (game._networkBotPoolInitPromise) {
    return game._networkBotPoolInitPromise;
  }
  game._networkBotPoolInitPromise = (async () => {
    await loadShipModels();
    if (game._networkBotPool?.length) return game._networkBotPool;
    const poolSize = getNetworkBotPoolSize(game, state);
    const pool = [];
    for (let i = 0; i < poolSize; i++) {
      pool.push(createPooledNetworkBotEntry(game, i));
    }
    game._networkBotPool = pool;
    await prewarmEnemyMeshesInPlace(
      game,
      pool,
      getNetworkBotPrewarmPositions(game, state, poolSize),
    );
    return pool;
  })();
  try {
    return await game._networkBotPoolInitPromise;
  } finally {
    game._networkBotPoolInitPromise = null;
  }
}

function acquireNetworkBotEntry(game, id) {
  let entry = game._networkBotPool?.find((slot) => slot.assignedId == null);
  if (!entry) {
    entry = createPooledNetworkBotEntry(game, game._networkBotPool.length);
    game._networkBotPool.push(entry);
  }
  entry.assignedId = id;
  return entry;
}

function applyNetworkBotState(entry, bot) {
  entry.mesh.position.set(bot.x, bot.y, bot.z);
  entry.mesh.quaternion.set(bot.qx, bot.qy, bot.qz, bot.qw);
  entry.mesh.visible = true;
  entry.spawnWarp?.restart?.();
  entry.spawnWarp?.update?.(0);
}

export async function addNetworkBot(game, id, bot) {
  if (game.networkBots.has(id)) return;
  if (pendingNetworkBotAdds.has(id)) return;
  pendingNetworkBotAdds.add(id);
  try {
    await ensureNetworkBotPool(game);
    if (game.networkBots.has(id)) return;
    const entry = acquireNetworkBotEntry(game, id);
    applyNetworkBotState(entry, bot);
    game.networkBots.set(id, entry);
  } finally {
    pendingNetworkBotAdds.delete(id);
  }
}

export function removeNetworkBot(game, id, deathData = null) {
  const entry = game.networkBots.get(id);
  if (entry) {
    parkNetworkBotEntry(entry);
    game.networkBots.delete(id);
  }
  if (deathData && deathData.x !== undefined) {
    const pos = new THREE.Vector3(deathData.x, deathData.y, deathData.z);
    const explosion = new Explosion(
      game.scene,
      pos,
      0xff4400,
      game.dynamicLights,
      { big: false },
    );
    game.explosions.push(explosion);
    sfxManager.play("ship-explosion", pos);
    if (game.particles) {
      game.explosionEffect?.emitExplosionParticles?.(pos, undefined, 16);
    }
  }
}

/** Single source of truth: Colyseus state.bots ↔ scene meshes (no duplicate botAdd + start-game race). */
export function syncNetworkBotsWithState(game) {
  if (!game.isMultiplayer || !game.scene) return;
  const state = NetworkManager.getState();
  if (!state?.botsEnabled) {
    for (const id of [...game.networkBots.keys()]) {
      removeNetworkBot(game, id);
    }
    return;
  }
  if (!state.bots) return;
  if (!game._networkBotPool?.length && !game._networkBotPoolInitPromise) {
    void ensureNetworkBotPool(game, state).catch((err) =>
      console.warn("[Multiplayer] ensureNetworkBotPool failed", err),
    );
  }

  const ids = new Set();
  state.bots.forEach((bot, id) => {
    ids.add(id);
    if (!game.networkBots.has(id)) {
      void addNetworkBot(game, id, bot).catch((err) =>
        console.warn("[Multiplayer] addNetworkBot failed", err),
      );
    }
  });
  for (const id of [...game.networkBots.keys()]) {
    if (!ids.has(id)) {
      removeNetworkBot(game, id);
    }
  }
}

function pushLevelSpawnsToServer(game) {
  game._extractSpawnPoints();
  const ne = game.spawnPoints?.length ?? 0;
  const np = game.playerSpawnPoints?.length ?? 0;
  const nm = game.missileSpawnPoints?.length ?? 0;
  const nw = game.weaponPickupPoints?.length ?? 0;
  console.log(
    `[Multiplayer] spawn sync → server (host=${NetworkManager.isHost()}): ${ne} enemy, ${np} player, ${nm} missile, ${nw} weapon`,
  );
  const playerSpawns = (game.playerSpawnPoints || []).map((p, i) => {
    const o = { x: p.x, y: p.y, z: p.z };
    const mq = game.playerSpawnMarkerQuaternions?.[i];
    if (mq) {
      const cq = markerQuaternionToCameraQuaternion(mq);
      o.qx = cq.x;
      o.qy = cq.y;
      o.qz = cq.z;
      o.qw = cq.w;
    }
    return o;
  });
  NetworkManager.sendSpawnPoints({
    enemySpawns: game.spawnPoints,
    playerSpawns,
    missileSpawns: game.missileSpawnPoints,
    weaponSpawns: game.weaponPickupPoints,
    bounds: game._levelBounds || null,
  });
}

async function hostSyncSpawnsAfterPreload(game) {
  try {
    await game.preloadLevel();
  } catch {
    /* preloadLevel already logs */
  }
  if (!NetworkManager.isHost() || !game.sceneManager) return;
  pushLevelSpawnsToServer(game);
}

export function setupNetworkListeners(game) {
  NetworkManager.on("roomJoined", () => {
    const roomState = NetworkManager.getState();
    const patch = { multiplayerLobbyWarmup: true };
    if (roomState?.level) {
      patch.currentLevel = roomState.level;
    }
    game.gameManager.setState(patch);
    const push = () => void hostSyncSpawnsAfterPreload(game);
    push();
    queueMicrotask(push);
    setTimeout(push, 80);
    setTimeout(push, 400);
  });

  NetworkManager.on("roomLeft", () => {
    game.gameManager.setState({ multiplayerLobbyWarmup: false });
  });

  NetworkManager.on("playerJoin", ({ player, sessionId, isLocal }) => {
    if (!isLocal && game.isMultiplayer) {
      game.addRemotePlayer(sessionId, player);
    }
  });

  NetworkManager.on("playerLeave", ({ sessionId }) => {
    game.removeRemotePlayer(sessionId);
  });

  NetworkManager.on("playerUpdate", ({ player, sessionId, isLocal }) => {
    if (!isLocal && game.remotePlayers.has(sessionId)) {
      const remote = game.remotePlayers.get(sessionId);
      remote.updateFromServer(player);
    } else if (isLocal && game.player) {
      game.player.health = player.health;
      game.player.maxHealth = player.maxHealth;
      game.player.missiles = player.missiles;
      game.player.maxMissiles = player.maxMissiles;
      game.player.boostFuel = player.boostFuel ?? game.player.boostFuel;
      game.player.maxBoostFuel =
        player.maxBoostFuel ?? game.player.maxBoostFuel;
      game.player.isBoosting = player.isBoosting ?? false;
      game.player.hasLaserUpgrade = player.hasLaserUpgrade;
      game.player.primaryWeaponUnlocks = {
        ...getPrimaryWeaponUnlocks(),
        ...(game.player.primaryWeaponUnlocks || {}),
        chargingLaser: player.hasChargingLaser === true,
        gatling: player.hasGatling === true,
      };

      const lastProcessed = player.lastProcessedInput;
      if (lastProcessed > 0) {
        game.prediction.applyServerState(
          { x: player.x, y: player.y, z: player.z },
          { x: player.qx, y: player.qy, z: player.qz, w: player.qw },
          lastProcessed,
        );
        NetworkManager.clearProcessedInputs(lastProcessed);
      }
    }
  });

  NetworkManager.on("projectileSpawn", ({ projectile, id }) => {
    if (projectile.ownerId !== NetworkManager.sessionId) {
      game.spawnNetworkProjectile(id, projectile);
    } else if (projectile.type === "missile") {
      while (
        game.localMissileQueue.length > 0 &&
        game.localMissileQueue[0].disposed
      ) {
        game.localMissileQueue.shift();
      }
      const localMissile = game.localMissileQueue.shift();
      if (localMissile && !localMissile.disposed) {
        game.localMissileIds.set(id, localMissile);
      }
    }
  });

  NetworkManager.on("projectileRemove", ({ id }) => {
    game.removeNetworkProjectile(id);
  });

  NetworkManager.on("projectileUpdate", ({ projectile, id }) => {
    game.updateNetworkProjectile(id, projectile);
  });

  NetworkManager.on("collectibleSpawn", ({ collectible, id }) => {
    game.spawnCollectible(id, collectible);
  });

  NetworkManager.on("collectibleRemove", ({ id }) => {
    game.removeCollectible(id);
  });

  NetworkManager.on("hit", (data) => {
    game.handleNetworkHit(data);
  });

  NetworkManager.on("kill", (data) => {
    game.showKillFeed(data.killerName, data.victimName);

    let victimPos = null;
    if (data.victimId === NetworkManager.sessionId) {
      victimPos = game.camera.position.clone();
      const deathQuat = game.camera.quaternion.clone();
      spawnDestruction(
        game.scene,
        victimPos,
        deathQuat,
        PLAYER_SHIP_MODEL_INDEX,
        2.0,
      );
      game.handleLocalPlayerDeath();
    } else {
      const remote = game.remotePlayers.get(data.victimId);
      if (remote && remote.mesh) {
        victimPos = remote.mesh.position.clone();
        const deathQuat = remote.mesh.quaternion.clone();
        const remoteScale = remote.shipMesh?.scale?.x ?? 1;
        spawnDestruction(
          game.scene,
          victimPos,
          deathQuat,
          PLAYER_SHIP_MODEL_INDEX,
          remoteScale,
        );
      }
      if (data.killerId === NetworkManager.sessionId) {
        proceduralAudio.killConfirm();
      }
    }

    if (victimPos) {
      const explosion = new Explosion(
        game.scene,
        victimPos,
        0xff4400,
        game.dynamicLights,
        { big: true },
      );
      game.explosions.push(explosion);
      sfxManager.play("ship-explosion", victimPos);

      if (game.particles) {
        game.explosionEffect.emitBigExplosion(victimPos);
      }
    }
  });

  NetworkManager.on("respawn", (data) => {
    if (data.playerId === NetworkManager.sessionId) {
      game.handleLocalPlayerRespawn(data);
      proceduralAudio.respawn();
    }
  });

  NetworkManager.on("stateChange", (state) => {
    if (state.phase === "results") {
      game.onMatchEnd();
    }
    if (
      state.phase === "countdown" &&
      state.countdown === 3 &&
      NetworkManager.isHost()
    ) {
      game.gameManager.setState({
        currentLevel: state.level || game.gameManager.getState().currentLevel,
      });
      const run = () => void hostSyncSpawnsAfterPreload(game);
      run();
      setTimeout(run, 500);
    }
    if (state.phase === "lobby" && state.level) {
      game.gameManager.setState({ multiplayerLobbyWarmup: true });
      const current = game.gameManager.getState().currentLevel;
      if (current !== state.level) {
        const oldState = {
          ...game.gameManager.getState(),
          currentLevel: current,
          currentState: GAME_STATES.PLAYING,
        };
        const oldObjects = getSceneObjectsForState(oldState);
        for (const obj of oldObjects) {
          if (game.sceneManager.hasObject(obj.id)) {
            game.sceneManager.removeObject(obj.id);
          }
        }
        game.gameManager.setState({ currentLevel: state.level });
        game.lightManager?.updateAmbientForLevel(state.level);
        game.isLoadingLevel = false;
        void hostSyncSpawnsAfterPreload(game);
      }
    }
  });

  NetworkManager.on("collectiblePickup", (data) => {
    game.handleCollectiblePickup(data);
  });

  NetworkManager.on("botDeath", (data) => {
    if (data?.killerId === NetworkManager.sessionId) {
      proceduralAudio.killConfirm({ streak: true });
    }
    removeNetworkBot(game, data.botId, data);
  });
}

export async function startMultiplayerGame(game) {
  game.isMultiplayer = true;
  updateLeaderboardButtonVisibility(game);
  const loadingTracker = game.levelLoadingTracker;

  if (!game.levelLoadPromise) {
    loadingTracker?.reset();
  }
  MenuManager.showBackgroundLoading();
  loadingTracker?.registerTask("multiplayer-player-setup");
  loadingTracker?.registerTask("multiplayer-scene-setup");
  showFirstViewLoading();
  game.musicManager?.reshuffleAndPlay(2.0);

  const state = NetworkManager.getState();
  const localPlayer = NetworkManager.getLocalPlayer();
  const level = state?.level || "newworld";
  game.gameManager.setState({
    currentLevel: level,
    currentState: GAME_STATES.PLAYING,
    isMultiplayer: true,
    multiplayerLobbyWarmup: false,
  });
  game.lightManager?.updateAmbientForLevel(level);

  await game.preloadLevel();

  for (const id of LEVEL_OBJECT_IDS) {
    const obj = getSceneObject(id);
    if (
      obj?.criteria?.currentLevel &&
      obj.criteria.currentLevel !== level &&
      game.sceneManager.hasObject(id)
    ) {
      game.sceneManager.removeObject(id);
    }
  }

  if (!localPlayer) {
    loadingTracker?.completeTask("multiplayer-scene-setup");
    loadingTracker?.completeTask("multiplayer-player-setup");
    hideFirstViewLoading();
    return;
  }

  const classStats =
    SHIP_CLASSES[localPlayer.shipClass] || SHIP_CLASSES.fighter;

  game.player = new Player(game.camera, game.input, game.level, game.scene, {
    game,
    primaryWeaponUnlocks: getPrimaryWeaponUnlocks(),
  });
  game.player.health = localPlayer.health;
  game.player.maxHealth = localPlayer.maxHealth;
  game.player.missiles = localPlayer.missiles;
  game.player.maxMissiles = localPlayer.maxMissiles || classStats.maxMissiles;
  game.player.boostFuel = localPlayer.boostFuel ?? game.player.boostFuel;
  game.player.maxBoostFuel =
    localPlayer.maxBoostFuel ?? game.player.maxBoostFuel;
  game.player.hasLaserUpgrade = localPlayer.hasLaserUpgrade || false;
  game.player.primaryWeaponUnlocks = {
    ...getPrimaryWeaponUnlocks(),
    chargingLaser: localPlayer.hasChargingLaser === true,
    gatling: localPlayer.hasGatling === true,
  };
  NetworkManager.sendWeaponUnlocks?.(getPrimaryWeaponUnlocks());
  game.player.acceleration = classStats.acceleration;
  game.player.maxSpeed = classStats.maxSpeed;

  engineAudio.init();

  game.dynamicLights?.warmupShaders(game.renderer, game.camera);

  const objectsToLoad = getSceneObjectsForState(game.gameManager.getState());
  const loads = [];
  for (const obj of objectsToLoad) {
    if (!game.sceneManager.hasObject(obj.id)) {
      loads.push(game.sceneManager.loadObject(obj));
    }
  }
  if (loads.length > 0) {
    await Promise.all(loads);
  }
  loadingTracker?.completeTask("multiplayer-scene-setup");

  game._extractSpawnPoints();
  if (NetworkManager.isHost()) {
    pushLevelSpawnsToServer(game);
  }

  // Pass level geometry to the automap
  const _mpLevelId = game.gameManager.getState().currentLevel;
  const _mpGeomRoot = _mpLevelId
    ? game.sceneManager.getGeometryRoot(`${_mpLevelId}LevelData`)
    : null;
  if (_mpGeomRoot) game.player.automap.setLevel(_mpGeomRoot);

  game.camera.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
  game.camera.quaternion.set(
    localPlayer.qx,
    localPlayer.qy,
    localPlayer.qz,
    localPlayer.qw,
  );

  NetworkManager.getPlayers().forEach(([sessionId, playerData]) => {
    if (sessionId !== NetworkManager.sessionId) {
      game.addRemotePlayer(sessionId, playerData);
    }
  });

  if (state?.botsEnabled) {
    await game.ensureEnemyShipAssetsLoaded();
    await ensureNetworkBotPool(game, state);
  }

  if (!game.input.mobile.shouldSkipPointerLock()) {
    document.body.requestPointerLock?.()?.catch?.(() => {
      console.warn("[Game] Pointer lock failed - click to capture");
    });
  }
  setHidePilotChrome(game, false);
  document.getElementById("crosshair").classList.add("active");
  document.getElementById("hud").classList.add("active");

  game.gameManager.setState({
    isRunning: true,
  });
  loadingTracker?.completeTask("multiplayer-player-setup");

  game.renderer.domElement.style.display = "block";

  (async () => {
    await waitForFirstViewReady(game);
    MenuManager.enterPlayingMode();
    hideFirstViewLoading();
  })();
}

export function addRemotePlayer(game, sessionId, playerData) {
  if (game.remotePlayers.has(sessionId)) return;

  const state = NetworkManager.getState();
  const remote = new RemotePlayer(
    game.scene,
    playerData,
    state?.mode === "team",
  );
  game.remotePlayers.set(sessionId, remote);
}

export function removeRemotePlayer(game, sessionId) {
  const remote = game.remotePlayers.get(sessionId);
  if (remote) {
    remote.dispose();
    game.remotePlayers.delete(sessionId);
  }
}

export function onMatchEnd(game) {
  document.exitPointerLock?.();
  document.getElementById("crosshair").classList.remove("active");
  document.getElementById("hud").classList.remove("active");
  MenuManager.show();

  game.cleanupMultiplayer();
}

export function cleanupMultiplayer(game) {
  game._mpWasAlive = undefined;
  game._levelSpawnCache = null;
  game._networkBotDissolveBatchSerial = undefined;
  game._networkBotPoolInitPromise = null;
  game.remotePlayers.forEach((remote) => remote.dispose());
  game.remotePlayers.clear();

  game.networkBots.forEach((entry) => parkNetworkBotEntry(entry));
  game.networkBots.clear();
  for (const entry of game._networkBotPool || []) {
    disposeNetworkBotEntry(game, entry);
  }
  game._networkBotPool = [];
  pendingNetworkBotAdds.clear();

  game.networkProjectiles.forEach((data) => {
    if (data.type === "missile") {
      data.obj.dispose(game.scene);
    } else {
      data.obj.dispose(game.scene);
    }
  });
  game.networkProjectiles.clear();

  game.collectibles.forEach((collectible) => collectible.dispose());
  game.collectibles.clear();

  if (game._missilePickups) {
    for (const pickup of game._missilePickups) {
      if (pickup.collectible) pickup.collectible.dispose();
    }
    game._missilePickups = null;
  }
  if (game._weaponPickups) {
    for (const pickup of game._weaponPickups) {
      pickup.collectible?.dispose?.();
    }
    game._weaponPickups = null;
  }
}
