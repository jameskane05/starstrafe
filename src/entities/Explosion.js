import * as THREE from 'three';

/**
 * Explosion – dynamic light flash + subtle shockwave distortion.
 * All particle effects come from ParticleSystem.emitBigExplosion().
 */

const sharedSphere = new THREE.SphereGeometry(1, 12, 8);

export class Explosion {
  constructor(scene, position, color = 0xff6600, lightPool = null, options = {}) {
    this.scene = scene;
    this.elapsed = 0;
    this.isBig = options.big || false;
    this.duration = this.isBig ? 0.5 : 0.25;
    this.disposed = false;

    // Dynamic light flash
    if (lightPool) {
      lightPool.flash(position, color, {
        intensity: this.isBig ? 80 : 22,
        distance: this.isBig ? 60 : 26,
        ttl: this.isBig ? 0.2 : 0.12,
        fade: this.isBig ? 0.4 : 0.22,
      });
    }

    this.shockwave = null;

    if (this.isBig) {
      this.group = new THREE.Group();
      this.group.position.copy(position);
      scene.add(this.group);

      // Single subtle shockwave sphere (Unity: BackSide mesh, very fast)
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffddaa,
        transparent: true,
        opacity: 0.15,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });
      this.shockwave = new THREE.Mesh(sharedSphere, mat);
      this.shockwave.scale.setScalar(0.5);
      this.group.add(this.shockwave);
    }
  }

  update(delta) {
    if (this.disposed) return false;

    this.elapsed += delta;

    if (this.elapsed >= this.duration) {
      this.dispose();
      return false;
    }

    // Shockwave: fast expand, very quick fade
    if (this.shockwave) {
      const t = Math.min(this.elapsed / 0.12, 1);  // 120ms expand
      const scale = 0.5 + t * 12;
      this.shockwave.scale.setScalar(scale);
      this.shockwave.material.opacity = 0.15 * (1 - t);
    }

    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.shockwave) {
      this.shockwave.material.dispose();
    }

    if (this.group) {
      this.scene.remove(this.group);
    }
  }
}
