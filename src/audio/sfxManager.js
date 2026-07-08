/**
 * sfxManager.js - SAMPLE-BASED SFX PLAYBACK
 * =============================================================================
 *
 * ROLE: Loads and plays SFX from sfxData (or passed sounds data). Uses
 * ProceduralAudio context and gain. Spatial defs use PannerNode (3D) against
 * the AudioContext listener; falls back to StereoPanner + manual rolloff.
 *
 * KEY RESPONSIBILITIES:
 * - _loadAll() from data; play(id, position) for spatial or non-spatial
 * - Round-robin for laser; volume/pitch ranges per def
 * - get ctx, masterGain, sfxVolume from proceduralAudio
 *
 * RELATED: ProceduralAudio.js, sfxData.js, gameCombat.js, gameInit.js.
 *
 * =============================================================================
 */

import proceduralAudio from './ProceduralAudio.js';

class SFXManager {
  constructor() {
    this.buffers = new Map();
    this.indices = new Map();
    this.data = null;
    this._loading = null;
  }

  get ctx() { return proceduralAudio.ctx; }
  get masterGain() { return proceduralAudio.masterGain; }
  get sfxVolume() { return proceduralAudio.sfxVolume; }

  init(soundsData) {
    this.data = soundsData;
  }

  _ensureLoaded() {
    if (this._loading || this.buffers.size > 0) return;
    if (!this.ctx || !this.data) return;

    this._loading = this._loadAll();
  }

  async _loadAll() {
    const promises = Object.values(this.data).map(def => this._loadSound(def));
    await Promise.all(promises);
    console.log(`[SFXManager] Loaded ${this.buffers.size} sound(s)`);
  }

  async _loadSound(def) {
    try {
      if (def.src.length > 1) {
        const buffers = await Promise.all(
          def.src.map(async (file) => {
            const resp = await fetch(file);
            const ab = await resp.arrayBuffer();
            return this.ctx.decodeAudioData(ab);
          })
        );
        this.buffers.set(def.id, buffers);
        if (def.roundRobin) this.indices.set(def.id, 0);
      } else {
        const resp = await fetch(def.src[0]);
        const ab = await resp.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(ab);
        this.buffers.set(def.id, buf);
      }
    } catch (e) {
      console.warn(`[SFXManager] Failed to load "${def.id}":`, e);
    }
  }

  play(id, position = null, volumeScale = 1) {
    if (!this.ctx || !this.masterGain) return;
    if (proceduralAudio.isLoadingSuppressed?.()) return;
    this._ensureLoaded();
    this._playOrQueue(id, position, volumeScale);
  }

  _playOrQueue(id, position, volumeScale) {
    if (!this.ctx || !this.masterGain) return;

    const entry = this.buffers.get(id);
    if (!entry) {
      if (this._loading) {
        void this._loading.then(() => this._playOrQueue(id, position, volumeScale));
      }
      return;
    }

    if (this.ctx.state !== "running") {
      void proceduralAudio.resume().then(() => {
        if (this.ctx?.state === "running") {
          this._startSource(id, position, volumeScale);
        }
      });
      return;
    }

    this._startSource(id, position, volumeScale);
  }

  _startSource(id, position, volumeScale) {
    if (!this.ctx || !this.masterGain || this.ctx.state !== "running") return;

    const entry = this.buffers.get(id);
    if (!entry) return;

    const def = this.data[id];
    let buffer;

    if (Array.isArray(entry)) {
      const idx = this.indices.get(id) || 0;
      buffer = entry[idx % entry.length];
      this.indices.set(id, (idx + 1) % entry.length);
    } else {
      buffer = entry;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const vol = def?.volume ?? 1.0;
    const resolvedVol = Array.isArray(vol) ? vol[0] + Math.random() * (vol[1] - vol[0]) : vol;

    const pitch = def?.pitch;
    if (pitch) {
      source.playbackRate.value = Array.isArray(pitch) ? pitch[0] + Math.random() * (pitch[1] - pitch[0]) : pitch;
    }

    const gain = this.ctx.createGain();
    gain.gain.value = this.sfxVolume * resolvedVol * volumeScale;

    let spatialOut = null;

    if (position && def?.spatial) {
      if (typeof this.ctx.createPanner === "function") {
        const panner = this.ctx.createPanner();
        panner.panningModel = "equalpower";
        panner.distanceModel = "inverse";
        panner.refDistance = def.refDistance ?? 25;
        panner.maxDistance = def.maxDistance ?? 500;
        panner.rolloffFactor = def.rolloffFactor ?? 1;
        panner.coneInnerAngle = 360;
        panner.coneOuterAngle = 360;
        panner.setPosition(position.x, position.y, position.z);
        source.connect(panner);
        panner.connect(gain);
        spatialOut = panner;
      } else if (this.ctx.createStereoPanner) {
        const panner = this.ctx.createStereoPanner();
        const lp = proceduralAudio.listenerPosition;
        const lf = proceduralAudio.listenerForward;
        if (lp && lf) {
          const dx = position.x - lp.x;
          const dz = position.z - lp.z;
          const right = -lf.z * dx + lf.x * dz;
          panner.pan.value = Math.max(-1, Math.min(1, right * 0.12));
        }
        const dist = lp
          ? Math.sqrt(
              (position.x - lp.x) ** 2 +
                (position.y - lp.y) ** 2 +
                (position.z - lp.z) ** 2,
            )
          : 1;
        const ref = def.refDistance ?? 1;
        const rolloff = def.rolloffFactor ?? 1;
        const attenuation = ref / (ref + rolloff * Math.max(0, dist - ref));
        gain.gain.value *= attenuation;
        source.connect(panner);
        panner.connect(gain);
        spatialOut = panner;
      }
    }

    if (!spatialOut) {
      source.connect(gain);
    }
    gain.connect(this.masterGain);

    source.start(0);
    source.onended = () => {
      gain.disconnect();
      spatialOut?.disconnect();
      source.disconnect();
    };
  }
}

const sfxManager = new SFXManager();
export default sfxManager;
