import * as THREE from 'three';

const impactGeometry = new THREE.CircleGeometry(0.3, 12);
const noiseTexture = createNoiseTexture();

function createNoiseTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const cx = size / 2;
    const cy = size / 2;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (size / 2);
    
    const noise = Math.random();
    const radial = 1 - Math.pow(dist, 0.5);
    const alpha = radial * (0.5 + noise * 0.5);
    
    const idx = i * 4;
    data[idx] = 255;
    data[idx + 1] = 255;
    data[idx + 2] = 255;
    data[idx + 3] = Math.max(0, Math.min(255, alpha * 255));
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const _up = new THREE.Vector3(0, 1, 0);
const _tempVec = new THREE.Vector3();

export class LaserImpact {
  constructor(scene, position, normal, color = 0x00ffff, lightPool = null) {
    this.scene = scene;
    this.elapsed = 0;
    this.duration = 0.4;
    this.disposed = false;
    
    const material = new THREE.MeshBasicMaterial({
      color,
      map: noiseTexture,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    
    this.mesh = new THREE.Mesh(impactGeometry, material);
    this.mesh.position.copy(position);
    
    _tempVec.copy(normal);
    if (Math.abs(_tempVec.y) > 0.99) {
      this.mesh.quaternion.setFromUnitVectors(_up, _tempVec);
    } else {
      this.mesh.lookAt(_tempVec.add(position));
    }
    
    this.mesh.position.addScaledVector(normal, 0.02);

    if (lightPool) {
      lightPool.flash(this.mesh.position, color, {
        intensity: 10,
        distance: 14,
        ttl: 0.06,
        fade: 0.12,
      });
    }
    
    scene.add(this.mesh);
  }
  
  update(delta) {
    if (this.disposed) return false;
    
    this.elapsed += delta;
    const t = this.elapsed / this.duration;
    
    if (t >= 1) {
      this.dispose();
      return false;
    }
    
    const scale = 1 + t * 1.5;
    this.mesh.scale.setScalar(scale);
    this.mesh.material.opacity = 0.9 * (1 - t);
    
    return true;
  }
  
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    
    this.mesh.material.dispose();
    this.scene.remove(this.mesh);
  }
}

