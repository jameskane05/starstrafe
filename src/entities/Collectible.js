import * as THREE from "three";

const MISSILE_COLOR = 0xff6600;
const LASER_UPGRADE_COLOR = 0x00ff44;

export class Collectible {
  constructor(scene, data, lightPool = null) {
    this.scene = scene;
    this.id = data.id;
    this.type = data.type;
    this.lightPool = lightPool;
    this.disposed = false;
    
    this.group = new THREE.Group();
    this.group.position.set(data.x, data.y, data.z);
    
    if (this.type === "missile") {
      this.createMissilePickup();
    } else if (this.type === "laser_upgrade") {
      this.createLaserUpgrade();
    }
    
    scene.add(this.group);
  }

  createMissilePickup() {
    // Oversized missile shape
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.2, 1.8, 8);
    bodyGeo.rotateX(Math.PI / 2);
    
    const bodyMat = new THREE.MeshStandardMaterial({
      color: MISSILE_COLOR,
      emissive: MISSILE_COLOR,
      emissiveIntensity: 0.8,
      metalness: 0.6,
      roughness: 0.3,
    });
    
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(this.body);
    
    // Fins
    const finGeo = new THREE.BoxGeometry(0.6, 0.05, 0.4);
    const finMat = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff4400,
      emissiveIntensity: 0.5,
    });
    
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.position.z = -0.7;
      fin.rotation.z = (Math.PI / 2) * i;
      this.group.add(fin);
    }
    
    // Glowing orb around it
    const glowGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: MISSILE_COLOR,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
    });
    this.glow = new THREE.Mesh(glowGeo, glowMat);
    this.group.add(this.glow);
    
    // Point light
    this.light = new THREE.PointLight(MISSILE_COLOR, 3, 12);
    this.group.add(this.light);
    
    // Floating effect
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
    this.group.add(this.glow);
    
    // Point light
    this.light = new THREE.PointLight(LASER_UPGRADE_COLOR, 4, 15);
    this.group.add(this.light);
    
    // Floating effect
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
    
    // Floating bob effect
    const time = performance.now() * 0.001 + this.floatOffset;
    this.group.position.y = Math.sin(time * 2) * 0.3;
    
    // Pulse the glow
    if (this.glow) {
      const pulse = 0.15 + Math.sin(time * 3) * 0.05;
      this.glow.material.opacity = pulse;
    }
    
    // Pulse the light
    if (this.light) {
      this.light.intensity = 3 + Math.sin(time * 4) * 1;
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
