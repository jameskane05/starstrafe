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

const MISSILE_COLOR = 0xff6600;
const LASER_UPGRADE_COLOR = 0x00ff44;
const PICKUP_MISSILE_LENGTH = 1.8;
const GLOW_MIN_SCALE = 0.001;

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
  }

  updateFromServer(data) {
    this.group.position.set(data.x, data.y, data.z);
    this.group.rotation.y = data.rotY;
  }

  playPickupEffect() {
    if (this.lightPool) {
      const color = this.type === "missile" ? MISSILE_COLOR : LASER_UPGRADE_COLOR;
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
      if (child.material) child.material.dispose();
    });
    
    this.scene.remove(this.group);
  }
}
