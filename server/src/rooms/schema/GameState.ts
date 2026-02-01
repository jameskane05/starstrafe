import { Schema, type, MapSchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  
  // Position
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 0;
  
  // Rotation (quaternion)
  @type("number") qx: number = 0;
  @type("number") qy: number = 0;
  @type("number") qz: number = 0;
  @type("number") qw: number = 1;
  
  // Velocity (for interpolation)
  @type("number") vx: number = 0;
  @type("number") vy: number = 0;
  @type("number") vz: number = 0;
  
  // Stats
  @type("number") health: number = 100;
  @type("number") maxHealth: number = 100;
  @type("number") missiles: number = 20;
  @type("number") kills: number = 0;
  @type("number") deaths: number = 0;
  
  // Class and team
  @type("string") shipClass: string = "fighter"; // "fighter" | "tank" | "rogue"
  @type("number") team: number = 0; // 0=none (FFA), 1=red, 2=blue
  
  // State
  @type("boolean") ready: boolean = false;
  @type("boolean") alive: boolean = true;
  @type("number") respawnTime: number = 0;
  
  // Input sequence for reconciliation
  @type("number") lastProcessedInput: number = 0;
  
  // Server-side only (not synced)
  lastDamageTime: number = 0;
}

export class Projectile extends Schema {
  @type("string") id: string = "";
  @type("string") ownerId: string = "";
  
  // Position
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 0;
  
  // Direction
  @type("number") dx: number = 0;
  @type("number") dy: number = 0;
  @type("number") dz: number = 0;
  
  @type("number") speed: number = 60;
  @type("number") damage: number = 25;
  @type("string") type: string = "laser"; // "laser" | "missile"
  @type("number") lifetime: number = 3;
}

export class GameState extends Schema {
  @type("string") phase: string = "lobby"; // "lobby" | "countdown" | "playing" | "results"
  @type("string") mode: string = "ffa"; // "ffa" | "team"
  @type("boolean") isPublic: boolean = true;
  @type("string") roomName: string = "";
  @type("string") hostId: string = "";
  @type("number") countdown: number = 0;
  @type("number") matchTime: number = 0;
  @type("number") maxMatchTime: number = 300; // 5 minutes
  @type("number") killLimit: number = 20;
  @type("number") maxPlayers: number = 8;
  
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  
  // Team scores (for team mode)
  @type("number") team1Score: number = 0;
  @type("number") team2Score: number = 0;
}
