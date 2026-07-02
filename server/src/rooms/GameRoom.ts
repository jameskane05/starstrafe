import { Room, Client, matchMaker } from "colyseus";
import {
  GameState,
  Player,
  Projectile,
  Collectible,
  Bot,
} from "./schema/GameState.js";
import {
  LOBBY_COLOR_PALETTE,
  normalizeLobbyHex,
  paletteIncludesNormalized,
  pickFirstFreeAccentColor,
  pickRandomFreeAccentColor,
} from "../shared/lobbyColors.js";

const SHIP_CLASSES = {
  fighter: {
    speed: 1.0,
    health: 100,
    missiles: 6,
    maxMissiles: 6,
    laserSpeed: 200,
    missileSpeed: 56,
    missileDamage: 75,
  },
  tank: {
    speed: 0.7,
    health: 150,
    missiles: 8,
    maxMissiles: 8,
    laserSpeed: 200,
    missileSpeed: 49,
    missileDamage: 150,
  },
  rogue: {
    speed: 1.4,
    health: 70,
    missiles: 4,
    maxMissiles: 4,
    laserSpeed: 200,
    missileSpeed: 70,
    missileDamage: 60,
  },
};

// Spawn points with rotation facing center (0,0,0)
// Quaternion for Y-axis rotation: qy = sin(θ/2), qw = cos(θ/2)
const SPAWN_POINTS = [
  { x: 0, y: 0, z: 5, qy: 1, qw: 0 }, // Center-ish, facing -Z (180°)
  { x: 20, y: 0, z: 0, qy: 0.707, qw: 0.707 }, // East, facing -X (90°)
  { x: -20, y: 0, z: 0, qy: -0.707, qw: 0.707 }, // West, facing +X (-90°)
  { x: 0, y: 0, z: 20, qy: 1, qw: 0 }, // South, facing -Z (180°)
  { x: 0, y: 0, z: -20, qy: 0, qw: 1 }, // North, facing +Z (0°)
  { x: 15, y: 0, z: 15, qy: 0.924, qw: 0.383 }, // SE, facing NW (135°)
  { x: -15, y: 0, z: 15, qy: -0.924, qw: 0.383 }, // SW, facing NE (-135°)
  { x: 15, y: 0, z: -15, qy: 0.383, qw: 0.924 }, // NE, facing SW (45°)
];

const TICK_RATE = 20;
const RESPAWN_TIME = 5;
const BOOST_DRAIN_RATE = 20;
const BOOST_REGEN_RATE = 33;
const BOOST_REGEN_DELAY = 3;
const BOOST_MAX_FUEL = 200;
const COLLECTIBLE_SPAWN_RADIUS = 25;
const COLLECTIBLE_COLLECT_RADIUS = 3;
const COLLECTIBLE_RESPAWN_TIME = 15;
const GATLING_DAMAGE = 6;
const GATLING_SPEED = 275;
const CHARGING_LASER_DAMAGE = 145;
const CHARGING_LASER_RANGE = 340;
const CHARGING_LASER_RADIUS = 3.2;

const BOT_MAX_COUNT = 8;
const BOT_SPEED = 12;
const BOT_WANDER_SPEED = 7;
/** Match client Projectile: enemy (non-player) default speed is 18 */
const BOT_LASER_SPEED = 18;
const BOT_LASER_DAMAGE = 25;
const BOT_FIRE_INTERVAL = 1.2;
/** Same as Enemy.js: fire from just under 100m detection range */
const BOT_ATTACK_RANGE_SQ = 8100;
/** Same as Enemy.js detectionRange / detectionRangeSq (100m) */
const BOT_DETECTION_RANGE_SQ = 10000;
/** Same as Enemy: stop closing inside ~8m */
const BOT_CLOSE_HOLD_SQ = 64;
const BOT_HIT_RADIUS = 2.5;
const BOT_RESPAWN_TIME = 15;
const BOT_LOS_CHECK_TICKS = 8;
/** Match solo: no extra spawn delay once AI uses detection + LOS */
const BOT_AGGRO_DELAY = 0;

/** Must match client LEVELS / sceneData criteria; used for create + host map change */
const VALID_GAME_LEVELS = [
  "newworld",
  "redarena",
  "arenatech",
  "icetest",
  "charon",
] as const;

function normalizeGameLevel(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return (VALID_GAME_LEVELS as readonly string[]).includes(s)
    ? s
    : "newworld";
}

type BotBrain = {
  mode: "wander" | "attack";
  waypoint: { x: number; y: number; z: number };
  wanderCooldown: number;
  wanderInterval: number;
  losCounter: number;
  hasLOS: boolean;
};

export class GameRoom extends Room {
  // State is typed via setState()
  declare state: GameState;
  maxClients = 8;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private projectileIdCounter = 0;
  private collectibleIdCounter = 0;
  private collectibleRespawnTimers: Map<string, number> = new Map();
  private lastBoostInput: Map<string, boolean> = new Map();
  private lastBoostTime: Map<string, number> = new Map();
  private botIdCounter = 0;
  private botFireCooldowns: Map<string, number> = new Map();
  private botBrain: Map<string, BotBrain> = new Map();
  private botRespawnQueue: {
    botId: string;
    timer: number;
    x: number;
    y: number;
    z: number;
  }[] = [];
  /** From host setSpawnPoints(bounds); used for wander clamp + coarse LOS along segment */
  private levelBoundsAabb: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  } | null = null;

  async onCreate(options: any) {
    this.setState(new GameState());

    // Use custom room ID if provided, but check if it already exists
    if (options.roomId) {
      const existingRooms = await matchMaker.query({ name: "game_room" });
      const exists = existingRooms.some(
        (room) => room.roomId.toUpperCase() === options.roomId.toUpperCase(),
      );

      if (exists) {
        throw new Error("Room code already exists");
      }

      this.roomId = options.roomId;
    }

    // Set max players (2-8)
    this.maxClients = Math.max(2, Math.min(8, options.maxPlayers || 8));

    this.state.mode = options.mode || "ffa";
    this.state.isPublic = options.isPublic !== false;
    this.state.roomName = options.roomName || "Game Room";
    this.state.level = normalizeGameLevel(options?.level);
    this.state.killLimit = options.killLimit || 20;
    this.state.maxMatchTime = options.maxMatchTime || 480;
    this.state.maxPlayers = this.maxClients;
    this.state.botsEnabled = options.botsEnabled === true;

    // Set room metadata for listing
    this.setMetadata({
      roomName: this.state.roomName,
      mode: this.state.mode,
      isPublic: this.state.isPublic,
      maxPlayers: this.maxClients,
      botsEnabled: this.state.botsEnabled,
    });

    this.registerMessageHandlers();

    console.log(
      `[GameRoom] Created: ${this.roomId} (${this.state.mode}, public: ${this.state.isPublic})`,
    );
  }

  private levelSpawnPoints: { x: number; y: number; z: number }[] = [];
  private levelPlayerSpawns: {
    x: number;
    y: number;
    z: number;
    qx?: number;
    qy?: number;
    qz?: number;
    qw?: number;
  }[] = [];
  private levelMissileSpawns: { x: number; y: number; z: number }[] = [];
  private levelWeaponSpawns: {
    type: string;
    x: number;
    y: number;
    z: number;
  }[] = [];

  private registerMessageHandlers() {
    this.onMessage("input", (client, data) => this.handleInput(client, data));
    this.onMessage("fire", (client, data) => this.handleFire(client, data));
    this.onMessage("setSpawnPoints", (client, data) =>
      this.handleSetSpawnPoints(client, data),
    );
    this.onMessage("missileUpdate", (client, data) =>
      this.handleMissileUpdate(client, data),
    );
    this.onMessage("classSelect", (client, data) =>
      this.handleClassSelect(client, data),
    );
    this.onMessage("ready", (client) => this.handleReady(client));
    this.onMessage("startGame", (client) => this.handleStartGame(client));
    this.onMessage("setLevel", (client, data) =>
      this.handleSetLevel(client, data),
    );
    this.onMessage("chat", (client, data) => this.handleChat(client, data));
    this.onMessage("kick", (client, data) => this.handleKick(client, data));
    this.onMessage("setLobbyColor", (client, data) =>
      this.handleSetLobbyColor(client, data),
    );
    this.onMessage("weaponUnlocks", (client, data) =>
      this.handleWeaponUnlocks(client, data),
    );
  }

  private handleWeaponUnlocks(client: Client, data: any) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (data?.chargingLaser === true) player.hasChargingLaser = true;
    if (data?.gatling === true) player.hasGatling = true;
  }

  private handleSetLobbyColor(client: Client, data: any) {
    if (this.state.phase !== "lobby") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const requested = normalizeLobbyHex(String(data?.color ?? ""));
    if (!paletteIncludesNormalized(requested)) return;
    for (const [sessionId, p] of this.state.players) {
      if (sessionId === client.sessionId) continue;
      if (normalizeLobbyHex(p.accentColor) === requested) return;
    }
    player.accentColor = requested;
  }

  private handleKick(client: Client, data: any) {
    if (client.sessionId !== this.state.hostId) return;
    if (this.state.phase !== "lobby") return;

    const targetSessionId = String(data?.targetSessionId || "").trim();
    if (!targetSessionId || targetSessionId === client.sessionId) return;
    if (!this.state.players.has(targetSessionId)) return;

    const targetClient = Array.from(this.clients).find(
      (c) => c.sessionId === targetSessionId,
    );
    if (targetClient) {
      const kicked = this.state.players.get(targetSessionId);
      targetClient.leave(4000);
      console.log(`[GameRoom] Host kicked ${kicked?.name || targetSessionId}`);
    }
  }

  private handleSetLevel(client: Client, data: any) {
    if (client.sessionId !== this.state.hostId) return;
    if (this.state.phase !== "lobby") return;

    const level = String(data?.level || "").trim();
    if (!(VALID_GAME_LEVELS as readonly string[]).includes(level)) return;
    if (level === this.state.level) return;

    this.state.level = level;
    this.state.players.forEach((p) => {
      p.ready = false;
    });
    this.levelSpawnPoints = [];
    this.levelPlayerSpawns = [];
    this.levelMissileSpawns = [];
    this.levelWeaponSpawns = [];
    this.levelBoundsAabb = null;
    console.log(
      `[GameRoom] Host changed map to ${level}, cleared ready status`,
    );
  }

  private handleSetSpawnPoints(client: Client, data: any) {
    if (client.sessionId !== this.state.hostId) return;
    // Lobby included: host pre-syncs spawns from loaded GLB before countdown so startMatch
    // does not run with empty levelSpawnPoints / levelPlayerSpawns.
    const canSet =
      this.state.phase === "lobby" ||
      this.state.phase === "countdown" ||
      this.state.phase === "playing";
    if (!canSet) return;

    const parse = (arr: any) =>
      (Array.isArray(arr) ? arr : [])
        .slice(0, 128)
        .filter(
          (p: any) =>
            typeof p?.x === "number" &&
            typeof p?.y === "number" &&
            typeof p?.z === "number",
        )
        .map((p: any) => ({ x: p.x, y: p.y, z: p.z }));

    const parsePlayerSpawns = (arr: any) =>
      (Array.isArray(arr) ? arr : [])
        .slice(0, 128)
        .filter(
          (p: any) =>
            typeof p?.x === "number" &&
            typeof p?.y === "number" &&
            typeof p?.z === "number",
        )
        .map((p: any) => {
          const base: {
            x: number;
            y: number;
            z: number;
            qx?: number;
            qy?: number;
            qz?: number;
            qw?: number;
          } = { x: p.x, y: p.y, z: p.z };
          if (
            typeof p.qx === "number" &&
            typeof p.qy === "number" &&
            typeof p.qz === "number" &&
            typeof p.qw === "number"
          ) {
            base.qx = p.qx;
            base.qy = p.qy;
            base.qz = p.qz;
            base.qw = p.qw;
          }
          return base;
        });

    const enemySpawns = parse(data?.points);
    const playerSpawns = parsePlayerSpawns(data?.playerSpawns);
    const missileSpawns = parse(data?.missileSpawns);
    const weaponSpawns = (Array.isArray(data?.weaponSpawns)
      ? data.weaponSpawns
      : [])
      .slice(0, 32)
      .filter(
        (p: any) =>
          (p?.type === "charging_laser" || p?.type === "gatling") &&
          typeof p.x === "number" &&
          typeof p.y === "number" &&
          typeof p.z === "number",
      )
      .map((p: any) => ({ type: p.type, x: p.x, y: p.y, z: p.z }));

    if (enemySpawns.length > 0) this.levelSpawnPoints = enemySpawns;
    if (playerSpawns.length > 0) this.levelPlayerSpawns = playerSpawns;
    if (missileSpawns.length > 0) {
      this.levelMissileSpawns = missileSpawns;
      if (this.state.phase === "playing") {
        this.respawnCollectiblesAtLevelPoints();
      }
    }
    if (weaponSpawns.length > 0) {
      this.levelWeaponSpawns = weaponSpawns;
      if (this.state.phase === "playing") {
        this.respawnCollectiblesAtLevelPoints();
      }
    }

    const bc = data?.bounds?.center;
    const bs = data?.bounds?.size;
    if (
      bc &&
      bs &&
      typeof bc.x === "number" &&
      typeof bc.y === "number" &&
      typeof bc.z === "number" &&
      typeof bs.x === "number" &&
      typeof bs.y === "number" &&
      typeof bs.z === "number"
    ) {
      const cx = bc.x;
      const cy = bc.y;
      const cz = bc.z;
      const sx = bs.x;
      const sy = bs.y;
      const sz = bs.z;
      this.levelBoundsAabb = {
        minX: cx - sx * 0.5,
        maxX: cx + sx * 0.5,
        minY: cy - sy * 0.5,
        maxY: cy + sy * 0.5,
        minZ: cz - sz * 0.5,
        maxZ: cz + sz * 0.5,
      };
    }

    console.log(
      `[GameRoom] Spawn points from host: ${enemySpawns.length} enemy, ${playerSpawns.length} player, ${missileSpawns.length} missile, ${weaponSpawns.length} weapon`,
    );

    const hasLevelSpawnsNow =
      this.levelSpawnPoints.length > 0 || this.levelPlayerSpawns.length > 0;
    if (
      this.state.phase === "playing" &&
      this.state.botsEnabled &&
      hasLevelSpawnsNow &&
      (enemySpawns.length > 0 || playerSpawns.length > 0)
    ) {
      this.state.bots.clear();
      this.botFireCooldowns.clear();
      this.botBrain.clear();
      this.botRespawnQueue = [];
      this.spawnBots();
    }
  }

  private handleChat(client: Client, data: any) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const text = String(data.text || "")
      .trim()
      .slice(0, 200); // Limit length
    if (!text) return;

    // Broadcast to all clients
    this.broadcast("chat", {
      senderId: client.sessionId,
      senderName: player.name,
      text: text,
      timestamp: Date.now(),
    });
  }

  onJoin(client: Client, options: any) {
    const player = new Player();
    player.id = client.sessionId;
    player.name = this.getUniqueName(
      options.name || `Player ${this.state.players.size + 1}`,
    );
    player.shipClass = "fighter";
    player.ready = false;
    player.alive = false;

    // Assign team in team mode
    if (this.state.mode === "team") {
      const players = [...this.state.players.values()] as Player[];
      const team1Count = players.filter((p) => p.team === 1).length;
      const team2Count = players.filter((p) => p.team === 2).length;
      player.team = team1Count <= team2Count ? 1 : 2;
    }

    const accentPicker =
      options?.quickMatch === true
        ? pickRandomFreeAccentColor
        : pickFirstFreeAccentColor;
    player.accentColor = accentPicker(
      this.state.players,
      LOBBY_COLOR_PALETTE,
      client.sessionId,
    );

    this.state.players.set(client.sessionId, player);

    // First player becomes host
    if (this.state.players.size === 1) {
      this.state.hostId = client.sessionId;
    }

    if (this.state.phase === "playing") {
      const spawnIndex = this.getRandomSpawnIndexForPlayers();
      this.spawnPlayer(player, spawnIndex);
      console.log(`[GameRoom] ${player.name} joined mid-game and spawned`);
    } else {
      console.log(`[GameRoom] ${player.name} joined (${client.sessionId})`);

      // Auto-start if requested and this is the only player (just created room)
      if (
        options.autoStart &&
        this.state.players.size === 1 &&
        this.state.phase === "lobby"
      ) {
        player.ready = true;
        console.log(`[GameRoom] Auto-starting for ${player.name}`);
        // Delay slightly to let client set up
        setTimeout(() => {
          if (this.state.phase === "lobby" && this.state.players.size >= 1) {
            this.startCountdown();
          }
        }, 500);
      }
    }
  }

  onLeave(client: Client, consented?: number) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      console.log(`[GameRoom] ${player.name} left`);
    }

    this.lastBoostInput.delete(client.sessionId);
    this.lastBoostTime.delete(client.sessionId);
    this.state.players.delete(client.sessionId);

    // Reassign host if host left
    if (this.state.hostId === client.sessionId && this.state.players.size > 0) {
      const newHost = Array.from(this.state.players.keys())[0];
      this.state.hostId = newHost;
      console.log(`[GameRoom] New host: ${newHost}`);
    }

    // Only end match if no players remain
    if (this.state.players.size === 0) {
      this.endMatch();
    }
  }

  onDispose() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
    console.log(`[GameRoom] Disposed: ${this.roomId}`);
  }

  private handleInput(client: Client, data: any) {
    if (this.state.phase !== "playing") return;

    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) return;

    const classStats =
      SHIP_CLASSES[player.shipClass as keyof typeof SHIP_CLASSES];
    const speedMod = classStats.speed;

    // Update position from client (server validates)
    player.x = data.x;
    player.y = data.y;
    player.z = data.z;
    player.qx = data.qx;
    player.qy = data.qy;
    player.qz = data.qz;
    player.qw = data.qw;
    player.vx = data.vx || 0;
    player.vy = data.vy || 0;
    player.vz = data.vz || 0;
    player.lastProcessedInput = data.seq || 0;
    if (data.boost !== undefined) {
      this.lastBoostInput.set(client.sessionId, !!data.boost);
    }
  }

  private handleFire(client: Client, data: any) {
    if (this.state.phase !== "playing") {
      console.log(`[GameRoom] Fire blocked - phase: ${this.state.phase}`);
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) {
      console.log(`[GameRoom] Fire blocked - player not found or dead`);
      return;
    }

    const classStats =
      SHIP_CLASSES[player.shipClass as keyof typeof SHIP_CLASSES];

    console.log(`[GameRoom] ${player.name} fired ${data.weapon}`);

    if (data.weapon === "laser") {
      this.spawnProjectile(player, data, "laser", classStats.laserSpeed, 25);
    } else if (data.weapon === "gatling") {
      if (!player.hasGatling) return;
      this.spawnProjectile(player, data, "gatling", GATLING_SPEED, GATLING_DAMAGE);
    } else if (data.weapon === "chargingLaser") {
      if (!player.hasChargingLaser) return;
      this.fireChargingLaser(player, data);
    } else if (data.weapon === "missile") {
      if (player.missiles > 0) {
        player.missiles--;
        const kinetic = data.variant === "kinetic";
        const missileDamage = kinetic
          ? Math.round(classStats.missileDamage * 1.5)
          : classStats.missileDamage;
        this.spawnProjectile(
          player,
          data,
          "missile",
          classStats.missileSpeed,
          missileDamage,
        );
      }
    }
  }

  private handleMissileUpdate(client: Client, data: any) {
    const proj = this.state.projectiles.get(data.id);
    if (!proj) return;

    // Only allow updates from the owner
    if (proj.ownerId !== client.sessionId) return;

    // Only update missiles, not lasers
    if (proj.type !== "missile") return;

    const prevX = proj.x;
    const prevY = proj.y;
    const prevZ = proj.z;

    // Update position and direction from client (for homing)
    proj.x = data.x;
    proj.y = data.y;
    proj.z = data.z;
    proj.dx = data.dx;
    proj.dy = data.dy;
    proj.dz = data.dz;

    // Missiles are not integrated in updateProjectiles(), so prev→current was always
    // a zero-length segment there (point test only). Fast homing can tunnel through
    // targets between ticks; swept test here uses each client update segment.
    const toRemove: string[] = [];
    this.checkSweptCollision(proj, data.id, prevX, prevY, prevZ, toRemove);
    if (toRemove.includes(data.id)) {
      this.state.projectiles.delete(data.id);
    }
  }

  private spawnProjectile(
    player: Player,
    data: any,
    type: string,
    speed: number,
    damage: number,
  ) {
    const proj = new Projectile();
    proj.id = `proj_${this.projectileIdCounter++}`;
    proj.ownerId = player.id;
    proj.x = data.x;
    proj.y = data.y;
    proj.z = data.z;
    proj.dx = data.dx;
    proj.dy = data.dy;
    proj.dz = data.dz;
    proj.speed = speed;
    proj.damage = damage;
    proj.type = type;
    proj.variant =
      type === "missile" && data.variant === "kinetic" ? "kinetic" : "homing";
    proj.lifetime =
      type === "missile" ? (proj.variant === "kinetic" ? 8 : 5) : 3;
    proj.length = data.length || 0;

    this.state.projectiles.set(proj.id, proj);
    console.log(
      `[GameRoom] Projectile spawned: ${proj.id} type=${type} pos=(${proj.x.toFixed(1)},${proj.y.toFixed(1)},${proj.z.toFixed(1)}) dir=(${proj.dx.toFixed(2)},${proj.dy.toFixed(2)},${proj.dz.toFixed(2)})`,
    );
  }

  private fireChargingLaser(player: Player, data: any) {
    const len = Math.max(4, Math.min(CHARGING_LASER_RANGE, data.length || CHARGING_LASER_RANGE));
    const visual = new Projectile();
    visual.id = `proj_${this.projectileIdCounter++}`;
    visual.ownerId = player.id;
    visual.x = data.x;
    visual.y = data.y;
    visual.z = data.z;
    visual.dx = data.dx;
    visual.dy = data.dy;
    visual.dz = data.dz;
    visual.speed = 0;
    visual.damage = 0;
    visual.type = "chargingLaser";
    visual.lifetime = 1;
    visual.length = len;
    this.state.projectiles.set(visual.id, visual);

    const end = {
      x: data.x + data.dx * len,
      y: data.y + data.dy * len,
      z: data.z + data.dz * len,
    };
    this.applyChargingLaserHits(player, data, end);
  }

  private distanceSqToSegment(
    point: { x: number; y: number; z: number },
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const lenSq = abx * abx + aby * aby + abz * abz;
    let t = 0;
    if (lenSq > 0.0001) {
      t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * abx + (point.y - a.y) * aby + (point.z - a.z) * abz) / lenSq,
        ),
      );
    }
    const x = a.x + abx * t;
    const y = a.y + aby * t;
    const z = a.z + abz * t;
    const dx = point.x - x;
    const dy = point.y - y;
    const dz = point.z - z;
    return { distSq: dx * dx + dy * dy + dz * dz, x, y, z };
  }

  private applyChargingLaserHits(
    shooter: Player,
    start: { x: number; y: number; z: number },
    end: { x: number; y: number; z: number },
  ) {
    this.state.players.forEach((player: Player) => {
      if (!player.alive || player.id === shooter.id) return;
      if (this.state.mode === "team" && shooter.team === player.team) return;
      const hit = this.distanceSqToSegment(player, start, end);
      if (hit.distSq > CHARGING_LASER_RADIUS * CHARGING_LASER_RADIUS) return;
      player.health -= CHARGING_LASER_DAMAGE;
      player.lastDamageTime = Date.now();
      this.broadcast("hit", {
        targetId: player.id,
        shooterId: shooter.id,
        shooterAccentColor: shooter.accentColor ?? "",
        damage: CHARGING_LASER_DAMAGE,
        weapon: "chargingLaser",
        x: hit.x,
        y: hit.y,
        z: hit.z,
      });
      if (player.health <= 0) this.handlePlayerDeath(player, shooter.id);
    });

    this.state.bots.forEach((bot: Bot, botId: string) => {
      const hit = this.distanceSqToSegment(bot, start, end);
      if (hit.distSq > CHARGING_LASER_RADIUS * CHARGING_LASER_RADIUS) return;
      bot.health -= CHARGING_LASER_DAMAGE;
      this.broadcast("hit", {
        targetId: botId,
        shooterId: shooter.id,
        shooterAccentColor: shooter.accentColor ?? "",
        damage: CHARGING_LASER_DAMAGE,
        weapon: "chargingLaser",
        x: hit.x,
        y: hit.y,
        z: hit.z,
      });
      if (bot.health <= 0) {
        const deathX = bot.x;
        const deathY = bot.y;
        const deathZ = bot.z;
        this.state.bots.delete(botId);
        this.botFireCooldowns.delete(botId);
        this.botBrain.delete(botId);
        this.botRespawnQueue.push({
          botId,
          timer: BOT_RESPAWN_TIME,
          x: bot.spawnX,
          y: bot.spawnY,
          z: bot.spawnZ,
        });
        this.broadcast("botDeath", { botId, x: deathX, y: deathY, z: deathZ });
      }
    });
  }

  private handleClassSelect(_client: Client, _data: any) {}

  private handleReady(client: Client) {
    if (this.state.phase !== "lobby") return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.ready = !player.ready;
  }

  private handleStartGame(client: Client) {
    if (this.state.phase !== "lobby") return;
    if (client.sessionId !== this.state.hostId) return;
    if (this.state.players.size < 1) return; // Allow 1 for testing, should be 2+

    // Check all players ready
    const players = [...this.state.players.values()] as Player[];
    const allReady = players.every((p) => p.ready);
    if (!allReady && this.state.players.size > 1) return;

    this.startCountdown();
  }

  private startCountdown() {
    this.state.phase = "countdown";
    this.state.countdown = 3;

    const countdownInterval = setInterval(() => {
      this.state.countdown--;
      if (this.state.countdown <= 0) {
        clearInterval(countdownInterval);
        this.startMatch();
      }
    }, 1000);
  }

  private startMatch() {
    this.state.phase = "playing";
    this.state.matchTime = 0;
    this.state.team1Score = 0;
    this.state.team2Score = 0;
    this.state.bots.clear();
    this.botFireCooldowns.clear();
    this.botBrain.clear();
    this.botRespawnQueue = [];

    let spawnIndex = 0;
    this.state.players.forEach((player: Player) => {
      this.spawnPlayer(player, spawnIndex);
      spawnIndex++;
    });

    this.spawnInitialCollectibles();

    if (this.state.botsEnabled) {
      this.scheduleInitialBotSpawn();
    }

    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);

    console.log(`[GameRoom] Match started!`);
  }

  /**
   * Do not spawn bots in startMatch() synchronously — host setSpawnPoints often arrives
   * after startMatch, so levelSpawnPoints were empty and bots used the tiny default ring.
   * Retry until level data exists, then fallback once.
   */
  private scheduleInitialBotSpawn() {
    const trySpawn = () => {
      if (this.state.phase !== "playing" || !this.state.botsEnabled) return;
      if (this.state.bots.size > 0) return;
      const hasLevel =
        this.levelSpawnPoints.length > 0 || this.levelPlayerSpawns.length > 0;
      if (!hasLevel) return;
      this.spawnBots();
    };

    trySpawn();
    setTimeout(trySpawn, 50);
    setTimeout(trySpawn, 200);
    setTimeout(trySpawn, 500);
    setTimeout(() => {
      if (this.state.phase !== "playing" || !this.state.botsEnabled) return;
      if (this.state.bots.size > 0) return;
      const hasLevel =
        this.levelSpawnPoints.length > 0 || this.levelPlayerSpawns.length > 0;
      if (hasLevel) {
        this.spawnBots();
      } else {
        console.warn(
          "[GameRoom] Bots: still no level spawn data from host; using fallback SPAWN_POINTS",
        );
        this.spawnBots();
      }
    }, 1200);
  }

  private spawnBots() {
    let points: { x: number; y: number; z: number }[];

    // spawnPlayer() uses: playerSpawns → else enemy spawns → else SPAWN_POINTS
    // spawnBots uses: enemy spawns → else player spawns → else SPAWN_POINTS
    const playerSpawnPool: "enemy" | "player" | "default" =
      this.levelPlayerSpawns.length > 0
        ? "player"
        : this.levelSpawnPoints.length > 0
          ? "enemy"
          : "default";
    const botSpawnPool: "enemy" | "player" | "default" =
      this.levelSpawnPoints.length > 0
        ? "enemy"
        : this.levelPlayerSpawns.length > 0
          ? "player"
          : "default";
    const botsSharePoolWithPlayers = playerSpawnPool === botSpawnPool;

    if (this.levelSpawnPoints.length > 0) {
      points = this.levelSpawnPoints;
    } else if (this.levelPlayerSpawns.length > 0) {
      points = this.levelPlayerSpawns;
    } else {
      points = SPAWN_POINTS.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    }

    const nPlayers = this.state.players.size;
    const pickIndex = botsSharePoolWithPlayers
      ? (i: number) => (nPlayers + i) % points.length
      : (i: number) => i % points.length;

    const count = Math.min(BOT_MAX_COUNT, points.length);
    for (let i = 0; i < count; i++) {
      const pt = points[pickIndex(i)];
      const botId = `bot_${this.botIdCounter++}`;
      const bot = new Bot();
      bot.id = botId;
      bot.x = pt.x;
      bot.y = pt.y;
      bot.z = pt.z;
      const dx = -pt.x;
      const dz = -pt.z;
      const angle = Math.atan2(dx, dz);
      bot.qy = Math.sin(angle / 2);
      bot.qw = Math.cos(angle / 2);
      bot.health = 100;
      bot.maxHealth = 100;
      bot.spawnX = pt.x;
      bot.spawnY = pt.y;
      bot.spawnZ = pt.z;
      bot.aggroReadyAt = this.state.matchTime + BOT_AGGRO_DELAY;
      this.state.bots.set(botId, bot);
      this.botFireCooldowns.set(botId, 0);
      this.initBotBrain(botId, bot);
    }
    console.log(`[GameRoom] Spawned ${count} bots`);
  }

  private spawnBotAt(botId: string, x: number, y: number, z: number) {
    const bot = new Bot();
    bot.id = botId;
    bot.x = x;
    bot.y = y;
    bot.z = z;
    bot.spawnX = x;
    bot.spawnY = y;
    bot.spawnZ = z;
    const angle = Math.atan2(-x, -z);
    bot.qy = Math.sin(angle / 2);
    bot.qw = Math.cos(angle / 2);
    bot.health = 100;
    bot.maxHealth = 100;
    bot.aggroReadyAt = this.state.matchTime + BOT_AGGRO_DELAY;
    this.state.bots.set(botId, bot);
    this.botFireCooldowns.set(botId, 0);
    this.initBotBrain(botId, bot);
  }

  private initBotBrain(botId: string, bot: Bot) {
    const wp = this.pickWanderWaypoint(bot);
    this.botBrain.set(botId, {
      mode: "wander",
      waypoint: wp,
      wanderCooldown: 0,
      wanderInterval: 4 + Math.random() * 4,
      losCounter: 0,
      hasLOS: false,
    });
  }

  private pickWanderWaypoint(bot: Bot) {
    let x = bot.spawnX + (Math.random() - 0.5) * 40 * 0.7;
    let y = bot.spawnY + (Math.random() - 0.5) * 20 * 0.7;
    let z = bot.spawnZ + (Math.random() - 0.5) * 40 * 0.7;
    const b = this.levelBoundsAabb;
    if (b) {
      const pad = 2;
      x = Math.max(b.minX + pad, Math.min(b.maxX - pad, x));
      y = Math.max(b.minY + pad, Math.min(b.maxY - pad, y));
      z = Math.max(b.minZ + pad, Math.min(b.maxZ - pad, z));
    }
    return { x, y, z };
  }

  /** Coarse LOS without server physics: elevation limit + segment samples inside level AABB (see Enemy.checkLOS + castRay). */
  private botHasApproxLineOfSight(
    bot: Bot,
    px: number,
    py: number,
    pz: number,
  ): boolean {
    const dx = px - bot.x;
    const dy = py - bot.y;
    const dz = pz - bot.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < 1e-4) return true;
    const horizSq = dx * dx + dz * dz;
    if (horizSq < 1e-6) {
      return Math.abs(dy) < 35;
    }
    const elev = Math.abs(dy) / Math.sqrt(horizSq);
    if (elev > 2.2) return false;

    const b = this.levelBoundsAabb;
    if (!b) return true;
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      const sx = bot.x + dx * t;
      const sy = bot.y + dy * t;
      const sz = bot.z + dz * t;
      if (
        sx < b.minX ||
        sx > b.maxX ||
        sy < b.minY ||
        sy > b.maxY ||
        sz < b.minZ ||
        sz > b.maxZ
      ) {
        return false;
      }
    }
    return true;
  }

  private updateBots(dt: number) {
    const alivePlayers: Player[] = [];
    this.state.players.forEach((p: Player) => {
      if (p.alive) alivePlayers.push(p);
    });
    if (alivePlayers.length === 0) return;

    this.state.bots.forEach((bot: Bot, botId: string) => {
      let brain = this.botBrain.get(botId);
      if (!brain) {
        this.initBotBrain(botId, bot);
        brain = this.botBrain.get(botId)!;
      }

      let nearestAny: Player | null = null;
      let nearestDistSq = Infinity;
      for (const p of alivePlayers) {
        const dx = p.x - bot.x;
        const dy = p.y - bot.y;
        const dz = p.z - bot.z;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq < nearestDistSq) {
          nearestDistSq = dSq;
          nearestAny = p;
        }
      }
      if (!nearestAny) return;

      let nearestIn: Player | null = null;
      let nearestInDistSq = Infinity;
      for (const p of alivePlayers) {
        const dx = p.x - bot.x;
        const dy = p.y - bot.y;
        const dz = p.z - bot.z;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq <= BOT_DETECTION_RANGE_SQ && dSq < nearestInDistSq) {
          nearestInDistSq = dSq;
          nearestIn = p;
        }
      }

      brain.losCounter++;
      if (brain.losCounter >= BOT_LOS_CHECK_TICKS) {
        brain.losCounter = 0;
        brain.hasLOS = nearestIn
          ? this.botHasApproxLineOfSight(
              bot,
              nearestIn.x,
              nearestIn.y,
              nearestIn.z,
            )
          : false;
      }

      if (brain.hasLOS) {
        brain.mode = "attack";
      } else if (
        brain.mode === "attack" &&
        nearestDistSq >= BOT_DETECTION_RANGE_SQ
      ) {
        brain.mode = "wander";
      }

      if (nearestDistSq > BOT_DETECTION_RANGE_SQ && brain.mode === "wander") {
        return;
      }

      const canAggro = this.state.matchTime >= bot.aggroReadyAt;
      let cooldown = this.botFireCooldowns.get(botId) ?? 0;
      cooldown -= dt;
      this.botFireCooldowns.set(botId, cooldown);

      if (brain.mode === "attack" && nearestIn && canAggro) {
        const dx = nearestIn.x - bot.x;
        const dy = nearestIn.y - bot.y;
        const dz = nearestIn.z - bot.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const dirX = dx / len;
        const dirY = dy / len;
        const dirZ = dz / len;

        const lookY = Math.atan2(-dx, -dz);
        bot.qx = 0;
        bot.qy = Math.sin(lookY / 2);
        bot.qz = 0;
        bot.qw = Math.cos(lookY / 2);

        if (nearestInDistSq > BOT_CLOSE_HOLD_SQ) {
          bot.x += dirX * BOT_SPEED * dt;
          bot.y += dirY * BOT_SPEED * dt;
          bot.z += dirZ * BOT_SPEED * dt;
        }

        if (
          brain.hasLOS &&
          cooldown <= 0 &&
          nearestInDistSq < BOT_ATTACK_RANGE_SQ
        ) {
          const muzzleX = bot.x - dirX * 2;
          const muzzleY = bot.y - dirY * 2;
          const muzzleZ = bot.z - dirZ * 2;
          this.spawnProjectileFromBot(
            botId,
            muzzleX,
            muzzleY,
            muzzleZ,
            dirX,
            dirY,
            dirZ,
          );
          this.botFireCooldowns.set(botId, BOT_FIRE_INTERVAL);
        }
      } else if (brain.mode === "wander") {
        brain.wanderCooldown += dt;
        const wx = brain.waypoint.x - bot.x;
        const wy = brain.waypoint.y - bot.y;
        const wz = brain.waypoint.z - bot.z;
        const distW = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1e-6;
        if (distW < 3 || brain.wanderCooldown >= brain.wanderInterval) {
          brain.waypoint = this.pickWanderWaypoint(bot);
          brain.wanderInterval = 3 + Math.random() * 5;
          brain.wanderCooldown = 0;
        }
        const wx2 = brain.waypoint.x - bot.x;
        const wy2 = brain.waypoint.y - bot.y;
        const wz2 = brain.waypoint.z - bot.z;
        const lenW = Math.sqrt(wx2 * wx2 + wy2 * wy2 + wz2 * wz2) || 1e-6;
        const nx = wx2 / lenW;
        const ny = wy2 / lenW;
        const nz = wz2 / lenW;
        if (canAggro) {
          bot.x += nx * BOT_WANDER_SPEED * dt;
          bot.y += ny * BOT_WANDER_SPEED * dt;
          bot.z += nz * BOT_WANDER_SPEED * dt;
        }
        const lookY = Math.atan2(-nx, -nz);
        bot.qx = 0;
        bot.qy = Math.sin(lookY / 2);
        bot.qz = 0;
        bot.qw = Math.cos(lookY / 2);
      }
    });

    for (let i = this.botRespawnQueue.length - 1; i >= 0; i--) {
      const entry = this.botRespawnQueue[i];
      entry.timer -= dt;
      if (entry.timer <= 0) {
        this.botRespawnQueue.splice(i, 1);
        const newId = `bot_${this.botIdCounter++}`;
        this.spawnBotAt(newId, entry.x, entry.y, entry.z);
      }
    }
  }

  private spawnProjectileFromBot(
    botId: string,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
  ) {
    const proj = new Projectile();
    proj.id = `proj_${this.projectileIdCounter++}`;
    proj.ownerId = botId;
    proj.x = x;
    proj.y = y;
    proj.z = z;
    proj.dx = dx;
    proj.dy = dy;
    proj.dz = dz;
    proj.speed = BOT_LASER_SPEED;
    proj.damage = BOT_LASER_DAMAGE;
    proj.type = "laser";
    proj.lifetime = 3;
    this.state.projectiles.set(proj.id, proj);
  }

  private spawnInitialCollectibles() {
    this.state.collectibles.clear();
    this.collectibleRespawnTimers.clear();

    if (this.levelMissileSpawns.length > 0 || this.levelWeaponSpawns.length > 0) {
      this.spawnCollectiblesAtLevelPoints();
    } else {
      const usedPositions: { x: number; z: number }[] = [];
      for (let i = 0; i < 2; i++) {
        const missilePos = this.getRandomCollectiblePosition(usedPositions);
        usedPositions.push(missilePos);
        this.spawnCollectible("missile", missilePos.x, 0, missilePos.z);

        const laserPos = this.getRandomCollectiblePosition(usedPositions);
        usedPositions.push(laserPos);
        this.spawnCollectible("laser_upgrade", laserPos.x, 0, laserPos.z);
      }
    }
    console.log(
      `[GameRoom] Spawned ${this.state.collectibles.size} collectibles`,
    );
  }

  private spawnCollectiblesAtLevelPoints() {
    for (const pt of this.levelMissileSpawns) {
      this.spawnCollectible("missile", pt.x, pt.y, pt.z);
    }
    for (const pt of this.levelWeaponSpawns) {
      this.spawnCollectible(pt.type, pt.x, pt.y, pt.z);
    }
  }

  private respawnCollectiblesAtLevelPoints() {
    this.state.collectibles.clear();
    this.collectibleRespawnTimers.clear();
    this.spawnCollectiblesAtLevelPoints();
    console.log(
      `[GameRoom] Re-spawned ${this.state.collectibles.size} collectibles at level points`,
    );
  }

  private getRandomCollectiblePosition(
    usedPositions: { x: number; z: number }[],
  ): { x: number; z: number } {
    const maxAttempts = 20;
    const minDistance = 10;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const spawn =
        SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * COLLECTIBLE_SPAWN_RADIUS;

      const x = spawn.x + Math.cos(angle) * dist;
      const z = spawn.z + Math.sin(angle) * dist;

      // Check distance from used positions
      let tooClose = false;
      for (const pos of usedPositions) {
        const dx = x - pos.x;
        const dz = z - pos.z;
        if (dx * dx + dz * dz < minDistance * minDistance) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        return { x, z };
      }
    }

    // Fallback: return a random position
    return {
      x: (Math.random() - 0.5) * 40,
      z: (Math.random() - 0.5) * 40,
    };
  }

  private spawnCollectible(type: string, x: number, y: number, z: number) {
    const collectible = new Collectible();
    collectible.id = `collect_${this.collectibleIdCounter++}`;
    collectible.type = type;
    collectible.x = x;
    collectible.y = y;
    collectible.z = z;
    collectible.rotY = 0;

    this.state.collectibles.set(collectible.id, collectible);
    console.log(
      `[GameRoom] Spawned ${type} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`,
    );
  }

  private getUniqueName(baseName: string): string {
    const existingNames = new Set<string>();
    this.state.players.forEach((p: Player) => existingNames.add(p.name));

    if (!existingNames.has(baseName)) {
      return baseName;
    }

    let counter = 1;
    let newName = `${baseName} (${counter})`;
    while (existingNames.has(newName)) {
      counter++;
      newName = `${baseName} (${counter})`;
    }
    return newName;
  }

  /** Random index into the same pool spawnPlayer() uses (player → enemy → default). */
  private getRandomSpawnIndexForPlayers(): number {
    if (this.levelPlayerSpawns.length > 0) {
      return Math.floor(Math.random() * this.levelPlayerSpawns.length);
    }
    if (this.levelSpawnPoints.length > 0) {
      return Math.floor(Math.random() * this.levelSpawnPoints.length);
    }
    return Math.floor(Math.random() * SPAWN_POINTS.length);
  }

  private spawnPlayer(player: Player, spawnIndex: number) {
    const classStats =
      SHIP_CLASSES[player.shipClass as keyof typeof SHIP_CLASSES];
    let x: number,
      y: number,
      z: number,
      qx: number,
      qy: number,
      qz: number,
      qw: number;

    if (this.levelPlayerSpawns.length > 0) {
      const pt =
        this.levelPlayerSpawns[spawnIndex % this.levelPlayerSpawns.length];
      x = pt.x;
      y = pt.y;
      z = pt.z;
      if (
        pt.qw !== undefined &&
        pt.qx !== undefined &&
        pt.qy !== undefined &&
        pt.qz !== undefined
      ) {
        qx = pt.qx;
        qy = pt.qy;
        qz = pt.qz;
        qw = pt.qw;
      } else {
        const dx = -x;
        const dz = -z;
        const angle = Math.atan2(dx, dz);
        qx = 0;
        qy = Math.sin(angle / 2);
        qz = 0;
        qw = Math.cos(angle / 2);
      }
    } else if (this.levelSpawnPoints.length > 0) {
      const pt =
        this.levelSpawnPoints[spawnIndex % this.levelSpawnPoints.length];
      x = pt.x;
      y = pt.y;
      z = pt.z;
      const dx = -x;
      const dz = -z;
      const angle = Math.atan2(dx, dz);
      qx = 0;
      qy = Math.sin(angle / 2);
      qz = 0;
      qw = Math.cos(angle / 2);
    } else {
      const spawn = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
      x = spawn.x;
      y = spawn.y;
      z = spawn.z;
      qx = 0;
      qy = spawn.qy;
      qz = 0;
      qw = spawn.qw;
    }

    player.x = x;
    player.y = y;
    player.z = z;
    player.qx = qx;
    player.qy = qy;
    player.qz = qz;
    player.qw = qw;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.health = classStats.health;
    player.maxHealth = classStats.health;
    player.missiles = classStats.missiles;
    player.maxMissiles = classStats.maxMissiles;
    player.boostFuel = BOOST_MAX_FUEL;
    player.maxBoostFuel = BOOST_MAX_FUEL;
    player.isBoosting = false;
    player.hasLaserUpgrade = false;
    player.hasChargingLaser = player.hasChargingLaser === true;
    player.hasGatling = player.hasGatling === true;
    player.lastDamageTime = 0;
    player.alive = true;
    player.respawnTime = 0;
    this.lastBoostTime.set(player.id, 0);
  }

  private tick() {
    const dt = 1 / TICK_RATE;

    this.state.matchTime += dt;

    this.updateProjectiles(dt);

    if (this.state.botsEnabled) {
      this.updateBots(dt);
    }

    this.updateCollectibles(dt);
    this.updateShieldRegen(dt);
    this.updateBoost(dt);
    this.handleRespawns(dt);
    this.checkMatchEnd();
  }

  private updateProjectiles(dt: number) {
    const toRemove: string[] = [];

    this.state.projectiles.forEach((proj: Projectile, id: string) => {
      // Store previous position for swept collision
      const prevX = proj.x;
      const prevY = proj.y;
      const prevZ = proj.z;

      // Only move lasers server-side; missiles are moved by owner's client via missileUpdate
      if (proj.type !== "missile" && proj.type !== "chargingLaser") {
        proj.x += proj.dx * proj.speed * dt;
        proj.y += proj.dy * proj.speed * dt;
        proj.z += proj.dz * proj.speed * dt;
      }
      proj.lifetime -= dt;

      if (proj.lifetime <= 0) {
        toRemove.push(id);
      } else if (proj.type !== "missile" && proj.type !== "chargingLaser") {
        // Lasers: swept segment from tick integration. Missiles: swept in handleMissileUpdate
        // (per client segment); doing it here would be prev===current (point-only).
        this.checkSweptCollision(proj, id, prevX, prevY, prevZ, toRemove);
      }
    });

    toRemove.forEach((id) => this.state.projectiles.delete(id));
  }

  private checkSweptCollision(
    proj: Projectile,
    projId: string,
    prevX: number,
    prevY: number,
    prevZ: number,
    toRemove: string[],
  ) {
    if (toRemove.includes(projId)) return;

    const hitRadius = 2.5;

    this.state.players.forEach((player: Player) => {
      if (!player.alive) return;
      if (player.id === proj.ownerId) return;
      if (toRemove.includes(projId)) return;

      // Team check
      if (this.state.mode === "team") {
        const owner = this.state.players.get(proj.ownerId);
        if (owner && owner.team === player.team) return;
      }

      // Swept sphere collision: find closest point on line segment to player
      const segX = proj.x - prevX;
      const segY = proj.y - prevY;
      const segZ = proj.z - prevZ;
      const segLenSq = segX * segX + segY * segY + segZ * segZ;

      // Vector from prev to player
      const toPlayerX = player.x - prevX;
      const toPlayerY = player.y - prevY;
      const toPlayerZ = player.z - prevZ;

      let closestX = prevX,
        closestY = prevY,
        closestZ = prevZ;

      if (segLenSq > 0.0001) {
        // Project player onto line segment
        const t = Math.max(
          0,
          Math.min(
            1,
            (toPlayerX * segX + toPlayerY * segY + toPlayerZ * segZ) / segLenSq,
          ),
        );
        closestX = prevX + t * segX;
        closestY = prevY + t * segY;
        closestZ = prevZ + t * segZ;
      }

      // Check distance from closest point to player
      const dx = player.x - closestX;
      const dy = player.y - closestY;
      const dz = player.z - closestZ;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < hitRadius * hitRadius) {
        player.health -= proj.damage;
        player.lastDamageTime = Date.now();
        toRemove.push(projId);

        const shooterPlayer = this.state.players.get(proj.ownerId);
        this.broadcast("hit", {
          targetId: player.id,
          shooterId: proj.ownerId,
          shooterAccentColor: shooterPlayer?.accentColor ?? "",
          damage: proj.damage,
          x: closestX,
          y: closestY,
          z: closestZ,
        });

        if (player.health <= 0) {
          this.handlePlayerDeath(player, proj.ownerId);
        }
      }
    });

    const isBotProjectile = proj.ownerId.startsWith("bot_");
    if (!isBotProjectile) {
      this.state.bots.forEach((bot: Bot, botId: string) => {
        if (toRemove.includes(projId)) return;

        const toBotX = bot.x - prevX;
        const toBotY = bot.y - prevY;
        const toBotZ = bot.z - prevZ;
        const segX = proj.x - prevX;
        const segY = proj.y - prevY;
        const segZ = proj.z - prevZ;
        const segLenSq = segX * segX + segY * segY + segZ * segZ;

        let closestX = prevX,
          closestY = prevY,
          closestZ = prevZ;
        if (segLenSq > 0.0001) {
          const t = Math.max(
            0,
            Math.min(
              1,
              (toBotX * segX + toBotY * segY + toBotZ * segZ) / segLenSq,
            ),
          );
          closestX = prevX + t * segX;
          closestY = prevY + t * segY;
          closestZ = prevZ + t * segZ;
        }
        const dbx = bot.x - closestX;
        const dby = bot.y - closestY;
        const dbz = bot.z - closestZ;
        const distSqBot = dbx * dbx + dby * dby + dbz * dbz;
        if (distSqBot < BOT_HIT_RADIUS * BOT_HIT_RADIUS) {
          bot.health -= proj.damage;
          const br = this.botBrain.get(botId);
          if (br) {
            br.mode = "attack";
            br.hasLOS = true;
          }
          toRemove.push(projId);

          const shooterForBotHit = this.state.players.get(proj.ownerId);
          this.broadcast("hit", {
            targetId: botId,
            shooterId: proj.ownerId,
            shooterAccentColor: shooterForBotHit?.accentColor ?? "",
            damage: proj.damage,
            x: closestX,
            y: closestY,
            z: closestZ,
          });

          if (bot.health <= 0) {
            const deathX = bot.x;
            const deathY = bot.y;
            const deathZ = bot.z;
            this.state.bots.delete(botId);
            this.botFireCooldowns.delete(botId);
            this.botBrain.delete(botId);
            this.botRespawnQueue.push({
              botId,
              timer: BOT_RESPAWN_TIME,
              x: bot.spawnX,
              y: bot.spawnY,
              z: bot.spawnZ,
            });
            this.broadcast("botDeath", {
              botId,
              x: deathX,
              y: deathY,
              z: deathZ,
            });
          }
        }
      });
    }
  }

  private updateCollectibles(dt: number) {
    // Update rotation for visual effect
    this.state.collectibles.forEach((collectible: Collectible) => {
      collectible.rotY += dt * 2; // Rotate ~2 radians per second
      if (collectible.rotY > Math.PI * 2) {
        collectible.rotY -= Math.PI * 2;
      }
    });

    // Check player-collectible collisions
    const toRemove: string[] = [];

    this.state.collectibles.forEach((collectible: Collectible, id: string) => {
      this.state.players.forEach((player: Player) => {
        if (!player.alive) return;

        const dx = player.x - collectible.x;
        const dy = player.y - collectible.y;
        const dz = player.z - collectible.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < COLLECTIBLE_COLLECT_RADIUS * COLLECTIBLE_COLLECT_RADIUS) {
          if (collectible.type === "missile") {
            const classStats =
              SHIP_CLASSES[player.shipClass as keyof typeof SHIP_CLASSES];
            if (player.missiles >= classStats.maxMissiles) return;
          } else if (
            collectible.type === "charging_laser" &&
            player.hasChargingLaser
          ) {
            return;
          } else if (collectible.type === "gatling" && player.hasGatling) {
            return;
          }
          this.handleCollectiblePickup(player, collectible);
          toRemove.push(id);
          this.collectibleRespawnTimers.set(id, COLLECTIBLE_RESPAWN_TIME);
        }
      });
    });

    // Remove collected collectibles
    toRemove.forEach((id) => this.state.collectibles.delete(id));

    // Handle respawn timers
    const toRespawn: string[] = [];
    this.collectibleRespawnTimers.forEach((time, id) => {
      const newTime = time - dt;
      if (newTime <= 0) {
        toRespawn.push(id);
      } else {
        this.collectibleRespawnTimers.set(id, newTime);
      }
    });

    toRespawn.forEach((id) => {
      this.collectibleRespawnTimers.delete(id);
      if (this.levelMissileSpawns.length > 0 || this.levelWeaponSpawns.length > 0) {
        const weaponPool = this.levelWeaponSpawns.filter(
          (pt) =>
            pt.type === "charging_laser" || pt.type === "gatling",
        );
        if (
          weaponPool.length > 0 &&
          (this.levelMissileSpawns.length === 0 || Math.random() > 0.55)
        ) {
          const pt = weaponPool[Math.floor(Math.random() * weaponPool.length)];
          this.spawnCollectible(pt.type, pt.x, pt.y, pt.z);
          return;
        }
        const pt =
          this.levelMissileSpawns[
            Math.floor(Math.random() * this.levelMissileSpawns.length)
          ];
        if (pt) this.spawnCollectible("missile", pt.x, pt.y, pt.z);
      } else {
        const type = Math.random() > 0.5 ? "missile" : "laser_upgrade";
        const pos = this.getRandomCollectiblePosition([]);
        this.spawnCollectible(type, pos.x, 0, pos.z);
      }
    });
  }

  private handleCollectiblePickup(player: Player, collectible: Collectible) {
    const classStats =
      SHIP_CLASSES[player.shipClass as keyof typeof SHIP_CLASSES];

    if (collectible.type === "missile") {
      // Refill missiles up to max
      const maxMissiles = classStats.maxMissiles;
      const oldMissiles = player.missiles;
      player.missiles = Math.min(
        maxMissiles,
        player.missiles + Math.ceil(maxMissiles / 2),
      );
      console.log(
        `[GameRoom] ${player.name} picked up missiles: ${oldMissiles} -> ${player.missiles}`,
      );
    } else if (collectible.type === "laser_upgrade") {
      player.hasLaserUpgrade = true;
      console.log(`[GameRoom] ${player.name} picked up laser upgrade`);
    } else if (collectible.type === "charging_laser") {
      player.hasChargingLaser = true;
      console.log(`[GameRoom] ${player.name} picked up charging laser`);
    } else if (collectible.type === "gatling") {
      player.hasGatling = true;
      console.log(`[GameRoom] ${player.name} picked up gatling`);
    }

    // Broadcast pickup event
    this.broadcast("collectiblePickup", {
      playerId: player.id,
      collectibleId: collectible.id,
      type: collectible.type,
      x: collectible.x,
      y: collectible.y,
      z: collectible.z,
    });
  }

  private updateShieldRegen(dt: number) {
    const REGEN_DELAY = 5000; // 5 seconds in ms
    const REGEN_RATE = 15; // HP per second
    const now = Date.now();

    this.state.players.forEach((player: Player) => {
      if (!player.alive) return;
      if (player.health >= player.maxHealth) return;
      if (now - player.lastDamageTime < REGEN_DELAY) return;

      player.health = Math.min(
        player.maxHealth,
        player.health + REGEN_RATE * dt,
      );
    });
  }

  private updateBoost(dt: number) {
    this.state.players.forEach((player: Player, sessionId: string) => {
      if (!player.alive) return;

      const boostHeld = this.lastBoostInput.get(sessionId) ?? false;
      const velSq =
        player.vx * player.vx + player.vy * player.vy + player.vz * player.vz;
      const isMoving = velSq > 0.01;

      if (boostHeld && player.boostFuel > 0 && isMoving) {
        player.boostFuel = Math.max(
          0,
          player.boostFuel - BOOST_DRAIN_RATE * dt,
        );
        player.isBoosting = true;
        this.lastBoostTime.set(sessionId, this.state.matchTime);
      } else {
        player.isBoosting = false;
        const lastBoost = this.lastBoostTime.get(sessionId) ?? 0;
        if (this.state.matchTime - lastBoost >= BOOST_REGEN_DELAY) {
          player.boostFuel = Math.min(
            player.maxBoostFuel,
            player.boostFuel + BOOST_REGEN_RATE * dt,
          );
        }
      }
    });
  }

  private checkCollisions() {
    // Collision checking is now done in updateProjectiles via swept collision
  }

  private handlePlayerDeath(player: Player, killerId: string) {
    player.alive = false;
    player.deaths++;
    player.respawnTime = RESPAWN_TIME;

    const killer = this.state.players.get(killerId);
    if (killer && killer.id !== player.id) {
      killer.kills++;

      // Update team score
      if (this.state.mode === "team") {
        if (killer.team === 1) this.state.team1Score++;
        else if (killer.team === 2) this.state.team2Score++;
      }
    }

    this.broadcast("kill", {
      victimId: player.id,
      victimName: player.name,
      killerId: killerId,
      killerName: killer?.name || "Unknown",
    });
  }

  private handleRespawns(dt: number) {
    this.state.players.forEach((player: Player) => {
      if (!player.alive && player.respawnTime > 0) {
        player.respawnTime -= dt;

        if (player.respawnTime <= 0) {
          const spawnIndex = this.getRandomSpawnIndexForPlayers();
          this.spawnPlayer(player, spawnIndex);

          this.broadcast("respawn", {
            playerId: player.id,
            x: player.x,
            y: player.y,
            z: player.z,
            qx: player.qx,
            qy: player.qy,
            qz: player.qz,
            qw: player.qw,
          });
        }
      }
    });
  }

  private checkMatchEnd() {
    // Time limit
    if (this.state.matchTime >= this.state.maxMatchTime) {
      this.endMatch();
      return;
    }

    // Kill limit
    if (this.state.mode === "ffa") {
      const players = [...this.state.players.values()] as Player[];
      const topKills = Math.max(...players.map((p) => p.kills));
      if (topKills >= this.state.killLimit) {
        this.endMatch();
        return;
      }
    } else {
      if (
        this.state.team1Score >= this.state.killLimit ||
        this.state.team2Score >= this.state.killLimit
      ) {
        this.endMatch();
        return;
      }
    }
  }

  private endMatch() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    this.state.phase = "results";
    this.state.projectiles.clear();
    this.state.bots.clear();
    this.botFireCooldowns.clear();
    this.botBrain.clear();
    this.botRespawnQueue = [];

    // Determine winner
    let winner = "";
    if (this.state.mode === "ffa") {
      const players = [...this.state.players.values()] as Player[];
      const sorted = players.sort((a, b) => b.kills - a.kills);
      winner = sorted[0]?.name || "No one";
    } else {
      winner =
        this.state.team1Score > this.state.team2Score
          ? "Red Team"
          : this.state.team2Score > this.state.team1Score
            ? "Blue Team"
            : "Tie";
    }

    this.broadcast("matchEnd", {
      winner,
      team1Score: this.state.team1Score,
      team2Score: this.state.team2Score,
    });

    console.log(`[GameRoom] Match ended. Winner: ${winner}`);

    // Return to lobby after delay
    setTimeout(() => {
      this.state.phase = "lobby";
      this.levelSpawnPoints = [];
      this.levelPlayerSpawns = [];
      this.levelMissileSpawns = [];
      this.levelWeaponSpawns = [];
      this.state.players.forEach((p: Player) => {
        p.ready = false;
        p.kills = 0;
        p.deaths = 0;
      });
    }, 10000);
  }
}
