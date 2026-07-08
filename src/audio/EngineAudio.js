import {
  DIALOG_DUCK_LEVEL,
  DIALOG_DUCK_RAMP_DOWN_SEC,
  DIALOG_DUCK_RAMP_UP_SEC,
} from "./dialogDuckShared.js";

/**
 * EngineAudio.js - PLAYER ENGINE AND AFTERBURNER SOUND
 * =============================================================================
 *
 * ROLE: Plays engine loop (file-based) and afterburner (procedural noise) tied
 * to player speed and boost. Pitch/volume vary with thrust; spatialized from
 * player position. Singleton used by gameUpdate.
 *
 * KEY RESPONSIBILITIES:
 * - init(): load engine buffer, create afterburner noise node
 * - update(delta, player): set target volume/pitch from velocity and boost
 * - Smooth ramping; listener position from camera for spatial
 *
 * RELATED: ProceduralAudio.js (shared ctx), Player.js, gameUpdate.js.
 *
 * =============================================================================
 */

class EngineAudio {
  constructor() {
    this.ctx = null;
    this.initialized = false;

    // Engine loop (file-based)
    this.engineBuffer = null;
    this.engineSource = null;
    this.engineGain = null;
    this.engineLoaded = false;

    // Afterburner (procedural)
    this.afterburnerNoise = null;
    this.afterburnerGain = null;
    this.afterburnerFilter = null;
    this.afterburnerActive = false;

    // Master
    this.masterGain = null;
    this.volume = 0.75;

    this._dialogDuckMul = 1;
    this._dialogDuckTarget = 1;
    this._duckRampFrom = 1;
    this._duckRampDuration = 1;
    this._duckRampElapsed = 0;
    this._duckRampActive = false;
    this._loadingSuppressed = false;

    // Smoothed values
    this.currentEngineVolume = 0;
    this.currentEnginePitch = 1;
    this.currentAfterburnerVolume = 0;
    this.targetEngineVolume = 0;
    this.targetEnginePitch = 1;
    this.targetAfterburnerVolume = 0;

    // Tuning
    this.idleVolume = 0.08;
    this.maxVolume = 0.6;
    this.idlePitch = 0.8;
    this.maxPitch = 1.4;
    this.afterburnerMaxVolume = 0.3;
    this.smoothUp = 4.0;   // speed to ramp up
    this.smoothDown = 2.0; // speed to ramp down
  }

  async init() {
    if (this.initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
      this.masterGain = this.ctx.createGain();
      this._syncEngineMasterGain();
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
      await this._loadEngine();
      this._createAfterburner();
    } catch (e) {
      console.error('[EngineAudio] Init failed:', e);
    }
  }

  async _loadEngine() {
    try {
      const response = await fetch('./audio/sfx/engine.mp3');
      const arrayBuffer = await response.arrayBuffer();
      this.engineBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.engineLoaded = true;

      // Create gain node
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = this.idleVolume;
      this.engineGain.connect(this.masterGain);

      // Start looping source
      this._startEngineLoop();
    } catch (e) {
      console.error('[EngineAudio] Failed to load engine.mp3:', e);
    }
  }

  _startEngineLoop() {
    if (!this.engineBuffer || !this.ctx) return;
    this.engineSource = this.ctx.createBufferSource();
    this.engineSource.buffer = this.engineBuffer;
    this.engineSource.loop = true;
    this.engineSource.playbackRate.value = this.idlePitch;
    this.engineSource.connect(this.engineGain);
    this.engineSource.start(0);
  }

  _createAfterburner() {
    if (!this.ctx) return;

    // White noise source for afterburner rumble
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.afterburnerNoise = this.ctx.createBufferSource();
    this.afterburnerNoise.buffer = noiseBuffer;
    this.afterburnerNoise.loop = true;

    // Bandpass filter for rumble character
    this.afterburnerFilter = this.ctx.createBiquadFilter();
    this.afterburnerFilter.type = 'bandpass';
    this.afterburnerFilter.frequency.value = 200;
    this.afterburnerFilter.Q.value = 0.8;

    this.afterburnerGain = this.ctx.createGain();
    this.afterburnerGain.gain.value = 0;

    this.afterburnerNoise.connect(this.afterburnerFilter);
    this.afterburnerFilter.connect(this.afterburnerGain);
    this.afterburnerGain.connect(this.masterGain);
    this.afterburnerNoise.start(0);
  }

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
    }
  }

  _syncEngineMasterGain() {
    if (this.masterGain) {
      this.masterGain.gain.value = this._loadingSuppressed
        ? 0
        : this.volume * this._dialogDuckMul;
    }
  }

  setLoadingSuppressed(active) {
    this._loadingSuppressed = active === true;
    if (this._loadingSuppressed) {
      this.currentEngineVolume = 0;
      this.currentAfterburnerVolume = 0;
      this.targetEngineVolume = 0;
      this.targetAfterburnerVolume = 0;
      if (this.engineGain) this.engineGain.gain.value = 0;
      if (this.afterburnerGain) this.afterburnerGain.gain.value = 0;
    }
    this._syncEngineMasterGain();
  }

  /** Call every frame (including menu) so dialog duck ramps while the engine graph is idle. */
  updateDialogDuck(delta) {
    this._smoothDialogDuck(delta);
    this._syncEngineMasterGain();
  }

  update(delta, player) {
    if (this._loadingSuppressed) {
      if (this.engineGain) this.engineGain.gain.value = 0;
      if (this.afterburnerGain) this.afterburnerGain.gain.value = 0;
      this._syncEngineMasterGain();
      return;
    }
    if (!this.initialized || !this.engineLoaded || !player) {
      this._syncEngineMasterGain();
      return;
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // Compute intensity from player motion + rotation
    const speed = player.velocity.length();
    const speedNorm = Math.min(speed / player.maxSpeed, 1);

    const rotSpeed = Math.abs(player.pitchVelocity) +
                     Math.abs(player.yawVelocity) +
                     Math.abs(player.rollVelocity);
    const rotNorm = Math.min(rotSpeed / 5.0, 1); // 5 = rough max combined rotation speed

    // Combined intensity (motion weighted higher)
    const intensity = Math.min(speedNorm * 0.7 + rotNorm * 0.3, 1);

    // Targets
    this.targetEngineVolume = this.idleVolume + (this.maxVolume - this.idleVolume) * intensity;
    this.targetEnginePitch = this.idlePitch + (this.maxPitch - this.idlePitch) * intensity;

    // Afterburner when boosting
    this.targetAfterburnerVolume = player.isBoosting ? this.afterburnerMaxVolume : 0;

    // Smooth with asymmetric easing (ramp up faster than ramp down)
    const easeUp = this.smoothUp * delta;
    const easeDown = this.smoothDown * delta;

    this.currentEngineVolume += (this.targetEngineVolume - this.currentEngineVolume) *
      (this.targetEngineVolume > this.currentEngineVolume ? easeUp : easeDown);

    this.currentEnginePitch += (this.targetEnginePitch - this.currentEnginePitch) *
      (this.targetEnginePitch > this.currentEnginePitch ? easeUp : easeDown);

    this.currentAfterburnerVolume += (this.targetAfterburnerVolume - this.currentAfterburnerVolume) *
      (this.targetAfterburnerVolume > this.currentAfterburnerVolume ? easeUp * 1.5 : easeDown);

    // Apply
    if (this.engineGain) {
      this.engineGain.gain.value = this.currentEngineVolume;
    }
    if (this.engineSource) {
      this.engineSource.playbackRate.value = this.currentEnginePitch;
    }
    if (this.afterburnerGain) {
      this.afterburnerGain.gain.value = this.currentAfterburnerVolume;
    }
    if (this.afterburnerFilter) {
      // Shift filter frequency with intensity for more character
      this.afterburnerFilter.frequency.value = 150 + intensity * 300;
    }

    this._syncEngineMasterGain();
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    this._syncEngineMasterGain();
  }

  stop() {
    if (this.engineSource) {
      try { this.engineSource.stop(); } catch (e) {}
      this.engineSource = null;
    }
    if (this.afterburnerNoise) {
      try { this.afterburnerNoise.stop(); } catch (e) {}
      this.afterburnerNoise = null;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    // Restart engine loop if it was stopped
    if (!this.engineSource && this.engineLoaded) {
      this._startEngineLoop();
    }
    // Restart afterburner if stopped
    if (!this.afterburnerNoise) {
      this._createAfterburner();
    }
  }
}

const engineAudio = new EngineAudio();
export default engineAudio;
