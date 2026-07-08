/**
 * ProceduralAudio.js - PROCEDURAL SOUND SYNTHESIS
 * =============================================================================
 *
 * ROLE: Web Audio API procedural sound synthesis. Generates UI, combat, and
 * feedback sounds without audio files. Singleton used by game and sfxManager.
 *
 * KEY RESPONSIBILITIES:
 * - init(): create AudioContext, master gain; subscribe to AudioSettings
 * - UI: beeps, clicks, hover; combat: laser, shield hit, explosion, collect pickup
 * - setListenerPosition/Forward/Up for spatial audio
 * - shieldRecharge / boosterRecharge loops; checkpoint stingers (grit / waveshaper); low health warning
 *
 * RELATED: AudioSettings.js, sfxManager.js, gameCombat.js, gameUpdate.js, MissionManager.js.
 *
 * =============================================================================
 */

import { AudioSettings } from "../game/AudioSettings.js";
import {
  DIALOG_DUCK_LEVEL,
  DIALOG_DUCK_RAMP_DOWN_SEC,
  DIALOG_DUCK_RAMP_UP_SEC,
} from "./dialogDuckShared.js";

class ProceduralAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.sfxVolume = 0.5;
    this.initialized = false;

    this._dialogDuckMul = 1;
    this._dialogDuckTarget = 1;
    this._duckRampFrom = 1;
    this._duckRampDuration = 1;
    this._duckRampElapsed = 0;
    this._duckRampActive = false;
    this._loadingSuppressed = false;
    
    // Listener position (camera position) for spatial audio
    this.listenerPosition = { x: 0, y: 0, z: 0 };
    this.listenerForward = { x: 0, y: 0, z: -1 };
    this.listenerUp = { x: 0, y: 1, z: 0 };

    this._killStreakCount = 0;
    this._lastKillConfirmAtMs = 0;
    this._killStreakWindowMs = 1800;
  }

  /**
   * Create AudioContext + master gain synchronously (no await).
   * Safari requires `ctx.resume()` in the same user-gesture stack as menu → play;
   * init() alone leaves the context suspended until SFX fires.
   */
  unlockFromUserGesture() {
    if (!this.initialized) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);
        this.setVolume(AudioSettings.getSfxVolume());
        this.initialized = true;
        this._volumeUnsub = AudioSettings.onChange(() =>
          this.setVolume(AudioSettings.getSfxVolume()),
        );
        console.log("[ProceduralAudio] Initialized (user gesture)");
      } catch (e) {
        console.error("[ProceduralAudio] Failed to initialize:", e);
        return;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  /**
   * Initialize audio context (must be called after user interaction)
   */
  async init() {
    if (this.initialized) return;

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.setVolume(AudioSettings.getSfxVolume());
      this.initialized = true;
      this._volumeUnsub = AudioSettings.onChange(() =>
        this.setVolume(AudioSettings.getSfxVolume()),
      );
      console.log("[ProceduralAudio] Initialized");
    } catch (e) {
      console.error("[ProceduralAudio] Failed to initialize:", e);
    }
  }
  
  /**
   * Update listener position (camera position) for spatial audio
   */
  setListenerPosition(position, forward, up) {
    if (!this.ctx || !this.ctx.listener) return;
    
    this.listenerPosition = position;
    this.listenerForward = forward || { x: 0, y: 0, z: -1 };
    this.listenerUp = up || { x: 0, y: 1, z: 0 };
    
    // Update Web Audio API listener
    const listener = this.ctx.listener;
    if (listener.positionX) {
      // New API (Chrome)
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = this.listenerForward.x;
      listener.forwardY.value = this.listenerForward.y;
      listener.forwardZ.value = this.listenerForward.z;
      listener.upX.value = this.listenerUp.x;
      listener.upY.value = this.listenerUp.y;
      listener.upZ.value = this.listenerUp.z;
    } else {
      // Old API (fallback)
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(
        this.listenerForward.x, this.listenerForward.y, this.listenerForward.z,
        this.listenerUp.x, this.listenerUp.y, this.listenerUp.z
      );
    }
  }

  /**
   * Ensure context is running (for autoplay policy)
   */
  async resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  /**
   * Set SFX volume (0-1)
   */
  setVolume(volume) {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    this._syncMasterGain();
  }

  _syncMasterGain() {
    if (this.masterGain) {
      this.masterGain.gain.value = this._loadingSuppressed
        ? 0
        : this.sfxVolume * this._dialogDuckMul;
    }
  }

  setLoadingSuppressed(active) {
    this._loadingSuppressed = active === true;
    if (this._loadingSuppressed) {
      this.shieldRechargeStop();
      this.boosterRechargeStop();
    }
    this._syncMasterGain();
  }

  isLoadingSuppressed() {
    return this._loadingSuppressed === true;
  }

  /**
   * Same dialog duck as music — lasers, explosions, shield loops, etc. use this bus.
   * Dialog VO bypasses masterGain (VRMAvatarRenderer → destination or HTMLAudioElement).
   */
  setDialogDuck(active) {
    const target = active ? DIALOG_DUCK_LEVEL : 1;
    if (
      !this._duckRampActive &&
      Math.abs(this._dialogDuckMul - target) < 0.005
    ) {
      return;
    }
    this._dialogDuckTarget = target;
    this._duckRampFrom = this._dialogDuckMul;
    this._duckRampDuration = active
      ? DIALOG_DUCK_RAMP_DOWN_SEC
      : DIALOG_DUCK_RAMP_UP_SEC;
    this._duckRampElapsed = 0;
    this._duckRampActive = true;
  }

  _smoothDialogDuck(dt) {
    const d = typeof dt === "number" && dt > 0 ? dt : 1 / 60;
    if (this._duckRampActive) {
      this._duckRampElapsed += d;
      const t = Math.min(1, this._duckRampElapsed / this._duckRampDuration);
      this._dialogDuckMul =
        this._duckRampFrom +
        (this._dialogDuckTarget - this._duckRampFrom) * t;
      if (t >= 1) {
        this._dialogDuckMul = this._dialogDuckTarget;
        this._duckRampActive = false;
      }
      this._syncMasterGain();
    }
  }

  update(dt) {
    this._smoothDialogDuck(dt);
  }

  // ============================================
  // UI SOUNDS
  // ============================================

  /**
   * Button click / select sound
   */
  uiClick() {
    if (!this.ctx) return;
    this.resume();
    
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
    
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 0.08);
  }

  /**
   * Button hover sound
   */
  uiHover() {
    if (!this.ctx) return;
    this.resume();
    
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, now);
    
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 0.05);
  }

  /** Short soft tick for typewriter / terminal text. */
  uiTypewriterBeep() {
    if (!this.ctx) return;
    this.resume();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1010, now);

    gain.gain.setValueAtTime(0.038, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.028);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.035);
  }

  /**
   * Navigation beep (moving through menu)
   */
  uiNavigate() {
    if (!this.ctx) return;
    this.resume();
    
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = "triangle";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(550, now + 0.03);
    
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 0.06);
  }

  /**
   * Error / denied sound
   */
  uiError() {
    if (!this.ctx) return;
    this.resume();
    
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = "square";
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.setValueAtTime(150, now + 0.1);
    
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 0.2);
  }

  /**
   * Success / confirm sound
   */
  uiConfirm() {
    if (!this.ctx) return;
    this.resume();
    
    const now = this.ctx.currentTime;
    
    // Two-tone ascending beep
    [0, 0.08].forEach((offset, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(i === 0 ? 600 : 900, now + offset);
      
      gain.gain.setValueAtTime(0.2, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.1);
      
      osc.connect(gain);
      gain.connect(this.masterGain);
      
      osc.start(now + offset);
      osc.stop(now + offset + 0.1);
    });
  }

  /**
   * Countdown beep
   */
  uiCountdown(final = false) {
    if (!this.ctx) return;
    this.resume();
    
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(final ? 880 : 440, now);
    
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + (final ? 0.3 : 0.15));
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + (final ? 0.3 : 0.15));
  }

  /**
   * Ship computer chirp – objective tracker acquired (ascending beep-beep-boop).
   */
  objectiveTrackerOn() {
    if (!this.ctx) return;
    this.resume();

    const now = this.ctx.currentTime;
    const notes = [
      { t: 0, freq: 740, type: "square", dur: 0.055 },
      { t: 0.075, freq: 1180, type: "sine", dur: 0.05 },
      { t: 0.14, freq: 1560, type: "square", dur: 0.075 },
    ];
    for (const n of notes) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = n.type;
      osc.frequency.setValueAtTime(n.freq, now + n.t);
      osc.frequency.exponentialRampToValueAtTime(
        n.freq * 1.12,
        now + n.t + n.dur,
      );

      gain.gain.setValueAtTime(0.0001, now + n.t);
      gain.gain.exponentialRampToValueAtTime(0.1, now + n.t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.t + n.dur);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now + n.t);
      osc.stop(now + n.t + n.dur + 0.02);
    }
  }

  /**
   * Ship computer chirp – objective tracker dismissed (descending boop-boop).
   */
  objectiveTrackerOff() {
    if (!this.ctx) return;
    this.resume();

    const now = this.ctx.currentTime;
    const notes = [
      { t: 0, freq: 1100, type: "sine", dur: 0.06 },
      { t: 0.085, freq: 620, type: "square", dur: 0.1 },
    ];
    for (const n of notes) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = n.type;
      osc.frequency.setValueAtTime(n.freq, now + n.t);
      osc.frequency.exponentialRampToValueAtTime(
        n.freq * 0.82,
        now + n.t + n.dur,
      );

      gain.gain.setValueAtTime(0.0001, now + n.t);
      gain.gain.exponentialRampToValueAtTime(0.09, now + n.t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.t + n.dur);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now + n.t);
      osc.stop(now + n.t + n.dur + 0.02);
    }
  }

  // ============================================
  // COMBAT SOUNDS
  // ============================================

  /**
   * Missile fire sound
   */
  missileFire() {
    if (!this.ctx || this.ctx.state === "suspended") return;
    
    const now = this.ctx.currentTime;
    
    // Whoosh sound
    const noise = this._createNoise(0.3);
    const noiseGain = this.ctx.createGain();
    const noiseFilter = this.ctx.createBiquadFilter();
    
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1000, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(200, now + 0.3);
    noiseFilter.Q.value = 2;
    
    noiseGain.gain.setValueAtTime(0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    
    noise.start(now);
    noise.stop(now + 0.3);
    
    // Low thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
    
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 0.2);
  }

  /**
   * Shield hit sound (when player takes damage)
   */
  shieldHit() {
    if (!this.ctx || this.ctx.state === "suspended") return;
    
    const now = this.ctx.currentTime;
    
    // Electric crackle
    const noise = this._createNoise(0.15);
    const noiseGain = this.ctx.createGain();
    const noiseFilter = this.ctx.createBiquadFilter();
    
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 2000;
    
    noiseGain.gain.setValueAtTime(0.2, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    
    noise.start(now);
    noise.stop(now + 0.15);
    
    // Shield resonance tone
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
    
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 0.2);
  }

  /**
   * Explosion sound
   */
  explosion(big = false) {
    if (!this.ctx || this.ctx.state === "suspended") return;
    
    const now = this.ctx.currentTime;
    const duration = big ? 0.8 : 0.4;
    
    // Noise burst
    const noise = this._createNoise(duration);
    const noiseGain = this.ctx.createGain();
    const noiseFilter = this.ctx.createBiquadFilter();
    
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(big ? 1000 : 2000, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(100, now + duration);
    
    noiseGain.gain.setValueAtTime(big ? 0.5 : 0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    
    noise.start(now);
    noise.stop(now + duration);
    
    // Low boom
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(big ? 80 : 120, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + duration);
    
    gain.gain.setValueAtTime(big ? 0.6 : 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * Collectible pickup sound
   */
  collectPickup() {
    if (!this.ctx || this.ctx.state === "suspended") return;
    
    const now = this.ctx.currentTime;
    
    // Ascending arpeggio
    const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
    
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.value = freq;
      
      const startTime = now + i * 0.05;
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15);
      
      osc.connect(gain);
      gain.connect(this.masterGain);
      
      osc.start(startTime);
      osc.stop(startTime + 0.15);
    });
  }

  /**
   * Training / checkpoint ring clear – gritty stack + ripping arp (rock / stinger)
   */
  checkpointGoalSuccess() {
    if (!this.ctx) return;
    this.resume();
    if (this.ctx.state === "suspended") return;

    const now = this.ctx.currentTime;
    const totalEnd = now + 2.05;

    const thump = this.ctx.createOscillator();
    const thumpG = this.ctx.createGain();
    thump.type = "square";
    thump.frequency.setValueAtTime(98, now);
    thump.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    thumpG.gain.setValueAtTime(0.11, now);
    thumpG.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    thump.connect(thumpG);
    thumpG.connect(this.masterGain);
    thump.start(now);
    thump.stop(now + 0.24);

    const thumpSub = this.ctx.createOscillator();
    const thumpSubG = this.ctx.createGain();
    thumpSub.type = "sine";
    thumpSub.frequency.setValueAtTime(74, now);
    thumpSub.frequency.exponentialRampToValueAtTime(36, now + 0.16);
    thumpSubG.gain.setValueAtTime(0.2, now);
    thumpSubG.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
    thumpSub.connect(thumpSubG);
    thumpSubG.connect(this.masterGain);
    thumpSub.start(now);
    thumpSub.stop(now + 0.25);

    const padShaper = this._gritShaper(2.65);
    const padBus = this.ctx.createGain();
    padBus.gain.value = 1;
    const padFreqs = [155.56, 185.0, 207.65, 246.94];
    padFreqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = f * (1 + i * 0.0015);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.052 - i * 0.007, now + 0.14);
      g.gain.linearRampToValueAtTime(0.038, now + 0.88);
      g.gain.exponentialRampToValueAtTime(0.001, totalEnd);
      osc.connect(g);
      g.connect(padBus);
      osc.start(now);
      osc.stop(totalEnd + 0.04);
    });
    const padOut = this.ctx.createGain();
    padOut.gain.value = 0.55;
    padBus.connect(padShaper);
    padShaper.connect(padOut);
    padOut.connect(this.masterGain);

    const arpShaper = this._gritShaper(3.2);
    const arpBus = this.ctx.createGain();
    arpBus.gain.value = 1;
    const arpMain = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0];
    const step = 0.082;
    arpMain.forEach((freq, i) => {
      const t0 = now + i * step;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq * (1 + (i % 3) * 0.0018);
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(0.11, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
      osc.connect(g);
      g.connect(arpBus);
      osc.start(t0);
      osc.stop(t0 + 0.18);
    });
    const arpOut = this.ctx.createGain();
    arpOut.gain.value = 0.68;
    arpBus.connect(arpShaper);
    arpShaper.connect(arpOut);
    arpOut.connect(this.masterGain);

    const arpEchoBus = this.ctx.createGain();
    arpEchoBus.gain.value = 1;
    const arpEcho = [659.25, 783.99, 1046.5, 1318.51, 1567.98];
    arpEcho.forEach((freq, i) => {
      const t0 = now + 0.5 + i * step;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(0.072, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
      osc.connect(g);
      g.connect(arpEchoBus);
      osc.start(t0);
      osc.stop(t0 + 0.16);
    });
    const echoShaper = this._gritShaper(2.9);
    const echoOut = this.ctx.createGain();
    echoOut.gain.value = 0.52;
    arpEchoBus.connect(echoShaper);
    echoShaper.connect(echoOut);
    echoOut.connect(this.masterGain);

    const noiseBurst = this._createNoise(0.11);
    const nFil = this.ctx.createBiquadFilter();
    nFil.type = "bandpass";
    nFil.frequency.setValueAtTime(900, now + 1.02);
    nFil.frequency.exponentialRampToValueAtTime(4800, now + 1.38);
    nFil.Q.value = 0.85;
    const nG = this.ctx.createGain();
    nG.gain.setValueAtTime(0.001, now + 1.02);
    nG.gain.linearRampToValueAtTime(0.11, now + 1.08);
    nG.gain.exponentialRampToValueAtTime(0.001, now + 1.48);
    noiseBurst.connect(nFil);
    nFil.connect(nG);
    nG.connect(this.masterGain);
    noiseBurst.start(now + 1.02);
    noiseBurst.stop(now + 1.5);

    const scrape = this.ctx.createOscillator();
    const scrapeG = this.ctx.createGain();
    scrape.type = "sawtooth";
    scrape.frequency.setValueAtTime(420, now + 1.06);
    scrape.frequency.exponentialRampToValueAtTime(2400, now + 1.25);
    scrapeG.gain.setValueAtTime(0.001, now + 1.04);
    scrapeG.gain.linearRampToValueAtTime(0.04, now + 1.1);
    scrapeG.gain.exponentialRampToValueAtTime(0.001, now + 1.42);
    const scrapeShape = this._gritShaper(4);
    scrape.connect(scrapeG);
    scrapeG.connect(scrapeShape);
    scrapeShape.connect(this.masterGain);
    scrape.start(now + 1.04);
    scrape.stop(now + 1.45);

    const fanShaper = this._gritShaper(2.4);
    const fanBus = this.ctx.createGain();
    fanBus.gain.value = 1;
    const fan = [1046.5, 1318.51, 1567.98];
    fan.forEach((freq, i) => {
      const t0 = now + 1.34 + i * 0.05;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(0.072, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
      osc.connect(g);
      g.connect(fanBus);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    });
    const fanOut = this.ctx.createGain();
    fanOut.gain.value = 0.45;
    fanBus.connect(fanShaper);
    fanShaper.connect(fanOut);
    fanOut.connect(this.masterGain);
  }

  /**
   * Checkpoint ring spoke (approach) – short rising pitch per clockwise step as rim bricks bloom.
   */
  checkpointRimSpokePulse(cwRank) {
    if (!this.ctx) return;
    this.resume();
    if (this.ctx.state === "suspended") return;

    const rank = Math.max(0, Math.min(5, cwRank | 0));
    const now = this.ctx.currentTime;
    const semitone = 2 ** (1 / 12);
    const f0 = 300 * semitone ** rank;
    const f1 = f0 * 1.06;

    const bus = this.ctx.createGain();
    bus.gain.value = 0.55;

    const addVoice = (type, freqMul, peak, tEnd) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * freqMul, now);
      o.frequency.exponentialRampToValueAtTime(f1 * freqMul, now + 0.055);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0005, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, now + tEnd);
      o.connect(g);
      g.connect(bus);
      o.start(now);
      o.stop(now + tEnd + 0.02);
    };

    addVoice("triangle", 1, 0.11, 0.16);
    addVoice("sine", 2, 0.045, 0.14);

    bus.connect(this.masterGain);
  }

  // ============================================
  // FEEDBACK SOUNDS
  // ============================================

  /**
   * Boost activate sound
   */
  boostStart() {
    if (!this.ctx || this.ctx.state === "suspended") return;
    
    const now = this.ctx.currentTime;
    
    // Rising whoosh
    const noise = this._createNoise(0.2);
    const noiseGain = this.ctx.createGain();
    const noiseFilter = this.ctx.createBiquadFilter();
    
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(200, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(2000, now + 0.2);
    noiseFilter.Q.value = 1;
    
    noiseGain.gain.setValueAtTime(0.01, now);
    noiseGain.gain.linearRampToValueAtTime(0.25, now + 0.1);
    noiseGain.gain.exponentialRampToValueAtTime(0.1, now + 0.2);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    
    noise.start(now);
    noise.stop(now + 0.2);
  }

  /**
   * Low health warning beep
   */
  lowHealthWarning() {
    if (!this.ctx || this.ctx.state === "suspended") return;
    
    const now = this.ctx.currentTime;
    
    // Double beep
    [0, 0.15].forEach((offset) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = "square";
      osc.frequency.value = 440;
      
      gain.gain.setValueAtTime(0.15, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.1);
      
      osc.connect(gain);
      gain.connect(this.masterGain);
      
      osc.start(now + offset);
      osc.stop(now + offset + 0.1);
    });
  }

  escapeWarningBeep(urgency = 0) {
    if (!this.ctx || this.ctx.state === "suspended") return;
    const now = this.ctx.currentTime;
    const freq = 600 + urgency * 400;
    const vol = 0.08 + urgency * 0.1;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + 0.12);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  escapeWarningSiren() {
    if (!this.ctx || this.ctx.state === "suspended") return;
    const now = this.ctx.currentTime;
    const dur = 0.6;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(380, now);
    osc.frequency.linearRampToValueAtTime(620, now + dur * 0.5);
    osc.frequency.linearRampToValueAtTime(380, now + dur);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
    gain.gain.setValueAtTime(0.1, now + dur - 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur);
  }

  /**
   * Respawn sound
   */
  respawn() {
    if (!this.ctx || this.ctx.state === "suspended") return;

    const now = this.ctx.currentTime;
    
    // Shimmering rebuild sound
    const notes = [262, 330, 392, 523, 659]; // C4 up to E5
    
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.value = freq;
      
      const startTime = now + i * 0.08;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
      
      osc.connect(gain);
      gain.connect(this.masterGain);
      
      osc.start(startTime);
      osc.stop(startTime + 0.3);
    });
  }

  /**
   * Filtered static + clicks for holo display speaker handoff (higher pitch; duration ± jitter).
   */
  holoDisplayStaticBurble(durationSeconds = 0.26) {
    if (!this.ctx) return;
    this.resume();
    if (this.ctx.state === "suspended") return;

    const now = this.ctx.currentTime;
    const dur = Math.max(
      0.07,
      durationSeconds + (Math.random() - 0.5) * 0.06,
    );
    const nSamples = Math.max(256, Math.ceil(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, nSamples, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < nSamples; i++) {
      const w = Math.random() * 2 - 1;
      prev = prev * 0.52 + w * 0.48;
      ch[i] = prev * (0.38 + (i / nSamples) * 0.24);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 520 + Math.random() * 380;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2800 + Math.random() * 3200, now);
    bp.frequency.exponentialRampToValueAtTime(
      1400 + Math.random() * 1800,
      now + dur * 0.9,
    );
    bp.Q.value = 0.38 + Math.random() * 0.32;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(
      0.038 + Math.random() * 0.024,
      now + Math.min(0.028, dur * 0.12),
    );
    g.gain.setValueAtTime(0.03 + Math.random() * 0.018, now + dur * 0.36);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + dur + 0.04);

    const nClicks = 4 + Math.floor(Math.random() * 5);
    for (let c = 0; c < nClicks; c++) {
      const t0 = now + Math.random() * Math.max(0.01, dur * 0.88);
      const clickMs = 0.0025 + Math.random() * 0.006;
      const nClick = Math.max(32, Math.ceil(this.ctx.sampleRate * clickMs));
      const cbuf = this.ctx.createBuffer(1, nClick, this.ctx.sampleRate);
      const cd = cbuf.getChannelData(0);
      for (let i = 0; i < nClick; i++) {
        const env = Math.sin((i / (nClick - 1)) * Math.PI);
        cd[i] = (Math.random() * 2 - 1) * env * 0.95;
      }
      const cs = this.ctx.createBufferSource();
      cs.buffer = cbuf;
      const cbp = this.ctx.createBiquadFilter();
      cbp.type = "bandpass";
      cbp.frequency.value = 3200 + Math.random() * 4800;
      cbp.Q.value = 0.65 + Math.random() * 0.5;
      const cg = this.ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.linearRampToValueAtTime(0.055 + Math.random() * 0.038, t0 + 0.0008);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + clickMs * 1.2);
      cs.connect(cbp);
      cbp.connect(cg);
      cg.connect(this.masterGain);
      cs.start(t0);
      cs.stop(t0 + clickMs + 0.008);
    }
  }

  /**
   * Kill confirmed sound
   */
  killConfirm({ streak = false } = {}) {
    if (!this.ctx || this.ctx.state === "suspended") return;
    
    const now = this.ctx.currentTime;
    let pitchMul = 1;

    if (streak) {
      const nowMs =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      if (
        this._lastKillConfirmAtMs > 0 &&
        nowMs - this._lastKillConfirmAtMs <= this._killStreakWindowMs
      ) {
        this._killStreakCount += 1;
      } else {
        this._killStreakCount = 1;
      }
      this._lastKillConfirmAtMs = nowMs;
      const semitoneSteps = Math.min(this._killStreakCount - 1, 8);
      pitchMul = 2 ** (semitoneSteps / 12);
    }
    
    // Satisfying "ding" with harmonics
    const freqs = [880, 1320, 1760]; // A5 + harmonics
    
    freqs.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.value = freq * pitchMul;
      
      gain.gain.setValueAtTime(0.2 / (i + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      
      osc.connect(gain);
      gain.connect(this.masterGain);
      
      osc.start(now);
      osc.stop(now + 0.4);
    });
  }

  /**
   * Shield recharge tone – pitch rises 3 octaves (C2 to C5) as shield refills
   */
  shieldRechargeUpdate(rechargePct) {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      this.shieldRechargeStop();
      return;
    }
    if (rechargePct >= 1) {
      this.shieldRechargeStop();
      return;
    }
    if (!this._shieldRechargeOsc) {
      this._shieldRechargeOsc = this.ctx.createOscillator();
      this._shieldRechargeGain = this.ctx.createGain();
      this._shieldRechargeOsc.type = "sine";
      this._shieldRechargeOsc.connect(this._shieldRechargeGain);
      this._shieldRechargeGain.connect(this.masterGain);
      this._shieldRechargeGain.gain.value = 0;
      this._shieldRechargeOsc.start(0);
    }
    const C2 = 65.41;
    const freq = C2 * Math.pow(2, 3 * rechargePct);
    this._shieldRechargeOsc.frequency.setTargetAtTime(
      freq,
      this.ctx.currentTime,
      0.05,
    );
    this._shieldRechargeGain.gain.setTargetAtTime(
      0.08,
      this.ctx.currentTime,
      0.03,
    );
  }

  shieldRechargeStop() {
    if (!this._shieldRechargeOsc) return;
    try {
      if (this.ctx && this._shieldRechargeGain) {
        const t = this.ctx.currentTime + 0.1;
        this._shieldRechargeGain.gain.exponentialRampToValueAtTime(0.001, t);
        this._shieldRechargeOsc.stop(t);
      }
    } catch (e) {}
    this._shieldRechargeOsc = null;
    this._shieldRechargeGain = null;
  }

  /**
   * Booster fuel recharge – same idea as shields but ~1 octave lower (C1 → ~F3)
   */
  boosterRechargeUpdate(rechargePct) {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      this.boosterRechargeStop();
      return;
    }
    if (rechargePct >= 1) {
      this.boosterRechargeStop();
      return;
    }
    if (!this._boosterRechargeOsc) {
      this._boosterRechargeOsc = this.ctx.createOscillator();
      this._boosterRechargeGain = this.ctx.createGain();
      this._boosterRechargeOsc.type = "sine";
      this._boosterRechargeOsc.connect(this._boosterRechargeGain);
      this._boosterRechargeGain.connect(this.masterGain);
      this._boosterRechargeGain.gain.value = 0;
      this._boosterRechargeOsc.start(0);
    }
    const C1 = 32.7;
    const freq = C1 * Math.pow(2, 2.5 * rechargePct);
    this._boosterRechargeOsc.frequency.setTargetAtTime(
      freq,
      this.ctx.currentTime,
      0.05,
    );
    this._boosterRechargeGain.gain.setTargetAtTime(
      0.06,
      this.ctx.currentTime,
      0.03,
    );
  }

  boosterRechargeStop() {
    if (!this._boosterRechargeOsc) return;
    try {
      if (this.ctx && this._boosterRechargeGain) {
        const t = this.ctx.currentTime + 0.1;
        this._boosterRechargeGain.gain.exponentialRampToValueAtTime(0.001, t);
        this._boosterRechargeOsc.stop(t);
      }
    } catch (e) {}
    this._boosterRechargeOsc = null;
    this._boosterRechargeGain = null;
  }

  // ============================================
  // HELPERS
  // ============================================

  _gritShaper(drive = 3) {
    const shaper = this.ctx.createWaveShaper();
    const len = 2048;
    const c = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const x = (i * 2) / (len - 1) - 1;
      c[i] = Math.tanh(x * drive);
    }
    shaper.curve = c;
    shaper.oversample = "4x";
    return shaper;
  }

  /**
   * Create white noise source
   */
  _createNoise(duration) {
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    return noise;
  }
}

// Singleton instance
const proceduralAudio = new ProceduralAudio();
export default proceduralAudio;
