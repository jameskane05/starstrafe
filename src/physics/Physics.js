/**
 * Physics.js - RAPIER PHYSICS WORLD AND COLLISION
 * =============================================================================
 *
 * ROLE: Rapier 3D physics world singleton. Init, step, create colliders (ball,
 * cuboid, trimesh, kinematic). Sphere cast and shape cast for hit detection;
 * isInsideMesh for spawn point filtering.
 *
 * KEY RESPONSIBILITIES:
 * - initPhysics(), stepWorld(), getWorld(), getRapier()
 * - createWallCollider, createTrimeshCollider, createKinematicTrimeshCollider, removeRigidBody
 * - checkSphereCollision(x, y, z, radius); castSphere, castRay; isInsideMesh for level bounds
 *
 * RELATED: gameInit.js, gameUpdate.js, SceneManager.js, Player.js, Enemy.js, gameCombat.js.
 *
 * =============================================================================
 */

const RAPIER = await import("@dimforge/rapier3d");

let world = null;
const shapeCache = new Map();
const _position = { x: 0, y: 0, z: 0 };
const _rotation = { x: 0, y: 0, z: 0, w: 1 };
const _direction = { x: 0, y: 0, z: 0 };

function getBall(radius) {
  let ball = shapeCache.get(radius);
  if (!ball) {
    ball = new RAPIER.Ball(radius);
    shapeCache.set(radius, ball);
  }
  return ball;
}

export function initPhysics() {
  world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  console.log("Rapier physics initialized");
  return { RAPIER, world };
}

export function stepWorld() {
  if (world) world.step();
}

export function getWorld() {
  return world;
}

export function getRapier() {
  return RAPIER;
}

export function createWallCollider(x, y, z, hw, hh, hd) {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cuboid(hw, hh, hd);
  return world.createCollider(colliderDesc, body);
}

export function checkSphereCollision(x, y, z, radius) {
  if (!world) return false;

  const shape = getBall(radius);
  _position.x = x;
  _position.y = y;
  _position.z = z;

  let hit = false;
  world.intersectionsWithShape(_position, _rotation, shape, () => {
    hit = true;
    return false;
  });

  return hit;
}

export function createTrimeshCollider(vertices, indices, px, py, pz) {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.trimesh(
    new Float32Array(vertices),
    new Uint32Array(indices),
  );
  world.createCollider(colliderDesc, body);
  return body;
}

export function removeRigidBody(body) {
  if (world && body) world.removeRigidBody(body);
}

export function createKinematicTrimeshCollider(vertices, indices, px, py, pz) {
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(px, py, pz);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.trimesh(
    new Float32Array(vertices),
    new Uint32Array(indices),
  );
  world.createCollider(colliderDesc, body);
  return body;
}

/**
 * Check if a point is inside an enclosed mesh by casting small spheres in 6 axis directions.
 * Uses castShape (double-sided on trimeshes) instead of castRay (single-sided).
 * A point is "inside" if casts hit walls in at least 5 of 6 directions.
 */
export function isInsideMesh(x, y, z, maxDist = 200) {
  if (!world) return false;

  const probeRadius = 0.1;
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  let hits = 0;
  for (const [dx, dy, dz] of dirs) {
    const hit = castSphere(
      x,
      y,
      z,
      x + dx * maxDist,
      y + dy * maxDist,
      z + dz * maxDist,
      probeRadius,
    );
    if (hit) hits++;
  }
  return hits >= 5;
}

export function castSphere(fromX, fromY, fromZ, toX, toY, toZ, radius) {
  if (!world) return null;

  _direction.x = toX - fromX;
  _direction.y = toY - fromY;
  _direction.z = toZ - fromZ;

  const lengthSq =
    _direction.x * _direction.x +
    _direction.y * _direction.y +
    _direction.z * _direction.z;
  if (lengthSq < 0.00000001) return null;

  const length = Math.sqrt(lengthSq);
  const invLen = 1 / length;
  _direction.x *= invLen;
  _direction.y *= invLen;
  _direction.z *= invLen;

  _position.x = fromX;
  _position.y = fromY;
  _position.z = fromZ;

  const shape = getBall(radius);
  return world.castShape(
    _position,
    _rotation,
    _direction,
    shape,
    0,
    length,
    true,
  );
}

const _rayOrigin = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: 0, z: 0 };

export function castRay(fromX, fromY, fromZ, toX, toY, toZ) {
  if (!world) return null;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const dz = toZ - fromZ;
  const lenSq = dx * dx + dy * dy + dz * dz;
  if (lenSq < 1e-10) return null;

  const len = Math.sqrt(lenSq);
  const inv = 1 / len;

  _rayOrigin.x = fromX;
  _rayOrigin.y = fromY;
  _rayOrigin.z = fromZ;
  _rayDir.x = dx * inv;
  _rayDir.y = dy * inv;
  _rayDir.z = dz * inv;

  const ray = new RAPIER.Ray(_rayOrigin, _rayDir);
  return world.castRay(ray, len, true);
}
