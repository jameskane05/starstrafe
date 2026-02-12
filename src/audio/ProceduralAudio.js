/**
 * ProceduralAudio.js - Web Audio API procedural sound synthesis
 * 
 * Generates sounds programmatically without audio files:
 * - UI sounds (beeps, clicks, hover)
 * - Combat sounds (laser fire, shield hit, explosions)
 * - Ambient/feedback (boost, low health warning)
 */

class ProceduralAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.sfxVolume = 0.5;
    this.initialized = false;
    
    // Listener position (camera position) for spatial audio
    this.listenerPosition = { x: 0, y: 0, z: 0 };
    this.listenerForward = { x: 0, y: 0, z: -1 };
    this.listenerUp = { x: 0, y: 1, z: 0 };
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
      this.masterGain.gain.value = this.sfxVolume;
      this.initialized = true;
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
    if (this.masterGain) {
      this.masterGain.gain.value = this.sfxVolume;
    }
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
   * Kill confirmed sound
   */
  killConfirm() {
    if (!this.ctx || this.ctx.state === "suspended") return;
    
    const now = this.ctx.currentTime;
    
    // Satisfying "ding" with harmonics
    const freqs = [880, 1320, 1760]; // A5 + harmonics
    
    freqs.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.value = freq;
      
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
    if (!this.ctx || this.ctx.state === "suspended") return;
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
      this._shieldRechargeGain.gain.exponentialRampToValueAtTime(
        0.001,
        this.ctx.currentTime + 0.1,
      );
      this._shieldRechargeOsc.stop(this.ctx.currentTime + 0.1);
    } catch (e) {}
    this._shieldRechargeOsc = null;
    this._shieldRechargeGain = null;
  }

  // ============================================
  // HELPERS
  // ============================================

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
