import { Room, Client, CloseCode, matchMaker } from "colyseus";
import { GameState, Player, Projectile, Collectible } from "./schema/GameState.js";

const SHIP_CLASSES = {
  fighter: { speed: 1.0, health: 100, missiles: 6, maxMissiles: 6, projectileSpeed: 60, missileDamage: 75 },
  tank: { speed: 0.7, health: 150, missiles: 8, maxMissiles: 8, projectileSpeed: 50, missileDamage: 150 },
  rogue: { speed: 1.4, health: 70, missiles: 4, maxMissiles: 4, projectileSpeed: 80, missileDamage: 60 },
};

// Spawn points with rotation facing center (0,0,0)
// Quaternion for Y-axis rotation: qy = sin(θ/2), qw = cos(θ/2)
const SPAWN_POINTS = [
  { x: 0, y: 0, z: 5, qy: 1, qw: 0 },           // Center-ish, facing -Z (180°)
  { x: 20, y: 0, z: 0, qy: 0.707, qw: 0.707 },  // East, facing -X (90°)
  { x: -20, y: 0, z: 0, qy: -0.707, qw: 0.707 }, // West, facing +X (-90°)
  { x: 0, y: 0, z: 20, qy: 1, qw: 0 },          // South, facing -Z (180°)
  { x: 0, y: 0, z: -20, qy: 0, qw: 1 },         // North, facing +Z (0°)
  { x: 15, y: 0, z: 15, qy: 0.924, qw: 0.383 }, // SE, facing NW (135°)
  { x: -15, y: 0, z: 15, qy: -0.924, qw: 0.383 }, // SW, facing NE (-135°)
  { x: 15, y: 0, z: -15, qy: 0.383, qw: 0.924 }, // NE, facing SW (45°)
];

const TICK_RATE = 20;
const RESPAWN_TIME = 5;
const COLLECTIBLE_SPAWN_RADIUS = 25;
const COLLECTIBLE_COLLECT_RADIUS = 3;
const COLLECTIBLE_RESPAWN_TIME = 15;

export class GameRoom extends Room<GameState> {
  maxClients = 8;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private projectileIdCounter = 0;
  private collectibleIdCounter = 0;
  private collectibleRespawnTimers: Map<string, number> = new Map();

  async onCreate(options: any) {
    this.setState(new GameState());
    
    // Use custom room ID if provided, but check if it already exists
    if (options.roomId) {
      const existingRooms = await matchMaker.query({ name: "game_room" });
      const exists = existingRooms.some(room => 
        room.roomId.toUpperCase() === options.roomId.toUpperCase()
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
    this.state.killLimit = options.killLimit || 20;
    this.state.maxMatchTime = options.maxMatchTime || 300;
    this.state.maxPlayers = this.maxClients;

    // Set room metadata for listing
    this.setMetadata({
      roomName: this.state.roomName,
      mode: this.state.mode,
      isPublic: this.state.isPublic,
      maxPlayers: this.maxClients,
    });

    this.registerMessageHandlers();
    
    console.log(`[GameRoom] Created: ${this.roomId} (${this.state.mode}, public: ${this.state.isPublic})`);
  }

  private registerMessageHandlers() {
    this.onMessage("input", (client, data) => this.handleInput(client, data));
    this.onMessage("fire", (client, data) => this.handleFire(client, data));
    this.onMessage("classSelect", (client, data) => this.handleClassSelect(client, data));
    this.onMessage("ready", (client) => this.handleReady(client));
    this.onMessage("startGame", (client) => this.handleStartGame(client));
  }

  onJoin(client: Client, options: any) {
    const player = new Player();
    player.id = client.sessionId;
    player.name = this.getUniqueName(options.name || `Player ${this.state.players.size + 1}`);
    player.shipClass = options.shipClass || "fighter";
    player.ready = false;
    player.alive = false;
    
    // Assign team in team mode
    if (this.state.mode === "team") {
      const team1Count = Array.from(this.state.players.values()).filter(p => p.team === 1).length;
      const team2Count = Array.from(this.state.players.values()).filter(p => p.team === 2).length;
      player.team = team1Count <= team2Count ? 1 : 2;
    }
    
    this.state.players.set(client.sessionId, player);
    
    // First player becomes host
    if (this.state.players.size === 1) {
      this.state.hostId = client.sessionId;
    }
    
    // If game is already in progress, spawn the player immediately
    if (this.state.phase === "playing") {
      const spawnIndex = Math.floor(Math.random() * SPAWN_POINTS.length);
      this.spawnPlayer(player, spawnIndex);
      console.log(`[GameRoom] ${player.name} joined mid-game and spawned`);
    } else {
      console.log(`[GameRoom] ${player.name} joined (${client.sessionId})`);
    }
  }

  onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      console.log(`[GameRoom] ${player.name} left`);
    }
    
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
    
    const classStats = SHIP_CLASSES[player.shipClass as keyof typeof SHIP_CLASSES];
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
    
    const classStats = SHIP_CLASSES[player.shipClass as keyof typeof SHIP_CLASSES];
    
    console.log(`[GameRoom] ${player.name} fired ${data.weapon}`);
    
    if (data.weapon === "laser") {
      this.spawnProjectile(player, data, "laser", classStats.projectileSpeed, 25);
    } else if (data.weapon === "missile") {
      if (player.missiles > 0) {
        player.missiles--;
        this.spawnProjectile(player, data, "missile", 30, classStats.missileDamage);
      }
    }
  }

  private spawnProjectile(player: Player, data: any, type: string, speed: number, damage: number) {
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
    proj.lifetime = type === "missile" ? 5 : 3;
    
    this.state.projectiles.set(proj.id, proj);
    console.log(`[GameRoom] Projectile spawned: ${proj.id} type=${type} pos=(${proj.x.toFixed(1)},${proj.y.toFixed(1)},${proj.z.toFixed(1)}) dir=(${proj.dx.toFixed(2)},${proj.dy.toFixed(2)},${proj.dz.toFixed(2)})`);
  }

  private handleClassSelect(client: Client, data: any) {
    if (this.state.phase !== "lobby") return;
    
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    
    if (["fighter", "tank", "rogue"].includes(data.shipClass)) {
      player.shipClass = data.shipClass;
      player.ready = false; // Reset ready when changing class
    }
  }

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
    const allReady = Array.from(this.state.players.values()).every(p => p.ready);
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
    
    // Spawn all players
    let spawnIndex = 0;
    this.state.players.forEach((player) => {
      this.spawnPlayer(player, spawnIndex);
      spawnIndex++;
    });
    
    // Spawn initial collectibles
    this.spawnInitialCollectibles();
    
    // Start game tick
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);
    
    console.log(`[GameRoom] Match started!`);
  }

  private spawnInitialCollectibles() {
    // Clear any existing collectibles
    this.state.collectibles.clear();
    this.collectibleRespawnTimers.clear();
    
    // Spawn 2 missile pickups and 2 laser upgrades near different spawn points
    const usedPositions: { x: number; z: number }[] = [];
    
    for (let i = 0; i < 2; i++) {
      // Missile pickup
      const missilePos = this.getRandomCollectiblePosition(usedPositions);
      usedPositions.push(missilePos);
      this.spawnCollectible("missile", missilePos.x, 0, missilePos.z);
      
      // Laser upgrade
      const laserPos = this.getRandomCollectiblePosition(usedPositions);
      usedPositions.push(laserPos);
      this.spawnCollectible("laser_upgrade", laserPos.x, 0, laserPos.z);
    }
    
    console.log(`[GameRoom] Spawned ${this.state.collectibles.size} collectibles`);
  }

  private getRandomCollectiblePosition(usedPositions: { x: number; z: number }[]): { x: number; z: number } {
    const maxAttempts = 20;
    const minDistance = 10;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
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
      z: (Math.random() - 0.5) * 40
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
    console.log(`[GameRoom] Spawned ${type} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
  }

  private getUniqueName(baseName: string): string {
    const existingNames = new Set<string>();
    this.state.players.forEach((p) => existingNames.add(p.name));
    
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

  private spawnPlayer(player: Player, spawnIndex: number) {
    const spawn = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
    const classStats = SHIP_CLASSES[player.shipClass as keyof typeof SHIP_CLASSES];
    
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.qx = 0;
    player.qy = spawn.qy;
    player.qz = 0;
    player.qw = spawn.qw;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.health = classStats.health;
    player.maxHealth = classStats.health;
    player.missiles = classStats.missiles;
    player.maxMissiles = classStats.maxMissiles;
    player.hasLaserUpgrade = false;
    player.lastDamageTime = 0;
    player.alive = true;
    player.respawnTime = 0;
  }

  private tick() {
    const dt = 1 / TICK_RATE;
    
    this.state.matchTime += dt;
    
    // Update projectiles (includes swept collision detection)
    this.updateProjectiles(dt);
    
    // Update collectibles (rotation and collection detection)
    this.updateCollectibles(dt);
    
    // Handle shield regeneration
    this.updateShieldRegen(dt);
    
    // Handle respawns
    this.handleRespawns(dt);
    
    // Check match end conditions
    this.checkMatchEnd();
  }

  private updateProjectiles(dt: number) {
    const toRemove: string[] = [];
    
    this.state.projectiles.forEach((proj, id) => {
      // Store previous position for swept collision
      const prevX = proj.x;
      const prevY = proj.y;
      const prevZ = proj.z;
      
      // Update position
      proj.x += proj.dx * proj.speed * dt;
      proj.y += proj.dy * proj.speed * dt;
      proj.z += proj.dz * proj.speed * dt;
      proj.lifetime -= dt;
      
      if (proj.lifetime <= 0) {
        toRemove.push(id);
      } else {
        // Check swept collision along the projectile path
        this.checkSweptCollision(proj, id, prevX, prevY, prevZ, toRemove);
      }
    });
    
    toRemove.forEach(id => this.state.projectiles.delete(id));
  }

  private checkSweptCollision(proj: Projectile, projId: string, prevX: number, prevY: number, prevZ: number, toRemove: string[]) {
    if (toRemove.includes(projId)) return;
    
    const hitRadius = 2.5;
    
    this.state.players.forEach((player) => {
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
      
      let closestX = prevX, closestY = prevY, closestZ = prevZ;
      
      if (segLenSq > 0.0001) {
        // Project player onto line segment
        const t = Math.max(0, Math.min(1, (toPlayerX * segX + toPlayerY * segY + toPlayerZ * segZ) / segLenSq));
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
        
        // Broadcast hit event
        this.broadcast("hit", {
          targetId: player.id,
          shooterId: proj.ownerId,
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
  }

  private updateCollectibles(dt: number) {
    // Update rotation for visual effect
    this.state.collectibles.forEach((collectible) => {
      collectible.rotY += dt * 2; // Rotate ~2 radians per second
      if (collectible.rotY > Math.PI * 2) {
        collectible.rotY -= Math.PI * 2;
      }
    });
    
    // Check player-collectible collisions
    const toRemove: string[] = [];
    
    this.state.collectibles.forEach((collectible, id) => {
      this.state.players.forEach((player) => {
        if (!player.alive) return;
        
        const dx = player.x - collectible.x;
        const dy = player.y - collectible.y;
        const dz = player.z - collectible.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        
        if (distSq < COLLECTIBLE_COLLECT_RADIUS * COLLECTIBLE_COLLECT_RADIUS) {
          // Collect!
          this.handleCollectiblePickup(player, collectible);
          toRemove.push(id);
          
          // Schedule respawn
          this.collectibleRespawnTimers.set(id, COLLECTIBLE_RESPAWN_TIME);
        }
      });
    });
    
    // Remove collected collectibles
    toRemove.forEach(id => this.state.collectibles.delete(id));
    
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
    
    // Respawn collectibles
    toRespawn.forEach(id => {
      this.collectibleRespawnTimers.delete(id);
      // Spawn new collectible at random position
      const type = Math.random() > 0.5 ? "missile" : "laser_upgrade";
      const pos = this.getRandomCollectiblePosition([]);
      this.spawnCollectible(type, pos.x, 0, pos.z);
    });
  }

  private handleCollectiblePickup(player: Player, collectible: Collectible) {
    const classStats = SHIP_CLASSES[player.shipClass as keyof typeof SHIP_CLASSES];
    
    if (collectible.type === "missile") {
      // Refill missiles up to max
      const maxMissiles = classStats.maxMissiles;
      const oldMissiles = player.missiles;
      player.missiles = Math.min(maxMissiles, player.missiles + Math.ceil(maxMissiles / 2));
      console.log(`[GameRoom] ${player.name} picked up missiles: ${oldMissiles} -> ${player.missiles}`);
    } else if (collectible.type === "laser_upgrade") {
      player.hasLaserUpgrade = true;
      console.log(`[GameRoom] ${player.name} picked up laser upgrade`);
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
    
    this.state.players.forEach((player) => {
      if (!player.alive) return;
      if (player.health >= player.maxHealth) return;
      if (now - player.lastDamageTime < REGEN_DELAY) return;
      
      player.health = Math.min(player.maxHealth, player.health + REGEN_RATE * dt);
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
    this.state.players.forEach((player) => {
      if (!player.alive && player.respawnTime > 0) {
        player.respawnTime -= dt;
        
        if (player.respawnTime <= 0) {
          const spawnIndex = Math.floor(Math.random() * SPAWN_POINTS.length);
          this.spawnPlayer(player, spawnIndex);
          
          this.broadcast("respawn", { playerId: player.id });
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
      const topKills = Math.max(...Array.from(this.state.players.values()).map(p => p.kills));
      if (topKills >= this.state.killLimit) {
        this.endMatch();
        return;
      }
    } else {
      if (this.state.team1Score >= this.state.killLimit || this.state.team2Score >= this.state.killLimit) {
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
    
    // Determine winner
    let winner = "";
    if (this.state.mode === "ffa") {
      const sorted = Array.from(this.state.players.values()).sort((a, b) => b.kills - a.kills);
      winner = sorted[0]?.name || "No one";
    } else {
      winner = this.state.team1Score > this.state.team2Score ? "Red Team" : 
               this.state.team2Score > this.state.team1Score ? "Blue Team" : "Tie";
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
      this.state.players.forEach(p => {
        p.ready = false;
        p.kills = 0;
        p.deaths = 0;
      });
    }, 10000);
  }
}
