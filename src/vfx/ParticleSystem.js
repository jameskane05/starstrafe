import * as THREE from "three";

const textureLoader = new THREE.TextureLoader();

function loadTexture(path) {
  const tex = textureLoader.load(path);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// ── Emission shape helpers ──
const _dir = new THREE.Vector3();

function emitSphere(center, radius) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  _dir.set(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi)
  );
  return {
    x: center.x + _dir.x * radius,
    y: center.y + _dir.y * radius,
    z: center.z + _dir.z * radius,
    dx: _dir.x, dy: _dir.y, dz: _dir.z,
  };
}

function emitHemisphere(center, radius) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(Math.random());
  _dir.set(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  );
  return {
    x: center.x + _dir.x * radius,
    y: center.y + _dir.y * radius,
    z: center.z + _dir.z * radius,
    dx: _dir.x, dy: _dir.y, dz: _dir.z,
  };
}

function emitCone(center, radius, angle = 25) {
  const angleRad = (angle * Math.PI) / 180;
  const r = Math.sqrt(Math.random()) * radius;
  const theta = Math.random() * Math.PI * 2;
  const px = r * Math.cos(theta);
  const pz = r * Math.sin(theta);
  const spread = Math.tan(angleRad) * Math.random();
  _dir.set(
    px * spread + (Math.random() - 0.5) * 0.2,
    1,
    pz * spread + (Math.random() - 0.5) * 0.2
  ).normalize();
  return {
    x: center.x + px, y: center.y, z: center.z + pz,
    dx: _dir.x, dy: _dir.y, dz: _dir.z,
  };
}

export { emitSphere, emitHemisphere, emitCone };

// ── Billboard Quad Pool (instanced, for large particles) ──

class BillboardParticlePool {
  constructor(scene, max, options) {
    this.max = max;
    this.scene = scene;
    this.tilesX = options.tilesX || 1;
    this.tilesY = options.tilesY || 1;
    this.totalFrames = this.tilesX * this.tilesY;
    this.animated = this.totalFrames > 1;

    this.offsets = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.startColors = new Float32Array(max * 3);
    this.alphas = new Float32Array(max);
    this.startAlphas = new Float32Array(max);
    this.scales = new Float32Array(max);
    this.startScales = new Float32Array(max);
    this.sizeGrow = new Float32Array(max);
    this.frames = new Float32Array(max);
    this.rotations = new Float32Array(max);
    this.startFrames = new Float32Array(max);
    this.noiseStrength = new Float32Array(max);
    this.noiseFreq = new Float32Array(max);
    this.noiseOffset = new Float32Array(max * 3);
    this.speedLimit = new Float32Array(max);
    this.speedDampen = new Float32Array(max);
    this.velocities = new Float32Array(max * 3);
    this.velocityOverLifetime = new Float32Array(max * 3);
    this.ages = new Float32Array(max);
    this.lifetimes = new Float32Array(max);
    this.drags = new Float32Array(max);
    this.rises = new Float32Array(max);
    this.alphaFadeInOut = new Float32Array(max); // 0 = linear fade, 1 = fade-in-fade-out

    this.free = [];
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
    this.active = [];

    const quadGeo = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quadGeo.index;
    geo.setAttribute('position', quadGeo.getAttribute('position'));
    geo.setAttribute('uv', quadGeo.getAttribute('uv'));

    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(this.offsets, 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.colors, 3));
    geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alphas, 1));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(this.scales, 1));
    geo.setAttribute('aFrame', new THREE.InstancedBufferAttribute(this.frames, 1));
    geo.setAttribute('aRotation', new THREE.InstancedBufferAttribute(this.rotations, 1));

    geo.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: options.blending ?? THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: options.map },
        uTilesX: { value: this.tilesX },
        uTilesY: { value: this.tilesY },
        uUseLuminanceAlpha: { value: options.luminanceAlpha ? 1.0 : 0.0 },
        uPremultipliedAlpha: { value: options.premultipliedAlpha ? 1.0 : 0.0 },
      },
      vertexShader: `
        attribute vec3 offset;
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aScale;
        attribute float aFrame;
        attribute float aRotation;

        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vFrame;

        void main() {
          vUv = uv;
          vColor = aColor;
          vAlpha = aAlpha;
          vFrame = aFrame;

          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

          float c = cos(aRotation);
          float s = sin(aRotation);
          vec3 rotRight = camRight * c + camUp * s;
          vec3 rotUp    = -camRight * s + camUp * c;

          vec3 worldPos = offset
            + rotRight * position.x * aScale
            + rotUp * position.y * aScale;

          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uTilesX;
        uniform float uTilesY;
        uniform float uUseLuminanceAlpha;
        uniform float uPremultipliedAlpha;

        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vFrame;

        void main() {
          float totalFrames = uTilesX * uTilesY;
          float f = clamp(floor(vFrame), 0.0, totalFrames - 1.0);
          float col = mod(f, uTilesX);
          float row = floor(f / uTilesX);
          vec2 tileSize = vec2(1.0 / uTilesX, 1.0 / uTilesY);
          vec2 tileUv = vUv * tileSize + vec2(col * tileSize.x, (uTilesY - 1.0 - row) * tileSize.y);

          vec4 tex = texture2D(uMap, tileUv);
          float texAlpha = uUseLuminanceAlpha > 0.5
            ? dot(tex.rgb, vec3(0.299, 0.587, 0.114))
            : tex.a;
          float a = texAlpha * vAlpha;
          if (a <= 0.001) discard;

          vec3 rgb = vColor * tex.rgb;
          if (uPremultipliedAlpha > 0.5) {
            rgb *= a;
          }
          gl_FragColor = vec4(rgb, a);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    if (options.renderOrder != null) {
      this.mesh.renderOrder = options.renderOrder;
    }
    this.geometry = geo;
    this.material = material;
    scene.add(this.mesh);
  }

  setEnabled(enabled) { this.mesh.visible = !!enabled; }

  emit(params) {
    if (this.free.length === 0) return;
    const i = this.free.pop();
    this.active.push(i);
    const p3 = i * 3;

    this.offsets[p3] = params.x;
    this.offsets[p3 + 1] = params.y;
    this.offsets[p3 + 2] = params.z;
    this.velocities[p3] = params.vx;
    this.velocities[p3 + 1] = params.vy;
    this.velocities[p3 + 2] = params.vz;
    this.colors[p3] = params.r;
    this.colors[p3 + 1] = params.g;
    this.colors[p3 + 2] = params.b;
    this.startColors[p3] = params.r;
    this.startColors[p3 + 1] = params.g;
    this.startColors[p3 + 2] = params.b;
    this.alphas[i] = params.alpha;
    this.startAlphas[i] = params.alpha;
    this.scales[i] = params.size;
    this.startScales[i] = params.size;
    this.sizeGrow[i] = params.sizeGrow ?? 1;
    this.ages[i] = 0;
    this.lifetimes[i] = params.life;
    this.drags[i] = params.drag;
    this.rises[i] = params.rise;
    this.rotations[i] = params.rotation ?? (Math.random() * Math.PI * 2);
    this.noiseStrength[i] = params.noise ?? 0;
    this.noiseFreq[i] = params.noiseFreq ?? 0.2;
    this.noiseOffset[p3] = Math.random() * 1000;
    this.noiseOffset[p3 + 1] = Math.random() * 1000;
    this.noiseOffset[p3 + 2] = Math.random() * 1000;
    this.speedLimit[i] = params.speedLimit ?? 0;
    this.speedDampen[i] = params.speedDampen ?? 0;
    this.velocityOverLifetime[p3] = params.velocityOverLifetimeX ?? 0;
    this.velocityOverLifetime[p3 + 1] = params.velocityOverLifetimeY ?? 0;
    this.velocityOverLifetime[p3 + 2] = params.velocityOverLifetimeZ ?? 0;
    this.alphaFadeInOut[i] = params.alphaFadeInOut ? 1 : 0; // Enable fade-in-fade-out curve
    const startFrame = params.frame ?? Math.floor(Math.random() * this.totalFrames);
    this.startFrames[i] = startFrame;
    this.frames[i] = startFrame;
  }

  update(dt) {
    let changed = false;

    for (let a = this.active.length - 1; a >= 0; a--) {
      const i = this.active[a];
      this.ages[i] += dt;
      const t = this.ages[i] / this.lifetimes[i];

      if (t >= 1) {
        this.alphas[i] = 0;
        this.scales[i] = 0;
        this.active[a] = this.active[this.active.length - 1];
        this.active.pop();
        this.free.push(i);
        changed = true;
        continue;
      }

      const p3 = i * 3;

      // Velocity over lifetime
      this.velocities[p3] += this.velocityOverLifetime[p3] * dt;
      this.velocities[p3 + 1] += this.velocityOverLifetime[p3 + 1] * dt;
      this.velocities[p3 + 2] += this.velocityOverLifetime[p3 + 2] * dt;

      this.offsets[p3] += this.velocities[p3] * dt;
      this.offsets[p3 + 1] += this.velocities[p3 + 1] * dt;
      this.offsets[p3 + 2] += this.velocities[p3 + 2] * dt;
      this.velocities[p3 + 1] += this.rises[i] * dt;

      const drag = this.drags[i];
      this.velocities[p3] *= drag;
      this.velocities[p3 + 1] *= drag;
      this.velocities[p3 + 2] *= drag;

      // Noise turbulence
      const ns = this.noiseStrength[i];
      if (ns > 0) {
        const freq = this.noiseFreq[i];
        const time = this.ages[i] * 2;
        const ox = this.noiseOffset[p3];
        const oy = this.noiseOffset[p3 + 1];
        const oz = this.noiseOffset[p3 + 2];
        this.velocities[p3] += Math.sin(ox + time * freq) * ns * dt;
        this.velocities[p3 + 1] += Math.sin(oy + time * freq * 1.3) * ns * dt;
        this.velocities[p3 + 2] += Math.sin(oz + time * freq * 0.7) * ns * dt;
      }

      // Speed limiting
      const sl = this.speedLimit[i];
      if (sl > 0) {
        const vx = this.velocities[p3];
        const vy = this.velocities[p3 + 1];
        const vz = this.velocities[p3 + 2];
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed > sl) {
          const dampen = this.speedDampen[i];
          const factor = 1 - dampen * (1 - sl / speed);
          this.velocities[p3] *= factor;
          this.velocities[p3 + 1] *= factor;
          this.velocities[p3 + 2] *= factor;
        }
      }

      // Alpha over lifetime
      if (this.alphaFadeInOut[i] > 0) {
        // Fade-in-fade-out curve: 0 -> peak -> 0
        // Unity dust motes: peak at ~0.48 lifetime, alpha 0.082
        const peakTime = 0.48; // When alpha peaks
        let alphaCurve;
        if (t < peakTime) {
          // Fade in: 0 to peak
          alphaCurve = t / peakTime;
        } else {
          // Fade out: peak to 0
          alphaCurve = (1 - t) / (1 - peakTime);
        }
        this.alphas[i] = this.startAlphas[i] * alphaCurve;
      } else {
        // Linear fade out
        this.alphas[i] = this.startAlphas[i] * (1 - t);
      }

      // Size over lifetime
      const grow = this.sizeGrow[i];
      if (grow !== 1) {
        this.scales[i] = this.startScales[i] * (1 + (grow - 1) * t);
      }

      // Color over lifetime
      if (t > 0.3) {
        const ct = (t - 0.3) / 0.7;
        this.colors[p3] = this.startColors[p3] * (1 - ct * 0.3);
        this.colors[p3 + 1] = this.startColors[p3 + 1] * (1 - ct * 0.6);
        this.colors[p3 + 2] = this.startColors[p3 + 2] * (1 - ct * 0.9);
      }

      this.rotations[i] += dt * 0.5;

      if (this.animated) {
        const frameOffset = Math.floor(t * this.totalFrames);
        this.frames[i] = (this.startFrames[i] + frameOffset) % this.totalFrames;
      }

      changed = true;
    }

    if (changed) {
      const geo = this.geometry;
      geo.instanceCount = this.max;
      geo.getAttribute('offset').needsUpdate = true;
      geo.getAttribute('aColor').needsUpdate = true;
      geo.getAttribute('aAlpha').needsUpdate = true;
      geo.getAttribute('aScale').needsUpdate = true;
      geo.getAttribute('aFrame').needsUpdate = true;
      geo.getAttribute('aRotation').needsUpdate = true;
    }
  }
}

// ── Point Sprite Pool (for small particles like sparks/embers) ──

class PointParticlePool {
  constructor(scene, max, options) {
    this.max = max;
    this.scene = scene;

    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.startColors = new Float32Array(max * 3);
    this.alphas = new Float32Array(max);
    this.startAlphas = new Float32Array(max);
    this.sizes = new Float32Array(max);
    this.velocities = new Float32Array(max * 3);
    this.velocityOverLifetime = new Float32Array(max * 3);
    this.speedLimit = new Float32Array(max);
    this.speedDampen = new Float32Array(max);
    this.ages = new Float32Array(max);
    this.lifetimes = new Float32Array(max);
    this.drags = new Float32Array(max);
    this.rises = new Float32Array(max);

    this.free = [];
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
    this.active = [];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: options.blending ?? THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uMap: { value: options.map },
        uSizeScale: { value: options.sizeScale ?? 300.0 },
      },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uSizeScale;
        void main() {
          vAlpha = aAlpha;
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uSizeScale / max(1.0, -mvPosition.z));
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
          gl_FragColor = vec4(vColor * tex.rgb, 1.0) * a;
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

  setEnabled(enabled) { this.points.visible = !!enabled; }

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
    this.startColors[p3] = params.r;
    this.startColors[p3 + 1] = params.g;
    this.startColors[p3 + 2] = params.b;
    this.alphas[i] = params.alpha;
    this.startAlphas[i] = params.alpha;
    this.sizes[i] = params.size;
    this.ages[i] = 0;
    this.lifetimes[i] = params.life;
    this.drags[i] = params.drag;
    this.rises[i] = params.rise;
    this.velocityOverLifetime[p3] = params.velocityOverLifetimeX || 0;
    this.velocityOverLifetime[p3 + 1] = params.velocityOverLifetimeY || 0;
    this.velocityOverLifetime[p3 + 2] = params.velocityOverLifetimeZ || 0;
    this.speedLimit[i] = params.speedLimit || 0;
    this.speedDampen[i] = params.speedDampen || 0;

    const geom = this.points.geometry;
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
    geom.attributes.aAlpha.needsUpdate = true;
    geom.attributes.aSize.needsUpdate = true;
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

      // Velocity over lifetime
      this.velocities[p3] += this.velocityOverLifetime[p3] * dt;
      this.velocities[p3 + 1] += this.velocityOverLifetime[p3 + 1] * dt;
      this.velocities[p3 + 2] += this.velocityOverLifetime[p3 + 2] * dt;

      // Speed limiting
      const limit = this.speedLimit[i];
      if (limit > 0) {
        const vx = this.velocities[p3];
        const vy = this.velocities[p3 + 1];
        const vz = this.velocities[p3 + 2];
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed > limit) {
          const dampen = this.speedDampen[i] || 1.0;
          const scale = (limit / speed) * (1 - dampen) + dampen;
          this.velocities[p3] *= scale;
          this.velocities[p3 + 1] *= scale;
          this.velocities[p3 + 2] *= scale;
        }
      }

      this.positions[p3] += this.velocities[p3] * dt;
      this.positions[p3 + 1] += this.velocities[p3 + 1] * dt;
      this.positions[p3 + 2] += this.velocities[p3 + 2] * dt;
      this.velocities[p3 + 1] += this.rises[i] * dt;
      const drag = this.drags[i];
      this.velocities[p3] *= drag;
      this.velocities[p3 + 1] *= drag;
      this.velocities[p3 + 2] *= drag;
      this.alphas[i] = this.startAlphas[i] * (1 - t);

      // Color over lifetime
      if (t > 0.3) {
        const ct = (t - 0.3) / 0.7;
        this.colors[p3] = this.startColors[p3] * (1 - ct * 0.3);
        this.colors[p3 + 1] = this.startColors[p3 + 1] * (1 - ct * 0.6);
        this.colors[p3 + 2] = this.startColors[p3 + 2] * (1 - ct * 0.9);
      }

      changed = true;
    }

    if (changed) {
      geom.attributes.position.needsUpdate = true;
      geom.attributes.aAlpha.needsUpdate = true;
      geom.attributes.color.needsUpdate = true;
      geom.attributes.aSize.needsUpdate = true;
    }
  }
}

// ── Line Spark Pool (velocity-stretched lines for electrical sparks) ──

class LineSparkPool {
  constructor(scene, max, options = {}) {
    this.max = max;
    this.positions = new Float32Array(max * 6); // 2 verts per line (head + tail)
    this.colors = new Float32Array(max * 6);
    this.startColors = new Float32Array(max * 3);
    this.alphas = new Float32Array(max);
    this.startAlphas = new Float32Array(max);
    this.headPos = new Float32Array(max * 3);
    this.velocities = new Float32Array(max * 3);
    this.velocityOverLifetime = new Float32Array(max * 3);
    this.speedLimit = new Float32Array(max);
    this.speedDampen = new Float32Array(max);
    this.ages = new Float32Array(max);
    this.lifetimes = new Float32Array(max);
    this.drags = new Float32Array(max);
    this.rises = new Float32Array(max);
    this.trailLength = new Float32Array(max);

    this.free = [];
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
    this.active = [];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: options.blending ?? THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      linewidth: 1,
    });

    this.lines = new THREE.LineSegments(geometry, material);
    this.lines.frustumCulled = false;
    if (options.renderOrder != null) {
      this.lines.renderOrder = options.renderOrder;
    }
    scene.add(this.lines);
  }

  setEnabled(enabled) { this.lines.visible = !!enabled; }

  emit(params) {
    if (this.free.length === 0) return;
    const i = this.free.pop();
    this.active.push(i);
    const p3 = i * 3;

    this.headPos[p3] = params.x;
    this.headPos[p3 + 1] = params.y;
    this.headPos[p3 + 2] = params.z;
    this.velocities[p3] = params.vx;
    this.velocities[p3 + 1] = params.vy;
    this.velocities[p3 + 2] = params.vz;
    this.startColors[p3] = params.r;
    this.startColors[p3 + 1] = params.g;
    this.startColors[p3 + 2] = params.b;
    this.alphas[i] = params.alpha;
    this.startAlphas[i] = params.alpha;
    this.ages[i] = 0;
    this.lifetimes[i] = params.life;
    this.drags[i] = params.drag;
    this.rises[i] = params.rise ?? 0;
    this.trailLength[i] = params.trailLength ?? 0.3;
    this.velocityOverLifetime[p3] = params.velocityOverLifetimeX ?? 0;
    this.velocityOverLifetime[p3 + 1] = params.velocityOverLifetimeY ?? 0;
    this.velocityOverLifetime[p3 + 2] = params.velocityOverLifetimeZ ?? 0;
    this.speedLimit[i] = params.speedLimit ?? 0;
    this.speedDampen[i] = params.speedDampen ?? 0;

    // Set initial line segment (head = tail at spawn)
    const p6 = i * 6;
    this.positions[p6] = params.x;
    this.positions[p6 + 1] = params.y;
    this.positions[p6 + 2] = params.z;
    this.positions[p6 + 3] = params.x;
    this.positions[p6 + 4] = params.y;
    this.positions[p6 + 5] = params.z;
    this.colors[p6] = params.r;
    this.colors[p6 + 1] = params.g;
    this.colors[p6 + 2] = params.b;
    this.colors[p6 + 3] = params.r * 0.3;
    this.colors[p6 + 4] = params.g * 0.3;
    this.colors[p6 + 5] = params.b * 0.3;
  }

  update(dt) {
    let changed = false;
    for (let a = this.active.length - 1; a >= 0; a--) {
      const i = this.active[a];
      this.ages[i] += dt;
      const t = this.ages[i] / this.lifetimes[i];

      if (t >= 1) {
        const p6 = i * 6;
        this.positions[p6] = this.positions[p6 + 3] = 0;
        this.positions[p6 + 1] = this.positions[p6 + 4] = 0;
        this.positions[p6 + 2] = this.positions[p6 + 5] = 0;
        this.colors[p6] = this.colors[p6 + 1] = this.colors[p6 + 2] = 0;
        this.colors[p6 + 3] = this.colors[p6 + 4] = this.colors[p6 + 5] = 0;
        this.active[a] = this.active[this.active.length - 1];
        this.active.pop();
        this.free.push(i);
        changed = true;
        continue;
      }

      const p3 = i * 3;
      const p6 = i * 6;

      // Velocity over lifetime
      this.velocities[p3] += this.velocityOverLifetime[p3] * dt;
      this.velocities[p3 + 1] += this.velocityOverLifetime[p3 + 1] * dt;
      this.velocities[p3 + 2] += this.velocityOverLifetime[p3 + 2] * dt;

      // Speed limiting
      const sl = this.speedLimit[i];
      if (sl > 0) {
        const vx = this.velocities[p3];
        const vy = this.velocities[p3 + 1];
        const vz = this.velocities[p3 + 2];
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed > sl) {
          const factor = 1 - this.speedDampen[i] * (1 - sl / speed);
          this.velocities[p3] *= factor;
          this.velocities[p3 + 1] *= factor;
          this.velocities[p3 + 2] *= factor;
        }
      }

      // Move head
      this.headPos[p3] += this.velocities[p3] * dt;
      this.headPos[p3 + 1] += this.velocities[p3 + 1] * dt;
      this.headPos[p3 + 2] += this.velocities[p3 + 2] * dt;
      this.velocities[p3 + 1] += this.rises[i] * dt;
      const drag = this.drags[i];
      this.velocities[p3] *= drag;
      this.velocities[p3 + 1] *= drag;
      this.velocities[p3 + 2] *= drag;

      // Head vertex = current position
      this.positions[p6] = this.headPos[p3];
      this.positions[p6 + 1] = this.headPos[p3 + 1];
      this.positions[p6 + 2] = this.headPos[p3 + 2];

      // Tail vertex = head - velocity * trailLength (stretched behind)
      const vx = this.velocities[p3];
      const vy = this.velocities[p3 + 1];
      const vz = this.velocities[p3 + 2];
      const tl = this.trailLength[i];
      this.positions[p6 + 3] = this.headPos[p3] - vx * tl;
      this.positions[p6 + 4] = this.headPos[p3 + 1] - vy * tl;
      this.positions[p6 + 5] = this.headPos[p3 + 2] - vz * tl;

      // Fade colors
      const alpha = this.startAlphas[i] * (1 - t);
      this.colors[p6] = this.startColors[p3] * alpha;
      this.colors[p6 + 1] = this.startColors[p3 + 1] * alpha;
      this.colors[p6 + 2] = this.startColors[p3 + 2] * alpha;
      this.colors[p6 + 3] = this.startColors[p3] * alpha * 0.2;
      this.colors[p6 + 4] = this.startColors[p3 + 1] * alpha * 0.2;
      this.colors[p6 + 5] = this.startColors[p3 + 2] * alpha * 0.2;

      changed = true;
    }

    if (changed) {
      this.lines.geometry.attributes.position.needsUpdate = true;
      this.lines.geometry.attributes.color.needsUpdate = true;
    }
  }
}

// ── ParticleSystem: owns the pools, effects use them ──

export class ParticleSystem {
  constructor(scene, perfProfile = null) {
    const p = perfProfile?.particles || {};
    const basePath = './vfx/';
    const fireMap = loadTexture(basePath + 'FlameRoundParticleSheet.png');
    const debrisFireMap = loadTexture(basePath + 'FlameParticleSheet.png');
    const smokeMap = loadTexture(basePath + 'SmokePuffParticleSheet.png');
    const emberMap = loadTexture(basePath + 'RoundSoftParticle.png');

    console.log('[VFX] Initializing ParticleSystem, profile:', perfProfile?.label || 'default');

    this.lineSparks = new LineSparkPool(scene, p.lineSparks || 600, {
      blending: THREE.AdditiveBlending,
    });

    this.sparks = new PointParticlePool(scene, p.sparks || 500, {
      map: emberMap,
      blending: THREE.AdditiveBlending,
      sizeScale: 42,
    });

    this.fire = new BillboardParticlePool(scene, p.fire || 300, {
      map: fireMap,
      tilesX: 10, tilesY: 5,
      blending: THREE.AdditiveBlending,
    });

    this.smoke = new BillboardParticlePool(scene, p.smoke || 200, {
      map: smokeMap,
      tilesX: 5, tilesY: 5,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
    });

    this.debrisFire = new BillboardParticlePool(scene, p.debrisFire || 200, {
      map: debrisFireMap,
      tilesX: 6, tilesY: 6,
      blending: THREE.AdditiveBlending,
    });
  }

  update(dt) {
    this.lineSparks.update(dt);
    this.sparks.update(dt);
    this.fire.update(dt);
    this.smoke.update(dt);
    this.debrisFire.update(dt);
  }

  enableFire(enabled) { this.fire.setEnabled(enabled); }
  enableSmoke(enabled) { this.smoke.setEnabled(enabled); }
  enableSparks(enabled) { this.sparks.setEnabled(enabled); }
}

export { PointParticlePool, BillboardParticlePool, LineSparkPool };
