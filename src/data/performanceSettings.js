/**
 * performanceSettings.js - PERFORMANCE PROFILES AND DETECTION
 * =============================================================================
 *
 * ROLE: Defines performance profiles (low, medium, high) for splat, particles,
 * and rendering options. Provides getPerformanceProfile() for device-based
 * default and profile merge into game state.
 *
 * KEY RESPONSIBILITIES:
 * - PERFORMANCE_PROFILES: low/medium/high with splat, particles, rendering, enemyCullDistance
 * - getPerformanceProfile(): return profile key from device/heuristic; DEFAULT_PROFILE
 * - GameManager and SceneManager read settings via getPerformanceSetting(category, key)
 *
 * RELATED: GameManager.js, gameInit.js, SceneManager.js.
 *
 * =============================================================================
 */

export const PERFORMANCE_PROFILES = {
  low: {
    label: "Low",
    splat: {
      lodSplatScale: 0.5,
      lodRenderScale: 0.5,
      maxPagedSplats: 96 * 65536,
      coneFov0: 50.0,
      coneFov: 100.0,
      behindFoveate: 0.35,
      coneFoveate: 0.55,
    },
    particles: {
      sparks: 200,
      fire: 100,
      smoke: 80,
      debrisFire: 80,
      lineSparks: 200,
      explosionParticleScale: 0.4,
      debrisCount: 3,
    },
    rendering: {
      pixelRatio: 1,
      shadows: false,
      bloom: true,
      enemyLights: false,
      projectileSplatLights: true,
      toneMapping: true,
      toneMappingExposure: 1.5,
    },
    enemyCullDistance: 200,
  },
  medium: {
    label: "Medium",
    splat: {
      lodSplatScale: 0.2,
      maxPagedSplats: 256 * 65536,
      coneFov0: 70.0,
      coneFov: 120.0,
      behindFoveate: 0.2,
      coneFoveate: 0.4,
    },
    particles: {
      sparks: 400,
      fire: 200,
      smoke: 150,
      debrisFire: 150,
      lineSparks: 400,
      explosionParticleScale: 0.7,
      debrisCount: 6,
    },
    rendering: {
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
      shadows: true,
      bloom: true,
      enemyLights: false,
      projectileSplatLights: true,
      toneMapping: true,
      toneMappingExposure: 1.5,
    },
    enemyCullDistance: 200,
  },
  high: {
    label: "High",
    splat: {
      lodSplatScale: 1.0,
      lodRenderScale: 1.0,
      maxPagedSplats: 256 * 65536,
      coneFov0: 70.0,
      coneFov: 120.0,
      behindFoveate: 0.2,
      coneFoveate: 0.4,
    },
    particles: {
      sparks: 500,
      fire: 300,
      smoke: 200,
      debrisFire: 200,
      lineSparks: 600,
      explosionParticleScale: 1.0,
      debrisCount: 10,
    },
    rendering: {
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      shadows: true,
      bloom: true,
      enemyLights: true,
      projectileSplatLights: true,
      toneMapping: true,
      toneMappingExposure: 1.5,
    },
    enemyCullDistance: 200,
  },
  max: {
    label: "Max",
    splat: {
      lodSplatScale: 2.0,
      lodRenderScale: 1.0,
      maxPagedSplats: 256 * 65536,
      coneFov0: 70.0,
      coneFov: 120.0,
      behindFoveate: 0.2,
      coneFoveate: 0.4,
    },
    particles: {
      sparks: 800,
      fire: 500,
      smoke: 400,
      debrisFire: 400,
      lineSparks: 1000,
      explosionParticleScale: 1.0,
      debrisCount: 10,
    },
    rendering: {
      pixelRatio: window.devicePixelRatio,
      shadows: true,
      bloom: true,
      enemyLights: true,
      projectileSplatLights: true,
      toneMapping: true,
      toneMappingExposure: 1.5,
    },
    enemyCullDistance: 200,
  },
};

export const DEFAULT_PROFILE = "medium";

export const IOS_MAX_PAGED_SPLATS = 24 * 65536;

export function getPerformanceProfile(name) {
  return PERFORMANCE_PROFILES[name] || PERFORMANCE_PROFILES[DEFAULT_PROFILE];
}

export function getPerformanceSetting(profileName, category, key) {
  const profile = getPerformanceProfile(profileName);
  return profile?.[category]?.[key];
}
