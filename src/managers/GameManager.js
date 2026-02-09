/**
 * GameManager.js - CENTRAL GAME STATE AND EVENT MANAGEMENT
 * =============================================================================
 *
 * Central state store and event bus. All game state flows through here,
 * and systems react to state changes via the event emitter pattern.
 *
 * =============================================================================
 */

import { GAME_STATES, initialState } from "../data/gameData.js";
import { getSceneObjectsForState } from "../data/sceneData.js";
import { DEFAULT_PROFILE, getPerformanceProfile } from "../data/performanceSettings.js";

const SETTINGS_KEY = "starstrafe-settings";

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
    this.state.performanceProfile = this.savedSettings.performanceProfile || DEFAULT_PROFILE;
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
        performanceProfile: this.state.performanceProfile,
        ...(this.savedSettings || {}),
      };
      settings.performanceProfile = this.state.performanceProfile;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      this.savedSettings = settings;
    } catch (e) {
      console.warn("[GameManager] Failed to save settings:", e);
    }
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
        `[GameManager] State: ${this.getStateName(oldState.currentState)} → ${this.getStateName(newState.currentState)}`
      );
    }

    this.emit("state:changed", this.state, oldState);

    // Update scene objects if currentState or currentLevel changed
    if (
      this.sceneManager &&
      (newState.currentState !== oldState.currentState ||
        newState.currentLevel !== oldState.currentLevel)
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

    // Find objects to unload (loaded but no longer match criteria)
    const objectsToUnload = options.preloadOnly
      ? []
      : Array.from(this.loadedScenes).filter((id) => !objectIdsToLoad.has(id));

    // Unload objects
    for (const id of objectsToUnload) {
      this.sceneManager.removeObject(id);
      this.loadedScenes.delete(id);
      console.log(`[GameManager] Unloaded: ${id}`);
    }

    // Filter out already loaded objects
    const newObjects = objectsToLoad.filter(
      (obj) => !this.loadedScenes.has(obj.id)
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

