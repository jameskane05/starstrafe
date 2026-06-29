/**
 * GameManager.js - CENTRAL GAME STATE AND EVENT MANAGEMENT
 * =============================================================================
 *
 * ROLE: Central state store and event bus. All game state flows through here,
 * and systems react to state changes via the event emitter pattern.
 *
 * KEY RESPONSIBILITIES:
 * - Store and update state (currentState, currentLevel, performanceProfile, etc.)
 * - getState(), setState(partial); emit state:changed for subscribers
 * - getSceneObjectsForState() for SceneManager; getPerformanceSetting(category, key)
 * - Persist and load settings (performance profile) from localStorage
 * - isPlaying() (state === PLAYING); get references to scene, camera, renderer (set at init)
 *
 * RELATED: gameData.js, sceneData.js, performanceSettings.js, SceneManager.js, gameLevel.js.
 *
 * =============================================================================
 */

import { GAME_STATES, initialState } from "../data/gameData.js";
import {
  getSceneObjectsForState,
  getSceneObject,
  LEVEL_OBJECT_IDS,
} from "../data/sceneData.js";
import {
  DEFAULT_PROFILE,
  getPerformanceProfile,
} from "../data/performanceSettings.js";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_PRESETS,
  getDifficultyPreset,
} from "../data/difficultySettings.js";

const SETTINGS_KEY = "starspeed-settings";

class GameManager {
  constructor() {
    this.state = { ...initialState };
    this.eventListeners = {};

    // Manager references (set during initialize)
    this.sceneManager = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    // Track loaded scene objects
    this.loadedScenes = new Set();

    // Load saved settings and apply performance profile to initial state
    this.savedSettings = this.loadSettings();
    this.state.performanceProfile =
      this.savedSettings.performanceProfile || DEFAULT_PROFILE;
    this.state.difficulty =
      this.savedSettings.difficulty || DEFAULT_DIFFICULTY;
    if (this.savedSettings.shipAutoLeveling !== undefined) {
      this.state.shipAutoLeveling = !!this.savedSettings.shipAutoLeveling;
    }
    if (this.savedSettings.captionsEnabled !== undefined) {
      this.state.captionsEnabled = !!this.savedSettings.captionsEnabled;
    }
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  }

  saveSettings() {
    try {
      const settings = {
        ...(this.savedSettings || {}),
        performanceProfile: this.state.performanceProfile,
        difficulty: this.state.difficulty || DEFAULT_DIFFICULTY,
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      this.savedSettings = settings;
    } catch (e) {
      console.warn("[GameManager] Failed to save settings:", e);
    }
  }

  getSetting(key) {
    return this.savedSettings?.[key];
  }

  setSetting(key, value) {
    if (!this.savedSettings) this.savedSettings = {};
    if (key === "lookSensitivity") {
      value = Math.max(0, Math.min(1, Number(value)));
    }
    this.savedSettings[key] = value;
    this.saveSettings();
  }

  getLookSensitivity() {
    const v = this.savedSettings?.lookSensitivity;
    return v != null ? Math.max(0, Math.min(1, Number(v))) : 0.65;
  }

  getShipAutoLeveling() {
    return this.state.shipAutoLeveling !== false;
  }

  setShipAutoLeveling(enabled) {
    const on = !!enabled;
    this.setSetting("shipAutoLeveling", on);
    this.setState({ shipAutoLeveling: on });
  }

  getCaptionsEnabled() {
    return this.state.captionsEnabled !== false;
  }

  setCaptionsEnabled(enabled) {
    const on = !!enabled;
    this.setSetting("captionsEnabled", on);
    this.setState({ captionsEnabled: on });
  }

  setPerformanceProfile(profile) {
    this.setState({ performanceProfile: profile });
    this.saveSettings();
    console.log(`[GameManager] Performance profile set to: ${profile}`);
  }

  getPerformanceProfile() {
    return getPerformanceProfile(this.state.performanceProfile);
  }

  getPerformanceSetting(category, key) {
    const profile = this.getPerformanceProfile();
    return profile?.[category]?.[key];
  }

  setDifficulty(difficulty) {
    const key = DIFFICULTY_PRESETS[difficulty]
      ? difficulty
      : DEFAULT_DIFFICULTY;
    this.setState({ difficulty: key });
    this.saveSettings();
    console.log(`[GameManager] Difficulty set to: ${key}`);
  }

  getDifficultyKey() {
    return this.state.difficulty || DEFAULT_DIFFICULTY;
  }

  getDifficultyPreset() {
    return getDifficultyPreset(this.getDifficultyKey());
  }

  getDifficultySetting(category, key) {
    return this.getDifficultyPreset()?.[category]?.[key];
  }

  /**
   * Initialize with manager references
   * @param {Object} managers - Object containing manager instances
   */
  async initialize(managers = {}) {
    this.sceneManager = managers.sceneManager;
    this.scene = managers.scene;
    this.camera = managers.camera;
    this.renderer = managers.renderer;

    // Load initial scene objects
    if (this.sceneManager) {
      await this.updateSceneForState({ preloadOnly: true });
    }

    console.log("GameManager initialized");
  }

  /**
   * Set game state (partial update)
   * @param {Object} newState - State updates to apply
   */
  setState(newState) {
    const oldState = { ...this.state };
    this.state = { ...this.state, ...newState };

    // Log state changes
    if (
      newState.currentState !== undefined &&
      newState.currentState !== oldState.currentState
    ) {
      console.log(
        `[GameManager] State: ${this.getStateName(oldState.currentState)} → ${this.getStateName(newState.currentState)}`,
      );
    }

    this.emit("state:changed", this.state, oldState);

    if (
      this.sceneManager &&
      (this.state.currentState !== oldState.currentState ||
        this.state.currentLevel !== oldState.currentLevel ||
        this.state.multiplayerLobbyWarmup !== oldState.multiplayerLobbyWarmup)
    ) {
      this.updateSceneForState();
    }
  }

  /**
   * Get current state
   * @returns {Object}
   */
  getState() {
    return { ...this.state };
  }

  clearMissionState(extraState = {}) {
    this.setState({
      currentMissionId: null,
      missionLevelId: null,
      missionStatus: "idle",
      missionStepId: null,
      missionStepTitle: "",
      currentObjectives: [],
      playerLaserEnabled: initialState.playerLaserEnabled,
      playerMissilesEnabled: initialState.playerMissilesEnabled,
      ...extraState,
    });
  }

  /**
   * Get state name from numeric value
   */
  getStateName(stateValue) {
    for (const [name, value] of Object.entries(GAME_STATES)) {
      if (value === stateValue) return name;
    }
    return "UNKNOWN";
  }

  /**
   * Update scene objects based on current game state
   */
  async updateSceneForState(options = {}) {
    if (!this.sceneManager) return;

    const objectsToLoad = getSceneObjectsForState(this.state, options);
    const objectIdsToLoad = new Set(objectsToLoad.map((obj) => obj.id));

    const toUnload = new Set(
      options.preloadOnly
        ? []
        : Array.from(this.loadedScenes).filter(
            (id) => !objectIdsToLoad.has(id),
          ),
    );

    for (const id of LEVEL_OBJECT_IDS) {
      if (this.sceneManager.hasObject(id) && !objectIdsToLoad.has(id)) {
        if (
          this.state.multiplayerLobbyWarmup &&
          this.state.currentState === GAME_STATES.MENU
        ) {
          const obj = getSceneObject(id);
          const lv = obj?.criteria?.currentLevel;
          if (lv !== undefined && lv === this.state.currentLevel) {
            continue;
          }
        }
        toUnload.add(id);
      }
    }

    for (const id of toUnload) {
      this.sceneManager.removeObject(id);
      this.loadedScenes.delete(id);
      console.log(`[GameManager] Unloaded: ${id}`);
    }

    // Filter out already loaded objects
    const newObjects = objectsToLoad.filter(
      (obj) => !this.loadedScenes.has(obj.id),
    );

    // Load new objects
    for (const obj of newObjects) {
      this.loadedScenes.add(obj.id);
      await this.sceneManager.loadObject(obj);
      console.log(`[GameManager] Loaded: ${obj.id}`);
    }
  }

  // Event emitter methods
  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  off(event, callback) {
    if (this.eventListeners[event]) {
      const index = this.eventListeners[event].indexOf(callback);
      if (index > -1) {
        this.eventListeners[event].splice(index, 1);
      }
    }
  }

  emit(event, ...args) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach((callback) => callback(...args));
    }
  }

  // Convenience methods
  isPlaying() {
    return this.state.currentState === GAME_STATES.PLAYING;
  }

  isPaused() {
    return this.state.currentState === GAME_STATES.PAUSED;
  }

  startGame() {
    this.setState({
      currentState: GAME_STATES.PLAYING,
      isRunning: true,
    });
    this.emit("game:started");
  }

  pauseGame() {
    this.setState({
      currentState: GAME_STATES.PAUSED,
      isPaused: true,
    });
    this.emit("game:paused");
  }

  resumeGame() {
    this.setState({
      currentState: GAME_STATES.PLAYING,
      isPaused: false,
    });
    this.emit("game:resumed");
  }

  gameOver() {
    this.setState({
      currentState: GAME_STATES.GAME_OVER,
      isRunning: false,
    });
    this.emit("game:over");
  }

  victory() {
    this.setState({
      currentState: GAME_STATES.VICTORY,
      isRunning: false,
    });
    this.emit("game:victory");
  }
}

export default GameManager;
