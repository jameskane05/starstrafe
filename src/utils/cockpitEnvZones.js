import * as THREE from "three";
import {
  applyBlendedEnvironmentMapToObject,
  applyEnvironmentAmbientToLight,
  getEnvironmentMapConfig,
  loadEnvironmentMap,
  setEnvironmentMapRotationForObject,
  ENEMY_BOT_ENVMAPS_ENABLED,
  FLEET_ENEMY_ENV_MAP_INTENSITY_SCALE,
} from "./envMapAssets.js";
import { isDroneFleetActive } from "../entities/droneFleetLoader.js";

const ENV_ZONE_PREFIX = "EnvMap-";
const TRANSITION_SECONDS = 1;
const ENV_DRIFT_FORWARD_SCALE = 0.002;
const ENV_DRIFT_STRAFE_SCALE = 0.001;
const ENV_DRIFT_VERTICAL_SCALE = 0.001;
const TAU = Math.PI * 2;

const _point = new THREE.Vector3();
const _box = new THREE.Box3();
const _objectPoint = new THREE.Vector3();
const _closestPoint = new THREE.Vector3();
const _lastDelta = new THREE.Vector3();
const _boxSize = new THREE.Vector3();
const _cameraForward = new THREE.Vector3();
const _cameraRight = new THREE.Vector3();

function getObjectEnvSamplePoint(object, out) {
  const sample = object?.userData?.envZoneSampleObject;
  if (sample?.getWorldPosition) {
    sample.getWorldPosition(out);
    return out;
  }
  object.getWorldPosition(out);
  return out;
}

function envMapIdFromZoneName(name) {
  if (!name?.startsWith(ENV_ZONE_PREFIX)) return null;
  return name.slice(ENV_ZONE_PREFIX.length).trim().toLowerCase();
}

function findEnvMapZones(game) {
  const levelId = game.gameManager?.getState?.()?.currentLevel;
  const root = levelId ? game.sceneManager?.getObject?.(`${levelId}LevelData`) : null;
  if (!root) return [];

  const zones = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const envMapId = envMapIdFromZoneName(object.name);
    if (!envMapId) return;

    const config = getEnvironmentMapConfig(envMapId, levelId);
    if (!config) {
      console.warn(`[CockpitEnvZones] No env map config for "${envMapId}"`);
      return;
    }

    _box.setFromObject(object);
    if (_box.isEmpty()) return;
    _box.getSize(_boxSize);
    zones.push({
      id: config.id,
      name: object.name,
      bounds: _box.clone(),
      volume: _boxSize.x * _boxSize.y * _boxSize.z,
      config,
    });
    object.visible = false;
  });

  console.log(
    `[CockpitEnvZones] zones: ${zones.map((zone) => zone.name).join(", ")}`,
  );
  return zones;
}

function zoneAmbientScale(env) {
  return env?.lighting?.intensityScale ?? env?.config?.ambientIntensityScale ?? 1;
}

function applyAmbientBlend(game, fromEnv, toEnv, factor) {
  const ambient = game.lightManager?.getLight?.("ambient");
  if (!ambient) return;

  const fromColor = fromEnv?.lighting?.ambientColor;
  if (!fromColor) return;

  const toColor = toEnv?.lighting?.ambientColor ?? fromColor;
  ambient.color.copy(fromColor).lerp(toColor, factor);
  ambient.intensity =
    game._envZoneBaseAmbientIntensity *
    THREE.MathUtils.lerp(zoneAmbientScale(fromEnv), zoneAmbientScale(toEnv), factor);
}

function findZoneAtPoint(state, point) {
  let best = null;
  for (const zone of state.zones) {
    if (!zone.bounds.containsPoint(point)) continue;
    if (!best || zone.volume < best.volume) best = zone;
  }
  return best;
}

function findNearestZone(state, point) {
  let nearest = null;
  let nearestDistSq = Infinity;
  for (const zone of state.zones) {
    zone.bounds.clampPoint(point, _closestPoint);
    const distSq = _closestPoint.distanceToSquared(point);
    if (distSq < nearestDistSq) {
      nearest = zone;
      nearestDistSq = distSq;
    }
  }
  return nearest;
}

async function loadZoneEnv(game, zone) {
  const loaded = await loadEnvironmentMap(zone.config, game.renderer);
  loaded.config = zone.config;
  return loaded;
}

export async function initializeCockpitEnvZones(game) {
  const zones = findEnvMapZones(game);
  if (zones.length === 0) {
    game.cockpitEnvZones = null;
    return null;
  }

  const loadedById = new Map();
  const zonesByEnvId = new Map();
  for (const zone of zones) {
    if (!zonesByEnvId.has(zone.id)) zonesByEnvId.set(zone.id, zone);
  }
  await Promise.all(
    [...zonesByEnvId.entries()].map(async ([envId, zone]) => {
      loadedById.set(envId, await loadZoneEnv(game, zone));
    }),
  );

  game.camera.getWorldPosition(_point);
  const initialZone =
    zones.find((zone) => zone.bounds.containsPoint(_point)) ??
    zones.find((zone) => zone.id === "earth-command") ??
    zones.find((zone) => zone.id === "gold") ??
    zones[0];
  const currentEnv = loadedById.get(initialZone.id);
  game._envZoneBaseAmbientIntensity =
    game.lightManager?.getLight?.("ambient")?.intensity ?? 1;
  game.cockpitEnvZones = {
    zones,
    loadedById,
    currentZoneId: initialZone.id,
    fromEnv: currentEnv,
    toEnv: currentEnv,
    blend: 1,
    transitionElapsed: TRANSITION_SECONDS,
    lastCameraPosition: _point.clone(),
    envDriftRotation: new THREE.Euler(0, 0, 0, "YXZ"),
    objectStates: new WeakMap(),
  };

  await game.player?.cockpitLoaded?.catch?.(() => {});
  applyBlendedEnvironmentMapToObject(game.player?.cockpit, currentEnv, currentEnv, 1);
  applyAmbientBlend(game, currentEnv, currentEnv, 1);
  const bossMesh = game._earthBossFight?.enemy?.mesh;
  if (bossMesh) applyObjectEnvZoneBlend(bossMesh, game);
  const boss = game._earthBossFight;
  if (boss?.cable?.mesh && boss.envZoneSample) {
    boss.cable.mesh.userData.envZoneSampleObject = boss.envZoneSample;
    applyObjectEnvZoneBlend(boss.cable.mesh, game);
  }
  return game.cockpitEnvZones;
}

function updateCockpitZone(game, state, delta) {
  if (!game.player?.cockpit) return;

  game.camera.getWorldPosition(_point);
  _lastDelta.subVectors(_point, state.lastCameraPosition);
  state.lastCameraPosition.copy(_point);

  game.camera.getWorldDirection(_cameraForward);
  _cameraRight.set(1, 0, 0).applyQuaternion(game.camera.quaternion);
  const forwardDistance = _lastDelta.dot(_cameraForward);
  const strafeDistance = _lastDelta.dot(_cameraRight);
  const verticalDistance = _lastDelta.y;

  state.envDriftRotation.y =
    (state.envDriftRotation.y +
      forwardDistance * ENV_DRIFT_FORWARD_SCALE +
      strafeDistance * ENV_DRIFT_STRAFE_SCALE) %
    TAU;
  state.envDriftRotation.x =
    (state.envDriftRotation.x +
      verticalDistance * ENV_DRIFT_VERTICAL_SCALE -
      strafeDistance * ENV_DRIFT_STRAFE_SCALE * 0.5) %
    TAU;

  const zone = findZoneAtPoint(state, _point);
  if (zone && zone.id !== state.currentZoneId) {
    const nextEnv = state.loadedById.get(zone.id);
    if (nextEnv) {
      state.fromEnv = state.toEnv;
      state.toEnv = nextEnv;
      state.currentZoneId = zone.id;
      state.transitionElapsed = 0;
      state.blend = 0;
      console.log(`[CockpitEnvZones] blending to ${zone.name}`);
    }
  }

  if (state.transitionElapsed < TRANSITION_SECONDS) {
    state.transitionElapsed = Math.min(
      TRANSITION_SECONDS,
      state.transitionElapsed + delta,
    );
    state.blend = state.transitionElapsed / TRANSITION_SECONDS;
  }

  const smoothBlend = state.blend * state.blend * (3 - 2 * state.blend);
  applyBlendedEnvironmentMapToObject(
    game.player.cockpit,
    state.fromEnv,
    state.toEnv,
    smoothBlend,
  );
  setEnvironmentMapRotationForObject(game.player.cockpit, state.envDriftRotation);
  applyAmbientBlend(game, state.fromEnv, state.toEnv, smoothBlend);
}

function fleetEnemyEnvZoneIntensityScale() {
  return isDroneFleetActive() ? FLEET_ENEMY_ENV_MAP_INTENSITY_SCALE : 1;
}

function updateObjectZoneBlend(object, state, delta, intensityScale = 1) {
  if (!object?.visible) return;

  getObjectEnvSamplePoint(object, _objectPoint);
  let objectState = state.objectStates.get(object);
  const zone =
    findZoneAtPoint(state, _objectPoint) ??
    (objectState ? null : findNearestZone(state, _objectPoint));

  if (!objectState) {
    if (!zone) return;
    const env = state.loadedById.get(zone.id);
    if (!env) return;
    objectState = {
      currentZoneId: zone.id,
      fromEnv: env,
      toEnv: env,
      blend: 1,
      transitionElapsed: TRANSITION_SECONDS,
    };
    state.objectStates.set(object, objectState);
  } else if (zone && zone.id !== objectState.currentZoneId) {
    const nextEnv = state.loadedById.get(zone.id);
    if (nextEnv) {
      objectState.fromEnv = objectState.toEnv;
      objectState.toEnv = nextEnv;
      objectState.currentZoneId = zone.id;
      objectState.transitionElapsed = 0;
      objectState.blend = 0;
    }
  }

  if (objectState.transitionElapsed < TRANSITION_SECONDS) {
    objectState.transitionElapsed = Math.min(
      TRANSITION_SECONDS,
      objectState.transitionElapsed + delta,
    );
    objectState.blend = objectState.transitionElapsed / TRANSITION_SECONDS;
  }

  const smoothBlend =
    objectState.blend * objectState.blend * (3 - 2 * objectState.blend);
  applyBlendedEnvironmentMapToObject(
    object,
    objectState.fromEnv,
    objectState.toEnv,
    smoothBlend,
    intensityScale,
  );
}

export function applyObjectEnvZoneBlend(object, game) {
  const state = game?.cockpitEnvZones;
  if (!state || !object) return;
  updateObjectZoneBlend(object, state, TRANSITION_SECONDS);
}

export function updateObjectEnvZoneBlend(object, game, delta = TRANSITION_SECONDS) {
  const state = game?.cockpitEnvZones;
  if (!state) return;
  updateObjectZoneBlend(object, state, delta);
}

function updateBotEnvZones(game, state, delta) {
  // Allied NPC keeps zone-blended env maps; enemy bots are disabled to avoid a
  // material recompile per spawned/streamed bot (ENEMY_BOT_ENVMAPS_ENABLED).
  for (const ally of game.alliedShips ?? []) {
    updateObjectZoneBlend(ally.mesh, state, delta);
  }

  const boss = game._earthBossFight;
  if (boss?.envZoneSample && boss.enemy?.mesh && !boss.dead) {
    boss.envZoneSample.position.copy(boss.sphere.center);
    boss.enemy.mesh.userData.envZoneSampleObject = boss.envZoneSample;
    updateObjectZoneBlend(boss.enemy.mesh, state, delta);
    if (boss.cable?.mesh) {
      boss.cable.mesh.userData.envZoneSampleObject = boss.envZoneSample;
      updateObjectZoneBlend(boss.cable.mesh, state, delta);
    }
  }

  const chaseEnemy = game._saturnaliaChase?.enemy;
  if (chaseEnemy?.mesh && !chaseEnemy.disposed) {
    if (chaseEnemy._portalDroneModelRoot) {
      chaseEnemy.mesh.userData.envZoneSampleObject =
        chaseEnemy._portalDroneModelRoot;
    }
    updateObjectZoneBlend(chaseEnemy.mesh, state, delta);
  }

  if (!ENEMY_BOT_ENVMAPS_ENABLED) return;
  const enemyIntensityScale = fleetEnemyEnvZoneIntensityScale();
  for (const enemy of game.enemies ?? []) {
    updateObjectZoneBlend(enemy.mesh, state, delta, enemyIntensityScale);
  }
  for (const enemy of game._missionEnemyPool ?? []) {
    updateObjectZoneBlend(enemy.mesh, state, delta, enemyIntensityScale);
  }
  for (const entry of game._networkBotPool ?? []) {
    updateObjectZoneBlend(entry.mesh, state, delta);
  }
}

export function updateCockpitEnvZones(game, delta) {
  const state = game.cockpitEnvZones;
  if (!state) return;

  updateCockpitZone(game, state, delta);
  updateBotEnvZones(game, state, delta);
}
