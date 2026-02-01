import NetworkManager from "../network/NetworkManager.js";
import { LEVELS } from "../data/gameData.js";
import { KeyBindings, ACTION_LABELS, getKeyDisplayName, DEFAULT_BINDINGS } from "../game/KeyBindings.js";
import { GamepadInput, GAMEPAD_INPUT_LABELS, GAMEPAD_ACTION_LABELS } from "../game/Gamepad.js";
import { AudioSettings } from "../game/AudioSettings.js";
import { StartScreenScene } from "./StartScreenScene.js";

const SCREENS = {
  MAIN_MENU: "mainMenu",
  CREATE_GAME: "createGame",
  JOIN_GAME: "joinGame",
  LOBBY: "lobby",
  LOADING: "loading",
  PLAYING: "playing",
  RESULTS: "results",
  OPTIONS: "options",
};

class MenuManager {
  constructor() {
    this.currentScreen = SCREENS.MAIN_MENU;
    this.container = null;
    this.eventListeners = {};
    this.playerName = localStorage.getItem("starstrafe_callsign") || `Pilot_${Math.floor(Math.random() * 9999)}`;
    this.roomList = [];
    this.refreshInterval = null;
    
    this.focusIndex = 0;
    this.focusableElements = [];
    this.lastNavTime = 0;
    this.navCooldown = 150;
    this.gamepadPollInterval = null;
    
    this.startScene = null;
  }

  async init() {
    this.container = document.getElementById("menu-container");
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.id = "menu-container";
      document.body.appendChild(this.container);
    }

    // Initialize start screen 3D scene
    this.startScene = new StartScreenScene();
    await this.startScene.init(document.body);

    this.setupNetworkListeners();
    this.setupMenuNavigation();
    this.render();
    setTimeout(() => this.resetFocus(), 100);
    
    // Check for join code in URL
    this.checkJoinUrl();
  }

  setupMenuNavigation() {
    document.addEventListener('keydown', (e) => this.handleMenuKeydown(e));
    this.startGamepadPolling();
  }

  startGamepadPolling() {
    if (this.gamepadPollInterval) return;
    this.gamepadPollInterval = setInterval(() => this.pollGamepadForMenu(), 16);
  }

  stopGamepadPolling() {
    if (this.gamepadPollInterval) {
      clearInterval(this.gamepadPollInterval);
      this.gamepadPollInterval = null;
    }
  }

  handleMenuKeydown(e) {
    if (this.currentScreen === SCREENS.PLAYING) return;
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
      if (e.code === 'Escape') {
        document.activeElement.blur();
        this.updateFocus();
      }
      return;
    }

    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        e.preventDefault();
        this.navigateFocus(-1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        e.preventDefault();
        this.navigateFocus(1);
        break;
      case 'Enter':
      case 'Space':
        e.preventDefault();
        this.activateFocused();
        break;
      case 'Escape':
        this.handleMenuBack();
        break;
    }
  }

  pollGamepadForMenu() {
    if (this.currentScreen === SCREENS.PLAYING) return;
    
    GamepadInput.poll();
    if (!GamepadInput.connected) return;
    
    const now = Date.now();
    if (now - this.lastNavTime < this.navCooldown) return;
    
    const state = GamepadInput.state;
    
    // D-pad or left stick navigation
    if (state.buttons.dpadUp || state.leftStick.y < -0.5) {
      this.navigateFocus(-1);
      this.lastNavTime = now;
    } else if (state.buttons.dpadDown || state.leftStick.y > 0.5) {
      this.navigateFocus(1);
      this.lastNavTime = now;
    }
    
    // A button to select
    if (GamepadInput.justPressed('a')) {
      this.activateFocused();
    }
    
    // B button to go back
    if (GamepadInput.justPressed('b')) {
      this.handleMenuBack();
    }
  }

  navigateFocus(direction) {
    this.updateFocusableElements();
    if (this.focusableElements.length === 0) return;
    
    this.focusIndex = (this.focusIndex + direction + this.focusableElements.length) % this.focusableElements.length;
    this.updateFocus();
  }

  updateFocusableElements() {
    this.focusableElements = Array.from(
      this.container.querySelectorAll('.menu-btn, .back-btn, .class-btn, .mode-btn:not(.disabled), .vis-btn, .limit-btn, .players-btn, .join-btn, .refresh-btn, .rebind-btn, .options-btn:not(:disabled), .options-tab, .sidebar-btn, .volume-slider, .ready-checkbox input, #chk-ready')
    ).filter(el => !el.disabled && el.offsetParent !== null);
  }

  updateFocus() {
    this.focusableElements.forEach((el, i) => {
      el.classList.toggle('nav-focus', i === this.focusIndex);
    });
    
    if (this.focusableElements[this.focusIndex]) {
      this.focusableElements[this.focusIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  activateFocused() {
    this.updateFocusableElements();
    const el = this.focusableElements[this.focusIndex];
    if (el) {
      el.click();
      if (el.type === 'checkbox') {
        el.checked = !el.checked;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  handleMenuBack() {
    switch (this.currentScreen) {
      case SCREENS.CREATE_GAME:
      case SCREENS.JOIN_GAME:
      case SCREENS.OPTIONS:
        this.showScreen(SCREENS.MAIN_MENU);
        break;
      case SCREENS.LOBBY:
        NetworkManager.leaveRoom();
        break;
    }
  }

  resetFocus() {
    this.focusIndex = 0;
    this.updateFocusableElements();
    this.updateFocus();
  }

  async checkJoinUrl() {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");
    
    if (joinCode) {
      // Clear the URL parameter to prevent re-joining on refresh
      window.history.replaceState({}, "", window.location.pathname);
      
      // Auto-join the room (preserve case for random Colyseus IDs)
      await this.joinByCode(joinCode);
    }
  }

  saveCallsign(name) {
    this.playerName = name;
    localStorage.setItem("starstrafe_callsign", name);
  }

  setupNetworkListeners() {
    NetworkManager.on("roomJoined", () => {
      this.showScreen(SCREENS.LOBBY);
    });

    NetworkManager.on("stateChange", (state) => {
      if (state.phase === "playing" && this.currentScreen !== SCREENS.PLAYING) {
        this.showScreen(SCREENS.PLAYING);
        this.emit("gameStart");
      } else if (state.phase === "results" && this.currentScreen !== SCREENS.RESULTS) {
        this.showScreen(SCREENS.RESULTS);
      } else if (state.phase === "lobby" && this.currentScreen === SCREENS.RESULTS) {
        this.showScreen(SCREENS.LOBBY);
      } else if (state.phase === "countdown" || state.phase === "lobby") {
        this.renderLobby();
      }
    });

    NetworkManager.on("roomLeft", () => {
      this.showScreen(SCREENS.MAIN_MENU);
    });

    NetworkManager.on("error", (err) => {
      console.error("[Menu] Network error:", err);
      let message = "Connection error";
      
      if (err.error?.message) {
        message = err.error.message;
      } else if (err.message) {
        message = err.message;
      }
      
      // User-friendly messages for common errors
      if (message.includes("already exists") || message.includes("roomId")) {
        message = "Room code already in use. Try a different code.";
      } else if (message.includes("not found")) {
        message = "Room not found. Check the code and try again.";
      } else if (message.includes("full")) {
        message = "Room is full.";
      }
      
      this.showError(message);
      
      // Return to appropriate screen
      if (this.currentScreen === SCREENS.PLAYING) return;
      if (this.lastScreen) {
        this.showScreen(this.lastScreen);
      } else {
        this.showScreen(SCREENS.MAIN_MENU);
      }
    });
  }

  showScreen(screen) {
    this.currentScreen = screen;
    
    // Show/hide start scene based on screen
    if (this.startScene && this.startScene.renderer) {
      const showScene = screen === SCREENS.MAIN_MENU || 
                        screen === SCREENS.CREATE_GAME || 
                        screen === SCREENS.JOIN_GAME ||
                        screen === SCREENS.OPTIONS;
      this.startScene.renderer.domElement.style.display = showScene ? "block" : "none";
    }
    
    this.render();
    setTimeout(() => this.resetFocus(), 50);
  }
  
  showLoading(message = "LOADING LEVEL...") {
    this.loadingMessage = message;
    this.showScreen(SCREENS.LOADING);
  }
  
  updateLoadingProgress(progress) {
    const progressBar = document.querySelector('.loading-progress-fill');
    const progressText = document.querySelector('.loading-progress-text');
    if (progressBar) {
      progressBar.style.width = `${Math.round(progress * 100)}%`;
    }
    if (progressText) {
      progressText.textContent = `${Math.round(progress * 100)}%`;
    }
  }
  
  loadingComplete() {
    if (this.currentScreen === SCREENS.LOADING) {
      this.showScreen(SCREENS.PLAYING);
      this.emit("gameStart");
    }
  }

  render() {
    if (!this.container) return;

    switch (this.currentScreen) {
      case SCREENS.MAIN_MENU:
        this.renderMainMenu();
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
    // Show start scene when on main menu
    if (this.startScene && this.startScene.renderer) {
      this.startScene.renderer.domElement.style.display = "block";
    }
    
    this.container.innerHTML = `
      <div class="menu-screen main-menu">
        <div class="main-menu-right">
          <div class="menu-title">
            <p class="subtitle">JAMES C. KANE'S</p>
            <h1>STARSTRAFE</h1>
            <p class="subtitle">ZERO-G AERIAL COMBAT</p>
          </div>
          <div class="menu-panel">
            <div class="menu-content">
              <div class="name-input-group">
                <label>CALLSIGN</label>
                <input type="text" id="player-name" value="${this.playerName}" maxlength="16" />
              </div>
              <div class="menu-buttons">
                <button class="menu-btn" id="btn-quick">QUICKMATCH</button>
                <button class="menu-btn" id="btn-join">JOIN MATCH</button>
                <button class="menu-btn" id="btn-create">CREATE MATCH</button>
                <button class="menu-btn options-btn-main" id="btn-options">OPTIONS</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById("player-name").addEventListener("input", (e) => {
      this.saveCallsign(e.target.value || "Pilot");
    });

    document.getElementById("btn-create").addEventListener("click", () => {
      this.showScreen(SCREENS.CREATE_GAME);
    });

    document.getElementById("btn-join").addEventListener("click", () => {
      this.showScreen(SCREENS.JOIN_GAME);
    });

    document.getElementById("btn-quick").addEventListener("click", () => {
      this.quickMatch();
    });

    document.getElementById("btn-options").addEventListener("click", () => {
      this.showScreen(SCREENS.OPTIONS);
    });
    
    this.updateGamepadIndicator();
  }
  
  updateGamepadIndicator() {
    const indicator = document.getElementById("gamepad-indicator");
    if (indicator) {
      if (GamepadInput.connected) {
        indicator.textContent = "🎮 Gamepad: D-Pad - Navigate | A - Select | B - Back";
        indicator.classList.add("active");
      } else {
        indicator.textContent = "";
        indicator.classList.remove("active");
      }
    }
  }

  renderCreateGame() {
    this.container.innerHTML = `
      <div class="menu-screen create-game">
        <div class="menu-header">
          <button class="back-btn" id="btn-back">← BACK</button>
          <h2>CREATE MATCH</h2>
        </div>
        <div class="menu-content">
          <div class="form-group">
            <label>ROOM NAME</label>
            <input type="text" id="room-name" value="${this.playerName}'s Arena" maxlength="24" />
          </div>
          <div class="form-group">
            <label>ROOM CODE <span class="optional">(optional - leave blank for random)</span></label>
            <div class="code-validation-wrapper">
              <input type="text" id="room-code-custom" placeholder="e.g. MYCOOLROOM" maxlength="16" pattern="[A-Za-z0-9]+" />
              <span class="code-status" id="code-status"></span>
            </div>
          </div>
          <div class="form-group">
            <label>MAP</label>
            <select id="level-select" class="menu-select">
              ${Object.values(LEVELS).map(level => `
                <option value="${level.id}">${level.name}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>GAME MODE</label>
              <div class="mode-select stacked">
                <button class="mode-btn selected" data-mode="ffa">FREE FOR ALL</button>
                <button class="mode-btn disabled" data-mode="team" disabled>TEAM BATTLE</button>
              </div>
            </div>
            <div class="form-group">
              <label>VISIBILITY</label>
              <div class="visibility-select stacked">
                <button class="vis-btn selected" data-public="true">PUBLIC</button>
                <button class="vis-btn" data-public="false">PRIVATE</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>KILL LIMIT</label>
            <div class="limit-select">
              <button class="limit-btn" data-limit="10">10</button>
              <button class="limit-btn selected" data-limit="20">20</button>
              <button class="limit-btn" data-limit="30">30</button>
              <button class="limit-btn" data-limit="50">50</button>
            </div>
          </div>
          <div class="form-group">
            <label>MAX PLAYERS</label>
            <div class="players-select">
              <button class="players-btn" data-players="2">2</button>
              <button class="players-btn" data-players="4">4</button>
              <button class="players-btn" data-players="6">6</button>
              <button class="players-btn selected" data-players="8">8</button>
            </div>
          </div>
          <button class="menu-btn primary large" id="btn-create-room">LAUNCH ARENA</button>
        </div>
      </div>
    `;

    let selectedMode = "ffa";
    let selectedLevel = "hangar";
    let isPublic = true;
    let killLimit = 20;
    let maxPlayers = 8;

    document.getElementById("btn-back").addEventListener("click", () => {
      this.showScreen(SCREENS.MAIN_MENU);
    });

    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedMode = btn.dataset.mode;
      });
    });

    document.querySelectorAll(".vis-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".vis-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        isPublic = btn.dataset.public === "true";
      });
    });

    document.querySelectorAll(".limit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".limit-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        killLimit = parseInt(btn.dataset.limit);
      });
    });

    document.querySelectorAll(".players-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".players-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        maxPlayers = parseInt(btn.dataset.players);
      });
    });

    document.getElementById("level-select").addEventListener("change", (e) => {
      selectedLevel = e.target.value;
    });

    // Debounced room code validation
    let codeCheckTimeout = null;
    let codeIsValid = true;
    const codeInput = document.getElementById("room-code-custom");
    const codeStatus = document.getElementById("code-status");
    const createBtn = document.getElementById("btn-create-room");
    
    const validateCode = async () => {
      const code = codeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      
      if (!code) {
        codeStatus.textContent = "";
        codeStatus.className = "code-status";
        codeIsValid = true;
        createBtn.disabled = false;
        return;
      }
      
      codeStatus.textContent = "checking...";
      codeStatus.className = "code-status checking";
      
      await NetworkManager.connect();
      const exists = await NetworkManager.checkRoomExists(code);
      
      if (exists) {
        codeStatus.textContent = "✗ taken";
        codeStatus.className = "code-status invalid";
        codeIsValid = false;
        createBtn.disabled = true;
      } else {
        codeStatus.textContent = "✓ available";
        codeStatus.className = "code-status valid";
        codeIsValid = true;
        createBtn.disabled = false;
      }
    };
    
    codeInput.addEventListener("input", () => {
      clearTimeout(codeCheckTimeout);
      codeCheckTimeout = setTimeout(validateCode, 500);
    });
    
    codeInput.addEventListener("blur", () => {
      clearTimeout(codeCheckTimeout);
      validateCode();
    });

    document.getElementById("btn-create-room").addEventListener("click", async () => {
      if (!codeIsValid) return;
      const roomName = document.getElementById("room-name").value;
      const customCode = document.getElementById("room-code-custom").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      await this.createGame(roomName, selectedMode, isPublic, killLimit, maxPlayers, selectedLevel, customCode || null);
    });
  }

  renderJoinGame() {
    this.container.innerHTML = `
      <div class="menu-screen join-game">
        <div class="menu-header">
          <button class="back-btn" id="btn-back">← BACK</button>
          <h2>JOIN MATCH</h2>
        </div>
        <div class="menu-content">
          <div class="join-code-section">
            <label>JOIN BY CODE</label>
            <div class="code-input-group">
              <input type="text" id="room-code" placeholder="Enter room code..." maxlength="16" />
              <button class="menu-btn" id="btn-join-code">JOIN</button>
            </div>
          </div>
          <div class="divider"><span>OR</span></div>
          <div class="room-list-section">
            <div class="room-list-header">
              <label>PUBLIC GAMES</label>
              <button class="refresh-btn" id="btn-refresh">↻ REFRESH</button>
            </div>
            <div class="room-list" id="room-list">
              <div class="loading">Searching for matches...</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById("btn-back").addEventListener("click", () => {
      this.stopRefreshing();
      this.showScreen(SCREENS.MAIN_MENU);
    });

    document.getElementById("btn-join-code").addEventListener("click", () => {
      const code = document.getElementById("room-code").value.trim();
      if (code) this.joinByCode(code);
    });

    document.getElementById("btn-refresh").addEventListener("click", () => {
      this.refreshRoomList();
    });

    this.refreshRoomList();
    this.startRefreshing();
  }

  renderLobby() {
    const state = NetworkManager.getState();
    if (!state) return;

    const isHost = NetworkManager.isHost();
    const localPlayer = NetworkManager.getLocalPlayer();
    const players = NetworkManager.getPlayers();

    const isCountdown = state.phase === "countdown";
    const allReady = players.every(([, p]) => p.ready);
    const canStart = isHost && players.length >= 1 && (allReady || players.length === 1);

    this.container.innerHTML = `
      <div class="menu-screen lobby">
        <div class="menu-header">
          <button class="back-btn" id="btn-leave">← LEAVE</button>
          <h2>${state.roomName || "GAME LOBBY"}</h2>
          <div class="room-info">
            <span class="mode-badge ${state.mode}">${state.mode === "ffa" ? "FFA" : "TEAM"}</span>
            <div class="room-code-wrapper">
              <span class="room-code" id="room-code-btn">CODE: ${NetworkManager.room?.roomId?.toUpperCase() || "..."}</span>
              <div class="share-tooltip" id="share-tooltip">
                <label>SHARE LINK</label>
                <div class="share-input-group">
                  <input type="text" id="share-url" readonly value="${window.location.origin}?join=${NetworkManager.room?.roomId || ""}" />
                  <button class="copy-btn" id="btn-copy">📋</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        ${isCountdown ? `
          <div class="countdown-overlay">
            <div class="countdown-number">${state.countdown}</div>
            <div class="countdown-text">GET READY</div>
          </div>
        ` : ""}
        
        <div class="lobby-content">
          <div class="players-section">
            <h3>PILOTS (${players.length}/8)</h3>
            <div class="player-list">
              ${players.map(([sessionId, player]) => `
                <div class="player-card ${player.ready ? "ready" : ""} ${sessionId === NetworkManager.sessionId ? "local" : ""} ${state.mode === "team" ? `team-${player.team}` : ""}">
                  <div class="player-info">
                    <span class="player-name">${player.name}${state.hostId === sessionId ? " ★" : ""}</span>
                    <span class="player-class">${player.shipClass.toUpperCase()}</span>
                  </div>
                  <div class="player-status">${player.ready ? "READY" : "..."}</div>
                </div>
              `).join("")}
            </div>
          </div>
          
          <div class="settings-section">
            <h3>SELECT CLASS</h3>
            <div class="class-select">
              ${["fighter", "tank", "rogue"].map((cls) => `
                <button class="class-btn ${localPlayer?.shipClass === cls ? "selected" : ""}" data-class="${cls}">
                  <div class="class-name">${cls.toUpperCase()}</div>
                  <div class="class-stats">
                    ${cls === "fighter" ? "Balanced • 100 HP • 20 Missiles" : ""}
                    ${cls === "tank" ? "Slow • 150 HP • Mega Missiles" : ""}
                    ${cls === "rogue" ? "Fast • 70 HP • Quick Shots" : ""}
                  </div>
                </button>
              `).join("")}
            </div>
            
            <div class="lobby-actions">
              <label class="ready-checkbox">
                <input type="checkbox" id="chk-ready" ${localPlayer?.ready ? "checked" : ""} />
                <span class="ready-checkmark"></span>
                <span class="ready-label">READY</span>
              </label>
              ${isHost ? `
                <button class="menu-btn primary ${canStart ? "" : "disabled"}" id="btn-start" ${canStart ? "" : "disabled"}>
                  START MATCH
                </button>
              ` : ""}
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById("btn-leave").addEventListener("click", () => {
      NetworkManager.leaveRoom();
    });

    const shareTooltip = document.getElementById("share-tooltip");
    document.getElementById("room-code-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      shareTooltip.classList.toggle("active");
      if (shareTooltip.classList.contains("active")) {
        document.getElementById("share-url").select();
      }
    });

    document.getElementById("btn-copy").addEventListener("click", async (e) => {
      e.stopPropagation();
      const url = document.getElementById("share-url").value;
      await navigator.clipboard.writeText(url);
      e.target.textContent = "✓";
      setTimeout(() => e.target.textContent = "📋", 1500);
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".room-code-wrapper")) {
        shareTooltip.classList.remove("active");
      }
    }, { once: true });

    document.querySelectorAll(".class-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        NetworkManager.selectClass(btn.dataset.class);
      });
    });

    document.getElementById("chk-ready")?.addEventListener("change", () => {
      NetworkManager.toggleReady();
    });

    document.getElementById("btn-start")?.addEventListener("click", () => {
      NetworkManager.startGame();
    });
  }

  renderLoading() {
    this.container.classList.remove("hidden");
    this.container.innerHTML = `
      <div class="menu-screen loading-screen">
        <div class="loading-content">
          <div class="loading-title">
            <h1>STARSTRAFE</h1>
          </div>
          <div class="loading-message">${this.loadingMessage || "LOADING..."}</div>
          <div class="loading-progress">
            <div class="loading-progress-bar">
              <div class="loading-progress-fill"></div>
            </div>
            <div class="loading-progress-text">0%</div>
          </div>
          <div class="loading-hint">PREPARE FOR COMBAT</div>
        </div>
      </div>
    `;
  }

  renderPlaying() {
    this.container.innerHTML = "";
    this.container.classList.add("hidden");
  }

  renderResults() {
    const state = NetworkManager.getState();
    if (!state) return;

    const players = NetworkManager.getPlayers().sort((a, b) => b[1].kills - a[1].kills);

    this.container.classList.remove("hidden");
    this.container.innerHTML = `
      <div class="menu-screen results">
        <div class="results-header">
          <h1>MATCH COMPLETE</h1>
          ${state.mode === "team" ? `
            <div class="team-scores">
              <div class="team-score team-1">RED: ${state.team1Score}</div>
              <div class="team-score team-2">BLUE: ${state.team2Score}</div>
            </div>
          ` : ""}
        </div>
        <div class="scoreboard">
          <div class="scoreboard-header">
            <span>RANK</span>
            <span>PILOT</span>
            <span>KILLS</span>
            <span>DEATHS</span>
            <span>K/D</span>
          </div>
          ${players.map(([sessionId, player], index) => `
            <div class="scoreboard-row ${sessionId === NetworkManager.sessionId ? "local" : ""} ${state.mode === "team" ? `team-${player.team}` : ""}">
              <span class="rank">#${index + 1}</span>
              <span class="name">${player.name}</span>
              <span class="kills">${player.kills}</span>
              <span class="deaths">${player.deaths}</span>
              <span class="kd">${player.deaths > 0 ? (player.kills / player.deaths).toFixed(2) : player.kills.toFixed(2)}</span>
            </div>
          `).join("")}
        </div>
        <div class="results-footer">
          <p>Returning to lobby in 10 seconds...</p>
        </div>
      </div>
    `;
  }

  renderOptions(returnScreen = null) {
    this.optionsReturnScreen = returnScreen || this.lastScreen || SCREENS.MAIN_MENU;
    this.optionsSection = this.optionsSection || 'controls';
    
    this.container.innerHTML = `
      <div class="menu-screen options-menu">
        <div class="menu-header">
          <button class="back-btn" id="btn-back">← BACK</button>
          <h2>OPTIONS</h2>
        </div>
        <div class="options-layout">
          <div class="options-sidebar">
            <button class="sidebar-btn ${this.optionsSection === 'controls' ? 'active' : ''}" data-section="controls">
              <span class="sidebar-icon">⌨</span> CONTROLS
            </button>
            <button class="sidebar-btn ${this.optionsSection === 'sound' ? 'active' : ''}" data-section="sound">
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

    document.querySelectorAll(".sidebar-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.optionsSection = btn.dataset.section;
        this.renderOptions(this.optionsReturnScreen);
      });
    });

    this.setupOptionsSectionListeners();
    this.startGamepadStatusPolling();
  }

  renderOptionsSection() {
    if (this.optionsSection === 'controls') {
      return this.renderControlsSection();
    } else if (this.optionsSection === 'sound') {
      return this.renderSoundSection();
    }
    return '';
  }

  renderControlsSection() {
    const bindings = KeyBindings.getAllBindings();
    const presets = KeyBindings.getPresetNames();
    const gpBindings = GamepadInput.getBindings();
    const gpConnected = GamepadInput.connected;
    const activeTab = this.optionsTab || (gpConnected ? 'gamepad' : 'keyboard');

    return `
      <div class="options-tabs">
        <button class="options-tab ${activeTab === 'keyboard' ? 'active' : ''}" data-tab="keyboard">
          KEYBOARD
        </button>
        <button class="options-tab ${activeTab === 'gamepad' ? 'active' : ''}" data-tab="gamepad">
          GAMEPAD <span class="tab-status ${gpConnected ? 'connected' : ''}" id="gamepad-tab-status">${gpConnected ? '●' : '○'}</span>
        </button>
      </div>
      
      <div class="options-tab-content ${activeTab === 'keyboard' ? 'active' : ''}" data-tab="keyboard">
        <div class="options-section">
          <div class="options-header-row">
            <div class="preset-controls">
              <select id="preset-select" class="menu-select preset-select">
                ${presets.map(p => `<option value="${p}" ${p === KeyBindings.activePreset ? 'selected' : ''}>${p.toUpperCase()}${p === 'custom' ? ' *' : ''}</option>`).join('')}
              </select>
              <button class="options-btn" id="btn-save-preset" title="Save current as new preset" ${!KeyBindings.isCustom() ? 'disabled' : ''}>SAVE AS</button>
              <button class="options-btn danger" id="btn-delete-preset" title="Delete selected preset" ${KeyBindings.activePreset === 'default' || KeyBindings.activePreset === 'custom' ? 'disabled' : ''}>DELETE</button>
            </div>
          </div>
          <div class="keybind-list">
            ${Object.keys(ACTION_LABELS).map(action => `
              <div class="keybind-row" data-action="${action}">
                <span class="keybind-action">${ACTION_LABELS[action]}</span>
                <div class="keybind-keys">
                  ${(bindings[action] || []).map(key => `
                    <span class="keybind-key">${getKeyDisplayName(key)}</span>
                  `).join('') || '<span class="keybind-unset">UNBOUND</span>'}
                </div>
                <button class="rebind-btn" data-action="${action}">REBIND</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      
      <div class="options-tab-content ${activeTab === 'gamepad' ? 'active' : ''}" data-tab="gamepad">
        <div class="options-section">
          <div class="options-header-row">
            <span class="gamepad-status ${gpConnected ? 'connected' : ''}" id="gamepad-status">${gpConnected ? '● CONNECTED' : '○ NOT DETECTED'}</span>
          </div>
          <div class="keybind-list gamepad-list">
            ${Object.entries(gpBindings).map(([input, action]) => `
              <div class="keybind-row gamepad-row">
                <span class="keybind-action">${GAMEPAD_INPUT_LABELS[input] || input}</span>
                <span class="gamepad-arrow">→</span>
                <span class="gamepad-action">${GAMEPAD_ACTION_LABELS[action] || action}</span>
              </div>
            `).join('')}
          </div>
          <div class="options-footer">
            <button class="menu-btn secondary" id="btn-reset-gamepad">RESET GAMEPAD</button>
          </div>
          <p class="gamepad-hint">Gamepad auto-switches when input is detected</p>
        </div>
      </div>
    `;
  }

  renderSoundSection() {
    const musicVol = Math.round(AudioSettings.get('musicVolume') * 100);
    const sfxVol = Math.round(AudioSettings.get('sfxVolume') * 100);

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

  setupOptionsSectionListeners() {
    if (this.optionsSection === 'controls') {
      this.setupControlsListeners();
    } else if (this.optionsSection === 'sound') {
      this.setupSoundListeners();
    }
  }

  setupControlsListeners() {
    document.querySelectorAll(".options-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        this.optionsTab = tab.dataset.tab;
        document.querySelectorAll(".options-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === this.optionsTab));
        document.querySelectorAll(".options-tab-content").forEach(c => c.classList.toggle("active", c.dataset.tab === this.optionsTab));
      });
    });

    document.getElementById("preset-select")?.addEventListener("change", (e) => {
      KeyBindings.loadPreset(e.target.value);
      this.renderOptions(this.optionsReturnScreen);
    });

    document.getElementById("btn-save-preset")?.addEventListener("click", () => {
      const name = prompt("Enter preset name:");
      if (name && name.trim()) {
        KeyBindings.savePreset(name.trim().toLowerCase());
        this.renderOptions(this.optionsReturnScreen);
      }
    });

    document.getElementById("btn-delete-preset")?.addEventListener("click", () => {
      if (KeyBindings.activePreset !== 'default' && KeyBindings.activePreset !== 'custom') {
        if (confirm(`Delete preset "${KeyBindings.activePreset}"?`)) {
          KeyBindings.deletePreset(KeyBindings.activePreset);
          KeyBindings.loadPreset('default');
          this.renderOptions(this.optionsReturnScreen);
        }
      }
    });

    document.getElementById("btn-reset-gamepad")?.addEventListener("click", () => {
      if (confirm("Reset gamepad bindings to defaults?")) {
        GamepadInput.resetToDefault();
        this.renderOptions(this.optionsReturnScreen);
      }
    });

    document.querySelectorAll(".rebind-btn").forEach(btn => {
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

    document.getElementById("btn-reset-audio")?.addEventListener("click", () => {
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
        statusEl.className = `gamepad-status ${connected ? 'connected' : ''}`;
        statusEl.textContent = connected ? '● CONNECTED' : '○ NOT DETECTED';
      }
      if (tabStatusEl) {
        tabStatusEl.className = `tab-status ${connected ? 'connected' : ''}`;
        tabStatusEl.textContent = connected ? '●' : '○';
      }
    }, 500);
  }

  startRebinding(action) {
    const modal = document.getElementById("rebind-modal");
    document.getElementById("rebind-action-name").textContent = ACTION_LABELS[action];
    modal.style.display = "flex";
    
    const handleKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (e.code === 'Escape') {
        modal.style.display = "none";
        document.removeEventListener('keydown', handleKey, true);
        return;
      }
      
      KeyBindings.setBinding(action, [e.code]);
      modal.style.display = "none";
      document.removeEventListener('keydown', handleKey, true);
      this.renderOptions(this.optionsReturnScreen);
    };
    
    document.addEventListener('keydown', handleKey, true);
  }

  showOptionsFromGame(onClose) {
    this.container.classList.remove("hidden");
    this.optionsReturnScreen = null;
    this.onOptionsClose = onClose;
    this.renderOptionsInGame();
  }

  renderOptionsInGame() {
    this.optionsSection = this.optionsSection || 'controls';
    
    this.container.innerHTML = `
      <div class="menu-screen options-menu">
        <div class="menu-header">
          <button class="back-btn" id="btn-back">← BACK TO GAME</button>
          <h2>OPTIONS</h2>
        </div>
        <div class="options-layout">
          <div class="options-sidebar">
            <button class="sidebar-btn ${this.optionsSection === 'controls' ? 'active' : ''}" data-section="controls">
              <span class="sidebar-icon">⌨</span> CONTROLS
            </button>
            <button class="sidebar-btn ${this.optionsSection === 'sound' ? 'active' : ''}" data-section="sound">
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

    document.querySelectorAll(".sidebar-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.optionsSection = btn.dataset.section;
        this.renderOptionsInGame();
      });
    });

    this.setupOptionsSectionListenersInGame();
    this.startGamepadStatusPollingInGame();
  }

  setupOptionsSectionListenersInGame() {
    if (this.optionsSection === 'controls') {
      this.setupControlsListenersInGame();
    } else if (this.optionsSection === 'sound') {
      this.setupSoundListeners();
    }
  }

  setupControlsListenersInGame() {
    document.querySelectorAll(".options-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        this.optionsTab = tab.dataset.tab;
        document.querySelectorAll(".options-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === this.optionsTab));
        document.querySelectorAll(".options-tab-content").forEach(c => c.classList.toggle("active", c.dataset.tab === this.optionsTab));
      });
    });

    document.getElementById("preset-select")?.addEventListener("change", (e) => {
      KeyBindings.loadPreset(e.target.value);
      this.renderOptionsInGame();
    });

    document.getElementById("btn-save-preset")?.addEventListener("click", () => {
      const name = prompt("Enter preset name:");
      if (name && name.trim()) {
        KeyBindings.savePreset(name.trim().toLowerCase());
        this.renderOptionsInGame();
      }
    });

    document.getElementById("btn-delete-preset")?.addEventListener("click", () => {
      if (KeyBindings.activePreset !== 'default') {
        if (confirm(`Delete preset "${KeyBindings.activePreset}"?`)) {
          KeyBindings.deletePreset(KeyBindings.activePreset);
          KeyBindings.loadPreset('default');
          this.renderOptionsInGame();
        }
      }
    });

    document.getElementById("btn-reset-defaults")?.addEventListener("click", () => {
      if (confirm("Reset all bindings to defaults?")) {
        KeyBindings.resetToDefault();
        this.renderOptionsInGame();
      }
    });

    document.getElementById("btn-reset-gamepad")?.addEventListener("click", () => {
      if (confirm("Reset gamepad bindings to defaults?")) {
        GamepadInput.resetToDefault();
        this.renderOptionsInGame();
      }
    });

    document.querySelectorAll(".rebind-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        this.startRebindingInGame(action);
      });
    });
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
        statusEl.className = `gamepad-status ${connected ? 'connected' : ''}`;
        statusEl.textContent = connected ? '● CONNECTED' : '○ NOT DETECTED';
      }
      if (tabStatusEl) {
        tabStatusEl.className = `tab-status ${connected ? 'connected' : ''}`;
        tabStatusEl.textContent = connected ? '●' : '○';
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
    document.getElementById("rebind-action-name").textContent = ACTION_LABELS[action];
    modal.style.display = "flex";
    
    const handleKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (e.code === 'Escape') {
        modal.style.display = "none";
        document.removeEventListener('keydown', handleKey, true);
        return;
      }
      
      KeyBindings.setBinding(action, [e.code]);
      modal.style.display = "none";
      document.removeEventListener('keydown', handleKey, true);
      this.renderOptionsInGame();
    };
    
    document.addEventListener('keydown', handleKey, true);
  }

  closeOptionsInGame() {
    this.stopGamepadStatusPolling();
    this.container.classList.add("hidden");
    this.container.innerHTML = "";
    this.onOptionsClose?.();
    this.onOptionsClose = null;
  }

  hideOptions() {
    this.container.classList.add("hidden");
  }

  async createGame(roomName, mode, isPublic, killLimit, maxPlayers = 8, level = "hangar", roomCode = null) {
    this.showLoading("Creating arena...");
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
    });
  }

  async joinByCode(code) {
    this.showLoading("Joining...");
    await NetworkManager.connect();
    await NetworkManager.joinRoom(code, { playerName: this.playerName });
  }

  async quickMatch() {
    this.showLoading("Finding match...");
    await NetworkManager.connect();
    await NetworkManager.joinOrCreate({ playerName: this.playerName });
  }

  async refreshRoomList() {
    const listEl = document.getElementById("room-list");
    if (!listEl) return;

    if (!NetworkManager.connected) {
      await NetworkManager.connect();
    }

    const rooms = await NetworkManager.getAvailableRooms();
    this.roomList = rooms;

    if (rooms.length === 0) {
      listEl.innerHTML = `<div class="empty">No public matches found. Create one!</div>`;
      return;
    }

    listEl.innerHTML = rooms
      .map(
        (room) => `
      <div class="room-item" data-room-id="${room.roomId}">
        <div class="room-details">
          <span class="room-name">${room.metadata?.roomName || "Match"}</span>
          <span class="room-mode ${room.metadata?.mode || "ffa"}">${room.metadata?.mode === "team" ? "TEAM" : "FFA"}</span>
        </div>
        <div class="room-players">${room.clients}/${room.maxClients}</div>
        <button class="join-btn">JOIN</button>
      </div>
    `
      )
      .join("");

    listEl.querySelectorAll(".room-item").forEach((item) => {
      item.querySelector(".join-btn").addEventListener("click", () => {
        this.joinByCode(item.dataset.roomId);
      });
    });
  }

  startRefreshing() {
    this.refreshInterval = setInterval(() => this.refreshRoomList(), 5000);
  }

  stopRefreshing() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  showLoading(message) {
    this.lastScreen = this.currentScreen;
    this.container.innerHTML = `
      <div class="menu-screen loading-screen">
        <div class="loading-spinner"></div>
        <p>${message}</p>
      </div>
    `;
  }

  showError(message) {
    const errorEl = document.createElement("div");
    errorEl.className = "error-toast";
    errorEl.textContent = message;
    document.body.appendChild(errorEl);
    setTimeout(() => errorEl.remove(), 3000);
  }

  show() {
    if (this.container) {
      this.container.classList.remove("hidden");
    }
    // Show start scene when returning to menus
    if (this.startScene && this.startScene.renderer) {
      const showScene = this.currentScreen === SCREENS.MAIN_MENU || 
                        this.currentScreen === SCREENS.CREATE_GAME || 
                        this.currentScreen === SCREENS.JOIN_GAME ||
                        this.currentScreen === SCREENS.OPTIONS;
      this.startScene.renderer.domElement.style.display = showScene ? "block" : "none";
    }
  }

  hide() {
    if (this.container) {
      this.container.classList.add("hidden");
    }
    // Hide start scene when entering gameplay
    if (this.startScene && this.startScene.renderer) {
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
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach((cb) => cb(data));
    }
  }
}

export default new MenuManager();
