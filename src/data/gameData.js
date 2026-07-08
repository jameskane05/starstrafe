/**
 * gameData.js - GAME STATE DEFINITIONS AND INITIAL VALUES
 * =============================================================================
 *
 * ROLE: Centralized definition of game state enums, level config, ship classes,
 * and the initial state object used by GameManager at startup.
 *
 * KEY RESPONSIBILITIES:
 * - GAME_STATES: Enum of all game states (LOADING, MENU, PLAYING, PAUSED, etc.)
 * - LEVELS: Level id, name, description, preview; used by LightManager and menu
 * - SHIP_CLASSES: Ship class definitions with stats for player and enemies
 * - initialState: Initial state object applied at game start
 *
 * RELATED: GameManager.js, sceneData.js, LightManager.js, gameLevel.js.
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
  newworld: {
    id: "newworld",
    name: "New World",
    description: "Open planetary environment",
    preview: "/images/NewWorld-preview.png",
  },
  saturnalia: {
    id: "saturnalia",
    name: "Saturnalia",
    description: "Futuristic interstellar hub",
    preview: "/images/saturnalia-preview.png",
  },
  redarena: {
    id: "redarena",
    name: "Red Arena",
    description: "Sci-fi arena environment",
    preview: "/images/arena-preview.png",
    ambientColor: 0xff4444,
    ambientIntensity: 4,
    multiplayerSelectable: false,
  },
  arenatech: {
    id: "arenatech",
    name: "Tech Arena",
    description: "Same arena, warm industrial lighting",
    preview: "/images/arena-preview.png",
    ambientColor: 0xc8b8a8,
    ambientIntensity: 3,
  },
  charon: {
    id: "charon",
    name: "Charon",
    description: "Charon environment",
    preview: "/images/charon-final.png",
  },
  earthdefense: {
    id: "earthdefense",
    name: "Earth Defense",
    description: "Capital ship engagement above Earth",
    preview: "/images/earth-defense-preview.png",
    ambientColor: 0x7a8490,
    ambientIntensity: 5,
    multiplayerSelectable: false,
  },
};

export function multiplayerMapLevels() {
  const list = Object.values(LEVELS).filter(
    (l) => l.multiplayerSelectable !== false,
  );
  const techArena = list.filter((l) => l.id === "arenatech");
  const rest = list.filter((l) => l.id !== "arenatech");
  return [...rest, ...techArena];
}

export const SHIP_CLASSES = {
  fighter: {
    name: "Fighter",
    description: "Balanced combat vessel",
    speed: 1.56,
    acceleration: 0.575,
    maxSpeed: 1.56,
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
    speed: 1.092,
    acceleration: 0.4025,
    maxSpeed: 1.092,
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
    speed: 2.184,
    acceleration: 0.805,
    maxSpeed: 2.184,
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
  currentMissionId: null,
  missionLevelId: null,
  missionStatus: "idle",
  missionStepId: null,
  missionStepTitle: "",
  currentObjectives: [],
  selectedPrimaryWeapon: "laser",
  selectedMissileMode: "homing",
  playerLaserEnabled: true,
  playerMissilesEnabled: true,
  /** Roll toward wings-level (world up) when not manually rolling — Descent-style ship auto-leveling */
  shipAutoLeveling: true,
  /** Dialog / mission caption overlay (3D text) */
  captionsEnabled: true,

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
  currentLevel: "newworld",

  /** True while in a Colyseus lobby (MENU) before match start — keeps preloaded level from being unloaded. */
  multiplayerLobbyWarmup: false,

  /** Charon: first heavy-bot missile sets this; DialogManager autoplays charonAlcairMissilesIncoming. */
  charonHeavyMissileIntroPending: false,
  charonHeavyMissileIntroDone: false,

  /** Charon: end boss — reactor core has been destroyed (environment / mission phase). */
  charonReactorCoreDestroyed: false,
  /** Charon: set true with reactor destroy to autoplay charonMobiusPointlessReactorTaunt; cleared when dialog starts. */
  charonMobiusReactorTauntPending: false,
  charonMobiusReactorTauntDone: false,
  /** Charon: reactor destroyed — 60s escape run active (HUD + VFX). */
  charonEscapeActive: false,
  /** Charon: player reached first-room volume before timer expired. */
  charonEscapeSucceeded: false,

  /** Charon: opening typewriter on black finished — unlocks `charonIntroEntering` autoplay. */
  charonIntroTextDone: false,

  /** Saturnalia: opening typewriter on black finished — unlocks arrival dialog autoplay. */
  saturnaliaIntroTextDone: false,

  /** Earth Defense: opening typewriter on black finished. */
  earthIntroTextDone: false,

  /** Saturnalia: chase drone escaped — station collapse VFX/shake active. */
  saturnaliaCollapseActive: false,
  /** Saturnalia: player reached Trigger.009 before the destruction timer expired. */
  saturnaliaEscapeSucceeded: false,

  debugSpawnActive: false,

  // Performance
  performanceProfile: null, // Set on init from saved settings or auto-detected
};

export default { GAME_STATES, LEVELS, SHIP_CLASSES, initialState };
