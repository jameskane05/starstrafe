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

export function castSphere(fromX, fromY, fromZ, toX, toY, toZ, radius) {
  if (!world) return null;
  
  _direction.x = toX - fromX;
  _direction.y = toY - fromY;
  _direction.z = toZ - fromZ;
  
  const lengthSq = _direction.x * _direction.x + _direction.y * _direction.y + _direction.z * _direction.z;
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
  return world.castShape(_position, _rotation, _direction, shape, length, true);
}
