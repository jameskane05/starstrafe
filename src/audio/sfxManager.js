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
    if (this.ctx.state === "suspended") return;
    this._ensureLoaded();

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

    if (position && def?.spatial) {
      const panner = this.ctx.createStereoPanner
        ? this.ctx.createStereoPanner()
        : null;

      if (!panner) {
        source.connect(gain);
        gain.connect(this.masterGain);
      } else {
        // Cheap stereo pan based on listener-relative position
        const lp = proceduralAudio.listenerPosition;
        const lf = proceduralAudio.listenerForward;
        if (lp && lf) {
          const dx = position.x - lp.x;
          const dz = position.z - lp.z;
          const right = -lf.z * dx + lf.x * dz;
          panner.pan.value = Math.max(-1, Math.min(1, right * 0.05));
        }

        const dist = lp ? Math.sqrt(
          (position.x - lp.x) ** 2 +
          (position.y - lp.y) ** 2 +
          (position.z - lp.z) ** 2
        ) : 1;
        const ref = def.refDistance ?? 1;
        const rolloff = def.rolloffFactor ?? 1;
        const attenuation = ref / (ref + rolloff * Math.max(0, dist - ref));
        gain.gain.value *= attenuation;

        source.connect(panner);
        panner.connect(gain);
        gain.connect(this.masterGain);
      }
    } else {
      source.connect(gain);
      gain.connect(this.masterGain);
    }

    source.start(0);
    source.onended = () => {
      gain.disconnect();
      source.disconnect();
    };
  }
}

const sfxManager = new SFXManager();
export default sfxManager;
