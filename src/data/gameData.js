/**
 * gameData.js - GAME STATE DEFINITIONS AND INITIAL VALUES
 * =============================================================================
 *
 * Centralized definition of game state enums and the initial state object.
 *
 * KEY EXPORTS:
 * - GAME_STATES: Enum of all game states
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

export const initialState = {
  currentState: GAME_STATES.LOADING,
  isRunning: false,
  isPaused: false,
  
  // Player stats
  playerHealth: 100,
  playerMissiles: 20,
  
  // Game progress
  enemiesRemaining: 0,
  enemiesKilled: 0,
  
  // Current level/environment
  currentLevel: "hangar",
};

export default { GAME_STATES, initialState };

