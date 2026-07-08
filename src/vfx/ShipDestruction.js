/**
 * ShipDestruction.js - SHIP FRACTURE AND DEBRIS
 * =============================================================================
 *
 * ROLE: Pre-fractures ship GLTF models (three-pinata) and spawns destructible
 * mesh instances on death. Ejects debris with physics; cleanup after lifetime.
 *
 * KEY RESPONSIBILITIES:
 * - prefractureModels(shipModels), prefracturePlayerShip(model): cache fragment geometry
 * - spawnDestruction(scene, model, position, quat, options): spawn DestructibleMesh, debris
 * - updateDestruction(delta): advance active debris, remove expired; cleanupDestruction()
 * - PLAYER_SHIP_MODEL_INDEX for player prefracture; used by gameCombat, gameMultiplayer
 *
 * RELATED: Enemy.js, Player.js, gameCombat.js, gameMultiplayer.js, gameInGameUI.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { DestructibleMesh, FractureOptions } from "@dgreenheck/three-pinata";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const fragmentCache = new Map();
const activeDebris = [];
const debrisOuterMaterials = [];
const debrisInnerMaterials = [];

const FRAGMENT_COUNT = 8;
const FLEET_DESTRUCTION_REP_COUNT = 2;
const DEBRIS_LIFETIME = 2.5;
const EJECT_SPEED = 18;
const SPIN_SPEED = 8;
const DRAG_PER_SEC = 0.3;

const innerMaterial = new THREE.MeshStandardMaterial({
  color: 0x111111,
  emissive: 0xff4400,
  emissiveIntensity: 4.0,
  metalness: 0.9,
  roughness: 0.3,
  toneMapped: false,
});

export const PLAYER_SHIP_MODEL_INDEX = 100;
export const SENTINEL_BOSS_MODEL_INDEX = 101;
export const BARRIER_MODEL_INDEX = 102;

function createDebrisOuterMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x333333,
    metalness: 0.5,
    roughness: 0.6,
    transparent: true,
  });
}

function getDebrisOuterMaterial(index) {
  if (!debrisOuterMaterials[index]) {
    debrisOuterMaterials[index] = createDebrisOuterMaterial();
  }
  debrisOuterMaterials[index].opacity = 1;
  return debrisOuterMaterials[index];
}

function getDebrisInnerMaterial(index) {
  if (!debrisInnerMaterials[index]) {
    debrisInnerMaterials[index] = innerMaterial.clone();
    debrisInnerMaterials[index].transparent = true;
  }
  debrisInnerMaterials[index].opacity = 1;
  return debrisInnerMaterials[index];
}

export function getShipDestructionDebrisMaterials() {
  const materials = [];
  for (let i = 0; i < FRAGMENT_COUNT; i++) {
    materials.push(getDebrisOuterMaterial(i), getDebrisInnerMaterial(i));
  }
  return materials;
}

function yieldToMain() {
  return new Promise((resolve) => {
    if (
      typeof scheduler !== "undefined" &&
      typeof scheduler.yield === "function"
    ) {
      scheduler.yield().then(resolve);
      return;
    }
    requestAnimationFrame(() => resolve());
  });
}

export function prefractureModels(shipModels) {
  for (let i = 0; i < shipModels.length; i++) {
    try {
      prefractureModel(i, shipModels[i]);
    } catch (e) {
      console.warn(`Failed to pre-fracture model ${i}:`, e);
    }
  }
  console.log(
    `Pre-fractured ${fragmentCache.size}/${shipModels.length} ship models`,
  );
}

export async function prefractureModelsAsync(shipModels) {
  if (!shipModels?.length || shipModels[0]?.userData?.droneFleetShip) return;

  await yieldToMain();
  for (let i = 0; i < shipModels.length; i++) {
    try {
      prefractureModel(i, shipModels[i]);
    } catch (e) {
      console.warn(`Failed to pre-fracture model ${i}:`, e);
    }
    if (i < shipModels.length - 1) await yieldToMain();
  }
  console.log(
    `Pre-fractured ${fragmentCache.size}/${shipModels.length} ship models`,
  );
}

let fleetPrefractureScheduled = false;

export function scheduleFleetPrefractureInBackground(shipModels) {
  if (fleetPrefractureScheduled) return;
  if (!shipModels?.length || !shipModels[0]?.userData?.droneFleetShip) return;
  fleetPrefractureScheduled = true;

  void (async () => {
    const repCount = Math.min(FLEET_DESTRUCTION_REP_COUNT, shipModels.length);
    await yieldToMain();
    for (let i = 0; i < repCount; i++) {
      try {
        prefractureModel(i, shipModels[i]);
      } catch (e) {
        console.warn(`Failed to pre-fracture fleet rep ${i}:`, e);
      }
      await yieldToMain();
    }
    for (let i = repCount; i < shipModels.length; i++) {
      const cached = fragmentCache.get(i % repCount);
      if (cached) fragmentCache.set(i, cached);
    }
    console.log(
      `[ShipDestruction] Fleet prefracture: ${repCount} reps, ${shipModels.length} variants aliased`,
    );
  })().catch((error) => {
    fleetPrefractureScheduled = false;
    console.warn("[ShipDestruction] Fleet prefracture failed:", error);
  });
}

export function prefracturePlayerShip(model) {
  if (!model) return;
  try {
    prefractureModel(PLAYER_SHIP_MODEL_INDEX, model);
    console.log("[ShipDestruction] Pre-fractured player ship");
  } catch (e) {
    console.warn("Failed to pre-fracture player ship:", e);
  }
}

export function prefractureBossModel(
  model,
  index = SENTINEL_BOSS_MODEL_INDEX,
) {
  if (!model) return;
  try {
    prefractureModel(index, model);
    console.log("[ShipDestruction] Pre-fractured boss model");
  } catch (e) {
    console.warn("Failed to pre-fracture boss model:", e);
  }
}

export function prefractureBarrierModel(model) {
  if (!model) return;
  try {
    prefractureModel(BARRIER_MODEL_INDEX, model);
    console.log("[ShipDestruction] Pre-fractured barrier model");
  } catch (e) {
    console.warn("Failed to pre-fracture barrier model:", e);
  }
}

function prefractureModel(index, model) {
  const geometries = [];
  let outerMat = null;

  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const n = child.name?.toLowerCase?.() || "";
    if (
      n.startsWith("thruster_") ||
      n.startsWith("weapon_") ||
      n.startsWith("turret_") ||
      n.includes("collider")
    ) {
      return;
    }
    const mats = Array.isArray(child.material)
      ? child.material
      : child.material
        ? [child.material]
        : [];
    if (mats.some((m) => m?.name === "Collider_Invisible")) return;

    const src = child.geometry.index
      ? child.geometry.toNonIndexed()
      : child.geometry;
    const geo = src.clone();
    if (!geo.attributes?.position || geo.attributes.position.count < 3) {
      geo.dispose();
      return;
    }
    for (const key of Object.keys(geo.attributes)) {
      if (key !== "position" && key !== "normal") {
        geo.deleteAttribute(key);
      }
    }
    geo.computeVertexNormals();
    geo.applyMatrix4(child.matrixWorld);
    geometries.push(geo);
    if (!outerMat) {
      outerMat = Array.isArray(child.material)
        ? child.material[0]
        : child.material;
    }
  });

  if (geometries.length === 0) return;

  const merged =
    geometries.length === 1
      ? geometries[0]
      : mergeGeometries(geometries, false);
  if (!merged) return;

  const fractureOuterMat =
    outerMat && typeof outerMat.clone === "function"
      ? outerMat.clone()
      : new THREE.MeshStandardMaterial();

  const destructible = new DestructibleMesh(
    merged,
    fractureOuterMat,
    innerMaterial,
  );

  const options = new FractureOptions({
    fractureMethod: "voronoi",
    fragmentCount: FRAGMENT_COUNT,
    voronoiOptions: { mode: "3D" },
  });

  const fragments = destructible.fracture(options);

  fragmentCache.set(
    index,
    fragments.map((f) => ({
      geometry: f.geometry,
    })),
  );

  destructible.dispose();
  for (const g of geometries) g.dispose();
}

const _center = new THREE.Vector3();
const _ejectDir = new THREE.Vector3();

export function spawnDestruction(
  scene,
  position,
  quaternion,
  modelIndex,
  scale = 2.0,
) {
  const cached = fragmentCache.get(modelIndex);
  if (!cached || cached.length === 0) return;

  for (let i = 0; i < cached.length; i++) {
    const frag = cached[i];
    const outerMat = getDebrisOuterMaterial(i);
    const innerMat = getDebrisInnerMaterial(i);

    frag.geometry.computeBoundingBox();
    const bb = frag.geometry.boundingBox;
    _center.copy(bb.min).add(bb.max).multiplyScalar(0.5);

    _ejectDir.copy(_center);
    if (_ejectDir.lengthSq() < 0.001) {
      _ejectDir.set(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      );
    }
    _ejectDir.normalize();

    const offset = _center.clone().multiplyScalar(scale);
    offset.applyQuaternion(quaternion);

    const mesh = new THREE.Mesh(frag.geometry, [outerMat, innerMat]);
    mesh.position.copy(position).add(offset);
    mesh.quaternion.copy(quaternion);
    mesh.scale.setScalar(scale);
    scene.add(mesh);

    const vel = _ejectDir.clone().multiplyScalar(EJECT_SPEED);
    vel.applyQuaternion(quaternion);
    vel.x += (Math.random() - 0.5) * 4;
    vel.y += Math.random() * 3;
    vel.z += (Math.random() - 0.5) * 4;

    const angVel = new THREE.Vector3(
      (Math.random() - 0.5) * SPIN_SPEED,
      (Math.random() - 0.5) * SPIN_SPEED,
      (Math.random() - 0.5) * SPIN_SPEED,
    );

    activeDebris.push({
      mesh,
      materialIndex: i,
      velocity: vel,
      angularVelocity: angVel,
      life: DEBRIS_LIFETIME,
    });
  }
}

export function updateDestruction(delta) {
  for (let i = activeDebris.length - 1; i >= 0; i--) {
    const d = activeDebris[i];
    d.life -= delta;

    if (d.life <= 0) {
      d.mesh.parent?.remove(d.mesh);
      activeDebris.splice(i, 1);
      continue;
    }

    d.mesh.position.x += d.velocity.x * delta;
    d.mesh.position.y += d.velocity.y * delta;
    d.mesh.position.z += d.velocity.z * delta;

    d.mesh.rotation.x += d.angularVelocity.x * delta;
    d.mesh.rotation.y += d.angularVelocity.y * delta;
    d.mesh.rotation.z += d.angularVelocity.z * delta;

    const alpha = d.life / DEBRIS_LIFETIME;
    const mats = Array.isArray(d.mesh.material)
      ? d.mesh.material
      : [d.mesh.material];
    for (const m of mats) {
      m.opacity = alpha;
    }

    d.velocity.multiplyScalar(Math.pow(DRAG_PER_SEC, delta));
  }
}

export function cleanupDestruction(scene) {
  for (const d of activeDebris) {
    d.mesh.parent?.remove(d.mesh);
  }
  activeDebris.length = 0;
}
