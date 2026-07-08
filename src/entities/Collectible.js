/**
 * Collectible.js - PICKUP OBJECTS (MISSILE REFILL, LASER UPGRADE)
 * =============================================================================
 *
 * ROLE: Scene objects for collectibles: missile refill and laser upgrade.
 * Bobbing/floating visuals; pickup effect and disposal. Used in solo (missile
 * pickups) and multiplayer (network-spawned collectibles).
 *
 * KEY RESPONSIBILITIES:
 * - constructor(scene, data, lightPool): create group, createMissilePickup or createLaserUpgrade
 * - update(delta): optional bobbing; playPickupEffect(), dispose()
 * - gameNetworkProjectiles spawn/remove and handle pickup; DynamicLightPool for glow
 *
 * RELATED: gameEnemies.js, gameNetworkProjectiles.js, DynamicLightPool.
 *
 * =============================================================================
 */

import * as THREE from "three";
import {
  cloneMissileModel,
  preloadMissileModel,
} from "../cache/missileModelCache.js";
import {
  cloneGatlingGunModel,
  preloadGatlingGunModel,
} from "../cache/gatlingGunModelCache.js";

const MISSILE_COLOR = 0xff6600;
const LASER_UPGRADE_COLOR = 0x00ff44;
const CHARGING_LASER_COLOR = 0xff4a12;
const GATLING_COLOR = 0xffcc33;
const PICKUP_MISSILE_LENGTH = 1.8;
const GLOW_MIN_SCALE = 0.001;
const GATLING_RING_SCALE = 3;
const GATLING_GLOW_SCALE = 3.1;

export class Collectible {
  constructor(scene, data, lightPool = null) {
    this.scene = scene;
    this.id = data.id;
    this.type = data.type;
    this.lightPool = lightPool;
    this.disposed = false;

    this.group = new THREE.Group();
    this.group.position.set(data.x, data.y, data.z);
    this.baseY = data.y;

    if (this.type === "missile") {
      this.createMissilePickup();
    } else if (this.type === "laser_upgrade") {
      this.createLaserUpgrade();
    } else if (this.type === "charging_laser") {
      this.createWeaponPickup(CHARGING_LASER_COLOR, true);
    } else if (this.type === "gatling") {
      this.createGatlingPickup();
    }

    scene.add(this.group);
  }

  createMissilePickup() {
    this.body = cloneMissileModel(PICKUP_MISSILE_LENGTH);
    if (this.body) {
      this.group.add(this.body);
    } else {
      preloadMissileModel().then(() => {
        if (this.disposed) return;
        const m = cloneMissileModel(PICKUP_MISSILE_LENGTH);
        if (m) {
          this.body = m;
          this.group.add(m);
        }
      });
    }

    const glowGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: MISSILE_COLOR,
      transparent: true,
      opacity: 0.35,
      side: THREE.BackSide,
    });
    this.glow = new THREE.Mesh(glowGeo, glowMat);
    this.glowBaseScale = 1;
    this.glow.scale.setScalar(GLOW_MIN_SCALE);
    this.group.add(this.glow);

    this.floatOffset = Math.random() * Math.PI * 2;
  }

  createLaserUpgrade() {
    // Bright green cylinder
    const cylGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.5, 12);
    const cylMat = new THREE.MeshStandardMaterial({
      color: LASER_UPGRADE_COLOR,
      emissive: LASER_UPGRADE_COLOR,
      emissiveIntensity: 1.2,
      metalness: 0.4,
      roughness: 0.2,
    });

    this.body = new THREE.Mesh(cylGeo, cylMat);
    this.group.add(this.body);

    // Inner core glow
    const coreGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.6, 8);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });
    this.core = new THREE.Mesh(coreGeo, coreMat);
    this.group.add(this.core);

    // Outer glow
    const glowGeo = new THREE.SphereGeometry(1.0, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: LASER_UPGRADE_COLOR,
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide,
    });
    this.glow = new THREE.Mesh(glowGeo, glowMat);
    this.glowBaseScale = 1;
    this.glow.scale.setScalar(GLOW_MIN_SCALE);
    this.group.add(this.glow);

    this.floatOffset = Math.random() * Math.PI * 2;
  }

  createWeaponPickup(color, charging) {
    const coreGeo = charging
      ? new THREE.OctahedronGeometry(0.65, 1)
      : new THREE.CylinderGeometry(0.32, 0.32, 1.35, 10);
    const coreMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.6,
      metalness: 0.35,
      roughness: 0.22,
    });
    this.body = new THREE.Mesh(coreGeo, coreMat);
    if (!charging) this.body.rotation.z = Math.PI / 2;
    this.group.add(this.body);

    const ringGeo = new THREE.TorusGeometry(0.85, 0.045, 6, 28);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      toneMapped: false,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.renderOrder = 95;
    this.group.add(this.ring);

    const glowGeo = new THREE.SphereGeometry(1.15, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.24,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      toneMapped: false,
    });
    this.glow = new THREE.Mesh(glowGeo, glowMat);
    this.glow.renderOrder = 94;
    this.glowBaseScale = 1.1;
    this.glow.scale.setScalar(GLOW_MIN_SCALE);
    this.group.add(this.glow);

    this.floatOffset = Math.random() * Math.PI * 2;
  }

  createGatlingPickup() {
    this.createWeaponPickup(GATLING_COLOR, false);
    this.ring?.scale.setScalar(GATLING_RING_SCALE);
    this.glowBaseScale = GATLING_GLOW_SCALE;
    const applyModel = (model) => {
      if (this.disposed || !model) return;
      if (this.body) {
        this.group.remove(this.body);
        this.body.traverse((child) => {
          child.geometry?.dispose?.();
          if (Array.isArray(child.material)) {
            child.material.forEach((material) => material?.dispose?.());
          } else {
            child.material?.dispose?.();
          }
        });
      }
      this.body = model;
      this.body.rotation.set(0, 0, 0);
      this.group.add(this.body);
    };
    const readyModel = cloneGatlingGunModel();
    if (readyModel) {
      applyModel(readyModel);
    } else {
      preloadGatlingGunModel()
        .then(() => applyModel(cloneGatlingGunModel()))
        .catch(() => {});
    }
  }

  update(delta, serverRotY = null) {
    if (this.disposed) return;

    // Rotate
    if (serverRotY !== null) {
      this.group.rotation.y = serverRotY;
    } else {
      this.group.rotation.y += delta * 2;
    }

    const time = performance.now() * 0.001 + this.floatOffset;
    this.group.position.y = this.baseY + Math.sin(time * 2) * 0.3;

    if (this.glow) {
      const t = 0.5 + 0.5 * Math.sin(time * 3);
      const base = this.glowBaseScale ?? 1;
      const s = GLOW_MIN_SCALE + (base - GLOW_MIN_SCALE) * t;
      this.glow.scale.setScalar(s);
    }
    if (this.ring) {
      this.ring.rotation.x += delta * 1.7;
      this.ring.rotation.z -= delta * 1.2;
    }
  }

  updateFromServer(data) {
    this.group.position.set(data.x, data.y, data.z);
    this.group.rotation.y = data.rotY;
  }

  playPickupEffect() {
    if (this.lightPool) {
      const color =
        this.type === "missile"
          ? MISSILE_COLOR
          : this.type === "charging_laser"
            ? CHARGING_LASER_COLOR
            : this.type === "gatling"
              ? GATLING_COLOR
              : LASER_UPGRADE_COLOR;
      this.lightPool.flash(this.group.position, color, {
        intensity: 30,
        distance: 20,
        ttl: 0.15,
        fade: 0.3,
      });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.());
      } else if (child.material) {
        child.material.dispose();
      }
    });

    this.scene.remove(this.group);
  }
}
