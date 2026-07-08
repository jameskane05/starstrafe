/**
 * Player.js - LOCAL PLAYER SHIP AND COCKPIT
 * =============================================================================
 *
 * ROLE: First-person player ship: movement, look, roll, boost, health/missiles,
 * cockpit model and headlight. Physics-based movement and collision; engine trail
 * and gun retract visuals. Used in solo and as local ship in multiplayer.
 *
 * KEY RESPONSIBILITIES:
 * - update(delta, gameTime): apply input to velocity, drag, collision (level sphere cast)
 * - Boost fuel drain/regen; shield regen after damage; roll from input; ship auto-leveling (wings level)
 * - Cockpit GLTF, headlight toggle; engine trail and retract-on-fire
 * - takeDamage(amount), setXRMode(xrManager); prefracture for destruction (ShipDestruction)
 *
 * RELATED: Input.js, Physics.js, ShipDestruction.js, gameCombat.js, EngineTrail.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { checkSphereCollision, castSphere } from "../physics/Physics.js";
import { prefracturePlayerShip } from "../vfx/ShipDestruction.js";
import { getCachedExteriorShip } from "../cache/exteriorShipCache.js";
import { dialogSpeakers } from "../data/dialogData.js";
import { LipSyncManager } from "../ui/LipSyncManager.js";
import { VRMAvatarRenderer } from "../ui/VRMAvatarRenderer.js";
import { AutomapController } from "../ui/AutomapController.js";
import {
  hologramVertexShader,
  hologramFragmentShader,
} from "../vfx/shaders/hologramShader.glsl.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import { refreshCockpitVisibility } from "../game/gameInGameUI.js";

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _accel = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();
const _pitchQuat = new THREE.Quaternion();
const _rollQuat = new THREE.Quaternion();
const _shipAutoWorldUp = new THREE.Vector3(0, 1, 0);
const _shipAutoDesiredUp = new THREE.Vector3();
const _shipAutoUpProj = new THREE.Vector3();
const _shipAutoCross = new THREE.Vector3();
const _gpStick = new THREE.Vector3();
/** Max roll rate toward nearest cardinal (Descent-style leveling is fairly aggressive). */
const SHIP_AUTO_LEVEL_RAD_PER_SEC = 3.4;
/** Fraction of remaining residual closed per frame (higher = snaps in faster after roll release). */
const SHIP_AUTO_LEVEL_RESPONSE = 22;
/** Below LOW rad from cardinal, cap scales up from MIN_MULT; full cap by HIGH. */
const SHIP_AUTO_LEVEL_CAP_RAMP_LOW = 0.018;
const SHIP_AUTO_LEVEL_CAP_RAMP_HIGH = 0.12;
const SHIP_AUTO_LEVEL_CAP_MIN_MULT = 0.38;
const SHIP_AUTO_LEVEL_FORWARD_UP_DOT_MAX = 0.88;
const SHIP_AUTO_LEVEL_MIN_ANGLE = 0.004;
const SHIP_AUTO_LEVEL_SKIP_ROLL_VEL = 0.12;
const _engineColorBlack = new THREE.Color(0x000000);
const _engineColorGlow = new THREE.Color(0xbbddff);
const _engineColorBoost = new THREE.Color(0xddffff);
const GUN_RETRACT_AMOUNT = 0.06;
const GUN_RETRACT_RECOVERY = 6;
const IDLE_BOB_SPEED = 0.6;
const IDLE_BOB_POS_AMP = 0.0005;
const IDLE_BOB_ANGLE_AMP = 0.00005;
const IDLE_VELOCITY_THRESHOLD = 0.08;
const COCKPIT_STATUS_CANVAS_SIZE = 1024;
/** Reference framerate that velocity/drag values are tuned for. */
const MOVEMENT_REFERENCE_HZ = 60;
/** Cap on how many reference frames a single real frame represents (limits collision tunneling). */
const MOVEMENT_FRAME_SCALE_MAX = 4;
/** Cap on integration timestep for input accumulation and rotation; 100ms = 10fps tolerance. */
const CONTROL_DELTA_MAX = 0.1;

const COLLISION_SKIN = 0.005;
const COLLISION_MAX_ITERS = 4;

function _moveAndSlide(pos, velocity, frameScale, collisionRadius) {
  let remaining = frameScale;

  for (let iter = 0; iter < COLLISION_MAX_ITERS; iter++) {
    const stepX = velocity.x * remaining;
    const stepY = velocity.y * remaining;
    const stepZ = velocity.z * remaining;
    const stepLen = Math.hypot(stepX, stepY, stepZ);
    if (stepLen < 1e-6) return;

    const hit = castSphere(
      pos.x,
      pos.y,
      pos.z,
      pos.x + stepX,
      pos.y + stepY,
      pos.z + stepZ,
      collisionRadius,
    );

    if (!hit) {
      pos.x += stepX;
      pos.y += stepY;
      pos.z += stepZ;
      return;
    }

    const n = hit.normal1;
    let nx = n.x;
    let ny = n.y;
    let nz = n.z;
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen < 1e-6) {
      pos.x += stepX;
      pos.y += stepY;
      pos.z += stepZ;
      return;
    }
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;

    const vDotN = velocity.x * nx + velocity.y * ny + velocity.z * nz;
    const toi = hit.time_of_impact;

    if (toi < COLLISION_SKIN) {
      // Already in contact. Push off along the outward normal so the next cast
      // starts clear of this surface, then project out any into-wall velocity.
      pos.x += nx * COLLISION_SKIN * 2;
      pos.y += ny * COLLISION_SKIN * 2;
      pos.z += nz * COLLISION_SKIN * 2;
      if (vDotN < 0) {
        velocity.x -= vDotN * nx;
        velocity.y -= vDotN * ny;
        velocity.z -= vDotN * nz;
      }
      continue;
    }

    const advance = toi - COLLISION_SKIN;
    const advFrac = advance / stepLen;
    pos.x += stepX * advFrac;
    pos.y += stepY * advFrac;
    pos.z += stepZ * advFrac;

    if (vDotN < 0) {
      velocity.x -= vDotN * nx;
      velocity.y -= vDotN * ny;
      velocity.z -= vDotN * nz;
    }

    remaining *= 1 - advFrac;
  }
}

function findCockpitScreenMesh(root, targetName) {
  let match = null;
  root?.traverse((child) => {
    if (match || child.name !== targetName) return;
    match = child.isMesh
      ? child
      : (child.children?.find((c) => c.isMesh) ?? null);
  });
  return match;
}

function findCockpitDisplayMesh(root, namesInPriorityOrder) {
  for (const name of namesInPriorityOrder) {
    const mesh = findCockpitScreenMesh(root, name);
    if (mesh) return mesh;
  }
  for (const name of namesInPriorityOrder) {
    let found = null;
    const dotted = `${name}.`;
    root?.traverse((child) => {
      if (found || !child.isMesh) return;
      const n = child.name || "";
      if (n.startsWith(dotted)) found = child;
    });
    if (found) return found;
  }
  return null;
}

function logCockpitMeshNamesForDebug(root, context) {
  const names = new Set();
  root?.traverse((child) => {
    if (child.isMesh && child.name) names.add(child.name);
  });
  console.warn(
    `[Cockpit] ${context} — interior mesh names:`,
    [...names].sort().join(", ") || "(none)",
  );
}

function createProjectedScreenMesh(screenMesh, material, options = {}) {
  const geometry = screenMesh.geometry.clone();
  const pos = geometry.attributes.position;
  const count = pos.count;
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity,
    zMin = Infinity,
    zMax = -Infinity;

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }

  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const zSpan = zMax - zMin;
  const uAxis =
    xSpan >= ySpan && xSpan >= zSpan ? "x" : ySpan >= zSpan ? "y" : "z";
  const vAxis =
    uAxis === "x"
      ? ySpan >= zSpan
        ? "y"
        : "z"
      : uAxis === "y"
        ? xSpan >= zSpan
          ? "x"
          : "z"
        : xSpan >= ySpan
          ? "x"
          : "y";
  const uvs = new Float32Array(count * 2);
  let uMin = Infinity,
    uMax = -Infinity,
    vMin = Infinity,
    vMax = -Infinity;

  for (let i = 0; i < count; i++) {
    const uVal =
      uAxis === "x" ? pos.getX(i) : uAxis === "y" ? pos.getY(i) : pos.getZ(i);
    const vVal =
      vAxis === "x" ? pos.getX(i) : vAxis === "y" ? pos.getY(i) : pos.getZ(i);
    uMin = Math.min(uMin, uVal);
    uMax = Math.max(uMax, uVal);
    vMin = Math.min(vMin, vVal);
    vMax = Math.max(vMax, vVal);
  }

  const uSpan = uMax - uMin || 1;
  const vSpan = vMax - vMin || 1;
  const vInset = options.vInset ?? 0.6;
  const vOffset = (1 - vInset) * 0.5;

  for (let i = 0; i < count; i++) {
    const uVal =
      uAxis === "x" ? pos.getX(i) : uAxis === "y" ? pos.getY(i) : pos.getZ(i);
    const vVal =
      vAxis === "x" ? pos.getX(i) : vAxis === "y" ? pos.getY(i) : pos.getZ(i);
    uvs[i * 2] = (uVal - uMin) / uSpan;
    uvs[i * 2 + 1] = vOffset + ((vVal - vMin) / vSpan) * vInset;
  }

  const rotateQuarterTurns = (((options.rotateQuarterTurns ?? 0) % 4) + 4) % 4;
  if (rotateQuarterTurns !== 0) {
    for (let i = 0; i < count; i++) {
      const u = uvs[i * 2];
      const v = uvs[i * 2 + 1];
      if (rotateQuarterTurns === 1) {
        uvs[i * 2] = v;
        uvs[i * 2 + 1] = 1 - u;
      } else if (rotateQuarterTurns === 2) {
        uvs[i * 2] = 1 - u;
        uvs[i * 2 + 1] = 1 - v;
      } else if (rotateQuarterTurns === 3) {
        uvs[i * 2] = 1 - v;
        uvs[i * 2 + 1] = u;
      }
    }
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, options.yOffset ?? 0.002, options.zOffset ?? 0.01);
  mesh.renderOrder = options.renderOrder ?? 9010;
  screenMesh.add(mesh);
  return mesh;
}

export class Player {
  constructor(camera, input, level, scene, options = {}) {
    this.camera = camera;
    this.input = input;
    this.level = level;
    this.scene = scene;
    this.game = options.game ?? null;
    this.xrManager = null;

    this.health = options.health || 100;
    this.maxHealth = options.maxHealth || 100;
    this.missiles = options.missiles || 6;
    this.maxMissiles = options.maxMissiles || 6;
    this.hasLaserUpgrade = false;
    this.primaryWeaponUnlocks = options.primaryWeaponUnlocks || null;

    this.lastDamageTime = 0;
    this.shieldRegenDelay = 5;
    this.shieldRegenRate = 15;

    this.boostFuel = 200;
    this.maxBoostFuel = 200;
    this.boostDrainRate = 20;
    this.boostRegenRate = 33;
    this.boostRegenDelay = 3;
    this.lastBoostTime = 0;
    this.boostMultiplier = 2.5;
    this.overboostMultiplier = 1;
    this.overboostActive = false;
    this.isBoosting = false;

    this.acceleration = options.acceleration || 0.8625;
    this.maxSpeed = options.maxSpeed || 3.51;

    this.velocity = new THREE.Vector3();
    this.drag = 0.97;
    this.collisionRadius = 1.5;

    this.rollVelocity = 0;
    this.rollAccel = 6;
    this.rollMaxSpeed = 3;
    this.rollDrag = 0.96;

    this.pitchVelocity = 0;
    this.yawVelocity = 0;
    this.lookAccel = 0.052;
    this.lookMaxSpeed = 2.35;
    this.lookDrag = 0.942;

    this.fireFromLeft = true;
    this.missileFromLeft = true;

    this.gunL = null;
    this.gunR = null;
    this.missileL = null;
    this.missileR = null;
    this.gunRetractionL = 0;
    this.gunRetractionR = 0;
    this.engineMarkers = [];
    this.engineMaterials = [];
    this.exteriorRef = null;
    this.engineGlowT = 0;
    this.engineGlowTarget = 0;
    this.lipSyncManager = null;
    this.vrmAvatarRenderer = null;
    this.dialogSpeakerRenderers = {};
    this.activeDialogSpeakerId = null;
    this._holoSpeakerTransition = null;
    this.visemeHoloTime = 0;
    this.visemeHoloUniforms = null;
    this.cockpitStatusCanvas = null;
    this.cockpitStatusContext = null;
    this.cockpitStatusTexture = null;
    this.cockpitStatusUniforms = null;
    this._cockpitStatusScreenMesh = null;
    this.cockpitStatusTime = 0;
    this.cockpitStatusIcons = {};
    this.cockpitStatusState = {
      healthPercent: Math.round((this.health / this.maxHealth) * 100),
      missiles: this.missiles,
      maxMissiles: this.maxMissiles,
      boostPercent: Math.round((this.boostFuel / this.maxBoostFuel) * 100),
      overboostActive: false,
      missileMode: this.game?.getSelectedMissileMode?.() ?? "homing",
    };

    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();

    this.automap = new AutomapController(camera);

    this.headlight = new THREE.SpotLight(
      0xffffff,
      40,
      200,
      Math.PI / 4,
      0.5,
      1.5,
    );
    this.headlight.position.set(0, 0.5, -0.5);
    this.headlight.target.position.set(0, 0, -10);
    this.headlight.visible = true;
    this.headlightEnabled = true;
    this.camera.add(this.headlight);
    this.camera.add(this.headlight.target);

    this.cockpitLoaded = new Promise((resolve) => {
      this._resolveCockpitLoaded = resolve;
    });
    this.loadCockpit(scene);
    this.loadExteriorRef();
  }

  loadExteriorRef() {
    const applyExterior = (scene) => {
      this.exteriorRef = scene;
      this.exteriorRef.visible = false;
      this.exteriorRef.position.set(0, 0, 0);
      this.exteriorRef.rotation.set(0, Math.PI, 0);
      this.exteriorRef.scale.setScalar(1);

      this.exteriorRef.traverse((child) => {
        const n = child.name;
        if (n === "Gun_L") {
          this.gunL = child;
          child.userData.restPosition = child.position.clone();
        } else if (n === "Gun_R") {
          this.gunR = child;
          child.userData.restPosition = child.position.clone();
        } else if (n === "Missile_L") this.missileL = child;
        else if (n === "Missile_R") this.missileR = child;
        if (n === "Engine_L" || n === "Engine_R")
          this.engineMarkers.push(child);
        if (n === "Engine_Center" || n === "Engine_L" || n === "Engine_R") {
          if (child.isMesh && child.material)
            this.engineMaterials.push(child.material);
          else if (child.children) {
            child.traverse((c) => {
              if (c.isMesh && c.material) this.engineMaterials.push(c.material);
            });
          }
        }
      });
      if (!this.gunL || !this.gunR) {
        console.warn(
          "[Player] Ship model missing Gun_L and/or Gun_R; laser spawn using fallback offsets.",
        );
      }
      if (this.engineMarkers.length < 2) {
        console.warn(
          "[Player] Ship model missing Engine_L and/or Engine_R; boost trail VFX disabled.",
        );
      }
      if (this.engineMaterials.length === 0) {
        console.warn(
          "[Player] Ship model missing Engine_ meshes; engine glow disabled.",
        );
      }

      this.camera.add(this.exteriorRef);
      prefracturePlayerShip(this.exteriorRef);
      if (this.xrManager) this._reparentToRig();
    };

    const cached = getCachedExteriorShip();
    if (cached) {
      applyExterior(cached.clone());
      return;
    }

    const loader = new GLTFLoader();
    loader.load(
      "./gltf/Heavy_EXT_02.glb",
      (gltf) => applyExterior(gltf.scene),
      undefined,
      (err) => console.error("Exterior ref load error:", err),
    );
  }

  _getActiveDialogAvatarRenderer(speakerId = "alcair") {
    if (this.dialogSpeakerRenderers[speakerId]) {
      return {
        speakerId,
        renderer: this.dialogSpeakerRenderers[speakerId],
      };
    }

    if (this.dialogSpeakerRenderers.alcair) {
      return {
        speakerId: "alcair",
        renderer: this.dialogSpeakerRenderers.alcair,
      };
    }

    const [fallbackSpeakerId, fallbackRenderer] =
      Object.entries(this.dialogSpeakerRenderers)[0] ?? [];
    if (fallbackRenderer) {
      return {
        speakerId: fallbackSpeakerId,
        renderer: fallbackRenderer,
      };
    }

    return {
      speakerId: "alcair",
      renderer: this.vrmAvatarRenderer,
    };
  }

  _applyHoloSpeakerNow(next) {
    this.activeDialogSpeakerId = next.speakerId;
    if (this.visemeHoloUniforms?.uTexture && next.renderer) {
      this.visemeHoloUniforms.uTexture.value = next.renderer.getTexture();
    }
    if (this.visemeHoloUniforms?.uUvOffset) {
      this.visemeHoloUniforms.uUvOffset.value.set(0, 0);
    }
    if (this.visemeHoloUniforms?.uUvRepeat) {
      this.visemeHoloUniforms.uUvRepeat.value.set(1, 1);
    }
  }

  _finishHoloSpeakerSwitchImmediate() {
    const tr = this._holoSpeakerTransition;
    if (!tr) return;
    this._applyHoloSpeakerNow({
      speakerId: tr.toSpeakerId,
      renderer: tr.toRenderer,
    });
    if (this.visemeHoloUniforms?.uNoiseStatic) {
      this.visemeHoloUniforms.uNoiseStatic.value = 0;
    }
    this._holoSpeakerTransition = null;
  }

  _beginHoloDialogEndOutro() {
    if (this._holoSpeakerTransition?.phase === "dialogEndOut") return;
    if (this._holoSpeakerTransition) {
      this._finishHoloSpeakerSwitchImmediate();
    }
    const outDur = 0.14 + Math.random() * 0.12;
    this._holoSpeakerTransition = {
      phase: "dialogEndOut",
      t: 0,
      outDur,
    };
    if (this.visemeHoloUniforms?.uNoiseStatic) {
      this.visemeHoloUniforms.uNoiseStatic.value = 1;
    }
    proceduralAudio.holoDisplayStaticBurble(outDur);
  }

  _beginHoloSpeakerSwitch(toSpeakerId, toRenderer) {
    if (this._holoSpeakerTransition) {
      this._finishHoloSpeakerSwitchImmediate();
    }
    const inDur = 0.11 + Math.random() * 0.09;
    const holdDur = 0.05 + Math.random() * 0.07;
    const outDur = 0.14 + Math.random() * 0.12;
    this._holoSpeakerTransition = {
      toSpeakerId,
      toRenderer,
      phase: "in",
      t: 0,
      inDur,
      holdDur,
      outDur,
    };
    proceduralAudio.holoDisplayStaticBurble(inDur + holdDur + outDur);
  }

  _updateHoloSpeakerTransition(delta) {
    const u = this.visemeHoloUniforms;
    if (!u?.uNoiseStatic || !this._holoSpeakerTransition) return;
    const tr = this._holoSpeakerTransition;
    tr.t += delta;
    const smootherstep = (x) =>
      x * x * x * (x * (x * 6 - 15) + 10);

    if (tr.phase === "dialogEndOut") {
      const p = Math.min(1, tr.t / tr.outDur);
      u.uNoiseStatic.value = smootherstep(1 - p);
      if (p >= 1) {
        u.uNoiseStatic.value = 0;
        this._holoSpeakerTransition = null;
        this.activeDialogSpeakerId = null;
        if (u.uAlpha) u.uAlpha.value = 0;
      }
      return;
    }

    if (tr.phase === "in") {
      const p = Math.min(1, tr.t / tr.inDur);
      u.uNoiseStatic.value = smootherstep(p);
      if (p >= 1) {
        tr.phase = "hold";
        tr.t = 0;
      }
    } else if (tr.phase === "hold") {
      u.uNoiseStatic.value = 1;
      if (tr.t >= tr.holdDur) {
        this._applyHoloSpeakerNow({
          speakerId: tr.toSpeakerId,
          renderer: tr.toRenderer,
        });
        tr.phase = "out";
        tr.t = 0;
      }
    } else if (tr.phase === "out") {
      const p = Math.min(1, tr.t / tr.outDur);
      u.uNoiseStatic.value = smootherstep(1 - p);
      if (p >= 1) {
        u.uNoiseStatic.value = 0;
        this._holoSpeakerTransition = null;
      }
    }
  }

  _updateVisemeHolo(delta) {
    if (this.visemeHoloUniforms?.uTime) {
      this.visemeHoloTime += delta;
      this.visemeHoloUniforms.uTime.value = this.visemeHoloTime;
    }
    this._updateHoloSpeakerTransition(delta);
  }

  _setActiveDialogSpeaker(speakerId = null, opts = {}) {
    if (speakerId == null) {
      if (
        opts.dialogEndOutro &&
        this.visemeHoloUniforms?.uAlpha &&
        this.visemeHoloUniforms.uAlpha.value > 0.001
      ) {
        this._beginHoloDialogEndOutro();
        return null;
      }
      if (this._holoSpeakerTransition && this.visemeHoloUniforms?.uNoiseStatic) {
        this.visemeHoloUniforms.uNoiseStatic.value = 0;
      }
      this._holoSpeakerTransition = null;
      this.activeDialogSpeakerId = null;
      if (this.visemeHoloUniforms?.uAlpha) {
        this.visemeHoloUniforms.uAlpha.value = 0;
      }
      return null;
    }

    if (this._holoSpeakerTransition?.phase === "dialogEndOut") {
      if (this.visemeHoloUniforms?.uNoiseStatic) {
        this.visemeHoloUniforms.uNoiseStatic.value = 0;
      }
      this._holoSpeakerTransition = null;
    }

    if (this.visemeHoloUniforms?.uAlpha) {
      this.visemeHoloUniforms.uAlpha.value = 1.0;
    }

    const next = this._getActiveDialogAvatarRenderer(speakerId);
    if (opts.forceNotify) {
      if (this._holoSpeakerTransition && this.visemeHoloUniforms?.uNoiseStatic) {
        this.visemeHoloUniforms.uNoiseStatic.value = 0;
      }
      this._holoSpeakerTransition = null;
      this._applyHoloSpeakerNow(next);
      return next.renderer;
    }

    const prevId = this.activeDialogSpeakerId;

    if (
      prevId != null &&
      prevId !== next.speakerId &&
      this.visemeHoloUniforms &&
      next.renderer &&
      this.visemeHoloUniforms.uNoiseStatic
    ) {
      this._beginHoloSpeakerSwitch(next.speakerId, next.renderer);
      return next.renderer;
    }

    this._applyHoloSpeakerNow(next);
    return next.renderer;
  }

  _updateDialogAvatarRenderers(delta) {
    const renderer = this.game?.renderer;
    if (Object.keys(this.dialogSpeakerRenderers).length > 0 && renderer) {
      // Only the holo-visible avatar(s) render to their 512x512 targets: the
      // active speaker plus, mid static-burst switch, the incoming one. Idle
      // avatars skip their offscreen render entirely.
      const active = this.activeDialogSpeakerId
        ? this.dialogSpeakerRenderers[this.activeDialogSpeakerId]
        : null;
      const pending = this._holoSpeakerTransition?.toRenderer ?? null;
      if (active) active.update(renderer, delta);
      if (pending && pending !== active) pending.update(renderer, delta);
      return;
    }

    if (this.vrmAvatarRenderer && renderer) {
      this.vrmAvatarRenderer.update(renderer, delta);
    } else {
      this.lipSyncManager?.updateAnalysis();
    }
  }

  loadCockpit(scene) {
    const loader = new GLTFLoader();
    loader.load(
      "./gltf/Heavy_INT_05.glb",
      (gltf) => {
        this.cockpit = gltf.scene;
        this.cockpit.scale.setScalar(1.0);

        // Debug: log bounds to find correct seat position
        const box = new THREE.Box3().setFromObject(this.cockpit);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        console.log("[Cockpit] Bounds min:", box.min, "max:", box.max);
        console.log("[Cockpit] Size:", size, "Center:", center);

        // Test: place cockpit directly in front of camera at -Z
        this.cockpit.position.set(0, 0, 5.35);
        this.cockpit.rotation.set(0, Math.PI, 0);
        console.log("[Cockpit] Test position: (0, 0, -5), no rotation");

        // Log all meshes and make canopy/glass transparent
        this.cockpit.traverse((child) => {
          if (child.isMesh) {
            console.log(
              "[Cockpit] Mesh:",
              child.name,
              "visible:",
              child.visible,
              "material:",
              child.material?.type,
            );
          }
        });

        const cockpitLight = new THREE.PointLight(0x88aaff, 1, 5);
        cockpitLight.position.set(0, 0.2, 0);
        this.cockpit.add(cockpitLight);

        const screenRMesh = findCockpitDisplayMesh(this.cockpit, [
          "Screen_R",
          "Visor_R",
          "Holo_R",
        ]);
        const screenLMesh = findCockpitDisplayMesh(this.cockpit, [
          "Screen_L",
          "Cube.027",
          "Holo_L",
          "Display_L",
        ]);
        if (screenLMesh) {
          this.setupCockpitStatusDisplay(screenLMesh);
        } else {
          logCockpitMeshNamesForDebug(
            this.cockpit,
            "Left status holo: no mesh (tried Screen_L, Cube.027)",
          );
        }
        if (screenRMesh) {
          const uniforms = {
            uTexture: { value: null },
            uTime: { value: 0 },
            uHoloColor: { value: new THREE.Vector3(0.0, 0.85, 0.95) },
            uScanLineIntensity: { value: 0.4 },
            uAlpha: { value: 0 },
            uUvOffset: { value: new THREE.Vector2(0, 0) },
            uUvRepeat: { value: new THREE.Vector2(1, 1) },
            uNoiseStatic: { value: 0 },
          };
          const mat = new THREE.ShaderMaterial({
            vertexShader: hologramVertexShader,
            fragmentShader: hologramFragmentShader,
            uniforms,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
          });
          const visemeMesh = createProjectedScreenMesh(screenRMesh, mat);
          this.visemeHoloUniforms = uniforms;
          const visemeGeom = visemeMesh.geometry;
          const pos = visemeGeom.attributes.position;
          const count = pos.count;

          const loadSpeakerRenderer = async (speakerId) => {
            const speaker = dialogSpeakers[speakerId];
            if (!speaker?.vrmUrl) return null;
            const renderer = new VRMAvatarRenderer({
              vrmUrl: speaker.vrmUrl,
              cameraOffset: speaker.cameraOffset,
            });
            await renderer.loadVRM();
            this.dialogSpeakerRenderers[speakerId] = renderer;
            if (speakerId === "alcair") {
              this.vrmAvatarRenderer = renderer;
            }
            return renderer;
          };

          const initializeDialogManager = async () => {
            if (!this.game?.gameManager) return;
            const { DialogManager } = await import("../ui/DialogManager.js");
            const dm = new DialogManager({
              gameManager: this.game.gameManager,
              musicManager: this.game.musicManager ?? null,
              speakerRenderers: this.dialogSpeakerRenderers,
              defaultSpeakerId: "alcair",
              onSpeakerChanged: (speakerId, _renderer, opts) =>
                this._setActiveDialogSpeaker(speakerId, opts),
              captionParent: this.camera,
            });
            await dm.initialize();
            this.game.dialogManager = dm;
          };

          const setupViseme2DFallback = () => {
              const margin = 0.02;
              const cellSize = 1 / 4;
              const displaySize = cellSize * (1 - margin * 2);
              const texLoader = new THREE.TextureLoader();
              texLoader.load(
                "./textures/ComfyUI_00429_.png",
                (texture) => {
                  uniforms.uTexture.value = texture;
                  uniforms.uUvOffset.value.set(
                    cellSize * margin,
                    3 / 4 + cellSize * margin,
                  );
                  uniforms.uUvRepeat.value.set(displaySize, displaySize);
                  const uvs = visemeGeom.attributes.uv.array;
                  for (let i = 0; i < count; i++) {
                    const u = uvs[i * 2];
                    const v = THREE.MathUtils.clamp(
                      (uvs[i * 2 + 1] - 0.2) / 0.6,
                      0,
                      1,
                    );
                    uvs[i * 2] = 0.125 + v * 0.75;
                    uvs[i * 2 + 1] = u;
                  }
                  visemeGeom.attributes.uv.needsUpdate = true;
                  this.lipSyncManager = new LipSyncManager({
                    onFrameChange: (frameIndex, uv) => {
                      uniforms.uUvOffset.value.set(uv.u, uv.v);
                      uniforms.uUvRepeat.value.set(uv.uSize, uv.vSize);
                    },
                  });
                  const setVisemeFrame = (frameIndex) => {
                    const uv = this.lipSyncManager.getUV(frameIndex);
                    uniforms.uUvOffset.value.set(uv.u, uv.v);
                    uniforms.uUvRepeat.value.set(uv.uSize, uv.vSize);
                  };
                  setVisemeFrame(this.lipSyncManager.visemeFrames.silence);
                  this.lipSyncManager.initialize().then(async () => {
                    if (!this.game?.gameManager) return;
                    const { DialogManager } =
                      await import("../ui/DialogManager.js");
                    const dm = new DialogManager({
                      gameManager: this.game.gameManager,
                      musicManager: this.game.musicManager ?? null,
                      lipSyncManager: this.lipSyncManager,
                      captionParent: this.camera,
                    });
                    await dm.initialize();
                    this.game.dialogManager = dm;
                    this._setActiveDialogSpeaker(null);
                  });
                },
                undefined,
                (e) =>
                  console.warn("[Cockpit] 2D viseme texture load failed:", e),
              );
          };

          Promise.allSettled(
            Object.keys(dialogSpeakers).map((speakerId) =>
              loadSpeakerRenderer(speakerId),
            ),
          )
            .then(async (results) => {
              const loadedRenderers = results
                .filter((result) => result.status === "fulfilled")
                .map((result) => result.value)
                .filter(Boolean);

              if (loadedRenderers.length > 0) {
                this._setActiveDialogSpeaker(null);
                await initializeDialogManager();
                return;
              }

              console.warn("[Cockpit] VRM load failed, using 2D viseme.");
              setupViseme2DFallback();
            })
            .catch((err) => {
              console.warn("[Cockpit] Speaker avatar setup failed:", err);
            });
        } else {
          logCockpitMeshNamesForDebug(
            this.cockpit,
            "Right holo / dialog: no mesh (tried Screen_R, Visor_R)",
          );
        }

        this.camera.add(this.cockpit);
        console.log("Cockpit loaded");
        this._resolveCockpitLoaded?.();

        if (this.xrManager) {
          this._reparentToRig();
        }
        if (this.game) refreshCockpitVisibility(this.game);
      },
      undefined,
      (err) => {
        console.error("Cockpit load error:", err);
        this._resolveCockpitLoaded?.();
      },
    );
  }

  setupCockpitStatusDisplay(screenMesh) {
    const canvas = document.createElement("canvas");
    canvas.width = COCKPIT_STATUS_CANVAS_SIZE;
    canvas.height = COCKPIT_STATUS_CANVAS_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const uniforms = {
      uTexture: { value: texture },
      uTime: { value: 0 },
      uHoloColor: { value: new THREE.Vector3(0.12, 1.0, 0.88) },
      uScanLineIntensity: { value: 0.45 },
      uAlpha: { value: 1.0 },
      uUvOffset: { value: new THREE.Vector2(0, 0) },
      uUvRepeat: { value: new THREE.Vector2(1, 1) },
      uNoiseStatic: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: hologramVertexShader,
      fragmentShader: hologramFragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.cockpitStatusCanvas = canvas;
    this.cockpitStatusContext = context;
    this.cockpitStatusTexture = texture;
    this.cockpitStatusUniforms = uniforms;
    this.cockpitStatusIcons = {
      shields: this.createCockpitStatusIcon("/images/ui/shields.png"),
      missiles: this.createCockpitStatusIcon("/images/ui/missiles.png"),
      thrust: this.createCockpitStatusIcon("/images/ui/booster-rockets.png"),
    };
    this._cockpitStatusScreenMesh = createProjectedScreenMesh(screenMesh, material, {
      renderOrder: 9008,
      rotateQuarterTurns: 3,
    });
    this.cockpitStatusState = {
      healthPercent: null,
      missiles: null,
      maxMissiles: null,
      boostPercent: null,
      overboostActive: false,
      missileMode: null,
    };
    this.updateCockpitStatusDisplay();
  }

  createCockpitStatusIcon(src) {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => this.drawCockpitStatusDisplay(), {
      once: true,
    });
    image.src = src;
    return image;
  }

  updateCockpitStatusDisplay(status = {}) {
    const nextState = {
      healthPercent: Math.max(
        0,
        Math.round(
          status.healthPercent ??
            (this.health / Math.max(1, this.maxHealth || 1)) * 100,
        ),
      ),
      missiles: Math.max(0, Math.round(status.missiles ?? this.missiles ?? 0)),
      maxMissiles: Math.max(
        1,
        Math.round(
          status.maxMissiles ?? this.maxMissiles ?? this.missiles ?? 1,
        ),
      ),
      boostPercent: Math.max(
        0,
        Math.round(
          status.boostPercent ??
            (this.boostFuel / Math.max(1, this.maxBoostFuel || 1)) * 100,
        ),
      ),
      overboostActive: status.overboostActive ?? this.overboostActive === true,
      missileMode:
        status.missileMode ?? this.game?.getSelectedMissileMode?.() ?? "homing",
    };
    const prev = this.cockpitStatusState;
    if (
      prev.healthPercent === nextState.healthPercent &&
      prev.missiles === nextState.missiles &&
      prev.maxMissiles === nextState.maxMissiles &&
      prev.boostPercent === nextState.boostPercent &&
      prev.overboostActive === nextState.overboostActive &&
      prev.missileMode === nextState.missileMode
    ) {
      return;
    }
    this.cockpitStatusState = nextState;
    this.drawCockpitStatusDisplay();
  }

  drawCockpitStatusDisplay() {
    const ctx = this.cockpitStatusContext;
    const texture = this.cockpitStatusTexture;
    if (!ctx || !texture) return;

    const { width, height } = this.cockpitStatusCanvas;
    const panelWidth = Math.min(width * 0.54, 552);
    const panelX = (width - panelWidth) * 0.5 - 10;
    const topPadding = 0;
    const bottomPadding = 96;
    const rowCenters = [0, 1, 2].map(
      (index) =>
        topPadding +
        ((height - topPadding - bottomPadding) * (index + 0.5)) / 3,
    );
    const iconSize = 208;
    const iconX = panelX;
    const valueRightX = panelX + panelWidth - 36;
    const barX = panelX + 4;
    const barRightX = panelX + panelWidth - 42;
    const barWidth = barRightX - barX;
    const barHeight = 30;
    const rows = [
      {
        label: "SHIELDS",
        value: `${this.cockpitStatusState.healthPercent}%`,
        ratio: THREE.MathUtils.clamp(
          this.cockpitStatusState.healthPercent / 100,
          0,
          1,
        ),
        icon: this.cockpitStatusIcons.shields,
      },
      {
        label: "THRUST",
        value: `${this.cockpitStatusState.boostPercent}%`,
        ratio: THREE.MathUtils.clamp(
          this.cockpitStatusState.overboostActive
            ? 1
            : this.cockpitStatusState.boostPercent / 100,
          0,
          1,
        ),
        icon: this.cockpitStatusIcons.thrust,
        overboost: this.cockpitStatusState.overboostActive,
        modeLabel: this.cockpitStatusState.overboostActive ? "OVERDRIVE" : null,
      },
      {
        label: "MISSILES",
        value: `${this.cockpitStatusState.missiles}/${this.cockpitStatusState.maxMissiles}`,
        ratio: THREE.MathUtils.clamp(
          this.cockpitStatusState.missiles /
            Math.max(1, this.cockpitStatusState.maxMissiles),
          0,
          1,
        ),
        icon: this.cockpitStatusIcons.missiles,
        modeLabel:
          this.cockpitStatusState.missileMode === "kinetic"
            ? "KINETIC"
            : "HOMING",
      },
    ];

    ctx.clearRect(0, 0, width, height);

    rows.forEach((row, index) => {
      const centerY = rowCenters[index];
      const iconY = centerY - iconSize * 0.5 - 18;
      const valueY = centerY - (row.modeLabel ? -20 : 0);
      const barY = iconY + iconSize + 18;

      if (row.icon?.complete && row.icon.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = 0.98;
        ctx.drawImage(row.icon, iconX, iconY, iconSize, iconSize);
        ctx.restore();
      }

      const valueColor = row.overboost
        ? "rgba(255, 128, 36, 0.98)"
        : "rgba(225, 255, 255, 0.96)";
      ctx.fillStyle = valueColor;
      ctx.textBaseline = "middle";
      if (row.modeLabel) {
        ctx.font = '700 65px "Rajdhani", "Courier New", monospace';
        ctx.textAlign = "right";
        ctx.fillStyle = valueColor;
        ctx.fillText(row.modeLabel, valueRightX, centerY - 52);
      }
      ctx.font = '700 92px "Orbitron", "Rajdhani", monospace';
      ctx.textAlign = "right";
      ctx.fillStyle = valueColor;
      ctx.fillText(row.value, valueRightX, valueY);
      ctx.textBaseline = "alphabetic";

      ctx.save();
      ctx.fillStyle = "rgba(80, 170, 170, 0.14)";
      ctx.strokeStyle = "rgba(180, 255, 255, 0.22)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(barX, barY, barWidth, barHeight, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = row.overboost
        ? "rgba(255, 128, 36, 0.95)"
        : "rgba(235, 255, 255, 0.95)";
      ctx.beginPath();
      ctx.roundRect(
        barX + 4,
        barY + 4,
        (barWidth - 8) * row.ratio,
        barHeight - 8,
        8,
      );
      ctx.fill();
      ctx.restore();
    });

    texture.needsUpdate = true;
  }

  setXRMode(xrManager) {
    if (this.xrManager) {
      this.xrManager.onSessionEnd = null;
    }
    this.xrManager = xrManager;
    if (xrManager) {
      xrManager.onSessionEnd = () => this._restoreCockpitFromXR();
      this._reparentToRig();
    }
  }

  _restoreCockpitFromXR() {
    if (!this.xrManager) return;
    const rig = this.xrManager.rig;
    if (this.cockpit && this.cockpit.parent === rig) {
      rig.remove(this.cockpit);
      this.cockpit.scale.setScalar(1.0);
      this.cockpit.position.set(0, 0, 5.35);
      this.camera.add(this.cockpit);
    }
    if (this.exteriorRef && this.exteriorRef.parent === rig) {
      rig.remove(this.exteriorRef);
      this.exteriorRef.position.set(0, 0, 0);
      this.camera.add(this.exteriorRef);
    }
  }

  _reparentToRig() {
    if (!this.xrManager) return;
    const rig = this.xrManager.rig;

    if (this.cockpit && this.cockpit.parent === this.camera) {
      this.camera.remove(this.cockpit);
      this.cockpit.scale.setScalar(1.5);
      this.cockpit.position.set(0, 0.8, 8.25);
      rig.add(this.cockpit);
    }
    if (this.exteriorRef && this.exteriorRef.parent === this.camera) {
      this.camera.remove(this.exteriorRef);
      rig.add(this.exteriorRef);
    }
    if (this.headlight && this.headlight.parent === this.camera) {
      this.camera.remove(this.headlight);
      this.camera.remove(this.headlight.target);
      rig.add(this.headlight);
      rig.add(this.headlight.target);
    }
  }

  updateXR(delta, elapsedTime) {
    const xr = this.xrManager;
    const rig = xr.rig;

    _right.set(1, 0, 0).applyQuaternion(rig.quaternion);
    _up.set(0, 1, 0).applyQuaternion(rig.quaternion);
    _forward.set(0, 0, -1).applyQuaternion(rig.quaternion);

    const lookSens = (window.gameManager?.getLookSensitivity?.() ?? 0.65) / 0.8;
    const lookSpeed = 0.95 * lookSens;
    if (Math.abs(xr.lookInput.x) > 0.02 || Math.abs(xr.lookInput.y) > 0.02) {
      _yawQuat.setFromAxisAngle(_up, xr.lookInput.x * lookSpeed * delta);
      _pitchQuat.setFromAxisAngle(_right, xr.lookInput.y * lookSpeed * delta);

      rig.quaternion.premultiply(_pitchQuat);
      rig.quaternion.premultiply(_yawQuat);
      rig.quaternion.normalize();
    }

    // Left hand transient-pointer: thrust (Y) + strafe (X)
    _accel.set(0, 0, 0);
    if (Math.abs(xr.moveInput.y) > 0.05) {
      _accel.addScaledVector(_forward, xr.moveInput.y);
    }
    if (Math.abs(xr.moveInput.x) > 0.05) {
      _accel.addScaledVector(_right, xr.moveInput.x);
    }

    if (_accel.lengthSq() > 0) {
      _accel.normalize().multiplyScalar(this.acceleration * delta);
      this.velocity.add(_accel);
    }

    const effectiveMaxSpeed = this.maxSpeed * (this.overboostMultiplier ?? 1);
    if (this.velocity.lengthSq() > effectiveMaxSpeed * effectiveMaxSpeed) {
      this.velocity.normalize().multiplyScalar(effectiveMaxSpeed);
    }
    const frameScale = Math.min(
      delta * MOVEMENT_REFERENCE_HZ,
      MOVEMENT_FRAME_SCALE_MAX,
    );
    this.velocity.multiplyScalar(Math.pow(this.drag, frameScale));

    _moveAndSlide(rig.position, this.velocity, frameScale, this.collisionRadius);

    const speed = this.velocity.length();
    const idle = Math.max(0, 1 - speed / IDLE_VELOCITY_THRESHOLD);
    if (idle > 0) {
      const t = elapsedTime;
      _up.set(0, 1, 0).applyQuaternion(rig.quaternion);
      _right.set(1, 0, 0).applyQuaternion(rig.quaternion);
      _forward.set(0, 0, -1).applyQuaternion(rig.quaternion);
      rig.position.addScaledVector(
        _up,
        Math.sin(t * IDLE_BOB_SPEED) * IDLE_BOB_POS_AMP * idle,
      );
      rig.position.addScaledVector(
        _right,
        Math.sin(t * IDLE_BOB_SPEED * 0.73 + 1) *
          IDLE_BOB_POS_AMP *
          0.75 *
          idle,
      );
      rig.position.addScaledVector(
        _forward,
        Math.sin(t * IDLE_BOB_SPEED * 0.5 + 2) * IDLE_BOB_POS_AMP * 0.5 * idle,
      );
      _pitchQuat.setFromAxisAngle(
        _right,
        Math.sin(t * 0.42) * IDLE_BOB_ANGLE_AMP * idle,
      );
      _yawQuat.setFromAxisAngle(
        _up,
        Math.sin(t * 0.38 + 0.5) * IDLE_BOB_ANGLE_AMP * idle,
      );
      rig.quaternion.premultiply(_yawQuat).premultiply(_pitchQuat).normalize();
    }

    if (this.engineMaterials.length > 0) {
      this.engineGlowTarget = this.overboostActive || this.isBoosting
        ? 1
        : Math.min(1, this.velocity.length() / this.maxSpeed);
      this.engineGlowT +=
        (this.engineGlowTarget - this.engineGlowT) * Math.min(1, delta * 4);
      const boostGlow = this.overboostActive || this.isBoosting ? 1 : 0;
      for (const mat of this.engineMaterials) {
        if (!mat.color || !mat.emissive) continue;
        mat.color.lerpColors(
          _engineColorBlack,
          boostGlow > 0 ? _engineColorBoost : _engineColorGlow,
          this.engineGlowT,
        );
        mat.emissive.lerpColors(
          _engineColorBlack,
          boostGlow > 0 ? _engineColorBoost : _engineColorGlow,
          this.engineGlowT,
        );
        mat.emissiveIntensity =
          boostGlow > 0 ? 2.2 : 0.05 + 0.25 * this.engineGlowT;
      }
    }

    const gunRecover = 1 - Math.exp(-GUN_RETRACT_RECOVERY * delta);
    if (this.gunL?.userData.restPosition) {
      this.gunRetractionL = Math.max(
        0,
        this.gunRetractionL - this.gunRetractionL * gunRecover,
      );
      this.gunL.position.copy(this.gunL.userData.restPosition);
      this.gunL.position.z -= this.gunRetractionL;
    }
    if (this.gunR?.userData.restPosition) {
      this.gunRetractionR = Math.max(
        0,
        this.gunRetractionR - this.gunRetractionR * gunRecover,
      );
      this.gunR.position.copy(this.gunR.userData.restPosition);
      this.gunR.position.z -= this.gunRetractionR;
    }
    this._updateDialogAvatarRenderers(delta);
    this._updateVisemeHolo(delta);
    if (this.cockpitStatusUniforms?.uTime) {
      this.cockpitStatusTime += delta;
      this.cockpitStatusUniforms.uTime.value = this.cockpitStatusTime;
    }
  }

  triggerGunRecoil(fromLeft) {
    if (fromLeft && this.gunL) this.gunRetractionL = GUN_RETRACT_AMOUNT;
    else if (!fromLeft && this.gunR) this.gunRetractionR = GUN_RETRACT_AMOUNT;
  }

  getWeaponSpawnPoint() {
    if (this.gunL && this.gunR) {
      const gun = this.fireFromLeft ? this.gunL : this.gunR;
      this.fireFromLeft = !this.fireFromLeft;
      const out = new THREE.Vector3();
      gun.getWorldPosition(out);
      return out;
    }
    const pos = this.xrManager
      ? this.xrManager.rig.position
      : this.camera.position;
    const quat = this.xrManager
      ? this.xrManager.rig.quaternion
      : this.camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(quat);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const sideOffset = this.fireFromLeft ? -0.4 : 0.4;
    this.fireFromLeft = !this.fireFromLeft;
    return pos
      .clone()
      .add(right.multiplyScalar(sideOffset))
      .add(down.multiplyScalar(0.3))
      .add(forward.multiplyScalar(0.5));
  }

  getMissileSpawnPoint() {
    if (this.missileL && this.missileR) {
      const launcher = this.missileFromLeft ? this.missileL : this.missileR;
      this.missileFromLeft = !this.missileFromLeft;
      const out = new THREE.Vector3();
      launcher.getWorldPosition(out);
      return out;
    }
    const pos = this.xrManager
      ? this.xrManager.rig.position
      : this.camera.position;
    const quat = this.xrManager
      ? this.xrManager.rig.quaternion
      : this.camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(quat);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const sideOffset = this.missileFromLeft ? -0.5 : 0.5;
    this.missileFromLeft = !this.missileFromLeft;
    return pos
      .clone()
      .add(right.multiplyScalar(sideOffset))
      .add(down.multiplyScalar(0.35))
      .add(forward.multiplyScalar(0.4));
  }

  /**
   * Like Descent's PF_LEVELLING: roll about forward so ship "up" stays at the nearest
   * cardinal angle (0°, ±90°, 180°) to world up on the plane perpendicular to forward,
   * not only wings-level — so you can park on a 90° bank and hold it.
   */
  _applyShipAutoLeveling(delta, hasRollInput) {
    if (this.game?.gameManager?.getState?.()?.shipAutoLeveling === false) {
      return;
    }
    if (hasRollInput) return;
    if (Math.abs(this.rollVelocity) > SHIP_AUTO_LEVEL_SKIP_ROLL_VEL) return;

    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (
      Math.abs(_forward.dot(_shipAutoWorldUp)) >
      SHIP_AUTO_LEVEL_FORWARD_UP_DOT_MAX
    ) {
      return;
    }

    _shipAutoDesiredUp.copy(_shipAutoWorldUp);
    _shipAutoDesiredUp.addScaledVector(
      _forward,
      -_shipAutoWorldUp.dot(_forward),
    );
    const dLenSq = _shipAutoDesiredUp.lengthSq();
    if (dLenSq < 1e-14) return;
    _shipAutoDesiredUp.multiplyScalar(1 / Math.sqrt(dLenSq));

    _up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    _shipAutoUpProj.copy(_up).addScaledVector(_forward, -_up.dot(_forward));
    const pLenSq = _shipAutoUpProj.lengthSq();
    if (pLenSq < 1e-14) return;
    _shipAutoUpProj.multiplyScalar(1 / Math.sqrt(pLenSq));

    const rawDot = THREE.MathUtils.clamp(
      _shipAutoUpProj.dot(_shipAutoDesiredUp),
      -1,
      1,
    );
    let angle = Math.acos(rawDot);

    _shipAutoCross.crossVectors(_shipAutoUpProj, _shipAutoDesiredUp);
    const axial = _shipAutoCross.dot(_forward);
    if (Math.abs(axial) < 1e-10) return;
    angle *= Math.sign(axial);

    const halfPi = Math.PI * 0.5;
    const residual = angle - Math.round(angle / halfPi) * halfPi;
    if (Math.abs(residual) < SHIP_AUTO_LEVEL_MIN_ANGLE) return;

    const errAbs = Math.abs(residual);
    const k = 1 - Math.exp(-SHIP_AUTO_LEVEL_RESPONSE * delta);
    let step = residual * k;
    const capRamp = THREE.MathUtils.smoothstep(
      SHIP_AUTO_LEVEL_CAP_RAMP_LOW,
      SHIP_AUTO_LEVEL_CAP_RAMP_HIGH,
      errAbs,
    );
    const maxStep =
      SHIP_AUTO_LEVEL_RAD_PER_SEC *
      delta *
      (SHIP_AUTO_LEVEL_CAP_MIN_MULT +
        (1 - SHIP_AUTO_LEVEL_CAP_MIN_MULT) * capRamp);
    if (Math.abs(step) > maxStep) {
      step = Math.sign(residual) * maxStep;
    }

    _rollQuat.setFromAxisAngle(_forward, step);
    this.camera.quaternion.premultiply(_rollQuat);
    this.camera.quaternion.normalize();
  }

  update(delta, elapsedTime = 0) {
    if (this.xrManager) {
      this.updateXR(delta, elapsedTime);
      return;
    }
    this._updateDialogAvatarRenderers(delta);
    this._updateVisemeHolo(delta);
    if (this.cockpitStatusUniforms?.uTime) {
      this.cockpitStatusTime += delta;
      this.cockpitStatusUniforms.uTime.value = this.cockpitStatusTime;
    }

    this.automap.update(delta, this.camera.position, this.game?.enemies);

    const keys = this.input.keys;
    const gp = this.input.gamepad;
    const useGamepad = this.input.isGamepadMode();
    const mouse = this.input.consumeMouse();

    // Toggle headlight (intensity only - avoid visible toggle which triggers recompilation)
    if (keys.toggleHeadlightJustPressed) {
      this.headlightEnabled = !this.headlightEnabled;
      const headlightIntensity = 40;
      if (this.headlight) {
        this.headlight.intensity = this.headlightEnabled
          ? headlightIntensity
          : 0;
      }
      keys.toggleHeadlightJustPressed = false;
    }

    const controlDelta = Math.min(delta, CONTROL_DELTA_MAX);
    const frameScale = Math.min(
      delta * MOVEMENT_REFERENCE_HZ,
      MOVEMENT_FRAME_SCALE_MAX,
    );
    const lookSens = (window.gameManager?.getLookSensitivity?.() ?? 0.65) / 0.8;

    _up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    if (useGamepad) {
      const gpLookSpeed = 3.1 * lookSens;
      this.pitchVelocity += -gp.lookY * gpLookSpeed * controlDelta;
      this.yawVelocity += -gp.lookX * gpLookSpeed * controlDelta;
    } else {
      this.pitchVelocity += -mouse.y * this.lookAccel * lookSens;
      this.yawVelocity += -mouse.x * this.lookAccel * lookSens;

      const keyLookSpeed = 2.35 * lookSens;
      if (keys.lookUp) this.pitchVelocity += keyLookSpeed * controlDelta;
      if (keys.lookDown) this.pitchVelocity -= keyLookSpeed * controlDelta;
      if (keys.lookLeft) this.yawVelocity += keyLookSpeed * controlDelta;
      if (keys.lookRight) this.yawVelocity -= keyLookSpeed * controlDelta;
    }

    if (Math.abs(this.pitchVelocity) > this.lookMaxSpeed) {
      this.pitchVelocity = Math.sign(this.pitchVelocity) * this.lookMaxSpeed;
    }
    if (Math.abs(this.yawVelocity) > this.lookMaxSpeed) {
      this.yawVelocity = Math.sign(this.yawVelocity) * this.lookMaxSpeed;
    }

    this.pitchVelocity *= Math.pow(this.lookDrag, delta * 60);
    this.yawVelocity *= Math.pow(this.lookDrag, delta * 60);

    _yawQuat.setFromAxisAngle(_up, this.yawVelocity * controlDelta);
    this.camera.quaternion.premultiply(_yawQuat);

    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const maxPitch = Math.PI / 2 - 1e-4;
    let pitchDelta = this.pitchVelocity * controlDelta;
    const pitchNow = Math.asin(THREE.MathUtils.clamp(-_forward.y, -1, 1));
    const pitchAfter = THREE.MathUtils.clamp(
      pitchNow + pitchDelta,
      -maxPitch,
      maxPitch,
    );
    pitchDelta = pitchAfter - pitchNow;
    _pitchQuat.setFromAxisAngle(_right, pitchDelta);
    this.camera.quaternion.premultiply(_pitchQuat);

    let rollInput = 0;
    if (useGamepad) {
      if (gp.rollAnalog && Math.abs(gp.rollAnalog) > 0.1) {
        rollInput = gp.rollAnalog * this.rollAccel * controlDelta;
      } else {
        if (gp.rollLeft) rollInput -= this.rollAccel * controlDelta;
        if (gp.rollRight) rollInput += this.rollAccel * controlDelta;
      }
    } else {
      if (keys.rollLeft) rollInput -= this.rollAccel * controlDelta;
      if (keys.rollRight) rollInput += this.rollAccel * controlDelta;
    }

    this.rollVelocity += rollInput;
    if (Math.abs(this.rollVelocity) > this.rollMaxSpeed) {
      this.rollVelocity = Math.sign(this.rollVelocity) * this.rollMaxSpeed;
    }
    const hasRollInput =
      rollInput !== 0 ||
      (useGamepad && gp.rollAnalog && Math.abs(gp.rollAnalog) > 0.1);
    if (hasRollInput && this.game?.missionManager) {
      this.game.missionManager.reportEvent("rollInput", {
        direction: rollInput < 0 ? "left" : "right",
        amount: rollInput,
      });
    }
    const rollDamp = hasRollInput
      ? Math.pow(this.rollDrag, delta * 60)
      : Math.pow(this.rollDrag, delta * 60) * Math.pow(0.92, delta * 60);
    this.rollVelocity *= rollDamp;

    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _rollQuat.setFromAxisAngle(_forward, this.rollVelocity * controlDelta);
    this.camera.quaternion.premultiply(_rollQuat);
    this.camera.quaternion.normalize();

    this._applyShipAutoLeveling(controlDelta, hasRollInput);

    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Movement
    _accel.set(0, 0, 0);

    if (useGamepad) {
      // Gamepad movement (left stick + d-pad for vertical)
      if (gp.moveY < -0.1) {
        _gpStick.copy(_forward).multiplyScalar(-gp.moveY);
        _accel.add(_gpStick);
      }
      if (gp.moveY > 0.1) {
        _gpStick.copy(_forward).multiplyScalar(gp.moveY);
        _accel.sub(_gpStick);
      }
      if (gp.moveX > 0.1) {
        _gpStick.copy(_right).multiplyScalar(gp.moveX);
        _accel.add(_gpStick);
      }
      if (gp.moveX < -0.1) {
        _gpStick.copy(_right).multiplyScalar(-gp.moveX);
        _accel.sub(_gpStick);
      }
      if (gp.strafeUp) _accel.add(_up);
      if (gp.strafeDown) _accel.sub(_up);
    } else {
      // Keyboard movement
      if (keys.forward) _accel.add(_forward);
      if (keys.backward) _accel.sub(_forward);
      if (keys.right) _accel.add(_right);
      if (keys.left) _accel.sub(_right);
      if (keys.strafeUp) _accel.add(_up);
      if (keys.strafeDown) _accel.sub(_up);
    }

    // Boost logic
    const wantsBoost = useGamepad ? gp.boost : keys.boost;
    if (wantsBoost && this.boostFuel > 0 && _accel.lengthSq() > 0) {
      this.isBoosting = true;
      if (this.overboostActive) {
        this.boostFuel = this.maxBoostFuel;
      } else {
        this.boostFuel = Math.max(
          0,
          this.boostFuel - this.boostDrainRate * delta,
        );
      }
      this.lastBoostTime = elapsedTime;
    } else {
      this.isBoosting = false;
      if (this.overboostActive) {
        this.boostFuel = this.maxBoostFuel;
      }
      // Regenerate boost fuel after delay
      if (
        !this.overboostActive &&
        elapsedTime - this.lastBoostTime >= this.boostRegenDelay
      ) {
        this.boostFuel = Math.min(
          this.maxBoostFuel,
          this.boostFuel + this.boostRegenRate * delta,
        );
      }
    }

    if (_accel.lengthSq() > 0) {
      let accelMod = this.acceleration;
      if (this.isBoosting) {
        accelMod *= this.boostMultiplier;
      }
      accelMod *= this.overboostMultiplier ?? 1;
      _accel.normalize().multiplyScalar(accelMod * delta);
      this.velocity.add(_accel);
    }

    if (this.velocity.lengthSq() > this.maxSpeed * this.maxSpeed) {
      this.velocity.normalize().multiplyScalar(this.maxSpeed);
    }

    this.velocity.multiplyScalar(Math.pow(this.drag, frameScale));

    _moveAndSlide(
      this.camera.position,
      this.velocity,
      frameScale,
      this.collisionRadius,
    );

    const speed = this.velocity.length();
    const idle = Math.max(0, 1 - speed / IDLE_VELOCITY_THRESHOLD);
    if (idle > 0) {
      const t = elapsedTime;
      _up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.camera.position.addScaledVector(
        _up,
        Math.sin(t * IDLE_BOB_SPEED) * IDLE_BOB_POS_AMP * idle,
      );
      this.camera.position.addScaledVector(
        _right,
        Math.sin(t * IDLE_BOB_SPEED * 0.73 + 1) *
          IDLE_BOB_POS_AMP *
          0.75 *
          idle,
      );
      this.camera.position.addScaledVector(
        _forward,
        Math.sin(t * IDLE_BOB_SPEED * 0.5 + 2) * IDLE_BOB_POS_AMP * 0.5 * idle,
      );
      _pitchQuat.setFromAxisAngle(
        _right,
        Math.sin(t * 0.42) * IDLE_BOB_ANGLE_AMP * idle,
      );
      _yawQuat.setFromAxisAngle(
        _up,
        Math.sin(t * 0.38 + 0.5) * IDLE_BOB_ANGLE_AMP * idle,
      );
      this.camera.quaternion
        .premultiply(_yawQuat)
        .premultiply(_pitchQuat)
        .normalize();
    }

    if (this.engineMaterials.length > 0) {
      this.engineGlowTarget = this.isBoosting
        ? 1
        : Math.min(1, this.velocity.length() / this.maxSpeed);
      this.engineGlowT +=
        (this.engineGlowTarget - this.engineGlowT) * Math.min(1, delta * 4);
      const boostGlow = this.isBoosting ? 1 : 0;
      for (const mat of this.engineMaterials) {
        if (!mat.color || !mat.emissive) continue;
        mat.color.lerpColors(
          _engineColorBlack,
          boostGlow > 0 ? _engineColorBoost : _engineColorGlow,
          this.engineGlowT,
        );
        mat.emissive.lerpColors(
          _engineColorBlack,
          boostGlow > 0 ? _engineColorBoost : _engineColorGlow,
          this.engineGlowT,
        );
        mat.emissiveIntensity =
          boostGlow > 0 ? 2.2 : 0.05 + 0.25 * this.engineGlowT;
      }
    }

    const gunRecover = 1 - Math.exp(-GUN_RETRACT_RECOVERY * delta);
    if (this.gunL?.userData.restPosition) {
      this.gunRetractionL = Math.max(
        0,
        this.gunRetractionL - this.gunRetractionL * gunRecover,
      );
      this.gunL.position.copy(this.gunL.userData.restPosition);
      this.gunL.position.z -= this.gunRetractionL;
    }
    if (this.gunR?.userData.restPosition) {
      this.gunRetractionR = Math.max(
        0,
        this.gunRetractionR - this.gunRetractionR * gunRecover,
      );
      this.gunR.position.copy(this.gunR.userData.restPosition);
      this.gunR.position.z -= this.gunRetractionR;
    }
  }
}
