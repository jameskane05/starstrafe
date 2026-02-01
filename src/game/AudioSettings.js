const STORAGE_KEY = 'starstrafe_audio_settings';

const DEFAULT_SETTINGS = {
  musicVolume: 0.7,
  sfxVolume: 1.0,
  masterVolume: 1.0,
};

class AudioSettingsManager {
  constructor() {
    this.settings = this.load();
    this.listeners = [];
  }

  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('[AudioSettings] Failed to load:', e);
    }
    return { ...DEFAULT_SETTINGS };
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      this.notifyListeners();
    } catch (e) {
      console.warn('[AudioSettings] Failed to save:', e);
    }
  }

  get(key) {
    return this.settings[key] ?? DEFAULT_SETTINGS[key];
  }

  set(key, value) {
    this.settings[key] = Math.max(0, Math.min(1, value));
    this.save();
  }

  getMusicVolume() {
    return this.settings.musicVolume * this.settings.masterVolume;
  }

  getSfxVolume() {
    return this.settings.sfxVolume * this.settings.masterVolume;
  }

  setMusicVolume(value) {
    this.set('musicVolume', value);
  }

  setSfxVolume(value) {
    this.set('sfxVolume', value);
  }

  setMasterVolume(value) {
    this.set('masterVolume', value);
  }

  resetToDefault() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
  }

  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  notifyListeners() {
    this.listeners.forEach(cb => cb(this.settings));
  }
}

export const AudioSettings = new AudioSettingsManager();
