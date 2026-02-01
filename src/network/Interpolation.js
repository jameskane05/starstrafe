import * as THREE from "three";

export class Interpolation {
  constructor(options = {}) {
    this.bufferSize = options.bufferSize || 3;
    this.interpolationDelay = options.interpolationDelay || 100; // ms
    
    this.positionBuffer = [];
    this.rotationBuffer = [];
    
    this.currentPosition = new THREE.Vector3();
    this.currentRotation = new THREE.Quaternion();
    this.targetPosition = new THREE.Vector3();
    this.targetRotation = new THREE.Quaternion();
  }

  pushState(position, rotation, timestamp = Date.now()) {
    this.positionBuffer.push({
      position: new THREE.Vector3(position.x, position.y, position.z),
      rotation: new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      timestamp,
    });

    while (this.positionBuffer.length > this.bufferSize) {
      this.positionBuffer.shift();
    }
  }

  getInterpolatedState(renderTime = Date.now() - this.interpolationDelay) {
    if (this.positionBuffer.length === 0) {
      return {
        position: this.currentPosition,
        rotation: this.currentRotation,
      };
    }

    if (this.positionBuffer.length === 1) {
      const state = this.positionBuffer[0];
      this.currentPosition.copy(state.position);
      this.currentRotation.copy(state.rotation);
      return {
        position: this.currentPosition,
        rotation: this.currentRotation,
      };
    }

    let older = null;
    let newer = null;

    for (let i = 0; i < this.positionBuffer.length - 1; i++) {
      if (this.positionBuffer[i].timestamp <= renderTime && 
          this.positionBuffer[i + 1].timestamp >= renderTime) {
        older = this.positionBuffer[i];
        newer = this.positionBuffer[i + 1];
        break;
      }
    }

    if (!older || !newer) {
      const latest = this.positionBuffer[this.positionBuffer.length - 1];
      this.currentPosition.copy(latest.position);
      this.currentRotation.copy(latest.rotation);
      return {
        position: this.currentPosition,
        rotation: this.currentRotation,
      };
    }

    const duration = newer.timestamp - older.timestamp;
    const t = duration > 0 ? (renderTime - older.timestamp) / duration : 0;
    const clampedT = Math.max(0, Math.min(1, t));

    this.currentPosition.lerpVectors(older.position, newer.position, clampedT);
    this.currentRotation.slerpQuaternions(older.rotation, newer.rotation, clampedT);

    return {
      position: this.currentPosition,
      rotation: this.currentRotation,
    };
  }

  reset() {
    this.positionBuffer = [];
    this.currentPosition.set(0, 0, 0);
    this.currentRotation.identity();
  }
}
