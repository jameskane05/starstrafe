import * as THREE from "three";
import { perlinNoise } from "./shaders/perlinNoise.glsl.js";

/**
 * Noise dissolve materialize (shadow-style): Perlin on local position, discard below
 * threshold, edge glow on outgoingLight. Injects before #include <opaque_fragment>
 * (Three r152+ — output_fragment no longer exists on MeshPhysical).
 */
function patchWarpMaterial(material, warpUniforms) {
  const cloned = material.clone();
  const originalDepthWrite = cloned.depthWrite;
  cloned.transparent = true;
  cloned.depthWrite = false;

  if (cloned.isMeshStandardMaterial || cloned.isMeshPhysicalMaterial) {
    cloned.onBeforeCompile = (parameters) => {
      for (const key of Object.keys(warpUniforms)) {
        parameters.uniforms[key] = warpUniforms[key];
      }

      const { vertexShader, fragmentShader } = parameters;

      parameters.vertexShader = vertexShader.replace(
        "#include <common>",
        `#include <common>
varying vec3 vSpawnDissolveLocal;
`,
      );
      parameters.vertexShader = parameters.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vSpawnDissolveLocal = position;
`,
      );

      parameters.fragmentShader = fragmentShader.replace(
        "#include <common>",
        `#include <common>
${perlinNoise}
varying vec3 vSpawnDissolveLocal;
`,
      );

      parameters.fragmentShader = parameters.fragmentShader.replace(
        "#include <opaque_fragment>",
        `
if (uDissolveActive > 0.5) {
  float spawnD = cnoise(vSpawnDissolveLocal * uDissolveFreq) * uDissolveAmp;
  if (spawnD < uDissolveThreshold) discard;
  float spawnHi = uDissolveThreshold + uDissolveEdge;
  if (spawnD < spawnHi) {
    float spawnEdgeAmt = smoothstep(uDissolveThreshold, spawnHi, spawnD);
    outgoingLight += uDissolveEdgeColor * spawnEdgeAmt * uDissolveEdgeGlow;
  }
}
#include <opaque_fragment>
`,
      );
    };
    cloned.customProgramCacheKey = () =>
      `${material.customProgramCacheKey?.() ?? ""}|spawn-warp-v5-active`;
  }

  cloned.needsUpdate = true;
  cloned.userData._spawnWarpOriginalDepthWrite = originalDepthWrite;
  return cloned;
}

export function beginSpawnWarp(root, options = {}) {
  const duration = options.duration ?? 2.35;
  const materialEffect = options.materialEffect !== false;
  const baseScale = root.scale.clone();
  /** Snapshot mesh.material before patching; dispose() restores so re-warp is not stacked. */
  const originals = [];
  const warpColor = new THREE.Color(options.color ?? 0x8affff);
  const warpUniforms = {
    uDissolveActive: { value: 1 },
    uDissolveThreshold: { value: 18 },
    uDissolveFreq: { value: options.dissolveFreq ?? 0.5 },
    uDissolveAmp: { value: options.dissolveAmp ?? 16 },
    uDissolveEdge: { value: options.dissolveEdge ?? 0.85 },
    uDissolveEdgeGlow: { value: options.edgeGlow ?? 3.2 },
    uDissolveEdgeColor: {
      value: new THREE.Vector3(warpColor.r, warpColor.g, warpColor.b),
    },
  };
  const materials = [];

  root.traverse((child) => {
    if (!materialEffect) return;
    if (!child.isMesh || !child.material) return;
    originals.push({ mesh: child, material: child.material });
    const sourceMaterials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    const warpedMaterials = sourceMaterials.map((material) => {
      const warped = patchWarpMaterial(material, warpUniforms);
      materials.push(warped);
      return warped;
    });
    child.material = Array.isArray(child.material)
      ? warpedMaterials
      : warpedMaterials[0];
  });

  const light = new THREE.PointLight(warpColor, 0, 18, 2);
  light.position.set(0, 0, 0);
  root.add(light);

  let elapsed = 0;
  let finished = false;
  let frozen = false;
  let disposed = false;

  const THRESHOLD_START = 18;
  /** Below ~-(2.2 * uDissolveAmp) no fragments should discard; cnoise is ~[-2.2, 2.2]. */
  const THRESHOLD_END = -40;
  const THRESHOLD_DONE = -60;

  function sealFinishedVisuals() {
    root.scale.copy(baseScale);
    if (light.parent) root.remove(light);
    warpUniforms.uDissolveActive.value = 0;
    warpUniforms.uDissolveThreshold.value = THRESHOLD_DONE;
    for (const material of materials) {
      material.depthWrite =
        material.userData._spawnWarpOriginalDepthWrite ?? true;
      material.opacity = 1;
    }
  }

  function applyElapsedVisuals() {
    const t = Math.min(1, elapsed / duration);
    const eased = 1 - (1 - t) * (1 - t);
    warpUniforms.uDissolveThreshold.value = THREE.MathUtils.lerp(
      THRESHOLD_START,
      THRESHOLD_END,
      t,
    );
    warpUniforms.uDissolveEdgeGlow.value = 5.0 - eased * 2.2;
    const pulse = Math.sin(t * Math.PI);
    light.intensity = (1 - t) * 6.5 + pulse * 2.0;
    light.distance = 8 + pulse * 12;
    const scale = 0.94 + eased * 0.06;
    root.scale.copy(baseScale).multiplyScalar(scale);
    for (const material of materials) {
      material.opacity = 0.2 + t * 0.8;
    }
  }

  const api = {
    materials,
    warpUniforms,
    get finished() {
      return finished;
    },
    get frozen() {
      return frozen;
    },
    get disposed() {
      return disposed;
    },
    get active() {
      return !disposed && !finished;
    },
    update(delta = 0.016) {
      if (disposed || finished) return false;
      if (frozen) return true;
      const dt = Math.min(0.1, Math.max(0, Number(delta) || 0));
      elapsed += dt;
      const t = Math.min(1, elapsed / duration);
      applyElapsedVisuals();
      if (t >= 1) {
        sealFinishedVisuals();
        finished = true;
        return false;
      }
      return true;
    },
    restart(opts = {}) {
      if (disposed) return;
      const hold = opts.hold === true;
      finished = false;
      frozen = hold;
      elapsed = 0;
      if (!light.parent) root.add(light);
      warpUniforms.uDissolveActive.value = 1;
      warpUniforms.uDissolveThreshold.value = THRESHOLD_START;
      warpUniforms.uDissolveEdgeGlow.value = 5.0;
      if (opts.color != null) {
        const c = new THREE.Color(opts.color);
        warpUniforms.uDissolveEdgeColor.value.set(c.r, c.g, c.b);
      }
      root.scale.copy(baseScale).multiplyScalar(0.94);
      for (const material of materials) {
        material.transparent = true;
        material.depthWrite = false;
        material.opacity = 0.2;
        material.needsUpdate = true;
      }
      light.intensity = 6.5;
      light.distance = 8;
      elapsed = 0;
      applyElapsedVisuals();
    },
    unfreeze() {
      if (disposed || finished) return;
      frozen = false;
    },
    freeze() {
      if (disposed || finished) return;
      frozen = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.scale.copy(baseScale);
      if (light.parent) root.remove(light);
      finished = true;
      frozen = false;
      for (const { mesh, material } of originals) {
        if (mesh && material != null) mesh.material = material;
      }
      originals.length = 0;
      for (const m of materials) m?.dispose?.();
      materials.length = 0;
    },
  };

  api.update(0);
  return api;
}

export function prewarmSpawnWarp(renderer, camera, root, options = {}) {
  if (!renderer || !camera || !root) return;

  const tempScene = new THREE.Scene();
  const tempCamera = camera.clone();
  tempCamera.position.set(0, 0, 0);
  tempCamera.rotation.set(0, 0, 0);
  tempCamera.updateMatrixWorld(true);

  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(2, 3, 4);
  tempScene.add(ambient, key);

  root.position.set(0, 0, -8);
  root.updateMatrixWorld(true);
  tempScene.add(root);

  const warp = beginSpawnWarp(root, options);
  warp.update(0.35);
  tempScene.updateMatrixWorld(true);
  renderer.compile(tempScene, tempCamera);

  warp.dispose();
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of mats) {
      if (material?.userData?.enemySharedTemplateMaterial) continue;
      material?.dispose?.();
    }
    if (options.disposeGeometry) {
      child.geometry?.dispose?.();
    }
  });
}
