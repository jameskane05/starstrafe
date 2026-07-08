/**
 * NetworkManager.js - MULTIPLAYER CLIENT AND ROOM MANAGEMENT
 * =============================================================================
 *
 * ROLE: Colyseus client and room lifecycle. Connect, create/join/leave room;
 * send input and receive state; emit roomJoined, playerJoin/Leave/Update,
 * stateChange, etc. Used by MenuManager, gameMultiplayer, gameUpdate.
 *
 * KEY RESPONSIBILITIES:
 * - connect(serverUrl); createRoom(options), joinById(code), joinOrCreate; leave()
 * - getState(), getPlayers(), getLocalPlayer(); send input with sequence numbers
 * - Event emitter (on/off/emit); sessionId, serverUrl (local vs cloud)
 *
 * RELATED: gameMultiplayer.js, menuNetwork.js, MenuManager.js, Prediction.js.
 *
 * =============================================================================
 */

import * as Colyseus from "@colyseus/sdk";

// Production multiplayer endpoint (override with VITE_SERVER_URL if needed)
const CLOUD_SERVER_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SERVER_URL) ||
  "https://us-ord-23ba76a6.colyseus.cloud";
const LOCAL_SERVER_URL = "ws://localhost:2567";

const isLocalDev =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

class NetworkManager {
  constructor() {
    this.client = null;
    this.room = null;
    this.sessionId = null;
    this.eventListeners = {};
    this.connected = false;
    this.serverUrl = isLocalDev
      ? LOCAL_SERVER_URL
      : CLOUD_SERVER_URL || LOCAL_SERVER_URL;

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
        level: options.level || "newworld",
        killLimit: options.killLimit || 20,
        maxMatchTime: options.maxMatchTime || 480,
        maxPlayers: options.maxPlayers || 8,
        botsEnabled: options.botsEnabled === true,
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
        quickMatch: options.quickMatch === true,
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
      const joinOpts = {
        mode: options.mode || "ffa",
        isPublic: true,
        name: options.playerName || "Player",
        autoStart: options.autoStart || false,
        quickMatch: options.quickMatch === true,
      };
      if (options.level) joinOpts.level = options.level;
      if (options.botsEnabled === true) joinOpts.botsEnabled = true;

      this.room = await this.client.joinOrCreate("game_room", joinOpts);

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
      const rooms = Array.isArray(response) ? response : response?.data || [];
      return rooms.filter((r) => r.metadata?.isPublic !== false);
    } catch (err) {
      console.error("[Network] Failed to get rooms:", err);
      return [];
    }
  }

  async checkRoomExists(roomId) {
    if (!this.client || !roomId) return false;

    try {
      const response = await this.client.http.get("/api/rooms");
      const rooms = Array.isArray(response) ? response : response?.data || [];
      return rooms.some((r) => r.roomId.toUpperCase() === roomId.toUpperCase());
    } catch (err) {
      console.error("[Network] Failed to check room:", err);
      return false;
    }
  }

  setupRoomListeners(isHostHint = false) {
    if (!this.room) return;

    // Fresh room: avoid stale ids so stateChange listeners and collections stay in sync
    this._knownProjectiles = new Set();
    this._knownPlayers = new Set();
    this._knownCollectibles = new Set();

    // Wait for first state change to set up collection listeners and emit roomJoined
    this.room.onStateChange.once((state) => {
      this.setupCollectionListeners(state);
      // Check actual host status from state
      const isHost = state.hostId === this.sessionId;
      this.emit("roomJoined", { roomId: this.room.roomId, isHost });
    });

    this.room.onStateChange((state) => {
      this.emit("stateChange", state);

      // Manually track players since onAdd may not fire reliably
      if (state.players) {
        const currentIds = new Set();
        state.players.forEach((player, sessionId) => {
          currentIds.add(sessionId);
          if (!this._knownPlayers.has(sessionId)) {
            this._knownPlayers.add(sessionId);
            console.log(
              "[Network] New player detected via state change:",
              sessionId,
              player.name,
            );
            this.emit("playerJoin", {
              player,
              sessionId,
              isLocal: sessionId === this.sessionId,
            });
          }
          this.emit("playerUpdate", {
            player,
            sessionId,
            isLocal: sessionId === this.sessionId,
          });
        });
        // Remove players that no longer exist
        this._knownPlayers.forEach((sessionId) => {
          if (!currentIds.has(sessionId)) {
            this._knownPlayers.delete(sessionId);
            this.emit("playerLeave", { sessionId });
          }
        });
      }

      // Manually track projectiles since onAdd may not fire reliably
      if (state.projectiles) {
        const currentIds = new Set();
        state.projectiles.forEach((projectile, id) => {
          currentIds.add(id);
          if (!this._knownProjectiles.has(id)) {
            this._knownProjectiles.add(id);
            console.log(
              "[Network] New projectile detected via state change:",
              id,
            );
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

      if (state.collectibles) {
        const currentIds = new Set();
        state.collectibles.forEach((collectible, id) => {
          currentIds.add(id);
          if (!this._knownCollectibles.has(id)) {
            this._knownCollectibles.add(id);
            this.emit("collectibleSpawn", { collectible, id });
          }
        });
        this._knownCollectibles.forEach((id) => {
          if (!currentIds.has(id)) {
            this._knownCollectibles.delete(id);
            this.emit("collectibleRemove", { id });
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

    this.room.onMessage("chat", (data) => {
      this.emit("chat", data);
    });

    this.room.onMessage("collectiblePickup", (data) => {
      this.emit("collectiblePickup", data);
    });

    this.room.onMessage("botDeath", (data) => {
      this.emit("botDeath", data);
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

    // Players collection - property assignment style for Colyseus SDK
    if (state.players) {
      state.players.onAdd = (player, sessionId) => {
        console.log("[Network] Player onAdd fired:", sessionId);
        this.emit("playerJoin", {
          player,
          sessionId,
          isLocal: sessionId === this.sessionId,
        });

        player.onChange = () => {
          this.emit("playerUpdate", {
            player,
            sessionId,
            isLocal: sessionId === this.sessionId,
          });
        };
      };

      state.players.onRemove = (player, sessionId) => {
        console.log("[Network] Player onRemove fired:", sessionId);
        this.emit("playerLeave", { player, sessionId });
      };
    }

    // Projectiles collection
    if (state.projectiles) {
      state.projectiles.onAdd = (projectile, id) => {
        console.log(
          "[Network] Projectile spawned:",
          id,
          projectile.type,
          "owner:",
          projectile.ownerId,
        );
        this.emit("projectileSpawn", { projectile, id });

        // Listen for position/direction updates (for homing missiles)
        projectile.onChange = () => {
          this.emit("projectileUpdate", { projectile, id });
        };
      };

      state.projectiles.onRemove = (projectile, id) => {
        console.log("[Network] Projectile removed:", id);
        this.emit("projectileRemove", { projectile, id });
      };
    }

    // Collectibles collection
    if (state.collectibles) {
      state.collectibles.onAdd = (collectible, id) => {
        console.log("[Network] Collectible spawned:", id, collectible.type);
        this.emit("collectibleSpawn", { collectible, id });
      };

      state.collectibles.onRemove = (collectible, id) => {
        console.log("[Network] Collectible removed:", id);
        this.emit("collectibleRemove", { collectible, id });
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

  sendFire(weapon, position, direction, extraData = {}) {
    if (!this.room || this.room.state.phase !== "playing") {
      console.log(
        "[Network] sendFire blocked - phase:",
        this.room?.state?.phase,
      );
      return;
    }

    console.log("[Network] Sending fire:", weapon);
    this.room.send("fire", {
      ...extraData,
      weapon,
      x: position.x,
      y: position.y,
      z: position.z,
      dx: direction.x,
      dy: direction.y,
      dz: direction.z,
    });
  }

  sendMissileUpdate(projectileId, position, direction) {
    if (!this.room) return;
    this.room.send("missileUpdate", {
      id: projectileId,
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

  setLevel(level) {
    if (!this.room) return;
    this.room.send("setLevel", { level });
  }

  kickPlayer(targetSessionId) {
    if (!this.room) return;
    this.room.send("kick", { targetSessionId });
  }

  sendChat(text) {
    if (!this.room) return;
    this.room.send("chat", { text });
  }

  sendLobbyColor(color) {
    if (!this.room || this.room.state.phase !== "lobby") return;
    this.room.send("setLobbyColor", { color });
  }

  sendWeaponUnlocks(unlocks = {}) {
    if (!this.room) return;
    this.room.send("weaponUnlocks", {
      chargingLaser: unlocks.chargingLaser === true,
      gatling: unlocks.gatling === true,
    });
  }

  sendSpawnPoints({ enemySpawns, playerSpawns, missileSpawns, weaponSpawns, bounds }) {
    if (!this.room) return;
    const mapPts = (arr) =>
      (arr || []).map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const mapPlayerSpawns = (arr) =>
      (arr || []).map((p) => {
        const o = { x: p.x, y: p.y, z: p.z };
        if (
          p.qx !== undefined &&
          p.qy !== undefined &&
          p.qz !== undefined &&
          p.qw !== undefined
        ) {
          o.qx = p.qx;
          o.qy = p.qy;
          o.qz = p.qz;
          o.qw = p.qw;
        }
        return o;
      });
    const payload = {
      points: mapPts(enemySpawns),
      playerSpawns: mapPlayerSpawns(playerSpawns),
      missileSpawns: mapPts(missileSpawns),
      weaponSpawns: (weaponSpawns || []).map((p) => ({
        type: p.type,
        x: p.position?.x ?? p.x,
        y: p.position?.y ?? p.y,
        z: p.position?.z ?? p.z,
      })),
    };
    if (bounds?.center && bounds?.size) {
      payload.bounds = {
        center: { x: bounds.center.x, y: bounds.center.y, z: bounds.center.z },
        size: { x: bounds.size.x, y: bounds.size.y, z: bounds.size.z },
      };
    }
    this.room.send("setSpawnPoints", payload);
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
    return this.pendingInputs.filter((input) => input.seq > afterSeq);
  }

  clearProcessedInputs(upToSeq) {
    this.pendingInputs = this.pendingInputs.filter(
      (input) => input.seq > upToSeq,
    );
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
      this.eventListeners[event].forEach((cb) => cb(data));
    }
  }
}

export default new NetworkManager();
