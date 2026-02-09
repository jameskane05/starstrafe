import * as THREE from "three";

/**
 * DustMotesEffect - Global ambient dust particles
 * Matches Unity DustMotesEffect.prefab
 * 
 * Emits particles from a large box volume continuously.
 * Particles have no velocity, just fade in/out over lifetime.
 */
export class DustMotesEffect {
  constructor(particleSystem) {
    this.particles = particleSystem;
    this.enabled = true;
    this.emissionRate = 100; // particles per second
    this.emissionTimer = 0;
    
    // Box emission shape - 100m effect (much larger than Unity's 10.53 x 10 x 12.39)
    // Fixed in world space - level is at Y = -90, center box around level
    this.boxSize = new THREE.Vector3(100, 100, 100);
    this.boxCenter = new THREE.Vector3(0, -90, 0); // Center at level position
    
    // Particle properties (from Unity prefab)
    this.lifetime = 5.0; // seconds
    this.sizeMin = 0.05; // Original Unity size
    this.sizeMax = 0.15; // Original Unity size
    
    // Color: brownish dust (0.278, 0.251, 0.220) from Unity
    this.colorR = 0.278;
    this.colorG = 0.251;
    this.colorB = 0.220;
    
    this.emitCount = 0; // Debug counter
  }

  /**
   * Emit a single dust mote from random position in box
   */
  emitDustMote() {
    // Random position in box (centered on boxCenter)
    const x = this.boxCenter.x + (Math.random() - 0.5) * this.boxSize.x;
    const y = this.boxCenter.y + (Math.random() - 0.5) * this.boxSize.y;
    const z = this.boxCenter.z + (Math.random() - 0.5) * this.boxSize.z;
    
    // Random size
    const size = this.sizeMin + Math.random() * (this.sizeMax - this.sizeMin);
    
    // No velocity (startSpeed: 0 in Unity)
    // Lifetime: 5 seconds
    // Color: brownish dust, alpha fades in then out
    
    // Use sparks pool (point sprites with additive blending)
    // Add slow drift velocity for ambient movement
    // Small random velocity in all directions for gentle drift
    const driftX = (Math.random() - 0.5) * 0.2;
    const driftY = (Math.random() - 0.5) * 0.2;
    const driftZ = (Math.random() - 0.5) * 0.2;
    
    this.particles.sparks.emit({
      x, y, z,
      vx: driftX, vy: driftY, vz: driftZ, // Small random drift
      r: this.colorR * 1.5, // Slightly brighten for additive blending
      g: this.colorG * 1.5,
      b: this.colorB * 1.5,
      alpha: 0.4, // Increased for visibility
      size: size * 42, // Point sprite size scale (sparks pool uses sizeScale: 42)
      // size: 0.1 * 42 = 4.2 pixels, which should be visible
      life: this.lifetime,
      drag: 0.99, // Very slight drag
      rise: 0,
      velocityOverLifetimeX: driftX * 0.05, // Continuous slow velocity over lifetime
      velocityOverLifetimeY: driftY * 0.05,
      velocityOverLifetimeZ: driftZ * 0.05,
    });
    
    this.emitCount++;
    if (this.emitCount % 100 === 0) {
      console.log(`[DustMotes] Emitted ${this.emitCount} particles, box center:`, this.boxCenter);
    }
  }

  /**
   * Update - emit particles based on rate
   * @param {number} delta - Delta time in seconds
   */
  update(delta) {
    if (!this.enabled) {
      if (this.emitCount === 0) {
        console.log('[DustMotes] Effect is disabled');
      }
      return;
    }
    
    if (!this.particles || !this.particles.sparks) {
      if (this.emitCount === 0) {
        console.warn('[DustMotes] Particle system or sparks pool not available');
      }
      return;
    }
    
    this.emissionTimer += delta;
    const particlesPerFrame = this.emissionRate * delta;
    const numParticles = Math.floor(particlesPerFrame);
    const remainder = particlesPerFrame - numParticles;
    
    // Emit whole particles
    for (let i = 0; i < numParticles; i++) {
      this.emitDustMote();
    }
    
    // Emit fractional particle based on remainder
    if (Math.random() < remainder) {
      this.emitDustMote();
    }
  }

  /**
   * Set emission box size and center
   * @param {THREE.Vector3} size - Box size
   * @param {THREE.Vector3} center - Box center
   */
  setEmissionBox(size, center) {
    this.boxSize.copy(size);
    this.boxCenter.copy(center);
  }

  /**
   * Set emission rate
   * @param {number} rate - Particles per second
   */
  setEmissionRate(rate) {
    this.emissionRate = rate;
  }

  /**
   * Enable/disable emission
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}
