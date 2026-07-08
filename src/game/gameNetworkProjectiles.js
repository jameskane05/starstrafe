/**
 * gameNetworkProjectiles.js - MULTIPLAYER COLLECTIBLES AND PICKUPS
 * =============================================================================
 *
 * ROLE: Spawns and removes network-driven collectibles (missiles, laser upgrade).
 * Handles pickup events from server: play effects, update local player state,
 * show pickup messages. Also used by gameMultiplayer for collectible lifecycle.
 *
 * KEY RESPONSIBILITIES:
 * - spawnCollectible(game, id, data), removeCollectible(game, id)
 * - handleCollectiblePickup(game, data): play effect, update player (missiles/laser)
 * - showPickupMessage(game, text); integrate with particles (sparks) and procedural audio
 *
 * RELATED: Collectible.js, gameMultiplayer.js, NetworkManager.js, ProceduralAudio.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import {
  Projectile,
  PLAYER_LASER_INTENSITY,
  PLAYER_LASER_VISUAL,
} from "../entities/Projectile.js";
import { ChargingLaserBeam } from "../entities/ChargingLaserBeam.js";
import { Missile } from "../entities/Missile.js";
import { KineticMissile } from "../entities/KineticMissile.js";
import { Explosion } from "../entities/Explosion.js";
import { LaserImpact } from "../entities/LaserImpact.js";
import { Collectible } from "../entities/Collectible.js";
import NetworkManager from "../network/NetworkManager.js";

function networkHitImpactColor(data) {
  const raw = data.shooterAccentColor;
  if (raw && String(raw).trim()) {
    const col = new THREE.Color();
    try {
      col.set(raw);
      return col.getHex();
    } catch {
      /* fall through */
    }
  }
  if (data.shooterId?.startsWith?.("bot_")) return 0xff8800;
  return 0x00ffff;
}

function laserVisualForOwnerId(ownerId) {
  const state = NetworkManager.getState();
  const p = state?.players?.get?.(ownerId);
  const hex = p?.accentColor;
  if (!hex) return PLAYER_LASER_VISUAL;
  const col = new THREE.Color();
  try {
    col.set(hex);
  } catch {
    return PLAYER_LASER_VISUAL;
  }
  return { color: col.getHex(), intensity: PLAYER_LASER_INTENSITY };
}
import proceduralAudio from "../audio/ProceduralAudio.js";
import sfxManager from "../audio/sfxManager.js";
import {
  PRIMARY_WEAPONS,
  unlockPrimaryWeapon,
} from "./weaponUnlocks.js";

export function spawnCollectible(game, id, data) {
  if (game.collectibles.has(id)) return;

  const payload = {
    id: id ?? data?.id,
    type: data?.type ?? "missile",
    x: data?.x ?? 0,
    y: data?.y ?? 0,
    z: data?.z ?? 0,
  };
  const collectible = new Collectible(game.scene, payload, game.dynamicLights);
  game.collectibles.set(id, collectible);
}

export function removeCollectible(game, id) {
  const collectible = game.collectibles.get(id);
  if (collectible) {
    collectible.dispose();
    game.collectibles.delete(id);
    console.log(`[Game] Removed collectible: ${id}`);
  }
}

export function handleCollectiblePickup(game, data) {
  const collectible = game.collectibles.get(data.collectibleId);

  if (collectible) {
    collectible.playPickupEffect();

    if (game.particles) {
      const pos = { x: data.x, y: data.y, z: data.z };
      const color =
        data.type === "missile"
          ? { r: 1, g: 0.4, b: 0 }
          : data.type === "charging_laser"
            ? { r: 1, g: 0.25, b: 0.03 }
            : data.type === "gatling"
              ? { r: 1, g: 0.72, b: 0.08 }
          : { r: 0, g: 1, b: 0.3 };
      game.sparksEffect.emitHitSparks(pos, color, 30);
    }
  }

  if (data.playerId === NetworkManager.sessionId && game.player) {
    proceduralAudio.collectPickup();
    if (data.type === "laser_upgrade") {
      game.player.hasLaserUpgrade = true;
      showPickupMessage(game, "LASER UPGRADE ACQUIRED");
    } else if (data.type === "charging_laser") {
      unlockPrimaryWeapon(PRIMARY_WEAPONS.CHARGING_LASER);
      game.player.primaryWeaponUnlocks = {
        ...(game.player.primaryWeaponUnlocks || {}),
        [PRIMARY_WEAPONS.CHARGING_LASER]: true,
      };
      NetworkManager.sendWeaponUnlocks?.(game.player.primaryWeaponUnlocks);
      game.setPrimaryWeapon?.(PRIMARY_WEAPONS.CHARGING_LASER);
      showPickupMessage(game, "CHARGING CANNON ACQUIRED");
    } else if (data.type === "gatling") {
      unlockPrimaryWeapon(PRIMARY_WEAPONS.GATLING);
      game.player.primaryWeaponUnlocks = {
        ...(game.player.primaryWeaponUnlocks || {}),
        [PRIMARY_WEAPONS.GATLING]: true,
      };
      NetworkManager.sendWeaponUnlocks?.(game.player.primaryWeaponUnlocks);
      game.setPrimaryWeapon?.(PRIMARY_WEAPONS.GATLING);
      showPickupMessage(game, "GATLING ACQUIRED");
    } else if (data.type === "missile") {
      showPickupMessage(game, "MISSILES REFILLED");
    }
  }
}

export function showPickupMessage(game, text) {
  const existing = document.querySelector(
    ".pickup-message:not(.pickup-message--persistent)",
  );
  if (existing) existing.remove();

  const msg = document.createElement("div");
  msg.className = "pickup-message";
  msg.textContent = text;
  document.body.appendChild(msg);

  setTimeout(() => msg.classList.add("visible"), 10);
  setTimeout(() => {
    msg.classList.remove("visible");
    setTimeout(() => msg.remove(), 300);
  }, 2000);
}

export function spawnNetworkProjectile(game, id, data) {
  console.log(
    "[Game] Spawning network projectile:",
    id,
    "type:",
    data.type,
    "pos:",
    data.x,
    data.y,
    data.z,
    "dir:",
    data.dx,
    data.dy,
    data.dz,
    "speed:",
    data.speed,
  );
  let position = new THREE.Vector3(data.x, data.y, data.z);
  const direction = new THREE.Vector3(data.dx, data.dy, data.dz);

  if (data.type === "chargingLaser") {
    const beam = new ChargingLaserBeam(game.scene);
    beam.fire(position, direction.normalize(), data.length ?? 220);
    beam.duration = 1;
    game.networkProjectiles.set(id, { type: "chargingLaser", obj: beam });
    game.dynamicLights?.flash(position, 0xff7a18, {
      intensity: 70,
      distance: 55,
      ttl: 0.18,
      fade: 0.3,
    });
    sfxManager.play("laser", position, 1.0);
  } else if (data.type === "missile") {
    const remote = game.remotePlayers.get(data.ownerId);
    const missilePos = remote?.getMissileSpawnPoint?.();
    if (missilePos) position.copy(missilePos).addScaledVector(direction, -1);

    const missile =
      data.variant === "kinetic"
        ? new KineticMissile(game.scene, position, direction, {
            trailsEffect: game.trailsEffect,
          })
        : new Missile(game.scene, position, direction, {
            trailsEffect: game.trailsEffect,
          });
    const targetPosition = new THREE.Vector3(data.x, data.y, data.z);
    const targetDirection = direction.clone().normalize();
    game.networkProjectiles.set(id, {
      type: "missile",
      variant: data.variant === "kinetic" ? "kinetic" : "homing",
      obj: missile,
      targetPosition,
      targetDirection,
    });

    game.dynamicLights?.flash(
      position,
      data.variant === "kinetic" ? 0x4488ff : 0xffaa33,
      {
        intensity: 14,
        distance: 20,
        ttl: 0.07,
        fade: 0.16,
      },
    );
    proceduralAudio.missileFire();
  } else {
    const isPlayerOwned = data.ownerId === NetworkManager.sessionId;
    const isBotOwner =
      typeof data.ownerId === "string" && data.ownerId.startsWith("bot_");
    /** Other humans' bolts use enemy collision path + per-player accent. */
    const remoteHumanVisual =
      data.type === "gatling"
        ? {
            color: 0xffaa33,
            intensity: 3.4,
            energy: 3.1,
            damage: 6,
            projectileLifetime: 0.75,
          }
        : !isPlayerOwned && !isBotOwner
          ? laserVisualForOwnerId(data.ownerId)
          : null;

    const remote = game.remotePlayers.get(data.ownerId);
    const gunPos = remote?.getWeaponSpawnPoint?.();
    if (gunPos) {
      position.copy(gunPos).addScaledVector(direction, -1);
    }

    const splatLight = game._createProjectileSplatLight?.(
      isPlayerOwned,
      remoteHumanVisual,
    );
    const projectile = new Projectile(
      game.scene,
      position,
      direction,
      isPlayerOwned,
      data.speed,
      remoteHumanVisual,
      splatLight,
    );
    game.networkProjectiles.set(id, { type: "projectile", obj: projectile });

    if (remote?.triggerGunRecoil) remote.triggerGunRecoil();

    const flashColor =
      data.type === "gatling"
        ? 0xffaa33
        : isBotOwner
          ? 0xff8800
          : (remoteHumanVisual?.color ?? 0x00ffff);
    game.dynamicLights?.flash(position, flashColor, {
      intensity: 10,
      distance: 16,
      ttl: 0.05,
      fade: 0.12,
    });
    sfxManager.play("laser", position);
  }
}

export function removeNetworkProjectile(game, id) {
  const data = game.networkProjectiles.get(id);
  if (data) {
    if (data.type === "missile") {
      data.obj.dispose(game.scene);
    } else {
      data.obj.dispose(game.scene);
    }
    game.networkProjectiles.delete(id);
  }
}

export function updateNetworkProjectile(game, id, projectile) {
  const data = game.networkProjectiles.get(id);
  if (!data) return;

  if (data.type === "missile" && data.targetPosition && data.targetDirection) {
    data.targetPosition.set(projectile.x, projectile.y, projectile.z);
    data.targetDirection
      .set(projectile.dx, projectile.dy, projectile.dz)
      .normalize();
  } else if (data.type === "chargingLaser") {
    return;
  } else if (data.type === "missile") {
    data.obj.group.position.set(projectile.x, projectile.y, projectile.z);
    data.obj.direction
      .set(projectile.dx, projectile.dy, projectile.dz)
      .normalize();
    const forward = new THREE.Vector3(0, 0, 1);
    data.obj.group.quaternion.setFromUnitVectors(forward, data.obj.direction);
  } else {
    data.obj.mesh.position.set(projectile.x, projectile.y, projectile.z);
    data.obj.direction
      .set(projectile.dx, projectile.dy, projectile.dz)
      .normalize();
  }
}

export function handleNetworkHit(game, data) {
  console.log("[Game] Network hit received:", data);
  const hitPos = new THREE.Vector3(data.x, data.y, data.z);
  const hitNormal =
    data.nx !== undefined && data.ny !== undefined && data.nz !== undefined
      ? new THREE.Vector3(data.nx, data.ny, data.nz)
      : new THREE.Vector3(0, 1, 0);

  const isOurShot = data.shooterId === NetworkManager.sessionId;
  const chargingHit = data.weapon === "chargingLaser";
  const hitColor = chargingHit ? 0xff5a12 : networkHitImpactColor(data);

  const impact = new LaserImpact(
    game.scene,
    hitPos,
    hitNormal,
    hitColor,
    game.dynamicLights,
  );
  if (chargingHit) impact.mesh.scale.setScalar(2.2);
  game.impacts.push(impact);

  if (game.particles) {
    game.sparksEffect.emitElectricalSparks(
      hitPos,
      hitNormal,
      chargingHit ? 190 : 100,
      hitColor,
    );
    if (chargingHit) {
      game.explosionEffect.emitExplosionParticles(
        hitPos,
        { r: 1, g: 0.34, b: 0.04 },
        95,
        1.4,
      );
    }
  }

  if (isOurShot) {
    for (let i = game.projectiles.length - 1; i >= 0; i--) {
      const proj = game.projectiles[i];
      if (
        proj.isPlayerOwned &&
        proj.mesh.position.distanceToSquared(hitPos) < 25
      ) {
        proj.dispose(game.scene);
        game.projectiles.splice(i, 1);
        break;
      }
    }

    for (let i = game.missiles.length - 1; i >= 0; i--) {
      const missile = game.missiles[i];
      if (missile.getPosition().distanceToSquared(hitPos) < 36) {
        const explosion = new Explosion(
          game.scene,
          missile.getPosition(),
          0xff4400,
          game.dynamicLights,
        );
        game.explosions.push(explosion);
        missile.dispose(game.scene);
        game.missiles.splice(i, 1);
        break;
      }
    }
  }

  if (data.targetId !== NetworkManager.sessionId) {
    const remote = game.remotePlayers.get(data.targetId);
    if (remote) {
      remote.takeDamage(data.damage);
    }
  } else {
    if (!game.player) {
      console.warn("[Game] Ignoring local hit before player spawn");
      return;
    }
    game.player.health -= data.damage;
    game.player.lastDamageTime = game.clock.elapsedTime;
    game.showDamageIndicator(hitPos);
    proceduralAudio.shieldHit();
    if (game.particles) {
      game.sparksEffect.emitShieldHitSparks(game.camera, hitPos, hitColor);
    }
  }
}
