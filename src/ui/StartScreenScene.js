/**
 * StartScreenScene.js - 3D MENU BACKGROUND AND DEMO
 * =============================================================================
 *
 * ROLE: Renders the 3D menu background: starfield, ship, projectiles, lights.
 * Optional playable demo (fly/shoot). Used when main menu or start screen is visible.
 *
 * KEY RESPONSIBILITIES:
 * - Scene, camera, renderer, bloom; starfield and sparkle particles
 * - Load and animate menu ship; optional EngineTrail, Projectile, Missile visuals
 * - LightManager (startScreenLights); update(delta), resize; dispose
 * - MenuManager shows/hides renderer.domElement by screen
 *
 * RELATED: MenuManager.js, LightManager.js, lightData.js, EngineTrail.js, ProceduralAudio.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { EngineTrail } from "../vfx/EngineTrail.js";
import { DynamicLightPool } from "../vfx/DynamicLightPool.js";
import { Projectile, PLAYER_LASER_INTENSITY } from "../entities/Projectile.js";
import { Missile } from "../entities/Missile.js";
import sfxManager from "../audio/sfxManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import LightManager from "../managers/LightManager.js";
import { setCachedExteriorShip } from "../cache/exteriorShipCache.js";
import { preloadMissileModel } from "../cache/missileModelCache.js";

const STAR_COUNT = 1500;
const SPARKLE_COUNT = 250;
const SPREAD_X = 900;
const SPREAD_Y = 600;
const STAR_SPEED = 60;
const FORWARD_SPEED = 12;
// Stars spawn between Z_MIN (far) and Z_MAX (near camera / in front of ship)
const Z_MIN = -1200; // Further away for depth
const Z_MAX = 80; // Emitter in front of ship
const GUN_RETRACT_AMOUNT = 0.06;
const GUN_RETRACT_RECOVERY = 6;

/** Menu ship engine ribbon gradient (orange → peachy white along the ribbon). */
const START_SCREEN_TRAIL = {
  colorStart: 0xff4500,
  colorEnd: 0xffcc99,
};

/**
 * Bolt + muzzle flash: match the trail’s bright core (near colorEnd), not
 * colorStart — otherwise the laser reads flat orange vs the white-hot ribbon.
 */
const START_SCREEN_LASER_BOLT_COLOR = (() => {
  const c = new THREE.Color(START_SCREEN_TRAIL.colorEnd);
  c.lerp(new THREE.Color(0xffffff), 0.42);
  return c.getHex();
})();

/**
 * HDR multiplier for menu bolts (warm tints need more than cyan for same bloom).
 */
const START_SCREEN_LASER_HDR_ENERGY = 7.0;

/** Matches `?videoMainMenu` / `body.video-main-menu` (see index.html, menu.css). */
function isVideoMainMenu() {
  return (
    typeof document !== "undefined" &&
    document.body?.classList.contains("video-main-menu")
  );
}

/** Touch-first devices: ignore absolute pointer position for menu orbit (taps emit mousemove at tap coords). */
function isTouchPrimaryPointer() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/** Parallel X shift on camera + look target; recenters framing (ship stays at shipBaseX). */
const VIDEO_MAIN_MENU_CAMERA_X_OFFSET = -5;
/** Parallel +Y on camera + look target: rig moves up in world, ship reads slightly lower in frame. */
const VIDEO_MAIN_MENU_CAMERA_Y_OFFSET = 0.38;

function createGlowTexture(size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const center = size / 2;
  const gradient = ctx.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center,
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.15, "rgba(255, 255, 255, 0.9)");
  gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.3)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

export class StartScreenScene {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.ship = null;
    this.starfield = null;
    this.sparkles = null;
    this.backgroundPlane = null;
    this.galaxyTexture = null;
    this.orbitRange = 0.06;
    this.backgroundParallax = 80;
    this.disposed = false;
    this.paused = false;
    this.animationId = null;
    this.clock = new THREE.Clock();

    // Ship positioned to the left, allowing UI space on right
    this.shipBaseX = -7;
    this.shipBaseY = -1;
    this.shipBaseZ = -4;
    this.rollPhase = 0;
    this.strafePhase = 0;

    // Mouse orbit
    this.mouseX = 0;
    this.mouseY = 0;
    this.orbitX = 0;
    this.orbitY = 0;
    this.orbitSmoothing = 3;
    this.cameraBasePos = new THREE.Vector3(-12, 2.5, 6);
    this.cameraLookTarget = new THREE.Vector3(-6, -0.3, 0);
    this.cameraDriftZ = 0;
    this._portraitBasePos = new THREE.Vector3(-18, -5, 14);
    this._portraitLookTarget = new THREE.Vector3(-8, 4, 0);
    this._desktopBasePos = new THREE.Vector3(-12, 3, 6);
    this._desktopLookTarget = new THREE.Vector3(-6, 0.6, 0);
    this._landscapeBasePos = new THREE.Vector3(-12, 1, 6);
    this._landscapeLookTarget = new THREE.Vector3(-6, 0.5, 0);
    this._forwardVec = new THREE.Vector3();
    this.backgroundDistance = 800;
    this.moveGroup = null;
    this.shipEngineMarkers = [];
    this.shipTrails = [];
    this._shipEnginePos = new THREE.Vector3();
    this._engineLightSmoothPos = new THREE.Vector3();
    this.shipGunL = null;
    this.shipGunR = null;
    this.shipMissileL = null;
    this.shipMissileR = null;
    this.fireFromLeft = true;
    this.missileFromLeft = true;
    this.gunRetractionL = 0;
    this.gunRetractionR = 0;
    this.projectiles = [];
    this.missiles = [];
    this._weaponSpawnPos = new THREE.Vector3();
    this._shipForward = new THREE.Vector3(0, 0, -1);
    this.dynamicLights = null;

    this.shipIntroDuration = 3.2;
    this.shipIntroElapsed = 0;
    this.shipStartY = 6;

    this.defaultCameraDistance = 0;
    this.zoomDistanceOffset = 0;
    this.zoomDistanceTarget = 0;
    this.zoomInMax = 0.7;
    this.zoomOutMax = 2.2;
    this.zoomWheelSpeed = 0.02;
    this.zoomLerpSpeed = 4;
    this._cameraToTargetDir = new THREE.Vector3();
    this.loadingBackgroundOnly = false;
  }

  async init(container, loadingProgress = null) {
    const tracker =
      loadingProgress &&
      typeof loadingProgress.registerTask === "function" &&
      typeof loadingProgress.updateTask === "function"
        ? loadingProgress
        : null;
    const onProgress =
      typeof loadingProgress === "function" ? loadingProgress : null;
    const tasks = tracker ? null : { setup: 0, galaxy: 0, ship: 0 };
    const report = (taskName, progress) => {
      if (tracker) {
        tracker.updateTask(taskName, progress);
        return;
      }

      tasks[taskName] = Math.min(1, Math.max(0, progress));
      const total = (tasks.setup + tasks.galaxy + tasks.ship) / 3;
      onProgress?.(total);
    };

    if (tracker) {
      tracker.registerTask("start-screen-setup");
      tracker.registerTask("start-screen-galaxy");
      tracker.registerTask("start-screen-ship");
    } else {
      report("setup", 0);
      report("galaxy", 0);
      report("ship", 0);
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020208);

    await new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        "/images/ui/galaxy_background.jpg",
        (tex) => {
          report(tracker ? "start-screen-galaxy" : "galaxy", 1);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          this.galaxyTexture = tex;
          const img = tex.image;
          const texAspect =
            img && img.naturalWidth && img.naturalHeight
              ? img.naturalWidth / img.naturalHeight
              : 16 / 9;
          const h = 800;
          const maxViewAspect = 2.6;
          const w =
            texAspect >= 1
              ? h * Math.max(texAspect, maxViewAspect)
              : h / Math.min(texAspect, 1 / maxViewAspect);
          const geo = new THREE.PlaneGeometry(w, h);
          const mat = new THREE.MeshBasicMaterial({
            map: tex,
            side: THREE.DoubleSide,
            depthWrite: true,
            depthTest: true,
          });
          this.backgroundPlane = new THREE.Mesh(geo, mat);
          this.backgroundPlane.renderOrder = -1;
          this.scene.add(this.backgroundPlane);
          resolve();
        },
        undefined,
        () => reject(new Error("Galaxy background load failed")),
      );
    });

    const initAspect = window.visualViewport
      ? window.visualViewport.width / window.visualViewport.height
      : window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, initAspect, 0.1, 5000);
    this.dynamicLights = new DynamicLightPool(this.scene, { size: 6 });
    // Camera in front of ship, looking back at it
    this.defaultCameraDistance = this._portraitBasePos.distanceTo(
      this._portraitLookTarget,
    );
    this.defaultCameraDistanceDesktop = this._desktopBasePos.distanceTo(
      this._desktopLookTarget,
    );
    this.defaultCameraDistanceLandscape = this._landscapeBasePos.distanceTo(
      this._landscapeLookTarget,
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    const vp = window.visualViewport;
    const initW = vp ? Math.round(vp.width) : window.innerWidth;
    const initH = vp ? Math.round(vp.height) : window.innerHeight;
    const initLandscape = initW > initH;
    const initDesktop = initW > 940 && initH > 940;
    this.cameraBasePos.copy(
      initLandscape && initDesktop
        ? this._desktopBasePos
        : initLandscape
          ? this._landscapeBasePos
          : this._portraitBasePos,
    );
    this.cameraLookTarget.copy(
      initLandscape && initDesktop
        ? this._desktopLookTarget
        : initLandscape
          ? this._landscapeLookTarget
          : this._portraitLookTarget,
    );
    if (isVideoMainMenu()) {
      this.cameraBasePos.x += VIDEO_MAIN_MENU_CAMERA_X_OFFSET;
      this.cameraLookTarget.x += VIDEO_MAIN_MENU_CAMERA_X_OFFSET;
      this.cameraBasePos.y += VIDEO_MAIN_MENU_CAMERA_Y_OFFSET;
      this.cameraLookTarget.y += VIDEO_MAIN_MENU_CAMERA_Y_OFFSET;
    }
    this.camera.position.copy(this.cameraBasePos);
    this.camera.lookAt(
      this.cameraLookTarget.x,
      this.cameraLookTarget.y,
      this.cameraLookTarget.z,
    );
    this.renderer.setSize(initW, initH);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.id = "start-scene-canvas";
    container.appendChild(this.renderer.domElement);

    const gm = window.gameManager;
    const bloomStrength = gm?.getSetting("bloomStrength") ?? 0.15;
    const bloomRadius = gm?.getSetting("bloomRadius") ?? 0.4;
    const bloomThreshold = gm?.getSetting("bloomThreshold") ?? 0.8;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.fxaaPass = new FXAAPass();
    this.fxaaPass.enabled = gm?.getSetting("antialiasingEnabled") !== false;
    this.composer.addPass(this.fxaaPass);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(initW, initH),
      bloomStrength,
      bloomRadius,
      bloomThreshold,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this._updateStartScreenBloomActive();

    this._onBloomSettings = (settings) => {
      if (settings.strength !== undefined)
        this.bloomPass.strength = settings.strength;
      if (settings.radius !== undefined)
        this.bloomPass.radius = settings.radius;
      if (settings.threshold !== undefined)
        this.bloomPass.threshold = settings.threshold;
      this._updateStartScreenBloomActive();
    };
    this._onAntialiasingChanged = (enabled) => {
      this.fxaaPass.enabled = enabled;
    };
    gm?.on("bloom:settings", this._onBloomSettings);
    gm?.on("antialiasing:changed", this._onAntialiasingChanged);

    this.moveGroup = new THREE.Group();
    this.moveGroup.position.set(0, this.shipStartY, this.shipBaseZ);
    this.scene.add(this.moveGroup);

    this.createStarfield();
    this.createAmbientLighting();
    report(tracker ? "start-screen-setup" : "setup", 1);
    await this.loadShip((p) => {
      report(tracker ? "start-screen-ship" : "ship", p);
    });

    report(tracker ? "start-screen-ship" : "ship", 1);
    this._onResize = this.onResize.bind(this);
    this._onMouseMove = this.onMouseMove.bind(this);
    this._onWheel = this.onWheel.bind(this);
    window.addEventListener("resize", this._onResize);
    window.visualViewport?.addEventListener("resize", this._onResize);
    window.addEventListener("mousemove", this._onMouseMove);
    window.addEventListener("wheel", this._onWheel, { passive: false });

    if (isVideoMainMenu()) {
      const canvas = this.renderer.domElement;
      this._videoMainMenuLockOnClick = () => {
        if (this.disposed) return;
        if (document.pointerLockElement === canvas) return;
        canvas.requestPointerLock?.()?.catch?.(() => {});
      };
      canvas.addEventListener("click", this._videoMainMenuLockOnClick);
    }

    this.animate();
  }

  _updateStartScreenBloomActive() {
    this.bloomPass.enabled = this.bloomPass.strength > 0.01;
  }

  setLoadingBackgroundOnly(enabled) {
    this.loadingBackgroundOnly = Boolean(enabled);
    if (this.moveGroup) {
      this.moveGroup.visible = !this.loadingBackgroundOnly;
    }
    if (this.loadingBackgroundOnly) {
      this.shipTrails.forEach((trail) => trail.clear());
    }
  }

  getWeaponSpawnPoint() {
    if (this.shipGunL && this.shipGunR) {
      const gun = this.fireFromLeft ? this.shipGunL : this.shipGunR;
      this.fireFromLeft = !this.fireFromLeft;
      gun.getWorldPosition(this._weaponSpawnPos);
      return this._weaponSpawnPos.clone();
    }
    if (!this.ship)
      return new THREE.Vector3(
        this.shipBaseX,
        this.shipBaseY,
        this.shipBaseZ - 1,
      );
    this.ship.getWorldDirection(this._shipForward);
    return this.ship.position
      .clone()
      .add(this._shipForward.clone().multiplyScalar(1.5));
  }

  getShipForwardDirection() {
    if (!this.ship) return new THREE.Vector3(0, 0, 1);
    this.ship.getWorldDirection(this._shipForward);
    return this._shipForward.clone();
  }

  getMissileSpawnPoint() {
    if (this.shipMissileL && this.shipMissileR) {
      const launcher = this.missileFromLeft
        ? this.shipMissileL
        : this.shipMissileR;
      this.missileFromLeft = !this.missileFromLeft;
      const out = new THREE.Vector3();
      launcher.getWorldPosition(out);
      return out;
    }
    if (!this.ship)
      return new THREE.Vector3(
        this.shipBaseX,
        this.shipBaseY,
        this.shipBaseZ - 1,
      );
    this.ship.getWorldDirection(this._shipForward);
    return this.ship.position
      .clone()
      .add(this._shipForward.clone().multiplyScalar(1.5));
  }

  triggerFire() {
    if (!this.ship || this.disposed) return;
    const gunThatFires = this.fireFromLeft ? this.shipGunL : this.shipGunR;
    if (gunThatFires) {
      if (gunThatFires === this.shipGunL)
        this.gunRetractionL = GUN_RETRACT_AMOUNT;
      else this.gunRetractionR = GUN_RETRACT_AMOUNT;
    }
    const spawnPos = this.getWeaponSpawnPoint().addScaledVector(
      this.getShipForwardDirection(),
      -1,
    );
    const direction = this.getShipForwardDirection();
    const laserVisual = {
      color: START_SCREEN_LASER_BOLT_COLOR,
      intensity: PLAYER_LASER_INTENSITY,
      energy: START_SCREEN_LASER_HDR_ENERGY,
    };
    const projectile = new Projectile(
      this.scene,
      spawnPos,
      direction,
      true,
      null,
      laserVisual,
      null,
    );
    this.projectiles.push(projectile);
    this.dynamicLights?.flash(spawnPos, START_SCREEN_LASER_BOLT_COLOR, {
      intensity: 22,
      distance: 22,
      ttl: 0.05,
      fade: 0.12,
    });
    sfxManager.play("laser", spawnPos);
  }

  triggerMissile() {
    if (!this.ship || this.disposed) return;
    if (this.moveGroup) this.moveGroup.updateMatrixWorld(true);
    const spawnPos = this.getMissileSpawnPoint();
    const direction = this.getShipForwardDirection();
    spawnPos.addScaledVector(direction, -1);
    const missile = new Missile(this.scene, spawnPos, direction, {});
    this.missiles.push(missile);
    this.dynamicLights?.flash(spawnPos, 0xffaa33, {
      intensity: 10,
      distance: 16,
      ttl: 0.05,
      fade: 0.12,
    });
    proceduralAudio.missileFire();
  }

  createStarfield() {
    const glowTexture = createGlowTexture(64);

    // Main stars
    const starPositions = new Float32Array(STAR_COUNT * 3);
    const starColors = new Float32Array(STAR_COUNT * 3);
    const starSpeeds = new Float32Array(STAR_COUNT);

    const baseColor = new THREE.Color(0xffffff);
    const warmColor = new THREE.Color(0xffcc88);
    const coolColor = new THREE.Color(0x88ccff);
    const cyanColor = new THREE.Color(0x00f0ff);

    for (let i = 0; i < STAR_COUNT; i++) {
      const i3 = i * 3;
      starPositions[i3] = (Math.random() - 0.5) * SPREAD_X;
      starPositions[i3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
      starPositions[i3 + 2] = Z_MIN + Math.random() * (Z_MAX - Z_MIN);

      const colorVar = Math.random();
      let color;
      if (colorVar < 0.1) color = warmColor;
      else if (colorVar < 0.2) color = coolColor;
      else if (colorVar < 0.25) color = cyanColor;
      else color = baseColor;

      const brightness = 0.5 + Math.random() * 0.5;
      starColors[i3] = color.r * brightness;
      starColors[i3 + 1] = color.g * brightness;
      starColors[i3 + 2] = color.b * brightness;

      // Center stars move faster (hyperspace effect)
      const distFromCenter = Math.sqrt(
        starPositions[i3] * starPositions[i3] +
          starPositions[i3 + 1] * starPositions[i3 + 1],
      );
      const maxDist = Math.sqrt(SPREAD_X * SPREAD_X + SPREAD_Y * SPREAD_Y) / 2;
      const normalizedDist = Math.min(distFromCenter / maxDist, 1);
      starSpeeds[i] = 0.2 + (1 - normalizedDist) * 1.8;
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(starPositions, 3),
    );
    starGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(starColors, 3),
    );

    const starMaterial = new THREE.PointsMaterial({
      size: 1.2,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.starfield = new THREE.Points(starGeometry, starMaterial);
    this.starfield.userData.speeds = starSpeeds;
    this.moveGroup.add(this.starfield);

    // Sparkle layer (larger, brighter stars - fewer of them)
    const sparklePositions = new Float32Array(SPARKLE_COUNT * 3);
    const sparkleColors = new Float32Array(SPARKLE_COUNT * 3);
    const sparkleSpeeds = new Float32Array(SPARKLE_COUNT);

    for (let i = 0; i < SPARKLE_COUNT; i++) {
      const i3 = i * 3;
      sparklePositions[i3] = (Math.random() - 0.5) * SPREAD_X;
      sparklePositions[i3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
      sparklePositions[i3 + 2] = Z_MIN + Math.random() * (Z_MAX - Z_MIN);

      const brightness = 0.8 + Math.random() * 0.2;
      sparkleColors[i3] = brightness;
      sparkleColors[i3 + 1] = brightness;
      sparkleColors[i3 + 2] = brightness;

      const distFromCenter = Math.sqrt(
        sparklePositions[i3] * sparklePositions[i3] +
          sparklePositions[i3 + 1] * sparklePositions[i3 + 1],
      );
      const maxDist = Math.sqrt(SPREAD_X * SPREAD_X + SPREAD_Y * SPREAD_Y) / 2;
      const normalizedDist = Math.min(distFromCenter / maxDist, 1);
      sparkleSpeeds[i] = 0.2 + (1 - normalizedDist) * 1.8;
    }

    const sparkleGeometry = new THREE.BufferGeometry();
    sparkleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(sparklePositions, 3),
    );
    sparkleGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(sparkleColors, 3),
    );

    const sparkleMaterial = new THREE.PointsMaterial({
      size: 2.0,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.sparkles = new THREE.Points(sparkleGeometry, sparkleMaterial);
    this.sparkles.userData.speeds = sparkleSpeeds;
    this.moveGroup.add(this.sparkles);
  }

  createAmbientLighting() {
    this.lightManager = new LightManager(this.scene, { startScreenOnly: true });
    this.lightManager.loadStartScreenLights(this.moveGroup);
    this.engineLight = this.lightManager.getLight("engine");
  }

  async loadShip(onProgress) {
    preloadMissileModel().catch(() => {});
    const loader = new GLTFLoader();
    const ESTIMATED_SHIP_BYTES = 38 * 1024 * 1024;

    return new Promise((resolve) => {
      loader.load(
        "./gltf/Heavy_EXT_02.glb",
        (gltf) => {
          if (onProgress) onProgress(1);
          this.ship = gltf.scene;
          this.ship.scale.setScalar(0.8);
          this.ship.position.set(this.shipBaseX, this.shipBaseY, 0);
          this.ship.rotation.set(0, 0, 0);

          this.shipEngineMarkers.length = 0;
          this.shipGunL = null;
          this.shipGunR = null;
          this.shipMissileL = null;
          this.shipMissileR = null;
          this.ship.traverse((child) => {
            const n = child.name;
            if (n === "Engine_L" || n === "Engine_R") {
              this.shipEngineMarkers.push(child);
            } else if (n === "Gun_L") {
              this.shipGunL = child;
              child.userData.restPosition = child.position.clone();
            } else if (n === "Gun_R") {
              this.shipGunR = child;
              child.userData.restPosition = child.position.clone();
            } else if (n === "Missile_L") this.shipMissileL = child;
            else if (n === "Missile_R") this.shipMissileR = child;
          });
          if (this.shipEngineMarkers.length < 2) {
            console.warn(
              "[StartScreen] Ship model missing Engine_L and/or Engine_R; trail VFX disabled.",
            );
          } else {
            this.shipTrails = [
              new EngineTrail(this.scene, {
                maxPoints: 160,
                trailTime: 6,
                width: 1.2,
                colorStart: START_SCREEN_TRAIL.colorStart,
                colorEnd: START_SCREEN_TRAIL.colorEnd,
                emissiveIntensity: 2.8,
              }),
              new EngineTrail(this.scene, {
                maxPoints: 160,
                trailTime: 6,
                width: 1.2,
                colorStart: START_SCREEN_TRAIL.colorStart,
                colorEnd: START_SCREEN_TRAIL.colorEnd,
                emissiveIntensity: 2.8,
              }),
            ];
          }

          const box = new THREE.Box3().setFromObject(this.ship);
          console.log("[StartScreen] Ship bounds:", box.min, box.max);

          this.moveGroup.add(this.ship);
          setCachedExteriorShip(this.ship);
          if (this.engineLight) {
            this._engineLightSmoothPos.set(
              this.ship.position.x,
              this.ship.position.y,
              this.ship.position.z + 3,
            );
            this.engineLight.position.copy(this._engineLightSmoothPos);
          }
          console.log("[StartScreen] Ship loaded successfully");
          resolve();
        },
        (a, b, c) => {
          if (!onProgress) return;
          const loaded = a?.loaded ?? b;
          const total = a?.total ?? c;
          if (total > 0 && typeof loaded === "number") {
            onProgress(loaded / total);
          } else if (loaded > 0) {
            onProgress(Math.min(0.99, loaded / ESTIMATED_SHIP_BYTES));
          }
        },
        (error) => {
          console.error("[StartScreen] Failed to load ship:", error);
          if (onProgress) onProgress(1);
          const geo = new THREE.ConeGeometry(0.8, 2.5, 8);
          geo.rotateX(Math.PI / 2);
          const mat = new THREE.MeshStandardMaterial({
            color: 0x334455,
            emissive: 0x00f0ff,
            emissiveIntensity: 0.2,
            metalness: 0.8,
            roughness: 0.3,
          });
          this.ship = new THREE.Mesh(geo, mat);
          this.ship.position.set(this.shipBaseX, this.shipBaseY, 0);
          this.moveGroup.add(this.ship);
          resolve();
        },
      );
    });
  }

  updateStarfield(delta) {
    const updateLayer = (points) => {
      if (!points) return;

      const positions = points.geometry.attributes.position.array;
      const speeds = points.userData.speeds;
      const count = positions.length / 3;

      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        positions[i3 + 2] -= STAR_SPEED * speeds[i] * delta;

        if (positions[i3 + 2] < Z_MIN) {
          positions[i3] = (Math.random() - 0.5) * SPREAD_X;
          positions[i3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
          positions[i3 + 2] = Z_MAX - Math.random() * 50;

          const distFromCenter = Math.sqrt(
            positions[i3] * positions[i3] +
              positions[i3 + 1] * positions[i3 + 1],
          );
          const maxDist =
            Math.sqrt(SPREAD_X * SPREAD_X + SPREAD_Y * SPREAD_Y) / 2;
          const normalizedDist = Math.min(distFromCenter / maxDist, 1);
          speeds[i] = 0.2 + (1 - normalizedDist) * 1.8;
        } else if (positions[i3 + 2] > Z_MAX) {
          positions[i3] = (Math.random() - 0.5) * SPREAD_X;
          positions[i3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
          positions[i3 + 2] = Z_MIN + Math.random() * 50;

          const distFromCenter = Math.sqrt(
            positions[i3] * positions[i3] +
              positions[i3 + 1] * positions[i3 + 1],
          );
          const maxDist =
            Math.sqrt(SPREAD_X * SPREAD_X + SPREAD_Y * SPREAD_Y) / 2;
          const normalizedDist = Math.min(distFromCenter / maxDist, 1);
          speeds[i] = 0.2 + (1 - normalizedDist) * 1.8;
        }
      }

      points.geometry.attributes.position.needsUpdate = true;
    };

    updateLayer(this.starfield);
    updateLayer(this.sparkles);
  }

  updateShip(delta) {
    if (!this.ship) return;
    if (this.loadingBackgroundOnly) {
      if (this.engineLight) {
        this.engineLight.intensity = 0;
      }
      this.shipTrails.forEach((trail) => trail.clear());
      return;
    }

    const time = this.clock.elapsedTime;

    if (this.shipIntroElapsed < this.shipIntroDuration) {
      this.shipIntroElapsed = Math.min(
        this.shipIntroElapsed + delta,
        this.shipIntroDuration,
      );
      const t = this.shipIntroElapsed / this.shipIntroDuration;
      const easeOut = 1 - (1 - t) ** 3;
      this.moveGroup.position.y = this.shipStartY * (1 - easeOut);
    }

    // Gentle roll oscillation
    this.rollPhase += delta * 0.4;
    const roll = Math.sin(this.rollPhase) * 0.12;

    // Subtle vertical bob
    const bob = Math.sin(time * 0.8) * 0.15;

    // Slow horizontal strafe
    this.strafePhase += delta * 0.25;
    const strafe = Math.sin(this.strafePhase) * 1.5;

    // Slight pitch variation
    const pitch = Math.sin(time * 0.5) * 0.03;

    this.moveGroup.position.z += FORWARD_SPEED * delta;
    this.cameraDriftZ += FORWARD_SPEED * delta;

    this.ship.position.x = this.shipBaseX + strafe;
    this.ship.position.y = this.shipBaseY + bob;
    this.ship.position.z = 0;
    this.ship.rotation.x = pitch;
    this.ship.rotation.z = roll;

    const recover = 1 - Math.exp(-GUN_RETRACT_RECOVERY * delta);
    if (this.shipGunL?.userData.restPosition) {
      this.gunRetractionL = Math.max(
        0,
        this.gunRetractionL - this.gunRetractionL * recover,
      );
      this.shipGunL.position.copy(this.shipGunL.userData.restPosition);
      this.shipGunL.position.z -= this.gunRetractionL;
    }
    if (this.shipGunR?.userData.restPosition) {
      this.gunRetractionR = Math.max(
        0,
        this.gunRetractionR - this.gunRetractionR * recover,
      );
      this.shipGunR.position.copy(this.shipGunR.userData.restPosition);
      this.shipGunR.position.z -= this.gunRetractionR;
    }

    if (this.engineLight && this.ship) {
      const tx = this.ship.position.x;
      const ty = this.ship.position.y;
      const tz = this.ship.position.z + 3;
      const smooth = 5;
      const t = 1 - Math.exp(-smooth * delta);
      this._engineLightSmoothPos.x += (tx - this._engineLightSmoothPos.x) * t;
      this._engineLightSmoothPos.y += (ty - this._engineLightSmoothPos.y) * t;
      this._engineLightSmoothPos.z += (tz - this._engineLightSmoothPos.z) * t;
      this.engineLight.position.copy(this._engineLightSmoothPos);
      this.engineLight.intensity = 2;
    }

    if (this.shipTrails.length > 0) {
      const t = this.clock.elapsedTime;
      for (
        let i = 0;
        i < this.shipEngineMarkers.length && i < this.shipTrails.length;
        i++
      ) {
        this.shipEngineMarkers[i].getWorldPosition(this._shipEnginePos);
        this.shipTrails[i].addPoint(this._shipEnginePos.clone(), t);
        this.shipTrails[i].update(t);
      }
    }
  }

  animate() {
    if (this.disposed || this.paused) return;

    this.animationId = requestAnimationFrame(() => this.animate());

    // Clamp delta to prevent huge jumps when tabbing back after being away
    // This keeps the starfield smooth instead of resetting all stars at once
    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);

    this.updateStarfield(delta);
    this.updateShip(delta);
    this.updateOrbit(delta);
    this.dynamicLights?.update(delta);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(delta);
      if (p.lifetime <= 0) {
        p.dispose(this.scene);
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.update(delta, []);
      if (m.lifetime <= 0 || m.disposed) {
        m.dispose(this.scene);
        this.missiles.splice(i, 1);
      }
    }

    this.composer.render();
  }

  updateOrbit(delta) {
    const w = window.visualViewport?.width ?? window.innerWidth;
    const h = window.visualViewport?.height ?? window.innerHeight;
    const isLandscape = w > h;
    const isDesktop = w > 940 && h > 940;

    const useDesktop = isLandscape && isDesktop;
    const useLandscapeMobile = isLandscape && !isDesktop;

    this.cameraBasePos.copy(
      useDesktop
        ? this._desktopBasePos
        : useLandscapeMobile
          ? this._landscapeBasePos
          : this._portraitBasePos,
    );
    this.cameraBasePos.z += this.cameraDriftZ;
    this.cameraLookTarget.copy(
      useDesktop
        ? this._desktopLookTarget
        : useLandscapeMobile
          ? this._landscapeLookTarget
          : this._portraitLookTarget,
    );
    this.cameraLookTarget.z += this.cameraDriftZ;
    if (isVideoMainMenu()) {
      this.cameraBasePos.x += VIDEO_MAIN_MENU_CAMERA_X_OFFSET;
      this.cameraLookTarget.x += VIDEO_MAIN_MENU_CAMERA_X_OFFSET;
      this.cameraBasePos.y += VIDEO_MAIN_MENU_CAMERA_Y_OFFSET;
      this.cameraLookTarget.y += VIDEO_MAIN_MENU_CAMERA_Y_OFFSET;
    }

    const targetX = -this.mouseX * this.orbitRange;
    const targetY = -this.mouseY * this.orbitRange;

    const t = 1 - Math.exp(-this.orbitSmoothing * delta);
    this.orbitX += (targetX - this.orbitX) * t;
    this.orbitY += (targetY - this.orbitY) * t;

    const zoomT = 1 - Math.exp(-this.zoomLerpSpeed * delta);
    this.zoomDistanceOffset +=
      (this.zoomDistanceTarget - this.zoomDistanceOffset) * zoomT;

    const defaultDist = useDesktop
      ? this.defaultCameraDistanceDesktop
      : useLandscapeMobile
        ? this.defaultCameraDistanceLandscape
        : this.defaultCameraDistance;
    this._cameraToTargetDir
      .subVectors(this.cameraBasePos, this.cameraLookTarget)
      .normalize();
    const dist = Math.max(0.5, defaultDist + this.zoomDistanceOffset);
    this.camera.position
      .copy(this.cameraLookTarget)
      .addScaledVector(this._cameraToTargetDir, dist);
    this.camera.lookAt(this.cameraLookTarget);
    this.camera.rotateY(this.orbitX);
    this.camera.rotateX(this.orbitY);

    if (this.backgroundPlane) {
      this.camera.getWorldDirection(this._forwardVec);
      this.backgroundPlane.position
        .copy(this.camera.position)
        .addScaledVector(this._forwardVec, this.backgroundDistance);
      this.backgroundPlane.position.x += this.orbitX * this.backgroundParallax;
      this.backgroundPlane.position.y += this.orbitY * this.backgroundParallax;
      this.backgroundPlane.lookAt(this.camera.position);
      this.backgroundPlane.rotateY(Math.PI);
    }
  }

  onMouseMove(e) {
    const canvas = this.renderer?.domElement;
    if (canvas && document.pointerLockElement === canvas) {
      const scale = 0.0015;
      this.mouseX = THREE.MathUtils.clamp(
        this.mouseX + e.movementX * scale,
        -1,
        1,
      );
      this.mouseY = THREE.MathUtils.clamp(
        this.mouseY + e.movementY * scale,
        -1,
        1,
      );
      return;
    }
    if (isTouchPrimaryPointer()) {
      this.mouseX = 0;
      this.mouseY = 0;
      return;
    }
    this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  }

  onWheel(e) {
    e.preventDefault();
    this.zoomDistanceTarget -= e.deltaY * this.zoomWheelSpeed;
    this.zoomDistanceTarget = Math.max(
      -this.zoomInMax,
      Math.min(this.zoomOutMax, this.zoomDistanceTarget),
    );
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.animate();
  }

  onResize() {
    if (this.disposed) return;

    const vp = window.visualViewport;
    const w = vp ? Math.round(vp.width) : window.innerWidth;
    const h = vp ? Math.round(vp.height) : window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.bloomPass?.resolution?.set(w, h);
  }

  dispose() {
    this.disposed = true;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    this.lightManager?.destroy();

    const gm = window.gameManager;
    gm?.off("bloom:settings", this._onBloomSettings);
    gm?.off("antialiasing:changed", this._onAntialiasingChanged);

    window.removeEventListener("resize", this._onResize);
    window.visualViewport?.removeEventListener("resize", this._onResize);
    window.removeEventListener("mousemove", this._onMouseMove);
    window.removeEventListener("wheel", this._onWheel);

    if (this._videoMainMenuLockOnClick && this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener(
        "click",
        this._videoMainMenuLockOnClick,
      );
      this._videoMainMenuLockOnClick = null;
    }
    if (document.pointerLockElement === this.renderer?.domElement) {
      document.exitPointerLock?.();
    }

    this.projectiles.forEach((p) => {
      if (!p.disposed) p.dispose(this.scene);
    });
    this.projectiles.length = 0;
    this.missiles.forEach((m) => {
      if (!m.disposed) m.dispose(this.scene);
    });
    this.missiles.length = 0;

    if (this.starfield) {
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
    }

    if (this.sparkles) {
      this.sparkles.geometry.dispose();
      this.sparkles.material.dispose();
    }

    this.shipTrails.forEach((t) => t.dispose());
    this.shipTrails.length = 0;

    if (this.ship) {
      this.ship.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    if (this.backgroundPlane) {
      this.backgroundPlane.geometry.dispose();
      this.backgroundPlane.material.dispose();
    }
    if (this.galaxyTexture) this.galaxyTexture.dispose();

    this.composer?.dispose?.();
    this.bloomPass?.dispose?.();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}
