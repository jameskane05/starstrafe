/**
 * SceneManager.js - SCENE OBJECT LOADING AND MANAGEMENT
 * =============================================================================
 *
 * Loads and manages 3D scene content including Gaussian splats (via SparkRenderer)
 * and GLTF models (via Three.js GLTFLoader).
 *
 * =============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SplatMesh } from "@sparkjsdev/spark";

class SceneManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.renderer = options.renderer || null;
    this.sparkRenderer = options.sparkRenderer || null;
    this.physicsManager = options.physicsManager || null;

    this.objects = new Map(); // id -> THREE.Object3D
    this.objectData = new Map(); // id -> config data
    this.gltfLoader = new GLTFLoader();
    this.loadingPromises = new Map();
  }

  /**
   * Load a scene object based on its config
   * @param {Object} objectData - Object configuration from sceneData.js
   * @returns {Promise<THREE.Object3D>}
   */
  async loadObject(objectData) {
    const { id, type } = objectData;

    // Already loading?
    if (this.loadingPromises.has(id)) {
      return this.loadingPromises.get(id);
    }

    // Already loaded?
    if (this.objects.has(id)) {
      console.warn(`[SceneManager] Object "${id}" already loaded`);
      return this.objects.get(id);
    }

    let loadPromise;

    switch (type) {
      case "splat":
        loadPromise = this._loadSplat(objectData);
        break;
      case "gltf":
        loadPromise = this._loadGLTF(objectData);
        break;
      default:
        console.error(`[SceneManager] Unknown object type: ${type}`);
        return null;
    }

    this.loadingPromises.set(id, loadPromise);

    try {
      const object = await loadPromise;
      this.objects.set(id, object);
      this.objectData.set(id, objectData);
      this.loadingPromises.delete(id);
      console.log(`[SceneManager] Loaded: ${id} (${type})`);
      return object;
    } catch (error) {
      this.loadingPromises.delete(id);
      console.error(`[SceneManager] Error loading "${id}":`, error);
      throw error;
    }
  }

  /**
   * Load a gaussian splat
   */
  async _loadSplat(objectData) {
    const { id, path, position, rotation, scale, quaternion } = objectData;

    const splatMesh = new SplatMesh({
      url: path,
      editable: false,
      onProgress: (progress) => {
        // console.log(`[SceneManager] ${id} loading: ${(progress * 100).toFixed(0)}%`);
      },
    });

    // Apply transform
    if (quaternion) {
      splatMesh.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    } else if (rotation) {
      splatMesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    }

    if (position) {
      splatMesh.position.set(position.x || 0, position.y || 0, position.z || 0);
    }

    if (scale !== undefined) {
      if (typeof scale === "number") {
        splatMesh.scale.setScalar(scale);
      } else if (typeof scale === "object") {
        splatMesh.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
      }
    }

    this.scene.add(splatMesh);
    await splatMesh.initialized;

    return splatMesh;
  }

  /**
   * Load a GLTF model
   */
  _loadGLTF(objectData) {
    return new Promise((resolve, reject) => {
      const { id, path, position, rotation, scale, options } = objectData;

      this.gltfLoader.load(
        path,
        (gltf) => {
          const model = gltf.scene;

          // Apply transform
          if (position) {
            model.position.set(position.x || 0, position.y || 0, position.z || 0);
          }

          if (rotation) {
            model.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
          }

          if (scale !== undefined) {
            if (typeof scale === "number") {
              model.scale.setScalar(scale);
            } else if (typeof scale === "object") {
              model.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
            }
          }

          // Handle options
          if (options) {
            if (options.visible === false) {
              model.visible = false;
            }

            // Physics collider support (would need physicsManager)
            if (options.physicsCollider && this.physicsManager) {
              this._createPhysicsCollider(id, model, position, rotation);
            }
          }

          this.scene.add(model);
          resolve(model);
        },
        undefined,
        (error) => {
          reject(error);
        }
      );
    });
  }

  /**
   * Create physics collider from GLTF mesh
   */
  _createPhysicsCollider(id, model, position, rotation) {
    // This would integrate with Physics.js to create trimesh colliders
    // For now, just log that we would create one
    console.log(`[SceneManager] Would create physics collider for "${id}"`);
  }

  /**
   * Remove an object from the scene
   */
  removeObject(id) {
    const object = this.objects.get(id);
    if (object) {
      // Dispose SplatMesh
      if (object.dispose) {
        object.dispose();
      }

      // Remove from scene
      this.scene.remove(object);

      // Dispose geometries and materials
      object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });

      this.objects.delete(id);
      this.objectData.delete(id);
      console.log(`[SceneManager] Removed: ${id}`);
    }
  }

  /**
   * Get a loaded object by ID
   */
  getObject(id) {
    return this.objects.get(id) || null;
  }

  /**
   * Check if an object is loaded
   */
  hasObject(id) {
    return this.objects.has(id);
  }

  /**
   * Get all loaded object IDs
   */
  getObjectIds() {
    return Array.from(this.objects.keys());
  }

  /**
   * Clean up all objects
   */
  destroy() {
    for (const id of this.objects.keys()) {
      this.removeObject(id);
    }
  }
}

export default SceneManager;

