/**
 * sceneData.js - SCENE OBJECT DEFINITIONS AND RESOLUTION
 * =============================================================================
 *
 * ROLE: Defines all scene objects (splats, GLTFs) and provides state-driven
 * resolution for which objects to load. SceneManager loads by these configs.
 *
 * KEY RESPONSIBILITIES:
 * - sceneObjects: Map of id to config (id, type, path, position, rotation, scale,
 *   priority, preload, criteria, options for physics/LOD/occluder)
 * - getSceneObjectsForState(state): return list of objects matching state/criteria
 * - getSceneObject(id), LEVEL_OBJECT_IDS; checkCriteria(state, criteria) for filtering
 *
 * RELATED: SceneManager.js, gameData.js, gameLevel.js, LightManager.js (checkCriteria).
 *
 * =============================================================================
 */

import { GAME_STATES } from "./gameData.js";

export const sceneObjects = {
  charonLevel: {
    id: "charonLevel",
    type: "splat",
    path: "./splats/charon/charon-final-lod.rad",
    description: "Charon environment gaussian splat with LOD",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
    priority: 100,
    preload: false,
    paged: true,
    lod: true,
    extSplats: true,
    gizmo: false,
    criteria: {
      currentLevel: "charon",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  charonLevelData: {
    id: "charonLevelData",
    type: "gltf",
    path: "./splats/charon-data.glb",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
    priority: 95,
    preload: false,
    gizmo: false,
    options: {
      occluder: true,
      debugWireframe: false,
      physicsCollider: true,
      combinedLevel: { geometryName: "LevelGeometry" },
    },
    criteria: {
      currentLevel: "charon",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  newworldLevel: {
    id: "newworldLevel",
    type: "splat",
    path: "./splats/spaceship/spaceship-lod.rad",
    description: "New World environment gaussian splat with LOD",
    position: { x: -56.68, y: 0.0, z: 29.79 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 0.514,
    priority: 100,
    preload: false,
    paged: true,
    lod: true,
    extSplats: true,
    gizmo: false,
    criteria: {
      currentLevel: "newworld",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  newworldLevelData: {
    id: "newworldLevelData",
    type: "gltf",
    path: "./splats/spaceship-data.glb",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
    priority: 95,
    preload: false,
    gizmo: false,
    options: {
      occluder: true,
      debugWireframe: false,
      physicsCollider: true,
      combinedLevel: { geometryName: "LevelGeometry" },
    },
    criteria: {
      currentLevel: "newworld",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  saturnaliaLevel: {
    id: "saturnaliaLevel",
    type: "splat",
    path: "./splats/saturnalia/New_Saturn-lod.rad",
    description: "Saturnalia interstellar hub gaussian splat with LOD",
    position: { x: 0, y: 100, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 10,
    priority: 100,
    preload: false,
    paged: true,
    lod: true,
    extSplats: true,
    gizmo: false,
    criteria: {
      currentLevel: "saturnalia",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  saturnaliaLevelData: {
    id: "saturnaliaLevelData",
    type: "gltf",
    path: "./splats/saturnalia-data.glb",
    position: { x: 0, y: 100, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 10,
    priority: 95,
    preload: false,
    gizmo: false,
    options: {
      occluder: true,
      debugWireframe: false,
      physicsCollider: true,
      combinedLevel: { geometryName: "LevelGeometry" },
    },
    criteria: {
      currentLevel: "saturnalia",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  redarenaLevel: {
    id: "redarenaLevel",
    type: "splat",
    path: "./splats/red-arena-1.ply",
    description: "Red Arena environment gaussian splat",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 87.86,
    priority: 100,
    preload: false,
    paged: false,
    gizmo: false,
    criteria: {
      currentLevel: "redarena",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  redarenaLevelData: {
    id: "redarenaLevelData",
    type: "gltf",
    path: "./splats/arena-data.glb",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
    priority: 95,
    preload: false,
    gizmo: false,
    options: {
      occluder: true,
      debugWireframe: false,
      physicsCollider: true,
      combinedLevel: {
        geometryName: "LevelGeometry",
        dynamicSceneElements: {
          meshNamePrefix: "Pillar",
          animate: false,
          ambientTint: 0xff4444,
          ambientTintStrength: 0.06,
          material: {
            color: 0x040203,
            metalness: 0.05,
            roughness: 0.95,
          },
        },
      },
    },
    criteria: {
      currentLevel: "redarena",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  arenatechLevel: {
    id: "arenatechLevel",
    type: "splat",
    path: "./splats/arena-tech.ply",
    description: "Tech Arena environment gaussian splat",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 30.2362,
    priority: 100,
    preload: false,
    paged: false,
    gizmo: false,
    criteria: {
      currentLevel: "arenatech",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  arenatechLevelData: {
    id: "arenatechLevelData",
    type: "gltf",
    path: "./splats/arena-data.glb",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
    priority: 95,
    preload: false,
    gizmo: false,
    options: {
      occluder: true,
      debugWireframe: false,
      physicsCollider: true,
      combinedLevel: {
        geometryName: "LevelGeometry",
        dynamicSceneElements: {
          meshNamePrefix: "Pillar",
          animate: false,
          ambientTint: 0xd0c0a8,
          ambientTintStrength: 0.02,
          material: {
            color: 0x020203,
            metalness: 0.04,
            roughness: 0.96,
          },
        },
      },
    },
    criteria: {
      currentLevel: "arenatech",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  earthdefenseLevel: {
    id: "earthdefenseLevel",
    type: "splat",
    path: "./splats/earth/EarthDefenseTest2-lod.rad",
    description: "Earth Defense environment gaussian splat with LOD",
    position: { x: 0, y: -10, z: 0 },
    rotation: { x: 180, y: 0, z: 0 },
    scale: 12,
    priority: 100,
    preload: false,
    paged: true,
    lod: true,
    extSplats: true,
    gizmo: false,
    criteria: {
      currentLevel: "earthdefense",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },

  earthdefenseLevelData: {
    id: "earthdefenseLevelData",
    type: "gltf",
    path: "./splats/earth-data.glb",
    position: { x: 0, y: -10, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 3,
    priority: 95,
    preload: false,
    gizmo: false,
    options: {
      occluder: true,
      debugWireframe: false,
      physicsCollider: true,
      combinedLevel: { geometryName: "LevelGeometry" },
    },
    criteria: {
      currentLevel: "earthdefense",
      currentState: { $in: [GAME_STATES.PLAYING, GAME_STATES.PAUSED] },
    },
  },
};

/**
 * Check if criteria matches current state
 * Supports simple equality and comparison operators ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin)
 */
export function checkCriteria(state, criteria) {
  if (!criteria) return true;

  for (const [key, condition] of Object.entries(criteria)) {
    const stateValue = state[key];

    if (typeof condition === "object" && condition !== null) {
      // Handle comparison operators
      if (condition.$eq !== undefined && stateValue !== condition.$eq)
        return false;
      if (condition.$ne !== undefined && stateValue === condition.$ne)
        return false;
      if (condition.$gt !== undefined && !(stateValue > condition.$gt))
        return false;
      if (condition.$gte !== undefined && !(stateValue >= condition.$gte))
        return false;
      if (condition.$lt !== undefined && !(stateValue < condition.$lt))
        return false;
      if (condition.$lte !== undefined && !(stateValue <= condition.$lte))
        return false;
      if (condition.$in !== undefined && !condition.$in.includes(stateValue))
        return false;
      if (condition.$nin !== undefined && condition.$nin.includes(stateValue))
        return false;
    } else {
      // Simple equality check
      if (stateValue !== condition) return false;
    }
  }

  return true;
}

export const LEVEL_OBJECT_IDS = [
  "level",
  "levelOcclusion",
  "charonLevel",
  "charonLevelData",
  "newworldLevel",
  "newworldLevelData",
  "saturnaliaLevel",
  "saturnaliaLevelData",
  "redarenaLevel",
  "redarenaLevelData",
  "arenatechLevel",
  "arenatechLevelData",
  "earthdefenseLevel",
  "earthdefenseLevelData",
];

/**
 * Get scene objects that should be loaded for the current game state
 * @param {Object} state - Current game state
 * @param {Object} options - Options object
 * @param {boolean} options.preloadOnly - If true, only return preload: true objects
 * @returns {Array<Object>} Array of scene objects to load
 */
export function getSceneObjectsForState(state, options = {}) {
  const sortedObjects = Object.values(sceneObjects).sort(
    (a, b) => (b.priority || 0) - (a.priority || 0),
  );

  const matchingObjects = [];

  for (const obj of sortedObjects) {
    // Filter by preload flag if requested
    if (options.preloadOnly && obj.preload !== true) {
      continue;
    }

    // Check criteria
    if (obj.criteria && !checkCriteria(state, obj.criteria)) {
      continue;
    }

    matchingObjects.push(obj);
  }

  return matchingObjects;
}

/**
 * Get a scene object by ID
 */
export function getSceneObject(id) {
  return sceneObjects[id] || null;
}

export default sceneObjects;
