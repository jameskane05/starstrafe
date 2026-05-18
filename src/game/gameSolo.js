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
import {
  loadShipModels,
  shipModels,
  reapplyShipMaterials,
} from "../entities/Enemy.js";
import { prefractureModelsAsync } from "../vfx/ShipDestruction.js";
import { prewarmSpawnWarp } from "../vfx/spawnWarp.js";
import { Missile } from "../entities/Missile.js";
import { KineticMissile } from "../entities/KineticMissile.js";
import { Projectile } from "../entities/Projectile.js";
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
  waitForFirstViewReady,
} from "./gameFirstViewLoading.js";
import { applyAuthoredPlayerSpawn } from "../utils/playerSpawnOrientation.js";

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
  });
  game.player.health = 100;
  game.player.maxHealth = 100;
  game.player.missiles = 6;
  game.player.maxMissiles = 6;
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

  if (missionConfig?.missionId === "trainingGrounds") {
    await gameEnemies.initTrainingMissionEnemyPool(game);
  } else if (missionConfig?.missionId === "charon") {
    game._charonInitialEnemyPositions =
      game.spawnPoints.length > 0
        ? game.spawnPoints.map((p) => p.clone())
        : [];
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
    missionConfig?.missionId === "saturnalia-rhea"
  ) {
    if (!applyAuthoredPlayerSpawn(game, debugSpawnIdx ?? 0)) {
      game.camera.position.set(0, 0, 0);
      game.player.velocity.set(0, 0, 0);
    }
  } else if (game.playerSpawnPoints.length > 0) {
    applyAuthoredPlayerSpawn(
      game,
      debugSpawnIdx ?? Math.floor(Math.random() * game.playerSpawnPoints.length),
    );
  }

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
  } else {
    if (game._missilePickups) {
      for (const pickup of game._missilePickups) {
        pickup.collectible?.dispose?.();
      }
      game._missilePickups = [];
    }
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
    MenuManager.enterPlayingMode();
    const debugSpawn = Boolean(
      game.gameManager?.getState?.()?.debugSpawnActive,
    );
    let charonIntroMod = null;
    if (missionId === "charon" && !debugSpawn) {
      charonIntroMod = await import("./charonIntroSequence.js");
      charonIntroMod.mountCharonOpeningOverlayBlack();
    }
    hideFirstViewLoading();
    if (missionId === "charon") {
      if (debugSpawn) {
        game.gameManager.setState({ charonIntroTextDone: true });
      } else {
        await charonIntroMod.runCharonIntroTypewriterAndFade(game);
      }
    }
  })();
}

export async function ensureEnemyShipAssetsLoaded(game, loadingTracker = null) {
  if (game.enemyShipAssetsPromise) {
    await game.enemyShipAssetsPromise;
    if (!game._spawnWarpPrewarmed) {
      prewarmEnemySpawnWarp(game);
    }
    loadingTracker?.completeTask("solo-enemy-assets");
    return;
  }
  game.enemyShipAssetsPromise = (async () => {
    await loadShipModels();
    await prefractureModelsAsync(shipModels);
    await reapplyShipMaterials(shipModels);
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
