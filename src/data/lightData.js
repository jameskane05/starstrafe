/**
 * lightData.js - LIGHT DEFINITIONS
 * =============================================================================
 *
 * Standard Three.js lights only - SplatLights removed for performance.
 * SplatEdit layers cause significant per-frame overhead in SparkJS.
 *
 * =============================================================================
 */

import { GAME_STATES } from "./gameData.js";

export const lights = {
  ambient: {
    id: "ambient",
    type: "AmbientLight",
    color: 0x334455,
    intensity: 0.4,
  },

  hangarOverhead: {
    id: "hangar-overhead",
    type: "PointLight",
    color: 0xffe6cc,
    intensity: 100,
    distance: 100,
    decay: 2,
    position: { x: 0, y: 8, z: 0 },
  },

  hangarLight1: {
    id: "hangar-light-1",
    type: "PointLight",
    color: 0xb3ccff,
    intensity: 150,
    distance: 100,
    decay: 2,
    position: { x: -15, y: 6, z: -10 },
  },

  hangarLight2: {
    id: "hangar-light-2",
    type: "PointLight",
    color: 0xb3ccff,
    intensity: 15,
    distance: 50,
    decay: 2,
    position: { x: 15, y: 6, z: -10 },
  },

  warningLight1: {
    id: "warning-light-1",
    type: "PointLight",
    color: 0xff3311,
    intensity: 8,
    distance: 25,
    decay: 2,
    position: { x: -20, y: 3, z: 15 },
  },

  warningLight2: {
    id: "warning-light-2",
    type: "PointLight",
    color: 0xff3311,
    intensity: 8,
    distance: 25,
    decay: 2,
    position: { x: 20, y: 3, z: 15 },
  },
};

export default lights;
