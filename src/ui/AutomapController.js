import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

const REVEAL_CELL_SIZE = 100;
const REBUILD_INTERVAL = 0.2;
const DISPLAY_SIZE = 0.5;
const REVEAL_RADIUS = 5;
const CLIP_HALF_H = DISPLAY_SIZE * 0.72; // ±0.36 — slightly expanded visible zone
const FADE_START = CLIP_HALF_H * 0.65; // start fading at 65%
const FADE_END = CLIP_HALF_H; // fully gone at boundary

const TRANSITION_DUR = 0.35;
const HOLO_DEPTH = -1.0;

// Hash for noise
const GLSL_HASH = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const VERT_FADE = /* glsl */ `
  uniform float uTransition;
  uniform float uTime;
  varying float vViewY;
  varying float vViewX;
  varying float vViewZ;
  varying vec3  vWorldPos;
  ${GLSL_HASH}
  void main() {
    vec3 pos = position;
    if (uTransition > 0.01) {
      float n = hash(pos.xz + uTime * 13.0);
      float jitter = uTransition * 0.12 * (n - 0.5);
      pos += vec3(jitter, jitter * 0.7, jitter * 0.5);
    }
    vec4 viewPos = modelViewMatrix * vec4(pos, 1.0);
    vViewY = viewPos.y;
    vViewX = viewPos.x;
    vViewZ = viewPos.z - (${HOLO_DEPTH.toFixed(1)});
    vWorldPos = pos;
    gl_Position = projectionMatrix * vec4(viewPos.xyz, 1.0);
  }
`;

const FRAG_LINES = /* glsl */ `
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uTransition;
  uniform float uTime;
  uniform vec3  uColor;
  varying float vViewY;
  varying float vViewX;
  varying float vViewZ;
  varying vec3  vWorldPos;
  ${GLSL_HASH}
  void main() {
    float fadeY = 1.0 - smoothstep(uFadeStart, uFadeEnd, abs(vViewY));
    float fadeX = 1.0 - smoothstep(uFadeStart, uFadeEnd, abs(vViewX));
    float fadeZ = 1.0 - smoothstep(uFadeStart, uFadeEnd, abs(vViewZ));
    float fade = fadeX * fadeY * fadeZ;
    if (fade <= 0.001) discard;
    float n = hash(vWorldPos.xy * 80.0 + uTime * 50.0);
    float scanline = 0.85 + 0.15 * sin(vWorldPos.y * 600.0 + uTime * 200.0);
    float flicker = mix(1.0, n * scanline, uTransition * 0.9);
    if (flicker < 0.08) discard;
    gl_FragColor = vec4(uColor * fade * flicker, fade * flicker);
  }
`;

const FRAG_SOLID = /* glsl */ `
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uTransition;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uOpacity;
  varying float vViewY;
  varying float vViewX;
  varying float vViewZ;
  varying vec3  vWorldPos;
  ${GLSL_HASH}
  void main() {
    float fadeY = 1.0 - smoothstep(uFadeStart, uFadeEnd, abs(vViewY));
    float fadeX = 1.0 - smoothstep(uFadeStart, uFadeEnd, abs(vViewX));
    float fadeZ = 1.0 - smoothstep(uFadeStart, uFadeEnd, abs(vViewZ));
    float fade = fadeX * fadeY * fadeZ;
    if (fade <= 0.001) discard;
    float n = hash(vWorldPos.xy * 60.0 + uTime * 40.0);
    float flicker = mix(1.0, n, uTransition * 0.85);
    if (flicker < 0.06) discard;
    gl_FragColor = vec4(uColor, uOpacity * fade * flicker);
  }
`;

const _playerFwd = new THREE.Vector3();
const _iconUp = new THREE.Vector3(0, 1, 0);
const _iconQuat = new THREE.Quaternion();
const _invOrbitQ = new THREE.Quaternion();
const _enemyFwd = new THREE.Vector3();
const _enemyQuat = new THREE.Quaternion();
const _yawQ = new THREE.Quaternion();
const _pitchQ = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);

export class AutomapController {
  constructor(camera) {
    this.camera = camera;
    this.isOpen = false;
    this._transition = 0; // 0 = closed, 1 = fully open
    this._transitioning = false;
    this._transitionDir = 1; // 1 = opening, -1 = closing

    this.orbitYaw = 0;
    this.orbitPitch = 0.0;
    this._restPitch = 0.0;
    this.zoom = 2.0;
    this._pendingOrbitX = 0;
    this._pendingOrbitY = 0;
    this._pendingZoom = 0;
    this._panX = 0;
    this._panY = 0;
    this._pendingPanX = 0;
    this._pendingPanY = 0;
    this.isDragging = false;
    this.isPanDragging = false;
    this.isOrbitDragging = false;
    this._touchState = {};

    this._revealedCells = new Set();
    this._edgePositionsWorld = null;
    this._edgePositionsNorm = null;
    this._edgeRevealed = null;
    this._edgeCount = 0;
    this._facePositionsNorm = null;
    this._faceCentroids = null; // world-space centroids, 3 floats per triangle
    this._faceRevealed = null;
    this._faceCount = 0;
    this._mapCenter = new THREE.Vector3();
    this._mapScale = 1;
    this._rebuildPending = false;
    this._rebuildTimer = 0;

    // ── Scene graph ───────────────────────────────────────────────────────────
    this._hologramGroup = new THREE.Group();
    this._hologramGroup.visible = false;

    // Orbit pivot
    this._orbitPivot = new THREE.Group();
    this._hologramGroup.add(this._orbitPivot);

    // Map group — receives the player-centering offset; holds both rendering layers
    this._mapGroup = new THREE.Group();
    this._orbitPivot.add(this._mapGroup);

    // ── Solid face layer (experimental, BackSide, Y-fade) ─────────────────────
    const emptyFaceGeo = new THREE.BufferGeometry();
    emptyFaceGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(0), 3),
    );
    this._solidMat = new THREE.ShaderMaterial({
      uniforms: {
        uFadeStart: { value: FADE_START },
        uFadeEnd: { value: FADE_END },
        uTransition: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x007799) },
        uOpacity: { value: 0.15 },
      },
      vertexShader: VERT_FADE,
      fragmentShader: FRAG_SOLID,
      transparent: true,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this._solidMesh = new THREE.Mesh(emptyFaceGeo, this._solidMat);
    this._solidMesh.renderOrder = 9019;
    this._mapGroup.add(this._solidMesh);

    // ── Wireframe line layer (thick, Y-fade + additive) ───────────────────────
    this._mapMat = new LineMaterial({
      color: 0x00cc33,
      linewidth: 2, // pixels
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });
    this._lineUniforms = {
      uFadeStart: { value: FADE_START },
      uFadeEnd: { value: FADE_END },
      uTransition: { value: 0 },
      uTime: { value: 0 },
    };
    const lineU = this._lineUniforms;
    this._mapMat.onBeforeCompile = (shader) => {
      shader.uniforms.uFadeStart = lineU.uFadeStart;
      shader.uniforms.uFadeEnd = lineU.uFadeEnd;
      shader.uniforms.uTransition = lineU.uTransition;
      shader.uniforms.uTime = lineU.uTime;

      const hashFn =
        "float _hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}";

      shader.vertexShader =
        "uniform float uTransition;\nuniform float uTime;\nvarying float vViewY;\nvarying float vViewX;\nvarying float vViewZ;\nvarying vec3 vWPos;\n" +
        hashFn +
        "\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        /vec4 start = modelViewMatrix \* vec4\( instanceStart, 1\.0 \);/,
        `vec3 _iS = instanceStart;
        vec3 _iE = instanceEnd;
        if(uTransition>0.01){
          float nS=_hash(_iS.xz+uTime*13.0); float nE=_hash(_iE.xz+uTime*17.0);
          float jS=uTransition*0.12*(nS-0.5); float jE=uTransition*0.12*(nE-0.5);
          _iS+=vec3(jS,jS*0.7,jS*0.5); _iE+=vec3(jE,jE*0.7,jE*0.5);
        }
        vec4 start = modelViewMatrix * vec4( _iS, 1.0 );`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        /vec4 end = modelViewMatrix \* vec4\( instanceEnd, 1\.0 \);/,
        `vec4 end = modelViewMatrix * vec4( _iE, 1.0 );
        vViewY = ( position.y < 0.5 ) ? start.y : end.y;
        vViewX = ( position.y < 0.5 ) ? start.x : end.x;
        vViewZ = (( position.y < 0.5 ) ? start.z : end.z) - (${HOLO_DEPTH.toFixed(1)});
        vWPos = ( position.y < 0.5 ) ? _iS : _iE;`,
      );

      shader.fragmentShader =
        "uniform float uFadeStart;\nuniform float uFadeEnd;\nuniform float uTransition;\nuniform float uTime;\nvarying float vViewY;\nvarying float vViewX;\nvarying float vViewZ;\nvarying vec3 vWPos;\n" +
        hashFn +
        "\n" +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        /gl_FragColor = vec4\( diffuseColor\.rgb, alpha \);/,
        `float _fY = 1.0 - smoothstep( uFadeStart, uFadeEnd, abs( vViewY ) );
        float _fX = 1.0 - smoothstep( uFadeStart, uFadeEnd, abs( vViewX ) );
        float _fZ = 1.0 - smoothstep( uFadeStart, uFadeEnd, abs( vViewZ ) );
        float _f = _fX * _fY * _fZ;
        if ( _f <= 0.001 ) discard;
        float _n = _hash(vWPos.xy*80.0+uTime*50.0);
        float _scan = 0.85+0.15*sin(vWPos.y*600.0+uTime*200.0);
        float _flk = mix(1.0, _n*_scan, uTransition*0.9);
        if(_flk<0.08) discard;
        alpha *= _f * _flk;
        gl_FragColor = vec4( diffuseColor.rgb * _f * _flk, alpha );`,
      );
    };
    const _initLineGeo = new LineSegmentsGeometry();
    _initLineGeo.instanceCount = 0;
    this._mapLines = new LineSegments2(_initLineGeo, this._mapMat);
    this._mapLines.renderOrder = 9022;
    this._mapGroup.add(this._mapLines);

    this._onResize = () =>
      this._mapMat.resolution.set(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", this._onResize);

    // ── Player icon (cone + cylinder) ─────────────────────────────────────────
    const iconMat = new THREE.ShaderMaterial({
      uniforms: {
        uFadeStart: { value: FADE_START },
        uFadeEnd: { value: FADE_END },
        uTransition: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff9900) },
      },
      vertexShader: VERT_FADE,
      fragmentShader: FRAG_LINES,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const coneH = 0.024,
      coneR = 0.009;
    const cylH = 0.018,
      cylR = 0.006;

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(coneR, coneH, 5),
      iconMat,
    );
    cone.position.y = cylH / 2 + coneH / 2;
    cone.renderOrder = 9026;

    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(cylR, cylR, cylH, 5),
      iconMat,
    );
    cyl.renderOrder = 9026;

    this._playerIcon = new THREE.Group();
    this._playerIcon.add(cone);
    this._playerIcon.add(cyl);
    this._playerIcon.renderOrder = 9026;
    this._orbitPivot.add(this._playerIcon);

    // ── Enemy cone pool ─────────────────────────────────────────────────────────
    this._enemyConeMat = new THREE.ShaderMaterial({
      uniforms: {
        uFadeStart: { value: FADE_START },
        uFadeEnd: { value: FADE_END },
        uTransition: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff2222) },
      },
      vertexShader: VERT_FADE,
      fragmentShader: FRAG_LINES,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this._enemyConeGeo = new THREE.ConeGeometry(0.008, 0.022, 5);
    this._enemyCones = [];
    this._enemyGroup = new THREE.Group();
    this._mapGroup.add(this._enemyGroup);

    this._transitionTime = 0;

    this._hologramGroup.position.set(0, 0, -1.0);
    camera.add(this._hologramGroup);

    this._onWheel = (e) => {
      if (!this.isOpen) return;
      e.preventDefault();
      this._pendingZoom += e.deltaY;
    };

    this._isUiTouch = (e) => {
      const el = e.target;
      if (!el) return false;
      return !!el.closest("button, .joystick, #esc-menu, #hud");
    };

    this._onTouchStart = (e) => {
      if (!this.isOpen || this._isUiTouch(e)) return;
      e.preventDefault();
      for (const t of e.changedTouches)
        this._touchState[t.identifier] = { x: t.clientX, y: t.clientY };
    };

    this._onTouchMove = (e) => {
      if (!this.isOpen) return;
      if (Object.keys(this._touchState).length === 0) return;
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const prev = this._touchState[t.identifier];
        if (prev) {
          this.addOrbitDelta(t.clientX - prev.x, t.clientY - prev.y);
          this._touchState[t.identifier] = { x: t.clientX, y: t.clientY };
        }
      } else if (e.touches.length >= 2) {
        const t0 = e.touches[0],
          t1 = e.touches[1];
        const p0 = this._touchState[t0.identifier];
        const p1 = this._touchState[t1.identifier];
        if (p0 && p1) {
          const cx = (t0.clientX + t1.clientX) * 0.5;
          const cy = (t0.clientY + t1.clientY) * 0.5;
          this.addPanDelta(cx - (p0.x + p1.x) * 0.5, cy - (p0.y + p1.y) * 0.5);
          const dist = Math.hypot(
            t0.clientX - t1.clientX,
            t0.clientY - t1.clientY,
          );
          const prevDist = Math.hypot(p0.x - p1.x, p0.y - p1.y);
          if (prevDist > 1) {
            this.zoom = THREE.MathUtils.clamp(
              this.zoom * (dist / prevDist),
              0.8,
              4.0,
            );
          }
        }
        for (const t of e.touches)
          this._touchState[t.identifier] = { x: t.clientX, y: t.clientY };
      }
    };

    this._onTouchEnd = (e) => {
      this._touchState = {};
      for (const t of e.touches)
        this._touchState[t.identifier] = { x: t.clientX, y: t.clientY };
    };

    window.addEventListener("wheel", this._onWheel, { passive: false });
    window.addEventListener("touchstart", this._onTouchStart, {
      passive: false,
    });
    window.addEventListener("touchmove", this._onTouchMove, { passive: false });
    window.addEventListener("touchend", this._onTouchEnd);
    window.addEventListener("touchcancel", this._onTouchEnd);
  }

  setLevel(geometryRoot) {
    if (!geometryRoot) return;
    this._revealedCells.clear();
    this._edgeCount = 0;
    this._faceCount = 0;
    this._rebuildPending = false;
    this._mapLines.geometry.dispose();
    const _resetLineGeo = new LineSegmentsGeometry();
    _resetLineGeo.instanceCount = 0;
    this._mapLines.geometry = _resetLineGeo;
    const emptyAttr = new THREE.BufferAttribute(new Float32Array(0), 3);
    this._solidMesh.geometry.setAttribute("position", emptyAttr);
    this._buildMapDataset(geometryRoot);
  }

  _buildMapDataset(geometryRoot) {
    geometryRoot.updateMatrixWorld(true);

    // ── Pass 1: edges (for wireframe + reveal) ────────────────────────────────
    const edgePos = [];
    geometryRoot.traverse((child) => {
      if (!child.isMesh) return;
      const name = child.name ?? "";
      if (name.startsWith("Trigger")) return;
      const geo = child.geometry;
      if (!geo?.attributes?.position) return;

      let edgesGeo;
      try {
        edgesGeo = new THREE.EdgesGeometry(geo, 15);
      } catch (_) {
        return;
      }

      const pos = edgesGeo.attributes.position;
      const mat = child.matrixWorld;
      const va = new THREE.Vector3(),
        vb = new THREE.Vector3();
      for (let i = 0; i + 1 < pos.count; i += 2) {
        va.fromBufferAttribute(pos, i).applyMatrix4(mat);
        vb.fromBufferAttribute(pos, i + 1).applyMatrix4(mat);
        edgePos.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
      }
      edgesGeo.dispose();
    });

    if (edgePos.length === 0) {
      console.warn("[Automap] No edge data extracted from LevelGeometry");
      return;
    }

    // Compute bounds from edge data
    const raw = new Float32Array(edgePos);
    this._edgeCount = raw.length / 6;

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < raw.length; i += 3) {
      if (raw[i] < minX) minX = raw[i];
      if (raw[i] > maxX) maxX = raw[i];
      if (raw[i + 1] < minY) minY = raw[i + 1];
      if (raw[i + 1] > maxY) maxY = raw[i + 1];
      if (raw[i + 2] < minZ) minZ = raw[i + 2];
      if (raw[i + 2] > maxZ) maxZ = raw[i + 2];
    }
    this._mapCenter.set(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    );
    const maxRange = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    this._mapScale = (DISPLAY_SIZE * 0.88) / (maxRange * 0.5);

    this._edgePositionsWorld = raw;

    const cx = this._mapCenter.x,
      cy = this._mapCenter.y,
      cz = this._mapCenter.z;
    const s = this._mapScale;
    const norm = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i += 3) {
      norm[i] = (raw[i] - cx) * s;
      norm[i + 1] = (raw[i + 1] - cy) * s;
      norm[i + 2] = (raw[i + 2] - cz) * s;
    }
    this._edgePositionsNorm = norm;
    this._edgeRevealed = new Uint8Array(this._edgeCount);

    // ── Pass 2: triangles (for solid face layer, reveal-gated) ───────────────
    const faceNorm = []; // normalized positions, 9 floats per triangle
    const faceCentroids = []; // world-space centroids,  3 floats per triangle
    const vt = new THREE.Vector3();

    const pushTri = (pos, mat, i0, i1, i2) => {
      vt.fromBufferAttribute(pos, i0).applyMatrix4(mat);
      const ax = vt.x,
        ay = vt.y,
        az = vt.z;
      vt.fromBufferAttribute(pos, i1).applyMatrix4(mat);
      const bx = vt.x,
        by = vt.y,
        bz = vt.z;
      vt.fromBufferAttribute(pos, i2).applyMatrix4(mat);
      const dx = vt.x,
        dy = vt.y,
        dz = vt.z;
      faceCentroids.push(
        (ax + bx + dx) / 3,
        (ay + by + dy) / 3,
        (az + bz + dz) / 3,
      );
      faceNorm.push(
        (ax - cx) * s,
        (ay - cy) * s,
        (az - cz) * s,
        (bx - cx) * s,
        (by - cy) * s,
        (bz - cz) * s,
        (dx - cx) * s,
        (dy - cy) * s,
        (dz - cz) * s,
      );
    };

    geometryRoot.traverse((child) => {
      if (!child.isMesh) return;
      const name = child.name ?? "";
      if (name.startsWith("Trigger")) return;
      const geo = child.geometry;
      if (!geo?.attributes?.position) return;
      const pos = geo.attributes.position;
      const mat = child.matrixWorld;
      if (geo.index) {
        const idx = geo.index;
        for (let i = 0; i + 2 < idx.count; i += 3)
          pushTri(pos, mat, idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      } else {
        for (let i = 0; i + 2 < pos.count; i += 3)
          pushTri(pos, mat, i, i + 1, i + 2);
      }
    });

    this._faceCount = faceNorm.length / 9;
    this._facePositionsNorm = new Float32Array(faceNorm);
    this._faceCentroids = new Float32Array(faceCentroids);
    this._faceRevealed = new Uint8Array(this._faceCount);

    console.log(
      `[Automap] ${this._edgeCount} edges, ${this._faceCount} triangles built`,
    );
  }

  open() {
    if (this.isOpen && !this._transitioning) return;
    this.isOpen = true;
    this._transitioning = true;
    this._transitionDir = 1;
    this._hologramGroup.visible = true;
  }

  close() {
    if (!this.isOpen && !this._transitioning) return;
    this._endAllDrags();
    this._transitioning = true;
    this._transitionDir = -1;
  }

  toggle() {
    if (this.isOpen || (this._transitioning && this._transitionDir === -1))
      this.close();
    else this.open();
  }

  _endAllDrags() {
    this.isDragging = this.isPanDragging = this.isOrbitDragging = false;
  }

  startPanDrag() {
    this.isDragging = this.isPanDragging = true;
  }
  startOrbitDrag() {
    this.isDragging = this.isOrbitDragging = true;
  }
  endDrag() {
    this._endAllDrags();
  }

  addPanDelta(dx, dy) {
    this._pendingPanX += dx;
    this._pendingPanY += dy;
  }

  addOrbitDelta(dx, dy) {
    this._pendingOrbitX += dx;
    this._pendingOrbitY += dy;
  }

  update(delta, playerWorldPos, enemies) {
    this._updateReveal(playerWorldPos);

    // Rebuild geometry whether or not the map is open, so it's ready instantly
    if (this._rebuildPending) {
      this._rebuildTimer -= delta;
      if (this._rebuildTimer <= 0) {
        this._rebuildGeometry();
        this._rebuildPending = false;
        this._rebuildTimer = REBUILD_INTERVAL;
      }
    }

    // ── Transition tick ──────────────────────────────────────────────────────
    this._transitionTime += delta;
    if (this._transitioning) {
      this._transition += this._transitionDir * (delta / TRANSITION_DUR);
      this._transition = THREE.MathUtils.clamp(this._transition, 0, 1);

      const t = this._transition;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const intensity = 1.0 - ease;

      // Drive all shader uniforms
      const time = this._transitionTime;
      this._solidMat.uniforms.uTransition.value = intensity;
      this._solidMat.uniforms.uTime.value = time;
      this._lineUniforms.uTransition.value = intensity;
      this._lineUniforms.uTime.value = time;
      const iconU = this._playerIcon.children[0]?.material?.uniforms;
      if (iconU) {
        iconU.uTransition.value = intensity;
        iconU.uTime.value = time;
      }
      this._enemyConeMat.uniforms.uTransition.value = intensity;
      this._enemyConeMat.uniforms.uTime.value = time;

      this._orbitPivot.visible = ease > 0.02;
      const distortion = intensity * 0.15;
      this._hologramGroup.scale.set(1 + distortion * 0.4, 1 - distortion, 1);

      if (t >= 1 && this._transitionDir === 1) {
        this._transitioning = false;
        this._hologramGroup.scale.set(1, 1, 1);
        this._solidMat.uniforms.uTransition.value = 0;
        this._lineUniforms.uTransition.value = 0;
        if (iconU) iconU.uTransition.value = 0;
        this._enemyConeMat.uniforms.uTransition.value = 0;
      } else if (t <= 0 && this._transitionDir === -1) {
        this._transitioning = false;
        this.isOpen = false;
        this._hologramGroup.visible = false;
        this._hologramGroup.scale.set(1, 1, 1);
      }
    }

    if (!this.isOpen) {
      this._pendingOrbitX = 0;
      this._pendingOrbitY = 0;
      this._pendingZoom = 0;
      return;
    }

    const ox = this._pendingOrbitX,
      oy = this._pendingOrbitY;
    this.orbitYaw -= ox * 0.005;
    if (this.isOrbitDragging) {
      this.orbitPitch -= oy * 0.002;
      this.orbitPitch = THREE.MathUtils.clamp(
        this.orbitPitch,
        -Math.PI / 4,
        Math.PI / 4,
      );
    } else {
      const decay = 1 - Math.exp(-8 * delta);
      this.orbitPitch += (this._restPitch - this.orbitPitch) * decay;
    }
    this._pendingOrbitX = 0;
    this._pendingOrbitY = 0;

    this.zoom = THREE.MathUtils.clamp(
      this.zoom - this._pendingZoom * 0.0008,
      0.8,
      4.0,
    );
    this._pendingZoom = 0;

    const PAN_LIMIT = DISPLAY_SIZE * 1.5;
    this._panX = THREE.MathUtils.clamp(
      this._panX + this._pendingPanX * 0.0015,
      -PAN_LIMIT,
      PAN_LIMIT,
    );
    this._panY = THREE.MathUtils.clamp(
      this._panY - this._pendingPanY * 0.0015,
      -PAN_LIMIT,
      PAN_LIMIT,
    );
    this._pendingPanX = 0;
    this._pendingPanY = 0;
    this._hologramGroup.position.set(this._panX, this._panY, -1.0);

    _yawQ.setFromAxisAngle(_axisY, this.orbitYaw);
    _pitchQ.setFromAxisAngle(_axisX, this.orbitPitch);
    this._orbitPivot.quaternion.multiplyQuaternions(_yawQ, _pitchQ);
    this._orbitPivot.scale.setScalar(this.zoom);

    if (playerWorldPos) {
      if (this._edgeCount > 0) {
        const pnx = (playerWorldPos.x - this._mapCenter.x) * this._mapScale;
        const pny = (playerWorldPos.y - this._mapCenter.y) * this._mapScale;
        const pnz = (playerWorldPos.z - this._mapCenter.z) * this._mapScale;
        // Both solid mesh and wireframe live in _mapGroup, so one offset moves both
        this._mapGroup.position.set(-pnx, -pny, -pnz);
      }

      _playerFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      _iconQuat.setFromUnitVectors(_iconUp, _playerFwd);
      this._playerIcon.quaternion.copy(_iconQuat);
    }

    this._updateEnemyCones(enemies, playerWorldPos);
  }

  _updateEnemyCones(enemies, playerWorldPos) {
    if (!enemies || !playerWorldPos || this._edgeCount === 0) {
      for (const c of this._enemyCones) c.visible = false;
      return;
    }
    const cx = this._mapCenter.x,
      cy = this._mapCenter.y,
      cz = this._mapCenter.z;
    const s = this._mapScale;
    const CULL_DIST_SQ = 200 * 200;

    let idx = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.health <= 0) continue;
      const ep = e.mesh.position;
      const dx = ep.x - playerWorldPos.x;
      const dy = ep.y - playerWorldPos.y;
      const dz = ep.z - playerWorldPos.z;
      if (dx * dx + dy * dy + dz * dz > CULL_DIST_SQ) continue;

      let cone;
      if (idx < this._enemyCones.length) {
        cone = this._enemyCones[idx];
      } else {
        cone = new THREE.Mesh(this._enemyConeGeo, this._enemyConeMat);
        cone.renderOrder = 9025;
        this._enemyGroup.add(cone);
        this._enemyCones.push(cone);
      }
      cone.position.set((ep.x - cx) * s, (ep.y - cy) * s, (ep.z - cz) * s);
      _enemyFwd.set(0, 0, -1).applyQuaternion(e.mesh.quaternion);
      _enemyQuat.setFromUnitVectors(_iconUp, _enemyFwd);
      cone.quaternion.copy(_enemyQuat);
      cone.visible = true;
      idx++;
    }
    for (let i = idx; i < this._enemyCones.length; i++)
      this._enemyCones[i].visible = false;
  }

  _updateReveal(playerWorldPos) {
    if (!playerWorldPos || this._edgeCount === 0) return;
    const px = Math.floor(playerWorldPos.x / REVEAL_CELL_SIZE);
    const py = Math.floor(playerWorldPos.y / REVEAL_CELL_SIZE);
    const pz = Math.floor(playerWorldPos.z / REVEAL_CELL_SIZE);
    let newCells = false;
    for (let dx = -REVEAL_RADIUS; dx <= REVEAL_RADIUS; dx++) {
      for (let dy = -REVEAL_RADIUS; dy <= REVEAL_RADIUS; dy++) {
        for (let dz = -REVEAL_RADIUS; dz <= REVEAL_RADIUS; dz++) {
          const key = `${px + dx},${py + dy},${pz + dz}`;
          if (!this._revealedCells.has(key)) {
            this._revealedCells.add(key);
            newCells = true;
          }
        }
      }
    }
    if (newCells) {
      this._markRevealedEdges();
      this._markRevealedFaces();
      this._rebuildPending = true;
    }
  }

  _markRevealedEdges() {
    if (!this._edgePositionsWorld || !this._edgeRevealed) return;
    const raw = this._edgePositionsWorld;
    const rev = this._edgeRevealed;
    for (let i = 0; i < this._edgeCount; i++) {
      if (rev[i]) continue;
      const bi = i * 6;
      const mx = (raw[bi] + raw[bi + 3]) / 2;
      const my = (raw[bi + 1] + raw[bi + 4]) / 2;
      const mz = (raw[bi + 2] + raw[bi + 5]) / 2;
      const ck = `${Math.floor(mx / REVEAL_CELL_SIZE)},${Math.floor(my / REVEAL_CELL_SIZE)},${Math.floor(mz / REVEAL_CELL_SIZE)}`;
      if (this._revealedCells.has(ck)) rev[i] = 1;
    }
  }

  _markRevealedFaces() {
    if (!this._faceCentroids || !this._faceRevealed) return;
    const c = this._faceCentroids;
    const r = this._faceRevealed;
    for (let i = 0; i < this._faceCount; i++) {
      if (r[i]) continue;
      const bi = i * 3;
      const ck =
        `${Math.floor(c[bi] / REVEAL_CELL_SIZE)},` +
        `${Math.floor(c[bi + 1] / REVEAL_CELL_SIZE)},` +
        `${Math.floor(c[bi + 2] / REVEAL_CELL_SIZE)}`;
      if (this._revealedCells.has(ck)) r[i] = 1;
    }
  }

  _rebuildGeometry() {
    // ── wireframe ──────────────────────────────────────────────────────────────
    const norm = this._edgePositionsNorm,
      rev = this._edgeRevealed;
    if (norm && rev) {
      let count = 0;
      for (let i = 0; i < this._edgeCount; i++) if (rev[i]) count++;
      const out = new Float32Array(count * 6);
      let j = 0;
      for (let i = 0; i < this._edgeCount; i++) {
        if (!rev[i]) continue;
        const bi = i * 6;
        out[j++] = norm[bi];
        out[j++] = norm[bi + 1];
        out[j++] = norm[bi + 2];
        out[j++] = norm[bi + 3];
        out[j++] = norm[bi + 4];
        out[j++] = norm[bi + 5];
      }
      this._mapLines.geometry.dispose();
      const newLineGeo = new LineSegmentsGeometry();
      if (count > 0) newLineGeo.setPositions(out);
      else newLineGeo.instanceCount = 0;
      this._mapLines.geometry = newLineGeo;
    }

    // ── solid faces ────────────────────────────────────────────────────────────
    const fnorm = this._facePositionsNorm,
      frev = this._faceRevealed;
    if (fnorm && frev) {
      let fcount = 0;
      for (let i = 0; i < this._faceCount; i++) if (frev[i]) fcount++;
      const fout = new Float32Array(fcount * 9);
      let fj = 0;
      for (let i = 0; i < this._faceCount; i++) {
        if (!frev[i]) continue;
        const bi = i * 9;
        for (let k = 0; k < 9; k++) fout[fj++] = fnorm[bi + k];
      }
      const faceGeo = this._solidMesh.geometry;
      faceGeo.setAttribute("position", new THREE.BufferAttribute(fout, 3));
      faceGeo.computeBoundingSphere();
    }
  }

  dispose() {
    window.removeEventListener("wheel", this._onWheel);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("touchstart", this._onTouchStart);
    window.removeEventListener("touchmove", this._onTouchMove);
    window.removeEventListener("touchend", this._onTouchEnd);
    window.removeEventListener("touchcancel", this._onTouchEnd);
    this._mapLines.geometry.dispose();
    this._mapMat.dispose();
    this._solidMesh.geometry.dispose();
    this._solidMat.dispose();
    this._playerIcon.traverse((c) => {
      if (c.isMesh) {
        c.geometry.dispose();
        c.material.dispose();
      }
    });
    this._enemyConeGeo.dispose();
    this._enemyConeMat.dispose();
    this.camera.remove(this._hologramGroup);
  }
}
