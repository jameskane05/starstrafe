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
import {
  EngineTrail,
  ENGINE_TRAIL_FIXED_STEP,
  trackEngineTrailSegment,
} from "../vfx/EngineTrail.js";

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
const _enginePos = new THREE.Vector3();
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
const ESCAPE_LEAD_MIN = 50;
const ESCAPE_LEAD_TARGET = 65;
const ESCAPE_LEAD_MAX = 80;
const ESCAPE_LEAD_MAX_SPEED = 220;
const ESCAPE_LEAD_BOOST_MAX_SPEED = 300;
const ESCAPE_LEAD_BOOST_ACCEL_RATE = 140;
const ESCAPE_LEAD_BOOST_LEAD_MARGIN = 14;
const PATH_LEAD_MIN = 38;
const PATH_LEAD_TARGET = 48;
const PATH_LEAD_MAX = 72;
const PATH_LEAD_MAX_SPEED = 220;
const PATH_LEAD_BOOST_MAX_SPEED = 300;
const PATH_LEAD_COMBAT_DROP_BEHIND = 28;
const ALLY_ENGINE_TRAIL_OPTS = {
  maxPoints: 64,
  trailTime: 1.25,
  width: 0.85,
  colorStart: 0xfff0aa,
  colorEnd: 0x88ddff,
  emissiveIntensity: 2.8,
};

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
    this.engineTrails = [];
    this._trailLastEnginePos = null;
    this._trailEnginePosReady = false;
    this.engineGlowT = 0;
    this.currentMoveSpeed = 0;
    this.idleOffset = new THREE.Vector3();
    this.idleTargetOffset = new THREE.Vector3();
    this.idleRetargetTimer = 0;
    this._physicsSlot =
      Math.abs(Math.floor(position.x * 31 + position.y * 17 + position.z * 7)) %
      3;
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
    this._createEngineTrails();
  }

  _createEngineTrails() {
    if (this.disposed || this.engineTrails.length > 0) return;
    const markerCount =
      this.engineMarkers.length > 0
        ? Math.min(2, this.engineMarkers.length)
        : 0;
    if (markerCount === 0) return;
    for (let i = 0; i < markerCount; i++) {
      this.engineTrails.push(new EngineTrail(this.scene, ALLY_ENGINE_TRAIL_OPTS));
    }
    this._trailLastEnginePos = this.engineTrails.map(() => new THREE.Vector3());
    this._trailEnginePosReady = false;
  }

  _updateEngineTrails(game) {
    const trails = this.engineTrails;
    if (!trails.length) return;

    const now = game.clock?.elapsedTime ?? performance.now() / 1000;
    for (let i = 0; i < trails.length; i++) {
      if (this.engineMarkers[i]) {
        this.engineMarkers[i].getWorldPosition(_enginePos);
      } else {
        _enginePos.copy(this.mesh.position);
      }

      const lastPos = this._trailLastEnginePos[i];
      if (!this._trailEnginePosReady) {
        lastPos.copy(_enginePos);
        trails[i].trackPosition(_enginePos, ENGINE_TRAIL_FIXED_STEP, now);
        continue;
      }

      trackEngineTrailSegment(trails[i], lastPos, _enginePos, now);
      lastPos.copy(_enginePos);
    }
    this._trailEnginePosReady = true;
  }

  _disposeEngineTrails() {
    for (const trail of this.engineTrails) trail.dispose();
    this.engineTrails.length = 0;
    this._trailLastEnginePos = null;
    this._trailEnginePosReady = false;
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

  _pickPathLeadCombatTarget(enemies, playerPos) {
    if (!this.pathRail) {
      this._pickTarget(enemies);
      return;
    }
    const playerAlong = closestDistanceOnPath(this.pathRail, playerPos);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy?.mesh?.visible || enemy.health <= 0) continue;
      const distSq = this.mesh.position.distanceToSquared(enemy.mesh.position);
      if (distSq > this.assistRangeSq) continue;
      const enemyAlong = closestDistanceOnPath(this.pathRail, enemy.mesh.position);
      if (enemyAlong < playerAlong - PATH_LEAD_COMBAT_DROP_BEHIND) continue;
      const dist = Math.sqrt(distSq);
      const aheadOfPlayer = enemyAlong - playerAlong;
      const score = aheadOfPlayer * 2 - dist * 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    this.target = best;
  }

  _clearPathLeadTargetIfPassed(playerPos) {
    if (!this.target?.mesh?.visible || this.target.health <= 0 || !this.pathRail) {
      return;
    }
    const playerAlong = closestDistanceOnPath(this.pathRail, playerPos);
    const enemyAlong = closestDistanceOnPath(
      this.pathRail,
      this.target.mesh.position,
    );
    if (enemyAlong < playerAlong - PATH_LEAD_COMBAT_DROP_BEHIND) {
      this.target = null;
    }
  }

  _enterPathRecovery() {
    if (!this.pathRail || this.pathRecovery) return;
    this.pathRecovery = true;
    this.pathAlong = closestDistanceOnPath(this.pathRail, this.mesh.position);
    this.velocity.set(0, 0, 0);
    this.pathVelocity = Math.max(this.pathVelocity, RAIL_CRUISE_SPEED);
    this.blockedMoveCount = 0;
  }

  _isSaturnaliaEscapeLeadActive() {
    if (!this.pathRail || !this.game) return false;
    if (this.game.gameManager?.getState?.()?.currentMissionId !== "saturnalia") {
      return false;
    }
    return (
      this.game._saturnaliaCollapseActive === true ||
      this.game.gameManager?.getState?.()?.saturnaliaCollapseActive === true
    );
  }

  _isEarthDefensePathLeadActive() {
    if (!this.pathRail || !this.game) return false;
    return (
      this.game.gameManager?.getState?.()?.currentMissionId ===
      "capital-ship-earth-defense"
    );
  }

  _getPlayerPathSpeedAlongRail(playerPos, retreat = false) {
    const player = this.game?.player;
    if (!player?.velocity || !this.pathRail) return 0;
    const playerAlong = closestDistanceOnPath(this.pathRail, playerPos);
    samplePath(this.pathRail, playerAlong, _railDesiredPos, _targetDir);
    const sign = retreat ? -1 : 1;
    return Math.max(0, sign * player.velocity.dot(_targetDir));
  }

  _getPlayerEscapeRetreatSpeed(playerPos) {
    return this._getPlayerPathSpeedAlongRail(playerPos, true);
  }

  _buildPathLeadAheadIntent(delta, playerPos) {
    const playerAlong = closestDistanceOnPath(this.pathRail, playerPos);
    if (!this.pathRecovery) this._enterPathRecovery();
    this.pathInfluence = THREE.MathUtils.damp(this.pathInfluence, 1, 2.8, delta);

    const playerAdvanceSpeed = this._getPlayerPathSpeedAlongRail(playerPos, false);
    const playerBoosting =
      this.game?.player?.isBoosting === true ||
      this.game?.player?.overboostActive === true;
    const maxSpeed = playerBoosting ? PATH_LEAD_BOOST_MAX_SPEED : PATH_LEAD_MAX_SPEED;
    const leadMargin =
      ESCAPE_LEAD_BOOST_LEAD_MARGIN * (playerBoosting ? 1.6 : 1);

    const targetAlong = Math.min(
      this.pathRail.total,
      playerAlong + PATH_LEAD_TARGET,
    );
    const leadGap = this.pathAlong - playerAlong;
    let targetSpeed = 0;
    if (leadGap > PATH_LEAD_MAX) {
      targetSpeed = 0;
    } else if (leadGap < PATH_LEAD_MIN) {
      targetSpeed = THREE.MathUtils.clamp(
        (PATH_LEAD_MIN - leadGap) * 1.35 + playerAdvanceSpeed,
        RAIL_CRUISE_SPEED,
        maxSpeed,
      );
    } else {
      targetSpeed = Math.max(
        RAIL_CRUISE_SPEED,
        playerAdvanceSpeed * 1.15 + leadMargin * 0.35,
      );
    }

    if (playerBoosting && leadGap <= PATH_LEAD_MAX) {
      targetSpeed = Math.max(
        targetSpeed,
        playerAdvanceSpeed * 1.35 + leadMargin,
      );
    }

    targetSpeed = Math.min(maxSpeed, targetSpeed);

    this.pathVelocity = accelerateToward(
      this.pathVelocity,
      targetSpeed,
      playerBoosting ? ESCAPE_LEAD_BOOST_ACCEL_RATE : RAIL_ACCEL_RATE,
      delta,
    );

    if (this.pathAlong < targetAlong) {
      this.pathAlong = Math.min(
        this.pathRail.total,
        this.pathAlong + this.pathVelocity * delta,
      );
    } else if (this.pathAlong > targetAlong) {
      this.pathAlong = Math.max(
        playerAlong,
        this.pathAlong - this.pathVelocity * 0.35 * delta,
      );
    }

    samplePath(this.pathRail, this.pathAlong, _railDesiredPos, _pathTangent);
    return {
      position: _railDesiredPos,
      tangent: _pathTangent,
      influence: this.pathInfluence,
    };
  }

  _buildEscapeLeadPathIntent(delta, playerPos) {
    const playerAlong = closestDistanceOnPath(this.pathRail, playerPos);
    if (!this.pathRecovery) this._enterPathRecovery();
    this.pathInfluence = THREE.MathUtils.damp(this.pathInfluence, 1, 2.8, delta);

    const playerRetreatSpeed = this._getPlayerEscapeRetreatSpeed(playerPos);
    const playerBoosting =
      this.game?.player?.isBoosting === true ||
      this.game?.player?.overboostActive === true;
    const maxSpeed = playerBoosting
      ? ESCAPE_LEAD_BOOST_MAX_SPEED
      : ESCAPE_LEAD_MAX_SPEED;
    const leadMargin =
      ESCAPE_LEAD_BOOST_LEAD_MARGIN * (playerBoosting ? 1.6 : 1);

    const retreatMin = 0;
    const retreatMax = Math.max(retreatMin, playerAlong - ESCAPE_LEAD_MIN);
    const targetAlong = THREE.MathUtils.clamp(
      playerAlong - ESCAPE_LEAD_TARGET,
      retreatMin,
      retreatMax,
    );

    const leadGap = playerAlong - this.pathAlong;
    let targetSpeed = 0;
    if (leadGap > ESCAPE_LEAD_MAX) {
      targetSpeed = 0;
    } else if (leadGap < ESCAPE_LEAD_MIN) {
      targetSpeed = THREE.MathUtils.clamp(
        (ESCAPE_LEAD_MIN - leadGap) * 1.35 + playerRetreatSpeed,
        RAIL_CRUISE_SPEED,
        maxSpeed,
      );
    } else {
      targetSpeed = Math.max(
        RAIL_CRUISE_SPEED,
        playerRetreatSpeed * 1.15 + leadMargin * 0.35,
      );
    }

    if (playerBoosting && leadGap <= ESCAPE_LEAD_MAX) {
      targetSpeed = Math.max(
        targetSpeed,
        playerRetreatSpeed * 1.35 + leadMargin,
      );
    }

    targetSpeed = Math.min(maxSpeed, targetSpeed);

    this.pathVelocity = accelerateToward(
      this.pathVelocity,
      targetSpeed,
      playerBoosting ? ESCAPE_LEAD_BOOST_ACCEL_RATE : RAIL_ACCEL_RATE,
      delta,
    );

    if (this.pathAlong > targetAlong) {
      this.pathAlong = Math.max(
        retreatMin,
        this.pathAlong - this.pathVelocity * delta,
      );
    } else if (this.pathAlong < targetAlong) {
      this.pathAlong = Math.min(
        retreatMax,
        this.pathAlong + this.pathVelocity * 0.35 * delta,
      );
    }

    samplePath(this.pathRail, this.pathAlong, _railDesiredPos, _pathTangent);
    _pathTangent.negate();
    return {
      position: _railDesiredPos,
      tangent: _pathTangent,
      influence: this.pathInfluence,
    };
  }

  _updatePathIntent(delta, playerPos, desiredPos) {
    if (!this.pathRail) return null;
    if (this._isSaturnaliaEscapeLeadActive()) {
      return this._buildEscapeLeadPathIntent(delta, playerPos);
    }
    if (this._isEarthDefensePathLeadActive()) {
      return this._buildPathLeadAheadIntent(delta, playerPos);
    }
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
    const pathLead =
      this._isSaturnaliaEscapeLeadActive() ||
      this._isEarthDefensePathLeadActive();
    const playerBoosting =
      pathLead &&
      (this.game?.player?.isBoosting === true ||
        this.game?.player?.overboostActive === true);
    let target = Math.min(1, this.currentMoveSpeed / Math.max(1, this.speed * 1.5));
    if (playerBoosting) target = Math.max(target, 0.92);
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
    const escapeLead = this._isSaturnaliaEscapeLeadActive();
    const earthPathLead = this._isEarthDefensePathLeadActive();
    const suppressCombat = escapeLead;
    if (!suppressCombat && this.targetScanTimer <= 0) {
      this.targetScanTimer = this.targetScanInterval;
      if (earthPathLead) {
        this._pickPathLeadCombatTarget(game.enemies, playerPos);
      } else {
        this._pickTarget(game.enemies);
      }
    }
    if (earthPathLead) {
      this._clearPathLeadTargetIfPassed(playerPos);
    }

    this._updateIdleOffset(delta);
    _localOffset
      .set(8 * this.formationSide, 3, -18)
      .add(this.idleOffset)
      .applyQuaternion(playerQuat);
    _desiredPos.copy(playerPos).add(_localOffset);

    if (
      !escapeLead &&
      !earthPathLead &&
      this.target?.mesh?.visible &&
      this.target.health > 0
    ) {
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

    this._updateEngineTrails(game);

    const aimTarget =
      !suppressCombat &&
      this.target?.mesh?.visible &&
      this.target.health > 0
        ? this.target.mesh.position
        : pathIntent?.tangent?.lengthSq?.() > 0.0001 &&
            pathIntent.influence > 0.35
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

    if (
      !suppressCombat &&
      this.target?.mesh?.visible &&
      this.target.health > 0
    ) {
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
  }

  dispose(scene = this.scene) {
    if (this.disposed) return;
    this.disposed = true;
    this._disposeEngineTrails();
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
