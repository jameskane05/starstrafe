import { Game } from './game/Game.js';
import './ui/menu.css';

const game = new Game();
game.init().catch(err => console.error("Failed to initialize game:", err));
