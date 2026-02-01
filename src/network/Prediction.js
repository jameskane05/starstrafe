import * as THREE from "three";

export class Prediction {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.reconciliationThreshold = options.reconciliationThreshold || 0.5;
    this.smoothCorrection = options.smoothCorrection !== false;
    this.correctionSpeed = options.correctionSpeed || 10;
    
    this.predictedPosition = new THREE.Vector3();
    this.predictedRotation = new THREE.Quaternion();
    this.serverPosition = new THREE.Vector3();
    this.serverRotation = new THREE.Quaternion();
    
    this.correctionOffset = new THREE.Vector3();
    this.isReconciling = false;
  }

  applyServerState(position, rotation, lastProcessedInput) {
    this.serverPosition.set(position.x, position.y, position.z);
    this.serverRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    
    return lastProcessedInput;
  }

  checkReconciliation(localPosition, localRotation) {
    if (!this.enabled) return { needsReconciliation: false };
    
    const positionDelta = localPosition.distanceTo(this.serverPosition);
    
    if (positionDelta > this.reconciliationThreshold) {
      this.isReconciling = true;
      this.correctionOffset.subVectors(this.serverPosition, localPosition);
      
      return {
        needsReconciliation: true,
        serverPosition: this.serverPosition.clone(),
        serverRotation: this.serverRotation.clone(),
        delta: positionDelta,
      };
    }
    
    return { needsReconciliation: false };
  }

  applySmoothCorrection(position, delta) {
    if (!this.smoothCorrection || !this.isReconciling) return;
    
    const correctionStep = this.correctionSpeed * delta;
    const correctionMagnitude = this.correctionOffset.length();
    
    if (correctionMagnitude < 0.01) {
      this.isReconciling = false;
      this.correctionOffset.set(0, 0, 0);
      return;
    }
    
    const step = Math.min(correctionStep, correctionMagnitude);
    const correction = this.correctionOffset.clone().normalize().multiplyScalar(step);
    
    position.add(correction);
    this.correctionOffset.sub(correction);
  }

  snapToServer(position, rotation) {
    position.copy(this.serverPosition);
    rotation.copy(this.serverRotation);
    this.isReconciling = false;
    this.correctionOffset.set(0, 0, 0);
  }
}
