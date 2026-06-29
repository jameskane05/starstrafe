/**
 * gameCombat.js - WEAPONS, HITS, AND COMBAT RESOLUTION
 * =============================================================================
 *
 * ROLE: Handles firing (player and enemy), projectile/missile creation, hit
 * detection, damage, explosions, and laser impacts. Optional SplatEdit layer
 * for projectile lights. Network-aware for multiplayer (broadcast hits, sync).
 *
 * KEY RESPONSIBILITIES:
 * - initProjectileSplatLayer(game), createProjectileSplatLight (optional splat lights)
 * - firePlayerWeapon / fireEnemyWeapon: create Projectile or Missile, add to game
 * - Hit detection (sphere cast/collision); apply damage, spawn Explosion/LaserImpact
 * - Ship destruction (ShipDestruction), SFX and procedural audio, HUD kill updates
 *
 * RELATED: Projectile.js, Missile.js, Explosion.js, LaserImpact.js, Physics.js,
 * ShipDestruction.js, NetworkManager.js, sfxManager.js, ProceduralAudio.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import {
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
  SplatEditRgbaBlendMode,
} from "@sparkjsdev/spark";
import { castSphere, checkSphereCollision } from "../physics/Physics.js";
import { Projectile, PLAYER_LASER_INTENSITY } from "../entities/Projectile.js";
import { Missile } from "../entities/Missile.js";
import { KineticMissile } from "../entities/KineticMissile.js";
import { Explosion } from "../entities/Explosion.js";
import { LaserImpact } from "../entities/LaserImpact.js";
import { spawnDestruction } from "../vfx/ShipDestruction.js";
import {
  beginCheckpointDissolve,
  ENEMY_SPAWN_DISSOLVE_DURATION,
  stripCheckpointDissolveMaterials,
} from "../vfx/checkpointDissolveWarp.js";
import NetworkManager from "../network/NetworkManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import sfxManager from "../audio/sfxManager.js";
import {
  applyCharonReactorCoreLaserHit,
  applyCharonReactorCoreMissileHit,
  getCharonCoreHitDistanceAlongSegment,
} from "./charonReactorCore.js";
import { Collectible } from "../entities/Collectible.js";

const MISSILE_DROP_CHANCE = 0.15;
let _missileDropUid = 0;

function tryDropMissilePickup(game, deathPos) {
  const player = game.player;
  if (!player || player.missiles >= player.maxMissiles) return;
  if (Math.random() > MISSILE_DROP_CHANCE) return;
  const id = `drop_missile_${++_missileDropUid}`;
  const data = { id, type: "missile", x: deathPos.x, y: deathPos.y, z: deathPos.z };
  const collectible = new Collectible(game.scene, data, game.dynamicLights);
  if (!game._missilePickups) game._missilePickups = [];
  game._missilePickups.push({ id, collectible, pos: deathPos.clone(), respawnTimer: 0, active: true });
}

const _fireDir = new THREE.Vector3();
const _hitPos = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _sparkPos = new THREE.Vector3();
const _colorScratch = new THREE.Color();

function shouldQueueSoloEnemyRespawn(game) {
  return (
    !game.isMultiplayer && !game.missionManager?.shouldSuppressRespawns?.()
  );
}

function getSoloDifficultySetting(game, category, key, fallback) {
  if (game.isMultiplayer) return fallback;
  const value = game.gameManager?.getDifficultySetting?.(category, key);
  return value ?? fallback;
}

function destroyTrainingPoolEnemy(game, enemy, index, weaponType = "laser") {
  const deathPos = enemy.mesh.position.clone();
  const deathQuat = enemy.mesh.quaternion.clone();
  const explosion = new Explosion(
    game.scene,
    deathPos,
    enemy.glowColor,
    game.dynamicLights,
    { big: true },
  );
  game.explosions.push(explosion);
  sfxManager.play("ship-explosion", deathPos, 0.6);
  if (game.particles) {
    game.explosionEffect.emitBigExplosion(deathPos);
  }
  spawnDestruction(game.scene, deathPos, deathQuat, enemy.modelIndex);
  tryDropMissilePickup(game, deathPos);
  proceduralAudio.checkpointGoalSuccess();
  enemy.spawnWarp?.dispose?.();
  if (!enemy._enemyDissolvePrecooked) {
    stripCheckpointDissolveMaterials(enemy.mesh);
  }
  enemy.spawnWarp = beginCheckpointDissolve(enemy.mesh, game, {
    duration: ENEMY_SPAWN_DISSOLVE_DURATION,
    edgeColor: enemy.laserColor,
    particleColor: enemy.laserColor,
    particleDecimation: 8,
    particleSize: 26,
    ...(enemy._enemyDissolvePrecooked
      ? {
          dissolvePrecooked: enemy._enemyDissolvePrecooked,
          retainDissolveMaterials: true,
        }
      : {}),
  });
  enemy.spawnWarp.freeze();
  enemy.mesh.visible = false;
  if (enemy.shipLight) enemy.shipLight.intensity = 0;
  game.enemies.splice(index, 1);
  if (shouldQueueSoloEnemyRespawn(game)) {
    game.enemyRespawnQueue.push({
      timer: getSoloDifficultySetting(game, "enemy", "respawnDelay", 20),
      pos: enemy.spawnPoint.clone(),
      ...(enemy.missionPoolSlot != null
        ? { missionPoolSlot: enemy.missionPoolSlot }
        : {}),
    });
  }
  game.gameManager.setState({
    enemiesRemaining: game.enemies.length,
    enemiesKilled: game.gameManager.getState().enemiesKilled + 1,
  });
  game.missionManager?.reportEvent("enemyDestroyed", {
    weaponType,
    remaining: game.enemies.length,
  });
  if (game.enemies.length === 0) {
    game.missionManager?.reportEvent("waveCleared", { weaponType });
  }
}

function destroyEnemy(game, enemy, index, weaponType = "laser") {
  if (enemy.missionPoolSlot != null) {
    destroyTrainingPoolEnemy(game, enemy, index, weaponType);
    return;
  }
  const deathPos = enemy.mesh.position.clone();
  const deathQuat = enemy.mesh.quaternion.clone();
  const explosion = new Explosion(
    game.scene,
    deathPos,
    enemy.glowColor,
    game.dynamicLights,
    { big: true },
  );
  game.explosions.push(explosion);
  sfxManager.play("ship-explosion", deathPos, 0.6);
  if (game.particles) {
    game.explosionEffect.emitBigExplosion(deathPos);
  }
  spawnDestruction(game.scene, deathPos, deathQuat, enemy.modelIndex);
  tryDropMissilePickup(game, deathPos);
  const respawnPos = enemy.spawnPoint;
  enemy.dispose(game.scene, game);
  game.enemies.splice(index, 1);
  if (shouldQueueSoloEnemyRespawn(game)) {
    game.enemyRespawnQueue.push({
      timer: getSoloDifficultySetting(game, "enemy", "respawnDelay", 20),
      pos: respawnPos,
      ...(enemy.missionPoolSlot != null
        ? { missionPoolSlot: enemy.missionPoolSlot }
        : {}),
    });
  }
  game.gameManager.setState({
    enemiesRemaining: game.enemies.length,
    enemiesKilled: game.gameManager.getState().enemiesKilled + 1,
  });
  game.missionManager?.reportEvent("enemyDestroyed", {
    weaponType,
    remaining: game.enemies.length,
  });
  if (game.enemies.length === 0) {
    game.missionManager?.reportEvent("waveCleared", { weaponType });
  }
}

function applyKineticExplosion(game, position, damage, radius, opts = {}) {
  const hurtPlayer = opts.hurtPlayer === true && !game.isMultiplayer;
  if (hurtPlayer) {
    const playerPos = game.xrManager?.isPresenting
      ? game.xrManager.rig.position
      : game.camera.position;
    const dist = position.distanceTo(playerPos);
    if (dist < radius) {
      const falloff = 1 - (dist / radius) * 0.5;
      const dmg = Math.max(1, Math.floor(damage * falloff));
      game.player.health -= dmg;
      game.player.lastDamageTime = game.clock.elapsedTime;
      game.showDamageIndicator?.(position);
      proceduralAudio.shieldHit?.();
    }
  }

  for (let j = game.enemies.length - 1; j >= 0; j--) {
    const enemy = game.enemies[j];
    const dist = position.distanceTo(enemy.mesh.position);
    let dmg;
    if (enemy.pointInHitbox(position)) {
      dmg = Math.max(1, Math.floor(damage));
    } else {
      if (dist >= radius) continue;
      const falloff = 1 - (dist / radius) * 0.5;
      dmg = Math.max(1, Math.floor(damage * falloff));
    }
    enemy.takeDamage(dmg);
    if (enemy.health <= 0) {
      destroyEnemy(game, enemy, j, "kineticMissile");
    }
  }
  const explosion = new Explosion(
    game.scene,
    position,
    0x4488ff,
    game.dynamicLights,
    { big: true },
  );
  game.explosions.push(explosion);
  if (game.particles) {
    game.explosionEffect.emitBigExplosion(position);
    game.explosionEffect.emitBigExplosion(position);
    game.explosionEffect.emitExplosionParticles(
      position,
      { r: 0.3, g: 0.5, b: 1 },
      120,
    );
  }
  game.dynamicLights?.flash(position, 0x4488ff, {
    intensity: 90,
    distance: 70,
    ttl: 0.25,
    fade: 0.4,
  });
}

export function initProjectileSplatLayer(game) {
  if (game.projectileSplatLayer) return;
  if (
    !game.gameManager.getPerformanceSetting(
      "rendering",
      "projectileSplatLights",
    )
  )
    return;
  const layer = new SplatEdit({
    rgbaBlendMode: SplatEditRgbaBlendMode.ADD_RGBA,
    sdfSmooth: 0.2,
    softEdge: 2.5,
  });
  game.scene.add(layer);
  game.projectileSplatLayer = layer;
}

export function createProjectileSplatLight(game, isPlayerOwned, visual) {
  if (!game.projectileSplatLayer) return null;
  try {
    const c = _colorScratch;
    if (isPlayerOwned) {
      if (visual?.color !== undefined) {
        c.set(visual.color).multiplyScalar(0.08);
      } else {
        c.setRGB(0.04, 0.06, 0.08);
      }
    } else if (visual?.color !== undefined) {
      c.set(visual.color).multiplyScalar(0.08);
    } else {
      c.setRGB(0.07, 0.04, 0.03);
    }
    const color = c.clone();
    const sdf = new SplatEditSdf({
      type: SplatEditSdfType.SPHERE,
      radius: 10,
      color,
      opacity: 0.1,
    });
    game.projectileSplatLayer.add(sdf);
    return sdf;
  } catch {
    return null;
  }
}

function getLocalPlayerLaserVisual(game) {
  if (!game.isMultiplayer) return null;
  const lp = NetworkManager.getLocalPlayer();
  const hex = lp?.accentColor;
  if (!hex) return null;
  try {
    _colorScratch.set(hex);
  } catch {
    return null;
  }
  return { color: _colorScratch.getHex(), intensity: PLAYER_LASER_INTENSITY };
}

export function firePlayerWeapon(game) {
  if (!game.gameManager.isPlaying()) return false;
  if (
    game.isMultiplayer &&
    NetworkManager.getLocalPlayer() &&
    !NetworkManager.getLocalPlayer().alive
  )
    return false;
  if (!game.player.gunL || !game.player.gunR) return false;

  const now = game.clock.elapsedTime;
  if (now - game.lastLaserTime < game.laserCooldown) return false;
  game.lastLaserTime = now;

  const fireQuat = game.xrManager?.isPresenting
    ? game.xrManager.rig.quaternion
    : game.camera.quaternion;
  _fireDir.set(0, 0, -1).applyQuaternion(fireQuat);
  game.player.camera.updateMatrixWorld(true);
  const fromLeft = game.player.fireFromLeft;
  const spawnPos = game.player.getWeaponSpawnPoint();
  game.player.triggerGunRecoil(fromLeft);
  spawnPos.addScaledVector(_fireDir, -5);

  if (game.isMultiplayer) {
    NetworkManager.sendFire("laser", spawnPos, _fireDir);
  }

  const laserVisual = getLocalPlayerLaserVisual(game);
  const splatLight = createProjectileSplatLight(game, true, laserVisual);
  const projectile = new Projectile(
    game.scene,
    spawnPos,
    _fireDir,
    true,
    null,
    laserVisual,
    splatLight,
  );
  game.projectiles.push(projectile);

  sfxManager.play("laser", spawnPos);

  const flashHex = laserVisual?.color ?? 0x00ffff;
  game.dynamicLights?.flash(spawnPos, flashHex, {
    intensity: 10,
    distance: 16,
    ttl: 0.05,
    fade: 0.12,
  });
  return true;
}

export function firePlayerMissile(game) {
  if (!game.gameManager.isPlaying()) return false;
  if (game.player.missiles <= 0) return false;
  if (
    game.isMultiplayer &&
    NetworkManager.getLocalPlayer() &&
    !NetworkManager.getLocalPlayer().alive
  )
    return false;

  const now = game.clock.elapsedTime;
  if (now - game.lastMissileTime < game.missileCooldown) return false;
  game.lastMissileTime = now;

  game.player.missiles--;

  const fireQuat = game.xrManager?.isPresenting
    ? game.xrManager.rig.quaternion
    : game.camera.quaternion;
  _fireDir.set(0, 0, -1).applyQuaternion(fireQuat);
  game.player.camera.updateMatrixWorld(true);
  const spawnPos = game.player.getMissileSpawnPoint();
  spawnPos.addScaledVector(_fireDir, -1);

  const missile = new Missile(game.scene, spawnPos, _fireDir, {
    trailsEffect: game.trailsEffect,
  });
  game.missiles.push(missile);

  proceduralAudio.missileFire();

  if (game.isMultiplayer) {
    NetworkManager.sendFire("missile", spawnPos, _fireDir, {
      variant: "homing",
    });
    game.localMissileQueue.push(missile);
  }

  game.dynamicLights?.flash(spawnPos, 0xffaa33, {
    intensity: 14,
    distance: 20,
    ttl: 0.07,
    fade: 0.16,
  });
  return true;
}

export function firePlayerKineticMissile(game) {
  if (!game.gameManager.isPlaying()) return false;
  if (game.player.missiles <= 0) return false;
  if (
    game.isMultiplayer &&
    NetworkManager.getLocalPlayer() &&
    !NetworkManager.getLocalPlayer().alive
  )
    return false;

  const now = game.clock.elapsedTime;
  if (now - game.lastMissileTime < game.missileCooldown) return false;
  game.lastMissileTime = now;

  game.player.missiles--;

  const fireQuat = game.xrManager?.isPresenting
    ? game.xrManager.rig.quaternion
    : game.camera.quaternion;
  _fireDir.set(0, 0, -1).applyQuaternion(fireQuat);
  game.player.camera.updateMatrixWorld(true);
  const spawnPos = game.player.getMissileSpawnPoint();
  spawnPos.addScaledVector(_fireDir, -1);

  const missile = new KineticMissile(game.scene, spawnPos, _fireDir, {
    trailsEffect: game.trailsEffect,
  });
  game.missiles.push(missile);

  proceduralAudio.missileFire();

  if (game.isMultiplayer) {
    NetworkManager.sendFire("missile", spawnPos, _fireDir, {
      variant: "kinetic",
    });
    game.localMissileQueue.push(missile);
  }

  game.dynamicLights?.flash(spawnPos, 0x4488ff, {
    intensity: 12,
    distance: 18,
    ttl: 0.06,
    fade: 0.14,
  });
  return true;
}

function maybeCharonHeavyMissileIntro(game) {
  if (game.isMultiplayer) return;
  const st = game.gameManager.getState();
  if (st.currentMissionId !== "charon" || st.charonHeavyMissileIntroDone)
    return;
  game.gameManager.setState({ charonHeavyMissileIntroPending: true });
}

export function fireEnemyWeapon(game, position, direction, style = null) {
  const wt = style?.weaponType;
  if (wt === "enemyHomingMissile") {
    fireEnemyHomingMissile(game, position, direction, style);
    return;
  }
  if (wt === "enemyKineticMissile") {
    fireEnemyKineticMissile(game, position, direction, style);
    return;
  }

  const splatLight = createProjectileSplatLight(game, false, style);
  const enemyLaserSpeed =
    style && typeof style.projectileSpeed === "number" ? style.projectileSpeed : null;
  const projectile = new Projectile(
    game.scene,
    position.clone(),
    direction,
    false,
    enemyLaserSpeed,
    style,
    splatLight,
  );
  game.projectiles.push(projectile);
  sfxManager.play("laser", position);
  if (style?.color) {
    game.dynamicLights?.flash(position, style.color, {
      intensity: 8,
      distance: 12,
      ttl: 0.05,
      fade: 0.1,
    });
  }
}

export function fireAllyWeapon(game, position, direction, style = null) {
  const allyStyle = {
    ...(style || {}),
    team: "ally",
  };
  const splatLight = createProjectileSplatLight(game, true, allyStyle);
  const projectile = new Projectile(
    game.scene,
    position.clone(),
    direction,
    true,
    style?.projectileSpeed ?? null,
    allyStyle,
    splatLight,
  );
  game.projectiles.push(projectile);
  sfxManager.play("laser", position);
  game.dynamicLights?.flash(position, allyStyle.color ?? 0x66ccff, {
    intensity: 8,
    distance: 12,
    ttl: 0.05,
    fade: 0.1,
  });
}

function fireEnemyHomingMissile(game, position, direction, style) {
  if (game.isMultiplayer) return;
  maybeCharonHeavyMissileIntro(game);
  const missile = new Missile(game.scene, position.clone(), direction, {
    trailsEffect: game.trailsEffect,
    enemyOwned: true,
  });
  game.missiles.push(missile);
  proceduralAudio.missileFire();
  game.dynamicLights?.flash(position.clone(), 0xff6622, {
    intensity: 12,
    distance: 18,
    ttl: 0.06,
    fade: 0.14,
  });
}

function fireEnemyKineticMissile(game, position, direction, _style) {
  if (game.isMultiplayer) return;
  maybeCharonHeavyMissileIntro(game);
  const missile = new KineticMissile(game.scene, position.clone(), direction, {
    trailsEffect: game.trailsEffect,
    enemyOwned: true,
  });
  game.missiles.push(missile);
  proceduralAudio.missileFire();
  game.dynamicLights?.flash(position.clone(), 0x5599ff, {
    intensity: 10,
    distance: 16,
    ttl: 0.05,
    fade: 0.12,
  });
}

export function checkCollisions(game) {
  const playerPos = game.xrManager?.isPresenting
    ? game.xrManager.rig.position
    : game.camera.position;
  const playerRadiusSq = 0.64;

  for (let i = game.projectiles.length - 1; i >= 0; i--) {
    const proj = game.projectiles[i];

    if (proj.disposed || proj.lifetime <= 0) {
      proj.dispose(game.scene);
      game.projectiles.splice(i, 1);
      continue;
    }

    let hitSomething = false;
    const projPos = proj.mesh.position;
    const projColor = proj.impactColor;

    if (!game.isMultiplayer) {
      if (proj.team !== "enemy") {
        for (let j = game.enemies.length - 1; j >= 0; j--) {
          const enemy = game.enemies[j];
          if (enemy.pointInHitbox(projPos)) {
            const damage =
              proj.damage ??
              getSoloDifficultySetting(game, "player", "laserDamage", 25);
            enemy.takeDamage(damage);

            _hitNormal.subVectors(projPos, enemy.mesh.position).normalize();
            const impact = new LaserImpact(
              game.scene,
              projPos,
              _hitNormal,
              projColor,
              game.dynamicLights,
            );
            game.impacts.push(impact);

            if (game.particles) {
              game.sparksEffect.emitElectricalSparks(
                projPos,
                _hitNormal,
                30,
                projColor,
              );
            }

            hitSomething = true;

            if (enemy.health <= 0) {
              destroyEnemy(game, enemy, j, "laser");
            }
            break;
          }
        }
      } else {
        const distSq = projPos.distanceToSquared(playerPos);
        if (distSq < playerRadiusSq) {
          const damage = getSoloDifficultySetting(game, "enemy", "damage", 10);
          game.player.health -= damage;
          game.player.lastDamageTime = game.clock.elapsedTime;
          game.showDamageIndicator(projPos);
          proceduralAudio.shieldHit();
          if (game.particles) {
            game.sparksEffect.emitShieldHitSparks(
              game.camera,
              projPos,
              projColor,
            );
          }
          hitSomething = true;
        }
      }
    }

    let wallHitDetected = false;
    if (!hitSomething && proj.prevPosition) {
      const wallHit = castSphere(
        proj.prevPosition.x,
        proj.prevPosition.y,
        proj.prevPosition.z,
        projPos.x,
        projPos.y,
        projPos.z,
        0.3,
      );
      let wallToi = Infinity;
      let wallCounts = false;
      if (wallHit) {
        const toi = Number(wallHit.toi) || 0;
        if (proj.isPlayerOwned && toi < 0.01) {
          // skip spawn-point penetration
        } else {
          wallToi = toi;
          wallCounts = true;
          _hitPos.set(
            proj.prevPosition.x + proj.direction.x * toi,
            proj.prevPosition.y + proj.direction.y * toi,
            proj.prevPosition.z + proj.direction.z * toi,
          );
          if (isNaN(_hitPos.x)) _hitPos.copy(proj.prevPosition);
          _hitNormal.set(
            wallHit.normal2.x,
            wallHit.normal2.y,
            wallHit.normal2.z,
          );
          if (_hitNormal.dot(proj.direction) > 0) {
            _hitNormal.negate();
          }
        }
      }

      let coreWins = false;
      if (!game.isMultiplayer && proj.isPlayerOwned) {
        const coreDist = getCharonCoreHitDistanceAlongSegment(
          game,
          proj.prevPosition,
          projPos,
        );
        if (coreDist != null && coreDist < wallToi) {
          coreWins = applyCharonReactorCoreLaserHit(
            game,
            proj.prevPosition,
            projPos,
            coreDist,
            projColor,
          );
        }
      }

      if (coreWins) {
        hitSomething = true;
      } else if (wallCounts) {
        wallHitDetected = true;
        hitSomething = true;
      }
    }

    const spawnOverlap =
      proj.isPlayerOwned &&
      proj.spawnOrigin &&
      projPos.distanceToSquared(proj.spawnOrigin) < 4;
    if (
      !hitSomething &&
      !spawnOverlap &&
      checkSphereCollision(projPos.x, projPos.y, projPos.z, 0.5)
    ) {
      _hitPos.copy(proj.prevPosition);
      _hitNormal.copy(proj.direction).negate();
      wallHitDetected = true;
      hitSomething = true;
    }

    if (wallHitDetected && game.particles) {
      _sparkPos.copy(_hitPos).addScaledVector(_hitNormal, 0.05);
      game.sparksEffect.emitElectricalSparks(
        _sparkPos,
        _hitNormal,
        100,
        projColor,
      );
      game.dynamicLights?.flash(_hitPos, projColor, {
        intensity: 8,
        distance: 12,
        ttl: 0.05,
        fade: 0.1,
      });
    }

    if (hitSomething) {
      proj.dispose(game.scene);
      game.projectiles.splice(i, 1);
    }
  }

  for (let i = game.missiles.length - 1; i >= 0; i--) {
    const missile = game.missiles[i];

    if (missile.disposed) {
      game.missiles.splice(i, 1);
      continue;
    }

    if (missile.isKinetic) {
      const kineticHurtPlayer = missile.enemyOwned
        ? { hurtPlayer: true }
        : {};
      if (missile.lifetime <= 0) {
        applyKineticExplosion(
          game,
          missile.getPosition().clone(),
          missile.damage,
          missile.explosionRadius,
          kineticHurtPlayer,
        );
        missile.dispose(game.scene);
        game.missiles.splice(i, 1);
        continue;
      }

      const missilePos = missile.getPosition();
      let exploded = false;

      if (missile.enemyOwned && !game.isMultiplayer) {
        const pp = game.xrManager?.isPresenting
          ? game.xrManager.rig.position
          : game.camera.position;
        if (missilePos.distanceToSquared(pp) < 9) {
          applyKineticExplosion(
            game,
            missilePos.clone(),
            missile.damage,
            missile.explosionRadius,
            kineticHurtPlayer,
          );
          exploded = true;
        }
      } else {
        for (let j = game.enemies.length - 1; j >= 0; j--) {
          const enemy = game.enemies[j];
          if (enemy.pointInHitbox(missilePos)) {
            applyKineticExplosion(
              game,
              missilePos.clone(),
              missile.damage,
              missile.explosionRadius,
            );
            exploded = true;
            break;
          }
        }
      }

      if (!exploded && missile.prevPosition) {
        const prev = missile.prevPosition;
        const wallHit = castSphere(
          prev.x,
          prev.y,
          prev.z,
          missilePos.x,
          missilePos.y,
          missilePos.z,
          missile.collisionRadius,
        );
        const wallToi =
          wallHit != null
            ? Number(wallHit.timeOfImpact ?? wallHit.toi) ?? Infinity
            : Infinity;

        if (!game.isMultiplayer && !missile.enemyOwned) {
          const coreDist = getCharonCoreHitDistanceAlongSegment(
            game,
            prev,
            missilePos,
            missile.collisionRadius,
          );
          if (coreDist != null && coreDist < wallToi) {
            const segLen = prev.distanceTo(missilePos);
            const t = segLen > 1e-6 ? coreDist / segLen : 0;
            _hitPos.copy(prev).lerp(missilePos, t);
            applyCharonReactorCoreMissileHit(game, _hitPos, missile.damage);
            exploded = true;
          }
        }

        if (!exploded && wallHit) {
          const toi = Number(wallHit.timeOfImpact ?? wallHit.toi) ?? 0;
          _hitPos.set(
            prev.x + missile.direction.x * toi,
            prev.y + missile.direction.y * toi,
            prev.z + missile.direction.z * toi,
          );
          if (isNaN(_hitPos.x)) _hitPos.copy(prev);
          _hitNormal.set(
            wallHit.normal2.x,
            wallHit.normal2.y,
            wallHit.normal2.z,
          );
          if (_hitNormal.dot(missile.direction) > 0) _hitNormal.negate();

          if (missile.bouncesLeft > 0) {
            missile.applyBounce(_hitPos, _hitNormal);
            if (game.particles) {
              _sparkPos.copy(_hitPos).addScaledVector(_hitNormal, 0.05);
              game.sparksEffect.emitElectricalSparks(
                _sparkPos,
                _hitNormal,
                80,
                0x4488ff,
              );
            }
            game.dynamicLights?.flash(_hitPos, 0x4488ff, {
              intensity: 8,
              distance: 12,
              ttl: 0.05,
              fade: 0.1,
            });
          } else {
            applyKineticExplosion(
              game,
              _hitPos.clone(),
              missile.damage,
              missile.explosionRadius,
              kineticHurtPlayer,
            );
            exploded = true;
          }
        }
      }

      if (exploded) {
        missile.dispose(game.scene);
        game.missiles.splice(i, 1);
      }
      continue;
    }

    if (missile.lifetime <= 0) {
      missile.dispose(game.scene);
      game.missiles.splice(i, 1);
      continue;
    }

    let exploded = false;
    let skipHomingExplosionVfx = false;
    const missilePos = missile.getPosition();

    if (missile.enemyOwned && !game.isMultiplayer) {
      const pp = game.xrManager?.isPresenting
        ? game.xrManager.rig.position
        : game.camera.position;
      if (missilePos.distanceToSquared(pp) < 9) {
        game.player.health -= missile.damage;
        game.player.lastDamageTime = game.clock.elapsedTime;
        game.showDamageIndicator?.(missilePos);
        proceduralAudio.shieldHit?.();
        exploded = true;
      }
    } else {
      for (let j = game.enemies.length - 1; j >= 0; j--) {
        const enemy = game.enemies[j];
        if (enemy.pointInHitbox(missilePos)) {
          enemy.takeDamage(missile.damage);
          exploded = true;

          if (enemy.health <= 0) {
            destroyEnemy(game, enemy, j, "homingMissile");
          }
          break;
        }
      }
    }

    if (!exploded && game.isMultiplayer) {
      for (const [, remote] of game.remotePlayers) {
        if (remote.mesh) {
          const distSq = missilePos.distanceToSquared(remote.mesh.position);
          if (distSq < 4) {
            exploded = true;
            break;
          }
        }
      }
      if (!exploded && game.networkBots?.size) {
        for (const [, entry] of game.networkBots) {
          if (!entry?.mesh) continue;
          const distSq = missilePos.distanceToSquared(entry.mesh.position);
          if (distSq < 9) {
            exploded = true;
            break;
          }
        }
      }
    }

    if (!exploded) {
      const prev = missile.prevPosition;
      if (prev) {
        const wallHit = castSphere(
          prev.x,
          prev.y,
          prev.z,
          missilePos.x,
          missilePos.y,
          missilePos.z,
          missile.collisionRadius,
        );
        const wallToi =
          wallHit != null
            ? Number(wallHit.timeOfImpact ?? wallHit.toi) ?? Infinity
            : Infinity;

        if (!game.isMultiplayer && !missile.enemyOwned) {
          const coreDist = getCharonCoreHitDistanceAlongSegment(
            game,
            prev,
            missilePos,
            missile.collisionRadius,
          );
          if (coreDist != null && coreDist < wallToi) {
            const segLen = prev.distanceTo(missilePos);
            const t = segLen > 1e-6 ? coreDist / segLen : 0;
            _hitPos.copy(prev).lerp(missilePos, t);
            applyCharonReactorCoreMissileHit(game, _hitPos, missile.damage);
            exploded = true;
            skipHomingExplosionVfx = true;
          }
        }
        if (!exploded && (wallHit || missile.checkWallCollision())) {
          exploded = true;
        }
      } else if (missile.checkWallCollision()) {
        exploded = true;
      }
    }

    if (exploded) {
      if (!skipHomingExplosionVfx) {
        const explosion = new Explosion(
          game.scene,
          missilePos,
          0xff4400,
          game.dynamicLights,
        );
        game.explosions.push(explosion);
        if (game.particles) {
          game.explosionEffect.emitExplosionParticles(
            missilePos,
            { r: 1, g: 0.4, b: 0.1 },
            30,
          );
        }
      }
      missile.dispose(game.scene);
      game.missiles.splice(i, 1);
    }
  }
}
