/**
 * MenuManager.js - MENU SCREENS AND NAVIGATION
 * =============================================================================
 *
 * ROLE: Owns menu DOM container and screen flow. Renders screens (main menu,
 * create/join game, lobby, loading, playing, results, options).
 * Handles showScreen(), gamepad/keyboard focus, keybind/volume UI, network events.
 *
 * KEY RESPONSIBILITIES:
 * - showScreen(screenId): swap content via screen render functions; hide/show game canvas
 * - renderMainMenu, renderCreateGame, renderJoinGame, renderLobby, renderLoading, etc.
 * - Focus management (menuFocus); network listeners (menuNetwork); StartScreenScene for 3D menu
 * - KeyBindings/Gamepad rebind UI; AudioSettings sliders; getPerformanceProfile, systemInfo
 *
 * RELATED: StartScreenScene.js, screens/*.js, menuFocus.js, menuNetwork.js,
 * NetworkManager.js, KeyBindings.js, Gamepad.js, AudioSettings.js.
 *
 * =============================================================================
 */

export const SCREENS = {
  INITIAL_LOADING: "initialLoading",
  MAIN_MENU: "mainMenu",
  CAMPAIGN_MISSIONS: "campaignMissions",
  CREATE_GAME: "createGame",
  JOIN_GAME: "joinGame",
  LOBBY: "lobby",
  LOADING: "loading",
  PLAYING: "playing",
  RESULTS: "results",
  OPTIONS: "options",
};

import NetworkManager from "../network/NetworkManager.js";
import { multiplayerMapLevels } from "../data/gameData.js";
import {
  KeyBindings,
  ACTION_LABELS,
  getKeyDisplayName,
  DEFAULT_BINDINGS,
} from "../game/KeyBindings.js";
import {
  GamepadInput,
  GAMEPAD_INPUT_LABELS,
  GAMEPAD_ACTION_LABELS,
} from "../game/Gamepad.js";
import { AudioSettings } from "../game/AudioSettings.js";
import { StartScreenScene } from "./StartScreenScene.js";
import LoadingProgressManager from "./LoadingProgressManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import sfxManager from "../audio/sfxManager.js";
import sfxSounds from "../audio/sfxData.js";
import { getPerformanceProfile } from "../data/performanceSettings.js";
import { DIFFICULTY_PRESETS } from "../data/difficultySettings.js";
import { getSystemInfo } from "../utils/systemInfo.js";
import * as menuFocus from "./menuFocus.js";
import * as menuNetwork from "./menuNetwork.js";
import * as mainMenuScreen from "./screens/mainMenu.js";
import * as createGameScreen from "./screens/createGame.js";
import * as joinGameScreen from "./screens/joinGame.js";
import * as lobbyScreen from "./screens/lobby.js";
import * as loadingScreen from "./screens/loading.js";
import * as playingScreen from "./screens/playing.js";
import * as resultsScreen from "./screens/results.js";
import * as feedbackModalScreen from "./screens/feedbackModal.js";
import { getFeedbackApiBase as resolveFeedbackApiBase } from "./feedbackApiBase.js";

function preloadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const decodePromise =
        typeof img.decode === "function" ? img.decode() : Promise.resolve();
      decodePromise.then(resolve).catch(resolve);
    };
    img.onerror = () => reject(new Error(`Failed to preload image: ${src}`));
    img.src = src;
  });
}

class MenuManager {
  constructor() {
    this.currentScreen = SCREENS.MAIN_MENU;
    this.container = null;
    this.eventListeners = {};
    this.playerName =
      localStorage.getItem("starspeed_callsign") ||
      `Pilot_${Math.floor(Math.random() * 9999)}`;
    this.roomList = [];
    this.refreshInterval = null;

    this.focusIndex = 0;
    this.focusableElements = [];
    this.lastNavTime = 0;
    this.navCooldown = 150;
    this.gamepadPollInterval = null;

    this.startScene = null;

    // Chat state
    this.chatMessages = [];
    this.mutedPlayers = new Set(
      JSON.parse(localStorage.getItem("starspeed_muted") || "[]"),
    );
    this.maxChatMessages = 50;
    this.initialLoadingTracker = new LoadingProgressManager();
    this.activeLoadingTracker = null;
    this.matchmakingMessage = "";
    this.backgroundOnlyLoading = false;
  }

  async init() {
    this.container = document.getElementById("menu-container");
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.id = "menu-container";
      document.body.appendChild(this.container);
    }

    this.menuBg = document.createElement("div");
    this.menuBg.id = "menu-background";
    this.container.appendChild(this.menuBg);
    this.menuContent = document.createElement("div");
    this.menuContent.id = "menu-content";
    this.container.appendChild(this.menuContent);

    this.bindInitialLoadingTracker(this.initialLoadingTracker);

    this.startScene = new StartScreenScene();
    this.initialLoadingTracker.reset();
    this.initialLoadingTracker.registerTask("main-menu-logo");
    const mainMenuLogoPromise = preloadImage(
      "/images/ui/Starspeed_WordMark.png",
    )
      .catch((error) => {
        console.warn("[MenuManager] Main menu logo preload failed:", error);
      })
      .finally(() => {
        this.initialLoadingTracker.completeTask("main-menu-logo");
      });
    await Promise.all([
      this.startScene.init(this.menuBg, this.initialLoadingTracker),
      mainMenuLogoPromise,
    ]);
    this.clearLoadingTracker(this.initialLoadingTracker);

    this.currentScreen = SCREENS.MAIN_MENU;
    this.render();
    window.dispatchEvent(new Event("app-ready"));
    sfxManager.init(sfxSounds);

    const initAudio = () => {
      proceduralAudio.unlockFromUserGesture();
      document.removeEventListener("click", initAudio);
      document.removeEventListener("keydown", initAudio);
    };
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("keydown", initAudio, { once: true });

    menuNetwork.setupNetworkListeners(this);
    menuFocus.init(this);
    this.container.addEventListener("click", (e) =>
      this.onMenuContainerClick(e),
    );
    this.container.addEventListener("mousedown", (e) =>
      this.onMenuContainerMouseDown(e),
    );
    this.render();
    setTimeout(() => menuFocus.resetFocus(this), 100);

    menuNetwork.checkJoinUrl(this);
  }

  onMenuContainerMouseDown(e) {
    if (e.button !== 2) return;
    if (this.currentScreen !== SCREENS.MAIN_MENU) return;
    if (document.body.classList.contains("video-main-menu")) {
      e.preventDefault();
      return;
    }
    if (
      e.target.closest(
        "a, button, input, select, textarea, [data-action], [role='button']",
      )
    )
      return;
    e.preventDefault();
    this.startScene?.triggerMissile();
  }

  onMenuContainerClick(e) {
    if (this.currentScreen !== SCREENS.MAIN_MENU) return;
    if (
      e.target.closest(
        "a, button, input, select, textarea, [data-action], [role='button']",
      )
    )
      return;
    if (e.button === 0) this.startScene?.triggerFire();
  }

  navigateFocus(direction) {
    menuFocus.navigateFocus(this, direction);
  }

  updateFocusableElements() {
    menuFocus.updateFocusableElements(this);
  }

  updateFocus() {
    menuFocus.updateFocus(this);
  }

  activateFocused() {
    menuFocus.activateFocused(this);
  }

  handleMenuBack() {
    menuFocus.handleMenuBack(this);
  }

  resetFocus() {
    menuFocus.resetFocus(this);
  }

  async checkJoinUrl() {
    return menuNetwork.checkJoinUrl(this);
  }

  saveCallsign(name) {
    menuNetwork.saveCallsign(this, name);
  }

  async joinByCode(code) {
    this.showLoading("Joining...");
    return menuNetwork.joinByCode(this, code);
  }

  async refreshRoomList() {
    return menuNetwork.refreshRoomList(this);
  }

  startRefreshing() {
    menuNetwork.startRefreshing(this);
  }

  stopRefreshing() {
    menuNetwork.stopRefreshing(this);
  }

  showKickedModal() {
    menuNetwork.showKickedModal(this);
  }

  showError(message) {
    menuNetwork.showError(this, message);
  }

  showScreen(screen) {
    if (screen !== SCREENS.MAIN_MENU) {
      this.matchmakingMessage = "";
    }
    if (screen !== SCREENS.LOADING && this._loadingRampId) {
      clearInterval(this._loadingRampId);
      this._loadingRampId = null;
    }
    this.currentScreen = screen;
    if (screen !== SCREENS.LOADING && screen !== SCREENS.INITIAL_LOADING) {
      this.backgroundOnlyLoading = false;
    }

    this.syncStartSceneState();

    this.render();
    setTimeout(() => this.resetFocus(), 50);
  }

  async _rebuildStartScene() {
    if (this.startScene || this._startSceneInitPromise || !this.menuBg) return;
    const scene = new StartScreenScene();
    this._startSceneInitPromise = scene
      .init(this.menuBg)
      .then(() => {
        this.startScene = scene;
        this.syncStartSceneState();
      })
      .catch((error) => {
        console.warn("[Menu] Start scene rebuild failed:", error);
        scene.dispose();
      })
      .finally(() => {
        this._startSceneInitPromise = null;
      });
    await this._startSceneInitPromise;
  }

  syncStartSceneState() {
    const showScene =
      this.currentScreen === SCREENS.INITIAL_LOADING ||
      this.currentScreen === SCREENS.MAIN_MENU ||
      this.currentScreen === SCREENS.CAMPAIGN_MISSIONS ||
      this.currentScreen === SCREENS.CREATE_GAME ||
      this.currentScreen === SCREENS.JOIN_GAME ||
      this.currentScreen === SCREENS.LOADING ||
      this.currentScreen === SCREENS.OPTIONS;

    if (!this.startScene) {
      if (showScene) void this._rebuildStartScene();
      return;
    }

    this.startScene.setLoadingBackgroundOnly(
      this.backgroundOnlyLoading ||
        this.currentScreen === SCREENS.INITIAL_LOADING,
    );

    if (showScene) {
      this.startScene.resume();
      if (this.startScene.renderer) {
        this.startScene.renderer.domElement.style.display = "block";
      }
      return;
    }

    this.startScene.pause();
    if (this.startScene.renderer) {
      this.startScene.renderer.domElement.style.display = "none";
    }
  }

  showLoading(message = "LOADING LEVEL...") {
    this.backgroundOnlyLoading = false;
    this.loadingMessage = message;
    if (this._loadingRampId) {
      clearInterval(this._loadingRampId);
      this._loadingRampId = null;
    }
    this.showScreen(SCREENS.LOADING);
  }

  showBackgroundLoading() {
    this.backgroundOnlyLoading = true;
    this.showScreen(SCREENS.LOADING);
  }

  showMatchmakingModal(message = "Finding match...") {
    this.matchmakingMessage = message;
    if (
      this.currentScreen === SCREENS.MAIN_MENU ||
      this.currentScreen === SCREENS.CREATE_GAME ||
      this.currentScreen === SCREENS.JOIN_GAME
    ) {
      this.render();
      setTimeout(() => this.resetFocus(), 50);
    }
  }

  hideMatchmakingModal() {
    if (!this.matchmakingMessage) return;
    this.matchmakingMessage = "";
    if (
      this.currentScreen === SCREENS.MAIN_MENU ||
      this.currentScreen === SCREENS.CREATE_GAME ||
      this.currentScreen === SCREENS.JOIN_GAME
    ) {
      this.render();
      setTimeout(() => this.resetFocus(), 50);
    }
  }

  bindInitialLoadingTracker(tracker) {
    if (!tracker) return;
    this.clearLoadingTracker();
    this.activeLoadingTracker = tracker;
    tracker.setCallbacks({
      onProgress: (progress) => this.updateInitialLoadProgress(progress),
    });
    this.currentScreen = SCREENS.INITIAL_LOADING;
    this.render();
  }

  bindLoadingTracker(tracker, message = "LOADING LEVEL...") {
    if (!tracker) return;
    this.clearLoadingTracker();
    this.loadingMessage = message;
    this.activeLoadingTracker = tracker;
    tracker.setCallbacks({
      onProgress: (progress) => this.updateLoadingProgress(progress),
    });
    this.showScreen(SCREENS.LOADING);
  }

  clearLoadingTracker(tracker = this.activeLoadingTracker) {
    if (!tracker) return;
    tracker.clearCallbacks();
    if (this.activeLoadingTracker === tracker) {
      this.activeLoadingTracker = null;
    }
  }

  updateInitialLoadProgress(progress) {
    const progressBar = document.querySelector(
      ".initial-loading-screen .loading-progress-fill",
    );
    const progressText = document.querySelector(
      ".initial-loading-screen .loading-progress-text",
    );
    const pct = Math.round(progress * 100);
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `${pct}%`;
    window.dispatchEvent(
      new CustomEvent("app-initial-load-progress", {
        detail: { progress },
      }),
    );
  }

  updateLoadingProgress(progress) {
    const root = document.querySelector(".loading-screen");
    if (!root) return;
    const progressBar = root.querySelector(".loading-progress-fill");
    const progressText = root.querySelector(".loading-progress-text");
    const pct = Math.round(progress * 100);
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `${pct}%`;
  }

  loadingComplete() {
    if (this._loadingRampId) {
      clearInterval(this._loadingRampId);
      this._loadingRampId = null;
    }
    if (this.currentScreen === SCREENS.LOADING) {
      this.updateLoadingProgress(1);
      this.showScreen(SCREENS.PLAYING);
      this.emit("gameStart");
    }
  }

  enterPlayingMode() {
    this.backgroundOnlyLoading = false;
    this.currentScreen = SCREENS.PLAYING;
    this.render();
    this.hide();
  }

  render() {
    if (!this.container) return;

    switch (this.currentScreen) {
      case SCREENS.INITIAL_LOADING:
        loadingScreen.renderInitialLoading(this);
        break;
      case SCREENS.MAIN_MENU:
        this.renderMainMenu();
        break;
      case SCREENS.CAMPAIGN_MISSIONS:
        this.renderCampaignMissions();
        break;
      case SCREENS.CREATE_GAME:
        this.renderCreateGame();
        break;
      case SCREENS.JOIN_GAME:
        this.renderJoinGame();
        break;
      case SCREENS.LOBBY:
        this.renderLobby();
        break;
      case SCREENS.LOADING:
        this.renderLoading();
        break;
      case SCREENS.PLAYING:
        this.renderPlaying();
        break;
      case SCREENS.RESULTS:
        this.renderResults();
        break;
      case SCREENS.OPTIONS:
        this.renderOptions();
        break;
    }
  }

  renderMainMenu() {
    mainMenuScreen.renderMainMenu(this);
  }

  renderCampaignMissions() {
    mainMenuScreen.renderCampaignMissions(this);
  }

  showFeedbackModal(options = {}) {
    feedbackModalScreen.showFeedbackModal(this, options);
  }

  renderCreateGame() {
    createGameScreen.renderCreateGame(this);
  }

  renderJoinGame() {
    joinGameScreen.renderJoinGame(this);
  }

  addChatMessage(data) {
    lobbyScreen.addChatMessage(this, data);
  }

  updateChatDisplay() {
    lobbyScreen.updateChatDisplay(this);
  }

  escapeHtml(text) {
    return lobbyScreen.escapeHtml(text);
  }

  sendChatMessage() {
    lobbyScreen.sendChatMessage(this);
  }

  toggleMute(sessionId) {
    lobbyScreen.toggleMute(this, sessionId);
  }

  renderLobby() {
    lobbyScreen.renderLobby(this);
  }

  renderLoading() {
    loadingScreen.renderLoading(this);
  }

  renderPlaying() {
    playingScreen.renderPlaying(this);
  }

  renderResults() {
    resultsScreen.renderResults(this);
  }

  getFeedbackApiBase() {
    return resolveFeedbackApiBase();
  }

  renderOptions(returnScreen = null) {
    this.optionsReturnScreen =
      returnScreen || this.lastScreen || SCREENS.MAIN_MENU;
    this.optionsSection = this.optionsSection || "graphics";
    const isMobile = window.gameManager?.state?.isMobile;
    if (isMobile && this.optionsSection === "controls")
      this.optionsSection = "gameplay";

    const controlsBtn = !isMobile
      ? `
            <button class="sidebar-btn ${this.optionsSection === "controls" ? "active" : ""}" data-section="controls">
              <span class="sidebar-icon">⌨</span> CONTROLS
            </button>`
      : "";

    this.menuContent.innerHTML = `
      <div class="menu-screen options-menu">
        <div class="menu-header">
          <button class="back-btn" id="btn-back">← BACK</button>
          <h2>OPTIONS</h2>
        </div>
        <div class="options-layout">
          <div class="options-sidebar">
            <button class="sidebar-btn ${this.optionsSection === "graphics" ? "active" : ""}" data-section="graphics">
              <span class="sidebar-icon">🖥</span> GRAPHICS
            </button>
            <button class="sidebar-btn ${this.optionsSection === "gameplay" ? "active" : ""}" data-section="gameplay">
              <span class="sidebar-icon">🎮</span> GAMEPLAY
            </button>
            ${controlsBtn}
            <button class="sidebar-btn ${this.optionsSection === "sound" ? "active" : ""}" data-section="sound">
              <span class="sidebar-icon">🔊</span> SOUND
            </button>
          </div>
          <div class="options-main">
            ${this.renderOptionsSection()}
          </div>
        </div>
      </div>
      
      <div class="rebind-modal" id="rebind-modal" style="display:none;">
        <div class="rebind-content">
          <h3>PRESS A KEY</h3>
          <p id="rebind-action-name"></p>
          <p class="rebind-hint">Press ESC to cancel</p>
        </div>
      </div>
    `;

    document.getElementById("btn-back").addEventListener("click", () => {
      this.showScreen(this.optionsReturnScreen);
    });

    document.querySelectorAll(".sidebar-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.optionsSection = btn.dataset.section;
        this.renderOptions(this.optionsReturnScreen);
      });
    });

    this.setupOptionsSectionListeners();
    this.startGamepadStatusPolling();
  }

  renderOptionsSection() {
    if (this.optionsSection === "gameplay") {
      return this.renderGameplaySection();
    } else if (this.optionsSection === "controls") {
      return this.renderControlsSection();
    } else if (this.optionsSection === "sound") {
      return this.renderSoundSection();
    } else if (this.optionsSection === "graphics") {
      return this.renderGraphicsSection();
    }
    return "";
  }

  renderGameplaySection() {
    const gm = window.gameManager;
    const lookSensitivity = gm?.getLookSensitivity?.() ?? 0.65;
    const shipAutoLevel = gm?.getShipAutoLeveling?.() !== false;
    const captionsEnabled = gm?.getCaptionsEnabled?.() !== false;
    const currentDifficulty = gm?.getDifficultyKey?.() || "normal";
    const difficulties = Object.keys(DIFFICULTY_PRESETS);

    return `
      <div class="options-section gameplay-section">
        <h3>GAMEPLAY</h3>
        <div class="keybind-row" style="grid-template-columns: 1fr 1fr;">
          <span class="keybind-action">Difficulty</span>
          <select id="difficulty-select" class="preset-select">
            ${difficulties.map((d) => `<option value="${d}" ${d === currentDifficulty ? "selected" : ""}>${DIFFICULTY_PRESETS[d].label.toUpperCase()}</option>`).join("")}
          </select>
        </div>
        <p class="options-hint" style="margin-top: 8px; opacity: 0.5; font-size: 12px;">
          Changes player survivability, enemy pressure, and allied wingman support. Takes effect on next mission.
        </p>
        <div class="keybind-row" style="grid-template-columns: 1fr 1fr;">
          <span class="keybind-action">Look Sensitivity <span id="look-sensitivity-val" style="opacity:0.5">${lookSensitivity.toFixed(2)}</span></span>
          <input type="range" id="look-sensitivity" class="options-slider" min="0" max="1" step="0.05" value="${lookSensitivity}">
        </div>
        <p class="options-hint" style="margin-top: 8px; opacity: 0.5; font-size: 12px;">
          Affects mouse, gamepad, keyboard, and mobile look. 0.65 ≈ default; 0.8 ≈ previous “normal.” 1.0 = stronger.
        </p>
        <div class="keybind-row" style="grid-template-columns: 1fr 1fr; margin-top: 20px;">
          <span class="keybind-action">SHIP AUTO-LEVEL</span>
          <label class="toggle-switch">
            <input type="checkbox" id="ship-auto-level-toggle" ${shipAutoLevel ? "checked" : ""}>
            <span class="toggle-label" id="ship-auto-level-toggle-label">${shipAutoLevel ? "ON" : "OFF"}</span>
          </label>
        </div>
        <p class="options-hint" style="margin-top: 8px; opacity: 0.5; font-size: 12px;">
          When on, roll gently settles to the nearest 90° bank relative to level (Descent-style). Turn off for fully free roll.
        </p>
        <div class="keybind-row" style="grid-template-columns: 1fr 1fr; margin-top: 20px;">
          <span class="keybind-action">CAPTIONS</span>
          <label class="toggle-switch">
            <input type="checkbox" id="captions-toggle" ${captionsEnabled ? "checked" : ""}>
            <span class="toggle-label" id="captions-toggle-label">${captionsEnabled ? "ON" : "OFF"}</span>
          </label>
        </div>
        <p class="options-hint" style="margin-top: 8px; opacity: 0.5; font-size: 12px;">
          Show on-screen text for mission dialog and tutorials. Audio still plays when off.
        </p>
      </div>
    `;
  }

  renderGraphicsSection() {
    const gm = window.gameManager;
    const currentProfile = gm?.state?.performanceProfile || "medium";
    const profiles = ["low", "medium", "high", "max"];
    const antialiasingEnabled = gm?.getSetting("antialiasingEnabled") !== false;

    return `
      <div class="options-section graphics-section">
        <h3>GRAPHICS</h3>
        <div class="keybind-row" style="grid-template-columns: 1fr 1fr;">
          <span class="keybind-action">Performance Mode</span>
          <select id="perf-profile-select" class="preset-select">
            ${profiles.map((p) => `<option value="${p}" ${p === currentProfile ? "selected" : ""}>${p.toUpperCase()}</option>`).join("")}
          </select>
        </div>
        <p class="options-hint" style="margin-top: 12px; opacity: 0.5; font-size: 12px;">
          Changes particle counts, shadow quality, and render resolution. Takes effect on next match.
        </p>

        <div class="keybind-row" style="grid-template-columns: 1fr 1fr; margin-top: 20px;">
          <span class="keybind-action">ANTIALIASING (FXAA)</span>
          <label class="toggle-switch">
            <input type="checkbox" id="antialiasing-toggle" ${antialiasingEnabled ? "checked" : ""}>
            <span class="toggle-label" id="antialiasing-toggle-label">${antialiasingEnabled ? "ON" : "OFF"}</span>
          </label>
        </div>
      </div>
    `;
  }

  renderControlsSection() {
    const bindings = KeyBindings.getAllBindings();
    const presets = KeyBindings.getPresetNames();
    const gpBindings = GamepadInput.getBindings();
    const gpConnected = GamepadInput.connected;
    const isHotas = GamepadInput.isHotas;
    const activeTab =
      this.optionsTab ||
      (isHotas ? "hotas" : gpConnected ? "gamepad" : "keyboard");

    const HOTAS_ACTION_LABELS = {
      lookX: "Yaw (Left/Right)",
      lookY: "Pitch (Up/Down)",
      moveY: "Throttle (Fwd/Back)",
      rollAxis: "Roll (Twist)",
      fire: "Fire Lasers",
      missile: "Fire Missiles",
      boost: "Boost",
      strafeUp: "Strafe Up",
      strafeDown: "Strafe Down",
      strafeLeft: "Strafe Left",
      strafeRight: "Strafe Right",
      pause: "Pause Menu",
    };

    const HOTAS_INPUT_LABELS = {
      leftStickX: "Stick X",
      leftStickY: "Stick Y",
      throttle: "Throttle Axis",
      twist: "Twist Axis",
      buttonA: "Trigger",
      buttonB: "Button 1",
      buttonX: "Button 2",
      buttonY: "Button 3",
      button4: "Button 4",
      button5: "Button 5",
      button6: "Button 6",
      button7: "Button 7",
      button8: "Button 8",
      button9: "Button 9",
      button10: "Button 10",
      button11: "Button 11",
      povUp: "POV Up",
      povDown: "POV Down",
      povLeft: "POV Left",
      povRight: "POV Right",
      start: "Start",
      back: "Back",
    };

    return `
      <div class="options-tabs">
        <button class="options-tab ${activeTab === "keyboard" ? "active" : ""}" data-tab="keyboard">
          KEYBOARD
        </button>
        <button class="options-tab ${activeTab === "gamepad" ? "active" : ""}" data-tab="gamepad">
          GAMEPAD <span class="tab-status ${gpConnected && !isHotas ? "connected" : ""}" id="gamepad-tab-status">${gpConnected && !isHotas ? "●" : "○"}</span>
        </button>
        <button class="options-tab ${activeTab === "hotas" ? "active" : ""}" data-tab="hotas">
          HOTAS <span class="tab-status ${isHotas ? "connected" : ""}" id="hotas-tab-status">${isHotas ? "●" : "○"}</span>
        </button>
      </div>
      
      <div class="options-tab-content ${activeTab === "keyboard" ? "active" : ""}" data-tab="keyboard">
        <div class="options-section">
          <div class="options-header-row">
            <div class="preset-controls">
              <select id="preset-select" class="menu-select preset-select">
                ${presets.map((p) => `<option value="${p}" ${p === KeyBindings.activePreset ? "selected" : ""}>${p.toUpperCase()}${p === "custom" ? " *" : ""}</option>`).join("")}
              </select>
              <button class="options-btn" id="btn-save-preset" title="Save current as new preset" ${!KeyBindings.isCustom() ? "disabled" : ""}>SAVE AS</button>
              <button class="options-btn danger" id="btn-delete-preset" title="Delete selected preset" ${KeyBindings.activePreset === "default" || KeyBindings.activePreset === "custom" ? "disabled" : ""}>DELETE</button>
            </div>
          </div>
          <div class="keybind-list">
            ${Object.keys(ACTION_LABELS)
              .map(
                (action) => `
              <div class="keybind-row" data-action="${action}">
                <span class="keybind-action">${ACTION_LABELS[action]}</span>
                <div class="keybind-keys">
                  ${bindings[action] ? `<span class="keybind-key">${getKeyDisplayName(Array.isArray(bindings[action]) ? bindings[action][0] : bindings[action])}</span>` : '<span class="keybind-unset">UNBOUND</span>'}
                </div>
                <button class="rebind-btn" data-action="${action}">REBIND</button>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      </div>
      
      <div class="options-tab-content ${activeTab === "gamepad" ? "active" : ""}" data-tab="gamepad">
        <div class="options-section">
          <div class="options-header-row">
            <div class="preset-controls gamepad-preset-controls">
              <select id="gamepad-preset-select" class="menu-select preset-select">
                ${["default", "custom"].map((p) => `<option value="${p}" ${p === GamepadInput.activePreset ? "selected" : ""}>${p.toUpperCase()}${p === "custom" ? " *" : ""}</option>`).join("")}
              </select>
              <button class="options-btn" id="btn-save-gamepad-preset" title="Save current as new preset" ${!GamepadInput.isCustom() ? "disabled" : ""}>SAVE AS</button>
            </div>
            <span class="gamepad-status ${gpConnected && !isHotas ? "connected" : ""}" id="gamepad-status">${gpConnected && !isHotas ? "● CONNECTED" : "○ NOT DETECTED"}</span>
          </div>
          <div class="keybind-list gamepad-list">
            ${Object.keys(GAMEPAD_ACTION_LABELS)
              .map((action) => {
                const input = Object.entries(gpBindings).find(
                  ([, a]) => a === action,
                )?.[0];
                return `
              <div class="keybind-row gamepad-row" data-action="${action}">
                <span class="keybind-action">${GAMEPAD_ACTION_LABELS[action]}</span>
                <span class="gamepad-input ${!input ? "unbound" : ""}">${input ? GAMEPAD_INPUT_LABELS[input] || input : "UNBOUND"}</span>
                <button class="rebind-btn gamepad-rebind-btn" data-action="${action}">REBIND</button>
              </div>
            `;
              })
              .join("")}
          </div>
          <p class="gamepad-hint">Gamepad auto-switches when input is detected</p>
        </div>
      </div>
      
      <div class="options-tab-content ${activeTab === "hotas" ? "active" : ""}" data-tab="hotas">
        <div class="options-section">
          <div class="options-header-row">
            <div class="preset-controls hotas-preset-controls">
              <select id="hotas-preset-select" class="menu-select preset-select">
                ${["hotas", "custom"].map((p) => `<option value="${p}" ${p === GamepadInput.activePreset ? "selected" : ""}>${p.toUpperCase()}${p === "custom" ? " *" : ""}</option>`).join("")}
              </select>
              <button class="options-btn" id="btn-save-hotas-preset" title="Save current as new preset" ${GamepadInput.activePreset !== "custom" ? "disabled" : ""}>SAVE AS</button>
            </div>
            <span class="gamepad-status ${isHotas ? "connected" : ""}" id="hotas-status">${isHotas ? "● CONNECTED" : "○ NOT DETECTED"}</span>
          </div>
          <div class="hotas-scroll-container">
            <h4 class="hotas-section-title">AXES</h4>
            <div class="keybind-list hotas-list">
              ${["lookX", "lookY", "moveY", "rollAxis"]
                .map((action) => {
                  const input = Object.entries(gpBindings).find(
                    ([, a]) => a === action,
                  )?.[0];
                  return `
                <div class="keybind-row hotas-row">
                  <span class="keybind-action">${HOTAS_ACTION_LABELS[action]}</span>
                  <span class="gamepad-input ${!input ? "unbound" : ""}">${input ? HOTAS_INPUT_LABELS[input] || input : "UNBOUND"}</span>
                </div>
              `;
                })
                .join("")}
            </div>
            <h4 class="hotas-section-title">BUTTONS</h4>
            <div class="keybind-list hotas-list">
              ${["fire", "missile", "boost", "pause"]
                .map((action) => {
                  const input = Object.entries(gpBindings).find(
                    ([, a]) => a === action,
                  )?.[0];
                  return `
                <div class="keybind-row hotas-row" data-action="${action}">
                  <span class="keybind-action">${HOTAS_ACTION_LABELS[action]}</span>
                  <span class="gamepad-input ${!input ? "unbound" : ""}">${input ? HOTAS_INPUT_LABELS[input] || input : "UNBOUND"}</span>
                  <button class="rebind-btn hotas-rebind-btn" data-action="${action}">REBIND</button>
                </div>
              `;
                })
                .join("")}
            </div>
            <h4 class="hotas-section-title">STRAFING</h4>
            <div class="keybind-list hotas-list">
              ${["strafeUp", "strafeDown", "strafeLeft", "strafeRight"]
                .map((action) => {
                  const input = Object.entries(gpBindings).find(
                    ([, a]) => a === action,
                  )?.[0];
                  return `
                <div class="keybind-row hotas-row" data-action="${action}">
                  <span class="keybind-action">${HOTAS_ACTION_LABELS[action]}</span>
                  <span class="gamepad-input ${!input ? "unbound" : ""}">${input ? HOTAS_INPUT_LABELS[input] || "POV Hat" : "POV HAT"}</span>
                  <button class="rebind-btn hotas-rebind-btn" data-action="${action}">REBIND</button>
                </div>
              `;
                })
                .join("")}
            </div>
            <p class="gamepad-hint">POV hat provides 8-directional strafing by default</p>
          </div>
        </div>
      </div>
    `;
  }

  renderSoundSection() {
    const musicVol = Math.round(AudioSettings.get("musicVolume") * 100);
    const sfxVol = Math.round(AudioSettings.get("sfxVolume") * 100);

    return `
      <div class="options-section sound-section">
        <h3 class="section-title">AUDIO SETTINGS</h3>
        
        <div class="volume-control">
          <label for="music-volume">MUSIC VOLUME</label>
          <div class="slider-row">
            <input type="range" id="music-volume" min="0" max="100" value="${musicVol}" class="volume-slider" />
            <span class="volume-value" id="music-value">${musicVol}%</span>
          </div>
        </div>
        
        <div class="volume-control">
          <label for="sfx-volume">SFX VOLUME</label>
          <div class="slider-row">
            <input type="range" id="sfx-volume" min="0" max="100" value="${sfxVol}" class="volume-slider" />
            <span class="volume-value" id="sfx-value">${sfxVol}%</span>
          </div>
        </div>
        
        <div class="options-footer">
          <button class="menu-btn secondary" id="btn-reset-audio">RESET TO DEFAULTS</button>
        </div>
      </div>
    `;
  }

  setupGraphicsListeners() {
    const select = document.getElementById("perf-profile-select");
    if (select) {
      select.addEventListener("change", () => {
        const gm = window.gameManager;
        if (gm) {
          gm.setPerformanceProfile(select.value);
        }
      });
    }

    const antialiasingToggle = document.getElementById("antialiasing-toggle");
    if (antialiasingToggle) {
      antialiasingToggle.addEventListener("change", () => {
        const enabled = antialiasingToggle.checked;
        const label = document.getElementById("antialiasing-toggle-label");
        if (label) label.textContent = enabled ? "ON" : "OFF";
        if (window.gameManager) {
          window.gameManager.setSetting("antialiasingEnabled", enabled);
          window.gameManager.emit("antialiasing:changed", enabled);
        }
      });
    }
  }

  setupOptionsSectionListeners() {
    if (this.optionsSection === "gameplay") {
      this.setupGameplayListeners();
    } else if (this.optionsSection === "controls") {
      this.setupControlsListeners();
    } else if (this.optionsSection === "sound") {
      this.setupSoundListeners();
    } else if (this.optionsSection === "graphics") {
      this.setupGraphicsListeners();
    }
  }

  setupGameplayListeners() {
    const difficultySelect = document.getElementById("difficulty-select");
    if (difficultySelect) {
      difficultySelect.addEventListener("change", () => {
        window.gameManager?.setDifficulty?.(difficultySelect.value);
      });
    }

    const slider = document.getElementById("look-sensitivity");
    const valSpan = document.getElementById("look-sensitivity-val");
    if (slider) {
      slider.addEventListener("input", () => {
        const val = parseFloat(slider.value);
        if (valSpan) valSpan.textContent = val.toFixed(2);
        window.gameManager?.setSetting("lookSensitivity", val);
      });
    }

    const shipToggle = document.getElementById("ship-auto-level-toggle");
    if (shipToggle) {
      shipToggle.addEventListener("change", () => {
        const enabled = shipToggle.checked;
        const label = document.getElementById("ship-auto-level-toggle-label");
        if (label) label.textContent = enabled ? "ON" : "OFF";
        window.gameManager?.setShipAutoLeveling?.(enabled);
      });
    }

    const captionsToggle = document.getElementById("captions-toggle");
    if (captionsToggle) {
      captionsToggle.addEventListener("change", () => {
        const enabled = captionsToggle.checked;
        const label = document.getElementById("captions-toggle-label");
        if (label) label.textContent = enabled ? "ON" : "OFF";
        window.gameManager?.setCaptionsEnabled?.(enabled);
      });
    }
  }

  setupControlsListeners() {
    document.querySelectorAll(".options-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        this.optionsTab = tab.dataset.tab;
        document
          .querySelectorAll(".options-tab")
          .forEach((t) =>
            t.classList.toggle("active", t.dataset.tab === this.optionsTab),
          );
        document
          .querySelectorAll(".options-tab-content")
          .forEach((c) =>
            c.classList.toggle("active", c.dataset.tab === this.optionsTab),
          );
      });
    });

    document
      .getElementById("preset-select")
      ?.addEventListener("change", (e) => {
        KeyBindings.loadPreset(e.target.value);
        this.renderOptions(this.optionsReturnScreen);
      });

    document
      .getElementById("btn-save-preset")
      ?.addEventListener("click", () => {
        const name = prompt("Enter preset name:");
        if (name && name.trim()) {
          KeyBindings.savePreset(name.trim().toLowerCase());
          this.renderOptions(this.optionsReturnScreen);
        }
      });

    document
      .getElementById("btn-delete-preset")
      ?.addEventListener("click", () => {
        if (
          KeyBindings.activePreset !== "default" &&
          KeyBindings.activePreset !== "custom"
        ) {
          if (confirm(`Delete preset "${KeyBindings.activePreset}"?`)) {
            KeyBindings.deletePreset(KeyBindings.activePreset);
            KeyBindings.loadPreset("default");
            this.renderOptions(this.optionsReturnScreen);
          }
        }
      });

    document
      .getElementById("gamepad-preset-select")
      ?.addEventListener("change", (e) => {
        GamepadInput.loadPreset(e.target.value);
        this.renderOptions(this.optionsReturnScreen);
      });

    document
      .getElementById("btn-save-gamepad-preset")
      ?.addEventListener("click", () => {
        const name = prompt("Enter preset name:");
        if (name && name.trim()) {
          GamepadInput.saveAsPreset(name.trim().toLowerCase());
          this.renderOptions(this.optionsReturnScreen);
        }
      });

    document
      .getElementById("btn-delete-gamepad-preset")
      ?.addEventListener("click", () => {
        if (
          GamepadInput.activePreset !== "default" &&
          GamepadInput.activePreset !== "custom"
        ) {
          if (confirm(`Delete preset "${GamepadInput.activePreset}"?`)) {
            GamepadInput.deletePreset(GamepadInput.activePreset);
            this.renderOptions(this.optionsReturnScreen);
          }
        }
      });

    document.querySelectorAll(".rebind-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        this.startRebinding(action);
      });
    });
  }

  setupSoundListeners() {
    const musicSlider = document.getElementById("music-volume");
    const sfxSlider = document.getElementById("sfx-volume");
    const musicValue = document.getElementById("music-value");
    const sfxValue = document.getElementById("sfx-value");

    musicSlider?.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      AudioSettings.setMusicVolume(val / 100);
      musicValue.textContent = `${val}%`;
    });

    sfxSlider?.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      AudioSettings.setSfxVolume(val / 100);
      sfxValue.textContent = `${val}%`;
    });

    document
      .getElementById("btn-reset-audio")
      ?.addEventListener("click", () => {
        if (confirm("Reset audio settings to defaults?")) {
          AudioSettings.resetToDefault();
          this.renderOptions(this.optionsReturnScreen);
        }
      });
  }

  startGamepadStatusPolling() {
    if (this.gamepadStatusInterval) {
      clearInterval(this.gamepadStatusInterval);
    }

    this.gamepadStatusInterval = setInterval(() => {
      if (this.currentScreen !== SCREENS.OPTIONS) {
        clearInterval(this.gamepadStatusInterval);
        this.gamepadStatusInterval = null;
        return;
      }

      GamepadInput.poll();
      const connected = GamepadInput.connected;

      const statusEl = document.getElementById("gamepad-status");
      const tabStatusEl = document.getElementById("gamepad-tab-status");

      if (statusEl) {
        statusEl.className = `gamepad-status ${connected ? "connected" : ""}`;
        statusEl.textContent = connected ? "● CONNECTED" : "○ NOT DETECTED";
      }
      if (tabStatusEl) {
        tabStatusEl.className = `tab-status ${connected ? "connected" : ""}`;
        tabStatusEl.textContent = connected ? "●" : "○";
      }
    }, 500);
  }

  startRebinding(action) {
    const modal = document.getElementById("rebind-modal");
    document.getElementById("rebind-action-name").textContent =
      ACTION_LABELS[action];
    modal.style.display = "flex";

    const handleKey = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === "Escape") {
        modal.style.display = "none";
        document.removeEventListener("keydown", handleKey, true);
        return;
      }

      KeyBindings.setBinding(action, e.code);
      modal.style.display = "none";
      document.removeEventListener("keydown", handleKey, true);
      this.renderOptions(this.optionsReturnScreen);
    };

    document.addEventListener("keydown", handleKey, true);
  }

  showOptionsFromGame(onClose) {
    this.container.classList.remove("hidden");
    this.optionsReturnScreen = null;
    this.onOptionsClose = onClose;
    this.renderOptionsInGame();
  }

  renderOptionsInGame() {
    this.optionsSection = this.optionsSection || "graphics";
    const isMobile = window.gameManager?.state?.isMobile;
    if (isMobile && this.optionsSection === "controls")
      this.optionsSection = "gameplay";

    const controlsBtn = !isMobile
      ? `
            <button class="sidebar-btn ${this.optionsSection === "controls" ? "active" : ""}" data-section="controls">
              <span class="sidebar-icon">⌨</span> CONTROLS
            </button>`
      : "";

    this.menuContent.innerHTML = `
      <div class="menu-screen options-menu in-game">
        <div class="menu-header">
          <button class="back-btn" id="btn-back">← BACK TO GAME</button>
          <h2>OPTIONS</h2>
        </div>
        <div class="options-layout">
          <div class="options-sidebar">
            <button class="sidebar-btn ${this.optionsSection === "graphics" ? "active" : ""}" data-section="graphics">
              <span class="sidebar-icon">🖥</span> GRAPHICS
            </button>
            <button class="sidebar-btn ${this.optionsSection === "gameplay" ? "active" : ""}" data-section="gameplay">
              <span class="sidebar-icon">🎮</span> GAMEPLAY
            </button>
            ${controlsBtn}
            <button class="sidebar-btn ${this.optionsSection === "sound" ? "active" : ""}" data-section="sound">
              <span class="sidebar-icon">🔊</span> SOUND
            </button>
          </div>
          <div class="options-main">
            ${this.renderOptionsSection()}
          </div>
        </div>
      </div>
      
      <div class="rebind-modal" id="rebind-modal" style="display:none;">
        <div class="rebind-content">
          <h3>PRESS A KEY</h3>
          <p id="rebind-action-name"></p>
          <p class="rebind-hint">Press ESC to cancel</p>
        </div>
      </div>
    `;

    document.getElementById("btn-back").addEventListener("click", () => {
      this.closeOptionsInGame();
    });

    document.querySelectorAll(".sidebar-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.optionsSection = btn.dataset.section;
        this.renderOptionsInGame();
      });
    });

    this.setupOptionsSectionListenersInGame();
    this.startGamepadStatusPollingInGame();
  }

  setupOptionsSectionListenersInGame() {
    if (this.optionsSection === "gameplay") {
      this.setupGameplayListeners();
    } else if (this.optionsSection === "controls") {
      this.setupControlsListenersInGame();
    } else if (this.optionsSection === "sound") {
      this.setupSoundListeners();
    } else if (this.optionsSection === "graphics") {
      this.setupGraphicsListeners();
    }
  }

  setupControlsListenersInGame() {
    document.querySelectorAll(".options-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        this.optionsTab = tab.dataset.tab;
        document
          .querySelectorAll(".options-tab")
          .forEach((t) =>
            t.classList.toggle("active", t.dataset.tab === this.optionsTab),
          );
        document
          .querySelectorAll(".options-tab-content")
          .forEach((c) =>
            c.classList.toggle("active", c.dataset.tab === this.optionsTab),
          );
      });
    });

    document
      .getElementById("preset-select")
      ?.addEventListener("change", (e) => {
        KeyBindings.loadPreset(e.target.value);
        this.renderOptionsInGame();
      });

    document
      .getElementById("btn-save-preset")
      ?.addEventListener("click", () => {
        const name = prompt("Enter preset name:");
        if (name && name.trim()) {
          KeyBindings.savePreset(name.trim().toLowerCase());
          this.renderOptionsInGame();
        }
      });

    document
      .getElementById("btn-delete-preset")
      ?.addEventListener("click", () => {
        if (KeyBindings.activePreset !== "default") {
          if (confirm(`Delete preset "${KeyBindings.activePreset}"?`)) {
            KeyBindings.deletePreset(KeyBindings.activePreset);
            KeyBindings.loadPreset("default");
            this.renderOptionsInGame();
          }
        }
      });

    document
      .getElementById("btn-reset-defaults")
      ?.addEventListener("click", () => {
        if (confirm("Reset all bindings to defaults?")) {
          KeyBindings.resetToDefault();
          this.renderOptionsInGame();
        }
      });

    document
      .getElementById("gamepad-preset-select")
      ?.addEventListener("change", (e) => {
        GamepadInput.loadPreset(e.target.value);
        this.renderOptionsInGame();
      });

    document
      .getElementById("btn-save-gamepad-preset")
      ?.addEventListener("click", () => {
        const name = prompt("Enter preset name:");
        if (name && name.trim()) {
          GamepadInput.saveAsPreset(name.trim().toLowerCase());
          this.renderOptionsInGame();
        }
      });

    document
      .getElementById("btn-delete-gamepad-preset")
      ?.addEventListener("click", () => {
        if (
          GamepadInput.activePreset !== "default" &&
          GamepadInput.activePreset !== "custom"
        ) {
          if (confirm(`Delete preset "${GamepadInput.activePreset}"?`)) {
            GamepadInput.deletePreset(GamepadInput.activePreset);
            this.renderOptionsInGame();
          }
        }
      });

    document
      .getElementById("hotas-preset-select")
      ?.addEventListener("change", (e) => {
        GamepadInput.loadPreset(e.target.value);
        this.renderOptionsInGame();
      });

    document
      .getElementById("btn-save-hotas-preset")
      ?.addEventListener("click", () => {
        const name = prompt("Enter preset name:");
        if (name && name.trim()) {
          GamepadInput.saveAsPreset(name.trim().toLowerCase());
          this.renderOptionsInGame();
        }
      });

    document
      .querySelectorAll(".rebind-btn:not(.gamepad-rebind-btn)")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const action = btn.dataset.action;
          this.startRebindingInGame(action);
        });
      });

    document.querySelectorAll(".gamepad-rebind-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        this.startGamepadRebinding(action);
      });
    });

    document.querySelectorAll(".hotas-rebind-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        this.startGamepadRebinding(action); // Use same rebinding logic
      });
    });
  }

  startGamepadRebinding(action) {
    const modal = document.getElementById("rebind-modal");
    document.getElementById("rebind-action-name").textContent =
      GAMEPAD_ACTION_LABELS[action] || action;
    modal.querySelector(".rebind-prompt").textContent =
      "Press a gamepad button...";
    modal.style.display = "flex";

    let pollInterval = null;
    let prevButtons = [];
    let prevAxes = [];

    const cleanup = () => {
      if (pollInterval) clearInterval(pollInterval);
      modal.style.display = "none";
      modal.querySelector(".rebind-prompt").textContent = "Press a key...";
      document.removeEventListener("keydown", handleEscape, true);
    };

    const handleEscape = (e) => {
      if (e.code === "Escape") {
        e.preventDefault();
        cleanup();
      }
    };

    document.addEventListener("keydown", handleEscape, true);

    // Poll for gamepad input
    pollInterval = setInterval(() => {
      GamepadInput.poll();
      const gp = navigator.getGamepads()[GamepadInput.gamepad?.index ?? 0];
      if (!gp) return;

      // Check for button press
      for (let i = 0; i < gp.buttons.length; i++) {
        const wasPressed = prevButtons[i] || false;
        if (gp.buttons[i].pressed && !wasPressed) {
          // Map button index to binding name
          const buttonNames = [
            "buttonA",
            "buttonB",
            "buttonX",
            "buttonY",
            "leftBumper",
            "rightBumper",
            "leftTrigger",
            "rightTrigger",
            "back",
            "start",
            "leftStickPress",
            "rightStickPress",
            "dpadUp",
            "dpadDown",
            "dpadLeft",
            "dpadRight",
          ];
          const bindingName = buttonNames[i] || `button${i}`;

          GamepadInput.setBinding(bindingName, action);
          cleanup();
          this.renderOptionsInGame();
          return;
        }
      }
      prevButtons = gp.buttons.map((b) => b.pressed);

      // Check for significant axis change (for sticks/triggers)
      for (let i = 0; i < gp.axes.length; i++) {
        const prev = prevAxes[i] || 0;
        const curr = gp.axes[i];
        if (Math.abs(curr) > 0.7 && Math.abs(prev) < 0.3) {
          const axisNames = [
            "leftStickX",
            "leftStickY",
            "rightStickX",
            "rightStickY",
          ];
          const bindingName = axisNames[i] || `axis${i}`;

          GamepadInput.setBinding(bindingName, action);
          cleanup();
          this.renderOptionsInGame();
          return;
        }
      }
      prevAxes = [...gp.axes];
    }, 50);
  }

  startGamepadStatusPollingInGame() {
    if (this.gamepadStatusInterval) {
      clearInterval(this.gamepadStatusInterval);
    }

    this.gamepadStatusInterval = setInterval(() => {
      GamepadInput.poll();
      const connected = GamepadInput.connected;

      const statusEl = document.getElementById("gamepad-status");
      const tabStatusEl = document.getElementById("gamepad-tab-status");

      if (statusEl) {
        statusEl.className = `gamepad-status ${connected ? "connected" : ""}`;
        statusEl.textContent = connected ? "● CONNECTED" : "○ NOT DETECTED";
      }
      if (tabStatusEl) {
        tabStatusEl.className = `tab-status ${connected ? "connected" : ""}`;
        tabStatusEl.textContent = connected ? "●" : "○";
      }
    }, 500);
  }

  stopGamepadStatusPolling() {
    if (this.gamepadStatusInterval) {
      clearInterval(this.gamepadStatusInterval);
      this.gamepadStatusInterval = null;
    }
  }

  startRebindingInGame(action) {
    const modal = document.getElementById("rebind-modal");
    document.getElementById("rebind-action-name").textContent =
      ACTION_LABELS[action];
    modal.style.display = "flex";

    const handleKey = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === "Escape") {
        modal.style.display = "none";
        document.removeEventListener("keydown", handleKey, true);
        return;
      }

      KeyBindings.setBinding(action, e.code);
      modal.style.display = "none";
      document.removeEventListener("keydown", handleKey, true);
      this.renderOptionsInGame();
    };

    document.addEventListener("keydown", handleKey, true);
  }

  closeOptionsInGame() {
    this.stopGamepadStatusPolling();
    this.container.classList.add("hidden");
    this.menuContent.innerHTML = "";
    this.onOptionsClose?.();
    this.onOptionsClose = null;
  }

  hideOptions() {
    this.container.classList.add("hidden");
  }

  async createGame(
    roomName,
    mode,
    isPublic,
    killLimit,
    maxPlayers = 8,
    level = "newworld",
    roomCode = null,
    botsEnabled = false,
  ) {
    this.emit("levelSelected", level);
    this.showMatchmakingModal("Creating match...");
    await NetworkManager.connect();
    await NetworkManager.createRoom({
      roomName,
      mode,
      isPublic,
      killLimit,
      maxPlayers,
      level,
      roomId: roomCode,
      playerName: this.playerName,
      botsEnabled,
    });
  }

  async quickMatch() {
    this.showMatchmakingModal("Finding match...");
    await NetworkManager.connect();

    // Check if there are existing public rooms to join
    const rooms = await NetworkManager.getAvailableRooms();
    const publicRooms = rooms.filter(
      (r) => r.metadata?.isPublic && r.clients < (r.metadata?.maxPlayers || 8),
    );

    if (publicRooms.length > 0) {
      // Join existing room - will go to lobby
      await NetworkManager.joinRoom(publicRooms[0].roomId, {
        playerName: this.playerName,
        quickMatch: true,
      });
    } else {
      const pool = multiplayerMapLevels();
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const level = pick?.id || "newworld";
      await NetworkManager.joinOrCreate({
        playerName: this.playerName,
        autoStart: true,
        quickMatch: true,
        level,
        botsEnabled: true,
      });
    }
  }

  show() {
    if (this.container) {
      this.container.classList.remove("hidden");
    }
    // PLAYING uses renderPlaying(), which clears menu HTML and adds .hidden.
    // Without switching screen, syncStartSceneState() keeps the 3D menu paused
    // and hidden while the game canvas is already off → blank window.
    if (this.currentScreen === SCREENS.PLAYING) {
      this.showScreen(SCREENS.MAIN_MENU);
      return;
    }
    this.syncStartSceneState();
  }

  hide() {
    if (this.container) {
      this.container.classList.add("hidden");
    }
    if (!this.startScene) return;

    const gmState = window.gameManager?.state;
    if (gmState?.isMobile || gmState?.isIOS) {
      // Free the menu's whole WebGL context during play; a second live
      // context is dead weight against Safari's tab memory limit. Rebuilt
      // lazily by syncStartSceneState() when the menu returns.
      this.startScene.dispose();
      this.startScene = null;
      return;
    }

    this.startScene.pause();
    if (this.startScene.renderer) {
      this.startScene.renderer.domElement.style.display = "none";
    }
  }

  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  emit(event, data) {
    if (
      event === "trainingGroundsStart" ||
      event === "campaignStart" ||
      event === "gameStart"
    ) {
      proceduralAudio.unlockFromUserGesture();
    }
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach((cb) => cb(data));
    }
  }
}

export default new MenuManager();
