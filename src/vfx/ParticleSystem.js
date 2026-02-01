import * as THREE from "three";

function createRadialTexture(size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  g.addColorStop(0.0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.7)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

class PointParticlePool {
  constructor(scene, max, options) {
    this.max = max;
    this.scene = scene;

    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.alphas = new Float32Array(max);
    this.startAlphas = new Float32Array(max);
    this.sizes = new Float32Array(max);
    this.velocities = new Float32Array(max * 3);
    this.ages = new Float32Array(max);
    this.lifetimes = new Float32Array(max);
    this.drags = new Float32Array(max);
    this.rises = new Float32Array(max);

    this.free = [];
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
    this.active = [];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3)
    );
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute("alpha", new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: options.depthTest ?? true,
      blending: options.blending ?? THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uMap: { value: options.map },
        uSizeScale: { value: options.sizeScale ?? 300.0 },
      },
      vertexShader: `
        attribute float alpha;
        attribute float size;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uSizeScale;
        void main() {
          vAlpha = alpha;
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (uSizeScale / max(1.0, -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float a = tex.a * vAlpha;
          if (a <= 0.001) discard;
          gl_FragColor = vec4(vColor, 1.0) * a;
        }
      `,
    });

    this.points = new THREE.Points(geometry, material);
    this.material = material;
    this.points.frustumCulled = false;
    if (options.renderOrder != null) {
      this.points.renderOrder = options.renderOrder;
    }
    scene.add(this.points);
  }

  setSizeScale(v) {
    this.material.uniforms.uSizeScale.value = v;
  }

  setEnabled(enabled) {
    this.points.visible = !!enabled;
  }

  emit(params) {
    if (this.free.length === 0) return;
    const i = this.free.pop();
    this.active.push(i);

    const p3 = i * 3;
    this.positions[p3] = params.x;
    this.positions[p3 + 1] = params.y;
    this.positions[p3 + 2] = params.z;

    this.velocities[p3] = params.vx;
    this.velocities[p3 + 1] = params.vy;
    this.velocities[p3 + 2] = params.vz;

    this.colors[p3] = params.r;
    this.colors[p3 + 1] = params.g;
    this.colors[p3 + 2] = params.b;

    this.alphas[i] = params.alpha;
    this.startAlphas[i] = params.alpha;
    this.sizes[i] = params.size;
    this.ages[i] = 0;
    this.lifetimes[i] = params.life;
    this.drags[i] = params.drag;
    this.rises[i] = params.rise;

    const geom = this.points.geometry;
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
    geom.attributes.alpha.needsUpdate = true;
    geom.attributes.size.needsUpdate = true;
  }

  update(dt) {
    const geom = this.points.geometry;
    let changed = false;

    for (let a = this.active.length - 1; a >= 0; a--) {
      const i = this.active[a];
      this.ages[i] += dt;
      const t = this.ages[i] / this.lifetimes[i];

      if (t >= 1) {
        this.alphas[i] = 0;
        this.startAlphas[i] = 0;
        const p3 = i * 3;
        this.colors[p3] = 0;
        this.colors[p3 + 1] = 0;
        this.colors[p3 + 2] = 0;
        this.active[a] = this.active[this.active.length - 1];
        this.active.pop();
        this.free.push(i);
        changed = true;
        continue;
      }

      const p3 = i * 3;
      this.positions[p3] += this.velocities[p3] * dt;
      this.positions[p3 + 1] += this.velocities[p3 + 1] * dt;
      this.positions[p3 + 2] += this.velocities[p3 + 2] * dt;

      this.velocities[p3 + 1] += this.rises[i] * dt;

      const drag = this.drags[i];
      this.velocities[p3] *= drag;
      this.velocities[p3 + 1] *= drag;
      this.velocities[p3 + 2] *= drag;

      this.alphas[i] = this.startAlphas[i] * (1 - t);
      changed = true;
    }

    if (changed) {
      geom.attributes.position.needsUpdate = true;
      geom.attributes.alpha.needsUpdate = true;
      geom.attributes.color.needsUpdate = true;
    }
  }
}

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _exhaust = new THREE.Vector3();

export class ParticleSystem {
  constructor(scene) {
    const map = createRadialTexture(64);

    this.sparks = new PointParticlePool(scene, 204, {
      map,
      blending: THREE.AdditiveBlending,
      sizeScale: 42,
    });
    this.fire = new PointParticlePool(scene, 100, {
      map,
      blending: THREE.AdditiveBlending,
      sizeScale: 26,
      depthTest: false,
      renderOrder: 9999,
    });
    this.smoke = new PointParticlePool(scene, 104, {
      map,
      blending: THREE.AdditiveBlending,
      sizeScale: 36,
    });
  }

  update(dt) {
    this.sparks.update(dt);
    this.fire.update(dt);
    this.smoke.update(dt);
  }

  setFireSizeScale(v) {
    this.fire.setSizeScale(v);
  }
  setSmokeSizeScale(v) {
    this.smoke.setSizeScale(v);
  }
  setSparksSizeScale(v) {
    this.sparks.setSizeScale(v);
  }

  enableFire(enabled) {
    this.fire.setEnabled(enabled);
  }
  enableSmoke(enabled) {
    this.smoke.setEnabled(enabled);
  }
  enableSparks(enabled) {
    this.sparks.setEnabled(enabled);
  }

  emitMissileExhaust(worldPos, worldQuat, dir) {
    // Missile local +Z is forward, so exhaust should be at -Z (behind the missile),
    // otherwise it spawns in front and can bloom over the whole view.
    _exhaust.set(0, 0, -0.35).applyQuaternion(worldQuat).add(worldPos);
    _tmp.copy(dir).negate();

    // Afterburner fire puffs (short-lived, hot core)
    for (let i = 0; i < 1; i++) {
      _tmp2.copy(_tmp).multiplyScalar(0.8 + Math.random() * 1.4);
      _tmp2.x += (Math.random() - 0.5) * 0.8;
      _tmp2.y += (Math.random() - 0.5) * 0.8;
      _tmp2.z += (Math.random() - 0.5) * 0.8;

      const hot = Math.random() > 0.5;
      this.fire.emit({
        x: _exhaust.x + (Math.random() - 0.5) * 0.12,
        y: _exhaust.y + (Math.random() - 0.5) * 0.12,
        z: _exhaust.z + (Math.random() - 0.5) * 0.12,
        vx: _tmp2.x,
        vy: _tmp2.y,
        vz: _tmp2.z,
        r: 1.0,
        g: hot ? 0.55 : 0.75,
        b: hot ? 0.08 : 0.2,
        alpha: 0.8,
        size: 18 + Math.random() * 12,
        life: 0.12 + Math.random() * 0.08,
        drag: 0.92,
        rise: 0.1,
      });
    }

    for (let i = 0; i < 2; i++) {
      const s = 0.5 + Math.random() * 0.8;
      const jx = (Math.random() - 0.5) * 0.12;
      const jy = (Math.random() - 0.5) * 0.12;
      const jz = (Math.random() - 0.5) * 0.12;

      _tmp2.copy(_tmp).multiplyScalar(3 + Math.random() * 5);
      _tmp2.x += (Math.random() - 0.5) * 2.2;
      _tmp2.y += (Math.random() - 0.5) * 2.2;
      _tmp2.z += (Math.random() - 0.5) * 2.2;

      const warm = Math.random() > 0.35;
      this.sparks.emit({
        x: _exhaust.x + jx,
        y: _exhaust.y + jy,
        z: _exhaust.z + jz,
        vx: _tmp2.x,
        vy: _tmp2.y,
        vz: _tmp2.z,
        r: warm ? 1.0 : 1.0,
        g: warm ? 0.67 : 1.0,
        b: warm ? 0.15 : 1.0,
        alpha: 0.9,
        size: 8 * s,
        life: 0.18 + Math.random() * 0.12,
        drag: 0.93,
        rise: 0,
      });
    }

    if (Math.random() > 0.25) {
      _tmp2.copy(_tmp).multiplyScalar(1 + Math.random() * 2);
      _tmp2.x += (Math.random() - 0.5) * 0.6;
      _tmp2.y += Math.random() * 0.7;
      _tmp2.z += (Math.random() - 0.5) * 0.6;

      this.smoke.emit({
        x: _exhaust.x + (Math.random() - 0.5) * 0.2,
        y: _exhaust.y + (Math.random() - 0.5) * 0.2,
        z: _exhaust.z + (Math.random() - 0.5) * 0.2,
        vx: _tmp2.x,
        vy: _tmp2.y,
        vz: _tmp2.z,
        r: 0.5,
        g: 0.5,
        b: 0.5,
        alpha: 0.42,
        size: 26 + Math.random() * 16,
        life: 0.9 + Math.random() * 0.6,
        drag: 0.92,
        rise: 2.2,
      });
    }
  }
}
