export const PERFORMANCE_PROFILES = {
  low: {
    label: "Low",
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
      toneMapping: true,
      toneMappingExposure: 1.5,
    },
  },
  medium: {
    label: "Medium",
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
      toneMapping: true,
      toneMappingExposure: 1.5,
    },
  },
  high: {
    label: "High",
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
      toneMapping: true,
      toneMappingExposure: 1.5,
    },
  },
  max: {
    label: "Max",
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
      toneMapping: true,
      toneMappingExposure: 1.5,
    },
  },
};

export const DEFAULT_PROFILE = "high";

export function getPerformanceProfile(name) {
  return PERFORMANCE_PROFILES[name] || PERFORMANCE_PROFILES[DEFAULT_PROFILE];
}

export function getPerformanceSetting(profileName, category, key) {
  const profile = getPerformanceProfile(profileName);
  return profile?.[category]?.[key];
}
