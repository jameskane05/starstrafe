/**
 * SceneManager.js - SCENE OBJECT LOADING AND MANAGEMENT
 * =============================================================================
 *
 * ROLE: Loads and manages 3D scene content: Gaussian splats (SparkRenderer/SplatMesh)
 * and GLTF models (Three.js GLTFLoader). Creates physics colliders for level geometry.
 *
 * KEY RESPONSIBILITIES:
 * - loadObject(objectData, onProgress): load splat or GLTF by id; cache in objects Map
 * - hasObject(id), getObject(id); create trimesh/kinematic colliders via Physics.js
 * - Support for level meshes, occlusion, spawn points; shared ship materials (Enemy.js)
 * - Used by gameInit, gameLevel for preloading; by DynamicSceneElementManager for dynamic elements
 *
 * RELATED: sceneData.js, Physics.js, Enemy.js, gameLevel.js, lightData.js (criteria).
 *
 * =============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SplatMesh } from "@sparkjsdev/spark";
import {
  createTrimeshCollider,
  createKinematicTrimeshCollider,
  removeRigidBody,
} from "../physics/Physics.js";
import { loadSharedShipMaterials } from "../entities/Enemy.js";

function applyRotationDegrees(target, rotation) {
  target.rotation.set(
    THREE.MathUtils.degToRad(rotation.x || 0),
    THREE.MathUtils.degToRad(rotation.y || 0),
    THREE.MathUtils.degToRad(rotation.z || 0),
  );
}

/**
 * Strip optional authoring label after first "-", e.g. Trigger-Main → Trigger,
 * Trigger.003-Cold → Trigger.003. Bindings still use ordinal ids (Trigger, Trigger.001, …).
 */
function levelTriggerMeshBaseName(raw) {
  const name = (raw || "").trim();
  const dash = name.indexOf("-");
  if (dash === -1) return name;
  return name.slice(0, dash).trim();
}

function isLevelTriggerMeshName(raw) {
  const name = levelTriggerMeshBaseName(raw);
  if (name === "Trigger") return true;
  if (name.startsWith("Trigger.")) return true;
  return /^Trigger\d+$/.test(name);
}

function isEnvMapZoneMeshName(raw) {
  return (raw || "").startsWith("EnvMap-");
}

function isEnvMapZoneObject(object) {
  let current = object;
  while (current) {
    if (isEnvMapZoneMeshName(current.name)) return true;
    current = current.parent;
  }
  return false;
}

function isMetadataVolumeObject(object) {
  let current = object;
  while (current) {
    const name = current.name || "";
    if (
      name.startsWith("EnvMap-") ||
      name.startsWith("ChaseEnemy") ||
      name.startsWith("ChasePath") ||
      name.startsWith("Boost")
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Map base / GLTFLoader names to binding ids: Trigger, Trigger.001, Trigger.002, … */
function canonicalLevelTriggerVolumeId(raw) {
  const name = levelTriggerMeshBaseName(raw);
  if (name === "Trigger") return "Trigger";
  if (name.startsWith("Trigger.")) {
    const rest = name.slice("Trigger.".length);
    if (/^\d+$/.test(rest)) {
      const padded = rest.length >= 3 ? rest : rest.padStart(3, "0");
      return `Trigger.${padded}`;
    }
    return name;
  }
  const m = /^Trigger(\d+)$/.exec(name);
  if (m) {
    const num = m[1];
    const padded = num.length >= 3 ? num : num.padStart(3, "0");
    return `Trigger.${padded}`;
  }
  return name;
}

let _levelTriggerHiddenMaterial = null;

function getLevelTriggerHiddenMaterial() {
  if (!_levelTriggerHiddenMaterial) {
    _levelTriggerHiddenMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
    });
  }
  return _levelTriggerHiddenMaterial;
}

function disposeMeshMaterials(mesh) {
  if (!mesh?.material) return;
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((m) => m?.dispose());
  } else {
    mesh.material.dispose();
  }
}

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
    this._physicsBodies = new Map(); // id -> RigidBody | RigidBody[] (for level + dynamic elements)
  }

  /**
   * Load a scene object based on its config
   * @param {Object} objectData - Object configuration from sceneData.js
   * @param {Function} onProgress - Optional progress callback (0-1)
   * @returns {Promise<THREE.Object3D>}
   */
  async loadObject(objectData, onProgress = null) {
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
        loadPromise = this._loadSplat(objectData, onProgress);
        break;
      case "gltf":
        loadPromise = this._loadGLTF(objectData, onProgress);
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

      if (objectData.gizmo && window.gizmoManager) {
        window.gizmoManager.registerObject(object, id, type);
      }

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
  async _loadSplat(objectData, onProgress = null) {
    const {
      id,
      path,
      position,
      rotation,
      scale,
      quaternion,
      paged,
      lod,
      extSplats,
      lodScale,
    } = objectData;

    console.log(
      `[SceneManager] Loading splat: ${path}${paged ? " (paged/LOD)" : ""}`,
    );

    const splatMesh = new SplatMesh({
      url: path,
      editable: true,
      paged: paged || false,
      lod: lod,
      extSplats: extSplats,
      lodScale: lodScale,
      onProgress: (progress) => {
        if (onProgress) onProgress(progress);
      },
    });

    // Apply transform
    if (quaternion) {
      splatMesh.quaternion.set(
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w,
      );
    } else if (rotation) {
      applyRotationDegrees(splatMesh, rotation);
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

    // Wait for initialization with timeout
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Splat load timeout: ${path}`)), 60000),
    );

    try {
      await Promise.race([splatMesh.initialized, timeout]);
    } catch (err) {
      console.error(`[SceneManager] Splat load error:`, err);
      // Still return the mesh even if timeout - it might load eventually
    }

    return splatMesh;
  }

  /**
   * Load a GLTF model
   */
  _loadGLTF(objectData, onProgress = null) {
    const ESTIMATED_GLB_BYTES = 25 * 1024 * 1024;
    return new Promise((resolve, reject) => {
      const { id, path, position, rotation, scale, options } = objectData;
      const combined = options?.combinedLevel;

      const progressCb = (a, b, c) => {
        if (!onProgress) return;
        const loaded = a?.loaded ?? b;
        const total = a?.total ?? c;
        if (total > 0 && typeof loaded === "number") {
          onProgress(loaded / total);
        } else if (loaded > 0) {
          onProgress(Math.min(0.99, loaded / ESTIMATED_GLB_BYTES));
        }
      };

      this.gltfLoader.load(
        path,
        async (gltf) => {
          const model = gltf.scene;

          if (combined) {
            const geometryName = combined.geometryName || "LevelGeometry";
            if (!model.getObjectByName(geometryName)) {
              reject(
                new Error(`Combined level missing object "${geometryName}"`),
              );
              return;
            }

            const markerGroup = this._extractMarkerGroupFromModel(model);

            let dynamicElements = [];
            const dynConfig = combined.dynamicSceneElements;
            const pillarPrefix = dynConfig?.meshNamePrefix;
            const animateDynamicMeshes =
              pillarPrefix && dynConfig.animate !== false;
            if (pillarPrefix && animateDynamicMeshes) {
              dynamicElements = this._extractDynamicSceneElementsFromModel(
                model,
                pillarPrefix,
              );
            }

            const container = new THREE.Group();
            // GLTF root is a flat list: LevelGeometry mesh plus Enemy/Spawn/Trigger siblings.
            // Reparent *all* of them — only adding LevelGeometry left triggers off-scene and
            // produced empty levelTriggerVolumes + invisible debug meshes.
            while (model.children.length > 0) {
              container.add(model.children[0]);
            }

            if (dynamicElements.length > 0) {
              const dynGroup = new THREE.Group();
              for (const { mesh } of dynamicElements) {
                dynGroup.add(mesh);
              }
              container.add(dynGroup);
            }

            const geometryRoot = container.getObjectByName(geometryName);
            if (!geometryRoot) {
              reject(
                new Error(
                  `Combined level lost "${geometryName}" after reparenting`,
                ),
              );
              return;
            }

            if (position) {
              container.position.set(position.x || 0, position.y || 0, position.z || 0);
            }
            if (rotation) {
              applyRotationDegrees(container, rotation);
            }
            if (scale !== undefined) {
              if (typeof scale === "number") {
                container.scale.setScalar(scale);
              } else if (typeof scale === "object") {
                container.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
              }
            }

            container.updateMatrixWorld(true);
            container.userData.extractedSpawnPoints =
              this._extractSpawnPointsFromModel(container);
            if (dynamicElements.length > 0) container.userData.dynamicSceneElements = dynamicElements;

            const spawnMeshesToRemove = [];
            container.traverse((child) => {
              const n = child.name || "";
              if (
                n.startsWith("Enemy") ||
                n.startsWith("Spawn") ||
                n.startsWith("Missile") ||
                n.startsWith("Boost") ||
                n === "Goal" ||
                n.startsWith("Goal.")
              ) {
                spawnMeshesToRemove.push(child);
              }
            });
            for (const obj of spawnMeshesToRemove) {
              obj.removeFromParent();
              obj.geometry?.dispose();
              if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
                else obj.material.dispose();
              }
            }
            if (markerGroup) {
              container.add(markerGroup);
            }
            container.updateMatrixWorld(true);
            container.userData.levelTriggerVolumes =
              this._extractTriggerVolumesFromPlacedRoot(container);

            if (options.occluder) {
              this._applyOccluderMaterial(container, options.debugWireframe);
            }
            this._configureLevelTriggerMeshes(
              container,
              options?.debugLevelTriggers === true,
            );
            if (dynamicElements.length > 0) {
              await this._applyDynamicElementMaterial(dynamicElements, dynConfig);
            } else if (pillarPrefix && !animateDynamicMeshes) {
              await this._applyDynamicElementMaterialByPrefix(
                container,
                pillarPrefix,
                dynConfig,
              );
            }
            if (options.physicsCollider) {
              const skipPrefixes = ["Trigger", "EnvMap-", "ChaseEnemy", "ChasePath", "Boost"];
              if (pillarPrefix && animateDynamicMeshes) {
                skipPrefixes.push(pillarPrefix);
              }
              const colliderRoot =
                pillarPrefix && !animateDynamicMeshes ? container : geometryRoot;
              const pos = { x: container.position.x, y: container.position.y, z: container.position.z };
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  container.updateMatrixWorld(true);
                  let bodies = [];
                  if (animateDynamicMeshes) {
                    for (const el of dynamicElements) {
                      el.container = container;
                      el.mesh.getWorldPosition(el.basePos);
                      el.mesh.getWorldQuaternion(el.baseQuat);
                      el.body = this._createDynamicElementKinematicCollider(el, container);
                      if (el.body) bodies.push(el.body);
                    }
                  }
                  this._createPhysicsCollider(id, colliderRoot, pos, skipPrefixes, bodies);
                });
              });
            }

            this.scene.add(container);
            if (onProgress) onProgress(1);
            resolve(container);
            return;
          }

          if (position) {
            model.position.set(
              position.x || 0,
              position.y || 0,
              position.z || 0,
            );
          }
          if (rotation) {
            applyRotationDegrees(model, rotation);
          }
          if (scale !== undefined) {
            if (typeof scale === "number") {
              model.scale.setScalar(scale);
            } else if (typeof scale === "object") {
              model.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
            }
          }

          if (options) {
            if (options.visible === false) {
              model.visible = false;
            }
            if (options.occluder) {
              this._applyOccluderMaterial(model, options.debugWireframe);
            }
            if (options.physicsCollider) {
              this._createPhysicsCollider(id, model, position);
            }
          }
          this._configureLevelTriggerMeshes(
            model,
            options?.debugLevelTriggers === true,
          );

          this.scene.add(model);
          if (onProgress) onProgress(1);
          resolve(model);
        },
        progressCb,
        (error) => reject(error),
      );
    });
  }

  _extractSpawnPointsFromModel(model) {
    const enemyEntries = [];
    const playerEntries = [];
    const missile = [];
    const weaponPickups = [];
    const goals = [];
    const boosts = [];
    const goalOrder = { Goal: 0, "Goal.001": 1, "Goal.002": 2 };
    model.updateMatrixWorld(true);
    model.traverse((child) => {
      const name = child.name || "";
      if (name.startsWith("Enemy")) {
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        enemyEntries.push({ name, position: pos.clone() });
      } else if (name.startsWith("Spawn")) {
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        const quat = new THREE.Quaternion();
        child.getWorldQuaternion(quat);
        playerEntries.push({
          name,
          position: pos.clone(),
          quaternion: quat.clone(),
        });
      } else if (name.startsWith("Missile")) {
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        missile.push(pos.clone());
      } else if (name.startsWith("ChargingLaser") || name.startsWith("Gatling")) {
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        weaponPickups.push({
          type: name.startsWith("ChargingLaser") ? "charging_laser" : "gatling",
          position: pos.clone(),
        });
      } else if (name === "Goal" || name.startsWith("Goal.")) {
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        const quat = new THREE.Quaternion();
        child.getWorldQuaternion(quat);
        goals.push({
          name,
          position: pos.clone(),
          quaternion: quat.clone(),
        });
      } else if (name.startsWith("Boost")) {
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        const quat = new THREE.Quaternion();
        child.getWorldQuaternion(quat);
        boosts.push({
          name,
          position: pos.clone(),
          quaternion: quat.clone(),
        });
      }
    });
    playerEntries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    enemyEntries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    const enemy = enemyEntries.map((e) => e.position);
    const enemyIsHeavy = enemyEntries.map((e) =>
      /(?:\s-\s*|-\s*)Heavy\s*$/i.test((e.name || "").trim()),
    );
    const player = playerEntries.map((e) => e.position);
    const playerMarkerQuaternions = playerEntries.map((e) => e.quaternion);
    goals.sort((a, b) => {
      const aOrder = goalOrder[a.name] ?? Number.MAX_SAFE_INTEGER;
      const bOrder = goalOrder[b.name] ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    boosts.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    return {
      enemy,
      enemyIsHeavy,
      player,
      playerMarkerQuaternions,
      missile,
      weaponPickups,
      goals: goals.map((entry) => entry.position.clone()),
      goalQuaternions: goals.map((entry) => entry.quaternion.clone()),
      boosts: boosts.map((entry) => entry.position.clone()),
      boostQuaternions: boosts.map((entry) => entry.quaternion.clone()),
    };
  }

  /**
   * Trigger meshes under the placed level root (`Trigger`, `Trigger001`, `Trigger-Main`, …).
   * Labels after the first `-` are ignored; volumes use canonical ids (`Trigger`, `Trigger.001`, …).
   * World-space AABB via Box3.setFromObject. Run after container transform + updateMatrixWorld.
   */
  _extractTriggerVolumesFromPlacedRoot(root) {
    const volumes = [];
    const box = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverse((child) => {
      const name = (child.name || "").trim();
      if (!isLevelTriggerMeshName(name)) return;
      box.setFromObject(child);
      if (box.isEmpty()) return;
      volumes.push({
        objectName: canonicalLevelTriggerVolumeId(name),
        worldMin: box.min.clone(),
        worldMax: box.max.clone(),
      });
    });
    volumes.sort((a, b) =>
      a.objectName.localeCompare(b.objectName, undefined, { numeric: true }),
    );
    return volumes;
  }

  _extractMarkerGroupFromModel(model) {
    const markerGroup = new THREE.Group();
    markerGroup.name = "LevelMarkers";
    markerGroup.visible = false;
    const keepNames = new Set(["Goal", "Goal.001", "Goal.002"]);
    model.updateMatrixWorld(true);
    model.traverse((child) => {
      const name = child.name || "";
      if (
        !keepNames.has(name) &&
        !name.startsWith("Boost") &&
        !name.startsWith("Enemy") &&
        !name.startsWith("Spawn") &&
        !name.startsWith("Missile")
      ) {
        return;
      }
      const marker = new THREE.Object3D();
      marker.name = name;
      child.getWorldPosition(marker.position);
      child.getWorldQuaternion(marker.quaternion);
      markerGroup.add(marker);
    });
    return markerGroup.children.length > 0 ? markerGroup : null;
  }

  _extractDynamicSceneElementsFromModel(model, meshNamePrefix) {
    const elements = [];
    const toExtract = [];
    model.traverse((child) => {
      if (!child.isMesh || !child.name || !child.name.startsWith(meshNamePrefix)) return;
      toExtract.push(child);
    });
    model.updateMatrixWorld(true);
    for (const mesh of toExtract) {
      mesh.removeFromParent();
      const basePos = new THREE.Vector3();
      const baseQuat = new THREE.Quaternion();
      mesh.getWorldPosition(basePos);
      mesh.getWorldQuaternion(baseQuat);
      mesh.position.copy(basePos);
      mesh.quaternion.copy(baseQuat);
      elements.push({ mesh, basePos: basePos.clone(), baseQuat: baseQuat.clone(), body: null, container: null });
    }
    return elements;
  }

  _createDynamicElementKinematicCollider(el, container) {
    const vertices = [];
    const indices = [];
    let indexOffset = 0;
    const worldPos = new THREE.Vector3();
    el.mesh.getWorldPosition(worldPos);
    el.mesh.updateMatrixWorld(true);
    el.mesh.traverse((child) => {
      if (!child.isMesh) return;
      const geo = child.geometry;
      const pos = geo.attributes.position;
      const idx = geo.index;
      const matrix = child.matrixWorld;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
        vertices.push(v.x - worldPos.x, v.y - worldPos.y, v.z - worldPos.z);
      }
      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          indices.push(idx.getX(i) + indexOffset);
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          indices.push(i + indexOffset);
        }
      }
      indexOffset += pos.count;
    });
    if (vertices.length === 0) return null;
    return createKinematicTrimeshCollider(vertices, indices, worldPos.x, worldPos.y, worldPos.z);
  }

  _ensureUv(geometry) {
    if (!geometry || geometry.attributes?.uv || !geometry.attributes?.position) return;
    const pos = geometry.attributes.position;
    if (!pos || pos.count < 3) return;
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const sx = Math.max(1e-5, bb.max.x - bb.min.x);
    const sy = Math.max(1e-5, bb.max.y - bb.min.y);
    const sz = Math.max(1e-5, bb.max.z - bb.min.z);
    const uAxis = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
    const vAxis = uAxis === 0 ? (sy >= sz ? 1 : 2) : uAxis === 1 ? (sx >= sz ? 0 : 2) : sx >= sy ? 0 : 1;
    const get = (i, axis) => axis === 0 ? pos.getX(i) : axis === 1 ? pos.getY(i) : pos.getZ(i);
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const su = Math.max(1e-5, [sx, sy, sz][uAxis]);
      const sv = Math.max(1e-5, [sx, sy, sz][vAxis]);
      const minU = [bb.min.x, bb.min.y, bb.min.z][uAxis];
      const minV = [bb.min.x, bb.min.y, bb.min.z][vAxis];
      uv[i * 2] = (get(i, uAxis) - minU) / su;
      uv[i * 2 + 1] = (get(i, vAxis) - minV) / sv;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.attributes.uv.needsUpdate = true;
  }

  async _applyDynamicElementMaterialByPrefix(root, meshNamePrefix, dynConfig = {}) {
    if (!root || !meshNamePrefix) return;
    const elements = [];
    root.traverse((child) => {
      if (!child.isMesh || !child.name?.startsWith(meshNamePrefix)) return;
      elements.push({ mesh: child });
    });
    if (elements.length === 0) return;
    await this._applyDynamicElementMaterial(elements, dynConfig);
  }

  async _applyDynamicElementMaterial(elements, dynConfig = {}) {
    const sharedTex = await loadSharedShipMaterials();
    const matOpts = dynConfig.material || {};
    const { color: colorBeforeTint, ...matRest } = matOpts;
    let baseColor = colorBeforeTint ?? 0x050507;
    if (dynConfig.ambientTint != null && dynConfig.ambientTintStrength > 0) {
      const base = new THREE.Color(baseColor);
      const tint = new THREE.Color(dynConfig.ambientTint);
      base.lerp(tint, dynConfig.ambientTintStrength ?? 0.12);
      baseColor = base.getHex();
    }
    const material = new THREE.MeshStandardMaterial({
      color: baseColor,
      map: sharedTex.hullLightsDiffuse ?? null,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: sharedTex.hullLightsEmit ?? null,
      emissiveIntensity: matOpts.emissiveIntensity ?? 2.5,
      metalness: matOpts.metalness ?? 0.06,
      roughness: matOpts.roughness ?? 0.94,
      normalMap: sharedTex.normalMap ?? null,
      normalScale: new THREE.Vector2(1, 1),
      side: THREE.DoubleSide,
      ...matRest,
    });
    for (const el of elements) {
      el.mesh.traverse((child) => {
        if (!child.isMesh) return;
        this._ensureUv(child.geometry);
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
        child.material = material;
        child.renderOrder = 0;
      });
    }
  }

  /**
   * Level trigger volumes (Trigger / Trigger.001 / …): never use authored GLTF materials,
   * never participate in splat occlusion (see _applyOccluderMaterial skip). Hidden by default;
   * set `options.debugLevelTriggers: true` on the GLTF object in sceneData to show magenta wireframes.
   */
  _configureLevelTriggerMeshes(root, debugLevelTriggers = false) {
    const roots = [];
    root.updateMatrixWorld(true);
    root.traverse((child) => {
      if (isLevelTriggerMeshName(child.name)) roots.push(child);
    });
    const hiddenMat = getLevelTriggerHiddenMaterial();
    for (const tr of roots) {
      tr.traverse((desc) => {
        if (!desc.isMesh) return;
        disposeMeshMaterials(desc);
        if (debugLevelTriggers) {
          desc.material = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
            wireframe: true,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            depthTest: true,
          });
        } else {
          desc.material = hiddenMat;
        }
        desc.castShadow = false;
        desc.receiveShadow = false;
      });
      tr.visible = debugLevelTriggers;
    }
  }

  /**
   * Apply occluder material to a model - writes to depth buffer to occlude transparent objects
   * @param {THREE.Object3D} model - The model to apply the material to
   * @param {boolean} debugWireframe - If true, show a visible wireframe for alignment
   */
  _applyOccluderMaterial(model, debugWireframe = false) {
    model.traverse((child) => {
      if (child.isMesh) {
        if (isLevelTriggerMeshName(child.name)) return;
        if (isMetadataVolumeObject(child)) {
          child.visible = false;
          child.castShadow = false;
          child.receiveShadow = false;
          return;
        }
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }

        if (debugWireframe) {
          child.material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            wireframe: true,
            transparent: true,
            opacity: 0.3,
            depthWrite: true,
            depthTest: true,
          });
        } else {
          child.material = new THREE.ShaderMaterial({
            vertexShader: `
              void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `,
            fragmentShader: `
              void main() {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
              }
            `,
            depthTest: true,
            depthWrite: true,
            transparent: true,
            side: THREE.DoubleSide,
          });
        }
        child.castShadow = false;
        child.receiveShadow = false;
        child.renderOrder = -50;
      }
    });
  }

  /**
   * Set occluder debug mode on/off for a loaded object
   * @param {string} id - Object ID
   * @param {boolean} debugWireframe - If true, show wireframe; if false, invisible occluder
   */
  setOccluderDebug(id, debugWireframe) {
    const object = this.objects.get(id);
    if (object) {
      this._applyOccluderMaterial(object, debugWireframe);
    }
  }

  /** Toggle trigger volume visibility (magenta wireframe) after load; production keeps this false. */
  setLevelTriggerDebug(id, debugLevelTriggers) {
    const object = this.objects.get(id);
    if (object) {
      this._configureLevelTriggerMeshes(object, debugLevelTriggers === true);
    }
  }

  _createPhysicsCollider(id, model, position, skipPrefixes = ["Cube"], existingBodies = null) {
    const vertices = [];
    const indices = [];
    let indexOffset = 0;
    const bodyPos = new THREE.Vector3();

    const skips = (object) =>
      skipPrefixes.some((p) => object.name?.startsWith(p)) ||
      isMetadataVolumeObject(object);

    model.updateMatrixWorld(true);
    if (model.getWorldPosition) {
      model.getWorldPosition(bodyPos);
    } else {
      bodyPos.set(position?.x || 0, position?.y || 0, position?.z || 0);
    }

    model.traverse((child) => {
      if (!child.isMesh) return;
      if (skips(child)) return;

      const geo = child.geometry;
      const pos = geo.attributes.position;
      const idx = geo.index;

      child.updateWorldMatrix(true, false);
      const matrix = child.matrixWorld;
      const localMatrix = matrix.clone();
      localMatrix.elements[12] -= bodyPos.x;
      localMatrix.elements[13] -= bodyPos.y;
      localMatrix.elements[14] -= bodyPos.z;

      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(localMatrix);
        vertices.push(v.x, v.y, v.z);
      }

      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          indices.push(idx.getX(i) + indexOffset);
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          indices.push(i + indexOffset);
        }
      }
      indexOffset += pos.count;
    });

    if (vertices.length === 0) {
      console.warn(
        `[SceneManager] No geometry found for physics collider "${id}"`,
      );
      return;
    }

    const body = createTrimeshCollider(
      vertices,
      indices,
      bodyPos.x,
      bodyPos.y,
      bodyPos.z,
    );
    const bodies = existingBodies ?? this._physicsBodies.get(id) ?? [];
    bodies.push(body);
    this._physicsBodies.set(id, bodies);
    console.log(
      `[SceneManager] Created trimesh collider for "${id}" (${vertices.length / 3} verts, ${indices.length / 3} tris)`,
    );
    return bodies;
  }

  /**
   * Remove an object from the scene
   */
  removeObject(id) {
    const bodies = this._physicsBodies.get(id);
    if (bodies) {
      for (const body of bodies) {
        removeRigidBody(body);
      }
      this._physicsBodies.delete(id);
    }

    const object = this.objects.get(id);
    if (object) {
      // Dispose SplatMesh
      if (object.dispose) {
        object.dispose();
      }

      // Remove from scene and parent
      object.removeFromParent();
      this.scene.remove(object);

      // Dispose geometries and materials
      const toDispose = [];
      object.traverse((child) => toDispose.push(child));
      for (const child of toDispose) {
        child.removeFromParent();
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }

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
   * Get the LevelGeometry root node from a combined level container.
   * Returns null if the object isn't loaded or has no LevelGeometry child.
   */
  getGeometryRoot(id, geometryName = 'LevelGeometry') {
    const container = this.objects.get(id);
    if (!container) return null;
    return container.getObjectByName(geometryName) ?? null;
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
