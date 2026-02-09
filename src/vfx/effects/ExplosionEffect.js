import * as THREE from "three";

// ── Emission shape helpers ──
const _dir = new THREE.Vector3();

function emitSphere(center, radius) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  _dir.set(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi)
  );
  return {
    x: center.x + _dir.x * radius,
    y: center.y + _dir.y * radius,
    z: center.z + _dir.z * radius,
    dx: _dir.x,
    dy: _dir.y,
    dz: _dir.z,
  };
}

function emitHemisphere(center, radius) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(Math.random());
  _dir.set(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  );
  return {
    x: center.x + _dir.x * radius,
    y: center.y + _dir.y * radius,
    z: center.z + _dir.z * radius,
    dx: _dir.x,
    dy: _dir.y,
    dz: _dir.z,
  };
}

/**
 * Explosion effect - matches Unity BigExplosionEffect prefab.
 * Uses ParticleSystem pools to emit particles.
 */
export class ExplosionEffect {
  constructor(particleSystem) {
    this.particles = particleSystem;
  }

  /**
   * Big explosion – matched to Unity BigExplosionEffect prefab.
   * Billboard quads for fire & smoke (no size cap).
   * Proper emission shapes from Unity metadata.
   */
  emitBigExplosion(position) {
    console.log('[VFX] emitBigExplosion at', position.x?.toFixed(1), position.y?.toFixed(1), position.z?.toFixed(1));
    
    // ── Fire (Shape: Sphere r=1.52, 60 burst, startSpeed=0, size=0.75-2, lifetime=0.5-1s) ──
    // Unity: Velocity over Lifetime Linear X 4 Y 10 Z 4 (constant velocity in world space)
    for (let i = 0; i < 60; i++) {
      const e = emitSphere(position, 1.52);
      const drift = 0.3;
      const vx = e.dx * 0.5 + (Math.random() - 0.5) * drift;
      const vy = e.dy * 0.5 + (Math.random() - 0.5) * drift;
      const vz = e.dz * 0.5 + (Math.random() - 0.5) * drift;

      this.particles.fire.emit({
        x: e.x, y: e.y, z: e.z,
        vx, vy, vz,
        r: 1.0, g: 0.8 + Math.random() * 0.2, b: 0.3 + Math.random() * 0.4,
        alpha: 1.0,
        size: 0.75 + Math.random() * 1.25,
        sizeGrow: 3.0,
        life: 0.5 + Math.random() * 0.5,
        drag: 0.98, rise: 0,
        velocityOverLifetimeX: 4,
        velocityOverLifetimeY: 10,
        velocityOverLifetimeZ: 4,
        noise: 2.0,
        noiseFreq: 0.2,
      });
    }

    // ── Embers (Shape: Cone r=0.5 angle=32, 200 burst, startSpeed=0, size=0-0.075) ──
    for (let i = 0; i < 200; i++) {
      const e = emitSphere(position, 0.5);
      const baseSpeed = 5;
      const drift = 1.0;
      const vx = e.dx * baseSpeed + (Math.random() - 0.5) * drift;
      const vy = e.dy * baseSpeed + (Math.random() - 0.5) * drift;
      const vz = e.dz * baseSpeed + (Math.random() - 0.5) * drift;

      this.particles.sparks.emit({
        x: e.x, y: e.y, z: e.z,
        vx, vy, vz,
        r: 1.0, g: 0.5 + Math.random() * 0.4, b: 0.05 + Math.random() * 0.1,
        alpha: 1.0, size: 2 + Math.random() * 4,
        life: 0.1 + Math.random() * 1.4, drag: 0.995, rise: 0,
      });
    }

    // ── Debris (Shape: Hemisphere r=1, burst 5-10, startSpeed 25-50, lifetime 2s) ──
    // Fast-moving chunks that shoot out in random directions
    // Sub-emitters: DerisFire and DebrisSmoke trail behind each chunk (rateOverDistance)
    const debrisCount = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < debrisCount; i++) {
      const e = emitHemisphere(position, 1.0);
      const speed = 25 + Math.random() * 25;
      const dvx = e.dx * speed;
      const dvy = e.dy * speed;
      const dvz = e.dz * speed;

      // Line spark for the debris chunk itself
      this.particles.lineSparks.emit({
        x: position.x, y: position.y, z: position.z,
        vx: dvx, vy: dvy, vz: dvz,
        r: 1.0, g: 0.9, b: 0.7,
        alpha: 1.0,
        life: 0.8 + Math.random() * 1.2,
        drag: 0.97,
        rise: 0,
        trailLength: 0.06 + Math.random() * 0.04,
      });

      // Simulate sub-emitter: fire puffs along the debris trajectory
      const trailSteps = 6 + Math.floor(Math.random() * 4);
      for (let s = 0; s < trailSteps; s++) {
        const t = (s + 1) / trailSteps;
        const delay = t * 0.15;
        const dragFactor = Math.pow(0.97, delay * 60);
        const tx = position.x + dvx * delay * dragFactor;
        const ty = position.y + dvy * delay * dragFactor;
        const tz = position.z + dvz * delay * dragFactor;
        const spread = 0.8;

        this.particles.debrisFire.emit({
          x: tx + (Math.random() - 0.5) * spread,
          y: ty + (Math.random() - 0.5) * spread,
          z: tz + (Math.random() - 0.5) * spread,
          vx: dvx * 0.15 + (Math.random() - 0.5) * 2,
          vy: dvy * 0.15 + (Math.random() - 0.5) * 2,
          vz: dvz * 0.15 + (Math.random() - 0.5) * 2,
          r: 1.0, g: 0.6 + Math.random() * 0.3, b: 0.15 + Math.random() * 0.2,
          alpha: 0.9,
          size: 0.4 + Math.random() * 0.6,
          sizeGrow: 2.5,
          life: 0.1 + Math.random() * 0.2,
          drag: 0.93, rise: 0,
        });

        // Smoke puff behind the fire
        if (s % 2 === 0) {
          const grey = 0.25 + Math.random() * 0.15;
          this.particles.smoke.emit({
            x: tx + (Math.random() - 0.5) * spread * 0.5,
            y: ty + (Math.random() - 0.5) * spread * 0.5,
            z: tz + (Math.random() - 0.5) * spread * 0.5,
            vx: dvx * 0.05 + (Math.random() - 0.5) * 1,
            vy: dvy * 0.05 + (Math.random() - 0.5) * 1,
            vz: dvz * 0.05 + (Math.random() - 0.5) * 1,
            r: grey, g: grey, b: grey,
            alpha: 0.5,
            size: 0.3 + Math.random() * 0.5,
            sizeGrow: 3.0,
            life: 0.4 + Math.random() * 0.6,
            drag: 0.96, rise: 0,
          });
        }
      }
    }

    // ── Root Smoke (Shape: Hemisphere r=0.7, 60 burst, startSpeed=2-4, lifetime=1-3s) ──
    // Unity: Velocity over Lifetime Linear X 0 Y 10 Z 0 (constant upward velocity in world space)
    for (let i = 0; i < 60; i++) {
      const e = emitHemisphere(position, 0.7);
      const speed = 2 + Math.random() * 2;
      const drift = 0.3;
      const vx = e.dx * speed + (Math.random() - 0.5) * drift;
      const vy = e.dy * speed + (Math.random() - 0.5) * drift;
      const vz = e.dz * speed + (Math.random() - 0.5) * drift;

      const grey = 0.3 + Math.random() * 0.2;
      this.particles.smoke.emit({
        x: e.x, y: e.y, z: e.z,
        vx, vy, vz,
        r: grey, g: grey, b: grey,
        alpha: 0.6,
        size: 0.5 + Math.random() * 1.0,
        sizeGrow: 5.0,
        life: 1.0 + Math.random() * 2.0,
        drag: 0.99, rise: 0,
        velocityOverLifetimeX: 0,
        velocityOverLifetimeY: 10,
        velocityOverLifetimeZ: 0,
        speedLimit: 1.0,
        speedDampen: 0.5,
      });
    }

    // ── Secondary Smoke (Shape: Sphere r=0.5, 40 burst, lifetime=2-4s) ──
    for (let i = 0; i < 40; i++) {
      const e = emitSphere(position, 0.5);
      const speed = 1 + Math.random() * 2;
      const drift = 0.5;
      const vx = e.dx * speed + (Math.random() - 0.5) * drift;
      const vy = e.dy * speed + (Math.random() - 0.5) * drift;
      const vz = e.dz * speed + (Math.random() - 0.5) * drift;

      const grey = 0.2 + Math.random() * 0.15;
      this.particles.smoke.emit({
        x: e.x, y: e.y, z: e.z,
        vx, vy, vz,
        r: grey, g: grey, b: grey,
        alpha: 0.4,
        size: 0.8 + Math.random() * 1.2,
        sizeGrow: 4.0,
        life: 2.0 + Math.random() * 2.0,
        drag: 0.995, rise: 0,
        speedLimit: 0.8,
        speedDampen: 0.6,
      });
    }
  }

  /**
   * Small explosion for missile impacts, etc.
   */
  emitExplosionParticles(position, color = { r: 1, g: 0.5, b: 0.1 }, count = 60) {
    // Fire billboard quads
    for (let i = 0; i < count; i++) {
      const speed = 2 + Math.random() * 5;
      const vx = (Math.random() - 0.5) * 2;
      const vy = (Math.random() - 0.5) * 2;
      const vz = (Math.random() - 0.5) * 2;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;

      this.particles.fire.emit({
        x: position.x + (Math.random() - 0.5) * 0.5,
        y: position.y + (Math.random() - 0.5) * 0.5,
        z: position.z + (Math.random() - 0.5) * 0.5,
        vx: (vx / len) * speed, vy: (vy / len) * speed, vz: (vz / len) * speed,
        r: 1.0, g: 0.8 + Math.random() * 0.2, b: 0.3 + Math.random() * 0.3,
        alpha: 1.0, size: 0.8 + Math.random() * 1.2,
        sizeGrow: 2.5,
        life: 0.3 + Math.random() * 0.4, drag: 0.92, rise: 0,
      });
    }

    // Sparks
    for (let i = 0; i < count; i++) {
      const speed = 12 + Math.random() * 25;
      const vx = (Math.random() - 0.5) * 2;
      const vy = (Math.random() - 0.5) * 2;
      const vz = (Math.random() - 0.5) * 2;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;

      this.particles.sparks.emit({
        x: position.x, y: position.y, z: position.z,
        vx: (vx / len) * speed, vy: (vy / len) * speed, vz: (vz / len) * speed,
        r: 1.0, g: 0.7 + Math.random() * 0.3, b: 0.2,
        alpha: 1.0, size: 4 + Math.random() * 6,
        life: 0.4 + Math.random() * 0.5, drag: 0.96, rise: 0,
      });
    }

    // Smoke billboard quads
    for (let i = 0; i < count / 3; i++) {
      const speed = 1 + Math.random() * 3;
      const vx = (Math.random() - 0.5) * 2;
      const vy = (Math.random() - 0.5) * 2;
      const vz = (Math.random() - 0.5) * 2;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;

      const grey = 0.3 + Math.random() * 0.2;
      this.particles.smoke.emit({
        x: position.x + (Math.random() - 0.5) * 0.5,
        y: position.y + (Math.random() - 0.5) * 0.5,
        z: position.z + (Math.random() - 0.5) * 0.5,
        vx: (vx / len) * speed, vy: (vy / len) * speed, vz: (vz / len) * speed,
        r: grey, g: grey, b: grey,
        alpha: 0.6, size: 1.0 + Math.random() * 1.5,
        sizeGrow: 3.0,
        life: 1.0 + Math.random() * 0.8, drag: 0.97, rise: 0,
      });
    }
  }
}
