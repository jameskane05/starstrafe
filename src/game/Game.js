/**
 * Game.js - MAIN GAME CONTAINER AND LOOP ORCHESTRATOR
 * =============================================================================
 *
 * ROLE: Central game object that holds scene, camera, renderer, managers, and
 * entity state. Coordinates init (via gameInit.js), update loop, and mode
 * switching between menu and play (solo/multiplayer).
 *
 * KEY RESPONSIBILITIES:
 * - Own references to GameManager, SceneManager, LightManager, input, player, level
 * - Delegate init to gameInit.js; run requestAnimationFrame loop with gameUpdate.tick
 * - Start solo play via gameSolo; multiplayer via gameMultiplayer (NetworkManager)
 * - Hold local state: enemies, projectiles, missiles, explosions, remote players
 * - Integrate Prediction for client-side prediction in multiplayer
 *
 * RELATED: gameInit.js, gameUpdate.js, gameSolo.js, gameMultiplayer.js, GameManager,
 * SceneManager, LightManager, NetworkManager, MenuManager.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { GAME_STATES } from "../data/gameData.js";
import NetworkManager from "../network/NetworkManager.js";
import MenuManager from "../ui/MenuManager.js";
import * as gameInGameUI from "./gameInGameUI.js";
import * as gameLevel from "./gameLevel.js";
import * as gameEnemies from "./gameEnemies.js";
import * as gameCombat from "./gameCombat.js";
import * as gameNetworkProjectiles from "./gameNetworkProjectiles.js";
import * as gamePlayerLifecycle from "./gamePlayerLifecycle.js";
import * as gameSolo from "./gameSolo.js";
import * as gameMultiplayer from "./gameMultiplayer.js";
import * as gameUpdate from "./gameUpdate.js";
import { Prediction } from "../network/Prediction.js";
import {
  getUnlockedPrimaryWeaponList,
  isPrimaryWeaponUnlocked,
  PRIMARY_WEAPONS,
  PRIMARY_WEAPON_LABELS,
} from "./weaponUnlocks.js";


export class Game {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.sparkRenderer = null;

    this.gameManager = null;
    this.sceneManager = null;
    this.lightManager = null;
    this.musicManager = null;
    this.particles = null;
    this.dynamicLights = null;

    this.input = null;
    this.player = null;
    this.level = null;
    this.enemies = [];
    this.enemyPortals = [];
    this.alliedShips = [];
    this.spawnPoints = [];
    /** Parallel to spawnPoints: true for `Enemy.* - Heavy` authored spawns. */
    this.enemySpawnHeavyFlags = null;
    /** Parallel to spawnPoints: true for `EnemyPortal*` authored spawns. */
    this.enemySpawnPortalFlags = null;
    /** Parallel to spawnPoints: world scale from authored Enemy markers (default 1). */
    this.enemySpawnScales = null;
    /** Parallel to spawnPoints: final ship scale (random × authored, stable per spawn). */
    this.enemySpawnShipScales = null;
    this.playerSpawnPoints = [];
    this.playerSpawnMarkerQuaternions = [];
    this.enemyRespawnQueue = [];
    this.trainingGoalPoints = [];
    this.trainingGoalQuaternions = [];
    this.weaponPickupPoints = [];
    this.projectiles = [];
    this.missiles = [];
    this.explosions = [];
    this.impacts = [];
    this.lastMissileTime = 0;
    this.missileCooldown = 0.4;
    this.lastLaserTime = 0;
    this.laserCooldown = 0.1;
    this.lastGatlingTime = 0;
    this.gatlingCooldown = 0.045;
    this.lastChargingLaserTime = -Infinity;
    this.chargingLaserCooldown = 1.6;
    this._primaryFireHeld = false;
    this.clock = new THREE.Clock();
    this.boundFireEnemy = (pos, dir, style) =>
      gameCombat.fireEnemyWeapon(this, pos, dir, style);
    this.boundFireAlly = (pos, dir, style) =>
      gameCombat.fireAllyWeapon(this, pos, dir, style);

    this.hud = null;
    this._hudLast = {
      health: null,
      missiles: null,
      boost: null,
      missilesEnabled: null,
    };
    this._hudAccum = 0;
    this.directionalHelperTarget = null;
    this.directionalHelperRoot = null;
    this._directionalHelperOpacity = 0;
    this._enemyReticleEnemy = null;
    this._spawnWarpPrewarmed = false;
    /** Alt+H: hide cockpit + HUD for unobstructed view; flight and weapons unchanged. */
    this.hidePilotChrome = false;
    /** @type {THREE.Vector3 | null} World position (trigger AABB center) for solo respawn after last level-trigger enter. */
    this._lastTriggerRespawnWorldPos = null;

    // Multiplayer state
    this.isMultiplayer = false;
    this.remotePlayers = new Map();
    this.networkProjectiles = new Map();
    this.networkBots = new Map();
    this._networkBotPool = [];
    this._networkBotPoolInitPromise = null;
    this.collectibles = new Map();
    this.isEscMenuOpen = false;
    this.escMenu = null;
    this.prediction = new Prediction({
      enabled: true,
      reconciliationThreshold: 0.5,
      smoothCorrection: true,
    });
    this.lastInputSeq = 0;

    // Track local missiles with their server IDs for homing sync
    this.localMissileQueue = []; // Missiles waiting to be linked to server IDs
    this.localMissileIds = new Map(); // serverId -> local missile

    this.xrManager = null;
    this._frameCount = 0;
    this.enemyShipAssetsPromise = null;
    this.projectileSplatLayer = null;
    this.missionManager = null;
    this.pendingMissionConfig = null;
    this.levelTriggerManager = null;
    this._levelTriggerVolumes = [];
  }

  async init() {
    const gameInit = await import("./gameInit.js");
    return gameInit.init(this);
  }

  async startSoloDebug() {
    return gameSolo.startSoloDebug(this);
  }

  async startTrainingGrounds(levelId = "newworld") {
    const levelDataId = `${levelId}LevelData`;
    if (this.sceneManager?.hasObject?.(levelDataId)) {
      this.sceneManager.removeObject(levelDataId);
    }
    this._levelSpawnCache = null;
    this.trainingGoalPoints = [];
    this.trainingGoalQuaternions = [];
    this.pendingMissionConfig = {
      missionId: "trainingGrounds",
      levelId,
    };
    this.gameManager.setState({
      currentLevel: levelId,
      missionLevelId: levelId,
    });
    return this.startSoloDebug();
  }

  async startCharonCampaign() {
    const levelId = "charon";
    const levelDataId = `${levelId}LevelData`;
    if (this.sceneManager?.hasObject?.(levelDataId)) {
      this.sceneManager.removeObject(levelDataId);
    }
    this._levelSpawnCache = null;
    this.trainingGoalPoints = [];
    this.trainingGoalQuaternions = [];
    this.pendingMissionConfig = {
      missionId: "charon",
      levelId,
    };
    this.gameManager.setState({
      currentLevel: levelId,
      missionLevelId: levelId,
    });
    return this.startSoloDebug();
  }

  async startSaturnaliaCampaign() {
    const levelId = "saturnalia";
    const levelDataId = `${levelId}LevelData`;
    if (this.sceneManager?.hasObject?.(levelDataId)) {
      this.sceneManager.removeObject(levelDataId);
    }
    this._levelSpawnCache = null;
    this.trainingGoalPoints = [];
    this.trainingGoalQuaternions = [];
    this.pendingMissionConfig = {
      missionId: "saturnalia",
      levelId,
    };
    this.gameManager.setState({
      currentLevel: levelId,
      missionLevelId: levelId,
    });
    return this.startSoloDebug();
  }

  async startEarthDefenseCampaign() {
    const levelId = "earthdefense";
    const levelDataId = `${levelId}LevelData`;
    if (this.sceneManager?.hasObject?.(levelDataId)) {
      this.sceneManager.removeObject(levelDataId);
    }
    this._levelSpawnCache = null;
    this.trainingGoalPoints = [];
    this.trainingGoalQuaternions = [];
    this.pendingMissionConfig = {
      missionId: "capital-ship-earth-defense",
      levelId,
    };
    this.gameManager.setState({
      currentLevel: levelId,
      missionLevelId: levelId,
    });
    return this.startSoloDebug();
  }

  async ensureEnemyShipAssetsLoaded() {
    return gameSolo.ensureEnemyShipAssetsLoaded(this);
  }

  setupNetworkListeners() {
    gameMultiplayer.setupNetworkListeners(this);
  }

  async preloadLevel() {
    return gameLevel.preloadLevel(this);
  }

  async loadLevelAndStart() {
    return gameLevel.loadLevelAndStart(this);
  }

  _extractSpawnPoints() {
    gameLevel.extractSpawnPoints(this);
  }

  _initProjectileSplatLayer() {
    gameCombat.initProjectileSplatLayer(this);
  }

  _createProjectileSplatLight(isPlayerOwned, visual) {
    return gameCombat.createProjectileSplatLight(this, isPlayerOwned, visual);
  }

  async startMultiplayerGame() {
    return gameMultiplayer.startMultiplayerGame(this);
  }

  addRemotePlayer(sessionId, playerData) {
    gameMultiplayer.addRemotePlayer(this, sessionId, playerData);
  }

  removeRemotePlayer(sessionId) {
    gameMultiplayer.removeRemotePlayer(this, sessionId);
  }

  spawnCollectible(id, data) {
    gameNetworkProjectiles.spawnCollectible(this, id, data);
  }

  removeCollectible(id) {
    gameNetworkProjectiles.removeCollectible(this, id);
  }

  handleCollectiblePickup(data) {
    gameNetworkProjectiles.handleCollectiblePickup(this, data);
  }

  showPickupMessage(text) {
    gameNetworkProjectiles.showPickupMessage(this, text);
  }

  showMissionCompleteOverlay(options = {}) {
    gameInGameUI.showMissionCompleteOverlay(this, options);
  }

  async continueToSaturnaliaCampaign() {
    const { handoffSoloCampaign } = await import("./gameSolo.js");
    return handoffSoloCampaign(this, "saturnalia", "saturnalia");
  }

  spawnNetworkProjectile(id, data) {
    gameNetworkProjectiles.spawnNetworkProjectile(this, id, data);
  }

  removeNetworkProjectile(id) {
    gameNetworkProjectiles.removeNetworkProjectile(this, id);
  }

  updateNetworkProjectile(id, projectile) {
    gameNetworkProjectiles.updateNetworkProjectile(this, id, projectile);
  }

  handleNetworkHit(data) {
    gameNetworkProjectiles.handleNetworkHit(this, data);
  }

  showDamageIndicator(hitWorldPos) {
    gamePlayerLifecycle.showDamageIndicator(this, hitWorldPos);
  }

  handleLocalPlayerDeath() {
    gamePlayerLifecycle.handleLocalPlayerDeath(this);
  }

  _startSoloRespawn() {
    gamePlayerLifecycle.startSoloRespawn(this);
  }

  _finishSoloRespawn() {
    gamePlayerLifecycle.finishSoloRespawn(this);
  }

  handleLocalPlayerRespawn(data) {
    gamePlayerLifecycle.handleLocalPlayerRespawn(this, data);
  }

  showKillFeed(killer, victim) {
    gamePlayerLifecycle.showKillFeed(this, killer, victim);
  }

  onMatchEnd() {
    gameMultiplayer.onMatchEnd(this);
  }

  cleanupMultiplayer() {
    gameMultiplayer.cleanupMultiplayer(this);
  }

  onStateChanged(newState, oldState) {
    if (
      newState.currentState === GAME_STATES.PLAYING &&
      oldState?.currentState !== GAME_STATES.PLAYING
    ) {
      this.dynamicSceneElementManager?.setElements([]);
    }
  }

  onGameStarted() {
    this.playerEngineTrails?.forEach((t) => t.clear());
    if (!this.isMultiplayer && !this.input.mobile.shouldSkipPointerLock()) {
      document.body.requestPointerLock?.()?.catch?.(() => {});
      document.getElementById("crosshair").classList.add("active");
      document.getElementById("hud").classList.add("active");
    }
  }

  onGameOver() {
    document.exitPointerLock?.();
    document.getElementById("crosshair").classList.remove("active");
    document.getElementById("hud").classList.remove("active");
    MenuManager.show();
  }

  onVictory() {
    document.exitPointerLock?.();
    document.getElementById("crosshair").classList.remove("active");
    document.getElementById("hud").classList.remove("active");
  }

  spawnEnemies() {
    gameEnemies.spawnEnemies(this);
  }

  _spawnMissilePickups() {
    gameEnemies.spawnMissilePickups(this);
  }

  _checkMissilePickups(playerPos, delta) {
    gameEnemies.checkMissilePickups(this, playerPos, delta);
  }

  spawnAtPoint(pos, spawnOpts = {}) {
    return gameEnemies.spawnAtPoint(this, pos, spawnOpts);
  }

  tickEnemyRespawns(delta) {
    gameEnemies.tickEnemyRespawns(this, delta);
  }

  start() {
    if (this.gameManager.isPlaying()) return;
    this.gameManager.startGame();
  }

  toggleEscMenu() {
    gameInGameUI.toggleEscMenu(this);
  }

  showEscMenu() {
    gameInGameUI.showEscMenu(this);
  }

  showOptionsMenu() {
    gameInGameUI.showOptionsMenu(this);
  }

  showLeaderboard() {
    gameInGameUI.showLeaderboard(this);
  }

  hideLeaderboard() {
    gameInGameUI.hideLeaderboard(this);
  }

  showControlsHelp(visible) {
    gameInGameUI.showControlsHelp(this, visible);
  }

  toggleHidePilotChrome() {
    gameInGameUI.toggleHidePilotChrome(this);
  }

  resumeGame() {
    gameInGameUI.resumeGame(this);
  }

  leaveMatch() {
    gameInGameUI.leaveMatch(this);
  }

  stop() {
    if (this.player && this.player.health <= 0) {
      this.gameManager.gameOver();
    } else {
      document.exitPointerLock?.();
      document.getElementById("crosshair").classList.remove("active");
      document.getElementById("hud").classList.remove("active");
      gameInGameUI.setHidePilotChrome(this, false);
      this.gameManager.setState({
        currentState: GAME_STATES.PAUSED,
        isRunning: false,
      });
    }
  }

  handleGamepadFire() {
    if (!this.input.isGamepadMode()) return;

    const gp = this.input.gamepad;
    this.setPrimaryFireHeld(gp.fire);
    if (gp.missileJustPressed) this.fireSelectedMissile();
    if (gp.kineticMissileJustPressed) {
      this.setMissileMode("kinetic");
      this.fireSelectedMissile();
    }
  }

  canFireLasers() {
    return this.gameManager?.getState?.()?.playerLaserEnabled !== false;
  }

  canFireMissiles() {
    return this.gameManager?.getState?.()?.playerMissilesEnabled !== false;
  }

  firePlayerWeapon() {
    if (!this.canFireLasers()) return false;
    return gameCombat.firePlayerWeapon(this, this.getSelectedPrimaryWeapon());
  }

  setPrimaryFireHeld(held) {
    const nextHeld = held === true;
    const wasHeld = this._primaryFireHeld === true;
    this._primaryFireHeld = nextHeld;
    if (nextHeld && !wasHeld) {
      this.firePlayerWeapon();
    }
    if (!nextHeld) {
      gameCombat.cancelChargingLaser(this);
    }
  }

  updatePrimaryFire(delta) {
    gameCombat.updatePrimaryWeaponState(this, delta);
    if (!this._primaryFireHeld) return;
    const selected = this.getSelectedPrimaryWeapon();
    if (
      selected === PRIMARY_WEAPONS.GATLING ||
      selected === PRIMARY_WEAPONS.CHARGING_LASER
    ) {
      this.firePlayerWeapon();
    }
  }

  getSelectedPrimaryWeapon() {
    const selected =
      this.gameManager?.getState?.()?.selectedPrimaryWeapon ??
      PRIMARY_WEAPONS.LASER;
    return isPrimaryWeaponUnlocked(selected) ? selected : PRIMARY_WEAPONS.LASER;
  }

  setPrimaryWeapon(mode) {
    const nextMode = isPrimaryWeaponUnlocked(mode) ? mode : PRIMARY_WEAPONS.LASER;
    const prevMode = this.getSelectedPrimaryWeapon();
    if (prevMode === nextMode) return false;
    this.gameManager?.setState({ selectedPrimaryWeapon: nextMode });
    this.player?.updateCockpitStatusDisplay?.({ primaryWeapon: nextMode });
    this.showPickupMessage?.(`PRIMARY: ${PRIMARY_WEAPON_LABELS[nextMode]}`);
    return true;
  }

  cyclePrimaryWeapon() {
    const unlocked = getUnlockedPrimaryWeaponList();
    const current = this.getSelectedPrimaryWeapon();
    const idx = unlocked.indexOf(current);
    const next = unlocked[(idx + 1) % unlocked.length] ?? PRIMARY_WEAPONS.LASER;
    return this.setPrimaryWeapon(next);
  }

  getSelectedMissileMode() {
    return this.gameManager?.getState?.()?.selectedMissileMode ?? "homing";
  }

  setMissileMode(mode) {
    const nextMode = mode === "kinetic" ? "kinetic" : "homing";
    const prevMode = this.getSelectedMissileMode();
    if (prevMode === nextMode) return false;
    this.gameManager?.setState({ selectedMissileMode: nextMode });
    this.missionManager?.reportEvent("missileModeSwitched", {
      previousMode: prevMode,
      mode: nextMode,
    });
    return true;
  }

  toggleMissileMode() {
    const nextMode =
      this.getSelectedMissileMode() === "kinetic" ? "homing" : "kinetic";
    return this.setMissileMode(nextMode);
  }

  cycleEnemyTargetReticle() {
    gameInGameUI.cycleEnemyTargetReticle(this);
  }

  fireSelectedMissile() {
    if (!this.canFireMissiles()) return false;
    return this.getSelectedMissileMode() === "kinetic"
      ? this.firePlayerKineticMissile()
      : this.firePlayerMissile();
  }

  firePlayerMissile() {
    if (!this.canFireMissiles()) return false;
    const fired = gameCombat.firePlayerMissile(this);
    if (fired) {
      this.missionManager?.reportEvent("missileFired", { mode: "homing" });
    }
    return fired;
  }

  firePlayerKineticMissile() {
    if (!this.canFireMissiles()) return false;
    const fired = gameCombat.firePlayerKineticMissile(this);
    if (fired) {
      this.missionManager?.reportEvent("missileFired", { mode: "kinetic" });
    }
    return fired;
  }

  fireEnemyWeapon(position, direction, style = null) {
    gameCombat.fireEnemyWeapon(this, position, direction, style);
  }

  updateHUD(delta) {
    gameInGameUI.updateHUD(this, delta);
  }

  sendInputToServer(delta) {
    if (!this.isMultiplayer || !this.player) return;

    const state = NetworkManager.getState();
    if (!state || state.phase !== "playing") return;

    const localPlayer = NetworkManager.getLocalPlayer();
    if (localPlayer) {
      const prevAlive = this._mpWasAlive;
      const aliveNow = localPlayer.alive;
      if (prevAlive === false && aliveNow === true) {
        this.camera.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
        this.camera.quaternion.set(
          localPlayer.qx,
          localPlayer.qy,
          localPlayer.qz,
          localPlayer.qw,
        );
        this.player.velocity.set(0, 0, 0);
        this.prediction?.applyServerState(
          { x: localPlayer.x, y: localPlayer.y, z: localPlayer.z },
          {
            x: localPlayer.qx,
            y: localPlayer.qy,
            z: localPlayer.qz,
            w: localPlayer.qw,
          },
          0,
        );
        this.prediction?.snapToServer(
          this.camera.position,
          this.camera.quaternion,
        );
      }
      this._mpWasAlive = aliveNow;
    }
    if (localPlayer && !localPlayer.alive) return;

    this.lastInputSeq = NetworkManager.sendInput({
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
      qx: this.camera.quaternion.x,
      qy: this.camera.quaternion.y,
      qz: this.camera.quaternion.z,
      qw: this.camera.quaternion.w,
      vx: this.player.velocity.x,
      vy: this.player.velocity.y,
      vz: this.player.velocity.z,
      dt: delta,
      boost: this.input.keys.boost || this.input.gamepad.boost,
    });
  }

  animate(timestamp, frame) {
    const delta = this.clock.getDelta();
    gameUpdate.tick(this, delta, timestamp, frame);
  }

  checkCollisions() {
    gameCombat.checkCollisions(this);
  }

  _updateBoostDoF(delta) {
    gameUpdate.updateBoostDoF(this, delta);
  }

  _updateBloomActive() {
    gameUpdate.updateBloomActive(this);
  }

  onResize() {
    gameUpdate.onResize(this);
  }
}
