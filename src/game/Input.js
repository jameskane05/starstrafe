export class Input {
  constructor(game) {
    this.game = game;
    
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      rollLeft: false,
      rollRight: false
    };
    
    this.mouse = { x: 0, y: 0 };
    
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
  }

  onKeyDown(e) {
    this.setKey(e.code, true);
  }

  onKeyUp(e) {
    this.setKey(e.code, false);
  }

  setKey(code, value) {
    switch(code) {
      case 'KeyW': this.keys.forward = value; break;
      case 'KeyS': this.keys.backward = value; break;
      case 'KeyA': this.keys.left = value; break;
      case 'KeyD': this.keys.right = value; break;
      case 'Space': this.keys.up = value; break;
      case 'ShiftLeft':
      case 'ShiftRight': this.keys.down = value; break;
      case 'KeyQ': this.keys.rollLeft = value; break;
      case 'KeyE': this.keys.rollRight = value; break;
      case 'Escape': 
        if (value) this.game.stop();
        break;
    }
  }

  onMouseMove(e) {
    if (document.pointerLockElement) {
      this.mouse.x = e.movementX;
      this.mouse.y = e.movementY;
    }
  }

  onMouseDown(e) {
    if (e.button === 0) {
      this.game.firePlayerMissile();
    } else if (e.button === 2) {
      this.game.firePlayerWeapon();
    }
  }

  onPointerLockChange() {
    if (!document.pointerLockElement && this.game.isRunning) {
      this.game.stop();
    }
  }

  consumeMouse() {
    const result = { x: this.mouse.x, y: this.mouse.y };
    this.mouse.x = 0;
    this.mouse.y = 0;
    return result;
  }
}

