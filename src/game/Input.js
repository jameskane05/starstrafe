import { KeyBindings } from './KeyBindings.js';
import { GamepadInput } from './Gamepad.js';

export const INPUT_MODE = {
  KEYBOARD: 'keyboard',
  GAMEPAD: 'gamepad',
};

export class Input {
  constructor(game) {
    this.game = game;
    this.rebindingAction = null;
    this.onRebindCallback = null;
    this.inputMode = INPUT_MODE.KEYBOARD;
    this.onInputModeChange = null;
    
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      rollLeft: false,
      rollRight: false,
      strafeUp: false,
      strafeDown: false,
      boost: false,
      lookUp: false,
      lookDown: false,
      lookLeft: false,
      lookRight: false,
    };
    
    this.gamepad = {
      moveX: 0,
      moveY: 0,
      lookX: 0,
      lookY: 0,
      fire: false,
      missile: false,
      boost: false,
      strafeUp: false,
      strafeDown: false,
      rollLeft: false,
      rollRight: false,
    };
    
    this.mouse = { x: 0, y: 0 };
    
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('contextmenu', (e) => {
      if (document.pointerLockElement) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    
    GamepadInput.onConnect = (gp) => {
      console.log('[Input] Gamepad connected:', gp.id);
    };
    
    GamepadInput.onDisconnect = () => {
      console.log('[Input] Gamepad disconnected');
      if (this.inputMode === INPUT_MODE.GAMEPAD) {
        this.setInputMode(INPUT_MODE.KEYBOARD);
      }
    };
  }

  setInputMode(mode) {
    if (this.inputMode !== mode) {
      this.inputMode = mode;
      console.log('[Input] Mode switched to:', mode);
      this.onInputModeChange?.(mode);
    }
  }

  startRebinding(action, callback) {
    this.rebindingAction = action;
    this.onRebindCallback = callback;
  }

  cancelRebinding() {
    this.rebindingAction = null;
    this.onRebindCallback = null;
  }

  onKeyDown(e) {
    // Switch to keyboard mode on keyboard input
    if (this.inputMode === INPUT_MODE.GAMEPAD) {
      this.setInputMode(INPUT_MODE.KEYBOARD);
    }
    
    if (this.rebindingAction) {
      e.preventDefault();
      e.stopPropagation();
      
      if (e.code === 'Escape') {
        this.cancelRebinding();
        this.onRebindCallback?.(null);
        return;
      }
      
      KeyBindings.setBinding(this.rebindingAction, [e.code]);
      this.rebindingAction = null;
      this.onRebindCallback?.(e.code);
      this.onRebindCallback = null;
      return;
    }
    
    if (e.code === 'Tab') e.preventDefault();
    this.setKey(e.code, true);
  }

  onKeyUp(e) {
    if (this.rebindingAction) return;
    this.setKey(e.code, false);
  }

  setKey(code, value) {
    if (KeyBindings.isKeyBound('forward', code)) this.keys.forward = value;
    if (KeyBindings.isKeyBound('backward', code)) this.keys.backward = value;
    if (KeyBindings.isKeyBound('left', code)) this.keys.left = value;
    if (KeyBindings.isKeyBound('right', code)) this.keys.right = value;
    if (KeyBindings.isKeyBound('rollLeft', code)) this.keys.rollLeft = value;
    if (KeyBindings.isKeyBound('rollRight', code)) this.keys.rollRight = value;
    if (KeyBindings.isKeyBound('strafeUp', code)) this.keys.strafeUp = value;
    if (KeyBindings.isKeyBound('strafeDown', code)) this.keys.strafeDown = value;
    if (KeyBindings.isKeyBound('boost', code)) this.keys.boost = value;
    if (KeyBindings.isKeyBound('lookUp', code)) this.keys.lookUp = value;
    if (KeyBindings.isKeyBound('lookDown', code)) this.keys.lookDown = value;
    if (KeyBindings.isKeyBound('lookLeft', code)) this.keys.lookLeft = value;
    if (KeyBindings.isKeyBound('lookRight', code)) this.keys.lookRight = value;
    
    if (KeyBindings.isKeyBound('leaderboard', code)) {
      if (value) this.game.showLeaderboard();
      else this.game.hideLeaderboard();
    }
    
    if (KeyBindings.isKeyBound('pause', code) && value) {
      this.game.toggleEscMenu();
    }
  }

  onMouseMove(e) {
    if (document.pointerLockElement) {
      this.mouse.x = e.movementX;
      this.mouse.y = e.movementY;
      
      // Switch to keyboard mode on mouse input
      if (this.inputMode === INPUT_MODE.GAMEPAD && (Math.abs(e.movementX) > 2 || Math.abs(e.movementY) > 2)) {
        this.setInputMode(INPUT_MODE.KEYBOARD);
      }
    }
  }

  onMouseDown(e) {
    if (!document.pointerLockElement) return;
    
    if (e.button === 0) {
      this.game.firePlayerWeapon();
    } else if (e.button === 2) {
      this.game.firePlayerMissile();
    }
  }

  onPointerLockChange() {
    if (!document.pointerLockElement && this.game.gameManager?.isPlaying() && !this.game.isEscMenuOpen) {
      this.game.showEscMenu();
    }
  }

  pollGamepad() {
    GamepadInput.poll();
    
    if (!GamepadInput.connected) return;
    
    // Check for gamepad input to switch modes
    if (this.inputMode === INPUT_MODE.KEYBOARD && GamepadInput.hasInput()) {
      this.setInputMode(INPUT_MODE.GAMEPAD);
    }
    
    // Read gamepad state
    const gp = this.gamepad;
    const state = GamepadInput.state;
    
    gp.moveX = state.leftStick.x;
    gp.moveY = state.leftStick.y;
    gp.lookX = state.rightStick.x;
    gp.lookY = state.rightStick.y;
    
    gp.fire = state.rightTrigger > 0.1;
    gp.missile = state.leftTrigger > 0.1;
    gp.boost = GamepadInput.getButtonState('boost');
    
    gp.strafeUp = GamepadInput.getButtonState('strafeUp');
    gp.strafeDown = GamepadInput.getButtonState('strafeDown');
    gp.rollLeft = GamepadInput.getButtonState('rollLeft');
    gp.rollRight = GamepadInput.getButtonState('rollRight');
    
    // Handle menu actions (only on button press, not hold)
    if (GamepadInput.getButtonJustPressed('pause')) {
      this.game.toggleEscMenu();
    }
    
    if (GamepadInput.getButtonJustPressed('leaderboard')) {
      this.game.showLeaderboard();
    }
    if (GamepadInput.state.prevButtons.back && !GamepadInput.state.buttons.back) {
      this.game.hideLeaderboard();
    }
  }

  consumeMouse() {
    const result = { x: this.mouse.x, y: this.mouse.y };
    this.mouse.x = 0;
    this.mouse.y = 0;
    return result;
  }
  
  isGamepadMode() {
    return this.inputMode === INPUT_MODE.GAMEPAD;
  }
  
  isGamepadConnected() {
    return GamepadInput.connected;
  }
}
