export const DEFAULT_DIFFICULTY = "normal";

export const DIFFICULTY_PRESETS = {
  easy: {
    label: "Easy",
    player: {
      maxHealth: 100,
      missiles: 6,
      laserDamage: 25,
    },
    enemy: {
      healthMultiplier: 1,
      damage: 10,
      fireRateMultiplier: 1,
      speedMultiplier: 1,
      respawnDelay: 20,
    },
    ally: {
      enabled: true,
      damage: 14,
      fireRate: 1.1,
    },
  },
  normal: {
    label: "Normal",
    player: {
      maxHealth: 90,
      missiles: 5,
      laserDamage: 24,
    },
    enemy: {
      healthMultiplier: 1.15,
      damage: 12,
      fireRateMultiplier: 1.12,
      speedMultiplier: 1.05,
      respawnDelay: 18,
    },
    ally: {
      enabled: true,
      damage: 12,
      fireRate: 1,
    },
  },
  hard: {
    label: "Hard",
    player: {
      maxHealth: 75,
      missiles: 4,
      laserDamage: 22,
    },
    enemy: {
      healthMultiplier: 1.35,
      damage: 15,
      fireRateMultiplier: 1.3,
      speedMultiplier: 1.12,
      respawnDelay: 14,
    },
    ally: {
      enabled: true,
      damage: 10,
      fireRate: 0.85,
    },
  },
};

export function getDifficultyPreset(key = DEFAULT_DIFFICULTY) {
  return DIFFICULTY_PRESETS[key] || DIFFICULTY_PRESETS[DEFAULT_DIFFICULTY];
}

export function getDifficultySetting(key, category, setting) {
  return getDifficultyPreset(key)?.[category]?.[setting];
}
