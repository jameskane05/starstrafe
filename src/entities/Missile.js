import * as THREE from "three";
import { checkSphereCollision } from "../physics/Physics.js";

const missileGeometry = new THREE.CylinderGeometry(0.08, 0.04, 0.6, 8);
missileGeometry.rotateX(Math.PI / 2);

const missileMaterial = new THREE.MeshStandardMaterial({
  color: 0xff4400,
  emissive: 0xff4400,
  emissiveIntensity: 4,
  transparent: true,
  opacity: 0.95,
});

const trailGeometry = new THREE.CylinderGeometry(0.02, 0.06, 0.4, 6);
trailGeometry.rotateX(Math.PI / 2);
trailGeometry.translate(0, 0, 0.5);

const trailMaterial = new THREE.MeshStandardMaterial({
  color: 0xffaa00,
  emissive: 0xffaa00,
  emissiveIntensity: 6,
  transparent: true,
  opacity: 0.7,
});

const _forward = new THREE.Vector3(0, 0, 1);
const _tempVec = new THREE.Vector3();
const _exhaustOffset = new THREE.Vector3();

export class Missile {
  constructor(scene, position, direction, options = {}) {
    this.direction = direction.clone().normalize();
    this.speed = 20;
    this.lifetime = 5;
    this.disposed = false;
    this.damage = 50;
    this.explosionRadius = 3;
    this.collisionRadius = 0.15;

    this.homingConeAngle = Math.cos(Math.PI / 6);
    this.homingRange = 40;
    this.homingStrength = 3;
    this.target = null;
    this.particles = options.particles || null;
    this.spawnTimer = 0;
    this.spawnRate = 0.02;

    this.group = new THREE.Group();
    this.group.position.copy(position);

    this.mesh = new THREE.Mesh(missileGeometry, missileMaterial);
    this.group.add(this.mesh);

    this.trail = new THREE.Mesh(trailGeometry, trailMaterial);
    this.group.add(this.trail);

    this.group.quaternion.setFromUnitVectors(_forward, this.direction);

    scene.add(this.group);
    this.scene = scene;
    this.prevPosition = position.clone();
  }

  update(delta, enemies = []) {
    this.lifetime -= delta;
    this.prevPosition.copy(this.group.position);

    this.target = this.findTarget(enemies);

    if (this.target) {
      _tempVec
        .subVectors(this.target.mesh.position, this.group.position)
        .normalize();
      this.direction.lerp(_tempVec, this.homingStrength * delta);
      this.direction.normalize();
      this.group.quaternion.setFromUnitVectors(_forward, this.direction);
    }

    _tempVec.copy(this.direction).multiplyScalar(this.speed * delta);
    this.group.position.add(_tempVec);

    this.trail.material.opacity = 0.6 + Math.random() * 0.25;

    if (this.particles) {
      this.spawnTimer += delta;
      while (this.spawnTimer >= this.spawnRate) {
        this.spawnTimer -= this.spawnRate;
        this.particles.emitMissileExhaust(
          this.group.position,
          this.group.quaternion,
          this.direction
        );
      }
    }
  }

  findTarget(targets) {
    let closest = null;
    let closestDist = this.homingRange;

    for (const target of targets) {
      // Handle both Enemy objects (mesh.position) and RemotePlayer objects (mesh.position)
      const targetPos = target.mesh?.position;
      if (!targetPos) continue;
      
      // Skip dead targets
      if (target.alive === false || target.health <= 0) continue;

      _tempVec.subVectors(targetPos, this.group.position);
      const dist = _tempVec.length();

      if (dist > this.homingRange) continue;

      _tempVec.normalize();
      const dot = this.direction.dot(_tempVec);

      if (dot >= this.homingConeAngle && dist < closestDist) {
        closest = target;
        closestDist = dist;
      }
    }

    return closest;
  }

  checkWallCollision() {
    if (this.disposed) return false;

    return checkSphereCollision(
      this.group.position.x,
      this.group.position.y,
      this.group.position.z,
      this.collisionRadius
    );
  }

  getPosition() {
    return this.group.position;
  }

  dispose(scene) {
    if (this.disposed) return;
    this.disposed = true;
    scene.remove(this.group);
  }
}
