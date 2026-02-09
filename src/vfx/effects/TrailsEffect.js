import * as THREE from "three";

const _exhaust = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();

/**
 * Trail effects - missile exhaust, engine trails, etc.
 * Uses ParticleSystem pools to emit particles.
 */
export class TrailsEffect {
  constructor(particleSystem) {
    this.particles = particleSystem;
  }

  emitMissileExhaust(worldPos, worldQuat, dir) {
    _exhaust.set(0, 0, -0.35).applyQuaternion(worldQuat).add(worldPos);
    _tmp.copy(dir).negate();

    // Afterburner fire puffs – billboard quads
    _tmp2.copy(_tmp).multiplyScalar(0.8 + Math.random() * 1.4);
    _tmp2.x += (Math.random() - 0.5) * 0.8;
    _tmp2.y += (Math.random() - 0.5) * 0.8;
    _tmp2.z += (Math.random() - 0.5) * 0.8;

    const hot = Math.random() > 0.5;
    this.particles.fire.emit({
      x: _exhaust.x + (Math.random() - 0.5) * 0.12,
      y: _exhaust.y + (Math.random() - 0.5) * 0.12,
      z: _exhaust.z + (Math.random() - 0.5) * 0.12,
      vx: _tmp2.x, vy: _tmp2.y, vz: _tmp2.z,
      r: 1.0, g: hot ? 0.55 : 0.75, b: hot ? 0.08 : 0.2,
      alpha: 0.8,
      size: 0.3 + Math.random() * 0.2,
      life: 0.12 + Math.random() * 0.08,
      drag: 0.92, rise: 0,
    });

    // Hot sparks
    for (let i = 0; i < 2; i++) {
      const s = 0.5 + Math.random() * 0.8;
      _tmp2.copy(_tmp).multiplyScalar(3 + Math.random() * 5);
      _tmp2.x += (Math.random() - 0.5) * 2.2;
      _tmp2.y += (Math.random() - 0.5) * 2.2;
      _tmp2.z += (Math.random() - 0.5) * 2.2;

      const warm = Math.random() > 0.35;
      this.particles.sparks.emit({
        x: _exhaust.x + (Math.random() - 0.5) * 0.12,
        y: _exhaust.y + (Math.random() - 0.5) * 0.12,
        z: _exhaust.z + (Math.random() - 0.5) * 0.12,
        vx: _tmp2.x, vy: _tmp2.y, vz: _tmp2.z,
        r: warm ? 1.0 : 1.0, g: warm ? 0.67 : 1.0, b: warm ? 0.15 : 1.0,
        alpha: 0.9, size: 8 * s,
        life: 0.18 + Math.random() * 0.12, drag: 0.93, rise: 0,
      });
    }

    // Smoke trail – billboard quad
    if (Math.random() > 0.25) {
      _tmp2.copy(_tmp).multiplyScalar(1 + Math.random() * 2);
      _tmp2.x += (Math.random() - 0.5) * 0.6;
      _tmp2.y += (Math.random() - 0.5) * 0.6;
      _tmp2.z += (Math.random() - 0.5) * 0.6;

      const grey = 0.4 + Math.random() * 0.2;
      this.particles.smoke.emit({
        x: _exhaust.x + (Math.random() - 0.5) * 0.2,
        y: _exhaust.y + (Math.random() - 0.5) * 0.2,
        z: _exhaust.z + (Math.random() - 0.5) * 0.2,
        vx: _tmp2.x, vy: _tmp2.y, vz: _tmp2.z,
        r: grey, g: grey, b: grey,
        alpha: 0.5,
        size: 0.4 + Math.random() * 0.3,
        sizeGrow: 2.0,
        life: 0.9 + Math.random() * 0.6, drag: 0.92, rise: 0,
      });
    }
  }
}
