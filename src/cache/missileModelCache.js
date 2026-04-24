/**
 * missileModelCache.js - SHARED CACHE FOR missile.glb
 *
 * Loads ./missile.glb once, normalizes orientation so its longest axis points
 * along local +Z (forward) and centers it at the origin, then exposes a
 * cloneMissileModel(targetLength) helper for projectiles and pickups.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = "./missile.glb";

/**
 * Set to true if the loaded GLB happens to point its nose along -Z (i.e. the
 * far end of the longest axis is the tail). Flip if the model fires
 * "backwards" in game.
 */
const FLIP_FORWARD = false;

let template = null;
let templateLength = 0;
let loadPromise = null;

function normalizeTemplate(scene) {
  const root = new THREE.Group();
  root.add(scene);

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  scene.position.sub(center);

  const longest = Math.max(size.x, size.y, size.z);
  if (longest === size.x) {
    root.rotation.y = -Math.PI / 2;
  } else if (longest === size.y) {
    root.rotation.x = Math.PI / 2;
  }
  root.updateMatrixWorld(true);

  if (FLIP_FORWARD) {
    const flip = new THREE.Group();
    flip.add(root);
    flip.rotation.y = Math.PI;
    flip.updateMatrixWorld(true);
    return { node: flip, length: longest };
  }

  return { node: root, length: longest };
}

export function preloadMissileModel() {
  if (template || loadPromise) return loadPromise ?? Promise.resolve(template);

  loadPromise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        const { node, length } = normalizeTemplate(gltf.scene);
        template = node;
        templateLength = length || 1;
        resolve(template);
      },
      undefined,
      (err) => {
        console.error("[missileModelCache] Failed to load", MODEL_URL, err);
        reject(err);
      },
    );
  });

  return loadPromise;
}

export function isMissileModelReady() {
  return template !== null;
}

export function cloneMissileModel(targetLength = 1) {
  if (!template) return null;
  const clone = template.clone(true);
  clone.traverse((child) => {
    if (child.isMesh) {
      if (child.material) child.material = child.material.clone();
    }
  });
  const scale = templateLength > 0 ? targetLength / templateLength : 1;
  clone.scale.setScalar(scale);
  return clone;
}

export async function loadAndCloneMissileModel(targetLength = 1) {
  await preloadMissileModel();
  return cloneMissileModel(targetLength);
}
