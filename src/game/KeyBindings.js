const STORAGE_KEY = 'starstrafe_keybindings';
const PRESETS_KEY = 'starstrafe_keybinding_presets';

export const DEFAULT_BINDINGS = {
  forward: 'KeyW',
  backward: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  rollLeft: 'KeyQ',
  rollRight: 'KeyE',
  strafeUp: 'KeyZ',
  strafeDown: 'KeyC',
  boost: 'ShiftLeft',
  lookUp: 'ArrowUp',
  lookDown: 'ArrowDown',
  lookLeft: 'ArrowLeft',
  lookRight: 'ArrowRight',
  leaderboard: 'Tab',
  pause: 'Escape',
};

export const ACTION_LABELS = {
  forward: 'Move Forward',
  backward: 'Move Backward',
  left: 'Strafe Left',
  right: 'Strafe Right',
  rollLeft: 'Roll Left',
  rollRight: 'Roll Right',
  strafeUp: 'Strafe Up',
  strafeDown: 'Strafe Down',
  boost: 'Boost',
  lookUp: 'Look Up',
  lookDown: 'Look Down',
  lookLeft: 'Look Left',
  lookRight: 'Look Right',
  leaderboard: 'Show Leaderboard',
  pause: 'Escape Menu',
};

export const KEY_DISPLAY_NAMES = {
  Space: 'SPACE',
  ShiftLeft: 'L-SHIFT',
  ShiftRight: 'R-SHIFT',
  ControlLeft: 'L-CTRL',
  ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT',
  AltRight: 'R-ALT',
  Tab: 'TAB',
  Escape: 'ESC',
  Enter: 'ENTER',
  Backspace: 'BACKSPACE',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

export function getKeyDisplayName(code) {
  if (KEY_DISPLAY_NAMES[code]) return KEY_DISPLAY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code;
}

class KeyBindingsManager {
  constructor() {
    this.bindings = this.load();
    this.presets = this.loadPresets();
    this.activePreset = this.loadActivePreset();
    this.hasUnsavedChanges = false;
  }

  loadActivePreset() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY + '_active');
      if (stored) return stored;
    } catch (e) {}
    return 'default';
  }

  saveActivePreset() {
    try {
      localStorage.setItem(STORAGE_KEY + '_active', this.activePreset);
    } catch (e) {}
  }

  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Migrate from old array format to single key format
        for (const [action, value] of Object.entries(parsed)) {
          if (Array.isArray(value)) {
            parsed[action] = value[0] || null;
          }
        }
        return { ...this.deepCopy(DEFAULT_BINDINGS), ...parsed };
      }
    } catch (e) {
      console.warn('[KeyBindings] Failed to load:', e);
    }
    return this.deepCopy(DEFAULT_BINDINGS);
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch (e) {
      console.warn('[KeyBindings] Failed to save:', e);
    }
  }

  loadPresets() {
    try {
      const stored = localStorage.getItem(PRESETS_KEY);
      if (stored) {
        const presets = JSON.parse(stored);
        // Migrate from old array format
        for (const presetName of Object.keys(presets)) {
          for (const [action, value] of Object.entries(presets[presetName])) {
            if (Array.isArray(value)) {
              presets[presetName][action] = value[0] || null;
            }
          }
        }
        return presets;
      }
    } catch (e) {
      console.warn('[KeyBindings] Failed to load presets:', e);
    }
    return {};
  }

  savePresets() {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(this.presets));
    } catch (e) {
      console.warn('[KeyBindings] Failed to save presets:', e);
    }
  }

  deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  getBinding(action) {
    return this.bindings[action] || null;
  }

  setBinding(action, key) {
    this.bindings[action] = key;
    this.markAsCustom();
    this.save();
  }

  markAsCustom() {
    if (this.activePreset !== 'custom') {
      this.activePreset = 'custom';
      this.hasUnsavedChanges = true;
      this.saveActivePreset();
    }
  }

  clearBinding(action) {
    this.bindings[action] = null;
    this.save();
  }

  isKeyBound(action, code) {
    return this.bindings[action] === code;
  }

  getActionForKey(code) {
    for (const [action, key] of Object.entries(this.bindings)) {
      if (key === code) return action;
    }
    return null;
  }

  resetToDefault() {
    this.bindings = this.deepCopy(DEFAULT_BINDINGS);
    this.activePreset = 'default';
    this.hasUnsavedChanges = false;
    this.save();
    this.saveActivePreset();
  }

  savePreset(name) {
    this.presets[name] = this.deepCopy(this.bindings);
    this.activePreset = name;
    this.hasUnsavedChanges = false;
    this.savePresets();
    this.saveActivePreset();
  }

  loadPreset(name) {
    if (name === 'default') {
      this.resetToDefault();
      return true;
    }
    if (name === 'custom') {
      return false;
    }
    if (this.presets[name]) {
      this.bindings = this.deepCopy(this.presets[name]);
      this.activePreset = name;
      this.hasUnsavedChanges = false;
      this.save();
      this.saveActivePreset();
      return true;
    }
    return false;
  }

  deletePreset(name) {
    if (name === 'default') return false;
    delete this.presets[name];
    this.savePresets();
    if (this.activePreset === name) {
      this.activePreset = 'default';
    }
    return true;
  }

  getPresetNames() {
    const names = ['default', ...Object.keys(this.presets)];
    if (this.activePreset === 'custom' && !names.includes('custom')) {
      names.push('custom');
    }
    return names;
  }

  isCustom() {
    return this.activePreset === 'custom';
  }

  getAllBindings() {
    return this.deepCopy(this.bindings);
  }
}

export const KeyBindings = new KeyBindingsManager();
