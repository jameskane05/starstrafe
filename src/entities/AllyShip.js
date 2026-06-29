import * as THREE from "three";
import { castRay, castSphere } from "../physics/Physics.js";
import { loadMultiplayerShipModel } from "./RemotePlayer.js";

const _localOffset = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _toDesired = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _lookMatrix = new THREE.Matrix4();
const _targetQuat = new THREE.Quaternion();
const _upVec = new THREE.Vector3(0, 1, 0);
const _newPos = new THREE.Vector3();
const _fireDir = new THREE.Vector3();
const _muzzlePos = new THREE.Vector3();
const _thrusterPos = new THREE.Vector3();
const _shipForward = new THREE.Vector3();
const _labelWorldPos = new THREE.Vector3();

export class AllyShip {
  constructor(scene, position, level, bounds, options = {}) {
    this.scene = scene;
    this.level = level;
    this.boundsCenter = bounds?.center?.clone() || position.clone();
    this.boundsSize = bounds?.size?.clone() || new THREE.Vector3(40, 20, 40);
    this.team = "ally";
    this.disposed = false;
    this.health = 100;
    this.baseHealth = 100;
    this.speed = options.speed ?? 11;
    this.fireRate = options.fireRate ?? 1.1;
    this.damage = options.damage ?? 14;
    this.fireCooldown = 0.8;
    this.target = null;
    this.targetScanTimer = 0;
    this.targetScanInterval = 0.18;
    this.assistRangeSq = (options.assistRange ?? 95) ** 2;
    this.formationSide = options.formationSide ?? 1;
    this.recoveryTimer = 0;
    this.collisionRadius = options.collisionRadius ?? 2.4;
    this.hitExtents = { x: 5, y: 2.5, z: 5 };
    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);
    this.velocity = new THREE.Vector3();
    this.weaponMarkerIndex = 0;
    this.weaponMarkers = [];
    this.engineMarkers = [];
    this._physicsSlot =
      Math.abs(Math.floor(position.x * 31 + position.y * 17 + position.z * 7)) %
      3;
    this.trailsEffect = options.trailsEffect || null;
    this.engineTrailTimer = 0;
    this.engineTrailRate = 0.03;
    this.labelOcclusionTimer = 0;
    this.labelOcclusionInterval = 0.1;
    this.laserColor = 0x66ccff;
    this.laserIntensity = 6;

    if (options.enableLights !== false) {
      this.shipLightIntensity = 4;
      this.shipLight = new THREE.PointLight(
        this.laserColor,
        this.shipLightIntensity,
        8,
        1.5,
      );
      scene.add(this.shipLight);
    }

    scene.add(this.mesh);
    this.createNameLabel();
    this._loadShipMesh();
  }

  createNameLabel() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, 256, 64);

    ctx.font = "bold 24px Rajdhani, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#00f0ff";
    ctx.fillText("LEADER", 128, 40);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.nameSprite = new THREE.Sprite(spriteMat);
    this.nameSprite.scale.set(4, 1, 1);
    this.nameSprite.position.set(0, 2, 0);
    this.nameSprite.renderOrder = 1000;
    this.mesh.add(this.nameSprite);
  }

  updateNameLabelOcclusion(delta, camera) {
    if (!this.nameSprite || !camera) return;
    this.labelOcclusionTimer -= delta;
    if (this.labelOcclusionTimer > 0) return;
    this.labelOcclusionTimer = this.labelOcclusionInterval;

    this.nameSprite.getWorldPosition(_labelWorldPos);
    const dist = camera.position.distanceTo(_labelWorldPos);
    if (dist < 0.1) {
      this.nameSprite.visible = true;
      return;
    }
    const hit = castRay(
      camera.position.x,
      camera.position.y,
      camera.position.z,
      _labelWorldPos.x,
      _labelWorldPos.y,
      _labelWorldPos.z,
    );
    if (!hit) {
      this.nameSprite.visible = true;
      return;
    }
    const toi = hit.timeOfImpact ?? hit.toi;
    this.nameSprite.visible = toi >= dist - 0.5;
  }

  async _loadShipMesh() {
    const model = await loadMultiplayerShipModel();
    if (this.disposed || !model) return;
    const clone = model.clone();
    clone.scale.setScalar(1);
    clone.rotation.set(0, Math.PI, 0);
    clone.traverse((child) => {
      const n = child.name;
      if (n === "Gun_L" || n === "Gun_R") {
        this.weaponMarkers.push(child);
      } else if (n === "Engine_L" || n === "Engine_R") {
        this.engineMarkers.push(child);
      }
      if (!child.isMesh || !child.material) return;
      if (Array.isArray(child.material)) {
        child.material = child.material.map((m) => (m?.clone ? m.clone() : m));
      } else if (child.material.clone) {
        child.material = child.material.clone();
      }
    });
    this.shipMesh = clone;
    this.mesh.add(clone);
  }

  canMoveTo(from, to) {
    const hit = castSphere(
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      this.collisionRadius,
    );
    return !hit;
  }

  _pickTarget(enemies) {
    let best = null;
    let bestDistSq = this.assistRangeSq;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy?.mesh?.visible || enemy.health <= 0) continue;
      const distSq = this.mesh.position.distanceToSquared(enemy.mesh.position);
      if (distSq < bestDistSq) {
        best = enemy;
        bestDistSq = distSq;
      }
    }
    this.target = best;
  }

  update(delta, game, fireCallback, frameCount = 0) {
    if (this.disposed || !game?.player) return;
    const playerPos = game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig.position
      : game.camera.position;
    const playerQuat = game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig.quaternion
      : game.camera.quaternion;

    this.fireCooldown -= delta;
    this.targetScanTimer -= delta;
    this.recoveryTimer = Math.max(0, this.recoveryTimer - delta);
    if (this.targetScanTimer <= 0) {
      this.targetScanTimer = this.targetScanInterval;
      this._pickTarget(game.enemies);
    }

    _localOffset.set(18 * this.formationSide, 5, 18).applyQuaternion(playerQuat);
    _desiredPos.copy(playerPos).add(_localOffset);

    if (this.target?.mesh?.visible && this.target.health > 0) {
      _targetDir.subVectors(this.target.mesh.position, playerPos).normalize();
      _right.crossVectors(_targetDir, _upVec);
      if (_right.lengthSq() > 0.0001) {
        _right.normalize().multiplyScalar(this.formationSide);
        _desiredPos
          .copy(playerPos)
          .addScaledVector(_right, 20)
          .addScaledVector(_upVec, 5)
          .addScaledVector(_targetDir, 10);
      }
    }

    _toDesired.subVectors(_desiredPos, this.mesh.position);
    const distToDesired = _toDesired.length();
    if (distToDesired > 1) {
      _toDesired.normalize();
      this.velocity.lerp(_toDesired, Math.min(1, 3.5 * delta));
      if (this.velocity.lengthSq() > 0.0001) this.velocity.normalize();
      const catchup = distToDesired > 45 ? 1.7 : distToDesired > 24 ? 1.25 : 1;
      _newPos.copy(this.mesh.position).addScaledVector(
        this.velocity,
        this.speed * catchup * delta,
      );
      const physicsFrame = (frameCount + this._physicsSlot) % 3 === 0;
      if (!physicsFrame || this.canMoveTo(this.mesh.position, _newPos)) {
        this.mesh.position.copy(_newPos);
      } else if (this.recoveryTimer <= 0) {
        this.formationSide *= -1;
        this.recoveryTimer = 0.6;
        this.velocity.multiplyScalar(-0.35);
      }
    }

    if (this.shipLight) {
      this.shipLight.position.copy(this.mesh.position);
      this.shipLight.position.y += 0.3;
    }

    const aimTarget = this.target?.mesh?.visible && this.target.health > 0
      ? this.target.mesh.position
      : distToDesired > 1
        ? _desiredPos
        : null;
    if (aimTarget) {
      _lookMatrix.lookAt(this.mesh.position, aimTarget, _upVec);
      _targetQuat.setFromRotationMatrix(_lookMatrix);
      this.mesh.quaternion.slerp(_targetQuat, delta * 3);
    }
    if (this.nameSprite) {
      this.nameSprite.quaternion.identity();
    }
    this.updateNameLabelOcclusion(delta, game.camera);

    if (this.target?.mesh?.visible && this.target.health > 0) {
      const distSq = this.mesh.position.distanceToSquared(this.target.mesh.position);
      if (this.fireCooldown <= 0 && distSq < this.assistRangeSq) {
        let firePos = this.mesh.position;
        if (this.weaponMarkers.length > 0) {
          const marker =
            this.weaponMarkers[
              this.weaponMarkerIndex % this.weaponMarkers.length
            ];
          this.weaponMarkerIndex++;
          marker.getWorldPosition(_muzzlePos);
          firePos = _muzzlePos;
        }
        _fireDir.subVectors(this.target.mesh.position, firePos).normalize();
        fireCallback(firePos, _fireDir, {
          color: this.laserColor,
          intensity: this.laserIntensity,
          team: "ally",
          damage: this.damage,
        });
        this.fireCooldown = 1 / this.fireRate;
      }
    }

    if (this.trailsEffect && this.engineMarkers.length > 0) {
      this.engineTrailTimer += delta;
      while (this.engineTrailTimer >= this.engineTrailRate) {
        this.engineTrailTimer -= this.engineTrailRate;
        _shipForward
          .set(0, 0, -1)
          .applyQuaternion(this.mesh.quaternion)
          .normalize();
        for (const marker of this.engineMarkers) {
          marker.getWorldPosition(_thrusterPos);
          this.trailsEffect.emitEngineExhaust(_thrusterPos, _shipForward);
        }
      }
    }
  }

  dispose(scene = this.scene) {
    if (this.disposed) return;
    this.disposed = true;
    if (this.shipLight) {
      scene.remove(this.shipLight);
      this.shipLight.dispose?.();
    }
    if (this.nameSprite?.material?.map) {
      this.nameSprite.material.map.dispose();
    }
    this.nameSprite?.material?.dispose?.();
    scene.remove(this.mesh);
    this.mesh.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const mat of mats) mat?.dispose?.();
    });
  }
}
