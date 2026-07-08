/**
 * Enemy.js - AI ENEMY SHIP AND SHARED SHIP ASSETS
 * =============================================================================
 *
 * ROLE: AI-controlled enemy ships: movement (wander/waypoints), aim, fire,
 * and death. Loads and shares ship GLTF models and materials. Exports
 * loadShipModels, shipModels, reapplyShipMaterials for SceneManager/combat.
 *
 * KEY RESPONSIBILITIES:
 * - update(delta, gameTime, playerPos, fireCallback): move, face player, fire
 * - takeDamage(amount); on death: spawn destruction (ShipDestruction), remove from game
 * - loadSharedShipMaterials(), loadShipModels(): shared materials and model cache
 * - Optional point light and trails effect; culling by distance
 *
 * RELATED: Physics.js, ShipDestruction.js, gameCombat.js, gameEnemies.js, TrailsEffect.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { castSphere, castRay } from "../physics/Physics.js";
import { updateObjectEnvZoneBlend } from "../utils/cockpitEnvZones.js";
import {
  beginCheckpointDissolve,
  ENEMY_SPAWN_DISSOLVE_DURATION,
} from "../vfx/checkpointDissolveWarp.js";
import { beginSpawnWarp } from "../vfx/spawnWarp.js";
import {
  applyEnvironmentMapToObject,
  FLEET_ENEMY_ENV_MAP_INTENSITY_SCALE,
} from "../utils/envMapAssets.js";
import {
  cloneFleetShipTemplate,
  getFleetShipIndexById,
  isDroneFleetActive,
  loadDroneFleetModels,
  setupFleetDroneCloneMarkers,
} from "./droneFleetLoader.js";

const _direction = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _lookMatrix = new THREE.Matrix4();
const _upVec = new THREE.Vector3(0, 1, 0);
const _newPos = new THREE.Vector3();
const _wanderDir = new THREE.Vector3();
const _toWaypoint = new THREE.Vector3();
const _muzzlePos = new THREE.Vector3();
const _strafeDir = new THREE.Vector3();
const _combatMoveDir = new THREE.Vector3();
const _textureLoader = new THREE.TextureLoader();

export const ENEMY_NORMAL_SHIP_SCALE_MIN = 0.9;
export const ENEMY_NORMAL_SHIP_SCALE_MAX = 1.25;
export const ENEMY_HEAVY_SHIP_SCALE = 4.0;
export const ENEMY_DEFAULT_SHIP_SCALE = 1;
export const ENEMY_SHIP_SCALE_HIT_REFERENCE = 1;

export function randomNormalEnemyShipScaleFactor() {
  return (
    ENEMY_NORMAL_SHIP_SCALE_MIN +
    Math.random() * (ENEMY_NORMAL_SHIP_SCALE_MAX - ENEMY_NORMAL_SHIP_SCALE_MIN)
  );
}

const _authoredScaleVec = new THREE.Vector3();
const _levelRootScaleVec = new THREE.Vector3();

/** World scale of the marker relative to the placed level root (excludes level placement scale). */
export function readAuthoredEnemyMarkerScale(object, levelRoot = null) {
  if (!object) return 1;
  object.getWorldScale(_authoredScaleVec);
  let avg =
    (_authoredScaleVec.x + _authoredScaleVec.y + _authoredScaleVec.z) / 3;
  if (levelRoot) {
    levelRoot.getWorldScale(_levelRootScaleVec);
    const rootAvg =
      (_levelRootScaleVec.x + _levelRootScaleVec.y + _levelRootScaleVec.z) / 3;
    if (rootAvg > 0) avg /= rootAvg;
  }
  return avg > 0 ? avg : 1;
}

export function computeEnemyShipScale({
  isHeavy = false,
  isPortalBot = false,
  authoredScale = 1,
  randomFactor,
} = {}) {
  const authored = authoredScale > 0 ? authoredScale : 1;
  if (isHeavy) return ENEMY_HEAVY_SHIP_SCALE * authored;
  if (isPortalBot) return ENEMY_DEFAULT_SHIP_SCALE * authored;
  const random = randomFactor ?? randomNormalEnemyShipScaleFactor();
  return ENEMY_DEFAULT_SHIP_SCALE * random * authored;
}

let shipModels = [];
let loadPromise = null;
let portalDroneModel = null;
let portalDroneModelPromise = null;
const _deadLights = [];

export function flushRetainedEnemyMeshes(game) {
  if (!game?._retainedEnemyRootMeshes?.length) return;
  for (const root of game._retainedEnemyRootMeshes) {
    root.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose?.();
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const m of mats) {
        if (m?.userData?.enemySharedTemplateMaterial) continue;
        m?.dispose?.();
      }
    });
  }
  game._retainedEnemyRootMeshes.length = 0;
}
let sharedShipMaterials = null;
let sharedShipMaterialsPromise = null;

function publicUrl(path) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
  const clean = path.replace(/^\//, "");
  return base ? `${base}/${clean}` : `/${clean}`;
}

function loadPortalDroneModel() {
  if (portalDroneModel) return Promise.resolve(portalDroneModel);
  if (portalDroneModelPromise) return portalDroneModelPromise;
  const loader = new GLTFLoader();
  portalDroneModelPromise = new Promise((resolve, reject) => {
    loader.load(
      publicUrl("gltf/portal-drone.glb"),
      (gltf) => {
        portalDroneModel = gltf.scene;
        resolve(portalDroneModel);
      },
      undefined,
      reject,
    );
  }).catch((error) => {
    portalDroneModelPromise = null;
    console.warn("[Enemy] Failed to load portal-drone.glb:", error);
    return null;
  });
  return portalDroneModelPromise;
}

function setupPortalDroneClone(enemy, template, scale = 2.4) {
  if (!template || enemy.disposed || enemy._portalDroneModelRoot) return;
  const clone = template.clone();
  clone.scale.setScalar(scale);
  clone.rotation.set(0, Math.PI, 0);
  enemy.engineMarkers.length = 0;
  enemy.weaponMarkers.length = 0;
  clone.traverse((child) => {
    if (!child.isMesh) return;
    const n = child.name?.toLowerCase?.() || "";
    if (n.startsWith("thruster_")) {
      child.visible = false;
      enemy.engineMarkers.push(child);
    } else if (
      n.startsWith("weapon_") ||
      n.includes("laser") ||
      n.includes("cannon") ||
      n.includes("muzzle")
    ) {
      child.visible = false;
      enemy.weaponMarkers.push(child);
    }
    if (Array.isArray(child.material)) {
      child.material = child.material.map((m) => (m?.clone ? m.clone() : m));
    } else if (child.material?.clone) {
      child.material = child.material.clone();
    }
  });

  if (enemy._fallbackShipRoot) enemy._fallbackShipRoot.visible = false;
  enemy.usesPortalDroneModel = true;
  enemy._portalDroneModelRoot = clone;
  enemy.mesh.add(clone);
}

export async function applyPortalDroneModel(enemy, scale = 2.4, game = null) {
  const template = await loadPortalDroneModel();
  if (!template || enemy.disposed) return false;
  setupPortalDroneClone(enemy, template, scale);
  if (enemy._portalDroneModelRoot) {
    enemy.mesh.userData.envZoneSampleObject = enemy._portalDroneModelRoot;
    if (game?.cockpitEnvZones) {
      updateObjectEnvZoneBlend(enemy.mesh, game);
    }
  }
  return true;
}

function hlsToRgb(h, l, s) {
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return new THREE.Color(r, g, b);
}

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function loadSharedShipMaterials() {
  if (sharedShipMaterials) return sharedShipMaterials;
  if (sharedShipMaterialsPromise) return sharedShipMaterialsPromise;

  sharedShipMaterialsPromise = (async () => {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
    const texUrl = (p) =>
      (base ? `${base}/${p}` : `./${p}`).replace(/\/+/g, "/");
    let normalMap = null;
    let hullLightsDiffuse = null;
    let hullLightsEmit = null;
    try {
      normalMap = await _textureLoader.loadAsync(
        texUrl("ships/hull_normal.png"),
      );
      normalMap.colorSpace = THREE.NoColorSpace;
      normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
      normalMap.repeat.set(3, 3);
      normalMap.anisotropy = 4;
    } catch (err) {
      normalMap = null;
      console.warn("[Enemy] Failed to load ./ships/hull_normal.png", err);
    }

    try {
      hullLightsDiffuse = await _textureLoader.loadAsync(
        texUrl("ships/hull_lights_diffuse.png"),
      );
      hullLightsDiffuse.colorSpace = THREE.SRGBColorSpace;
      hullLightsDiffuse.wrapS = hullLightsDiffuse.wrapT = THREE.RepeatWrapping;
      hullLightsDiffuse.repeat.set(3, 3);
      hullLightsDiffuse.anisotropy = 4;
    } catch (err) {
      hullLightsDiffuse = null;
      console.warn(
        "[Enemy] Failed to load ./ships/hull_lights_diffuse.png",
        err,
      );
    }

    try {
      hullLightsEmit = await _textureLoader.loadAsync(
        texUrl("ships/hull_lights_emit.png"),
      );
      hullLightsEmit.colorSpace = THREE.SRGBColorSpace;
      hullLightsEmit.wrapS = hullLightsEmit.wrapT = THREE.RepeatWrapping;
      hullLightsEmit.repeat.set(3, 3);
      hullLightsEmit.anisotropy = 4;
    } catch (err) {
      hullLightsEmit = null;
      console.warn("[Enemy] Failed to load ./ships/hull_lights_emit.png", err);
    }

    sharedShipMaterials = { normalMap, hullLightsDiffuse, hullLightsEmit };
    return sharedShipMaterials;
  })();

  return sharedShipMaterialsPromise;
}

function createShipMaterialSet(index, sharedTex) {
  const rng = seededRng((index + 1) * 7777 + 42);
  const hullBase = hlsToRgb(rng(), 0.04 + rng() * 0.11, 0.05 + rng() * 0.25);
  const darkColor = hullBase.clone().multiplyScalar(0.12);

  let glowHue;
  const pick = rng();
  if (pick < 0.25) glowHue = rng() * 0.12;
  else if (pick < 0.5) glowHue = 0.25 + rng() * 0.17;
  else if (pick < 0.75) glowHue = 0.55 + rng() * 0.17;
  else glowHue = 0.8 + rng() * 0.15;
  const glowColor = hlsToRgb(glowHue, 0.55 + rng() * 0.25, 1.0);

  const hull = new THREE.MeshStandardMaterial({
    color: hullBase,
    map: sharedTex.hullLightsDiffuse ?? null,
    metalness: 0.3,
    roughness: 0.65,
    normalMap: sharedTex.normalMap,
    normalScale: new THREE.Vector2(1, 1),
    side: THREE.DoubleSide,
  });

  const hullLights = new THREE.MeshStandardMaterial({
    color: hullBase,
    map: sharedTex.hullLightsDiffuse,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: sharedTex.hullLightsEmit,
    emissiveIntensity: 2.5,
    metalness: 0.25,
    roughness: 0.6,
    normalMap: sharedTex.normalMap,
    normalScale: new THREE.Vector2(1, 1),
    side: THREE.DoubleSide,
  });

  const hardSurface = new THREE.MeshStandardMaterial({
    color: darkColor,
    metalness: 0.4,
    roughness: 0.55,
    normalMap: sharedTex.normalMap,
    normalScale: new THREE.Vector2(1, 1),
    side: THREE.DoubleSide,
  });

  const engine = new THREE.MeshStandardMaterial({
    color: glowColor,
    emissive: glowColor,
    emissiveIntensity: 8.0,
    metalness: 0.15,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });

  const laserColor = glowColor.clone();
  const hasHullLightMaps = !!(
    sharedTex.hullLightsDiffuse && sharedTex.hullLightsEmit
  );
  return {
    hull,
    hullLights,
    hardSurface,
    engine,
    hasHullLightMaps,
    laserColor,
    laserIntensity: 8.0,
  };
}

function applyRuntimeShipMaterials(root, mats, index) {
  const ensureUv = (geometry) => {
    if (!geometry || geometry.attributes?.uv || !geometry.attributes?.position)
      return;
    const pos = geometry.attributes.position;
    if (!pos || pos.count < 3) return;
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const sx = Math.max(1e-5, bb.max.x - bb.min.x);
    const sy = Math.max(1e-5, bb.max.y - bb.min.y);
    const sz = Math.max(1e-5, bb.max.z - bb.min.z);
    const uAxis = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
    const vAxis =
      uAxis === 0
        ? sy >= sz
          ? 1
          : 2
        : uAxis === 1
          ? sx >= sz
            ? 0
            : 2
          : sx >= sy
            ? 0
            : 1;
    const get = (i, axis) =>
      axis === 0 ? pos.getX(i) : axis === 1 ? pos.getY(i) : pos.getZ(i);
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const su = Math.max(1e-5, [sx, sy, sz][uAxis]);
      const sv = Math.max(1e-5, [sx, sy, sz][vAxis]);
      const minU = [bb.min.x, bb.min.y, bb.min.z][uAxis];
      const minV = [bb.min.x, bb.min.y, bb.min.z][vAxis];
      uv[i * 2 + 0] = (get(i, uAxis) - minU) / su;
      uv[i * 2 + 1] = (get(i, vAxis) - minV) / sv;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.attributes.uv.needsUpdate = true;
  };

  root.traverse((child) => {
    if (!child.isMesh) return;
    ensureUv(child.geometry);
    const n = child.name?.toLowerCase?.() || "";
    if (n.startsWith("engine_") && n.includes("_nozzle")) {
      child.material = mats.engine;
    } else if (n.startsWith("engine_")) {
      // Fallback to non-emissive so we never bloom the whole engine body.
      // If a model lacks explicit nozzle split/groups, this keeps it sane.
      child.material = mats.hardSurface;
    } else if (n.startsWith("turret_")) {
      child.material = mats.hardSurface;
    } else if (n.startsWith("thruster_") || n.startsWith("weapon_")) {
      child.material = mats.hardSurface;
    } else {
      child.material = mats.hasHullLightMaps ? mats.hullLights : mats.hull;
    }
  });
}

function fleetEnemyEnvMapIntensity(intensity, useFleetBotScale = false) {
  if (!useFleetBotScale || !isDroneFleetActive()) return intensity;
  return intensity * FLEET_ENEMY_ENV_MAP_INTENSITY_SCALE;
}

export function applyEnemyShipEnvironmentMap(
  root,
  envMap,
  intensity = 1,
  { useFleetBotScale = false } = {},
) {
  applyEnvironmentMapToObject(
    root,
    envMap,
    fleetEnemyEnvMapIntensity(intensity, useFleetBotScale),
  );
}

export function applyEnemyShipEnvironmentMapToModels(envMap, intensity = 1) {
  const effectiveIntensity = fleetEnemyEnvMapIntensity(intensity, true);
  for (const model of shipModels) {
    applyEnvironmentMapToObject(model, envMap, effectiveIntensity);
  }
}

async function loadManifestPaths() {
  try {
    const res = await fetch("./ships/shipData.json", { cache: "no-cache" });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : data?.ships;
    if (!Array.isArray(list)) return [];
    return list
      .filter((p) => typeof p === "string" && p.trim().length > 0)
      .map((p) => (p.startsWith("./") ? p : `./${p.replace(/^\/+/, "")}`));
  } catch {
    return [];
  }
}

async function loadShipModels() {
  const fleetResult = await loadDroneFleetModels();
  if (fleetResult?.templates?.length) {
    shipModels = fleetResult.templates;
    loadPromise = null;
    return;
  }

  if (loadPromise) return loadPromise;
  if (shipModels.length > 0 && !shipModels[0]?.userData?.droneFleetShip) return;

  loadPromise = (async () => {
    const loader = new GLTFLoader();
    const sharedTex = await loadSharedShipMaterials();
    const manifestPaths = await loadManifestPaths();
    const fallbackPaths = [];
    for (let i = 0; i <= 9; i++) {
      fallbackPaths.push(`./ships/varied/starfighter-${i}.glb`);
    }
    const shipPaths = manifestPaths.length > 0 ? manifestPaths : fallbackPaths;

    const settled = await Promise.allSettled(
      shipPaths.map((path, index) =>
        loader.loadAsync(path).then((gltf) => ({ index, scene: gltf.scene })),
      ),
    );
    const results = settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    if (results.length === 0) {
      try {
        const gltf = await loader.loadAsync("./gltf/Heavy_EXT_02.glb");
        shipModels = [gltf.scene];
        console.log("Fallback: loaded Heavy_EXT_02.glb");
      } catch (err) {
        console.warn("No ship models available");
      }
      return;
    }

    results.sort((a, b) => a.index - b.index);
    const models = results.map((r) => r.scene);

    const hasEmbeddedTextures = (scene) => {
      let found = false;
      scene.traverse((c) => {
        if (c.isMesh && c.material) {
          const m = Array.isArray(c.material) ? c.material[0] : c.material;
          if (m?.map || m?.normalMap || m?.emissiveMap) found = true;
        }
      });
      return found;
    };
    const useEmbedded =
      results.length > 0 && hasEmbeddedTextures(results[0].scene);

    for (const result of results) {
      const mats = createShipMaterialSet(result.index, sharedTex);
      if (!useEmbedded) {
        applyRuntimeShipMaterials(result.scene, mats, result.index);
      }
      result.scene.userData.enemyLaserColor = mats.laserColor.getHex();
      result.scene.userData.enemyLaserIntensity = mats.laserIntensity;
    }

    shipModels = models;
    console.log(`Loaded ${shipModels.length} starfighter models`);
  })();

  return loadPromise;
}

async function reapplyShipMaterials(models) {
  if (models.length === 0) return;
  if (models[0]?.userData?.droneFleetShip) return;
  const hasTex = (s) => {
    let v = false;
    s.traverse((c) => {
      if (c.isMesh && c.material) {
        const m = Array.isArray(c.material) ? c.material[0] : c.material;
        if (m?.map || m?.normalMap || m?.emissiveMap) v = true;
      }
    });
    return v;
  };
  if (hasTex(models[0])) return;
  const sharedTex = await loadSharedShipMaterials();
  for (let i = 0; i < models.length; i++) {
    const mats = createShipMaterialSet(i, sharedTex);
    applyRuntimeShipMaterials(models[i], mats, i);
    models[i].userData.enemyLaserColor = mats.laserColor.getHex();
    models[i].userData.enemyLaserIntensity = mats.laserIntensity;
  }
}

export {
  loadShipModels,
  shipModels,
  reapplyShipMaterials,
  isDroneFleetActive,
  getFleetShipIndexById,
};

function randomInBounds(center, size, margin = 0.7) {
  return new THREE.Vector3(
    center.x + (Math.random() - 0.5) * size.x * margin,
    center.y + (Math.random() - 0.5) * size.y * margin,
    center.z + (Math.random() - 0.5) * size.z * margin,
  );
}

function biasedWaypoint(currentPos, center, size, centroidBias = 0.35) {
  const raw = randomInBounds(center, size, 0.7);
  raw.lerp(center, centroidBias);
  // blend toward current position a bit for smoother paths
  raw.lerp(currentPos, 0.15);
  return raw;
}

export class Enemy {
  constructor(scene, position, level, bounds, options = {}) {
    this.level = level;
    this.isPortalBot = !!options.isPortalBot;
    this.isHeavy = !!options.isHeavy;
    const enemyHealthMultiplier = options.healthMultiplier ?? 1;
    this.baseHealth = Math.round(
      (options.isHeavy || this.isPortalBot ? 300 : 100) * enemyHealthMultiplier,
    );
    this.health = this.baseHealth;
    this.invulnerable = options.invulnerable === true;
    this.speed =
      (3 + Math.random() * 3) * 1.25 * (options.speedMultiplier ?? 1);
    this.detectionRange = 100;
    this.detectionRangeSq = 10000;
    this.fireRate = 2 * (options.fireRateMultiplier ?? 1);
    this.fireCooldown = 0;
    this.collisionRadius = 3;
    this.hitExtents = { x: 8, y: 4, z: 8 };
    this._collisionBaseRadius = 3;
    this._collisionBaseHitExtents = { x: 8, y: 4, z: 8 };
    this.shipScale =
      options.shipScale ??
      (this.isHeavy ? ENEMY_HEAVY_SHIP_SCALE : ENEMY_DEFAULT_SHIP_SCALE);
    this.disposed = false;

    // Level bounds for wander
    this.boundsCenter = bounds?.center?.clone() || position.clone();
    this.boundsSize = bounds?.size?.clone() || new THREE.Vector3(40, 20, 40);
    if (this.isPortalBot) {
      this.boundsCenter.copy(position);
      this.boundsSize.set(30, 18, 30);
    }

    this.spawnPoint = position.clone();
    this.state = "wander";
    this.hasLOS = false;
    this.losCheckCounter = 0;
    this.glowColor = new THREE.Color().setHSL(Math.random(), 0.8, 0.6).getHex();

    // Wander state
    this.waypoint = biasedWaypoint(
      position,
      this.boundsCenter,
      this.boundsSize,
    );
    this.wanderCooldown = 0;
    this.wanderInterval = 4 + Math.random() * 4;
    this.velocity = new THREE.Vector3();
    this.steerStrength = 1.5 + Math.random() * 1.0;
    this.stuckTimer = 0;
    this.evadeTimer = 0;
    this.combatStrafeTimer = 1 + Math.random() * 2;
    this.orbitSide = Math.random() < 0.5 ? -1 : 1;
    this.idealAttackRange = this.isHeavy ? 42 : 24 + Math.random() * 10;
    this.attackRangeBand = this.isHeavy ? 10 : 7;
    this.physicsFrame = Math.floor(Math.random() * 3);
    this._physicsSlot =
      Math.abs(Math.floor(position.x * 31 + position.y * 17 + position.z * 7)) %
      3;

    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);
    this.weaponMarkerIndex = 0;
    this.engineMarkers = [];
    this.weaponMarkers = [];
    this.heavyMissileInterval = 10;
    // Start ready so first heavy missile can fire immediately on LOS.
    this.heavyMissileTimer = this.heavyMissileInterval;
    this.laserColor = 0xff8800;
    this.laserIntensity = 1.0;
    this.usesSharedTemplateModel = false;
    this.usesPortalDroneModel = false;
    this.spawnWarp = null;
    this.missionPoolSlot = options.missionPoolSlot ?? null;
    this.portalSummonPoolSlot = options.portalSummonPoolSlot ?? null;
    this.disableRevealWarp = options.disableRevealWarp === true;

    this.modelIndex =
      options.fleetShipId != null && isDroneFleetActive()
        ? getFleetShipIndexById(options.fleetShipId)
        : options.modelIndex != null &&
            options.modelIndex >= 0 &&
            options.modelIndex < shipModels.length
          ? options.modelIndex
          : shipModels.length > 0
            ? Math.floor(Math.random() * shipModels.length)
            : -1;
    const shipTemplate =
      this.modelIndex >= 0 ? shipModels[this.modelIndex] : null;
    const useFleetTemplate = !!shipTemplate?.userData?.droneFleetShip;
    const cloneMaterials =
      options.cloneMaterials !== undefined
        ? options.cloneMaterials !== false
        : !useFleetTemplate;

    if (shipTemplate) {
      const clone = useFleetTemplate
        ? cloneFleetShipTemplate(shipTemplate)
        : shipTemplate.clone();
      this.usesSharedTemplateModel = true;
      clone.scale.setScalar(this.shipScale);
      clone.rotation.set(0, Math.PI, 0);
      this._syncShipScaleCollision();
      this.laserColor =
        shipTemplate.userData?.enemyLaserColor ?? this.laserColor;
      this.laserIntensity =
        shipTemplate.userData?.enemyLaserIntensity ?? this.laserIntensity;
      if (useFleetTemplate) {
        setupFleetDroneCloneMarkers(this, clone);
      }
      clone.traverse((child) => {
        if (!child.isMesh) return;
        if (!useFleetTemplate) {
          const n = child.name?.toLowerCase?.() || "";
          if (n.startsWith("thruster_")) {
            child.visible = false;
            this.engineMarkers.push(child);
          } else if (n.startsWith("weapon_")) {
            child.visible = false;
            this.weaponMarkers.push(child);
          }
        }
        if (child.material && cloneMaterials) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map((m) =>
              m?.clone ? m.clone() : m,
            );
          } else if (child.material.clone) {
            child.material = child.material.clone();
          }
        } else if (child.material) {
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const m of mats) {
            if (m?.userData) m.userData.enemySharedTemplateMaterial = true;
          }
        }
      });
      this.mesh.add(clone);
      this._fallbackShipRoot = clone;
      if (options.enableLights !== false) {
        this.shipLightIntensity = 7;
        if (_deadLights.length > 0) {
          this.shipLight = _deadLights.pop();
          this.shipLight.intensity = this.shipLightIntensity;
        } else {
          this.shipLight = new THREE.PointLight(
            0xffffff,
            this.shipLightIntensity,
            8,
            1.5,
          );
          scene.add(this.shipLight);
        }
        this.shipLight.position.copy(position);
        this.shipLight.position.y += 0.3;
        this.shipLight.position.z += 6;
      }
    } else {
      const fallbackR = this.isHeavy ? 1.2 : 0.8;
      const fallbackGeo = new THREE.OctahedronGeometry(fallbackR, 0);
      const fallbackMat = new THREE.MeshStandardMaterial({
        color: 0xff3333,
        emissive: 0xff0000,
        emissiveIntensity: 0.3,
        metalness: 0.8,
        roughness: 0.2,
      });
      this._fallbackShipRoot = new THREE.Mesh(fallbackGeo, fallbackMat);
      this.mesh.add(this._fallbackShipRoot);
    }

    scene.add(this.mesh);
    if (!options.deferSpawnWarp) {
      if (options.game) {
        this.spawnWarp = beginCheckpointDissolve(this.mesh, options.game, {
          duration: ENEMY_SPAWN_DISSOLVE_DURATION,
          edgeColor: this.laserColor,
          particleColor: this.laserColor,
          particleDecimation: 8,
          particleSize: 26,
        });
      } else {
        this.spawnWarp = beginSpawnWarp(this.mesh, {
          duration: ENEMY_SPAWN_DISSOLVE_DURATION,
          color: this.laserColor,
          materialEffect: false,
        });
      }
    }
  }

  setShipScale(shipScale) {
    if (this.disposed || shipScale == null || !Number.isFinite(shipScale))
      return;
    this.shipScale = shipScale;
    if (this._fallbackShipRoot) {
      this._fallbackShipRoot.scale.setScalar(shipScale);
    }
    this._syncShipScaleCollision();
  }

  _syncShipScaleCollision() {
    let radius = this._collisionBaseRadius;
    let ex = this._collisionBaseHitExtents;
    if (this.isHeavy) {
      radius *= 2;
      ex = { x: ex.x * 2, y: ex.y * 2, z: ex.z * 2 };
    }
    const hitScale = Math.max(
      0.1,
      this.shipScale / ENEMY_SHIP_SCALE_HIT_REFERENCE,
    );
    this.collisionRadius = radius * hitScale;
    this.hitExtents.x = ex.x * hitScale;
    this.hitExtents.y = ex.y * hitScale;
    this.hitExtents.z = ex.z * hitScale;
  }

  _pickNewWaypoint() {
    this.waypoint = biasedWaypoint(
      this.mesh.position,
      this.boundsCenter,
      this.boundsSize,
    );
    this.wanderInterval = 3 + Math.random() * 5;
    this.wanderCooldown = 0;
    this.stuckTimer = 0;
  }

  checkLOS(playerPos) {
    const dist = this.mesh.position.distanceTo(playerPos);
    if (dist < 0.1) return true;
    const hit = castRay(
      this.mesh.position.x,
      this.mesh.position.y,
      this.mesh.position.z,
      playerPos.x,
      playerPos.y,
      playerPos.z,
    );
    if (!hit) return true;
    const toi = hit.timeOfImpact ?? hit.toi;
    return toi >= dist - 0.5;
  }

  pointInHitbox(otherPos) {
    const dx = (otherPos.x - this.mesh.position.x) / this.hitExtents.x;
    const dy = (otherPos.y - this.mesh.position.y) / this.hitExtents.y;
    const dz = (otherPos.z - this.mesh.position.z) / this.hitExtents.z;
    return dx * dx + dy * dy + dz * dz < 1;
  }

  canMoveTo(from, to) {
    const hit = castSphere(
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      this.collisionRadius,
    );
    return !hit;
  }

  update(
    delta,
    playerPos,
    fireCallback,
    frameCount = 0,
    cullDistance = 200,
    game = null,
  ) {
    if (this.disposed) return;

    if (
      this.spawnWarp &&
      !this.spawnWarp.disposed &&
      !this.spawnWarp.finished
    ) {
      this.spawnWarp.update(delta);
    }

    const distToPlayerSq = this.mesh.position.distanceToSquared(playerPos);

    // Distance cull — hide mesh and skip AI/physics when far away.
    // Use intensity=0 for lights (not visibility) to keep scene light count constant
    // and avoid shader recompilation. Hysteresis (~90% in, ~110% out) prevents rapid toggling.
    // Never cull during spawn warp: the dissolve + child warp light must stay visible even
    // when the spawn point is beyond the normal cull radius.
    const spawnVfxActive = Boolean(
      this.spawnWarp &&
      !this.spawnWarp.disposed &&
      !this.spawnWarp.finished &&
      !this.spawnWarp.frozen,
    );
    const wasCulled = !this.mesh.visible;
    const cullOutSq = (cullDistance * 1.1) ** 2;
    const cullInSq = (cullDistance * 0.9) ** 2;
    const culled = spawnVfxActive
      ? false
      : wasCulled
        ? distToPlayerSq > cullInSq
        : distToPlayerSq > cullOutSq;
    let revealWarpTriggered = false;
    if (this.mesh.visible === culled) {
      this.mesh.visible = !culled;
      if (this.shipLight) {
        this.shipLight.intensity = culled ? 0 : this.shipLightIntensity;
      }
      if (!this.disableRevealWarp && !culled && wasCulled) {
        if (this.spawnWarp && !this.spawnWarp.disposed) {
          this.spawnWarp.restart({ color: this.laserColor });
        } else if (game) {
          this.spawnWarp = beginCheckpointDissolve(this.mesh, game, {
            duration: ENEMY_SPAWN_DISSOLVE_DURATION,
            edgeColor: this.laserColor,
            particleColor: this.laserColor,
            particleDecimation: 8,
            particleSize: 26,
          });
        } else {
          this.spawnWarp = beginSpawnWarp(this.mesh, {
            duration: ENEMY_SPAWN_DISSOLVE_DURATION,
            color: this.laserColor,
            materialEffect: false,
          });
        }
        if (
          this.spawnWarp &&
          !this.spawnWarp.disposed &&
          !this.spawnWarp.finished
        ) {
          this.spawnWarp.update(1 / 60);
          revealWarpTriggered = true;
        }
      }
    }
    if (culled) return;
    if (spawnVfxActive || revealWarpTriggered) return;

    this.fireCooldown -= delta;

    this.physicsFrame++;

    const playerInactive =
      game &&
      !game.isMultiplayer &&
      (game._soloRespawning || (game.player?.health ?? 0) <= 0);

    // Keep distant wanderers cheap until the player is inside engage range.
    if (
      !playerInactive &&
      distToPlayerSq > this.detectionRangeSq &&
      this.state === "wander"
    ) {
      return;
    }

    // Scale LOS check frequency by distance — fewer checks at range.
    // Stagger by _physicsSlot so not all enemies do physics the same frame.
    const losInterval =
      distToPlayerSq < 400 ? 8 : distToPlayerSq < 1600 ? 16 : 32;
    const physicsFrame = (frameCount + this._physicsSlot) % 3 === 0;
    this.losCheckCounter++;
    if (
      !playerInactive &&
      physicsFrame &&
      this.losCheckCounter >= losInterval
    ) {
      this.losCheckCounter = 0;
      if (distToPlayerSq < this.detectionRangeSq) {
        this.hasLOS = this.checkLOS(playerPos);
      } else {
        this.hasLOS = false;
      }
    }

    if (playerInactive) {
      if (this.state !== "wander") {
        this.state = "wander";
        this.hasLOS = false;
        this._pickNewWaypoint();
      }
    } else if (this.hasLOS) {
      this.state = "attack";
    } else if (
      this.state === "attack" &&
      distToPlayerSq >= this.detectionRangeSq
    ) {
      this.state = "wander";
    }

    if (this.shipLight) {
      this.shipLight.position.copy(this.mesh.position);
      this.shipLight.position.y += 0.3;
    }

    if (this.state === "attack") {
      _direction.subVectors(playerPos, this.mesh.position).normalize();

      _lookMatrix.lookAt(this.mesh.position, playerPos, _upVec);
      _targetQuat.setFromRotationMatrix(_lookMatrix);
      this.mesh.quaternion.slerp(_targetQuat, delta * 2);

      const distToPlayer = Math.sqrt(distToPlayerSq);
      this.evadeTimer = Math.max(0, this.evadeTimer - delta);
      this.combatStrafeTimer -= delta;
      if (this.combatStrafeTimer <= 0) {
        this.combatStrafeTimer = 1.6 + Math.random() * 2.4;
        if (Math.random() < 0.55) this.orbitSide *= -1;
      }

      _strafeDir.crossVectors(_direction, _upVec);
      if (_strafeDir.lengthSq() < 0.0001) {
        _strafeDir.set(this.orbitSide, 0, 0);
      } else {
        _strafeDir.normalize().multiplyScalar(this.orbitSide);
      }

      _combatMoveDir.set(0, 0, 0);
      const tooFar =
        distToPlayer > this.idealAttackRange + this.attackRangeBand;
      const tooClose =
        distToPlayer < this.idealAttackRange - this.attackRangeBand;
      if (tooFar) {
        _combatMoveDir.addScaledVector(_direction, this.isHeavy ? 0.75 : 0.95);
      } else if (tooClose) {
        _combatMoveDir.addScaledVector(
          _direction,
          this.isHeavy ? -0.25 : -0.65,
        );
      }
      _combatMoveDir.addScaledVector(_strafeDir, this.isHeavy ? 0.45 : 0.85);
      if (this.evadeTimer > 0) {
        _combatMoveDir.addScaledVector(_strafeDir, 0.8);
        _combatMoveDir.addScaledVector(_direction, -0.35);
      }

      if (_combatMoveDir.lengthSq() > 0.001) {
        _combatMoveDir.normalize();
        _newPos.copy(this.mesh.position);
        const combatSpeed = this.speed * (this.isHeavy ? 0.75 : 1.0) * delta;
        _newPos.addScaledVector(_combatMoveDir, combatSpeed);
        if (physicsFrame ? this.canMoveTo(this.mesh.position, _newPos) : true) {
          this.mesh.position.copy(_newPos);
          this.stuckTimer = 0;
        } else {
          this.stuckTimer += delta;
          if (this.stuckTimer > 0.35) {
            this.orbitSide *= -1;
            this.evadeTimer = Math.max(this.evadeTimer, 0.45);
            this.stuckTimer = 0;
          }
        }
      }

      const laserRangeSq = this.isHeavy ? this.detectionRangeSq : 8100;
      if (
        this.hasLOS &&
        this.fireCooldown <= 0 &&
        distToPlayerSq < laserRangeSq
      ) {
        let firePos = this.mesh.position;
        if (this.weaponMarkers.length > 0) {
          const marker =
            this.weaponMarkers[
              this.weaponMarkerIndex % this.weaponMarkers.length
            ];
          this.weaponMarkerIndex++;
          marker.getWorldPosition(_muzzlePos);
          firePos = _muzzlePos;
        }
        _direction.subVectors(playerPos, firePos).normalize();
        fireCallback(firePos, _direction, {
          color: this.laserColor,
          intensity: this.laserIntensity,
          ...(this.isHeavy
            ? { projectileSpeed: 34, projectileLifetime: 5 }
            : {}),
        });
        this.fireCooldown = 1 / this.fireRate;
      }

      if (
        this.isHeavy &&
        game &&
        !game.isMultiplayer &&
        this.hasLOS &&
        distToPlayerSq < this.detectionRangeSq
      ) {
        this.heavyMissileTimer += delta;
        if (this.heavyMissileTimer >= this.heavyMissileInterval) {
          let muzzle = this.mesh.position;
          if (this.weaponMarkers.length > 0) {
            const marker =
              this.weaponMarkers[
                this.weaponMarkerIndex % this.weaponMarkers.length
              ];
            this.weaponMarkerIndex++;
            marker.getWorldPosition(_muzzlePos);
            muzzle = _muzzlePos;
          }
          _direction.subVectors(playerPos, muzzle).normalize();
          fireCallback(muzzle, _direction, {
            color: this.laserColor,
            intensity: this.laserIntensity,
            weaponType: "enemyKineticMissile",
          });
          this.heavyMissileTimer = 0;
        }
      }
    } else {
      this._updateWander(delta, frameCount);
    }
  }

  _updateWander(delta, frameCount = 0) {
    this.wanderCooldown += delta;

    _toWaypoint.subVectors(this.waypoint, this.mesh.position);
    const distToWaypoint = _toWaypoint.length();

    if (distToWaypoint < 3 || this.wanderCooldown >= this.wanderInterval) {
      this._pickNewWaypoint();
      _toWaypoint.subVectors(this.waypoint, this.mesh.position);
    }

    // Steering: desired direction toward waypoint
    _wanderDir.copy(_toWaypoint).normalize();

    // Blend velocity toward desired direction (smooth steering)
    this.velocity.lerp(_wanderDir, this.steerStrength * delta);
    this.velocity.normalize();

    const moveSpeed = this.speed * 0.4 * delta;
    _newPos.copy(this.mesh.position);
    _newPos.x += this.velocity.x * moveSpeed;
    _newPos.y += this.velocity.y * moveSpeed;
    _newPos.z += this.velocity.z * moveSpeed;

    const physicsFrame = (frameCount + this._physicsSlot) % 3 === 0;
    if (physicsFrame) {
      if (this.canMoveTo(this.mesh.position, _newPos)) {
        this.mesh.position.copy(_newPos);
        this.stuckTimer = 0;
      } else {
        this.stuckTimer += delta;
        if (this.stuckTimer > 1.0) {
          this._pickNewWaypoint();
        }
      }
    } else {
      this.mesh.position.copy(_newPos);
    }

    // Face movement direction
    if (this.velocity.lengthSq() > 0.001) {
      _newPos.copy(this.mesh.position).add(this.velocity);
      _lookMatrix.lookAt(this.mesh.position, _newPos, _upVec);
      _targetQuat.setFromRotationMatrix(_lookMatrix);
      this.mesh.quaternion.slerp(_targetQuat, delta * 3);
    }
  }

  takeDamage(amount) {
    if (this.invulnerable) return;
    this.health -= amount;
    this.state = "attack";
    this.hasLOS = true;
    this.evadeTimer = Math.max(this.evadeTimer, 0.7);
    if (Math.random() < 0.5) this.orbitSide *= -1;
  }

  dispose(scene, game = null) {
    if (this.disposed) return;
    this.disposed = true;

    if (this.shipLight) {
      this.shipLight.intensity = 0;
      _deadLights.push(this.shipLight);
    }

    scene.remove(this.mesh);
    this.spawnWarp?.dispose?.();

    const ms = game?.gameManager?.getState?.()?.missionStatus;
    const retainDuringMission =
      this.usesSharedTemplateModel &&
      !this.usesPortalDroneModel &&
      (ms === "active" || ms === "starting");
    if (retainDuringMission) {
      if (!game._retainedEnemyRootMeshes) game._retainedEnemyRootMeshes = [];
      game._retainedEnemyRootMeshes.push(this.mesh);
      return;
    }

    this.mesh.traverse((child) => {
      if (!child.isMesh) return;
      const portalUnique =
        this.usesPortalDroneModel &&
        this._portalDroneModelRoot?.getObjectById?.(child.id);
      if ((!this.usesSharedTemplateModel || portalUnique) && child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const m of mats) {
          if (!portalUnique && m?.userData?.enemySharedTemplateMaterial)
            continue;
          m?.dispose?.();
        }
      }
    });
  }
}
