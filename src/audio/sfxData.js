/**
 * sfxData.js - SFX DEFINITIONS
 * =============================================================================
 *
 * ROLE: Defines sample-based SFX: src paths, volume/pitch ranges, spatial
 * settings (refDistance, maxDistance, rolloff), roundRobin. Consumed by sfxManager.
 *
 * KEY RESPONSIBILITIES:
 * - sfxSounds: map of id to { id, src[], volume, pitch, spatial, refDistance, etc. }
 * - Default export for sfxManager.init(soundsData)
 *
 * RELATED: sfxManager.js.
 *
 * =============================================================================
 */

export const sfxSounds = {
  laser: {
    id: "laser",
    src: [
      "./audio/sfx/laser-01.mp3",
      "./audio/sfx/laser-02.mp3",
      "./audio/sfx/laser-03.mp3",
      "./audio/sfx/laser-04.mp3",
      "./audio/sfx/laser-05.mp3",
      "./audio/sfx/laser-06.mp3",
      "./audio/sfx/laser-07.mp3",
      "./audio/sfx/laser-08.mp3",
    ],
    volume: [0.5, 0.8],
    pitch: [0.9, 1.1],
    roundRobin: true,
    spatial: true,
    refDistance: 25,
    maxDistance: 500,
    rolloffFactor: 0.5,
  },

  "ship-explosion": {
    id: "ship-explosion",
    src: ["./audio/sfx/ship-explosion.mp3"],
    volume: [0.8, 1.0],
    pitch: [0.85, 1.05],
    spatial: true,
    refDistance: 25,
    maxDistance: 500,
    rolloffFactor: 0.5,
  },

  "engine-boost": {
    id: "engine-boost",
    src: ["./audio/sfx/engine-boost.mp3"],
    volume: 1.5,
    pitch: [0.96, 1.04],
    spatial: true,
    refDistance: 18,
    maxDistance: 260,
    rolloffFactor: 0.35,
  },
};

export default sfxSounds;
