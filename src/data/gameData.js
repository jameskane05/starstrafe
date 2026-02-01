/**
 * gameData.js - GAME STATE DEFINITIONS AND INITIAL VALUES
 * =============================================================================
 *
 * Centralized definition of game state enums and the initial state object.
 *
 * KEY EXPORTS:
 * - GAME_STATES: Enum of all game states
 * - SHIP_CLASSES: Ship class definitions with stats
 * - initialState: Initial state object applied at game start
 *
 * =============================================================================
 */

export const GAME_STATES = {
  LOADING: 0,
  MENU: 1,
  PLAYING: 2,
  PAUSED: 3,
  VICTORY: 4,
  GAME_OVER: 5,
};

export const LEVELS = {
  hangar: {
    id: "hangar",
    name: "Orbital Station",
    description: "Abandoned space station with tight corridors",
    thumbnail: null,
  },
};

export const SHIP_CLASSES = {
  fighter: {
    name: "Fighter",
    description: "Balanced combat vessel",
    speed: 1.0,
    acceleration: 0.5,
    maxSpeed: 1.0,
    health: 100,
    missiles: 6,
    maxMissiles: 6,
    projectileSpeed: 60,
    projectileDamage: 25,
    missileDamage: 75,
    fireRate: 8,
    color: 0x00f0ff,
  },
  tank: {
    name: "Tank",
    description: "Heavy armor, devastating missiles",
    speed: 0.7,
    acceleration: 0.35,
    maxSpeed: 0.7,
    health: 150,
    missiles: 8,
    maxMissiles: 8,
    projectileSpeed: 50,
    projectileDamage: 30,
    missileDamage: 150,
    fireRate: 5,
    color: 0xff8800,
  },
  rogue: {
    name: "Rogue",
    description: "Fast and agile interceptor",
    speed: 1.4,
    acceleration: 0.7,
    maxSpeed: 1.4,
    health: 70,
    missiles: 4,
    maxMissiles: 4,
    projectileSpeed: 80,
    projectileDamage: 20,
    missileDamage: 60,
    fireRate: 12,
    color: 0x00ff88,
  },
};

export const initialState = {
  currentState: GAME_STATES.LOADING,
  isRunning: false,
  isPaused: false,
  isMultiplayer: false,
  
  // Player stats
  playerHealth: 100,
  playerMissiles: 6,
  playerMaxMissiles: 6,
  playerClass: "fighter",
  
  // Game progress
  enemiesRemaining: 0,
  enemiesKilled: 0,
  kills: 0,
  deaths: 0,
  
  // Current level/environment
  currentLevel: "hangar",
};

export default { GAME_STATES, LEVELS, SHIP_CLASSES, initialState };

