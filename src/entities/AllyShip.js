import * as THREE from "three";
import { castRay, castSphere } from "../physics/Physics.js";
import { loadMultiplayerShipModel } from "./RemotePlayer.js";
import {
  closestDistanceOnPath,
  samplePath,
} from "../utils/pathRail.js";
import { updateObjectEnvZoneBlend } from "../utils/cockpitEnvZones.js";
import {
  createNameTagSprite,
  disposeNameTagSprite,
  setNameTagSpeaking,
} from "../ui/nameTagSprite.js";

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
const _pathTangent = new THREE.Vector3();
const _railDesiredPos = new THREE.Vector3();
const _blendDesiredPos = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _aimPos = new THREE.Vector3();
const _engineColorBlack = new THREE.Color(0x000000);
const _engineTintIdle = new THREE.Color(0x9beeff);
const _engineTintBoost = new THREE.Color(0x66ccff);

const FORMATION_RECOVERY_DISTANCE = 42;
const FORMATION_RETURN_DISTANCE = 32;
const RAIL_TARGET_AHEAD = 48;
const RAIL_CHASE_FOLLOW_GAP = 18;
const RAIL_HARD_PAUSE_AHEAD = 100;
const RAIL_CRUISE_SPEED = 7;
const RAIL_CATCHUP_SPEED = 90;
const RAIL_ACCEL_RATE = 55;
const RAIL_LOCK_INFLUENCE = 0.92;
const RAIL_LOCK_DISTANCE = 4;
const RAIL_ATTACH_RESPONSE = 4.5;
const IDLE_RETARGET_MIN = 4.0;
const IDLE_RETARGET_MAX = 7.0;
const IDLE_OFFSET_RESPONSE = 0.45;
const IDLE_STEER_RESPONSE = 0.85;
const IDLE_SPEED_SCALE = 0.72;
const FAR_CATCHUP_DISTANCE = 70;
const FAR_CATCHUP_SCALE = 8.0;

function accelerateToward(current, target, rate, delta) {
  const maxStep = rate * delta;
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

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
    this.pathRail = options.pathRail || null;
    this.pathRecovery = false;
    this.pathAlong = 0;
    this.pathVelocity = 0;
    this.pathInfluence = 0;
    this.blockedMoveCount = 0;
    this.collisionRadius = options.collisionRadius ?? 2.4;
    this.hitExtents = { x: 5, y: 2.5, z: 5 };
    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);
    this.velocity = new THREE.Vector3();
    this.weaponMarkerIndex = 0;
    this.weaponMarkers = [];
    this.engineMarkers = [];
    this.engineMaterials = [];
    this.engineGlowT = 0;
    this.currentMoveSpeed = 0;
    this.idleOffset = new THREE.Vector3();
    this.idleTargetOffset = new THREE.Vector3();
    this.idleRetargetTimer = 0;
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
    this.game = options.game ?? null;

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
    this.nameSprite = createNameTagSprite("LEADER", {
      scale: new THREE.Vector3(4, 1, 1),
      position: new THREE.Vector3(0, 2, 0),
    });
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
      if (n === "Engine_Center" || n === "Engine_L" || n === "Engine_R") {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const mat of mats) {
          if (mat?.color && mat?.emissive) this.engineMaterials.push(mat);
        }
      }
    });
    this.shipMesh = clone;
    this.mesh.add(clone);
    updateObjectEnvZoneBlend(this.mesh, this.game);
  }

  _retargetIdleOffset() {
    this.idleRetargetTimer =
      IDLE_RETARGET_MIN +
      Math.random() * (IDLE_RETARGET_MAX - IDLE_RETARGET_MIN);
    this.idleTargetOffset.set(
      (Math.random() - 0.5) * 28,
      (Math.random() - 0.35) * 6,
      -12 + Math.random() * 18,
    );
  }

  _updateIdleOffset(delta) {
    this.idleRetargetTimer -= delta;
    if (this.idleRetargetTimer <= 0) {
      this._retargetIdleOffset();
    }
    this.idleOffset.lerp(
      this.idleTargetOffset,
      1 - Math.exp(-IDLE_OFFSET_RESPONSE * delta),
    );
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

  _enterPathRecovery() {
    if (!this.pathRail || this.pathRecovery) return;
    this.pathRecovery = true;
    this.pathAlong = closestDistanceOnPath(this.pathRail, this.mesh.position);
    this.velocity.set(0, 0, 0);
    this.pathVelocity = Math.max(this.pathVelocity, RAIL_CRUISE_SPEED);
    this.blockedMoveCount = 0;
  }

  _updatePathIntent(delta, playerPos, desiredPos) {
    if (!this.pathRail) return null;
    const distToFormationSq = this.mesh.position.distanceToSquared(desiredPos);
    const playerAlong = closestDistanceOnPath(this.pathRail, playerPos);
    if (distToFormationSq > FORMATION_RECOVERY_DISTANCE * FORMATION_RECOVERY_DISTANCE) {
      this._enterPathRecovery();
    }

    const targetInfluence = this.pathRecovery ? 1 : 0;
    const blendRate = targetInfluence > this.pathInfluence ? 2.8 : 1.2;
    this.pathInfluence = THREE.MathUtils.damp(
      this.pathInfluence,
      targetInfluence,
      blendRate,
      delta,
    );

    if (this.pathInfluence < 0.01 && !this.pathRecovery) return null;

    const chaseAlong = this.game?._saturnaliaChase?.active
      ? this.game._saturnaliaChase.along
      : null;
    const maxLeaderAlong =
      chaseAlong != null ? Math.max(0, chaseAlong - RAIL_CHASE_FOLLOW_GAP) : this.pathRail.total;
    const targetAlong = THREE.MathUtils.clamp(
      Math.max(
        playerAlong + RAIL_TARGET_AHEAD,
        maxLeaderAlong,
      ),
      0,
      maxLeaderAlong,
    );
    const gap = targetAlong - this.pathAlong;
    const targetSpeed =
      this.pathAlong - playerAlong > RAIL_HARD_PAUSE_AHEAD
        ? 0
        : gap > 0
        ? THREE.MathUtils.clamp(gap * 1.35, RAIL_CRUISE_SPEED, RAIL_CATCHUP_SPEED)
        : 0;
    this.pathVelocity = accelerateToward(
      this.pathVelocity,
      targetSpeed,
      RAIL_ACCEL_RATE,
      delta,
    );
    this.pathAlong = Math.min(
      this.pathRail.total,
      maxLeaderAlong,
      this.pathAlong + this.pathVelocity * delta,
    );

    samplePath(this.pathRail, this.pathAlong, _railDesiredPos, _pathTangent);

    if (
      this.pathAlong > playerAlong + RAIL_TARGET_AHEAD * 0.5 &&
      distToFormationSq < FORMATION_RETURN_DISTANCE * FORMATION_RETURN_DISTANCE
    ) {
      this.pathRecovery = false;
      this.pathVelocity = RAIL_CRUISE_SPEED;
      this.blockedMoveCount = 0;
    }
    return {
      position: _railDesiredPos,
      tangent: _pathTangent,
      influence: this.pathInfluence,
    };
  }

  updateEngineGlow(delta) {
    const target = Math.min(1, this.currentMoveSpeed / Math.max(1, this.speed * 1.5));
    this.engineGlowT += (target - this.engineGlowT) * Math.min(1, delta * 4);
    for (const mat of this.engineMaterials) {
      mat.color.lerpColors(_engineColorBlack, _engineTintIdle, this.engineGlowT);
      mat.emissive.lerpColors(_engineColorBlack, _engineTintBoost, this.engineGlowT);
      mat.emissiveIntensity = 0.08 + 1.8 * this.engineGlowT;
    }
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
    this.currentMoveSpeed = 0;
    if (this.targetScanTimer <= 0) {
      this.targetScanTimer = this.targetScanInterval;
      this._pickTarget(game.enemies);
    }

    this._updateIdleOffset(delta);
    _localOffset
      .set(8 * this.formationSide, 3, -18)
      .add(this.idleOffset)
      .applyQuaternion(playerQuat);
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
    const pathIntent = this._updatePathIntent(delta, playerPos, _desiredPos);
    _blendDesiredPos.copy(_desiredPos);
    if (pathIntent) {
      _blendDesiredPos.lerp(pathIntent.position, pathIntent.influence);
    }

    let moveDist = 0;
    const railLocked =
      pathIntent &&
      this.pathRecovery &&
      pathIntent.influence >= RAIL_LOCK_INFLUENCE;
    if (railLocked) {
      const railDistSq = this.mesh.position.distanceToSquared(pathIntent.position);
      if (railDistSq <= RAIL_LOCK_DISTANCE * RAIL_LOCK_DISTANCE) {
        this.mesh.position.copy(pathIntent.position);
      } else {
        this.mesh.position.lerp(
          pathIntent.position,
          Math.min(1, RAIL_ATTACH_RESPONSE * delta),
        );
      }
      if (pathIntent.tangent.lengthSq() > 0.0001) {
        this.velocity.copy(pathIntent.tangent).normalize();
      }
      this.currentMoveSpeed = Math.max(RAIL_CRUISE_SPEED, this.pathVelocity);
      this.blockedMoveCount = 0;
    } else {
      _moveDir.subVectors(_blendDesiredPos, this.mesh.position);
      moveDist = _moveDir.length();
    }
    if (!railLocked && moveDist > 1) {
      _moveDir.normalize();
      const idleCruise =
        !this.target?.mesh?.visible &&
        !this.pathRecovery &&
        (!pathIntent || pathIntent.influence < 0.1);
      const steerResponse = idleCruise ? IDLE_STEER_RESPONSE : 2.8;
      this.velocity.lerp(_moveDir, Math.min(1, steerResponse * delta));
      if (this.velocity.lengthSq() > 0.0001) this.velocity.normalize();
      const catchup =
        moveDist > FAR_CATCHUP_DISTANCE
          ? FAR_CATCHUP_SCALE
          : moveDist > 45
          ? 3.5
          : moveDist > 24
          ? 1.25
          : 1;
      const railBoost = pathIntent ? THREE.MathUtils.lerp(1, 1.8, pathIntent.influence) : 1;
      const idleScale = idleCruise && moveDist < 45 ? IDLE_SPEED_SCALE : 1;
      const moveSpeed = this.speed * catchup * railBoost * idleScale;
      _newPos.copy(this.mesh.position).addScaledVector(
        this.velocity,
        moveSpeed * delta,
      );
      const physicsFrame = (frameCount + this._physicsSlot) % 3 === 0;
      if (!physicsFrame || this.canMoveTo(this.mesh.position, _newPos)) {
        this.mesh.position.copy(_newPos);
        this.currentMoveSpeed = moveSpeed;
        this.blockedMoveCount = 0;
      } else if (this.recoveryTimer <= 0) {
        this.blockedMoveCount++;
        if (this.pathRail && this.blockedMoveCount >= 2) {
          this._enterPathRecovery();
        } else {
          this.formationSide *= -1;
          this.recoveryTimer = 0.6;
          this.velocity.multiplyScalar(-0.35);
        }
      }
    }

    if (this.shipLight) {
      this.shipLight.position.copy(this.mesh.position);
      this.shipLight.position.y += 0.3;
    }
    this.updateEngineGlow(delta);

    const aimTarget = this.target?.mesh?.visible && this.target.health > 0
      ? this.target.mesh.position
      : pathIntent?.tangent?.lengthSq?.() > 0.0001 && pathIntent.influence > 0.35
        ? _aimPos.copy(this.mesh.position).add(pathIntent.tangent)
        : moveDist > 1
        ? _blendDesiredPos
        : null;
    if (aimTarget) {
      _lookMatrix.lookAt(this.mesh.position, aimTarget, _upVec);
      _targetQuat.setFromRotationMatrix(_lookMatrix);
      this.mesh.quaternion.slerp(_targetQuat, delta * 3);
    }
    if (this.nameSprite) {
      this.nameSprite.quaternion.identity();
      setNameTagSpeaking(
        this.nameSprite,
        game.dialogManager?.isPlaying === true &&
          game.dialogManager?.activeSpeakerId === "leader",
      );
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
    disposeNameTagSprite(this.nameSprite);
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
