import * as THREE from "three";
import { Enemy, applyPortalDroneModel } from "../entities/Enemy.js";
import { castRay } from "../physics/Physics.js";
import { Explosion } from "../entities/Explosion.js";
import sfxManager from "../audio/sfxManager.js";
import {
  EngineTrail,
  ENGINE_TRAIL_FIXED_STEP,
  trackEngineTrailSegment,
} from "../vfx/EngineTrail.js";
import { startSaturnaliaCollapseSequence } from "../game/saturnaliaCollapseSequence.js";
import {
  createNameTagSprite,
  disposeNameTagSprite,
  setNameTagSpeaking,
} from "../ui/nameTagSprite.js";

const MARKER_NAME = "ChaseEnemy";
const PATH_NAME = "ChasePath";
const MIN_AHEAD = 50;
const TARGET_AHEAD = 65;
const MAX_AHEAD = 80;
const HARD_PAUSE_AHEAD = 100;
const CHASE_SHIP_SCALE = 4;
const CHASE_MAX_SPEED = 220;
const CHASE_MIN_SPEED = 12;
const CHASE_ACCEL_RESPONSE = 4.5;
const CHASE_ACCEL_RATE = 38;
const CENTERLINE_BIN_SIZE = 0.75;
const CHASE_START_VERTEX_INDEX = 78;
const CHASE_START_TRANSITION_DURATION = 2.2;
const ESCAPE_MAX_SPEED = 520;
const ESCAPE_ACCEL_RATE = 240;

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _look = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _enginePos = new THREE.Vector3();
const _labelWorldPos = new THREE.Vector3();

const CHASE_ENGINE_TRAIL_OPTS = {
  maxPoints: 60,
  trailTime: 0.625,
  width: 1.0,
  colorStart: 0xfff0aa,
  colorEnd: 0x88ddff,
  emissiveIntensity: 2.8,
};

function pointFromAttribute(attribute, index, matrixWorld) {
  return new THREE.Vector3()
    .fromBufferAttribute(attribute, index)
    .applyMatrix4(matrixWorld);
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

function createChaseEngineTrails(game, enemy) {
  const markerCount =
    enemy.engineMarkers.length > 0 ? Math.min(2, enemy.engineMarkers.length) : 2;
  const trails = [];
  for (let i = 0; i < markerCount; i++) {
    trails.push(new EngineTrail(game.scene, CHASE_ENGINE_TRAIL_OPTS));
  }
  return trails;
}

function updateChaseEngineTrails(game, chase) {
  const trails = chase.engineTrails;
  if (!trails?.length) return;
  const enemy = chase.enemy;
  const now = game.clock?.elapsedTime ?? performance.now() / 1000;
  const markers = enemy.engineMarkers;
  if (!chase._trailLastEnginePos) {
    chase._trailLastEnginePos = trails.map(() => new THREE.Vector3());
    chase._trailEnginePosReady = false;
  }

  for (let i = 0; i < trails.length; i++) {
    if (markers[i]) {
      markers[i].getWorldPosition(_enginePos);
    } else {
      _enginePos
        .copy(enemy.mesh.position)
        .addScaledVector(chase.tangent, -6 - i * 2);
    }

    const lastPos = chase._trailLastEnginePos[i];
    if (!chase._trailEnginePosReady) {
      lastPos.copy(_enginePos);
      trails[i].trackPosition(_enginePos, ENGINE_TRAIL_FIXED_STEP, now);
      continue;
    }

    trackEngineTrailSegment(trails[i], lastPos, _enginePos, now);
    lastPos.copy(_enginePos);
  }
  chase._trailEnginePosReady = true;
}

function disposeChaseEngineTrails(chase) {
  if (!chase?.engineTrails?.length) return;
  for (const trail of chase.engineTrails) trail.dispose();
  chase.engineTrails.length = 0;
  chase._trailLastEnginePos = null;
  chase._trailEnginePosReady = false;
}

function accelerateToward(current, target, rate, delta) {
  const maxStep = rate * delta;
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

function createColonistsNameLabel(enemy) {
  if (enemy.nameSprite) return;
  enemy.nameSprite = createNameTagSprite("COLONISTS", {
    scale: new THREE.Vector3(5.2, 1.3, 1),
    position: new THREE.Vector3(0, 7, 0),
  });
  enemy.mesh.add(enemy.nameSprite);
}

function updateColonistsNameLabel(game, chase, delta) {
  const sprite = chase.enemy?.nameSprite;
  if (!sprite || !game.camera) return;
  sprite.quaternion.identity();
  setNameTagSpeaking(
    sprite,
    game.dialogManager?.isPlaying === true &&
      game.dialogManager?.activeSpeakerId === "colonist",
  );

  chase.labelOcclusionTimer = (chase.labelOcclusionTimer ?? 0) - delta;
  if (chase.labelOcclusionTimer > 0) return;
  chase.labelOcclusionTimer = 0.1;
  sprite.getWorldPosition(_labelWorldPos);
  const dist = game.camera.position.distanceTo(_labelWorldPos);
  if (dist < 0.1) {
    sprite.visible = true;
    return;
  }
  const hit = castRay(
    game.camera.position.x,
    game.camera.position.y,
    game.camera.position.z,
    _labelWorldPos.x,
    _labelWorldPos.y,
    _labelWorldPos.z,
  );
  if (!hit) {
    sprite.visible = true;
    return;
  }
  const toi = hit.timeOfImpact ?? hit.toi;
  sprite.visible = toi >= dist - 0.5;
}

export async function createSaturnaliaChaseController(game) {
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
  const markerStartPosition = _tmp.clone();
  orientPathFromStart(points, _tmp);
  const path = buildPath(points);
  const startVertexIndex = Math.min(
    CHASE_START_VERTEX_INDEX,
    path.points.length - 1,
  );
  const startAlong = path.distances[startVertexIndex] ?? closestDistanceOnPath(path, _tmp);
  const enemy = new Enemy(game.scene, _tmp.clone(), game.level, game._levelBounds, {
    enableLights: true,
    game,
    deferSpawnWarp: true,
    disableRevealWarp: true,
    invulnerable: true,
    shipScale: CHASE_SHIP_SCALE,
  });
  enemy.health = Number.POSITIVE_INFINITY;
  await applyPortalDroneModel(enemy, CHASE_SHIP_SCALE, game);
  enemy.mesh.position.copy(markerStartPosition);
  const transitionTargetPosition = new THREE.Vector3();
  samplePath(path, startAlong, transitionTargetPosition, _tangent);
  _tmp.copy(markerStartPosition).add(_tangent);
  _look.lookAt(enemy.mesh.position, _tmp, _up);
  enemy.mesh.quaternion.setFromRotationMatrix(_look);
  enemy.mesh.visible = true;
  enemy.shipLightIntensity = 10;
  if (enemy.shipLight) enemy.shipLight.intensity = enemy.shipLightIntensity;
  const controller = {
    enemy,
    path,
    startAlong,
    startPosition: markerStartPosition,
    transitionTargetPosition,
    transitionFromStart: false,
    transitionElapsed: 0,
    along: startAlong,
    playerAlong: startAlong,
    velocity: 0,
    tangent: new THREE.Vector3(0, 0, -1),
    labelOcclusionTimer: 0,
    active: false,
    engineTrails: createChaseEngineTrails(game, enemy),
  };
  samplePath(path, startAlong, _tmp, controller.tangent);
  enemy.mesh.position.copy(markerStartPosition);
  return controller;
}

export function disposeSaturnaliaChase(game) {
  const chase = game._saturnaliaChase;
  if (!chase) return;
  disposeChaseEngineTrails(chase);
  disposeNameTagSprite(chase.enemy?.nameSprite);
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
      child.isLight ||
      child.isCamera
    ) {
      continue;
    }
    hidden.push({ child, visible: child.visible });
    child.visible = false;
  }
  const prevEnemyVisible = chase.enemy.mesh.visible;
  chase.enemy.mesh.visible = true;

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
    updateChaseEngineTrails(game, chase);
    game.renderer.render(game.scene, game.camera);
    game._saturnaliaChaseGpuWarmed = true;
  } finally {
    chase.enemy.mesh.visible = prevEnemyVisible;
    for (const { child, visible } of hidden) {
      child.visible = visible;
    }
  }
}

export function startSaturnaliaChase(game) {
  const chase = game._saturnaliaChase;
  if (!chase) return;
  if (chase.active) return chase;

  const playerPos = game.xrManager?.isPresenting && game.xrManager.rig
    ? game.xrManager.rig.position
    : game.camera.position;
  const playerAlong = closestDistanceOnPath(chase.path, playerPos);
  const startAlong = chase.startAlong ?? 0;
  chase.playerAlong = Math.max(startAlong, playerAlong);
  chase.along = startAlong;
  chase.velocity = 0;
  chase.transitionFromStart = true;
  chase.transitionElapsed = 0;
  chase.enemy.mesh.position.copy(chase.startPosition ?? chase.enemy.mesh.position);
  samplePath(chase.path, chase.along, _tmp, chase.tangent);
  chase.enemy.mesh.visible = true;
  createColonistsNameLabel(chase.enemy);
  if (chase.enemy.shipLight) chase.enemy.shipLight.intensity = chase.enemy.shipLightIntensity;
  chase.active = true;
  return chase;
}

/** Snap chase drone + ally to the player's debug spawn on the path (mid-chase spawns). */
export function alignSaturnaliaDebugSpawn(game) {
  const chase = game._saturnaliaChase;
  if (!chase?.path || !chase.active) return;

  const playerPos = game.xrManager?.isPresenting && game.xrManager.rig
    ? game.xrManager.rig.position
    : game.camera.position;
  const playerAlong = closestDistanceOnPath(chase.path, playerPos);
  const startAlong = chase.startAlong ?? 0;
  if (playerAlong <= startAlong + MIN_AHEAD * 0.5) return;

  const effectivePlayerAlong = Math.max(startAlong, playerAlong);
  const targetAlong = THREE.MathUtils.clamp(
    effectivePlayerAlong + TARGET_AHEAD,
    startAlong,
    chase.path.total,
  );

  chase.playerAlong = effectivePlayerAlong;
  chase.along = targetAlong;
  chase.velocity = CHASE_MIN_SPEED;
  chase.transitionFromStart = false;
  chase.transitionElapsed = CHASE_START_TRANSITION_DURATION;

  samplePath(chase.path, chase.along, chase.enemy.mesh.position, chase.tangent);
  _tmp2.copy(chase.enemy.mesh.position).add(chase.tangent);
  _look.lookAt(chase.enemy.mesh.position, _tmp2, _up);
  chase.enemy.mesh.quaternion.setFromRotationMatrix(_look);

  const ally = game.alliedShips?.[0];
  if (!ally) return;

  const playerQuat = game.xrManager?.isPresenting && game.xrManager.rig
    ? game.xrManager.rig.quaternion
    : game.camera.quaternion;
  _tmp
    .set(8 * (ally.formationSide ?? 1), 3, -18)
    .applyQuaternion(playerQuat);
  ally.mesh.position.copy(playerPos).add(_tmp);
  if (ally.pathRail) {
    ally.pathAlong = effectivePlayerAlong;
    ally.pathRecovery = false;
    ally.pathInfluence = 0;
    ally.pathVelocity = 0;
  }
  ally.velocity.set(0, 0, 0);
}

/** Mobius laugh beat: the drone slams the throttle and flees to the end of the path. */
export function startSaturnaliaChaseEscape(game) {
  const chase = game._saturnaliaChase ?? startSaturnaliaChase(game);
  if (!chase || chase.escape || chase.escaped) return;
  if (!chase.active) startSaturnaliaChase(game);

  chase.escape = true;
  chase.transitionFromStart = false;
  sfxManager.play("engine-boost", chase.enemy.mesh.position, 1);
}

function finishSaturnaliaChaseEscape(game, chase) {
  chase.escape = false;
  chase.escaped = true;
  chase.active = false;

  samplePath(chase.path, chase.path.total, _tmp, chase.tangent);
  const pos = _tmp.clone();
  game.explosions.push(
    new Explosion(game.scene, pos, 0xffa14a, game.dynamicLights, {
      big: true,
      scaleMult: 2.2,
    }),
  );
  sfxManager.play("ship-explosion", pos, 1);
  const fx = game.explosionEffect;
  if (fx) {
    for (let k = 0; k < 3; k++) fx.emitBigExplosion(pos, 2.2);
    fx.emitExplosionParticles(pos, { r: 1.0, g: 0.55, b: 0.18 }, 90, 2.2);
    fx.emitImpactSparks(pos, 2.2);
  }
  game.dynamicLights?.flash(pos, 0xffa14a, {
    intensity: 260,
    distance: 200,
    ttl: 0.3,
    fade: 0.6,
  });

  disposeNameTagSprite(chase.enemy.nameSprite);
  chase.enemy.nameSprite = null;
  chase.enemy.mesh.visible = false;
  if (chase.enemy.shipLight) chase.enemy.shipLight.intensity = 0;
  game.missionManager?.clearDirectionalHelperTarget?.("saturnaliaChase");

  startSaturnaliaCollapseSequence(game);
  game.missionManager?.reportEvent?.("saturnaliaChaseEscaped", {});
}

export function updateSaturnaliaChase(game, delta) {
  const chase = game._saturnaliaChase;
  if (!chase?.active || chase.enemy.disposed) return;

  if (chase.escape) {
    chase.velocity = Math.min(
      ESCAPE_MAX_SPEED,
      chase.velocity + ESCAPE_ACCEL_RATE * delta,
    );
    chase.along += chase.velocity * delta;
    if (chase.along >= chase.path.total) {
      finishSaturnaliaChaseEscape(game, chase);
      return;
    }
    samplePath(chase.path, chase.along, chase.enemy.mesh.position, chase.tangent);
    _tmp.copy(chase.enemy.mesh.position).add(chase.tangent);
    _look.lookAt(chase.enemy.mesh.position, _tmp, _up);
    _quat.setFromRotationMatrix(_look);
    chase.enemy.mesh.quaternion.slerp(_quat, Math.min(1, delta * 12));
    if (chase.enemy.shipLight) {
      chase.enemy.shipLight.position.copy(chase.enemy.mesh.position);
      chase.enemy.shipLight.position.y += 0.3;
    }
    updateColonistsNameLabel(game, chase, delta);
    updateChaseEngineTrails(game, chase);
    return;
  }

  const playerPos = game.xrManager?.isPresenting && game.xrManager.rig
    ? game.xrManager.rig.position
    : game.camera.position;
  if (chase.transitionFromStart && chase.startPosition && chase.transitionTargetPosition) {
    chase.transitionElapsed += delta;
    const t = THREE.MathUtils.clamp(
      chase.transitionElapsed / CHASE_START_TRANSITION_DURATION,
      0,
      1,
    );
    const eased = t * t * (3 - 2 * t);
    chase.enemy.mesh.position.lerpVectors(
      chase.startPosition,
      chase.transitionTargetPosition,
      eased,
    );
    samplePath(chase.path, chase.startAlong ?? 0, _tmp2, chase.tangent);
    _tmp.copy(chase.enemy.mesh.position).add(chase.tangent);
    _look.lookAt(chase.enemy.mesh.position, _tmp, _up);
    _quat.setFromRotationMatrix(_look);
    chase.enemy.mesh.quaternion.slerp(_quat, Math.min(1, delta * 6));
    if (chase.enemy.shipLight) {
      chase.enemy.shipLight.position.copy(chase.enemy.mesh.position);
      chase.enemy.shipLight.position.y += 0.3;
    }
    updateColonistsNameLabel(game, chase, delta);
    if (t >= 1) {
      chase.transitionFromStart = false;
      chase.along = chase.startAlong ?? chase.along;
      chase.velocity = 0;
    }
    updateChaseEngineTrails(game, chase);
    return;
  }
  const rawPlayerAlong = closestDistanceOnPath(chase.path, playerPos);
  const startAlong = chase.startAlong ?? 0;
  chase.playerAlong = Math.max(chase.playerAlong ?? startAlong, rawPlayerAlong);
  const playerAlong = Math.max(startAlong, chase.playerAlong);
  const currentPlayerAlong = Math.max(startAlong, rawPlayerAlong);
  const minAlong = Math.min(chase.path.total, playerAlong + MIN_AHEAD);
  const maxAlong = Math.min(chase.path.total, playerAlong + MAX_AHEAD);
  const targetAlong = Math.min(chase.path.total, playerAlong + TARGET_AHEAD);

  if (chase.along - currentPlayerAlong > HARD_PAUSE_AHEAD) {
    chase.velocity = 0;
  } else if (chase.along < minAlong) {
    const catchupSpeed = THREE.MathUtils.clamp(
      (minAlong - chase.along) * 5,
      CHASE_MIN_SPEED,
      CHASE_MAX_SPEED,
    );
    chase.velocity = accelerateToward(
      chase.velocity,
      catchupSpeed,
      CHASE_ACCEL_RATE,
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
    chase.velocity = accelerateToward(
      chase.velocity,
      desiredVelocity,
      CHASE_ACCEL_RATE,
      delta,
    );
  }
  chase.along = Math.min(chase.path.total, chase.along + chase.velocity * delta);

  samplePath(chase.path, chase.along, chase.enemy.mesh.position, chase.tangent);
  _tmp.copy(chase.enemy.mesh.position).add(chase.tangent);
  _look.lookAt(chase.enemy.mesh.position, _tmp, _up);
  _quat.setFromRotationMatrix(_look);
  chase.enemy.mesh.quaternion.slerp(_quat, Math.min(1, delta * 8));
  if (chase.enemy.shipLight) {
    chase.enemy.shipLight.position.copy(chase.enemy.mesh.position);
    chase.enemy.shipLight.position.y += 0.3;
  }
  updateColonistsNameLabel(game, chase, delta);
  updateChaseEngineTrails(game, chase);
}
