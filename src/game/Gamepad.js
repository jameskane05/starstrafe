const STORAGE_KEY = 'starstrafe_gamepad_bindings';

export const DEFAULT_GAMEPAD_BINDINGS = {
  leftStickX: 'moveX',      // Left stick horizontal -> strafe left/right
  leftStickY: 'moveY',      // Left stick vertical -> forward/backward
  rightStickX: 'lookX',     // Right stick horizontal -> yaw
  rightStickY: 'lookY',     // Right stick vertical -> pitch
  rightTrigger: 'fire',     // RT -> fire lasers
  leftTrigger: 'missile',   // LT -> fire missiles
  leftStickPress: 'boost',  // L3 -> boost/sprint
  dpadUp: 'strafeUp',       // D-pad up -> strafe up
  dpadDown: 'strafeDown',   // D-pad down -> strafe down
  dpadLeft: 'rollLeft',     // D-pad left -> roll left
  dpadRight: 'rollRight',   // D-pad right -> roll right
  start: 'pause',           // Start -> escape menu
  back: 'leaderboard',      // Back/Select -> leaderboard
};

export const GAMEPAD_INPUT_LABELS = {
  leftStickX: 'Left Stick X',
  leftStickY: 'Left Stick Y',
  rightStickX: 'Right Stick X',
  rightStickY: 'Right Stick Y',
  rightTrigger: 'Right Trigger',
  leftTrigger: 'Left Trigger',
  leftStickPress: 'Left Stick Press',
  rightStickPress: 'Right Stick Press',
  dpadUp: 'D-Pad Up',
  dpadDown: 'D-Pad Down',
  dpadLeft: 'D-Pad Left',
  dpadRight: 'D-Pad Right',
  buttonA: 'A Button',
  buttonB: 'B Button',
  buttonX: 'X Button',
  buttonY: 'Y Button',
  leftBumper: 'Left Bumper',
  rightBumper: 'Right Bumper',
  start: 'Start',
  back: 'Back/Select',
};

export const GAMEPAD_ACTION_LABELS = {
  moveX: 'Strafe Left/Right',
  moveY: 'Forward/Backward',
  lookX: 'Look Left/Right',
  lookY: 'Look Up/Down',
  fire: 'Fire Lasers',
  missile: 'Fire Missiles',
  boost: 'Boost',
  strafeUp: 'Strafe Up',
  strafeDown: 'Strafe Down',
  rollLeft: 'Roll Left',
  rollRight: 'Roll Right',
  pause: 'Escape Menu',
  leaderboard: 'Leaderboard',
};

// Standard gamepad button indices
const BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
};

// Standard gamepad axes indices
const AXIS = {
  LEFT_X: 0,
  LEFT_Y: 1,
  RIGHT_X: 2,
  RIGHT_Y: 3,
};

class GamepadManager {
  constructor() {
    this.gamepad = null;
    this.connected = false;
    this.bindings = this.load();
    this.deadzone = 0.15;
    this.triggerThreshold = 0.1;
    
    this.state = {
      leftStick: { x: 0, y: 0 },
      rightStick: { x: 0, y: 0 },
      leftTrigger: 0,
      rightTrigger: 0,
      buttons: {},
      prevButtons: {},
    };
    
    this.onConnect = null;
    this.onDisconnect = null;
    
    window.addEventListener('gamepadconnected', (e) => this.handleConnect(e));
    window.addEventListener('gamepaddisconnected', (e) => this.handleDisconnect(e));
  }

  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_GAMEPAD_BINDINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('[Gamepad] Failed to load bindings:', e);
    }
    return { ...DEFAULT_GAMEPAD_BINDINGS };
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch (e) {
      console.warn('[Gamepad] Failed to save bindings:', e);
    }
  }

  resetToDefault() {
    this.bindings = { ...DEFAULT_GAMEPAD_BINDINGS };
    this.save();
  }

  handleConnect(e) {
    console.log('[Gamepad] Connected:', e.gamepad.id);
    this.gamepad = e.gamepad;
    this.connected = true;
    this.onConnect?.(e.gamepad);
  }

  handleDisconnect(e) {
    console.log('[Gamepad] Disconnected:', e.gamepad.id);
    if (this.gamepad?.index === e.gamepad.index) {
      this.gamepad = null;
      this.connected = false;
      this.onDisconnect?.(e.gamepad);
    }
  }

  applyDeadzone(value) {
    if (Math.abs(value) < this.deadzone) return 0;
    const sign = Math.sign(value);
    return sign * (Math.abs(value) - this.deadzone) / (1 - this.deadzone);
  }

  poll() {
    const gamepads = navigator.getGamepads();
    if (!gamepads) return;
    
    // Find first connected gamepad
    for (const gp of gamepads) {
      if (gp && gp.connected) {
        this.gamepad = gp;
        if (!this.connected) {
          this.connected = true;
          this.onConnect?.(gp);
        }
        break;
      }
    }
    
    if (!this.gamepad) {
      if (this.connected) {
        this.connected = false;
        this.onDisconnect?.();
      }
      return;
    }
    
    const gp = this.gamepad;
    
    // Store previous button states
    this.state.prevButtons = { ...this.state.buttons };
    
    // Read axes
    this.state.leftStick.x = this.applyDeadzone(gp.axes[AXIS.LEFT_X] || 0);
    this.state.leftStick.y = this.applyDeadzone(gp.axes[AXIS.LEFT_Y] || 0);
    this.state.rightStick.x = this.applyDeadzone(gp.axes[AXIS.RIGHT_X] || 0);
    this.state.rightStick.y = this.applyDeadzone(gp.axes[AXIS.RIGHT_Y] || 0);
    
    // Triggers (some controllers report as buttons, some as axes)
    // Try axes first (indices 4 and 5 on some controllers)
    if (gp.axes.length > 4) {
      this.state.leftTrigger = Math.max(0, (gp.axes[4] + 1) / 2);
      this.state.rightTrigger = Math.max(0, (gp.axes[5] + 1) / 2);
    }
    // Override with button values if available and pressed
    if (gp.buttons[BUTTON.LT]) {
      const lt = gp.buttons[BUTTON.LT].value;
      if (lt > this.state.leftTrigger) this.state.leftTrigger = lt;
    }
    if (gp.buttons[BUTTON.RT]) {
      const rt = gp.buttons[BUTTON.RT].value;
      if (rt > this.state.rightTrigger) this.state.rightTrigger = rt;
    }
    
    // Read buttons
    this.state.buttons = {
      a: gp.buttons[BUTTON.A]?.pressed || false,
      b: gp.buttons[BUTTON.B]?.pressed || false,
      x: gp.buttons[BUTTON.X]?.pressed || false,
      y: gp.buttons[BUTTON.Y]?.pressed || false,
      lb: gp.buttons[BUTTON.LB]?.pressed || false,
      rb: gp.buttons[BUTTON.RB]?.pressed || false,
      lt: this.state.leftTrigger > this.triggerThreshold,
      rt: this.state.rightTrigger > this.triggerThreshold,
      back: gp.buttons[BUTTON.BACK]?.pressed || false,
      start: gp.buttons[BUTTON.START]?.pressed || false,
      l3: gp.buttons[BUTTON.L3]?.pressed || false,
      r3: gp.buttons[BUTTON.R3]?.pressed || false,
      dpadUp: gp.buttons[BUTTON.DPAD_UP]?.pressed || false,
      dpadDown: gp.buttons[BUTTON.DPAD_DOWN]?.pressed || false,
      dpadLeft: gp.buttons[BUTTON.DPAD_LEFT]?.pressed || false,
      dpadRight: gp.buttons[BUTTON.DPAD_RIGHT]?.pressed || false,
    };
  }

  // Check if button was just pressed this frame
  justPressed(button) {
    return this.state.buttons[button] && !this.state.prevButtons[button];
  }

  // Check if button is held
  isPressed(button) {
    return this.state.buttons[button] || false;
  }

  // Get axis value for an action based on bindings
  getAxisValue(action) {
    const binding = Object.entries(this.bindings).find(([, a]) => a === action)?.[0];
    if (!binding) return 0;
    
    switch (binding) {
      case 'leftStickX': return this.state.leftStick.x;
      case 'leftStickY': return this.state.leftStick.y;
      case 'rightStickX': return this.state.rightStick.x;
      case 'rightStickY': return this.state.rightStick.y;
      case 'leftTrigger': return this.state.leftTrigger;
      case 'rightTrigger': return this.state.rightTrigger;
      default: return 0;
    }
  }

  // Get button state for an action based on bindings
  getButtonState(action) {
    const binding = Object.entries(this.bindings).find(([, a]) => a === action)?.[0];
    if (!binding) return false;
    
    switch (binding) {
      case 'dpadUp': return this.state.buttons.dpadUp;
      case 'dpadDown': return this.state.buttons.dpadDown;
      case 'dpadLeft': return this.state.buttons.dpadLeft;
      case 'dpadRight': return this.state.buttons.dpadRight;
      case 'leftStickPress': return this.state.buttons.l3;
      case 'rightStickPress': return this.state.buttons.r3;
      case 'buttonA': return this.state.buttons.a;
      case 'buttonB': return this.state.buttons.b;
      case 'buttonX': return this.state.buttons.x;
      case 'buttonY': return this.state.buttons.y;
      case 'leftBumper': return this.state.buttons.lb;
      case 'rightBumper': return this.state.buttons.rb;
      case 'leftTrigger': return this.state.buttons.lt;
      case 'rightTrigger': return this.state.buttons.rt;
      case 'start': return this.state.buttons.start;
      case 'back': return this.state.buttons.back;
      default: return false;
    }
  }

  // Get button just pressed for an action
  getButtonJustPressed(action) {
    const binding = Object.entries(this.bindings).find(([, a]) => a === action)?.[0];
    if (!binding) return false;
    
    switch (binding) {
      case 'dpadUp': return this.justPressed('dpadUp');
      case 'dpadDown': return this.justPressed('dpadDown');
      case 'dpadLeft': return this.justPressed('dpadLeft');
      case 'dpadRight': return this.justPressed('dpadRight');
      case 'leftStickPress': return this.justPressed('l3');
      case 'rightStickPress': return this.justPressed('r3');
      case 'buttonA': return this.justPressed('a');
      case 'buttonB': return this.justPressed('b');
      case 'buttonX': return this.justPressed('x');
      case 'buttonY': return this.justPressed('y');
      case 'leftBumper': return this.justPressed('lb');
      case 'rightBumper': return this.justPressed('rb');
      case 'leftTrigger': return this.justPressed('lt');
      case 'rightTrigger': return this.justPressed('rt');
      case 'start': return this.justPressed('start');
      case 'back': return this.justPressed('back');
      default: return false;
    }
  }

  hasInput() {
    if (!this.connected) return false;
    
    const s = this.state;
    return Math.abs(s.leftStick.x) > 0.1 ||
           Math.abs(s.leftStick.y) > 0.1 ||
           Math.abs(s.rightStick.x) > 0.1 ||
           Math.abs(s.rightStick.y) > 0.1 ||
           s.leftTrigger > 0.1 ||
           s.rightTrigger > 0.1 ||
           Object.values(s.buttons).some(b => b);
  }

  getBindings() {
    return { ...this.bindings };
  }

  setBinding(input, action) {
    this.bindings[input] = action;
    this.save();
  }
}

export const GamepadInput = new GamepadManager();
