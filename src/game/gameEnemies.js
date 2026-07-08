/**
 * gameEnemies.js - ENEMY AND MISSILE PICKUP SPAWNING
 * =============================================================================
 *
 * ROLE: Spawns enemies at level-authored positions and missile pickups for
 * solo play. Updates game state (enemiesRemaining) and HUD. Handles enemy
 * respawn queue and missile pickup respawn timers.
 *
 * KEY RESPONSIBILITIES:
 * - spawnEnemies(game): create Enemy instances at game.spawnPoints; set enemiesRemaining
 * - spawnEnemiesFromLevelSpawnPointsWithPrewarm / spawnEnemiesAtPointsWithPrewarm: bulk GPU-prewarmed spawn
 * - spawnEnemiesByProximity / processDeferredProximityEnemySpawns: large levels (e.g. Charon) spawn
 *   nearby bots staggered across rAF (no batch compile); the rest queue until activateRadius.
 * - prewarmEnemyMeshesInPlace(game, enemies, positions): shared compile pass for any Enemy batch
 * - spawnMissilePickups(game): create Collectible missile pickups at missileSpawnPoints
 * - processEnemyRespawnQueue(game, delta): respawn dead enemies after delay
 * - processMissilePickupRespawns(game, delta): respawn collected missile pickups
 *
 * RELATED: Enemy.js, Collectible.js, gameData.js, ShipDestruction (trails), GameManager.
 *
 * ---------------------------------------------------------------------------
 * SOLO CAMPAIGN — mission enemy pool vs checkpoint gates (GPU)
 * ---------------------------------------------------------------------------
 * Checkpoints: MissionManager “Checkpoint GPU pipeline” + first-view
 * prewarmCheckpointPoolDuringFirstView (shared dissolve batch across pool slots).
 *
 * Enemies: initTrainingMissionEnemyPool builds the pool with precook + dissolve, then
 * prewarmMissionEnemyPoolInPlace → prewarmEnemyMeshesInPlace (hide rest of scene except
 * these meshes + lights, focus camera, compile + composer/render). That is the same
 * *idea* as narrowWarmKeepingSceneRoots for gates, but keeps camera + spawn placement
 * logic for ships that start off-screen. Runs during startSoloDebug before PLAYING;
 * warmGpuProgramsForPlay then hits the full scene again.
 *
 * Use allocateCheckpointDissolveBatchSerial() once for the whole pool precook loop so
 * identical ship layouts reuse |cpDissolve:* suffixes (see checkpointDissolveWarp.js).
 * Pooled respawns use precooked materials + activateEnemyAtSpawn (no per-frame compile).
 * ---------------------------------------------------------------------------
 */

import * as THREE from "three";
import { Enemy, shipModels, computeEnemyShipScale, randomNormalEnemyShipScaleFactor } from "../entities/Enemy.js";
import { EnemyPortal } from "../entities/EnemyPortal.js";
import { Collectible } from "../entities/Collectible.js";
import {
  allocateCheckpointDissolveBatchSerial,
  beginCheckpointDissolve,
  ENEMY_SPAWN_DISSOLVE_DURATION,
  precookCheckpointDissolveMaterials,
  stripCheckpointDissolveMaterials,
} from "../vfx/checkpointDissolveWarp.js";
import {
  getAllLevelEnemySpawnPositions,
  TRAINING_MISSION_WAVE_SIZE,
} from "../missions/trainingGroundsMission.js";
import {
  isPrimaryWeaponUnlocked,
  PRIMARY_WEAPONS,
  unlockPrimaryWeapon,
} from "./weaponUnlocks.js";

/**
 * DEBUG: when true, all enemy/portal-bot spawning is suppressed. Used to isolate
 * whether gameplay lag spikes come from the splat asset vs. enemy instantiation.
 * Flip back to false to restore normal spawning.
 */
export const DEBUG_DISABLE_ENEMY_SPAWNS = false;

export function enemyShipScaleForSpawnIndex(game, spawnIndex) {
  const cached = game.enemySpawnShipScales?.[spawnIndex];
  if (cached != null) return cached;
  return computeEnemyShipScale({
    isHeavy: game.enemySpawnHeavyFlags?.[spawnIndex] === true,
    isPortalBot: game.enemySpawnPortalFlags?.[spawnIndex] === true,
    authoredScale: game.enemySpawnScales?.[spawnIndex] ?? 1,
    randomFactor: game._enemySpawnRandomFactors?.[spawnIndex],
  });
}

export function finalizeEnemySpawnScales(game) {
  const n = game.spawnPoints?.length ?? 0;
  if (!game.enemySpawnScales) game.enemySpawnScales = [];
  while (game.enemySpawnScales.length < n) {
    game.enemySpawnScales.push(1);
  }
  if (!game._enemySpawnRandomFactors) game._enemySpawnRandomFactors = [];
  for (let i = 0; i < n; i++) {
    if (game._enemySpawnRandomFactors[i] == null) {
      game._enemySpawnRandomFactors[i] = randomNormalEnemyShipScaleFactor();
    }
  }
  game.enemySpawnShipScales = [];
  for (let i = 0; i < n; i++) {
    game.enemySpawnShipScales.push(
      computeEnemyShipScale({
        isHeavy: game.enemySpawnHeavyFlags?.[i] === true,
        isPortalBot: game.enemySpawnPortalFlags?.[i] === true,
        authoredScale: game.enemySpawnScales[i] ?? 1,
        randomFactor: game._enemySpawnRandomFactors[i],
      }),
    );
  }
}

function enemySpawnOptions(game) {
  const enableLights =
    game.gameManager.getPerformanceSetting("rendering", "enemyLights") ?? true;
  const enemyDifficulty = game.gameManager.getDifficultyPreset?.()?.enemy || {};
  return {
    enableLights,
    trailsEffect: game.trailsEffect,
    game,
    healthMultiplier: enemyDifficulty.healthMultiplier ?? 1,
    speedMultiplier: enemyDifficulty.speedMultiplier ?? 1,
    fireRateMultiplier: enemyDifficulty.fireRateMultiplier ?? 1,
  };
}

function enemyOptionsForAuthoredSpawn(game, i) {
  return {
    isHeavy: game.enemySpawnHeavyFlags?.[i] === true,
    isPortalBot: game.enemySpawnPortalFlags?.[i] === true,
    shipScale: enemyShipScaleForSpawnIndex(game, i),
  };
}

/** No dissolve VFX, shared materials — Saturnalia / Earth large-level path. */
function cheapEnemySpawnCtorOpts(spawnOpts = {}) {
  if (spawnOpts.cheapSpawn !== true && spawnOpts.lite !== true) return {};
  return {
    deferSpawnWarp: true,
    disableRevealWarp: true,
    cloneMaterials: false,
  };
}

function linkPortalForEnemy(game, enemy, position) {
  if (!enemy?.isPortalBot || game.isMultiplayer) return null;
  if (!game.enemyPortals) game.enemyPortals = [];
  if (enemy.portal && !enemy.portal.disposed) return enemy.portal;
  const portal = new EnemyPortal(game, position, enemy, {
    spawnEnemy: (spawnPos, spawnOpts = {}) =>
      spawnPortalSummonedEnemy(game, spawnPos, spawnOpts),
  });
  enemy.portal = portal;
  game.enemyPortals.push(portal);
  return portal;
}

export function disposeEnemyPortals(game) {
  if (!game.enemyPortals?.length) {
    game.enemyPortals = [];
    return;
  }
  for (const portal of game.enemyPortals) {
    portal.dispose?.();
  }
  game.enemyPortals.length = 0;
}

export function spawnEnemies(game) {
  if (DEBUG_DISABLE_ENEMY_SPAWNS) return;
  if (game.spawnPoints.length === 0) {
    console.warn("[Game] No spawn points found in level mesh");
    return;
  }

  const opts = enemySpawnOptions(game);
  for (let i = 0; i < game.spawnPoints.length; i++) {
    const pos = game.spawnPoints[i];
    const enemy = new Enemy(
      game.scene,
      pos.clone(),
      game.level,
      game._levelBounds,
      {
        ...opts,
        ...enemyOptionsForAuthoredSpawn(game, i),
      },
    );
    game.enemies.push(enemy);
    linkPortalForEnemy(game, enemy, pos);
  }

  console.log(
    `[Game] Spawned ${game.enemies.length} enemies at authored positions`,
  );
  game.gameManager.setState({ enemiesRemaining: game.enemies.length });
  game.updateHUD();
}

export async function spawnEnemiesFromLevelSpawnPointsWithPrewarm(game) {
  if (game.spawnPoints.length === 0) {
    console.warn("[Game] No spawn points found in level mesh");
    return;
  }
  const positions = game.spawnPoints.map((p) => p.clone());
  await spawnEnemiesAtPointsWithPrewarm(game, positions, (i) =>
    enemyOptionsForAuthoredSpawn(game, i),
  );
  console.log(
    `[Game] Spawned ${game.enemies.length} enemies at authored positions (prewarmed)`,
  );
  game.updateHUD();
}

/** Reusable solo campaign enemy instances (authored missions share one small pool). */
export const AUTHORED_MISSION_POOL_SIZE = 24;
/** Earth Defense has ~80 authored spawns; keep a large concurrent pool for the boss arena. */
export const EARTH_DEFENSE_POOL_SIZE = 24;
export const BOSS_ARENA_SPAWN_RADIUS = 220;

export function clearDeferredEnemySpawnState(game) {
  if (game._deferredEnemySpawnQueue?.length) {
    game._deferredEnemySpawnQueue.length = 0;
  }
  game._proximityEnemySpawnConfig = null;
  if (game._authoredEnemySpawnQueue?.length) {
    game._authoredEnemySpawnQueue.length = 0;
  }
  game._authoredEnemySpawnConfig = null;
}

/** Drop live solo enemies and mission pools before a fresh campaign start. */
export function resetSoloCampaignEnemyState(game) {
  disposeEnemyPortals(game);
  if (game.enemies?.length) {
    for (let i = game.enemies.length - 1; i >= 0; i--) {
      try {
        game.enemies[i]?.dispose?.(game.scene, game);
      } catch (err) {
        console.warn("[gameEnemies] resetSoloCampaignEnemyState:", err);
      }
    }
    game.enemies.length = 0;
  }
  disposeMissionEnemyPool(game);
  disposePortalSummonEnemyPool(game);
  clearDeferredEnemySpawnState(game);
  game.enemyRespawnQueue.length = 0;
}

export function getMissionEnemyRemainingCount(game) {
  const queued = game._authoredEnemySpawnQueue?.length ?? 0;
  return (game.enemies?.length ?? 0) + queued;
}

function syncMissionEnemyHud(game) {
  game.gameManager.setState({
    enemiesRemaining: getMissionEnemyRemainingCount(game),
  });
  game.updateHUD?.();
}

function soloPlayerAnchor(game) {
  return game.xrManager?.isPresenting && game.xrManager.rig
    ? game.xrManager.rig.position
    : game.camera?.position;
}

function takeAvailableMissionPoolEnemy(game) {
  const pool = game._missionEnemyPool;
  if (!pool?.length) return null;
  for (const enemy of pool) {
    if (enemy && !enemy.disposed && !game.enemies.includes(enemy)) {
      return enemy;
    }
  }
  return null;
}

function planProximitySpawnEntries(game, anchor, options = {}) {
  const immediateRadius = options.immediateRadius ?? 350;
  const activateRadius = options.activateRadius ?? 320;
  const minInitialIfNoneInRange = Math.max(
    1,
    options.minInitialIfNoneInRange ?? 4,
  );
  const maxSpawnsPerFrame = Math.max(
    1,
    options.maxSpawnsPerFrame ?? 1,
  );
  const staggerFramesBetween = Math.max(
    0,
    options.staggerFramesBetween ?? 1,
  );
  const staggerIdleMs = Math.max(0, options.staggerIdleMs ?? 0);
  const maxImmediateSpawns = Math.max(
    1,
    options.maxImmediateSpawns ?? 12,
  );

  const entries = game.spawnPoints.map((p, i) => ({
    pos: p.clone(),
    poolSlot: i,
    spawnOpts: enemyOptionsForAuthoredSpawn(game, i),
  }));
  entries.sort(
    (a, b) =>
      a.pos.distanceToSquared(anchor) - b.pos.distanceToSquared(anchor),
  );

  let split = 0;
  while (
    split < entries.length &&
    entries[split].pos.distanceTo(anchor) <= immediateRadius
  ) {
    split++;
  }

  let immediate = entries.slice(0, split);
  let deferred = entries.slice(split);

  if (immediate.length === 0 && entries.length > 0) {
    const n = Math.min(minInitialIfNoneInRange, entries.length);
    immediate = entries.slice(0, n);
    deferred = entries.slice(n);
  }

  if (immediate.length > maxImmediateSpawns) {
    const overflow = immediate.slice(maxImmediateSpawns);
    immediate = immediate.slice(0, maxImmediateSpawns);
    deferred = [...overflow, ...deferred];
  }

  return {
    immediate,
    deferred,
    activateRadius,
    maxSpawnsPerFrame,
    staggerFramesBetween,
    staggerIdleMs,
    totalPlanned: immediate.length + deferred.length,
  };
}

/**
 * Spawn enemies near `anchor` across animation frames (avoids batch prewarm / compileAsync).
 * Queue the rest until the player enters `activateRadius` of each spawn.
 * Preserves per-spawn authored flags (heavy/portal) through the distance sort.
 */
export async function spawnEnemiesByProximity(game, anchor, options = {}) {
  clearDeferredEnemySpawnState(game);
  if (DEBUG_DISABLE_ENEMY_SPAWNS) return;
  if (!game.spawnPoints?.length) {
    console.warn("[Game] No spawn points for proximity spawn");
    return;
  }

  const plan = planProximitySpawnEntries(game, anchor, options);
  game._deferredEnemySpawnQueue = plan.deferred;
  game._proximityEnemySpawnConfig = {
    activateRadius: plan.activateRadius,
    maxSpawnsPerFrame: plan.maxSpawnsPerFrame,
  };

  if (plan.immediate.length > 0) {
    await spawnEnemiesAtPointsStaggered(
      game,
      plan.immediate.map((e) => e.pos),
      {
        lite: true,
        framesBetween: plan.staggerFramesBetween,
        idleMs: plan.staggerIdleMs,
        spawnOptsForIndex: (i) => plan.immediate[i].spawnOpts,
      },
    );
  }

  console.log(
    `[Game] Proximity spawn: ${plan.immediate.length} staggered now, ${plan.deferred.length} deferred (${plan.totalPlanned} total)`,
  );
  game.updateHUD();
}

/**
 * Proximity spawn from a precooked mission pool (Earth Defense). Dissolve shaders are
 * precompiled during loading; activation restarts the held warp without per-bot compile.
 */
export async function spawnEnemiesByProximityFromPool(game, anchor, options = {}) {
  clearDeferredEnemySpawnState(game);
  if (DEBUG_DISABLE_ENEMY_SPAWNS) return;
  const pool = game._missionEnemyPool;
  if (!pool?.length || !game.spawnPoints?.length) {
    console.warn("[Game] No mission enemy pool for proximity spawn");
    return;
  }
  if (pool.length < game.spawnPoints.length) {
    console.warn(
      `[Game] Mission pool (${pool.length}) smaller than spawn points (${game.spawnPoints.length})`,
    );
  }

  const plan = planProximitySpawnEntries(game, anchor, options);
  game._deferredEnemySpawnQueue = plan.deferred;
  game._proximityEnemySpawnConfig = {
    activateRadius: plan.activateRadius,
    maxSpawnsPerFrame: plan.maxSpawnsPerFrame,
    usePool: true,
  };

  if (plan.immediate.length > 0) {
    await activatePoolSlotsStaggered(game, plan.immediate, {
      framesBetween: plan.staggerFramesBetween,
      idleMs: plan.staggerIdleMs,
    });
  }

  console.log(
    `[Game] Proximity pool spawn: ${plan.immediate.length} activated now, ${plan.deferred.length} deferred (${plan.totalPlanned} total)`,
  );
  game.updateHUD();
}

export function processDeferredProximityEnemySpawns(game) {
  const queue = game._deferredEnemySpawnQueue;
  if (!queue?.length) return;

  const cfg = game._proximityEnemySpawnConfig;
  const r = cfg?.activateRadius ?? 340;
  const rSq = r * r;
  const maxN = cfg?.maxSpawnsPerFrame ?? 2;

  const playerPos =
    game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig.position
      : game.camera?.position;
  if (!playerPos) return;

  const usePool = cfg?.usePool === true && game._missionEnemyPool?.length > 0;
  const pool = game._missionEnemyPool;

  let spawned = 0;
  let i = 0;
  while (i < queue.length && spawned < maxN) {
    if (playerPos.distanceToSquared(queue[i].pos) <= rSq) {
      if (usePool && queue[i].poolSlot != null) {
        const enemy = pool?.[queue[i].poolSlot];
        if (enemy && !enemy.disposed && !game.enemies.includes(enemy)) {
          activatePooledMissionEnemy(game, enemy, queue[i].pos);
        }
      } else {
        spawnAtPoint(game, queue[i].pos, {
          lite: true,
          ...(queue[i].spawnOpts ?? {}),
        });
      }
      queue.splice(i, 1);
      spawned++;
    } else {
      i++;
    }
  }

  if (queue.length === 0) {
    game._proximityEnemySpawnConfig = null;
  }
}

export function spawnMissilePickups(game) {
  if (game.missileSpawnPoints.length === 0) return;

  game._missilePickups = [];
  for (let i = 0; i < game.missileSpawnPoints.length; i++) {
    const pos = game.missileSpawnPoints[i];
    const id = `missile_solo_${i}`;
    const data = { id, type: "missile", x: pos.x, y: pos.y, z: pos.z };
    const collectible = new Collectible(
      game.scene,
      data,
      game.dynamicLights,
    );
    game._missilePickups.push({
      id,
      collectible,
      pos: pos.clone(),
      respawnTimer: 0,
      active: true,
    });
  }
  console.log(
    `[Game] Spawned ${game._missilePickups.length} missile pickups`,
  );
}

function pickupTypeToWeapon(type) {
  if (type === "charging_laser") return PRIMARY_WEAPONS.CHARGING_LASER;
  if (type === "gatling") return PRIMARY_WEAPONS.GATLING;
  return null;
}

function pickupMessageForWeapon(weapon) {
  if (weapon === PRIMARY_WEAPONS.CHARGING_LASER) return "CHARGING CANNON ACQUIRED";
  if (weapon === PRIMARY_WEAPONS.GATLING) return "GATLING ACQUIRED";
  return "WEAPON ACQUIRED";
}

export function spawnWeaponPickups(game) {
  if (game._weaponPickups) {
    for (const pickup of game._weaponPickups) {
      pickup.collectible?.dispose?.();
    }
  }
  game._weaponPickups = [];
  if (!game.weaponPickupPoints?.length) return;
  for (let i = 0; i < game.weaponPickupPoints.length; i++) {
    const entry = game.weaponPickupPoints[i];
    const weapon = pickupTypeToWeapon(entry.type);
    const missionId =
      game.gameManager?.getState?.()?.currentMissionId ??
      game.pendingMissionConfig?.missionId;
    const forceMissionPickup =
      missionId === "saturnalia" ||
      missionId === "capital-ship-earth-defense" ||
      missionId === "earthdefense";
    if (!weapon || (!forceMissionPickup && isPrimaryWeaponUnlocked(weapon))) {
      continue;
    }
    const pos = entry.position;
    const id = `weapon_solo_${entry.type}_${i}`;
    const data = { id, type: entry.type, x: pos.x, y: pos.y, z: pos.z };
    const collectible = new Collectible(
      game.scene,
      data,
      game.dynamicLights,
    );
    game._weaponPickups.push({
      id,
      type: entry.type,
      weapon,
      collectible,
      pos: pos.clone(),
      active: true,
    });
  }
  if (game._weaponPickups.length > 0) {
    console.log(`[Game] Spawned ${game._weaponPickups.length} weapon pickups`);
  }
}

export function checkMissilePickups(game, playerPos, delta) {
  if (!game._missilePickups) return;
  const pickupRadiusSq = 25;

  for (const pickup of game._missilePickups) {
    if (!pickup.active) {
      pickup.respawnTimer -= delta;
      if (pickup.respawnTimer <= 0) {
        pickup.collectible = new Collectible(
          game.scene,
          {
            id: pickup.id,
            type: "missile",
            x: pickup.pos.x,
            y: pickup.pos.y,
            z: pickup.pos.z,
          },
          game.dynamicLights,
        );
        pickup.active = true;
      }
      continue;
    }

    pickup.collectible.update(delta);

    const dx = playerPos.x - pickup.pos.x;
    const dy = playerPos.y - pickup.pos.y;
    const dz = playerPos.z - pickup.pos.z;
    if (
      dx * dx + dy * dy + dz * dz < pickupRadiusSq &&
      game.player &&
      game.player.missiles < game.player.maxMissiles
    ) {
      game.player.missiles = game.player.maxMissiles;
      pickup.collectible.playPickupEffect();
      pickup.collectible.dispose();
      pickup.collectible = null;
      pickup.active = false;
      pickup.respawnTimer = 30;
      const st = game.gameManager?.getState?.();
      if (
        st?.currentMissionId === "trainingGrounds" &&
        st?.missionStepId === "ammoCollectibleBrief"
      ) {
        game.missionManager?.reportEvent?.("trainingMissilePickupCollected", {});
      } else {
        game.showPickupMessage("MISSILES REFILLED");
      }
      game.updateHUD();
    }
  }
}

export function checkWeaponPickups(game, playerPos, delta) {
  if (!game._weaponPickups) return;
  const pickupRadiusSq = 25;

  for (const pickup of game._weaponPickups) {
    if (!pickup.active) continue;
    pickup.collectible.update(delta);

    const dx = playerPos.x - pickup.pos.x;
    const dy = playerPos.y - pickup.pos.y;
    const dz = playerPos.z - pickup.pos.z;
    if (dx * dx + dy * dy + dz * dz >= pickupRadiusSq) continue;

    unlockPrimaryWeapon(pickup.weapon);
    if (game.player) {
      game.player.primaryWeaponUnlocks = {
        ...(game.player.primaryWeaponUnlocks || {}),
        [pickup.weapon]: true,
      };
    }
    pickup.collectible.playPickupEffect();
    pickup.collectible.dispose();
    pickup.collectible = null;
    pickup.active = false;
    game.setPrimaryWeapon?.(pickup.weapon);
    game.showPickupMessage(pickupMessageForWeapon(pickup.weapon));
    game.updateHUD();
    game.missionManager?.reportEvent?.("weaponPickupCollected", {
      weapon: pickup.weapon,
      type: pickup.type,
    });
  }
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/**
 * One enemy per frame (plus optional idle) — avoids long main-thread stalls from batch prewarm.
 * `lite` skips spawn dissolve VFX (deferSpawnWarp) for cheaper construction.
 */
export async function spawnEnemiesAtPointsStaggered(
  game,
  positions,
  opts = {},
) {
  if (DEBUG_DISABLE_ENEMY_SPAWNS) return;
  if (!positions?.length) return;
  const lite = opts.lite !== false;
  const framesBetween = Math.max(0, opts.framesBetween ?? 1);
  const idleMs = Math.max(0, opts.idleMs ?? 0);
  const spawnOptsForIndex = opts.spawnOptsForIndex ?? null;

  for (let i = 0; i < positions.length; i++) {
    spawnAtPoint(game, positions[i], {
      lite,
      ...(spawnOptsForIndex ? spawnOptsForIndex(i) || {} : {}),
    });
    if (i + 1 >= positions.length) break;
    for (let f = 0; f < framesBetween; f++) {
      await nextAnimationFrame();
    }
    if (idleMs > 0) {
      await new Promise((r) => setTimeout(r, idleMs));
    }
  }
  game.gameManager.setState({ enemiesRemaining: game.enemies.length });
  game.updateHUD?.();
}

async function activatePoolSlotsStaggered(game, entries, opts = {}) {
  const framesBetween = Math.max(0, opts.framesBetween ?? 1);
  const idleMs = Math.max(0, opts.idleMs ?? 0);
  const pool = game._missionEnemyPool;
  if (!pool?.length || !entries?.length) return;

  for (let i = 0; i < entries.length; i++) {
    const slot = entries[i].poolSlot;
    const enemy = slot != null ? pool[slot] : null;
    if (enemy && !enemy.disposed && !game.enemies.includes(enemy)) {
      activatePooledMissionEnemy(game, enemy, entries[i].pos);
    }
    if (i + 1 >= entries.length) break;
    for (let f = 0; f < framesBetween; f++) {
      await nextAnimationFrame();
    }
    if (idleMs > 0) {
      await new Promise((r) => setTimeout(r, idleMs));
    }
  }
  game.gameManager.setState({ enemiesRemaining: game.enemies.length });
  game.updateHUD?.();
}

export function spawnAtPoint(game, pos, spawnOpts = {}) {
  if (DEBUG_DISABLE_ENEMY_SPAWNS) return null;
  const enemy = new Enemy(
    game.scene,
    pos.clone(),
    game.level,
    game._levelBounds,
    {
      ...enemySpawnOptions(game),
      ...cheapEnemySpawnCtorOpts(spawnOpts),
      ...(spawnOpts.isHeavy === true ? { isHeavy: true } : {}),
      ...(spawnOpts.isPortalBot === true ? { isPortalBot: true } : {}),
      ...(spawnOpts.shipScale != null ? { shipScale: spawnOpts.shipScale } : {}),
    },
  );
  enemy.summonedByPortal = spawnOpts.summoned === true;
  game.enemies.push(enemy);
  linkPortalForEnemy(game, enemy, pos);
  game.gameManager.setState({ enemiesRemaining: game.enemies.length });
  return enemy;
}

export async function spawnAuthoredEnemiesFast(game, positions, options = {}) {
  if (DEBUG_DISABLE_ENEMY_SPAWNS) return;
  if (!positions?.length) return;
  const compile = options.compile !== false;
  const opts = {
    ...enemySpawnOptions(game),
    deferSpawnWarp: true,
    cloneMaterials: false,
    disableRevealWarp: true,
  };
  const nModels = shipModels.length;

  for (let i = 0; i < positions.length; i++) {
    const enemy = new Enemy(
      game.scene,
      positions[i].clone(),
      game.level,
      game._levelBounds,
      {
        ...opts,
        ...enemyOptionsForAuthoredSpawn(game, i),
        ...(nModels > 0 ? { modelIndex: i % nModels } : {}),
      },
    );
    game.enemies.push(enemy);
    linkPortalForEnemy(game, enemy, positions[i]);
    if (i % ENEMY_CONSTRUCT_RAF_CHUNK === ENEMY_CONSTRUCT_RAF_CHUNK - 1) {
      await nextAnimationFrame();
    }
  }

  if (compile && game.renderer && game.camera) {
    if (game.renderer.compileAsync) {
      await game.renderer.compileAsync(game.scene, game.camera);
    } else {
      game.renderer.compile(game.scene, game.camera);
    }
  }

  game.gameManager.setState({ enemiesRemaining: game.enemies.length });
  game.updateHUD?.();
}

function activateEnemyAtSpawn(game, enemy, position, { skipHud = false, spawnIndex = null } = {}) {
  if (spawnIndex != null) {
    enemy.setShipScale(enemyShipScaleForSpawnIndex(game, spawnIndex));
  }
  enemy.health = enemy.baseHealth ?? (enemy.isHeavy ? 300 : 100);
  enemy.state = "wander";
  enemy.fireCooldown = 0;
  if (enemy.isHeavy) enemy.heavyMissileTimer = enemy.heavyMissileInterval;
  enemy.hasLOS = false;
  enemy.losCheckCounter = 0;
  enemy.velocity.set(0, 0, 0);
  enemy.disposed = false;
  enemy.spawnPoint.copy(position);
  enemy.mesh.position.copy(position);
  enemy.mesh.visible = false;
  if (enemy.shipLight) {
    enemy.shipLight.intensity = enemy.shipLightIntensity;
  }
  enemy._pickNewWaypoint();

  const dissolveOptsBase = {
    duration: ENEMY_SPAWN_DISSOLVE_DURATION,
    edgeColor: enemy.laserColor,
    particleColor: enemy.laserColor,
    particleDecimation: 8,
    particleSize: 26,
  };
  const dissolveOpts = enemy._enemyDissolvePrecooked
    ? {
        ...dissolveOptsBase,
        dissolvePrecooked: enemy._enemyDissolvePrecooked,
        retainDissolveMaterials: true,
        particles: false,
      }
    : dissolveOptsBase;

  enemy.spawnWarp?.dispose?.();
  if (!enemy._enemyDissolvePrecooked) {
    stripCheckpointDissolveMaterials(enemy.mesh);
  }
  enemy.spawnWarp = beginCheckpointDissolve(enemy.mesh, game, dissolveOpts);

  if (!game.enemies.includes(enemy)) {
    game.enemies.push(enemy);
  }
  if (!skipHud) {
    game.gameManager.setState({ enemiesRemaining: game.enemies.length });
  }

  enemy.mesh.visible = true;
  if (enemy.spawnWarp && !enemy.spawnWarp.disposed && !enemy.spawnWarp.finished) {
    enemy.spawnWarp.update(1 / 60);
  }
}

const ENEMY_CONSTRUCT_RAF_CHUNK = 5;

/**
 * Bulk spawn at world positions: build hidden enemies (spread across frames),
 * prewarm GPU, then activate so warp VFX plays without a compile hitch.
 * @param {Function|null} enemyOptionsForIndex – (i) => partial Enemy ctor options, e.g. `{ missionPoolSlot }`
 */
export async function spawnEnemiesAtPointsWithPrewarm(
  game,
  positions,
  enemyOptionsForIndex = null,
) {
  if (DEBUG_DISABLE_ENEMY_SPAWNS) return;
  if (!positions?.length) return;
  if (!game.renderer || !game.camera) {
    for (let i = 0; i < positions.length; i++) {
      const extra =
        typeof enemyOptionsForIndex === "function"
          ? enemyOptionsForIndex(i) || {}
          : enemyOptionsForIndex || {};
      spawnAtPoint(game, positions[i], extra);
    }
    return;
  }

  const base = new THREE.Vector3(0, MISSION_POOL_HIDE_Y, 0);
  const optsBase = {
    ...enemySpawnOptions(game),
    deferSpawnWarp: true,
  };
  const enemies = [];
  const nModels = shipModels.length;

  for (let i = 0; i < positions.length; i++) {
    const extra =
      typeof enemyOptionsForIndex === "function"
        ? enemyOptionsForIndex(i) || {}
        : enemyOptionsForIndex || {};
    const modelPick =
      extra.modelIndex != null
        ? extra.modelIndex
        : nModels > 0
          ? i % nModels
          : undefined;
    const enemy = new Enemy(
      game.scene,
      base.clone(),
      game.level,
      game._levelBounds,
      {
        ...optsBase,
        ...extra,
        ...(modelPick !== undefined ? { modelIndex: modelPick } : {}),
      },
    );
    enemy.mesh.visible = false;
    if (enemy.shipLight) enemy.shipLight.intensity = 0;
    enemy.spawnWarp = beginCheckpointDissolve(enemy.mesh, game, {
      duration: ENEMY_SPAWN_DISSOLVE_DURATION,
      edgeColor: enemy.laserColor,
      particleColor: enemy.laserColor,
      particleDecimation: 8,
      particleSize: 26,
    });
    while (!enemy.spawnWarp.finished) {
      enemy.spawnWarp.update(0.25);
    }
    enemy.spawnWarp.restart({ hold: true });
    enemies.push(enemy);
    if (i % ENEMY_CONSTRUCT_RAF_CHUNK === ENEMY_CONSTRUCT_RAF_CHUNK - 1) {
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  await prewarmEnemyMeshesInPlace(game, enemies, positions);

  for (let i = 0; i < enemies.length; i++) {
    activateEnemyAtSpawn(game, enemies[i], positions[i], {
      skipHud: true,
      spawnIndex: i,
    });
    linkPortalForEnemy(game, enemies[i], positions[i]);
  }
  game.gameManager.setState({ enemiesRemaining: game.enemies.length });
}

const MISSION_POOL_HIDE_Y = -200000;

function getTrainingMissionPoolCount(game) {
  return Math.max(
    TRAINING_MISSION_WAVE_SIZE,
    getAllLevelEnemySpawnPositions(game).length,
  );
}

export function disposeMissionEnemyPool(game) {
  if (!game._missionEnemyPool?.length) {
    game._missionEnemyPool = null;
    return;
  }
  for (const enemy of game._missionEnemyPool) {
    try {
      enemy.spawnWarp?.dispose?.();
      stripCheckpointDissolveMaterials(enemy.mesh);
      enemy.dispose(game.scene, null);
    } catch (err) {
      console.warn("[gameEnemies] disposeMissionEnemyPool:", err);
    }
  }
  game._missionEnemyPool = null;
}

/** Max portal-summoned drones alive across all portals (4 portals × 4 each + headroom). */
const PORTAL_SUMMON_POOL_SIZE = 32;
const PORTAL_SUMMON_POOL_HIDE_Y = -201000;

function getPortalSummonPrewarmPositions(game) {
  const positions = [];
  const flags = game.enemySpawnPortalFlags;
  const spawns = game.spawnPoints;
  if (flags?.length && spawns?.length) {
    for (let i = 0; i < spawns.length; i++) {
      if (flags[i] === true) positions.push(spawns[i].clone());
    }
  }
  if (positions.length === 0 && spawns?.length) {
    positions.push(spawns[0].clone());
  }
  return positions;
}

function takeAvailablePortalSummonPoolEnemy(game) {
  const pool = game._portalSummonEnemyPool;
  if (!pool?.length) return null;
  for (const enemy of pool) {
    if (enemy && !enemy.disposed && !game.enemies.includes(enemy)) {
      return enemy;
    }
  }
  return null;
}

export function disposePortalSummonEnemyPool(game) {
  if (!game._portalSummonEnemyPool?.length) {
    game._portalSummonEnemyPool = null;
    return;
  }
  for (const enemy of game._portalSummonEnemyPool) {
    try {
      enemy.spawnWarp?.dispose?.();
      stripCheckpointDissolveMaterials(enemy.mesh);
      enemy.dispose(game.scene, null);
    } catch (err) {
      console.warn("[gameEnemies] disposePortalSummonEnemyPool:", err);
    }
  }
  game._portalSummonEnemyPool = null;
}

async function buildPortalSummonEnemyPool(game, poolCount) {
  const base = new THREE.Vector3(0, PORTAL_SUMMON_POOL_HIDE_Y, 0);
  const opts = {
    ...enemySpawnOptions(game),
    deferSpawnWarp: true,
    disableRevealWarp: true,
    cloneMaterials: true,
  };
  const pool = [];
  const nModels = shipModels.length;
  const dissolveBatchSerial = allocateCheckpointDissolveBatchSerial();
  for (let i = 0; i < poolCount; i++) {
    const modelIndex = nModels > 0 ? i % nModels : undefined;
    const enemy = new Enemy(
      game.scene,
      base.clone(),
      game.level,
      game._levelBounds,
      {
        ...opts,
        portalSummonPoolSlot: i,
        ...(modelIndex !== undefined ? { modelIndex } : {}),
      },
    );
    enemy.mesh.visible = false;
    if (enemy.shipLight) enemy.shipLight.intensity = 0;
    enemy._enemyDissolvePrecooked = precookCheckpointDissolveMaterials(
      enemy.mesh,
      {
        edgeColor: enemy.laserColor,
        edgeColor2: enemy.laserColor,
        sharedDissolveBatchSerial: dissolveBatchSerial,
      },
    );
    enemy.spawnWarp = beginCheckpointDissolve(enemy.mesh, game, {
      duration: ENEMY_SPAWN_DISSOLVE_DURATION,
      edgeColor: enemy.laserColor,
      particleColor: enemy.laserColor,
      particleDecimation: 8,
      particleSize: 26,
      dissolvePrecooked: enemy._enemyDissolvePrecooked,
      retainDissolveMaterials: true,
    });
    while (!enemy.spawnWarp.finished) {
      enemy.spawnWarp.update(0.25);
    }
    enemy.spawnWarp.restart({ hold: true });
    pool.push(enemy);
    if (i % ENEMY_CONSTRUCT_RAF_CHUNK === ENEMY_CONSTRUCT_RAF_CHUNK - 1) {
      await nextAnimationFrame();
    }
  }
  game._portalSummonEnemyPool = pool;
}

/**
 * Precooked pool for drones summoned by EnemyPortal (not portal-bot owners).
 * Built during Earth Defense load; activation reuses precompiled dissolve shaders.
 */
export async function initPortalSummonEnemyPool(game, options = {}) {
  disposePortalSummonEnemyPool(game);
  const poolCount = Math.max(1, options.poolSize ?? PORTAL_SUMMON_POOL_SIZE);
  await buildPortalSummonEnemyPool(game, poolCount);
  const prewarmPositions =
    options.prewarmPositions ?? getPortalSummonPrewarmPositions(game);
  const padded = prewarmPositions.map((p) => p.clone());
  const padRef = padded[padded.length - 1] ?? new THREE.Vector3(0, 4, -45);
  while (padded.length < poolCount) {
    padded.push(padRef.clone());
  }
  await prewarmEnemyMeshesInPlace(game, game._portalSummonEnemyPool, padded);
  console.log(
    `[Game] Portal summon pool: ${poolCount} precooked drones prewarmed`,
  );
}

/**
 * Portal summons reuse the small mission pool when a slot is free.
 */
export function spawnPortalSummonedEnemy(game, position, spawnOpts = {}) {
  if (DEBUG_DISABLE_ENEMY_SPAWNS) return null;
  const portalPooled = takeAvailablePortalSummonPoolEnemy(game);
  if (portalPooled) {
    activatePooledMissionEnemy(game, portalPooled, position, {
      summoned: true,
      ...spawnOpts,
    });
    return portalPooled;
  }
  const pooled = takeAvailableMissionPoolEnemy(game);
  if (pooled) {
    activatePooledMissionEnemy(game, pooled, position, {
      summoned: true,
      ...spawnOpts,
    });
    return pooled;
  }
  return spawnAtPoint(game, position, {
    summoned: true,
    cheapSpawn: true,
    shipScale: computeEnemyShipScale({}),
    ...spawnOpts,
  });
}

function renderPrewarmFrame(game) {
  if (game.xrManager?.isPresenting) {
    game.renderer.render(game.scene, game.camera);
  } else if (game._bloomActive && game.composer) {
    game.composer.render();
  } else {
    game.renderer.render(game.scene, game.camera);
  }
}

function focusCameraOnPrewarmTargets(game, positions) {
  const camera = game.camera;
  if (!camera || !positions.length) return null;

  const center = new THREE.Vector3();
  for (const position of positions) center.add(position);
  center.multiplyScalar(1 / positions.length);

  let radius = 12;
  for (const position of positions) {
    radius = Math.max(radius, center.distanceTo(position));
  }

  const saved = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
  };
  camera.position.copy(center).add(new THREE.Vector3(0, radius * 0.4, radius * 1.8));
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  return saved;
}

function isolatePrewarmScene(game, enemies) {
  const allowed = new Set(enemies.map((e) => e.mesh));
  const hidden = [];
  for (const child of game.scene.children) {
    if (allowed.has(child) || child.isLight) continue;
    hidden.push({ child, visible: child.visible });
    child.visible = false;
  }
  return hidden;
}

/**
 * Narrow-style warm for arbitrary enemy batches (mission pool init, bulk spawn prewarm).
 * Hides other top-level scene nodes, focuses camera on `positions`, runs warp + compile + one play render.
 * Mirrors checkpoint “narrow warm” intent; differs by camera + per-enemy placement for frustum.
 */
export async function prewarmEnemyMeshesInPlace(game, enemies, positions) {
  if (!enemies?.length || !positions?.length || !game.renderer || !game.camera) {
    return;
  }

  const cameraState = focusCameraOnPrewarmTargets(game, positions);
  const hiddenSceneChildren = isolatePrewarmScene(game, enemies);
  const saved = enemies.map((enemy) => ({
    meshPos: enemy.mesh.position.clone(),
    meshVisible: enemy.mesh.visible,
    meshFrustumCulled: enemy.mesh.frustumCulled,
    lightIntensity: enemy.shipLight?.intensity ?? 0,
  }));

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    const p = positions[i] ?? positions[0];
    enemy.mesh.position.copy(p);
    enemy.mesh.visible = true;
    enemy.mesh.frustumCulled = false;
    if (enemy.shipLight) {
      enemy.shipLight.intensity = enemy.shipLightIntensity ?? 7;
      enemy.shipLight.position.copy(enemy.mesh.position);
      enemy.shipLight.position.y += 0.3;
      enemy.shipLight.position.z += 6;
    }
  }

  try {
    for (let i = 0; i < enemies.length; i++) {
      const w = enemies[i].spawnWarp;
      if (!w || w.disposed) continue;
      w.unfreeze();
      let guard = 0;
      while (!w.finished && guard++ < 200) {
        w.update(0.25);
      }
      w.restart({ hold: true });
    }
    // Sync compile only: compileAsync() polls materials on a timer; mission teardown
    // (flushRetainedEnemyMeshes / disposeMissionEnemyPool) can dispose those materials
    // mid-flight and crash WebGLRenderer.checkMaterialsReady (program undefined).
    if (game.renderer.compileAsync) {
      await game.renderer.compileAsync(game.scene, game.camera);
    } else {
      game.renderer.compile(game.scene, game.camera);
    }
    renderPrewarmFrame(game);
  } finally {
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const s = saved[i];
      enemy.mesh.position.copy(s.meshPos);
      enemy.mesh.visible = s.meshVisible;
      enemy.mesh.frustumCulled = s.meshFrustumCulled;
      if (enemy.shipLight) {
        enemy.shipLight.position.copy(enemy.mesh.position);
        enemy.shipLight.position.y += 0.3;
        enemy.shipLight.position.z += 6;
        enemy.shipLight.intensity = s.lightIntensity;
      }
    }
    for (const { child, visible } of hiddenSceneChildren) {
      child.visible = visible;
    }
    if (cameraState) {
      game.camera.position.copy(cameraState.position);
      game.camera.quaternion.copy(cameraState.quaternion);
      game.camera.updateMatrixWorld(true);
    }
  }
}

async function prewarmMissionEnemyPoolInPlace(game, worldPositions) {
  const pool = game._missionEnemyPool;
  if (!pool?.length) return;
  const padded =
    worldPositions != null && worldPositions.length > 0
      ? worldPositions.map((p) => p.clone())
      : getAllLevelEnemySpawnPositions(game).slice();
  const padRef =
    padded[padded.length - 1] ?? new THREE.Vector3(0, 4, -45);
  while (padded.length < pool.length) {
    padded.push(padRef.clone());
  }
  await prewarmEnemyMeshesInPlace(game, pool, padded);
}

async function buildMissionEnemyPoolOfSize(game, poolCount, perSlotOptions = null) {
  const base = new THREE.Vector3(0, MISSION_POOL_HIDE_Y, 0);
  const opts = {
    ...enemySpawnOptions(game),
    deferSpawnWarp: true,
    disableRevealWarp: true,
  };
  const pool = [];
  const nModels = shipModels.length;
  const enemyPoolDissolveBatchSerial = allocateCheckpointDissolveBatchSerial();
  for (let i = 0; i < poolCount; i++) {
    const slotExtra = perSlotOptions?.[i] ?? {};
    const modelIndex = nModels > 0 ? i % nModels : undefined;
    const enemy = new Enemy(
      game.scene,
      base.clone(),
      game.level,
      game._levelBounds,
      {
        ...opts,
        missionPoolSlot: i,
        ...slotExtra,
        ...(modelIndex !== undefined ? { modelIndex } : {}),
      },
    );
    enemy.mesh.visible = false;
    if (enemy.shipLight) enemy.shipLight.intensity = 0;
    enemy._enemyDissolvePrecooked = precookCheckpointDissolveMaterials(
      enemy.mesh,
      {
        edgeColor: enemy.laserColor,
        edgeColor2: enemy.laserColor,
        sharedDissolveBatchSerial: enemyPoolDissolveBatchSerial,
      },
    );
    enemy.spawnWarp = beginCheckpointDissolve(enemy.mesh, game, {
      duration: ENEMY_SPAWN_DISSOLVE_DURATION,
      edgeColor: enemy.laserColor,
      particleColor: enemy.laserColor,
      particleDecimation: 8,
      particleSize: 26,
      dissolvePrecooked: enemy._enemyDissolvePrecooked,
      retainDissolveMaterials: true,
    });
    while (!enemy.spawnWarp.finished) {
      enemy.spawnWarp.update(0.25);
    }
    enemy.spawnWarp.restart({ hold: true });
    pool.push(enemy);
    if (i % ENEMY_CONSTRUCT_RAF_CHUNK === ENEMY_CONSTRUCT_RAF_CHUNK - 1) {
      await nextAnimationFrame();
    }
  }
  game._missionEnemyPool = pool;
}

export async function initTrainingMissionEnemyPool(game) {
  disposeMissionEnemyPool(game);
  const poolCount = getTrainingMissionPoolCount(game);
  await buildMissionEnemyPoolOfSize(game, poolCount);
  await prewarmMissionEnemyPoolInPlace(game, null);
}

/**
 * Charon / Saturnalia / Earth: small reusable pool (no per-spawn-point precook).
 * Extra authored spawns queue until a pool slot frees or player enters range.
 */
export async function initAuthoredMissionEnemyPool(game) {
  disposeMissionEnemyPool(game);
  await buildAuthoredMissionEnemyPool(game, AUTHORED_MISSION_POOL_SIZE);
  console.log(
    `[Game] Authored mission pool: ${AUTHORED_MISSION_POOL_SIZE} reusable enemies`,
  );
}

async function buildAuthoredMissionEnemyPool(game, poolCount) {
  const base = new THREE.Vector3(0, MISSION_POOL_HIDE_Y, 0);
  const opts = {
    ...enemySpawnOptions(game),
    deferSpawnWarp: true,
    disableRevealWarp: true,
    cloneMaterials: true,
  };
  const pool = [];
  const nModels = shipModels.length;
  for (let i = 0; i < poolCount; i++) {
    const modelIndex = nModels > 0 ? i % nModels : undefined;
    const enemy = new Enemy(
      game.scene,
      base.clone(),
      game.level,
      game._levelBounds,
      {
        ...opts,
        missionPoolSlot: i,
        ...(modelIndex !== undefined ? { modelIndex } : {}),
      },
    );
    enemy.mesh.visible = false;
    if (enemy.shipLight) enemy.shipLight.intensity = 0;
    pool.push(enemy);
    if (i % ENEMY_CONSTRUCT_RAF_CHUNK === ENEMY_CONSTRUCT_RAF_CHUNK - 1) {
      await nextAnimationFrame();
    }
  }
  game._missionEnemyPool = pool;
}

function authoredSpawnEntriesFromPositions(game, positions) {
  const perSlot = game._missionEnemyPerSlotOptions;
  const anchor = soloPlayerAnchor(game);
  const entries = positions.map((pos, i) => ({
    pos: pos.clone(),
    spawnIndex: i,
    spawnOpts: {
      isHeavy: perSlot?.[i]?.isHeavy === true,
      isPortalBot: perSlot?.[i]?.isPortalBot === true,
      shipScale: enemyShipScaleForSpawnIndex(game, i),
    },
  }));
  if (anchor) {
    entries.sort(
      (a, b) =>
        a.pos.distanceToSquared(anchor) - b.pos.distanceToSquared(anchor),
    );
  }
  return entries;
}

function fillAuthoredMissionSpawns(game, maxActivate) {
  const queue = game._authoredEnemySpawnQueue;
  if (!queue?.length || maxActivate <= 0) return 0;
  let activated = 0;
  while (activated < maxActivate && queue.length > 0) {
    const enemy = takeAvailableMissionPoolEnemy(game);
    if (!enemy) break;
    const entry = queue.shift();
    activatePooledMissionEnemy(game, enemy, entry.pos, entry.spawnOpts);
    enemy._authoredSpawnIndex = entry.spawnIndex;
    activated++;
  }
  if (activated > 0) syncMissionEnemyHud(game);
  return activated;
}

/**
 * Activate nearest authored spawns up to pool capacity; queue the rest.
 */
export function spawnAuthoredMissionEnemiesFromPool(game, options = {}) {
  const positions =
    game._missionInitialEnemyPositions ??
    game.spawnPoints?.map((p) => p.clone()) ??
    [];
  if (!positions.length || !game._missionEnemyPool?.length) return false;

  game._authoredEnemySpawnQueue = authoredSpawnEntriesFromPositions(
    game,
    positions,
  );
  game._authoredEnemySpawnConfig = {
    activateRadius: options.activateRadius ?? 340,
    maxSpawnsPerFrame: Math.max(1, options.maxSpawnsPerFrame ?? 2),
  };

  const poolCap = game._missionEnemyPool?.length ?? AUTHORED_MISSION_POOL_SIZE;
  const initialCap = Math.min(
    options.initialCount ?? poolCap,
    poolCap,
    positions.length,
  );
  fillAuthoredMissionSpawns(game, initialCap);
  console.log(
    `[Game] Authored spawn: ${game.enemies.length} active, ${game._authoredEnemySpawnQueue.length} queued (${positions.length} total)`,
  );
  syncMissionEnemyHud(game);
  return true;
}

export function processDeferredAuthoredMissionSpawns(game) {
  const queue = game._authoredEnemySpawnQueue;
  if (!queue?.length) return;

  const cfg = game._authoredEnemySpawnConfig;
  const playerPos = soloPlayerAnchor(game);
  if (!playerPos) return;

  const rSq = (cfg?.activateRadius ?? 340) ** 2;
  const maxN = cfg?.maxSpawnsPerFrame ?? 2;
  let spawned = 0;
  let i = 0;
  while (i < queue.length && spawned < maxN) {
    const enemy = takeAvailableMissionPoolEnemy(game);
    if (!enemy) break;
    if (playerPos.distanceToSquared(queue[i].pos) <= rSq) {
      const entry = queue.splice(i, 1)[0];
      activatePooledMissionEnemy(game, enemy, entry.pos, entry.spawnOpts);
      enemy._authoredSpawnIndex = entry.spawnIndex;
      spawned++;
    } else {
      i++;
    }
  }
  if (spawned > 0) syncMissionEnemyHud(game);
}

export async function initEarthDefenseMissionEnemyPool(game) {
  disposeMissionEnemyPool(game);
  await buildAuthoredMissionEnemyPool(game, EARTH_DEFENSE_POOL_SIZE);
  console.log(
    `[Game] Earth Defense mission pool: ${EARTH_DEFENSE_POOL_SIZE} reusable enemies`,
  );
}

/**
 * Activate queued (or never-started) authored spawns near a world point.
 * Never removes active enemies — only fills free pool slots.
 */
export function activateAuthoredSpawnsNearPoint(game, center, options = {}) {
  if (!center) return 0;
  const radius = options.radius ?? BOSS_ARENA_SPAWN_RADIUS;
  const maxActivate = options.maxActivate ?? Infinity;
  const radiusSq = radius * radius;
  let activated = 0;

  const queue = game._authoredEnemySpawnQueue;
  if (queue?.length) {
    for (let i = queue.length - 1; i >= 0 && activated < maxActivate; i--) {
      if (queue[i].pos.distanceToSquared(center) > radiusSq) continue;
      const enemy = takeAvailableMissionPoolEnemy(game);
      if (!enemy) break;
      const entry = queue.splice(i, 1)[0];
      activatePooledMissionEnemy(game, enemy, entry.pos, entry.spawnOpts);
      enemy._authoredSpawnIndex = entry.spawnIndex;
      activated++;
    }
  }

  const positions = game._missionInitialEnemyPositions;
  const perSlot = game._missionEnemyPerSlotOptions;
  if (positions?.length && activated < maxActivate) {
    for (let i = 0; i < positions.length && activated < maxActivate; i++) {
      const pos = positions[i];
      if (pos.distanceToSquared(center) > radiusSq) continue;
      if (
        game.enemies.some(
          (enemy) => enemy?._authoredSpawnIndex === i && !enemy.disposed,
        )
      ) {
        continue;
      }
      const enemy = takeAvailableMissionPoolEnemy(game);
      if (!enemy) break;
      activatePooledMissionEnemy(
        game,
        enemy,
        pos,
        perSlot?.[i]
          ? { ...perSlot[i], shipScale: enemyShipScaleForSpawnIndex(game, i) }
          : enemyOptionsForAuthoredSpawn(game, i),
      );
      enemy._authoredSpawnIndex = i;
      activated++;
    }
  }

  if (activated > 0) {
    syncMissionEnemyHud(game);
    console.log(
      `[Game] Activated ${activated} authored spawn(s) near (${center.x.toFixed(0)}, ${center.y.toFixed(0)}, ${center.z.toFixed(0)})`,
    );
  }
  return activated;
}

/** @deprecated Use {@link initAuthoredMissionEnemyPool} */
export async function initCharonMissionEnemyPool(game, prewarmPositions) {
  await initAuthoredMissionEnemyPool(game);
}

/** @deprecated Use {@link initAuthoredMissionEnemyPool} */
export async function initEarthMissionEnemyPool(game, prewarmPositions) {
  await initAuthoredMissionEnemyPool(game);
}

export function spawnMissionWaveFromPool(game, positions, options = {}) {
  const pool = game._missionEnemyPool;
  if (!pool?.length || !positions?.length) return false;
  if (positions.length > pool.length) {
    game._missionInitialEnemyPositions = positions.map((p) => p.clone());
    return spawnAuthoredMissionEnemiesFromPool(game, options);
  }
  for (let i = 0; i < positions.length; i++) {
    activatePooledMissionEnemy(
      game,
      pool[i],
      positions[i],
      game._missionEnemyPerSlotOptions?.[i] ??
        enemyOptionsForAuthoredSpawn(game, i),
    );
  }
  syncMissionEnemyHud(game);
  return true;
}

function activatePooledMissionEnemy(game, enemy, position, spawnOpts = {}) {
  if (spawnOpts.isPortalBot === true) enemy.isPortalBot = true;
  if (spawnOpts.isHeavy === true) {
    enemy.isHeavy = true;
    enemy.health = enemy.baseHealth ?? 300;
  } else {
    enemy.isHeavy = false;
    enemy.health = enemy.baseHealth ?? 100;
  }
  const shipScale =
    spawnOpts.shipScale ??
    (spawnOpts.spawnIndex != null
      ? enemyShipScaleForSpawnIndex(game, spawnOpts.spawnIndex)
      : null);
  if (shipScale != null) {
    enemy.setShipScale(shipScale);
  }
  enemy.state = "wander";
  enemy.fireCooldown = 0;
  enemy.hasLOS = false;
  enemy.losCheckCounter = 0;
  enemy.velocity.set(0, 0, 0);
  enemy.disposed = false;
  enemy.summonedByPortal = spawnOpts.summoned === true;
  enemy.spawnPoint.copy(position);
  enemy.mesh.position.copy(position);
  enemy.mesh.frustumCulled = true;
  stripCheckpointDissolveMaterials(enemy.mesh);
  enemy.spawnWarp?.dispose?.();
  enemy.spawnWarp = null;
  enemy.mesh.visible = true;
  if (enemy.shipLight) {
    enemy.shipLight.intensity = enemy.shipLightIntensity;
    enemy.shipLight.position.copy(position);
    enemy.shipLight.position.y += 0.3;
    enemy.shipLight.position.z += 6;
  }
  enemy._pickNewWaypoint();
  if (!game.enemies.includes(enemy)) {
    game.enemies.push(enemy);
  }
  if (enemy.isPortalBot) {
    linkPortalForEnemy(game, enemy, position);
  }
}

export function tickEnemyRespawns(game, delta) {
  for (let i = game.enemyRespawnQueue.length - 1; i >= 0; i--) {
    game.enemyRespawnQueue[i].timer -= delta;
    if (game.enemyRespawnQueue[i].timer <= 0) {
      const { pos, missionPoolSlot } = game.enemyRespawnQueue[i];
      game.enemyRespawnQueue.splice(i, 1);
      const pool = game._missionEnemyPool;
      if (
        missionPoolSlot != null &&
        pool?.length &&
        missionPoolSlot < pool.length
      ) {
        const pooled = pool[missionPoolSlot];
        if (pooled && !game.enemies.includes(pooled)) {
          activatePooledMissionEnemy(game, pooled, pos);
          continue;
        }
      }
      spawnAtPoint(game, pos);
    }
  }
}

export function respawnCharonEscapeEnemies(game) {
  const pool = game._missionEnemyPool;
  const positions =
    game._missionInitialEnemyPositions ?? game._charonInitialEnemyPositions;
  if (!pool?.length || !positions?.length) return;

  for (let i = 0; i < positions.length; i++) {
    const enemy = takeAvailableMissionPoolEnemy(game);
    if (!enemy) break;
    const pos = positions[i] ?? positions[0];
    activatePooledMissionEnemy(game, enemy, pos, {
      isHeavy: game._missionEnemyPerSlotOptions?.[i]?.isHeavy === true,
      isPortalBot: game._missionEnemyPerSlotOptions?.[i]?.isPortalBot === true,
      shipScale: enemyShipScaleForSpawnIndex(game, i),
    });
  }
  syncMissionEnemyHud(game);
}
