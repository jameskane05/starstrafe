import * as THREE from 'three';

const DEBRIS_COUNT = 16;
const EXPLOSION_DURATION = 1.2;
const BIG_DEBRIS_COUNT = 32;
const BIG_EXPLOSION_DURATION = 2.0;

const sharedGeometries = {
  tetra: new THREE.TetrahedronGeometry(1),
  octa: new THREE.OctahedronGeometry(1),
  box: new THREE.BoxGeometry(1, 0.5, 0.3),
  flash: new THREE.SphereGeometry(0.3, 8, 8),
  glow: new THREE.SphereGeometry(0.6, 8, 8),
};

export class Explosion {
  constructor(scene, position, color = 0xff6600, lightPool = null, options = {}) {
    this.scene = scene;
    this.elapsed = 0;
    this.isBig = options.big || false;
    this.duration = this.isBig ? BIG_EXPLOSION_DURATION : EXPLOSION_DURATION;
    this.disposed = false;

    if (lightPool) {
      lightPool.flash(position, color, {
        intensity: this.isBig ? 50 : 22,
        distance: this.isBig ? 50 : 26,
        ttl: this.isBig ? 0.2 : 0.12,
        fade: this.isBig ? 0.4 : 0.22,
      });
    }
    
    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);
    
    this.debris = [];
    this.createDebris(color);
    this.createFlash(color);
  }

  createDebris(baseColor) {
    const colors = [
      baseColor,
      0xffaa00,
      0xff3300,
      0xffffff,
    ];
    const geoTypes = [sharedGeometries.tetra, sharedGeometries.octa, sharedGeometries.box];
    const debrisCount = this.isBig ? BIG_DEBRIS_COUNT : DEBRIS_COUNT;
    const sizeMultiplier = this.isBig ? 2.5 : 1;
    const speedMultiplier = this.isBig ? 2.0 : 1;

    for (let i = 0; i < debrisCount; i++) {
      const size = (0.1 + Math.random() * 0.25) * sizeMultiplier;
      const geo = geoTypes[Math.floor(Math.random() * 3)];

      const color = colors[Math.floor(Math.random() * colors.length)];
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(size);
      
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar((5 + Math.random() * 8) * speedMultiplier);

      const rotationSpeed = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      );

      this.debris.push({
        mesh,
        velocity,
        rotationSpeed,
        drag: 0.96 + Math.random() * 0.03,
      });

      this.group.add(mesh);
    }
  }

  createFlash(color) {
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
    });
    this.flash = new THREE.Mesh(sharedGeometries.flash, flashMat);
    if (this.isBig) {
      this.flash.scale.setScalar(3);
    }
    this.group.add(this.flash);

    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: this.isBig ? 0.4 : 0.25,
    });
    this.glow = new THREE.Mesh(sharedGeometries.glow, glowMat);
    if (this.isBig) {
      this.glow.scale.setScalar(3);
    }
    this.group.add(this.glow);
  }

  update(delta) {
    if (this.disposed) return false;

    this.elapsed += delta;
    const t = this.elapsed / this.duration;

    if (t >= 1) {
      this.dispose();
      return false;
    }

    for (const d of this.debris) {
      d.mesh.position.addScaledVector(d.velocity, delta);
      d.velocity.multiplyScalar(d.drag);
      
      d.mesh.rotation.x += d.rotationSpeed.x * delta;
      d.mesh.rotation.y += d.rotationSpeed.y * delta;
      d.mesh.rotation.z += d.rotationSpeed.z * delta;

      const fadeStart = 0.3;
      if (t > fadeStart) {
        d.mesh.material.opacity = 1 - (t - fadeStart) / (1 - fadeStart);
      }
    }

    const flashT = Math.min(t * 5, 1);
    const baseFlashScale = this.isBig ? 3 : 1;
    const flashExpand = this.isBig ? 6 : 2;
    this.flash.scale.setScalar(baseFlashScale + flashT * flashExpand);
    this.flash.material.opacity = 1 - flashT;

    const glowT = Math.min(t * 3, 1);
    const baseGlowScale = this.isBig ? 3 : 1;
    const glowExpand = this.isBig ? 8 : 2;
    this.glow.scale.setScalar(baseGlowScale + glowT * glowExpand);
    this.glow.material.opacity = (this.isBig ? 0.4 : 0.25) * (1 - glowT);
    
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    for (const d of this.debris) {
      d.mesh.material.dispose();
    }

    this.flash.material.dispose();
    this.glow.material.dispose();

    this.scene.remove(this.group);
  }
}

