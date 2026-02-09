import * as THREE from "three";

const playerGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6);
playerGeometry.rotateX(Math.PI / 2);

const enemyGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6);
enemyGeometry.rotateX(Math.PI / 2);

const playerMaterial = new THREE.MeshBasicMaterial({
  color: 0x00ffff,
  transparent: true,
  opacity: 1.0,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
});

const enemyMaterial = new THREE.MeshBasicMaterial({
  color: 0xff8800,
  transparent: true,
  opacity: 1.0,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
});

const _forward = new THREE.Vector3(0, 0, 1);
const _tempVec = new THREE.Vector3();

export class Projectile {
  constructor(scene, position, direction, isPlayerOwned, speed = null) {
    this.scene = scene;
    this.direction = direction.clone();
    if (this.direction.lengthSq() > 0.0001) {
      this.direction.normalize();
    } else {
      this.direction.set(0, 0, -1);
    }
    this.speed = speed !== null ? speed : (isPlayerOwned ? 200 : 15);
    this.isPlayerOwned = isPlayerOwned;
    this.lifetime = 3;
    this.disposed = false;
    this.prevPosition = position.clone();
    
    const geometry = isPlayerOwned ? playerGeometry : enemyGeometry;
    const material = isPlayerOwned ? playerMaterial : enemyMaterial;
    
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.quaternion.setFromUnitVectors(_forward, this.direction);
    // Occlusion handled by physics mesh depth buffer
    
    scene.add(this.mesh);
    console.log("[Projectile] Created at", position.x.toFixed(1), position.y.toFixed(1), position.z.toFixed(1), "dir:", this.direction.x.toFixed(2), this.direction.y.toFixed(2), this.direction.z.toFixed(2), "speed:", this.speed);
  }

  update(delta) {
    this.lifetime -= delta;
    this.prevPosition.copy(this.mesh.position);
    _tempVec.copy(this.direction).multiplyScalar(this.speed * delta);
    this.mesh.position.add(_tempVec);
  }

  dispose(scene) {
    if (this.disposed) return;
    this.disposed = true;
    scene.remove(this.mesh);
  }
}
