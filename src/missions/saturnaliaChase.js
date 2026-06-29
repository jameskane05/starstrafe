import * as THREE from "three";
import { Enemy, shipModels } from "../entities/Enemy.js";

const MARKER_NAME = "ChaseEnemy";
const PATH_NAME = "ChasePath";
const MIN_AHEAD = 50;
const TARGET_AHEAD = 65;
const MAX_AHEAD = 80;
const CHASE_SHIP_SCALE = 4;
const CHASE_MAX_SPEED = 220;
const CHASE_MIN_SPEED = 12;
const CHASE_ACCEL_RESPONSE = 4.5;
const TRAIL_RATE = 0.025;
const CENTERLINE_BIN_SIZE = 0.75;

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _look = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _enginePos = new THREE.Vector3();
const _trailBack = new THREE.Vector3();

function pointFromAttribute(attribute, index, matrixWorld) {
  return new THREE.Vector3()
    .fromBufferAttribute(attribute, index)
    .applyMatrix4(matrixWorld);
}

function createPathVisual(path) {
  const group = new THREE.Group();
  group.name = "SaturnaliaChasePathVisual";
  group.visible = false;
  group.renderOrder = 20;

  const segmentPoints = path.points.slice(0, 2);
  const curve = new THREE.CatmullRomCurve3(segmentPoints, false, "centripetal", 0.25);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(
      curve,
      24,
      0.38,
      8,
      false,
    ),
    new THREE.MeshBasicMaterial({
      color: 0xff9a2f,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  tube.renderOrder = 20;
  group.add(tube);

  const markerGeo = new THREE.SphereGeometry(1.1, 10, 8);
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0x8affff,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const markerStride = Math.max(1, Math.floor(path.points.length / 28));
  for (let i = 0; i < path.points.length; i += markerStride) {
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.copy(path.points[i]);
    marker.renderOrder = 21;
    group.add(marker);
  }

  group.userData.dispose = () => {
    tube.geometry.dispose();
    tube.material.dispose();
    markerGeo.dispose();
    markerMat.dispose();
  };
  group.userData.tube = tube;
  group.userData.path = path;
  group.userData.lastStart = -1;
  group.userData.lastEnd = -1;
  return group;
}

function updatePathVisualSegment(controller) {
  const visual = controller.pathVisual;
  const tube = visual?.userData?.tube;
  if (!tube) return;

  const start = THREE.MathUtils.clamp(controller.playerAlong ?? 0, 0, controller.path.total);
  const end = THREE.MathUtils.clamp(controller.along, start + 1, controller.path.total);
  if (
    Math.abs(start - visual.userData.lastStart) < 0.75 &&
    Math.abs(end - visual.userData.lastEnd) < 0.75
  ) {
    return;
  }

  visual.userData.lastStart = start;
  visual.userData.lastEnd = end;
  const segmentLength = Math.max(1, end - start);
  const steps = Math.max(4, Math.min(96, Math.ceil(segmentLength / 3)));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const d = THREE.MathUtils.lerp(start, end, i / steps);
    points.push(samplePath(controller.path, d, new THREE.Vector3()));
  }

  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.25);
  const nextGeometry = new THREE.TubeGeometry(
    curve,
    Math.max(8, steps * 2),
    0.38,
    8,
    false,
  );
  tube.geometry.dispose();
  tube.geometry = nextGeometry;
}

function findByPrefix(root, prefix) {
  let found = null;
  root?.traverse?.((object) => {
    if (!found && object.name?.startsWith(prefix)) found = object;
  });
  return found;
}

function extractPathPoints(pathObject) {
  if (!pathObject?.geometry?.attributes?.position) return [];
  pathObject.updateWorldMatrix(true, false);
  const pos = pathObject.geometry.attributes.position;
  const index = pathObject.geometry.index;

  if (index && index.count >= 2) {
    const points = [];
    const first = index.getX(0);
    points.push(pointFromAttribute(pos, first, pathObject.matrixWorld));

    for (let i = 1; i < index.count; i += 2) {
      const next = index.getX(i);
      const point = pointFromAttribute(pos, next, pathObject.matrixWorld);
      if (point.distanceToSquared(points[points.length - 1]) > 0.01) {
        points.push(point);
      }
    }

    if (points.length >= 2) return points;
  }

  const rawPoints = [];
  for (let i = 0; i < pos.count; i++) {
    const point = pointFromAttribute(pos, i, pathObject.matrixWorld);
    rawPoints.push(point);
  }
  if (rawPoints.length < 3) return rawPoints;

  const localBox = new THREE.Box3().setFromPoints(rawPoints);
  const size = localBox.getSize(new THREE.Vector3());
  const axis =
    size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  const minAxis = localBox.min[axis];
  const bins = new Map();

  for (const point of rawPoints) {
    const key = Math.round((point[axis] - minAxis) / CENTERLINE_BIN_SIZE);
    let bin = bins.get(key);
    if (!bin) {
      bin = { sum: new THREE.Vector3(), count: 0, axisValue: 0 };
      bins.set(key, bin);
    }
    bin.sum.add(point);
    bin.axisValue += point[axis];
    bin.count += 1;
  }

  const points = [...bins.values()]
    .filter((bin) => bin.count > 0)
    .map((bin) => {
      const center = bin.sum.multiplyScalar(1 / bin.count);
      center.userData = { axisValue: bin.axisValue / bin.count };
      return center;
    })
    .sort((a, b) => a.userData.axisValue - b.userData.axisValue);

  const deduped = [];
  for (const point of points) {
    if (
      deduped.length === 0 ||
      point.distanceToSquared(deduped[deduped.length - 1]) > 0.25
    ) {
      deduped.push(point);
    }
  }
  return deduped;
}

function buildPath(points) {
  const distances = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += points[i - 1].distanceTo(points[i]);
    distances.push(total);
  }
  return { points, distances, total };
}

function orientPathFromStart(points, startPoint) {
  if (points.length < 2 || !startPoint) return points;
  const firstDist = points[0].distanceToSquared(startPoint);
  const lastDist = points[points.length - 1].distanceToSquared(startPoint);
  if (lastDist < firstDist) points.reverse();
  return points;
}

function samplePath(path, distance, out, tangentOut = null) {
  const d = THREE.MathUtils.clamp(distance, 0, path.total);
  const points = path.points;
  const distances = path.distances;
  if (points.length === 1) {
    out.copy(points[0]);
    tangentOut?.set(0, 0, -1);
    return out;
  }

  let i = 1;
  while (i < distances.length - 1 && distances[i] < d) i++;
  const a = points[i - 1];
  const b = points[i];
  const segLen = Math.max(0.0001, distances[i] - distances[i - 1]);
  const t = (d - distances[i - 1]) / segLen;
  out.copy(a).lerp(b, t);
  tangentOut?.subVectors(b, a).normalize();
  return out;
}

function closestDistanceOnPath(path, point) {
  let bestDistSq = Infinity;
  let bestAlong = 0;
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1];
    const b = path.points[i];
    _tmp.subVectors(b, a);
    const lenSq = Math.max(0.0001, _tmp.lengthSq());
    const t = THREE.MathUtils.clamp(_tmp2.subVectors(point, a).dot(_tmp) / lenSq, 0, 1);
    _tmp2.copy(a).addScaledVector(_tmp, t);
    const distSq = _tmp2.distanceToSquared(point);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestAlong = path.distances[i - 1] + Math.sqrt(lenSq) * t;
    }
  }
  return bestAlong;
}

function emitChaseTrail(game, controller, delta) {
  controller.trailTimer += delta;
  _trailBack.copy(controller.tangent).negate();
  while (controller.trailTimer >= TRAIL_RATE) {
    controller.trailTimer -= TRAIL_RATE;
    const markers = controller.enemy.engineMarkers;
    if (markers.length > 0) {
      for (const marker of markers) {
        marker.getWorldPosition(_enginePos);
        game.trailsEffect?.emitPlasmaExhaust(_enginePos, _trailBack);
        game.trailsEffect?.emitEngineExhaust(_enginePos, _trailBack);
      }
    } else {
      _enginePos.copy(controller.enemy.mesh.position).addScaledVector(controller.tangent, -6);
      game.trailsEffect?.emitPlasmaExhaust(_enginePos, _trailBack);
      game.trailsEffect?.emitEngineExhaust(_enginePos, _trailBack);
    }
  }
}

export function createSaturnaliaChaseController(game) {
  const root = game.sceneManager?.getObject?.("saturnaliaLevelData");
  const marker = findByPrefix(root, MARKER_NAME);
  const pathObject = findByPrefix(root, PATH_NAME);
  const points = extractPathPoints(pathObject);
  if (!root || !marker || points.length < 2) {
    console.warn("[SaturnaliaChase] Missing ChaseEnemy or ChasePath data");
    return null;
  }

  marker.visible = false;
  pathObject.visible = false;
  marker.getWorldPosition(_tmp);
  orientPathFromStart(points, _tmp);
  const path = buildPath(points);
  const startAlong = closestDistanceOnPath(path, _tmp);
  const modelIndex = shipModels.length > 0 ? 0 : undefined;
  const enemy = new Enemy(game.scene, _tmp.clone(), game.level, game._levelBounds, {
    ...{
      enableLights: true,
      trailsEffect: game.trailsEffect,
      game,
      deferSpawnWarp: true,
      disableRevealWarp: true,
      invulnerable: true,
      shipScale: CHASE_SHIP_SCALE,
    },
    ...(modelIndex !== undefined ? { modelIndex } : {}),
  });
  enemy.health = Number.POSITIVE_INFINITY;
  samplePath(path, startAlong, enemy.mesh.position, _tangent);
  _tmp.copy(enemy.mesh.position).add(_tangent);
  _look.lookAt(enemy.mesh.position, _tmp, _up);
  enemy.mesh.quaternion.setFromRotationMatrix(_look);
  enemy.mesh.visible = true;
  enemy.shipLightIntensity = 10;
  if (enemy.shipLight) enemy.shipLight.intensity = enemy.shipLightIntensity;
  const pathVisual = createPathVisual(path);
  game.scene.add(pathVisual);
  const warmAlong = Math.min(path.total, startAlong + TARGET_AHEAD);

  const controller = {
    enemy,
    path,
    pathVisual,
    along: warmAlong,
    playerAlong: startAlong,
    velocity: 0,
    tangent: new THREE.Vector3(0, 0, -1),
    trailTimer: 0,
    active: false,
  };
  updatePathVisualSegment(controller);
  samplePath(path, startAlong, enemy.mesh.position, controller.tangent);
  return controller;
}

export function disposeSaturnaliaChase(game) {
  const chase = game._saturnaliaChase;
  if (!chase) return;
  if (chase.pathVisual) {
    chase.pathVisual.parent?.remove(chase.pathVisual);
    chase.pathVisual.userData.dispose?.();
  }
  chase.enemy?.dispose?.(game.scene, null);
  game._saturnaliaChase = null;
}

export function prewarmSaturnaliaChase(game) {
  const chase = game._saturnaliaChase;
  if (!chase || game._saturnaliaChaseGpuWarmed) return;
  if (!game.renderer || !game.camera || !game.scene || game.xrManager?.isPresenting) return;

  const hidden = [];
  for (const child of game.scene.children) {
    if (
      child === chase.enemy.mesh ||
      child === chase.pathVisual ||
      child.isLight ||
      child.isCamera
    ) {
      continue;
    }
    hidden.push({ child, visible: child.visible });
    child.visible = false;
  }
  const prevEnemyVisible = chase.enemy.mesh.visible;
  const prevPathVisible = chase.pathVisual?.visible ?? false;
  chase.enemy.mesh.visible = true;
  if (chase.pathVisual) {
    chase.pathVisual.visible = true;
  }

  try {
    game.renderer.compile(game.scene, game.camera);
    if (game.composer && game._bloomActive) {
      game.composer.render();
      game.composer.render();
    } else {
      game.renderer.render(game.scene, game.camera);
      game.renderer.render(game.scene, game.camera);
    }
    _enginePos.copy(chase.enemy.mesh.position).addScaledVector(chase.tangent, -6);
    _trailBack.copy(chase.tangent).negate();
    game.trailsEffect?.emitPlasmaExhaust(_enginePos, _trailBack);
    game.trailsEffect?.emitEngineExhaust(_enginePos, _trailBack);
    game.renderer.render(game.scene, game.camera);
    game._saturnaliaChaseGpuWarmed = true;
  } finally {
    chase.enemy.mesh.visible = prevEnemyVisible;
    if (chase.pathVisual) {
      chase.pathVisual.visible = prevPathVisible;
    }
    for (const { child, visible } of hidden) {
      child.visible = visible;
    }
  }
}

export function startSaturnaliaChase(game) {
  if (!game._saturnaliaChase) {
    game._saturnaliaChase = createSaturnaliaChaseController(game);
  }
  const chase = game._saturnaliaChase;
  if (!chase) return;

  const playerPos = game.xrManager?.isPresenting && game.xrManager.rig
    ? game.xrManager.rig.position
    : game.camera.position;
  const playerAlong = closestDistanceOnPath(chase.path, playerPos);
  chase.playerAlong = playerAlong;
  chase.along = Math.max(
    chase.along,
    THREE.MathUtils.clamp(playerAlong + TARGET_AHEAD, 0, chase.path.total),
  );
  samplePath(chase.path, chase.along, chase.enemy.mesh.position, chase.tangent);
  chase.enemy.mesh.visible = true;
  if (chase.pathVisual) chase.pathVisual.visible = true;
  updatePathVisualSegment(chase);
  if (chase.enemy.shipLight) chase.enemy.shipLight.intensity = chase.enemy.shipLightIntensity;
  chase.active = true;
  return chase;
}

export function updateSaturnaliaChase(game, delta) {
  const chase = game._saturnaliaChase;
  if (!chase?.active || chase.enemy.disposed) return;

  const playerPos = game.xrManager?.isPresenting && game.xrManager.rig
    ? game.xrManager.rig.position
    : game.camera.position;
  const rawPlayerAlong = closestDistanceOnPath(chase.path, playerPos);
  chase.playerAlong = Math.max(chase.playerAlong ?? 0, rawPlayerAlong);
  const playerAlong = chase.playerAlong;
  const minAlong = Math.min(chase.path.total, playerAlong + MIN_AHEAD);
  const maxAlong = Math.min(chase.path.total, playerAlong + MAX_AHEAD);
  const targetAlong = Math.min(chase.path.total, playerAlong + TARGET_AHEAD);

  if (chase.along < minAlong) {
    const catchupSpeed = THREE.MathUtils.clamp(
      (minAlong - chase.along) * 5,
      CHASE_MIN_SPEED,
      CHASE_MAX_SPEED,
    );
    chase.velocity = THREE.MathUtils.damp(
      chase.velocity,
      catchupSpeed,
      CHASE_ACCEL_RESPONSE,
      delta,
    );
  } else if (chase.along > maxAlong) {
    chase.velocity = THREE.MathUtils.damp(
      chase.velocity,
      CHASE_MIN_SPEED,
      CHASE_ACCEL_RESPONSE,
      delta,
    );
  } else {
    const desiredVelocity = THREE.MathUtils.clamp(
      (targetAlong - chase.along) * 4,
      CHASE_MIN_SPEED,
      CHASE_MAX_SPEED,
    );
    chase.velocity = THREE.MathUtils.damp(
      chase.velocity,
      desiredVelocity,
      CHASE_ACCEL_RESPONSE,
      delta,
    );
  }
  chase.along = Math.min(chase.path.total, chase.along + chase.velocity * delta);

  samplePath(chase.path, chase.along, chase.enemy.mesh.position, chase.tangent);
  updatePathVisualSegment(chase);
  _tmp.copy(chase.enemy.mesh.position).add(chase.tangent);
  _look.lookAt(chase.enemy.mesh.position, _tmp, _up);
  _quat.setFromRotationMatrix(_look);
  chase.enemy.mesh.quaternion.slerp(_quat, Math.min(1, delta * 8));
  if (chase.enemy.shipLight) {
    chase.enemy.shipLight.position.copy(chase.enemy.mesh.position);
    chase.enemy.shipLight.position.y += 0.3;
  }
  emitChaseTrail(game, chase, delta);
}
