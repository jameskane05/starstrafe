/**
 * EngineTrail.js - SHIP ENGINE TRAIL MESH
 * =============================================================================
 *
 * ROLE: Renders a ribbon trail behind a ship (player or remote). Points updated
 * from world position/rotation; gradient color and width configurable.
 *
 * KEY RESPONSIBILITIES:
 * - update(worldPos, worldQuat, backDir): push point, trim old; update mesh geometry
 * - _createMesh(): indexed ribbon geometry; dispose()
 * - Used by Player, RemotePlayer, Missile for exhaust trail
 *
 * RELATED: Player.js, RemotePlayer.js, Missile.js.
 *
 * =============================================================================
 */

import * as THREE from "three";

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fakePos = new THREE.Vector3();

export const ENGINE_TRAIL_FIXED_STEP = 1 / 60;
export const ENGINE_TRAIL_SAMPLE_SPACING = 0.12;
const ENGINE_TRAIL_MAX_SEGMENT_STEPS = 64;

const _trackSamplePos = new THREE.Vector3();

export function trackEngineTrailSegment(
  trail,
  from,
  to,
  now,
  sampleSpacing = ENGINE_TRAIL_SAMPLE_SPACING,
) {
  const dist = from.distanceTo(to);
  if (dist <= sampleSpacing) {
    trail.trackPosition(to, ENGINE_TRAIL_FIXED_STEP, now);
    return;
  }

  const rawSteps = Math.ceil(dist / sampleSpacing);
  if (rawSteps > ENGINE_TRAIL_MAX_SEGMENT_STEPS) {
    trail.clear();
    trail.trackPosition(to, ENGINE_TRAIL_FIXED_STEP, now);
    return;
  }

  const stepDelta = ENGINE_TRAIL_FIXED_STEP / rawSteps;
  for (let step = 1; step <= rawSteps; step++) {
    _trackSamplePos.lerpVectors(from, to, step / rawSteps);
    trail.trackPosition(_trackSamplePos, stepDelta, now);
  }
}

export class EngineTrail {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxPoints = options.maxPoints ?? 64;
    this.trailTime = options.trailTime ?? 2;
    this.width = options.width ?? 0.8;
    const hasGradient =
      options.colorStart != null && options.colorEnd != null;
    this.color = new THREE.Color(
      hasGradient ? 0xffffff : (options.color ?? 0xb8ddff)
    );
    this.colorStart = hasGradient
      ? new THREE.Color(options.colorStart)
      : null;
    this.colorEnd = hasGradient ? new THREE.Color(options.colorEnd) : null;
    this.emissiveIntensity = options.emissiveIntensity ?? 2.8;
    this.fakeTail = options.fakeTail ?? null;
    this.sampleInterval =
      options.sampleInterval ?? this.trailTime / Math.max(1, this.maxPoints);
    this._sampleAccumulator = 0;
    this._backDir = new THREE.Vector3(0, 0, 1);
    this._lerpColor = new THREE.Color();

    this.points = [];
    this.mesh = null;
    this._geometry = null;
    this._material = null;
    this._createMesh();
    scene.add(this.mesh);
  }

  _createMesh() {
    const maxVerts = (this.maxPoints + 1) * 2;
    const positions = new Float32Array(maxVerts * 3);
    const uvs = new Float32Array(maxVerts * 2);
    const colors = new Float32Array(maxVerts * 3);
    const indices = [];
    for (let i = 0; i < this.maxPoints; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uEmissive: { value: this.color },
        uIntensity: { value: this.emissiveIntensity },
      },
      vertexShader: `
        attribute vec3 color;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uEmissive;
        uniform float uIntensity;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float alpha = smoothstep(0.0, 0.15, vUv.x) * (1.0 - smoothstep(0.85, 1.0, vUv.x));
          gl_FragColor = vec4(uEmissive * vColor * uIntensity, alpha);
        }
      `,
    });

    this._geometry = geometry;
    this._material = material;
    this._positions = positions;
    this._uvs = uvs;
    this._colors = colors;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  setBackDirection(worldBackDir) {
    this._backDir.copy(worldBackDir).normalize();
  }

  setColor(hex) {
    this.color.set(hex);
  }

  setEmissiveIntensity(value) {
    this.emissiveIntensity = value;
    this._material.uniforms.uIntensity.value = value;
  }

  setWidth(value) {
    this.width = value;
  }

  addPoint(worldPos, now = performance.now() / 1000) {
    this.points.push({ position: worldPos.clone(), time: now });
    while (this.points.length > this.maxPoints) this.points.shift();
  }

  clear() {
    this.points.length = 0;
    this._sampleAccumulator = 0;
    this._geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  trackPosition(worldPos, delta, now = performance.now() / 1000) {
    if (delta > 0) {
      this._sampleAccumulator += delta;
      let guard = 0;
      const maxSamples = this.maxPoints + 4;
      while (this._sampleAccumulator >= this.sampleInterval) {
        if (++guard > maxSamples) {
          this._sampleAccumulator = 0;
          break;
        }
        this._sampleAccumulator -= this.sampleInterval;
        const pointTime = now - this._sampleAccumulator;
        this.addPoint(worldPos, pointTime);
      }
    }
    this.update(now);
  }

  update(now = performance.now() / 1000) {
    const cutoff = now - this.trailTime;
    while (this.points.length > 0 && this.points[0].time < cutoff) this.points.shift();
    const minPoints = this.fakeTail ? 1 : 2;
    if (this.points.length < minPoints) {
      this._geometry.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    let list = [];
    const ft = this.fakeTail;
    if (ft && ft.length > 0 && ft.segments > 0 && this.points.length >= 1) {
      const tailPos = this.points[0].position;
      const back = this._backDir;
      if (this.points.length >= 2) {
        _dir.subVectors(this.points[0].position, this.points[1].position).normalize();
        back.copy(_dir);
      }
      const step = ft.length / ft.segments;
      for (let i = 0; i < ft.segments; i++) {
        _fakePos.copy(tailPos).addScaledVector(back, -(i + 1) * step);
        list.push(_fakePos.clone());
      }
      list.push(tailPos);
      for (let i = 1; i < this.points.length; i++) list.push(this.points[i].position);
      const maxV = this.maxPoints + 1;
      if (list.length > maxV) list = list.slice(list.length - maxV);
    } else {
      for (let i = 0; i < this.points.length; i++) list.push(this.points[i].position);
    }

    const n = list.length;
    if (n < 2) {
      this._geometry.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }

    const positions = this._positions;
    const uvs = this._uvs;
    const colors = this._colors;
    const useGradient = this.colorStart !== null && this.colorEnd !== null;

    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (i === 0) _dir.subVectors(list[1], p).normalize();
      else if (i === n - 1) _dir.subVectors(p, list[i - 1]).normalize();
      else _dir.subVectors(list[i + 1], list[i - 1]).normalize();

      _right.crossVectors(_dir, _up).normalize();
      const t = i / (n - 1);
      const w = this.width * (0.2 + 0.8 * t);
      const half = w * 0.5;

      if (useGradient) {
        const tGrad = Math.pow(t, 0.65);
        this._lerpColor.lerpColors(this.colorStart, this.colorEnd, tGrad);
      }

      const r = useGradient ? this._lerpColor.r : this.color.r;
      const g = useGradient ? this._lerpColor.g : this.color.g;
      const b = useGradient ? this._lerpColor.b : this.color.b;

      const i2 = i * 2;
      const i2_3 = i2 * 3;
      const i2_2 = i2 * 2;

      positions[i2_3] = p.x - _right.x * half;
      positions[i2_3 + 1] = p.y - _right.y * half;
      positions[i2_3 + 2] = p.z - _right.z * half;

      positions[i2_3 + 3] = p.x + _right.x * half;
      positions[i2_3 + 4] = p.y + _right.y * half;
      positions[i2_3 + 5] = p.z + _right.z * half;

      uvs[i2_2] = t;
      uvs[i2_2 + 1] = 0;
      uvs[i2_2 + 2] = t;
      uvs[i2_2 + 3] = 1;

      colors[i2_3] = r;
      colors[i2_3 + 1] = g;
      colors[i2_3 + 2] = b;
      colors[i2_3 + 3] = r;
      colors[i2_3 + 4] = g;
      colors[i2_3 + 5] = b;
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.uv.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, (n - 1) * 6);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this._geometry.dispose();
    this._material.dispose();
  }
}
