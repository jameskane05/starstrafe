import * as Colyseus from "@colyseus/sdk";

class NetworkManager {
  constructor() {
    this.client = null;
    this.room = null;
    this.sessionId = null;
    this.eventListeners = {};
    this.connected = false;
    this.serverUrl = "ws://localhost:2567";
    
    this.inputSequence = 0;
    this.pendingInputs = [];
  }

  async connect(serverUrl = null) {
    if (serverUrl) this.serverUrl = serverUrl;
    
    try {
      this.client = new Colyseus.Client(this.serverUrl);
      this.connected = true;
      console.log("[Network] Connected to server:", this.serverUrl);
      return true;
    } catch (err) {
      console.error("[Network] Connection failed:", err);
      this.emit("error", { type: "connection", error: err });
      return false;
    }
  }

  async createRoom(options = {}) {
    if (!this.client) {
      console.error("[Network] Not connected");
      return null;
    }

    try {
      const createOptions = {
        mode: options.mode || "ffa",
        isPublic: options.isPublic !== false,
        roomName: options.roomName || "Game Room",
        name: options.playerName || "Player",
        killLimit: options.killLimit || 20,
        maxMatchTime: options.maxMatchTime || 300,
        maxPlayers: options.maxPlayers || 8,
      };
      
      if (options.roomId) {
        createOptions.roomId = options.roomId;
      }
      
      this.room = await this.client.create("game_room", createOptions);
      
      this.sessionId = this.room.sessionId;
      this.setupRoomListeners(true);
      
      console.log("[Network] Room created:", this.room.roomId);
      return this.room;
    } catch (err) {
      console.error("[Network] Failed to create room:", err);
      this.emit("error", { type: "createRoom", error: err });
      return null;
    }
  }

  async joinRoom(roomId, options = {}) {
    if (!this.client) {
      console.error("[Network] Not connected");
      return null;
    }

    try {
      this.room = await this.client.joinById(roomId, {
        name: options.playerName || "Player",
      });
      
      this.sessionId = this.room.sessionId;
      this.setupRoomListeners(false);
      
      console.log("[Network] Joined room:", roomId);
      return this.room;
    } catch (err) {
      console.error("[Network] Failed to join room:", err);
      this.emit("error", { type: "joinRoom", error: err });
      return null;
    }
  }

  async joinOrCreate(options = {}) {
    if (!this.client) {
      console.error("[Network] Not connected");
      return null;
    }

    try {
      this.room = await this.client.joinOrCreate("game_room", {
        mode: options.mode || "ffa",
        isPublic: true,
        name: options.playerName || "Player",
      });
      
      this.sessionId = this.room.sessionId;
      this.setupRoomListeners(false);
      
      console.log("[Network] Joined/created room:", this.room.roomId);
      return this.room;
    } catch (err) {
      console.error("[Network] Failed to join/create room:", err);
      this.emit("error", { type: "joinOrCreate", error: err });
      return null;
    }
  }

  async getAvailableRooms() {
    if (!this.client) return [];
    
    try {
      const response = await this.client.http.get("/api/rooms");
      const rooms = Array.isArray(response) ? response : (response?.data || []);
      return rooms.filter(r => r.metadata?.isPublic !== false);
    } catch (err) {
      console.error("[Network] Failed to get rooms:", err);
      return [];
    }
  }

  async checkRoomExists(roomId) {
    if (!this.client || !roomId) return false;
    
    try {
      const response = await this.client.http.get("/api/rooms");
      const rooms = Array.isArray(response) ? response : (response?.data || []);
      return rooms.some(r => r.roomId.toUpperCase() === roomId.toUpperCase());
    } catch (err) {
      console.error("[Network] Failed to check room:", err);
      return false;
    }
  }

  setupRoomListeners(isHostHint = false) {
    if (!this.room) return;

    // Wait for first state change to set up collection listeners and emit roomJoined
    this.room.onStateChange.once((state) => {
      this.setupCollectionListeners(state);
      // Check actual host status from state
      const isHost = state.hostId === this.sessionId;
      this.emit("roomJoined", { roomId: this.room.roomId, isHost });
    });

    // Track known projectiles to detect new ones
    this._knownProjectiles = this._knownProjectiles || new Set();
    
    this.room.onStateChange((state) => {
      this.emit("stateChange", state);
      
      // Manually emit player updates since onChange may not fire reliably
      if (state.players) {
        state.players.forEach((player, sessionId) => {
          this.emit("playerUpdate", { player, sessionId, isLocal: sessionId === this.sessionId });
        });
      }
      
      // Manually track projectiles since onAdd may not fire reliably
      if (state.projectiles) {
        const currentIds = new Set();
        state.projectiles.forEach((projectile, id) => {
          currentIds.add(id);
          if (!this._knownProjectiles.has(id)) {
            this._knownProjectiles.add(id);
            console.log("[Network] New projectile detected via state change:", id);
            this.emit("projectileSpawn", { projectile, id });
          }
        });
        // Remove projectiles that no longer exist
        this._knownProjectiles.forEach((id) => {
          if (!currentIds.has(id)) {
            this._knownProjectiles.delete(id);
            this.emit("projectileRemove", { id });
          }
        });
      }
    });

    this.room.onMessage("hit", (data) => {
      this.emit("hit", data);
    });

    this.room.onMessage("kill", (data) => {
      this.emit("kill", data);
    });

    this.room.onMessage("respawn", (data) => {
      this.emit("respawn", data);
    });

    this.room.onMessage("matchEnd", (data) => {
      this.emit("matchEnd", data);
    });

    this.room.onLeave((code) => {
      console.log("[Network] Left room:", code);
      this.emit("roomLeft", { code });
      this.room = null;
      this.sessionId = null;
    });

    this.room.onError((code, message) => {
      console.error("[Network] Room error:", code, message);
      this.emit("error", { type: "room", code, message });
    });
  }

  setupCollectionListeners(state) {
    if (!state) return;

    // Players collection
    if (state.players) {
      state.players.onAdd = (player, sessionId) => {
        console.log("[Network] Player added:", sessionId);
        this.emit("playerJoin", { player, sessionId, isLocal: sessionId === this.sessionId });
        
        player.onChange = (changes) => {
          console.log("[Network] Player changed:", sessionId, changes);
          this.emit("playerUpdate", { player, sessionId, isLocal: sessionId === this.sessionId });
        };
      };

      state.players.onRemove = (player, sessionId) => {
        this.emit("playerLeave", { player, sessionId });
      };

      // Set up onChange and emit for existing players
      state.players.forEach((player, sessionId) => {
        player.onChange = (changes) => {
          console.log("[Network] Player changed:", sessionId, changes);
          this.emit("playerUpdate", { player, sessionId, isLocal: sessionId === this.sessionId });
        };
        this.emit("playerJoin", { player, sessionId, isLocal: sessionId === this.sessionId });
      });
    }

    // Projectiles collection
    if (state.projectiles) {
      state.projectiles.onAdd = (projectile, id) => {
        console.log("[Network] Projectile spawned:", id, projectile.type, "owner:", projectile.ownerId);
        this.emit("projectileSpawn", { projectile, id });
      };

      state.projectiles.onRemove = (projectile, id) => {
        console.log("[Network] Projectile removed:", id);
        this.emit("projectileRemove", { projectile, id });
      };
    }

  }

  sendInput(inputData) {
    if (!this.room) {
      console.log("[Network] sendInput: no room");
      return;
    }
    if (this.room.state.phase !== "playing") {
      console.log("[Network] sendInput: phase is", this.room.state.phase);
      return;
    }
    
    this.inputSequence++;
    const input = {
      ...inputData,
      seq: this.inputSequence,
    };
    
    this.pendingInputs.push(input);
    
    if (this.pendingInputs.length > 64) {
      this.pendingInputs.shift();
    }
    
    this.room.send("input", input);
    
    return this.inputSequence;
  }

  sendFire(weapon, position, direction) {
    if (!this.room || this.room.state.phase !== "playing") {
      console.log("[Network] sendFire blocked - phase:", this.room?.state?.phase);
      return;
    }
    
    console.log("[Network] Sending fire:", weapon);
    this.room.send("fire", {
      weapon,
      x: position.x,
      y: position.y,
      z: position.z,
      dx: direction.x,
      dy: direction.y,
      dz: direction.z,
    });
  }

  selectClass(shipClass) {
    if (!this.room) return;
    this.room.send("classSelect", { shipClass });
  }

  toggleReady() {
    if (!this.room) return;
    this.room.send("ready");
  }

  startGame() {
    if (!this.room) return;
    this.room.send("startGame");
  }

  leaveRoom() {
    if (this.room) {
      this.room.leave();
      this.room = null;
      this.sessionId = null;
    }
  }

  disconnect() {
    this.leaveRoom();
    this.client = null;
    this.connected = false;
  }

  getLocalPlayer() {
    if (!this.room || !this.sessionId) return null;
    return this.room.state.players.get(this.sessionId);
  }

  getPlayers() {
    if (!this.room) return [];
    return Array.from(this.room.state.players.entries());
  }

  getState() {
    return this.room?.state || null;
  }

  isHost() {
    return this.room?.state?.hostId === this.sessionId;
  }

  getLastProcessedInput() {
    const player = this.getLocalPlayer();
    return player?.lastProcessedInput || 0;
  }

  getPendingInputs(afterSeq) {
    return this.pendingInputs.filter(input => input.seq > afterSeq);
  }

  clearProcessedInputs(upToSeq) {
    this.pendingInputs = this.pendingInputs.filter(input => input.seq > upToSeq);
  }

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

  emit(event, data) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach(cb => cb(data));
    }
  }
}

export default new NetworkManager();
