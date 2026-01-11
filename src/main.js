import { Game } from './game/Game.js';

const game = new Game();
game.init().catch(err => console.error("Failed to initialize game:", err));
