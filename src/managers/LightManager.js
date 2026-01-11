/**
 * LightManager.js - SCENE LIGHTING
 * =============================================================================
 *
 * Manages Three.js lights. SplatEdit lights removed for performance.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { lights } from "../data/lightData.js";
import { checkCriteria } from "../data/sceneData.js";

class LightManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.sceneManager = options.sceneManager || null;
    this.gameManager = options.gameManager || null;

    this.lights = new Map();

    const gameState = this.gameManager?.getState();
    this.loadLightsFromData(lights, gameState);
  }

  loadLightsFromData(lightsData, gameState = null) {
    for (const [key, config] of Object.entries(lightsData)) {
      if (gameState && config.criteria) {
        if (!checkCriteria(gameState, config.criteria)) {
          continue;
        }
      }

      try {
        this.createLight(config);
      } catch (error) {
        console.error(`Error creating light "${key}":`, error);
      }
    }

    console.log(`[LightManager] Created ${this.lights.size} lights`);
  }

  createLight(config) {
    switch (config.type) {
      case "AmbientLight":
        return this.createAmbientLight(config);
      case "DirectionalLight":
        return this.createDirectionalLight(config);
      case "PointLight":
        return this.createPointLight(config);
      case "SpotLight":
        return this.createSpotLight(config);
      default:
        console.warn(`Unknown light type "${config.type}"`);
        return null;
    }
  }

  createAmbientLight(config = {}) {
    const light = new THREE.AmbientLight(
      config.color ?? 0xffffff,
      config.intensity ?? 1.0
    );

    if (config.id) {
      this.lights.set(config.id, light);
    }

    this.scene.add(light);
    return light;
  }

  createDirectionalLight(config = {}) {
    const light = new THREE.DirectionalLight(
      config.color ?? 0xffffff,
      config.intensity ?? 1.0
    );

    if (config.position) {
      light.position.set(
        config.position.x ?? 0,
        config.position.y ?? 0,
        config.position.z ?? 0
      );
    }

    if (config.castShadow !== undefined) {
      light.castShadow = config.castShadow;
    }

    if (config.id) {
      this.lights.set(config.id, light);
    }

    this.scene.add(light);
    return light;
  }

  createPointLight(config = {}) {
    const light = new THREE.PointLight(
      config.color ?? 0xffffff,
      config.intensity ?? 1.0,
      config.distance ?? 0,
      config.decay ?? 2
    );

    if (config.position) {
      light.position.set(
        config.position.x ?? 0,
        config.position.y ?? 0,
        config.position.z ?? 0
      );
    }

    if (config.castShadow !== undefined) {
      light.castShadow = config.castShadow;
    }

    if (config.id) {
      this.lights.set(config.id, light);
    }

    this.scene.add(light);
    return light;
  }

  createSpotLight(config = {}) {
    const light = new THREE.SpotLight(
      config.color ?? 0xffffff,
      config.intensity ?? 1.0,
      config.distance ?? 0,
      config.angle ?? Math.PI / 3,
      config.penumbra ?? 0,
      config.decay ?? 2
    );

    if (config.position) {
      light.position.set(
        config.position.x ?? 0,
        config.position.y ?? 0,
        config.position.z ?? 0
      );
    }

    if (config.castShadow !== undefined) {
      light.castShadow = config.castShadow;
    }

    if (config.id) {
      this.lights.set(config.id, light);
    }

    this.scene.add(light);

    if (config.target) {
      light.target.position.set(
        config.target.x ?? 0,
        config.target.y ?? 0,
        config.target.z ?? 0
      );
      this.scene.add(light.target);
    }

    return light;
  }

  getLight(id) {
    return this.lights.get(id) || null;
  }

  removeLight(id) {
    const light = this.lights.get(id);
    if (light) {
      this.scene.remove(light);
      this.lights.delete(id);
    }
  }

  destroy() {
    for (const [id, light] of this.lights) {
      this.scene.remove(light);
    }
    this.lights.clear();
  }
}

export default LightManager;
