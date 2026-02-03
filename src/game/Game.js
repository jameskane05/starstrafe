import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { initPhysics, stepWorld, castSphere } from "../physics/Physics.js";
import { Input } from "./Input.js";
import { Player } from "../entities/Player.js";
import { Enemy, loadShipModels } from "../entities/Enemy.js";
import { Projectile } from "../entities/Projectile.js";
import { Missile } from "../entities/Missile.js";
import { Explosion } from "../entities/Explosion.js";
import { LaserImpact } from "../entities/LaserImpact.js";
import { RemotePlayer } from "../entities/RemotePlayer.js";
import { Collectible } from "../entities/Collectible.js";
import { Level } from "../world/Level.js";
import GameManager from "../managers/GameManager.js";
import SceneManager from "../managers/SceneManager.js";
import LightManager from "../managers/LightManager.js";
import { GAME_STATES, SHIP_CLASSES } from "../data/gameData.js";
import { ParticleSystem } from "../vfx/ParticleSystem.js";
import { DynamicLightPool } from "../vfx/DynamicLightPool.js";
import NetworkManager from "../network/NetworkManager.js";
import MenuManager from "../ui/MenuManager.js";
import { Prediction } from "../network/Prediction.js";
import MusicManager from "../audio/MusicManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";

const _fireDir = new THREE.Vector3();
const _hitPos = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();

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
    this.projectiles = [];
    this.missiles = [];
    this.explosions = [];
    this.impacts = [];
    this.lastMissileTime = 0;
    this.missileCooldown = 0.4;
    this.clock = new THREE.Clock();
    this.boundFireEnemy = (pos, dir) => this.fireEnemyWeapon(pos, dir);

    this.hud = null;
    this._hudLast = { health: null, kills: null, missiles: null, boost: null };
    this._hudAccum = 0;

    // Multiplayer state
    this.isMultiplayer = false;
    this.remotePlayers = new Map();
    this.networkProjectiles = new Map();
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
  }

  async init() {
    initPhysics();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);
    this.scene.fog = null;

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.renderer.domElement.id = "game-canvas";
    this.renderer.domElement.style.display = "none"; // Hidden until gameplay starts
    document.body.appendChild(this.renderer.domElement);
    
    // Click canvas to re-acquire pointer lock when playing
    this.renderer.domElement.addEventListener("click", () => {
      if (this.gameManager?.isPlaying() && !this.isEscMenuOpen && !document.pointerLockElement) {
        this.renderer.domElement.requestPointerLock?.();
      }
    });

    this.sparkRenderer = new SparkRenderer({
      renderer: this.renderer,
      maxStdDev: Math.sqrt(8),
      minAlpha: 0.00033,
    });
    this.sparkRenderer.renderOrder = -100;
    this.scene.add(this.sparkRenderer);

    this.particles = new ParticleSystem(this.scene);
    window.particles = this.particles;
    this.dynamicLights = new DynamicLightPool(this.scene, { size: 12 });

    this.sceneManager = new SceneManager(this.scene, {
      renderer: this.renderer,
      sparkRenderer: this.sparkRenderer,
    });

    this.gameManager = new GameManager();
    await this.gameManager.initialize({
      sceneManager: this.sceneManager,
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
    });

    this.lightManager = new LightManager(this.scene, {
      sceneManager: this.sceneManager,
      gameManager: this.gameManager,
    });

    this.musicManager = new MusicManager();
    this.musicManager.setGameManager(this.gameManager);

    this.gameManager.on("state:changed", (newState, oldState) =>
      this.onStateChanged(newState, oldState)
    );
    this.gameManager.on("game:started", () => this.onGameStarted());
    this.gameManager.on("game:over", () => this.onGameOver());
    this.gameManager.on("game:victory", () => this.onVictory());

    this.input = new Input(this);

    this.hud = {
      health: document.getElementById("health"),
      kills: document.getElementById("kills"),
      missiles: document.getElementById("missiles"),
      boost: document.getElementById("boost"),
    };

    this.level = new Level(this.scene);
    this.level.generate({ skipVisuals: true, skipPhysics: true });

    await loadShipModels();

    window.addEventListener("resize", () => this.onResize());

    // Initialize menu and network listeners
    await MenuManager.init();
    MenuManager.on("gameStart", () => this.startMultiplayerGame());
    
    this.setupNetworkListeners();

    this.gameManager.setState({ currentState: GAME_STATES.MENU });

    this.animate();
  }

  setupNetworkListeners() {
    // Preload level as soon as player joins a room (lobby)
    NetworkManager.on("roomJoined", () => {
      this.preloadLevel();
    });

    NetworkManager.on("playerJoin", ({ player, sessionId, isLocal }) => {
      if (!isLocal && this.isMultiplayer) {
        this.addRemotePlayer(sessionId, player);
      }
    });

    NetworkManager.on("playerLeave", ({ sessionId }) => {
      this.removeRemotePlayer(sessionId);
    });

    NetworkManager.on("playerUpdate", ({ player, sessionId, isLocal }) => {
      if (!isLocal && this.remotePlayers.has(sessionId)) {
        const remote = this.remotePlayers.get(sessionId);
        remote.updateFromServer(player);
      } else if (isLocal && this.player) {
        // Sync health/missiles from server (source of truth)
        this.player.health = player.health;
        this.player.maxHealth = player.maxHealth;
        this.player.missiles = player.missiles;
        this.player.maxMissiles = player.maxMissiles;
        this.player.hasLaserUpgrade = player.hasLaserUpgrade;
        
        // Server reconciliation for position
        const lastProcessed = player.lastProcessedInput;
        if (lastProcessed > 0) {
          this.prediction.applyServerState(
            { x: player.x, y: player.y, z: player.z },
            { x: player.qx, y: player.qy, z: player.qz, w: player.qw },
            lastProcessed
          );
          NetworkManager.clearProcessedInputs(lastProcessed);
        }
      }
    });

    NetworkManager.on("projectileSpawn", ({ projectile, id }) => {
      console.log("[Game] Projectile spawn event:", id, "owner:", projectile.ownerId, "isLocal:", projectile.ownerId === NetworkManager.sessionId);
      if (projectile.ownerId !== NetworkManager.sessionId) {
        this.spawnNetworkProjectile(id, projectile);
      } else if (projectile.type === "missile") {
        // Link our local missile to this server ID for homing sync
        // Filter out any already-disposed missiles from queue first
        while (this.localMissileQueue.length > 0 && this.localMissileQueue[0].disposed) {
          this.localMissileQueue.shift();
        }
        const localMissile = this.localMissileQueue.shift();
        if (localMissile && !localMissile.disposed) {
          this.localMissileIds.set(id, localMissile);
          console.log("[Game] Linked local missile to server ID:", id);
        }
      }
    });

    NetworkManager.on("projectileRemove", ({ id }) => {
      this.removeNetworkProjectile(id);
    });

    NetworkManager.on("projectileUpdate", ({ projectile, id }) => {
      this.updateNetworkProjectile(id, projectile);
    });

    NetworkManager.on("collectibleSpawn", ({ collectible, id }) => {
      this.spawnCollectible(id, collectible);
    });

    NetworkManager.on("collectibleRemove", ({ id }) => {
      this.removeCollectible(id);
    });

    NetworkManager.on("hit", (data) => {
      this.handleNetworkHit(data);
    });

    NetworkManager.on("kill", (data) => {
      this.showKillFeed(data.killerName, data.victimName);
      
      // Create a big explosion at the victim's position
      let victimPos = null;
      if (data.victimId === NetworkManager.sessionId) {
        // Local player died
        victimPos = this.camera.position.clone();
        this.handleLocalPlayerDeath();
      } else {
        // Remote player died
        const remote = this.remotePlayers.get(data.victimId);
        if (remote && remote.mesh) {
          victimPos = remote.mesh.position.clone();
        }
        // We got a kill!
        if (data.killerId === NetworkManager.sessionId) {
          proceduralAudio.killConfirm();
        }
      }
      
      // Spawn big player death explosion
      if (victimPos) {
        const explosion = new Explosion(
          this.scene,
          victimPos,
          0xff4400,
          this.dynamicLights,
          { big: true }
        );
        this.explosions.push(explosion);
        proceduralAudio.explosion(true);
        
        // Add massive particle explosion
        if (this.particles) {
          this.particles.emitExplosionParticles(victimPos, { r: 1, g: 0.4, b: 0.1 }, 80);
        }
      }
    });

    NetworkManager.on("respawn", (data) => {
      if (data.playerId === NetworkManager.sessionId) {
        this.handleLocalPlayerRespawn();
        proceduralAudio.respawn();
      }
    });

    NetworkManager.on("stateChange", (state) => {
      if (state.phase === "results") {
        this.onMatchEnd();
      }
    });

    NetworkManager.on("collectiblePickup", (data) => {
      this.handleCollectiblePickup(data);
    });
  }

  /**
   * Preload level assets in the background (called when joining lobby)
   */
  async preloadLevel() {
    // Don't preload if already loading or loaded
    if (this.isLoadingLevel || this.sceneManager.hasObject("level")) {
      return;
    }
    
    console.log("[Game] Preloading level...");
    this.isLoadingLevel = true;
    
    try {
      const sceneData = await import("../data/sceneData.js");
      const levelData = sceneData.sceneObjects?.level || sceneData.default?.level;
      
      if (levelData) {
        // Start loading but don't block - SceneManager handles deduplication
        await this.sceneManager.loadObject(levelData, (progress) => {
          console.log(`[Game] Preload progress: ${Math.round(progress * 100)}%`);
        });
        console.log("[Game] Level preloaded successfully");
      }
    } catch (err) {
      console.error("[Game] Level preload failed:", err);
    }
    
    this.isLoadingLevel = false;
  }

  async loadLevelAndStart() {
    // Set state to PLAYING
    this.gameManager.setState({ 
      currentState: GAME_STATES.PLAYING,
      currentLevel: "hangar"
    });
    
    // Wait for level if still loading from preload, or load now if not started
    if (!this.sceneManager.hasObject("level")) {
      console.log("[Game] Waiting for level to load...");
      try {
        const sceneData = await import("../data/sceneData.js");
        const levelData = sceneData.sceneObjects?.level || sceneData.default?.level;
        
        if (levelData) {
          // SceneManager deduplicates - if preload started, this awaits that promise
          await this.sceneManager.loadObject(levelData, (progress) => {
            MenuManager.updateLoadingProgress(progress);
          });
          console.log("[Game] Level loaded successfully");
        }
      } catch (err) {
        console.error("[Game] Level load failed:", err);
      }
    } else {
      console.log("[Game] Level already preloaded");
    }
    
    MenuManager.loadingComplete();
  }

  startMultiplayerGame() {
    this.isMultiplayer = true;
    
    // Show game canvas
    this.renderer.domElement.style.display = "block";
    
    const state = NetworkManager.getState();
    const localPlayer = NetworkManager.getLocalPlayer();
    
    if (!localPlayer) return;

    const classStats = SHIP_CLASSES[localPlayer.shipClass] || SHIP_CLASSES.fighter;
    
    this.player = new Player(this.camera, this.input, this.level, this.scene);
    this.player.health = localPlayer.health;
    this.player.maxHealth = localPlayer.maxHealth;
    this.player.missiles = localPlayer.missiles;
    this.player.maxMissiles = localPlayer.maxMissiles || classStats.maxMissiles;
    this.player.hasLaserUpgrade = localPlayer.hasLaserUpgrade || false;
    this.player.acceleration = classStats.acceleration;
    this.player.maxSpeed = classStats.maxSpeed;

    this.camera.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
    this.camera.quaternion.set(localPlayer.qx, localPlayer.qy, localPlayer.qz, localPlayer.qw);

    // Create remote players for others already in the room
    NetworkManager.getPlayers().forEach(([sessionId, playerData]) => {
      if (sessionId !== NetworkManager.sessionId) {
        this.addRemotePlayer(sessionId, playerData);
      }
    });

    document.body.requestPointerLock?.()?.catch?.(() => {
      console.warn("[Game] Pointer lock failed - click to capture");
    });
    document.getElementById("crosshair").classList.add("active");
    document.getElementById("hud").classList.add("active");
    MenuManager.hide();

    this.gameManager.setState({
      currentState: GAME_STATES.PLAYING,
      isRunning: true,
      isMultiplayer: true,
    });
  }

  addRemotePlayer(sessionId, playerData) {
    if (this.remotePlayers.has(sessionId)) return;

    const state = NetworkManager.getState();
    const remote = new RemotePlayer(
      this.scene,
      playerData,
      state?.mode === "team"
    );
    this.remotePlayers.set(sessionId, remote);
  }

  removeRemotePlayer(sessionId) {
    const remote = this.remotePlayers.get(sessionId);
    if (remote) {
      remote.dispose();
      this.remotePlayers.delete(sessionId);
    }
  }

  spawnCollectible(id, data) {
    if (this.collectibles.has(id)) return;
    
    const collectible = new Collectible(this.scene, data, this.dynamicLights);
    this.collectibles.set(id, collectible);
    console.log(`[Game] Spawned collectible: ${id} (${data.type})`);
  }

  removeCollectible(id) {
    const collectible = this.collectibles.get(id);
    if (collectible) {
      collectible.dispose();
      this.collectibles.delete(id);
      console.log(`[Game] Removed collectible: ${id}`);
    }
  }

  handleCollectiblePickup(data) {
    const collectible = this.collectibles.get(data.collectibleId);
    
    if (collectible) {
      collectible.playPickupEffect();
      
      // Add particle burst at pickup location
      if (this.particles) {
        const pos = { x: data.x, y: data.y, z: data.z };
        const color = data.type === "missile" 
          ? { r: 1, g: 0.4, b: 0 }
          : { r: 0, g: 1, b: 0.3 };
        this.particles.emitHitSparks(pos, color, 30);
      }
    }
    
    // Update local player if they picked it up
    if (data.playerId === NetworkManager.sessionId && this.player) {
      proceduralAudio.collectPickup();
      if (data.type === "laser_upgrade") {
        this.player.hasLaserUpgrade = true;
        this.showPickupMessage("LASER UPGRADE ACQUIRED");
      } else if (data.type === "missile") {
        this.showPickupMessage("MISSILES REFILLED");
      }
    }
  }

  showPickupMessage(text) {
    const existing = document.querySelector(".pickup-message");
    if (existing) existing.remove();
    
    const msg = document.createElement("div");
    msg.className = "pickup-message";
    msg.textContent = text;
    document.body.appendChild(msg);
    
    setTimeout(() => msg.classList.add("visible"), 10);
    setTimeout(() => {
      msg.classList.remove("visible");
      setTimeout(() => msg.remove(), 300);
    }, 2000);
  }

  spawnNetworkProjectile(id, data) {
    console.log("[Game] Spawning network projectile:", id, "type:", data.type, "pos:", data.x, data.y, data.z, "dir:", data.dx, data.dy, data.dz, "speed:", data.speed);
    const position = new THREE.Vector3(data.x, data.y, data.z);
    const direction = new THREE.Vector3(data.dx, data.dy, data.dz);

    if (data.type === "missile") {
      const missile = new Missile(this.scene, position, direction, {
        particles: this.particles,
      });
      this.networkProjectiles.set(id, { type: "missile", obj: missile });
    } else {
      // Other player projectiles should be visible as player (cyan) projectiles, not enemy (orange)
      const projectile = new Projectile(this.scene, position, direction, true, data.speed);
      this.networkProjectiles.set(id, { type: "projectile", obj: projectile });
    }
  }

  removeNetworkProjectile(id) {
    const data = this.networkProjectiles.get(id);
    if (data) {
      if (data.type === "missile") {
        data.obj.dispose(this.scene);
      } else {
        data.obj.dispose(this.scene);
      }
      this.networkProjectiles.delete(id);
    }
  }

  updateNetworkProjectile(id, projectile) {
    const data = this.networkProjectiles.get(id);
    if (!data) return;
    
    console.log("[Game] Updating network projectile:", id, "pos:", projectile.x.toFixed(1), projectile.y.toFixed(1), projectile.z.toFixed(1));
    
    // Update position and direction from server (for homing missiles)
    if (data.type === "missile") {
      data.obj.group.position.set(projectile.x, projectile.y, projectile.z);
      data.obj.direction.set(projectile.dx, projectile.dy, projectile.dz).normalize();
      // Update visual rotation to match direction
      const forward = new THREE.Vector3(0, 0, 1);
      data.obj.group.quaternion.setFromUnitVectors(forward, data.obj.direction);
    } else {
      data.obj.mesh.position.set(projectile.x, projectile.y, projectile.z);
      data.obj.direction.set(projectile.dx, projectile.dy, projectile.dz).normalize();
    }
  }

  handleNetworkHit(data) {
    console.log("[Game] Network hit received:", data);
    const hitPos = new THREE.Vector3(data.x, data.y, data.z);
    const hitNormal = new THREE.Vector3(0, 1, 0);
    
    // Determine hit color based on who shot
    const isOurShot = data.shooterId === NetworkManager.sessionId;
    const hitColor = isOurShot ? 0x00ffff : 0xff8800;
    
    const impact = new LaserImpact(
      this.scene,
      hitPos,
      hitNormal,
      hitColor,
      this.dynamicLights
    );
    this.impacts.push(impact);

    // Add spark effects on hit
    if (this.particles) {
      const sparkColor = isOurShot 
        ? { r: 0, g: 0.9, b: 1 }
        : { r: 1, g: 0.5, b: 0.1 };
      this.particles.emitHitSparks(hitPos, sparkColor, 25);
    }

    // Remove local projectile near hit position (if we fired it)
    if (isOurShot) {
      // Check laser projectiles
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const proj = this.projectiles[i];
        if (proj.isPlayerOwned && proj.mesh.position.distanceToSquared(hitPos) < 25) {
          proj.dispose(this.scene);
          this.projectiles.splice(i, 1);
          break;
        }
      }
      
      // Check missiles
      for (let i = this.missiles.length - 1; i >= 0; i--) {
        const missile = this.missiles[i];
        if (missile.getPosition().distanceToSquared(hitPos) < 36) {
          const explosion = new Explosion(
            this.scene,
            missile.getPosition(),
            0xff4400,
            this.dynamicLights
          );
          this.explosions.push(explosion);
          missile.dispose(this.scene);
          this.missiles.splice(i, 1);
          break;
        }
      }
    }

    // Update remote player health visual
    if (data.targetId !== NetworkManager.sessionId) {
      const remote = this.remotePlayers.get(data.targetId);
      if (remote) {
        remote.takeDamage(data.damage);
      }
    } else {
      // Local player took damage
      console.log("[Game] Local player took damage, showing vignette");
      this.player.health -= data.damage;
      this.player.lastDamageTime = this.clock.elapsedTime;
      this.showDamageIndicator(hitPos);
      proceduralAudio.shieldHit();
    }
  }

  showDamageIndicator(hitWorldPos) {
    const camPos = this.camera.position.clone();
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    
    const toHit = hitWorldPos.clone().sub(camPos).normalize();
    
    // Get camera's right and up vectors
    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    camRight.crossVectors(camDir, this.camera.up).normalize();
    camUp.crossVectors(camRight, camDir).normalize();
    
    // Project hit direction onto camera plane
    const dotRight = toHit.dot(camRight);
    const dotUp = toHit.dot(camUp);
    const dotForward = toHit.dot(camDir);
    
    // Determine which indicators to show based on hit direction
    const indicators = [];
    const threshold = 0.3;
    
    if (dotForward < 0.5) {
      // Hit came from side/behind
      if (dotRight > threshold) indicators.push('right');
      if (dotRight < -threshold) indicators.push('left');
      if (dotUp > threshold) indicators.push('top');
      if (dotUp < -threshold) indicators.push('bottom');
    }
    
    // Always show center vignette for any hit
    indicators.push('center');
    
    // Activate the indicators
    indicators.forEach(dir => {
      const el = document.querySelector(`.damage-indicator-${dir}`);
      if (el) {
        el.classList.remove('fading');
        el.classList.add('active');
        
        setTimeout(() => {
          el.classList.remove('active');
          el.classList.add('fading');
        }, 80);
        
        setTimeout(() => {
          el.classList.remove('fading');
        }, 450);
      }
    });
  }

  handleLocalPlayerDeath() {
    const overlay = document.getElementById("respawn-overlay");
    overlay.classList.add("active");
    
    let timeLeft = 5;
    const timerEl = document.getElementById("respawn-time");
    timerEl.textContent = timeLeft;
    
    const interval = setInterval(() => {
      timeLeft--;
      timerEl.textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(interval);
      }
    }, 1000);
  }

  handleLocalPlayerRespawn() {
    const overlay = document.getElementById("respawn-overlay");
    overlay.classList.remove("active");

    const localPlayer = NetworkManager.getLocalPlayer();
    if (localPlayer && this.player) {
      this.player.health = localPlayer.health;
      this.player.maxHealth = localPlayer.maxHealth;
      this.player.missiles = localPlayer.missiles;
      this.player.lastDamageTime = 0;
      this.camera.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
      this.camera.quaternion.set(localPlayer.qx, localPlayer.qy, localPlayer.qz, localPlayer.qw);
      
      // Force HUD update
      this._hudLast.health = null;
      this._hudLast.missiles = null;
    }
  }

  showKillFeed(killer, victim) {
    const feed = document.getElementById("kill-feed");
    const entry = document.createElement("div");
    entry.className = "kill-entry";
    entry.innerHTML = `<span class="killer">${killer}</span> → <span class="victim">${victim}</span>`;
    feed.appendChild(entry);
    
    setTimeout(() => entry.remove(), 5000);
  }

  onMatchEnd() {
    document.exitPointerLock();
    document.getElementById("crosshair").classList.remove("active");
    document.getElementById("hud").classList.remove("active");
    MenuManager.show();

    this.cleanupMultiplayer();
  }

  cleanupMultiplayer() {
    this.remotePlayers.forEach((remote) => remote.dispose());
    this.remotePlayers.clear();
    
    this.networkProjectiles.forEach((data) => {
      if (data.type === "missile") {
        data.obj.dispose(this.scene);
      } else {
        data.obj.dispose(this.scene);
      }
    });
    this.networkProjectiles.clear();

    this.collectibles.forEach((collectible) => collectible.dispose());
    this.collectibles.clear();
  }

  onStateChanged(newState, oldState) {}

  onGameStarted() {
    if (!this.isMultiplayer) {
      document.body.requestPointerLock?.()?.catch?.(() => {});
      document.getElementById("crosshair").classList.add("active");
      document.getElementById("hud").classList.add("active");
    }
  }

  onGameOver() {
    document.exitPointerLock();
    document.getElementById("crosshair").classList.remove("active");
    document.getElementById("hud").classList.remove("active");
    MenuManager.show();
  }

  onVictory() {
    document.exitPointerLock();
    document.getElementById("crosshair").classList.remove("active");
    document.getElementById("hud").classList.remove("active");
  }

  spawnEnemies() {
    const spawnPoints = this.level.getEnemySpawnPoints();
    spawnPoints.forEach((pos) => {
      const enemy = new Enemy(this.scene, pos, this.level);
      this.enemies.push(enemy);
    });
    this.gameManager.setState({ enemiesRemaining: this.enemies.length });
    this.updateHUD();
  }

  start() {
    if (this.gameManager.isPlaying()) return;
    this.gameManager.startGame();
  }

  toggleEscMenu() {
    if (this.isEscMenuOpen) {
      this.resumeGame();
    } else if (document.pointerLockElement) {
      // First escape: just release pointer lock
      document.exitPointerLock();
    } else {
      // Second escape (pointer already unlocked): show menu
      this.showEscMenu();
    }
  }

  showEscMenu() {
    if (this.isEscMenuOpen) return;
    this.isEscMenuOpen = true;
    document.exitPointerLock();
    document.getElementById("crosshair").classList.remove("active");
    
    if (!this.escMenu) {
      this.escMenu = document.createElement("div");
      this.escMenu.id = "esc-menu";
      document.body.appendChild(this.escMenu);
    }
    
    this.escMenu.innerHTML = `
      <div class="esc-overlay"></div>
      <div class="esc-content">
        <h2>MENU</h2>
        <div class="esc-buttons">
          <button id="esc-resume" class="esc-btn">RESUME</button>
          <button id="esc-options" class="esc-btn">OPTIONS</button>
          <button id="esc-leave" class="esc-btn esc-btn-danger">LEAVE MATCH</button>
        </div>
      </div>
    `;
    
    document.getElementById("esc-resume").addEventListener("click", () => this.resumeGame());
    document.getElementById("esc-options").addEventListener("click", () => this.showOptionsMenu());
    document.getElementById("esc-leave").addEventListener("click", () => this.leaveMatch());
    
    this.escMenu.style.display = "flex";
  }

  showOptionsMenu() {
    if (this.escMenu) {
      this.escMenu.style.display = "none";
    }
    this.inOptions = true;
    MenuManager.showOptionsFromGame(() => {
      this.inOptions = false;
      if (this.isEscMenuOpen && this.escMenu) {
        this.escMenu.style.display = "flex";
      }
    });
  }

  showLeaderboard() {
    if (!this.leaderboardEl) {
      this.leaderboardEl = document.createElement("div");
      this.leaderboardEl.id = "tab-leaderboard";
      document.body.appendChild(this.leaderboardEl);
    }
    
    const players = NetworkManager.getPlayers()
      .map(([id, p]) => ({ id, name: p.name, kills: p.kills, deaths: p.deaths }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    
    this.leaderboardEl.innerHTML = `
      <div class="leaderboard">
        <h2>LEADERBOARD</h2>
        <div class="leaderboard-header">
          <span class="lb-rank">#</span>
          <span class="lb-name">PILOT</span>
          <span class="lb-kills">K</span>
          <span class="lb-deaths">D</span>
        </div>
        ${players.map((p, i) => `
          <div class="leaderboard-row ${p.id === NetworkManager.sessionId ? 'local' : ''}">
            <span class="lb-rank">${i + 1}</span>
            <span class="lb-name">${p.name}</span>
            <span class="lb-kills">${p.kills}</span>
            <span class="lb-deaths">${p.deaths}</span>
          </div>
        `).join('')}
      </div>
    `;
    
    this.leaderboardEl.classList.add("active");
  }

  hideLeaderboard() {
    if (this.leaderboardEl) {
      this.leaderboardEl.classList.remove("active");
    }
  }

  resumeGame() {
    if (!this.isEscMenuOpen) return;
    this.isEscMenuOpen = false;
    
    if (this.escMenu) {
      this.escMenu.style.display = "none";
    }
    
    document.getElementById("crosshair").classList.add("active");
    
    // Request pointer lock on the canvas
    const canvas = this.renderer.domElement;
    canvas.requestPointerLock?.()?.catch?.(() => {
      // Pointer lock requires user gesture - add click listener
      const clickToLock = () => {
        canvas.requestPointerLock?.();
        canvas.removeEventListener("click", clickToLock);
      };
      canvas.addEventListener("click", clickToLock);
    });
  }

  leaveMatch() {
    this.isEscMenuOpen = false;
    
    if (this.escMenu) {
      this.escMenu.style.display = "none";
    }
    
    if (this.isMultiplayer) {
      NetworkManager.leaveRoom();
      this.cleanupMultiplayer();
      this.isMultiplayer = false;
    }
    
    // Hide game canvas when returning to menu
    this.renderer.domElement.style.display = "none";
    
    document.getElementById("crosshair").classList.remove("active");
    document.getElementById("hud").classList.remove("active");
    this.player = null;
    MenuManager.show();
    this.gameManager.setState({
      currentState: GAME_STATES.MENU,
      isRunning: false,
      isMultiplayer: false,
    });
  }

  stop() {
    if (this.player && this.player.health <= 0) {
      this.gameManager.gameOver();
    } else {
      document.exitPointerLock();
      document.getElementById("crosshair").classList.remove("active");
      document.getElementById("hud").classList.remove("active");
      this.gameManager.setState({
        currentState: GAME_STATES.PAUSED,
        isRunning: false,
      });
    }
  }

  handleGamepadFire() {
    if (!this.input.isGamepadMode()) return;
    
    const gp = this.input.gamepad;
    if (gp.fire) {
      this.firePlayerWeapon();
    }
    if (gp.missile) {
      this.firePlayerMissile();
    }
  }

  firePlayerWeapon() {
    if (!this.gameManager.isPlaying()) return;

    _fireDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const spawnPos = this.player.getWeaponSpawnPoint();

    if (this.isMultiplayer) {
      // Send fire event to server
      NetworkManager.sendFire("laser", spawnPos, _fireDir);
    }

    // Local prediction - show projectile immediately
    const projectile = new Projectile(this.scene, spawnPos, _fireDir, true);
    this.projectiles.push(projectile);

    proceduralAudio.laserFire();

    this.dynamicLights?.flash(spawnPos, 0x00ffff, {
      intensity: 10,
      distance: 16,
      ttl: 0.05,
      fade: 0.12,
    });
  }

  firePlayerMissile() {
    if (!this.gameManager.isPlaying()) return;
    if (this.player.missiles <= 0) return;

    const now = this.clock.elapsedTime;
    if (now - this.lastMissileTime < this.missileCooldown) return;
    this.lastMissileTime = now;

    this.player.missiles--;

    _fireDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const spawnPos = this.player.getMissileSpawnPoint();

    const missile = new Missile(this.scene, spawnPos, _fireDir, {
      particles: this.particles,
    });
    this.missiles.push(missile);

    proceduralAudio.missileFire();

    if (this.isMultiplayer) {
      NetworkManager.sendFire("missile", spawnPos, _fireDir);
      // Add to queue to link with server ID when we receive projectileSpawn
      this.localMissileQueue.push(missile);
    }

    this.dynamicLights?.flash(spawnPos, 0xffaa33, {
      intensity: 14,
      distance: 20,
      ttl: 0.07,
      fade: 0.16,
    });
  }

  fireEnemyWeapon(position, direction) {
    const projectile = new Projectile(
      this.scene,
      position.clone(),
      direction,
      false
    );
    this.projectiles.push(projectile);
  }

  updateHUD(delta) {
    if (!this.hud || !this.player) return;

    this._hudAccum += delta;
    if (this._hudAccum < 0.1) return;
    this._hudAccum = 0;

    const healthPercent = Math.max(0, Math.round((this.player.health / this.player.maxHealth) * 100));
    const missiles = this.player.missiles;
    const boostPercent = Math.max(0, Math.round((this.player.boostFuel / this.player.maxBoostFuel) * 100));
    
    let kills = 0;
    if (this.isMultiplayer) {
      const localPlayer = NetworkManager.getLocalPlayer();
      kills = localPlayer?.kills || 0;
    }

    if (healthPercent !== this._hudLast.health) {
      this.hud.health.textContent = String(healthPercent);
      this._hudLast.health = healthPercent;
    }
    if (kills !== this._hudLast.kills) {
      this.hud.kills.textContent = String(kills);
      this._hudLast.kills = kills;
    }
    if (missiles !== this._hudLast.missiles) {
      const maxMissiles = this.player.maxMissiles || missiles;
      this.hud.missiles.textContent = `${missiles}/${maxMissiles}`;
      this._hudLast.missiles = missiles;
    }
    if (boostPercent !== this._hudLast.boost) {
      this.hud.boost.textContent = String(boostPercent);
      this._hudLast.boost = boostPercent;
    }
  }

  sendInputToServer(delta) {
    if (!this.isMultiplayer || !this.player) return;

    const state = NetworkManager.getState();
    if (!state || state.phase !== "playing") return;

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
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const isPlaying = this.gameManager.isPlaying();
    
    // Poll gamepad every frame
    this.input.pollGamepad();

    if (isPlaying) {
      // Handle gamepad fire inputs
      this.handleGamepadFire();
      
      if (this.player) {
        this.player.update(delta, this.clock.elapsedTime);
      }

      // Update remote players
      this.remotePlayers.forEach((remote) => {
        remote.update(delta);
      });

      // Update collectibles
      this.collectibles.forEach((collectible) => {
        collectible.update(delta);
      });

      // Only update enemies in single player
      if (!this.isMultiplayer) {
        for (let i = 0; i < this.enemies.length; i++) {
          this.enemies[i].update(
            delta,
            this.camera.position,
            this.boundFireEnemy
          );
        }
      }

      this.projectiles.forEach((proj) => proj.update(delta));
      
      // Combine enemies and remote players as potential missile targets
      const missileTargets = [...this.enemies, ...Array.from(this.remotePlayers.values())];
      this.missiles.forEach((m) => m.update(delta, missileTargets));

      // Send position updates for all local missiles to server (for remote clients to see)
      if (this.isMultiplayer) {
        this.localMissileIds.forEach((missile, serverId) => {
          if (missile.disposed || missile.lifetime <= 0) {
            this.localMissileIds.delete(serverId);
          } else {
            // Always send position updates so remote clients see movement
            NetworkManager.sendMissileUpdate(
              serverId,
              missile.group.position,
              missile.direction
            );
          }
        });
      }

      // Update network projectiles
      // Missiles sync position from server state directly
      this.networkProjectiles.forEach((data, id) => {
        if (data.type === "projectile") {
          data.obj.update(delta);
        } else if (data.type === "missile") {
          // Get current position from server state
          const serverProj = NetworkManager.getState()?.projectiles?.get(id);
          if (serverProj) {
            data.obj.group.position.set(serverProj.x, serverProj.y, serverProj.z);
            data.obj.direction.set(serverProj.dx, serverProj.dy, serverProj.dz).normalize();
            const forward = new THREE.Vector3(0, 0, 1);
            data.obj.group.quaternion.setFromUnitVectors(forward, data.obj.direction);
          }
          
          // Update particle effects
          data.obj.lifetime -= delta;
          if (data.obj.particles) {
            data.obj.spawnTimer += delta;
            while (data.obj.spawnTimer >= data.obj.spawnRate) {
              data.obj.spawnTimer -= data.obj.spawnRate;
              data.obj.particles.emitMissileExhaust(
                data.obj.group.position,
                data.obj.group.quaternion,
                data.obj.direction
              );
            }
          }
          data.obj.trail.material.opacity = 0.6 + Math.random() * 0.25;
        }
      });

      for (let i = this.explosions.length - 1; i >= 0; i--) {
        if (!this.explosions[i].update(delta)) {
          this.explosions.splice(i, 1);
        }
      }

      for (let i = this.impacts.length - 1; i >= 0; i--) {
        if (!this.impacts[i].update(delta)) {
          this.impacts.splice(i, 1);
        }
      }

      // Always check collisions (handles lifetime expiry and wall hits)
      // In multiplayer, damage is handled by server
      this.checkCollisions();
      
      this.updateHUD(delta);
      this.sendInputToServer(delta);

      // Apply prediction correction
      if (this.isMultiplayer && this.player) {
        this.prediction.applySmoothCorrection(this.camera.position, delta);
      }

      if (this.player && this.player.health <= 0 && !this.isMultiplayer) {
        this.stop();
      }
    }

    this.particles?.update(delta);
    this.dynamicLights?.update(delta);
    this.musicManager?.update(delta);
    this.renderer.render(this.scene, this.camera);
  }

  checkCollisions() {
    const playerPos = this.camera.position;
    const playerRadiusSq = 0.64;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];

      if (proj.disposed || proj.lifetime <= 0) {
        proj.dispose(this.scene);
        this.projectiles.splice(i, 1);
        continue;
      }

      let hitSomething = false;
      const projPos = proj.mesh.position;
      const projColor = proj.isPlayerOwned ? 0x00ffff : 0xff8800;

      // In single-player, check entity collisions (multiplayer uses server for this)
      if (!this.isMultiplayer) {
        if (proj.isPlayerOwned) {
          for (let j = this.enemies.length - 1; j >= 0; j--) {
            const enemy = this.enemies[j];
            const distSq = projPos.distanceToSquared(enemy.mesh.position);

            if (distSq < 2.25) {
              enemy.takeDamage(25);

              _hitNormal.subVectors(projPos, enemy.mesh.position).normalize();
              const impact = new LaserImpact(
                this.scene,
                projPos,
                _hitNormal,
                projColor,
                this.dynamicLights
              );
              this.impacts.push(impact);

              hitSomething = true;

              if (enemy.health <= 0) {
                const explosion = new Explosion(
                  this.scene,
                  enemy.mesh.position,
                  enemy.glowColor,
                  this.dynamicLights
                );
                this.explosions.push(explosion);
                enemy.dispose(this.scene);
                this.enemies.splice(j, 1);
                this.gameManager.setState({
                  enemiesRemaining: this.enemies.length,
                  enemiesKilled: this.gameManager.getState().enemiesKilled + 1,
                });
              }
              break;
            }
          }
        } else {
          const distSq = projPos.distanceToSquared(playerPos);
          if (distSq < playerRadiusSq) {
            this.player.health -= 10;
            this.player.lastDamageTime = this.clock.elapsedTime;
            hitSomething = true;
          }
        }
      }

      // Always check wall collisions
      if (!hitSomething && proj.prevPosition) {
        const wallHit = castSphere(
          proj.prevPosition.x,
          proj.prevPosition.y,
          proj.prevPosition.z,
          projPos.x,
          projPos.y,
          projPos.z,
          0.1
        );
        if (wallHit) {
          _hitPos.set(
            proj.prevPosition.x + proj.direction.x * wallHit.toi,
            proj.prevPosition.y + proj.direction.y * wallHit.toi,
            proj.prevPosition.z + proj.direction.z * wallHit.toi
          );
          _hitNormal.set(
            wallHit.normal1.x,
            wallHit.normal1.y,
            wallHit.normal1.z
          );

          const impact = new LaserImpact(
            this.scene,
            _hitPos,
            _hitNormal,
            projColor,
            this.dynamicLights
          );
          this.impacts.push(impact);
          hitSomething = true;
        }
      }

      if (hitSomething) {
        proj.dispose(this.scene);
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];

      if (missile.disposed || missile.lifetime <= 0) {
        missile.dispose(this.scene);
        this.missiles.splice(i, 1);
        continue;
      }

      let exploded = false;
      const missilePos = missile.getPosition();

      // Check against single-player enemies
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const enemy = this.enemies[j];
        const distSq = missilePos.distanceToSquared(enemy.mesh.position);

        if (distSq < 3.24) {
          enemy.takeDamage(missile.damage);
          exploded = true;

          if (enemy.health <= 0) {
            const explosion = new Explosion(
              this.scene,
              enemy.mesh.position,
              enemy.glowColor,
              this.dynamicLights
            );
            this.explosions.push(explosion);
            enemy.dispose(this.scene);
            this.enemies.splice(j, 1);
            this.gameManager.setState({
              enemiesRemaining: this.enemies.length,
              enemiesKilled: this.gameManager.getState().enemiesKilled + 1,
            });
          }
          break;
        }
      }

      // Check against remote players (multiplayer) - client-side prediction
      if (!exploded && this.isMultiplayer) {
        for (const [sessionId, remote] of this.remotePlayers) {
          if (remote.mesh) {
            const distSq = missilePos.distanceToSquared(remote.mesh.position);
            if (distSq < 4) {
              exploded = true;
              break;
            }
          }
        }
      }

      if (!exploded && missile.checkWallCollision()) {
        exploded = true;
      }

      if (exploded) {
        const explosion = new Explosion(
          this.scene,
          missilePos,
          0xff4400,
          this.dynamicLights
        );
        this.explosions.push(explosion);
        missile.dispose(this.scene);
        this.missiles.splice(i, 1);
      }
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
