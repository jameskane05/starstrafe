/**
 * Projectile.js - LASER BOLT PROJECTILE
 * =============================================================================
 *
 * ROLE: Straight-flying laser bolt (player or enemy). Cylinder mesh, optional
 * splat light; lifetime and collision; damage applied in gameCombat on hit.
 *
 * KEY RESPONSIBILITIES:
 * - update(delta): move along direction; decrement lifetime; dispose when expired
 * - isPlayerOwned, speed, visual config; collision handled by gameCombat (sphere cast)
 * - Player vs enemy geometry/material and color; no homing
 *
 * RELATED: gameCombat.js, Physics.js, Explosion.js, LaserImpact.js.
 *
 * =============================================================================
 */

import * as THREE from "three";

const playerGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6);
playerGeometry.rotateX(Math.PI / 2);

const enemyGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6);
enemyGeometry.rotateX(Math.PI / 2);

export const PLAYER_LASER_COLOR = 0x00ffff;
export const PLAYER_LASER_INTENSITY = 6.0;
const playerLaserColor = PLAYER_LASER_COLOR;
const playerLaserIntensity = PLAYER_LASER_INTENSITY;
/** Same HDR scale as player bolt so UnrealBloomPass threshold (~0.8) treats bot lasers like yours. */
const playerLaserEnergy = 1.4 + playerLaserIntensity * 0.35;
/** Visual for network-synced lasers from other human players (same bloom as local). */
export const PLAYER_LASER_VISUAL = Object.freeze({
  color: PLAYER_LASER_COLOR,
  intensity: PLAYER_LASER_INTENSITY,
});
const playerMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(playerLaserColor).multiplyScalar(playerLaserEnergy),
  transparent: true,
  opacity: 1.0,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});

const enemyMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0xff8800).multiplyScalar(playerLaserEnergy),
  transparent: true,
  opacity: 1.0,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});

const _forward = new THREE.Vector3(0, 0, 1);
const _tempVec = new THREE.Vector3();

export class Projectile {
  constructor(
    scene,
    position,
    direction,
    isPlayerOwned,
    speed = null,
    visual = null,
    splatLight = null,
  ) {
    this.scene = scene;
    this.direction = direction.clone();
    if (this.direction.lengthSq() > 0.0001) {
      this.direction.normalize();
    } else {
      this.direction.set(0, 0, -1);
    }
    this.speed = speed !== null ? speed : isPlayerOwned ? 240 : 18;
    this.isPlayerOwned = isPlayerOwned;
    this.team = visual?.team || (isPlayerOwned ? "player" : "enemy");
    this.damage = visual?.damage;
    this.lifetime =
      typeof visual?.projectileLifetime === "number" && visual.projectileLifetime > 0
        ? visual.projectileLifetime
        : 3;
    this.disposed = false;
    this.spawnOrigin = position.clone();
    this.prevPosition = position.clone();
    this.splatLight = splatLight;

    const geometry = isPlayerOwned ? playerGeometry : enemyGeometry;
    let material = isPlayerOwned ? playerMaterial : enemyMaterial;
    if (isPlayerOwned && visual != null && visual.color !== undefined) {
      material = playerMaterial.clone();
      const boost = Math.max(
        0,
        Math.min(10, visual.intensity ?? PLAYER_LASER_INTENSITY),
      );
      const computedEnergy = Math.max(1.4 + boost * 0.35, playerLaserEnergy);
      const energy =
        typeof visual.energy === "number" && visual.energy > 0
          ? visual.energy
          : computedEnergy;
      material.color = new THREE.Color(visual.color).multiplyScalar(energy);
      material.opacity = Math.min(1, 0.82 + boost * 0.02);
      material.toneMapped = false;
    } else if (!isPlayerOwned && visual != null && visual.color !== undefined) {
      material = enemyMaterial.clone();
      const boost = Math.max(0, Math.min(10, visual.intensity ?? 1));
      const energy = Math.max(1.4 + boost * 0.35, playerLaserEnergy);
      material.color = new THREE.Color(visual.color).multiplyScalar(energy);
      material.opacity = Math.min(1, 0.82 + boost * 0.02);
      material.toneMapped = false;
    }

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.quaternion.setFromUnitVectors(_forward, this.direction);
    scene.add(this.mesh);

    this.impactColor = isPlayerOwned
      ? visual?.color != null
        ? visual.color
        : PLAYER_LASER_COLOR
      : visual?.color != null
        ? visual.color
        : 0xff8800;

    if (this.splatLight) {
      this.splatLight.position.copy(position);
    }
  }

  update(delta) {
    this.lifetime -= delta;
    this.prevPosition.copy(this.mesh.position);
    _tempVec.copy(this.direction).multiplyScalar(this.speed * delta);
    this.mesh.position.add(_tempVec);
    if (this.splatLight) {
      this.splatLight.position.copy(this.mesh.position);
      this.splatLight.updateMatrixWorld(false);
    }
  }

  dispose(scene) {
    if (this.disposed) return;
    this.disposed = true;
    if (this.splatLight && this.splatLight.parent) {
      this.splatLight.parent.remove(this.splatLight);
    }
    scene.remove(this.mesh);
  }
}
