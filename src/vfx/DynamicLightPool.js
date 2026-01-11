import * as THREE from "three";

export class DynamicLightPool {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.size = options.size ?? 12;
    this.defaultDistance = options.defaultDistance ?? 18;
    this.defaultDecay = options.defaultDecay ?? 2;

    this.lights = [];
    this.active = new Array(this.size).fill(false);
    this.ttl = new Float32Array(this.size);
    this.fade = new Float32Array(this.size);
    this.baseIntensity = new Float32Array(this.size);

    for (let i = 0; i < this.size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, this.defaultDistance, this.defaultDecay);
      light.visible = false;
      this.lights.push(light);
      scene.add(light);
    }
  }

  flash(position, color, options = {}) {
    const idx = this._alloc();
    if (idx === -1) return null;

    const light = this.lights[idx];
    light.color.set(color ?? 0xffffff);
    light.position.copy(position);
    light.distance = options.distance ?? this.defaultDistance;
    light.decay = options.decay ?? this.defaultDecay;
    light.intensity = options.intensity ?? 12;
    light.visible = true;

    this.baseIntensity[idx] = light.intensity;
    this.ttl[idx] = options.ttl ?? 0.08;
    this.fade[idx] = options.fade ?? 0.12;

    return idx;
  }

  update(dt) {
    for (let i = 0; i < this.size; i++) {
      if (!this.active[i]) continue;

      this.ttl[i] -= dt;
      if (this.ttl[i] <= 0) {
        this._free(i);
        continue;
      }

      const fade = this.fade[i];
      if (fade > 0) {
        const t = Math.min(1, this.ttl[i] / fade);
        this.lights[i].intensity = this.baseIntensity[i] * t;
      }
    }
  }

  _alloc() {
    for (let i = 0; i < this.size; i++) {
      if (!this.active[i]) {
        this.active[i] = true;
        return i;
      }
    }

    let worst = 0;
    let minTtl = this.ttl[0];
    for (let i = 1; i < this.size; i++) {
      if (this.ttl[i] < minTtl) {
        minTtl = this.ttl[i];
        worst = i;
      }
    }

    this.active[worst] = true;
    return worst;
  }

  _free(i) {
    const light = this.lights[i];
    light.intensity = 0;
    light.visible = false;
    this.active[i] = false;
    this.ttl[i] = 0;
    this.fade[i] = 0;
    this.baseIntensity[i] = 0;
  }
}


