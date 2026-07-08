import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { applyEnemyShipEnvironmentMap } from "../entities/Enemy.js";
import { applyObjectEnvZoneBlend } from "../utils/cockpitEnvZones.js";
import { Explosion } from "../entities/Explosion.js";
import { LaserImpact } from "../entities/LaserImpact.js";
import { BossShieldImpact } from "../entities/BossShieldImpact.js";
import { spawnDestruction, prefractureBossModel, SENTINEL_BOSS_MODEL_INDEX } from "../vfx/ShipDestruction.js";
import sfxManager from "../audio/sfxManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import {
  spawnPortalSummonedEnemy,
  activateAuthoredSpawnsNearPoint,
  BOSS_ARENA_SPAWN_RADIUS,
  EARTH_DEFENSE_POOL_SIZE,
} from "./gameEnemies.js";
import {
  applySplatShockwave,
  clearSplatShockwave,
} from "./charonReactorCore.js";
import { clearLevelOverboost } from "./levelBoosters.js";

const LEVEL_DATA_ID = "earthdefenseLevelData";
const LEVEL_SPLAT_ID = "earthdefenseLevel";
const BOSS_MARKER_NAME = "Boss";
const CABLE_ANCHOR_NAME = "BossCableAnchor";
const SENTINEL_MODEL_PATH = "gltf/sentinel.glb";

const BOSS_PHASES = 3;
const BOSS_SCALE = 10;
const SENTINEL_MODEL_SCALE = BOSS_SCALE;
const BOSS_HIT_RADIUS = 10 * BOSS_SCALE;
const HOVER_RADIUS = 30;
const HOVER_VERTICAL_AMPLITUDE = 14;
const HOVER_VERTICAL_SECONDARY = 6;
const HOVER_VERTICAL_SPEED = 1.25;
const HOVER_RADIUS_WOBBLE = 4;
const HOVER_RADIUS_WOBBLE_SPEED = 0.45;
const LATERAL_AMPLITUDE = 9;
const LATERAL_SPEED = 0.85;
const SEEK_RATE = 0.88;
const WEAVE_AMPLITUDE = 0.32;
const WEAVE_SPEED = 0.82;
const FIRE_ANGLE_THRESHOLD = 0.24;
const ORBIT_PAUSE_MIN = 0.7;
const ORBIT_PAUSE_MAX = 1.15;
const ORBIT_RESUME_COOLDOWN = 1.3;
const HOVER_Y_OFFSET = 0;
const HEALTH_BAR_WIDTH = 3 * BOSS_SCALE;
const HEALTH_BAR_HEIGHT = 0.2 * BOSS_SCALE;
const HEALTH_BAR_Y_PAD = 2.8;

const CABLE_SEGMENTS = 10;
const CABLE_RADIUS = 0.16 * BOSS_SCALE;
const CABLE_GEOMETRY_REFRESH_FRAMES = 2;
const CABLE_SAG_FACTOR = 0.1;
const CABLE_MAX_SAG = 22;
const CABLE_METALNESS = 1;
const CABLE_ROUGHNESS = 0.18;
const CABLE_COLOR = 0xc8c8c8;
const CABLE_ENV_MAP_INTENSITY = 2.4;

const PORTAL_INTERVALS = [9.5, 8, 6.5];
const PORTAL_CAPS = [1, 1, 2];
const BOSS_SUMMON_RADIUS = [24, 42];
const LASER_INTERVALS = [2.2, 1.7, 1.3];
const MISSILE_INTERVALS = [9, 7, 5.5];
const SWEEP_INTERVALS = [10, 8, 6.5];
const SWEEP_CHARGE_SEC = 0.85;
const SWEEP_FIRE_SEC = 1.45;
const SWEEP_LENGTH = 260;
const SWEEP_RADIUS = 5;
const SWEEP_DAMAGE = 18;
const FINAL_DIALOG_DELAY = 2.4;

const BOSS_HIT_FLASH_DURATION = 0.35;
const BOSS_HIT_FLASH_INTENSITY = 0.22;
const BOSS_SUSTAINED_MAX = 0.2;
const BOSS_CRITICAL_HIT_FLASH_INTENSITY = 0.38;
const BOSS_PHASE_PULSE_BASE = 0.28;
const BOSS_PHASE_PULSE_PER_PHASE = 0.22;
const BOSS_DESTRUCTION_SCALE = BOSS_SCALE * 1.5;

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hitPos = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _box = new THREE.Box3();
const _seg = new THREE.Vector3();
const _oc = new THREE.Vector3();
const _look = new THREE.Matrix4();
const _targetQuat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _cableTail = new THREE.Vector3();
const _cableAnchor = new THREE.Vector3();
const _healthBarAnchor = new THREE.Vector3();
let _cableGeometryFrame = 0;
let _sentinelBossTemplate = null;
let _sentinelBossLoadPromise = null;

function getBossCableAnchor(game, boss, target) {
  const levelData = game.sceneManager?.getObject?.(LEVEL_DATA_ID);
  const live = markerWorldPosition(levelData, CABLE_ANCHOR_NAME);
  if (live) {
    boss.anchor.copy(live);
    return target.copy(live);
  }
  return target.copy(boss.anchor);
}

function applyBossCableEnvironment(game, boss) {
  const mesh = boss?.cable?.mesh;
  if (!mesh || !boss.envZoneSample) return;
  mesh.userData.envZoneSampleObject = boss.envZoneSample;
  applyBossModelEnvironment(game, mesh);
}

function applyBossModelEnvironment(game, root) {
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

function publicUrl(path) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
  const clean = path.replace(/^\//, "");
  return base ? `${base}/${clean}` : `/${clean}`;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function findByPrefix(root, prefix) {
  if (!root) return null;
  let found = null;
  root.traverse((child) => {
    if (!found && (child.name || "") === prefix) found = child;
  });
  if (found) return found;
  root.traverse((child) => {
    if (!found && (child.name || "").startsWith(prefix)) found = child;
  });
  return found;
}

function markerWorldPosition(root, name, fallback = null) {
  const obj = findByPrefix(root, name);
  if (!obj) return fallback ? fallback.clone() : null;
  obj.visible = false;
  const pos = new THREE.Vector3();
  obj.getWorldPosition(pos);
  return pos;
}

function createHealthBar(scene) {
  const group = new THREE.Group();
  const bgGeo = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
  const bgMat = new THREE.MeshBasicMaterial({
    color: 0x080808,
    transparent: true,
    opacity: 0.65,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const bg = new THREE.Mesh(bgGeo, bgMat);
  group.add(bg);

  const fillGeo = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0xff3300,
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.z = 0.01;
  group.add(fill);

  const borderGeo = new THREE.EdgesGeometry(bgGeo);
  const borderMat = new THREE.LineBasicMaterial({
    color: 0xff7a18,
    transparent: true,
    opacity: 0.85,
    depthTest: true,
    depthWrite: false,
  });
  const border = new THREE.LineSegments(borderGeo, borderMat);
  group.add(border);

  for (let i = 1; i < BOSS_PHASES; i++) {
    const x = -HEALTH_BAR_WIDTH * 0.5 + (HEALTH_BAR_WIDTH * i) / BOSS_PHASES;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, -HEALTH_BAR_HEIGHT * 0.5, 0.02),
      new THREE.Vector3(x, HEALTH_BAR_HEIGHT * 0.5, 0.02),
    ]);
    group.add(new THREE.Line(geo, borderMat));
  }

  scene.add(group);
  return { group, bg, bgMat, fill, fillGeo, fillMat, border, borderMat };
}

function getBossHealthBarAnchor(boss, target) {
  boss.enemy.mesh.updateMatrixWorld(true);
  _box.setFromObject(boss.enemy.mesh);
  target.set(
    (_box.min.x + _box.max.x) * 0.5,
    _box.max.y + HEALTH_BAR_Y_PAD,
    (_box.min.z + _box.max.z) * 0.5,
  );
  return target;
}

function updateHealthBar(bar, hp, camera, boss) {
  if (!bar || !boss?.enemy?.mesh) return;
  const ratio = THREE.MathUtils.clamp(hp / BOSS_PHASES, 0, 1);
  bar.group.position.copy(getBossHealthBarAnchor(boss, _healthBarAnchor));
  bar.group.quaternion.copy(camera.quaternion);
  bar.fill.scale.x = ratio || 0.001;
  bar.fill.position.x = -(1 - ratio) * HEALTH_BAR_WIDTH * 0.5;
  bar.fillMat.color.setHSL(0.02 + ratio * 0.22, 1, 0.48);
}

function disposeHealthBar(bar, scene) {
  if (!bar) return;
  bar.bg.geometry.dispose();
  bar.bgMat.dispose();
  bar.fillGeo.dispose();
  bar.fillMat.dispose();
  bar.border.geometry.dispose();
  bar.borderMat.dispose();
  bar.group.traverse((child) => {
    if (child.geometry && child !== bar.bg && child !== bar.fill && child !== bar.border) {
      child.geometry.dispose();
    }
  });
  scene.remove(bar.group);
}

function createCable(anchor, tail) {
  const points = [];
  for (let i = 0; i <= CABLE_SEGMENTS; i++) {
    points.push({
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
    });
  }
  const material = new THREE.MeshStandardMaterial({
    color: CABLE_COLOR,
    metalness: CABLE_METALNESS,
    roughness: CABLE_ROUGHNESS,
    envMapIntensity: CABLE_ENV_MAP_INTENSITY,
  });
  const geometry = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points.map((p) => p.pos)),
    CABLE_SEGMENTS * 2,
    CABLE_RADIUS,
    6,
    false,
  );
  const mesh = new THREE.Mesh(geometry, material);
  const cable = { points, mesh, material };
  updateCable(cable, anchor, tail, 0);
  return cable;
}

function updateCable(cable, anchor, tail, _delta) {
  _cableAnchor.copy(anchor);
  _cableTail.copy(tail);
  const dist = Math.max(1, _cableAnchor.distanceTo(_cableTail));
  const sag = Math.min(CABLE_MAX_SAG, dist * CABLE_SAG_FACTOR);

  for (let i = 0; i <= CABLE_SEGMENTS; i++) {
    const t = i / CABLE_SEGMENTS;
    const p = cable.points[i].pos;
    p.copy(_cableAnchor).lerp(_cableTail, t);
    if (i > 0 && i < CABLE_SEGMENTS) {
      p.y -= Math.sin(t * Math.PI) * sag;
    }
    cable.points[i].prev.copy(p);
  }

  _cableGeometryFrame++;
  if (_cableGeometryFrame % CABLE_GEOMETRY_REFRESH_FRAMES !== 0) return;

  const oldGeometry = cable.mesh.geometry;
  cable.mesh.geometry = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(cable.points.map((p) => p.pos)),
    CABLE_SEGMENTS * 2,
    CABLE_RADIUS,
    5,
    false,
  );
  oldGeometry.dispose();
}

function disposeCable(cable, scene) {
  if (!cable) return;
  scene.remove(cable.mesh);
  cable.mesh.geometry.dispose();
  cable.material.dispose();
}

function createSweepBeam(scene) {
  const group = new THREE.Group();
  const coreGeo = new THREE.CylinderGeometry(0.42, 0.42, 1, 12, 1, true);
  coreGeo.rotateX(Math.PI / 2);
  const outerGeo = new THREE.CylinderGeometry(1.15, 1.15, 1, 16, 1, true);
  outerGeo.rotateX(Math.PI / 2);
  const coreMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xfff0aa).multiplyScalar(5),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const outerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff4a12).multiplyScalar(3.5),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(outer, core);
  group.visible = false;
  scene.add(group);
  return { group, outer, core, outerMat, coreMat };
}

function updateSweepBeamMesh(beam, origin, direction, length, opacity = 1) {
  _tmp.copy(origin).addScaledVector(direction, length * 0.5);
  beam.group.position.copy(_tmp);
  beam.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
  beam.core.scale.set(1, 1, length);
  beam.outer.scale.set(1, 1, length);
  beam.coreMat.opacity = 0.9 * opacity;
  beam.outerMat.opacity = 0.45 * opacity;
  beam.group.visible = opacity > 0.01;
}

function disposeSweepBeam(beam, scene) {
  if (!beam) return;
  scene.remove(beam.group);
  beam.core.geometry.dispose();
  beam.outer.geometry.dispose();
  beam.coreMat.dispose();
  beam.outerMat.dispose();
}

function collectSentinelWeaponMarkers(root) {
  const all = [];
  const named = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    all.push(child);
    if (/laser|cannon|weapon|barrel|muzzle/i.test(child.name || "")) {
      named.push(child);
    }
  });
  return (named.length ? named : all).slice(0, 4);
}

function disposeSentinelBossModel(obj, scene) {
  if (!obj?.mesh) return;
  scene.remove(obj.mesh);
  obj.mesh.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) material?.dispose?.();
  });
}

function makeSentinelBossModel(root) {
  root.scale.setScalar(SENTINEL_MODEL_SCALE);
  root.updateMatrixWorld(true);
  return {
    mesh: root,
    weaponMarkers: collectSentinelWeaponMarkers(root),
    modelIndex: SENTINEL_BOSS_MODEL_INDEX,
    dispose(scene) {
      disposeSentinelBossModel(this, scene);
    },
  };
}

function createPlaceholderBossEnemy(game, position) {
  const group = new THREE.Group();
  group.position.copy(position);
  game.scene.add(group);
  return {
    mesh: group,
    weaponMarkers: [],
    modelIndex: SENTINEL_BOSS_MODEL_INDEX,
    dispose(scene) {
      scene.remove(group);
    },
  };
}

function instantiateSentinelBoss(game, position, rotation = null) {
  if (!_sentinelBossTemplate) return null;
  const root = _sentinelBossTemplate.clone(true);
  root.visible = true;
  root.position.copy(position);
  if (rotation) {
    root.quaternion.copy(rotation);
  } else {
    root.quaternion.identity();
  }
  root.scale.setScalar(SENTINEL_MODEL_SCALE);
  applyBossModelEnvironment(game, root);
  game.scene.add(root);
  return makeSentinelBossModel(root);
}

export function preloadEarthBossSentinel(game) {
  if (_sentinelBossTemplate) return Promise.resolve(_sentinelBossTemplate);
  if (_sentinelBossLoadPromise) return _sentinelBossLoadPromise;

  _sentinelBossLoadPromise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      publicUrl(SENTINEL_MODEL_PATH),
      (gltf) => {
        const root = gltf.scene;
        root.scale.setScalar(SENTINEL_MODEL_SCALE);
        root.visible = false;
        if (game) applyBossModelEnvironment(game, root);
        prefractureBossModel(root);
        _sentinelBossTemplate = root;
        resolve(root);
      },
      undefined,
      (error) => {
        _sentinelBossLoadPromise = null;
        reject(error);
      },
    );
  });

  return _sentinelBossLoadPromise;
}

export function prewarmEarthBossSentinel(game) {
  if (game._earthBossSentinelPrewarmed || !_sentinelBossTemplate) return;
  if (!game?.renderer || !game?.scene || !game?.camera) return;
  game._earthBossSentinelPrewarmed = true;

  const root = _sentinelBossTemplate.clone(true);
  root.position.set(0, -100000, 0);
  root.visible = true;
  game.scene.add(root);
  try {
    game.renderer.compile(game.scene, game.camera);
  } catch (error) {
    console.warn("[EarthBoss] Sentinel prewarm compile failed:", error);
  }
  disposeSentinelBossModel({ mesh: root }, game.scene);
}

function loadSentinelBossModel(game, boss) {
  if (_sentinelBossTemplate) {
    const rootPos = boss.enemy.mesh.position.clone();
    const rootQuat = boss.enemy.mesh.quaternion.clone();
    boss.enemy.dispose?.(game.scene, game);
    boss.enemy = instantiateSentinelBoss(game, rootPos, rootQuat);
    updateBossBounds(boss);
    return;
  }

  const loader = new GLTFLoader();
  loader.load(
    publicUrl(SENTINEL_MODEL_PATH),
    (gltf) => {
      if (game._earthBossFight !== boss || boss.dead) {
        disposeSentinelBossModel({ mesh: gltf.scene }, game.scene);
        return;
      }

      const rootPos = boss.enemy.mesh.position.clone();
      const rootQuat = boss.enemy.mesh.quaternion.clone();
      const root = gltf.scene;
      root.position.copy(rootPos);
      root.quaternion.copy(rootQuat);
      root.scale.setScalar(SENTINEL_MODEL_SCALE);
      applyBossModelEnvironment(game, root);
      game.scene.add(root);

      const fallback = boss.enemy;
      boss.enemy = makeSentinelBossModel(root);
      fallback.dispose?.(game.scene, game);
      _sentinelBossTemplate = root.clone(true);
      _sentinelBossTemplate.visible = false;
      prefractureBossModel(_sentinelBossTemplate);
      updateBossBounds(boss);
    },
    undefined,
    (error) => {
      console.warn("[EarthBoss] Failed to load sentinel boss model:", error);
    },
  );
}

function segmentFirstSphereHitDistance(p0, p1, center, radius) {
  _seg.subVectors(p1, p0);
  const segLen = _seg.length();
  if (segLen < 1e-6) return null;
  _seg.multiplyScalar(1 / segLen);
  _oc.subVectors(p0, center);
  const b = 2 * _oc.dot(_seg);
  const c = _oc.dot(_oc) - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = (-b - root) / 2;
  const t1 = (-b + root) / 2;
  const tNear = Math.min(t0, t1);
  const tFar = Math.max(t0, t1);
  const tHit = tNear >= 0 ? tNear : tFar >= 0 ? tFar : null;
  if (tHit == null || tHit > segLen) return null;
  return tHit;
}

function bossActive(game) {
  const boss = game._earthBossFight;
  if (game.isMultiplayer) return false;
  if (game.gameManager?.getState?.()?.currentMissionId !== "capital-ship-earth-defense") {
    return false;
  }
  return Boolean(boss?.active && boss.enemy?.mesh);
}

function updateBossBounds(boss) {
  boss.enemy.mesh.updateMatrixWorld(true);
  if (boss._boundsFrame == null) boss._boundsFrame = 0;
  boss._boundsFrame++;
  if (boss._boundsFrame % 6 !== 0) return;
  _box.setFromObject(boss.enemy.mesh);
  _box.getBoundingSphere(boss.sphere);
  boss.sphere.radius = Math.max(BOSS_HIT_RADIUS, boss.sphere.radius * 1.08);
}

function getPlayerWorldPosition(game, target) {
  if (game.xrManager?.isPresenting && game.xrManager.rig) {
    return target.copy(game.xrManager.rig.position);
  }
  return target.copy(game.camera.position);
}

function bossMuzzlePosition(boss, target) {
  const markers = boss.enemy.weaponMarkers;
  if (markers.length > 0) {
    const marker = markers[boss.weaponMarkerIndex % markers.length];
    boss.weaponMarkerIndex++;
    marker.getWorldPosition(target);
    return target;
  }
  return target.copy(boss.enemy.mesh.position);
}

function bossCableTailPosition(boss, target) {
  boss.enemy.mesh.updateMatrixWorld(true);
  return boss.enemy.mesh.getWorldPosition(target);
}

function currentPhaseIndex(boss) {
  return THREE.MathUtils.clamp(BOSS_PHASES - boss.hp, 0, BOSS_PHASES - 1);
}

function summonPortalBot(game, boss) {
  if (!boss.active || boss.dead) return;
  _tmp.copy(boss.center);
  const angle = Math.random() * Math.PI * 2;
  const r = randomBetween(BOSS_SUMMON_RADIUS[0], BOSS_SUMMON_RADIUS[1]);
  _tmp.x += Math.cos(angle) * r;
  _tmp.z += Math.sin(angle) * r;
  _tmp.y += randomBetween(-6, 8);
  const enemy = spawnPortalSummonedEnemy(game, _tmp, {
    cheapSpawn: true,
    summoned: true,
  });
  if (enemy) boss.portalBots.push(enemy);
}

function prunePortalBots(boss) {
  boss.portalBots = boss.portalBots.filter(
    (enemy) => enemy && !enemy.disposed && enemy.health > 0,
  );
}

function startSweep(game, boss) {
  getPlayerWorldPosition(game, _tmp);
  bossMuzzlePosition(boss, _tmp2);
  _dir.subVectors(_tmp, _tmp2).normalize();
  const yaw = randomBetween(-0.52, 0.52);
  const q0 = new THREE.Quaternion().setFromAxisAngle(_up, yaw);
  const q1 = new THREE.Quaternion().setFromAxisAngle(_up, -yaw);
  boss.sweep = {
    phase: "charge",
    elapsed: 0,
    origin: _tmp2.clone(),
    fromDir: _dir.clone().applyQuaternion(q0).normalize(),
    toDir: _dir.clone().applyQuaternion(q1).normalize(),
    damaged: false,
  };
  sfxManager.play("laser", boss.sweep.origin, 0.85);
}

function damagePlayer(game, position, amount) {
  if (!game.player) return;
  game.player.health -= amount;
  game.player.lastDamageTime = game.clock.elapsedTime;
  game.showDamageIndicator?.(position);
  proceduralAudio.shieldHit?.();
  if (game.particles) {
    game.sparksEffect.emitShieldHitSparks(game.camera, position, 0xff5a12);
  }
}

function updateSweep(game, boss, delta) {
  const sweep = boss.sweep;
  if (!sweep) {
    boss.sweepTimer -= delta;
    if (boss.sweepTimer <= 0) {
      startSweep(game, boss);
      const phase = currentPhaseIndex(boss);
      boss.sweepTimer = SWEEP_INTERVALS[phase] + randomBetween(0, 2);
    }
    return;
  }

  sweep.elapsed += delta;
  if (sweep.phase === "charge") {
    const t = THREE.MathUtils.clamp(sweep.elapsed / SWEEP_CHARGE_SEC, 0, 1);
    _dir.copy(sweep.fromDir).lerp(sweep.toDir, t).normalize();
    updateSweepBeamMesh(boss.sweepBeam, sweep.origin, _dir, 12 + t * 10, t * 0.75);
    if (t >= 1) {
      sweep.phase = "fire";
      sweep.elapsed = 0;
    }
    return;
  }

  const t = THREE.MathUtils.clamp(sweep.elapsed / SWEEP_FIRE_SEC, 0, 1);
  _dir.copy(sweep.fromDir).lerp(sweep.toDir, t).normalize();
  updateSweepBeamMesh(boss.sweepBeam, sweep.origin, _dir, SWEEP_LENGTH, 1 - t * 0.18);

  getPlayerWorldPosition(game, _tmp);
  const closest = closestPointDistanceSq(_tmp, sweep.origin, _tmp2.copy(sweep.origin).addScaledVector(_dir, SWEEP_LENGTH));
  if (!sweep.damaged && closest <= SWEEP_RADIUS * SWEEP_RADIUS) {
    sweep.damaged = true;
    damagePlayer(game, _tmp.clone(), SWEEP_DAMAGE);
  }

  if (t >= 1) {
    boss.sweepBeam.group.visible = false;
    boss.sweep = null;
  }
}

function closestPointDistanceSq(point, a, b) {
  _tmp2.subVectors(b, a);
  const lenSq = _tmp2.lengthSq();
  if (lenSq < 1e-8) return point.distanceToSquared(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(_tmp2) / lenSq, 0, 1);
  _tmp2.copy(a).lerp(b, t);
  return point.distanceToSquared(_tmp2);
}

function updateAttacks(game, boss, delta) {
  const phase = currentPhaseIndex(boss);
  prunePortalBots(boss);

  boss.portalTimer -= delta;
  if (boss.portalTimer <= 0) {
    if (boss.portalBots.length < PORTAL_CAPS[phase]) {
      summonPortalBot(game, boss);
    }
    boss.portalTimer = PORTAL_INTERVALS[phase] + randomBetween(0, 2.2);
  }

  if (boss.aimingAtPlayer) {
    boss.laserTimer -= delta;
    if (boss.laserTimer <= 0) {
      bossMuzzlePosition(boss, _tmp);
      getPlayerWorldPosition(game, _tmp2);
      _dir.subVectors(_tmp2, _tmp).normalize();
      game.boundFireEnemy?.(_tmp.clone(), _dir.clone(), {
        color: 0xff5a12,
        intensity: 2.2,
        projectileSpeed: 42,
        projectileLifetime: 5.5,
      });
      boss.laserTimer = LASER_INTERVALS[phase] + randomBetween(0, 0.6);
    }

    boss.missileTimer -= delta;
    if (boss.missileTimer <= 0) {
      bossMuzzlePosition(boss, _tmp);
      getPlayerWorldPosition(game, _tmp2);
      _dir.subVectors(_tmp2, _tmp).normalize();
      game.boundFireEnemy?.(_tmp.clone(), _dir.clone(), {
        color: 0xff5a12,
        intensity: 2.2,
        weaponType: "enemyKineticMissile",
      });
      boss.missileTimer = MISSILE_INTERVALS[phase] + randomBetween(0, 1.2);
    }

    updateSweep(game, boss, delta);
  }
}

function updateMovement(game, boss, delta) {
  const playerPos = getPlayerWorldPosition(game, _tmp);
  const time = game.clock.elapsedTime;
  const phase = currentPhaseIndex(boss);

  const targetAngle = Math.atan2(
    playerPos.z - boss.center.z,
    playerPos.x - boss.center.x,
  );

  if (boss.orbitResumeCooldown > 0) {
    boss.orbitResumeCooldown -= delta;
  }

  if (boss.orbitPauseTimer > 0) {
    boss.orbitPauseTimer -= delta;
    if (boss.orbitPauseTimer <= 0) {
      boss.orbitResumeCooldown = ORBIT_RESUME_COOLDOWN;
    }
  } else {
    const weave =
      Math.sin(time * WEAVE_SPEED + phase * 0.4) * WEAVE_AMPLITUDE;
    const desiredAngle = targetAngle + weave;
    boss.angle = THREE.MathUtils.euclideanModulo(
      THREE.MathUtils.lerp(
        boss.angle,
        desiredAngle,
        1 - Math.exp(-SEEK_RATE * delta),
      ),
      Math.PI * 2,
    );

    const angleErr = Math.abs(
      THREE.MathUtils.euclideanModulo(
        targetAngle - boss.angle + Math.PI,
        Math.PI * 2,
      ) - Math.PI,
    );
    if (
      angleErr <= FIRE_ANGLE_THRESHOLD &&
      boss.orbitResumeCooldown <= 0
    ) {
      boss.orbitPauseTimer = randomBetween(ORBIT_PAUSE_MIN, ORBIT_PAUSE_MAX);
    }
  }

  boss.aimingAtPlayer = boss.orbitPauseTimer > 0;

  const radius =
    HOVER_RADIUS +
    Math.sin(time * HOVER_RADIUS_WOBBLE_SPEED) * HOVER_RADIUS_WOBBLE;
  const lateral = Math.sin(time * LATERAL_SPEED + 0.8) * LATERAL_AMPLITUDE;
  const perpAngle = boss.angle + Math.PI * 0.5;

  boss.enemy.mesh.position.set(
    boss.center.x +
      Math.cos(boss.angle) * radius +
      Math.cos(perpAngle) * lateral,
    boss.center.y +
      HOVER_Y_OFFSET +
      Math.sin(time * HOVER_VERTICAL_SPEED) * HOVER_VERTICAL_AMPLITUDE +
      Math.sin(time * HOVER_VERTICAL_SPEED * 1.55 + 1.2) *
        HOVER_VERTICAL_SECONDARY,
    boss.center.z +
      Math.sin(boss.angle) * radius +
      Math.sin(perpAngle) * lateral,
  );

  _look.lookAt(boss.enemy.mesh.position, playerPos, _up);
  _targetQuat.setFromRotationMatrix(_look);
  const turnSpeed = boss.aimingAtPlayer ? 10 : 6;
  boss.enemy.mesh.quaternion.slerp(
    _targetQuat,
    1 - Math.exp(-turnSpeed * delta),
  );
  updateBossBounds(boss);
}

function ensureBossSplatFx(game, boss) {
  if (boss.splatFx) return boss.splatFx;
  const sw = applySplatShockwave(game, LEVEL_SPLAT_ID);
  if (!sw) {
    console.warn(
      `[EarthBoss] Splat shockwave unavailable (missing ${LEVEL_SPLAT_ID})`,
    );
    return null;
  }
  boss.splatFx = { ...sw, hitFlashTimer: 0, phasePulse: 0 };
  return boss.splatFx;
}

function triggerBossHitFlash(game, boss, intensityMul = 1) {
  if (!boss || boss.dead || boss.hp <= 0) return;
  const fx = ensureBossSplatFx(game, boss);
  if (!fx) return;
  const flashDuration = BOSS_HIT_FLASH_DURATION * intensityMul;
  fx.hitFlashTimer = Math.max(fx.hitFlashTimer, flashDuration);
  fx.hitFlashDuration = flashDuration;
}

function clearBossSplatFx(game, boss) {
  if (!boss?.splatFx) return;
  clearSplatShockwave(game, boss.splatFx);
  boss.splatFx = null;
}

function updateBossSplatFx(game, boss, delta) {
  const fx = boss?.splatFx;
  if (!fx) return;

  if (boss.dead) {
    fx.intensityDyno.value = Math.max(0, fx.intensityDyno.value - delta * 2.5);
    fx.timeDyno.value = game.clock?.elapsedTime ?? 0;
    fx.splatMesh.updateVersion();
    if (fx.intensityDyno.value <= 0) clearBossSplatFx(game, boss);
    return;
  }

  const hpRatio = Math.max(0, boss.hp / BOSS_PHASES);
  const damageRatio = 1 - hpRatio;
  if (fx.hitFlashTimer > 0) {
    fx.hitFlashTimer = Math.max(0, fx.hitFlashTimer - delta);
  }

  const flashDuration = fx.hitFlashDuration || BOSS_HIT_FLASH_DURATION;
  const flashMax =
    hpRatio <= 1 / BOSS_PHASES
      ? BOSS_CRITICAL_HIT_FLASH_INTENSITY
      : BOSS_HIT_FLASH_INTENSITY;
  const hitFlash =
    fx.hitFlashTimer > 0
      ? flashMax * (fx.hitFlashTimer / flashDuration)
      : 0;

  const sustained = damageRatio * BOSS_SUSTAINED_MAX;
  if (fx.phasePulse > 0) {
    fx.phasePulse = Math.max(0, fx.phasePulse - delta * 1.6);
  }

  fx.intensityDyno.value = Math.min(1, hitFlash + sustained + fx.phasePulse);
  fx.timeDyno.value = game.clock?.elapsedTime ?? 0;
  fx.splatMesh.updateVersion();
}

export function updateEarthBossSplatFx(game, delta) {
  const boss = game._earthBossFight;
  if (!boss?.active) return;
  updateBossSplatFx(game, boss, delta);
}

function triggerPhaseFx(game, boss, phase) {
  const pos = boss.sphere.center.clone();
  const color = phase >= BOSS_PHASES ? 0xfff0aa : 0xff7a18;
  game.explosions.push(
    new Explosion(game.scene, pos, color, game.dynamicLights, { big: true }),
  );
  sfxManager.play("ship-explosion", pos, phase >= BOSS_PHASES ? 1 : 0.75);
  game.dynamicLights?.flash(pos, color, {
    intensity: 120 + phase * 80,
    distance: 75 + phase * 22,
    ttl: 0.18,
    fade: 0.45,
  });
  game._levelBoostShake = {
    elapsed: 0,
    duration: 0.32 + phase * 0.12,
    amplitude: 0.22 + phase * 0.1,
  };

  triggerBossHitFlash(game, boss, 2.5 + phase * 0.5);
  const fx = boss.splatFx;
  if (fx) {
    fx.phasePulse = Math.min(
      0.9,
      BOSS_PHASE_PULSE_BASE + phase * BOSS_PHASE_PULSE_PER_PHASE,
    );
  }
}

function destroyBoss(game, boss) {
  boss.dead = true;
  boss.active = true;
  updateBossBounds(boss);
  const pos = boss.sphere.center.clone();
  const quat = boss.enemy.mesh.quaternion.clone();
  triggerPhaseFx(game, boss, BOSS_PHASES);
  for (let i = 0; i < 5; i++) {
    const offset = new THREE.Vector3(
      randomBetween(-8, 8),
      randomBetween(-5, 8),
      randomBetween(-8, 8),
    );
    game.explosions.push(
      new Explosion(
        game.scene,
        pos.clone().add(offset),
        i % 2 ? 0xffffff : 0xffa14a,
        game.dynamicLights,
        { big: true },
      ),
    );
  }
  game.dynamicLights?.flash(pos, 0xfff0aa, {
    intensity: 520,
    distance: 160,
    ttl: 0.35,
    fade: 1.1,
  });
  game._levelBoostShake = {
    elapsed: 0,
    duration: 1.2,
    amplitude: 0.62,
  };
  if (boss.splatFx) {
    boss.splatFx.intensityDyno.value = 1;
    boss.splatFx.timeDyno.value = game.clock?.elapsedTime ?? 0;
    boss.splatFx.splatMesh.updateVersion();
  }
  spawnDestruction(
    game.scene,
    pos,
    quat,
    SENTINEL_BOSS_MODEL_INDEX,
    BOSS_DESTRUCTION_SCALE,
  );
  for (const enemy of boss.portalBots) {
    enemy.portal?.onOwnerDestroyed?.();
  }
  boss.enemy.dispose(game.scene, game);
  disposeHealthBar(boss.healthBar, game.scene);
  boss.healthBar = null;
  boss.sweepBeam.group.visible = false;
  if (boss.cable?.mesh) boss.cable.mesh.visible = false;
  boss.finalDialogTimer = FINAL_DIALOG_DELAY;
  game.missionManager?.reportEvent?.("earthBossDefeated", {});
}

function spawnBossBlockedShieldFx(game, hitPos, hitNormal) {
  game.impacts.push(
    new BossShieldImpact(
      game.scene,
      hitPos.clone(),
      hitNormal.clone(),
      game.dynamicLights,
    ),
  );
  proceduralAudio.shieldHit?.();
  sfxManager.play("laser", hitPos, 0.75);
  if (game.particles) {
    game.sparksEffect.emitElectricalSparks(hitPos, hitNormal, 22, 0x48a8ff);
  }
}

function spawnBossDamageHitFx(game, hitPos, hitNormal, color) {
  game.impacts.push(
    new LaserImpact(
      game.scene,
      hitPos.clone(),
      hitNormal.clone(),
      color,
      game.dynamicLights,
    ),
  );
  const fx = game.explosionEffect;
  if (fx) {
    const scale = 1.55;
    fx.emitBigExplosion(hitPos, scale, {
      fireColorRange: {
        rMin: 1.0,
        rMax: 1.0,
        gMin: 0.45,
        gMax: 0.75,
        bMin: 0.05,
        bMax: 0.2,
      },
      sparksColorRange: {
        rMin: 1.0,
        rMax: 1.0,
        gMin: 0.55,
        gMax: 0.85,
        bMin: 0.1,
        bMax: 0.25,
      },
    });
    fx.emitExplosionParticles(
      hitPos,
      { r: 1, g: 0.42, b: 0.08 },
      24,
      scale,
    );
    fx.emitImpactSparks(hitPos, scale * 0.8);
  } else if (game.particles) {
    game.sparksEffect.emitElectricalSparks(hitPos, hitNormal, 36, color);
  }
  game.dynamicLights?.flash(hitPos, 0xff7a18, {
    intensity: 95,
    distance: 58,
    ttl: 0.1,
    fade: 0.28,
  });
}

function applyBossImpact(game, p0, p1, distance, color, canDamage = false) {
  const boss = game._earthBossFight;
  if (!bossActive(game) || distance == null) return false;
  const segLen = p0.distanceTo(p1);
  const t = segLen > 1e-6 ? distance / segLen : 0;
  _hitPos.copy(p0).lerp(p1, THREE.MathUtils.clamp(t, 0, 1));
  _hitNormal.subVectors(_hitPos, boss.sphere.center).normalize();
  if (_hitNormal.lengthSq() < 1e-6) _hitNormal.set(0, 1, 0);

  if (canDamage && game.player?.overboostActive !== true) {
    spawnBossBlockedShieldFx(game, _hitPos, _hitNormal);
    return true;
  }

  if (!canDamage) {
    game.impacts.push(
      new LaserImpact(
        game.scene,
        _hitPos.clone(),
        _hitNormal.clone(),
        color,
        game.dynamicLights,
      ),
    );
    if (game.particles) {
      game.sparksEffect.emitElectricalSparks(_hitPos, _hitNormal, 60, color);
    }
    return true;
  }

  if (boss.lastDamageTime && game.clock.elapsedTime - boss.lastDamageTime < 0.55) {
    game.impacts.push(
      new LaserImpact(
        game.scene,
        _hitPos.clone(),
        _hitNormal.clone(),
        color,
        game.dynamicLights,
      ),
    );
    if (game.particles) {
      game.sparksEffect.emitElectricalSparks(_hitPos, _hitNormal, 28, color);
    }
    return true;
  }

  spawnBossDamageHitFx(game, _hitPos, _hitNormal, color);
  clearLevelOverboost(game);

  boss.lastDamageTime = game.clock.elapsedTime;
  const previousHp = boss.hp;
  boss.hp = Math.max(0, boss.hp - 1);
  triggerBossHitFlash(game, boss);
  triggerPhaseFx(game, boss, BOSS_PHASES - boss.hp);
  if (previousHp === BOSS_PHASES && !boss.firstHitDialogPlayed) {
    boss.firstHitDialogPlayed = true;
    game.dialogManager?.playDialog?.("earthYouGotHim");
  } else if (previousHp === BOSS_PHASES - 1 && !boss.secondHitDialogPlayed) {
    boss.secondHitDialogPlayed = true;
    game.dialogManager?.playDialog?.("earthHesWeakening");
  }
  if (boss.hp <= 0) {
    destroyBoss(game, boss);
  } else {
    summonPortalBot(game, boss);
  }
  return true;
}

export function startEarthBossFight(game, { engage = true } = {}) {
  if (game.isMultiplayer) return null;
  if (game._earthBossFight?.dead) return game._earthBossFight;

  if (game._earthBossFight) {
    if (engage) engageEarthBoss(game, game._earthBossFight);
    return game._earthBossFight;
  }

  const levelData = game.sceneManager?.getObject?.(LEVEL_DATA_ID);
  const center = markerWorldPosition(levelData, BOSS_MARKER_NAME);
  if (!center) {
    console.warn("[EarthBoss] Missing Boss marker in earthdefenseLevelData");
    return null;
  }
  const anchor =
    markerWorldPosition(levelData, CABLE_ANCHOR_NAME) ??
    center.clone().add(new THREE.Vector3(0, 42, 0));

  const boss = {
    active: false,
    dead: false,
    enemy: null,
    hp: BOSS_PHASES,
    center,
    anchor,
    angle: Math.random() * Math.PI * 2,
    orbitPauseTimer: 0,
    orbitResumeCooldown: 0,
    aimingAtPlayer: false,
    sphere: new THREE.Sphere(center.clone(), BOSS_HIT_RADIUS),
    healthBar: createHealthBar(game.scene),
    cable: null,
    sweepBeam: createSweepBeam(game.scene),
    sweep: null,
    portalBots: [],
    splatFx: null,
    portalTimer: 1.5,
    laserTimer: 1.2,
    missileTimer: 5,
    sweepTimer: 4,
    weaponMarkerIndex: 0,
    lastDamageTime: -Infinity,
    firstHitDialogPlayed: false,
    secondHitDialogPlayed: false,
    envZoneSample: null,
  };
  boss.envZoneSample = new THREE.Object3D();
  game.scene.add(boss.envZoneSample);
  boss.enemy =
    instantiateSentinelBoss(game, center) ??
    createPlaceholderBossEnemy(game, center);
  updateMovement(game, boss, 0);
  boss.cable = createCable(anchor, bossCableTailPosition(boss, _tmp));
  applyBossCableEnvironment(game, boss);
  game.scene.add(boss.cable.mesh);
  if (boss.healthBar) boss.healthBar.group.visible = false;
  game._earthBossFight = boss;
  primeEarthBossArenaEnemies(game, center);
  if (!_sentinelBossTemplate) {
    loadSentinelBossModel(game, boss);
  }
  if (engage) engageEarthBoss(game, boss);
  return boss;
}

function primeEarthBossArenaEnemies(game, center, { burst = false } = {}) {
  activateAuthoredSpawnsNearPoint(game, center, {
    radius: burst ? BOSS_ARENA_SPAWN_RADIUS + 60 : BOSS_ARENA_SPAWN_RADIUS,
    maxActivate: burst ? EARTH_DEFENSE_POOL_SIZE : 16,
  });
  const cfg = game._authoredEnemySpawnConfig;
  if (cfg) {
    cfg.maxSpawnsPerFrame = burst ? 10 : Math.max(cfg.maxSpawnsPerFrame ?? 2, 6);
    cfg.activateRadius = Math.max(cfg.activateRadius ?? 340, 480);
  }
}

function engageEarthBoss(game, boss) {
  if (!boss || boss.dead || boss.active) return;
  boss.active = true;
  if (boss.healthBar) boss.healthBar.group.visible = true;
  primeEarthBossArenaEnemies(game, boss.center, { burst: true });
  ensureBossSplatFx(game, boss);
  game.missionManager?.reportEvent?.("earthBossStarted", {});
}

export function updateEarthBossFight(game, delta) {
  const boss = game._earthBossFight;
  if (!boss) return;
  if (boss.dead) {
    if (boss.finalDialogTimer != null) {
      boss.finalDialogTimer -= delta;
      if (boss.finalDialogTimer <= 0) {
        boss.finalDialogTimer = null;
        game.dialogManager?.playDialog?.("earthYouveDoneIt");
      }
    }
    return;
  }
  updateMovement(game, boss, delta);
  if (boss.cable) {
    updateCable(
      boss.cable,
      getBossCableAnchor(game, boss, _cableAnchor),
      bossCableTailPosition(boss, _cableTail),
      delta,
    );
  }
  if (!boss.active) return;
  updateAttacks(game, boss, delta);
  updateHealthBar(boss.healthBar, boss.hp, game.camera, boss);
}

export function clearEarthBossSplatFx(game) {
  const boss = game._earthBossFight;
  if (boss) clearBossSplatFx(game, boss);
}

export function stopEarthBossFightForLevelChange(game) {
  const boss = game._earthBossFight;
  if (!boss) return;
  if (boss.envZoneSample) {
    game.scene.remove(boss.envZoneSample);
    boss.envZoneSample = null;
  }
  clearBossSplatFx(game, boss);
  disposeHealthBar(boss.healthBar, game.scene);
  disposeCable(boss.cable, game.scene);
  disposeSweepBeam(boss.sweepBeam, game.scene);
  boss.enemy?.dispose?.(game.scene, game);
  game._earthBossFight = null;
}

export function getEarthBossHitDistanceAlongSegment(game, p0, p1, inflate = 0) {
  if (!bossActive(game)) return null;
  const boss = game._earthBossFight;
  updateBossBounds(boss);
  return segmentFirstSphereHitDistance(
    p0,
    p1,
    boss.sphere.center,
    boss.sphere.radius + inflate,
  );
}

export function applyEarthBossLaserHit(game, p0, p1, distance, color = 0xff6600) {
  return applyBossImpact(game, p0, p1, distance, color, false);
}

export function applyEarthBossMissileHit(game, p0, p1, distance, color = 0xff6600) {
  return applyBossImpact(game, p0, p1, distance, color, false);
}

export function applyEarthBossChargingLaserHit(
  game,
  p0,
  p1,
  distance,
  color = 0xff5a12,
) {
  return applyBossImpact(game, p0, p1, distance, color, true);
}
