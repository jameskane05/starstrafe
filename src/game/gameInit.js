/**
 * gameInit.js - GAME BOOTSTRAP AND SCENE SETUP
 * =============================================================================
 *
 * ROLE: One-time initialization of physics, Three.js scene, camera, renderer,
 * Spark renderer, managers, effects, and input. Creates GameManager, SceneManager,
 * LightManager, ParticleSystem, etc., and wires them to the Game instance.
 *
 * KEY RESPONSIBILITIES:
 * - Call initPhysics(); create scene, camera, WebGLRenderer, SparkRenderer
 * - Instantiate GameManager, SceneManager, LightManager, DynamicSceneElementManager
 * - Set up post-processing (bloom, FXAA), particle effects, engine trails, dynamic lights
 * - Create Input, MenuManager, NetworkManager; load menu/start screen; optional XR
 * - Platform detection and performance profile application
 *
 * RELATED: Physics.js, GameManager.js, SceneManager.js, LightManager.js, Input.js,
 * MenuManager.js, NetworkManager.js, ParticleSystem, gameData.js, performanceSettings.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SparkRenderer } from "@sparkjsdev/spark";
import { initPhysics } from "../physics/Physics.js";
import { Input } from "./Input.js";
import { Level } from "../world/Level.js";
import GameManager from "../managers/GameManager.js";
import SceneManager from "../managers/SceneManager.js";
import LightManager from "../managers/LightManager.js";
import { DynamicSceneElementManager } from "../managers/DynamicSceneElementManager.js";
import { GAME_STATES } from "../data/gameData.js";
import {
  getPerformanceProfile,
  IOS_MAX_PAGED_SPLATS,
} from "../data/performanceSettings.js";
import { ParticleSystem } from "../vfx/ParticleSystem.js";
import { ExplosionEffect } from "../vfx/effects/ExplosionEffect.js";
import { SparksEffect } from "../vfx/effects/SparksEffect.js";
import { TrailsEffect } from "../vfx/effects/TrailsEffect.js";
import { EngineTrail } from "../vfx/EngineTrail.js";
import { DynamicLightPool } from "../vfx/DynamicLightPool.js";
import GizmoManager from "../utils/GizmoManager.js";
import { detectPlatform } from "../utils/platformDetection.js";
import NetworkManager from "../network/NetworkManager.js";
import MenuManager from "../ui/MenuManager.js";
import LoadingProgressManager from "../ui/LoadingProgressManager.js";
import "./gameFirstViewLoading.js";
import * as gameInGameUI from "./gameInGameUI.js";
import * as gameUpdate from "./gameUpdate.js";
import * as gameMultiplayer from "./gameMultiplayer.js";
import MusicManager from "../audio/MusicManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import sfxManager from "../audio/sfxManager.js";
import sfxSounds from "../audio/sfxData.js";
import engineAudio from "../audio/EngineAudio.js";
import { XRManager } from "../xr/XRManager.js";
import { getDebugMissionSpawn } from "../utils/debugSpawner.js";
import { initCheckpointVisualPool } from "../missions/MissionManager.js";
import { LevelTriggerManager } from "./levelTriggerManager.js";

export async function init(game) {
  initPhysics();

  game.scene = new THREE.Scene();
  game.levelLoadingTracker = new LoadingProgressManager();
  game.scene.background = new THREE.Color(0x050510);
  game.scene.fog = null;

  game.camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  game.scene.add(game.camera);

  game.renderer = new THREE.WebGLRenderer({ antialias: true });
  // First draw of each shader program runs onFirstUse() → getProgramInfoLog when this is true.
  // Chrome often spends tens–hundreds of ms per program there (visible as stacked blocks in perf).
  // Set to `true` temporarily when debugging shader link errors.
  game.renderer.debug.checkShaderErrors = false;
  game.renderer.domElement.id = "game-canvas";
  game.renderer.domElement.style.display = "none";
  document.body.appendChild(game.renderer.domElement);

  game.renderer.domElement.addEventListener("click", () => {
    if (
      game.gameManager?.isPlaying() &&
      !game.isEscMenuOpen &&
      !document.pointerLockElement
    ) {
      game.renderer.domElement.requestPointerLock?.();
    }
  });

  game.gameManager = new GameManager();
  window.gameManager = game.gameManager;
  detectPlatform(game.gameManager);

  const perfProfile = game.gameManager.getPerformanceProfile();
  const useLowSplatLOD =
    game.gameManager.state.isIOS || game.gameManager.state.isVisionPro;
  const splatProfile = useLowSplatLOD
    ? getPerformanceProfile("low")
    : perfProfile;
  const splatSettings = splatProfile.splat ?? {};
  let maxPagedSplats = splatSettings.maxPagedSplats ?? 256 * 65536;
  if (game.gameManager.state.isIOS) {
    maxPagedSplats = Math.min(maxPagedSplats, IOS_MAX_PAGED_SPLATS);
  }

  // Spark DoF: focalDistance + apertureAngle (radians, full width). Max boost angle =
  // thin lens: 2 * atan((apertureDiameter/2) / focal) — must match focalDistance passed below.
  const boostDoFFocalDistance = 100;
  const boostDoFApertureSize = 0.4;
  const boostDoFApertureAngle =
    2 * Math.atan((0.5 * boostDoFApertureSize) / boostDoFFocalDistance);
  game.sparkRenderer = new SparkRenderer({
    renderer: game.renderer,
    maxStdDev: Math.sqrt(5),
    maxPagedSplats,
    pagedExtSplats: true,
    lodSplatScale: splatSettings.lodSplatScale ?? 1.0,
    lodRenderScale: splatSettings.lodRenderScale ?? 1.0,
    coneFov0: splatSettings.coneFov0 ?? 70.0,
    coneFov: splatSettings.coneFov ?? 120.0,
    behindFoveate: splatSettings.behindFoveate ?? 0.2,
    coneFoveate: splatSettings.coneFoveate ?? 0.4,
    focalDistance: boostDoFFocalDistance,
    apertureAngle: 0,
  });
  game._boostDoFApertureAngle = 0;
  game._boostDoFAngleMax = boostDoFApertureAngle;
  game.sparkRenderer.renderOrder = -100;
  game.scene.add(game.sparkRenderer);

  const state = game.gameManager.state;
  console.log("[Init] Splat & platform:", {
    maxPagedSplats,
    maxPagedSplatsHuman: `${maxPagedSplats / 65536}×65536`,
    useLowSplatLOD,
    isIOS: state.isIOS,
    isVisionPro: state.isVisionPro,
    isMobile: state.isMobile,
    isSafari: state.isSafari,
    perfProfile: perfProfile?.label ?? "default",
  });

  const renderSettings = perfProfile.rendering;
  game.renderer.setSize(window.innerWidth, window.innerHeight);
  game.renderer.setPixelRatio(renderSettings.pixelRatio);
  game.renderer.shadowMap.enabled = renderSettings.shadows;
  game.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (renderSettings.toneMapping) {
    game.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    game.renderer.toneMappingExposure = renderSettings.toneMappingExposure;
  }

  game.composer = new EffectComposer(game.renderer);
  game.composer.addPass(new RenderPass(game.scene, game.camera));
  game.fxaaPass = new FXAAPass();
  game.fxaaPass.enabled =
    game.gameManager.getSetting("antialiasingEnabled") !== false;
  game.composer.addPass(game.fxaaPass);

  const bloomStrength = game.gameManager.getSetting("bloomStrength") ?? 0.15;
  const bloomRadius = game.gameManager.getSetting("bloomRadius") ?? 0.4;
  const bloomThreshold = game.gameManager.getSetting("bloomThreshold") ?? 0.8;
  game.bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    bloomStrength,
    bloomRadius,
    bloomThreshold,
  );
  game.composer.addPass(game.bloomPass);
  game.composer.addPass(new OutputPass());

  const bloomUserSetting = game.gameManager.getSetting("bloomEnabled");
  game.bloomEnabled = bloomUserSetting ?? renderSettings.bloom ?? true;
  gameUpdate.updateBloomActive(game);

  game.gameManager.on("bloom:changed", (enabled) => {
    game.bloomEnabled = enabled;
    gameUpdate.updateBloomActive(game);
  });

  game.gameManager.on("bloom:settings", (settings) => {
    if (settings.strength !== undefined)
      game.bloomPass.strength = settings.strength;
    if (settings.radius !== undefined) game.bloomPass.radius = settings.radius;
    if (settings.threshold !== undefined)
      game.bloomPass.threshold = settings.threshold;
    gameUpdate.updateBloomActive(game);
  });

  game.gameManager.on("antialiasing:changed", (enabled) => {
    game.fxaaPass.enabled = enabled;
  });

  game.particles = new ParticleSystem(game.scene, perfProfile);
  window.particles = game.particles;
  game.explosionEffect = new ExplosionEffect(game.particles);
  game.sparksEffect = new SparksEffect(game.particles);
  game.trailsEffect = new TrailsEffect(game.particles);
  game.playerEngineTrails = [
    new EngineTrail(game.scene, {
      maxPoints: 64,
      trailTime: 1.8,
      width: 1,
      colorStart: 0xff4500,
      colorEnd: 0xffcc99,
      emissiveIntensity: 2.8,
    }),
    new EngineTrail(game.scene, {
      maxPoints: 64,
      trailTime: 1.8,
      width: 1,
      colorStart: 0xff4500,
      colorEnd: 0xffcc99,
      emissiveIntensity: 2.8,
    }),
  ];
  game.dynamicLights = new DynamicLightPool(game.scene, { size: 12 });

  game.gizmoManager = new GizmoManager(game.scene, game.camera, game.renderer);
  window.gizmoManager = game.gizmoManager;

  game.sceneManager = new SceneManager(game.scene, {
    renderer: game.renderer,
    sparkRenderer: game.sparkRenderer,
  });
  await game.gameManager.initialize({
    sceneManager: game.sceneManager,
    scene: game.scene,
    camera: game.camera,
    renderer: game.renderer,
  });

  game.lightManager = new LightManager(game.scene, {
    sceneManager: game.sceneManager,
    gameManager: game.gameManager,
  });

  game.dynamicSceneElementManager = new DynamicSceneElementManager({
    gameManager: game.gameManager,
    getGameTime: () =>
      game.isMultiplayer
        ? (NetworkManager.getState()?.matchTime ?? 0)
        : (game.clock?.elapsedTime ?? 0),
  });

  game.musicManager = new MusicManager();
  game.musicManager.setGameManager(game.gameManager);

  game.gameManager.on("state:changed", (newState, oldState) =>
    game.onStateChanged(newState, oldState),
  );
  game.gameManager.on("game:started", () => game.onGameStarted());
  game.gameManager.on("game:over", () => game.onGameOver());
  game.gameManager.on("game:victory", () => game.onVictory());

  game.xrManager = new XRManager(game.renderer);
  game.xrManager.onRightHandQuickTap = () => game.firePlayerWeapon();

  game.input = new Input(game);

  gameInGameUI.setup(game);

  game.levelTriggerManager = new LevelTriggerManager(game);

  game.level = new Level(game.scene);
  game.level.generate({ skipVisuals: true, skipPhysics: true });

  sfxManager.init(sfxSounds);

  const onResizeOrViewport = () => gameUpdate.onResize(game);
  window.addEventListener("resize", onResizeOrViewport);
  window.visualViewport?.addEventListener("resize", onResizeOrViewport);
  gameUpdate.onResize(game);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      proceduralAudio.resume();
      engineAudio.resume();
    } else {
      proceduralAudio.shieldRechargeStop();
      proceduralAudio.boosterRechargeStop();
    }
  });

  await MenuManager.init();
  MenuManager.on("gameStart", async () => await game.startMultiplayerGame());
  MenuManager.on("campaignStart", (missionId) => {
    if (missionId === "saturnalia-rhea") {
      return game.startSaturnaliaCampaign();
    }
    if (missionId === "capital-ship-earth-defense") {
      return game.startEarthDefenseCampaign();
    }
    return game.startCharonCampaign();
  });
  MenuManager.on("trainingGroundsStart", (levelId) =>
    game.startTrainingGrounds(levelId || "newworld"),
  );
  MenuManager.on("levelSelected", (level) => {
    game.gameManager.setState({ currentLevel: level });
  });

  game.setupNetworkListeners();

  game.gameManager.setState({ currentState: GAME_STATES.MENU });

  proceduralAudio.init();
  game.musicManager?.tryAutoplay();

  game._initProjectileSplatLayer();

  game._checkpointVisualPoolInitPromise = initCheckpointVisualPool(game);

  const params = new URLSearchParams(window.location.search);
  const debugMissionSpawn = getDebugMissionSpawn();
  if (debugMissionSpawn) {
    game.pendingMissionConfig = {
      missionId: debugMissionSpawn.missionId,
      levelId: debugMissionSpawn.levelId,
      ...(debugMissionSpawn.debugStepId
        ? { debugStepId: debugMissionSpawn.debugStepId }
        : {}),
      ...(debugMissionSpawn.debugSpawnIndex != null
        ? { debugSpawnIndex: debugMissionSpawn.debugSpawnIndex }
        : {}),
    };
    game.gameManager.setState({
      currentLevel: debugMissionSpawn.levelId,
      missionLevelId: debugMissionSpawn.levelId,
    });
    void game.startSoloDebug();
  } else if (params.has("solo")) {
    const mapLevel = params.get("map");
    const soloLevel = params.get("solo");
    const level =
      mapLevel && mapLevel !== "true"
        ? mapLevel
        : soloLevel && soloLevel !== "true" && soloLevel !== ""
          ? soloLevel
          : null;
    if (level) {
      game.gameManager.setState({ currentLevel: level });
    }
    console.log(
      "[Debug] Auto-starting solo match, level:",
      game.gameManager.getState().currentLevel,
    );
    game.startSoloDebug();
  }

  game.renderer.setAnimationLoop((timestamp, frame) =>
    game.animate(timestamp, frame),
  );
}
