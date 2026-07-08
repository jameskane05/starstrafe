/**
 * Destructible level barriers (e.g. Earth Defense "Barrier" object).
 * Meshes named "Barrier*" in level data supply physics colliders only (hidden).
 * Barrier.glb is cloned at each marker for the visible door and pre-fractured
 * so a charging laser hit spawns matching debris + explosion.
 */

import * as THREE from "three";
import { createTrimeshCollider, removeRigidBody } from "../physics/Physics.js";
import { Explosion } from "../entities/Explosion.js";
import {
  spawnDestruction,
  BARRIER_MODEL_INDEX,
} from "../vfx/ShipDestruction.js";
import {
  cloneBarrierModel,
  disposeBarrierVisual,
  preloadBarrierModel,
} from "../cache/barrierModelCache.js";
import { applyObjectEnvZoneBlend } from "../utils/cockpitEnvZones.js";
import { applyEnemyShipEnvironmentMap } from "../entities/Enemy.js";
import sfxManager from "../audio/sfxManager.js";

const BARRIER_PREFIX = "Barrier";

const _center = new THREE.Vector3();
const _box = new THREE.Box3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function disposeMeshMaterial(mesh) {
  if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m?.dispose());
  else mesh.material?.dispose();
}

function applyBarrierModelEnvironment(game, root) {
  if (!root || !game) return;
  if (game.cockpitEnvZones) {
    applyObjectEnvZoneBlend(root, game);
    return;
  }
  const envMap = game._enemyShipEnvMap;
  if (!envMap) return;
  applyEnemyShipEnvironmentMap(
    root,
    envMap,
    game._enemyShipEnvMapIntensity ?? 1,
  );
}

function createBarrierCollider(mesh) {
  const pos = mesh.geometry?.attributes?.position;
  if (!pos) return null;

  const bodyPos = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  mesh.getWorldPosition(bodyPos);
  const localMatrix = mesh.matrixWorld.clone();
  localMatrix.elements[12] -= bodyPos.x;
  localMatrix.elements[13] -= bodyPos.y;
  localMatrix.elements[14] -= bodyPos.z;

  const vertices = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(localMatrix);
    vertices.push(v.x, v.y, v.z);
  }
  const indices = [];
  const idx = mesh.geometry.index;
  if (idx) {
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i));
  } else {
    for (let i = 0; i < pos.count; i++) indices.push(i);
  }

  return createTrimeshCollider(vertices, indices, bodyPos.x, bodyPos.y, bodyPos.z);
}

function resolveBarrierEntries(levelData) {
  const entries = [];
  levelData.traverse((child) => {
    const name = child.name || "";
    if (!name.startsWith(BARRIER_PREFIX)) return;
    if (child.isMesh) {
      entries.push({ name, marker: child, colliderMesh: child });
      return;
    }
    if (!child.isObject3D) return;
    let colliderMesh = null;
    child.traverse((desc) => {
      if (desc.isMesh && !colliderMesh) colliderMesh = desc;
    });
    if (colliderMesh) entries.push({ name, marker: child, colliderMesh });
  });
  return entries;
}

function hidePhysicsMesh(mesh) {
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
}

function hideBarrierPhysics(entry) {
  entry.marker.traverse((child) => {
    if (child.isMesh) hidePhysicsMesh(child);
  });
}

function attachBarrierVisual(game, levelData, entry, barrier) {
  const visual = cloneBarrierModel();
  if (!visual) return false;

  applyBarrierModelEnvironment(game, visual);

  levelData.updateMatrixWorld(true);
  entry.marker.getWorldPosition(_center);
  entry.marker.getWorldQuaternion(_quat);
  entry.marker.getWorldScale(_scale);

  visual.position.copy(_center);
  visual.quaternion.copy(_quat);
  visual.scale.copy(_scale);
  visual.updateMatrixWorld(true);

  game.scene.add(visual);
  barrier.visual = visual;
  barrier.fractureScale = Math.max(_scale.x, _scale.y, _scale.z, 1);
  return true;
}

function setupBarrierEntry(game, levelData, entry) {
  hideBarrierPhysics(entry);

  const body = createBarrierCollider(entry.colliderMesh);
  const barrier = {
    name: entry.name,
    mesh: entry.colliderMesh,
    body,
    visual: null,
    fractureScale: 1,
    active: true,
  };
  game._levelBarriers.push(barrier);

  if (attachBarrierVisual(game, levelData, entry, barrier)) return;

  preloadBarrierModel()
    .then(() => {
      if (!barrier.active || !game._levelBarriers.includes(barrier)) return;
      attachBarrierVisual(game, levelData, entry, barrier);
    })
    .catch((error) => {
      console.warn("[Game] Failed to load barrier visual:", error);
    });
}

export function clearLevelBarriers(game) {
  if (!game._levelBarriers?.length) {
    game._levelBarriers = [];
    return;
  }
  for (const barrier of game._levelBarriers) {
    if (barrier.body) removeRigidBody(barrier.body);
    disposeBarrierVisual(barrier.visual);
  }
  game._levelBarriers = [];
}

export function setupLevelBarriers(game, levelData) {
  clearLevelBarriers(game);
  if (!levelData) return;

  const entries = resolveBarrierEntries(levelData);
  if (!entries.length) return;

  for (const entry of entries) {
    setupBarrierEntry(game, levelData, entry);
  }
  console.log(`[Game] Set up ${game._levelBarriers.length} level barrier(s)`);
}

export function findBarrierByCollider(game, collider) {
  const list = game._levelBarriers;
  if (!list?.length || !collider) return null;
  const parent = typeof collider.parent === "function" ? collider.parent() : null;
  const handle = parent?.handle;
  if (handle == null) return null;
  return (
    list.find((b) => b.active && b.body && b.body.handle === handle) ?? null
  );
}

export function destroyBarrier(game, barrier) {
  if (!barrier?.active) return;
  barrier.active = false;

  const ref = barrier.visual || barrier.mesh;
  ref.updateWorldMatrix(true, false);
  _box.setFromObject(ref);
  _box.getCenter(_center);
  ref.getWorldQuaternion(_quat);
  const center = _center.clone();
  const fractureScale = barrier.fractureScale ?? 1;

  const explosion = new Explosion(
    game.scene,
    center,
    0xffa14a,
    game.dynamicLights,
    { big: true },
  );
  game.explosions.push(explosion);
  sfxManager.play("ship-explosion", center, 0.9);
  if (game.particles) {
    game.explosionEffect.emitBigExplosion(center);
  }
  spawnDestruction(
    game.scene,
    center,
    _quat.clone(),
    BARRIER_MODEL_INDEX,
    fractureScale,
  );

  if (barrier.body) {
    removeRigidBody(barrier.body);
    barrier.body = null;
  }
  disposeBarrierVisual(barrier.visual);
  barrier.visual = null;

  const mesh = barrier.mesh;
  if (mesh) {
    mesh.removeFromParent();
    mesh.geometry?.dispose();
    disposeMeshMaterial(mesh);
    barrier.mesh = null;
  }

  game.missionManager?.reportEvent?.("levelBarrierDestroyed", {
    name: barrier.name,
  });
}

export { preloadBarrierModel };
