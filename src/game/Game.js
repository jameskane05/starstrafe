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
import { Level } from "../world/Level.js";
import GameManager from "../managers/GameManager.js";
import SceneManager from "../managers/SceneManager.js";
import LightManager from "../managers/LightManager.js";
import { GAME_STATES } from "../data/gameData.js";
import { ParticleSystem } from "../vfx/ParticleSystem.js";
import { DynamicLightPool } from "../vfx/DynamicLightPool.js";

const _fireDir = new THREE.Vector3();
const _hitPos = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();

export class Game {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.sparkRenderer = null;

    // Managers
    this.gameManager = null;
    this.sceneManager = null;
    this.lightManager = null;
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
    this._hudLast = { health: null, enemies: null, missiles: null };
    this._hudAccum = 0;
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
    document.body.appendChild(this.renderer.domElement);

    // Initialize SparkRenderer for gaussian splats
    this.sparkRenderer = new SparkRenderer({
      renderer: this.renderer,
      maxStdDev: Math.sqrt(8),
      minAlpha: 0.00033,
    });
    // Render splats first (background) so Three.js content (GLTF, particles, lasers) draws on top
    this.sparkRenderer.renderOrder = -100;
    this.scene.add(this.sparkRenderer);

    this.particles = new ParticleSystem(this.scene);
    window.particles = this.particles;
    this.dynamicLights = new DynamicLightPool(this.scene, { size: 12 });

    // Initialize managers
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

    // Initialize light manager (includes splat lights)
    this.lightManager = new LightManager(this.scene, {
      sceneManager: this.sceneManager,
      gameManager: this.gameManager,
    });

    // Subscribe to game state changes
    this.gameManager.on("state:changed", (newState, oldState) =>
      this.onStateChanged(newState, oldState)
    );
    this.gameManager.on("game:started", () => this.onGameStarted());
    this.gameManager.on("game:over", () => this.onGameOver());
    this.gameManager.on("game:victory", () => this.onVictory());

    // Set state to MENU after loading
    this.gameManager.setState({ currentState: GAME_STATES.MENU });

    this.input = new Input(this);

    this.hud = {
      health: document.getElementById("health"),
      enemies: document.getElementById("enemies"),
      missiles: document.getElementById("missiles"),
    };

    // Generate level for spawn points (visuals and physics disabled - splat is the environment)
    this.level = new Level(this.scene);
    this.level.generate({ skipVisuals: true, skipPhysics: true });

    this.player = new Player(this.camera, this.input, this.level, this.scene);

    // Spawn enemies
    await loadShipModels();
    this.spawnEnemies();

    window.addEventListener("resize", () => this.onResize());

    const overlay = document.getElementById("overlay");
    overlay.addEventListener("click", () => this.start());

    this.animate();
  }

  onStateChanged(newState, oldState) {
    // React to state changes - don't call setState here to avoid recursion
  }

  onGameStarted() {
    document.body.requestPointerLock();
    document.getElementById("overlay").classList.add("hidden");
    document.getElementById("crosshair").classList.add("active");
  }

  onGameOver() {
    document.exitPointerLock();
    document.getElementById("overlay").classList.remove("hidden");
    document.getElementById("crosshair").classList.remove("active");
    document.querySelector("#overlay h1").textContent = "DESTROYED";
    document.querySelector("#overlay p").textContent = "Click to restart";
  }

  onVictory() {
    document.exitPointerLock();
    document.getElementById("overlay").classList.remove("hidden");
    document.getElementById("crosshair").classList.remove("active");
    document.querySelector("#overlay h1").textContent = "VICTORY";
    document.querySelector("#overlay p").textContent = "All enemies eliminated";
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

  stop() {
    if (this.player.health <= 0) {
      this.gameManager.gameOver();
    } else {
      // Paused/escaped
      document.exitPointerLock();
      document.getElementById("overlay").classList.remove("hidden");
      document.getElementById("crosshair").classList.remove("active");
      this.gameManager.setState({
        currentState: GAME_STATES.PAUSED,
        isRunning: false,
      });
    }
  }

  firePlayerWeapon() {
    if (!this.gameManager.isPlaying()) return;

    _fireDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const spawnPos = this.player.getWeaponSpawnPoint();
    const projectile = new Projectile(this.scene, spawnPos, _fireDir, true);
    this.projectiles.push(projectile);

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
    if (!this.hud) return;

    this._hudAccum += delta;
    if (this._hudAccum < 0.1) return;
    this._hudAccum = 0;

    const health = Math.max(0, Math.round(this.player.health));
    const enemies = this.enemies.length;
    const missiles = this.player.missiles;

    if (health !== this._hudLast.health) {
      this.hud.health.textContent = String(health);
      this._hudLast.health = health;
    }
    if (enemies !== this._hudLast.enemies) {
      this.hud.enemies.textContent = String(enemies);
      this._hudLast.enemies = enemies;
    }
    if (missiles !== this._hudLast.missiles) {
      this.hud.missiles.textContent = String(missiles);
      this._hudLast.missiles = missiles;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const isPlaying = this.gameManager.isPlaying();

    if (isPlaying) {
      this.player.update(delta);

      for (let i = 0; i < this.enemies.length; i++) {
        this.enemies[i].update(
          delta,
          this.camera.position,
          this.boundFireEnemy
        );
      }

      this.projectiles.forEach((proj) => proj.update(delta));
      this.missiles.forEach((m) => m.update(delta, this.enemies));

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

      this.checkCollisions();
      this.updateHUD(delta);

      if (this.player.health <= 0) {
        this.stop();
      }
    }

    this.particles?.update(delta);
    this.dynamicLights?.update(delta);
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
          hitSomething = true;
        }
      }

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
