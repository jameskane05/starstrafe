import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { castSphere } from "../physics/Physics.js";

const _direction = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _lookMatrix = new THREE.Matrix4();
const _upVec = new THREE.Vector3(0, 1, 0);
const _newPos = new THREE.Vector3();
const _patrolDir = new THREE.Vector3();

let exteriorModel = null;
let loadPromise = null;

async function loadShipModels() {
  if (loadPromise) return loadPromise;
  if (exteriorModel) return;

  loadPromise = (async () => {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync('./Heavy_EXT_01.glb');
      exteriorModel = gltf.scene;
      console.log('Loaded exterior ship model for enemies');
    } catch (err) {
      console.warn('Failed to load Heavy_EXT_01.glb for enemies:', err);
    }
  })();

  return loadPromise;
}

// Export for Game.js to await before spawning
export { loadShipModels };

export class Enemy {
  constructor(scene, position, level) {
    this.level = level;
    this.health = 100;
    this.speed = 4;
    this.detectionRange = 30;
    this.fireRate = 2;
    this.fireCooldown = 0;
    this.collisionRadius = 3;
    this.disposed = false;

    this.state = "patrol";
    this.patrolTarget = position.clone();
    this.patrolTimer = 0;
    this.glowColor = new THREE.Color().setHSL(Math.random(), 0.8, 0.6).getHex();

    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);

    if (exteriorModel) {
      const clone = exteriorModel.clone();
      clone.scale.setScalar(0.5);
      clone.rotation.set(0, Math.PI, 0);
      clone.traverse((child) => {
        if (child.isMesh) {
          child.material = child.material.clone();
        }
      });
      this.mesh.add(clone);
    } else {
      const fallbackGeo = new THREE.OctahedronGeometry(0.8, 0);
      const fallbackMat = new THREE.MeshStandardMaterial({
        color: 0xff3333,
        emissive: 0xff0000,
        emissiveIntensity: 0.3,
        metalness: 0.8,
        roughness: 0.2,
      });
      this.mesh.add(new THREE.Mesh(fallbackGeo, fallbackMat));
    }

    scene.add(this.mesh);
  }

  canMoveTo(from, to) {
    const hit = castSphere(
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      this.collisionRadius
    );
    return !hit;
  }

  update(delta, playerPos, fireCallback) {
    if (this.disposed) return;

    this.fireCooldown -= delta;

    const distToPlayerSq = this.mesh.position.distanceToSquared(playerPos);
    const detectionRangeSq = this.detectionRange * this.detectionRange;

    if (distToPlayerSq < detectionRangeSq) {
      this.state = "attack";
    } else {
      this.state = "patrol";
    }

    if (this.state === "attack") {
      _direction.subVectors(playerPos, this.mesh.position).normalize();

      _lookMatrix.lookAt(this.mesh.position, playerPos, _upVec);
      _targetQuat.setFromRotationMatrix(_lookMatrix);
      this.mesh.quaternion.slerp(_targetQuat, delta * 2);

      if (distToPlayerSq > 64) {
        // 8^2
        _newPos.copy(this.mesh.position);
        _newPos.x += _direction.x * this.speed * delta;
        _newPos.y += _direction.y * this.speed * delta;
        _newPos.z += _direction.z * this.speed * delta;
        if (this.canMoveTo(this.mesh.position, _newPos)) {
          this.mesh.position.copy(_newPos);
        }
      }

      if (this.fireCooldown <= 0 && distToPlayerSq < 625) {
        // 25^2
        fireCallback(this.mesh.position, _direction);
        this.fireCooldown = 1 / this.fireRate;
      }
    } else {
      this.patrolTimer -= delta;
      if (this.patrolTimer <= 0) {
        this.patrolTarget.copy(this.mesh.position);
        this.patrolTarget.x += (Math.random() - 0.5) * 10;
        this.patrolTarget.y += (Math.random() - 0.5) * 4;
        this.patrolTarget.z += (Math.random() - 0.5) * 10;
        this.patrolTimer = 3 + Math.random() * 2;
      }

      _patrolDir.subVectors(this.patrolTarget, this.mesh.position).normalize();

      _newPos.copy(this.mesh.position);
      const moveSpeed = this.speed * 0.3 * delta;
      _newPos.x += _patrolDir.x * moveSpeed;
      _newPos.y += _patrolDir.y * moveSpeed;
      _newPos.z += _patrolDir.z * moveSpeed;
      if (this.canMoveTo(this.mesh.position, _newPos)) {
        this.mesh.position.copy(_newPos);
      }
    }

    this.mesh.rotation.y += delta * 0.5;
  }

  takeDamage(amount) {
    this.health -= amount;
  }

  dispose(scene) {
    if (this.disposed) return;
    this.disposed = true;

    scene.remove(this.mesh);

    // Dispose cloned geometries/materials
    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
