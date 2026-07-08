import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = "./gltf/gatling-gun.glb";

let template = null;
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

  const longest = Math.max(size.x, size.y, size.z) || 1;
  if (longest === size.y) {
    root.rotation.z = -Math.PI / 2;
  } else if (longest === size.z) {
    root.rotation.y = Math.PI / 2;
  }
  root.updateMatrixWorld(true);
  root.userData.templateLength = longest;
  return root;
}

export function preloadGatlingGunModel() {
  if (template || loadPromise) return loadPromise ?? Promise.resolve(template);
  loadPromise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        template = normalizeTemplate(gltf.scene);
        resolve(template);
      },
      undefined,
      (err) => {
        console.error("[gatlingGunModelCache] Failed to load", MODEL_URL, err);
        reject(err);
      },
    );
  });
  return loadPromise;
}

export function cloneGatlingGunModel(targetLength = 3.4) {
  if (!template) return null;
  const clone = template.clone(true);
  clone.traverse((child) => {
    if (child.isMesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material = child.material.map((m) => (m?.clone ? m.clone() : m));
      } else if (child.material.clone) {
        child.material = child.material.clone();
      }
    }
  });
  const scale = targetLength / (template.userData.templateLength || 1);
  clone.scale.setScalar(scale);
  return clone;
}
