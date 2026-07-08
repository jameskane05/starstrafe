import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { prefractureBarrierModel } from "../vfx/ShipDestruction.js";

const MODEL_URL = "./gltf/Barrier.glb";

let template = null;
let loadPromise = null;

function publicUrl(path) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
  const clean = path.replace(/^\//, "");
  return base ? `${base}/${clean}` : `/${clean}`;
}

export function preloadBarrierModel() {
  if (template) return Promise.resolve(template);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      publicUrl(MODEL_URL),
      (gltf) => {
        template = gltf.scene;
        prefractureBarrierModel(template);
        resolve(template);
      },
      undefined,
      (err) => {
        loadPromise = null;
        console.warn("[barrierModelCache] Failed to load Barrier.glb:", err);
        reject(err);
      },
    );
  });
  return loadPromise;
}

export function cloneBarrierModel() {
  if (!template) return null;
  const clone = template.clone(true);
  clone.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    if (Array.isArray(child.material)) {
      child.material = child.material.map((m) => (m?.clone ? m.clone() : m));
    } else if (child.material.clone) {
      child.material = child.material.clone();
    }
  });
  return clone;
}

export function disposeBarrierVisual(root) {
  if (!root) return;
  root.removeFromParent();
  root.traverse((child) => {
    child.removeFromParent();
    child.geometry?.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m?.dispose());
      else child.material.dispose();
    }
  });
}
