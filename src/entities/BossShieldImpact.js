/**
 * BossShieldImpact.js - BOSS SHIELD BLOCK RIPPLE
 * Transient blue circular ripple when a charged shot hits the boss shield.
 */

import * as THREE from "three";

const shieldGeometry = new THREE.CircleGeometry(1, 40);
const shieldTexture = createShieldRippleTexture();

function createShieldRippleTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const cx = size * 0.5;
  const cy = size * 0.5;
  const maxR = size * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxR;
      const ring =
        Math.exp(-Math.pow((dist - 0.42) / 0.08, 2)) * 0.95 +
        Math.exp(-Math.pow((dist - 0.28) / 0.05, 2)) * 0.35;
      const inner = Math.max(0, 1 - dist / 0.22) * 0.25;
      const outerFade = Math.max(0, 1 - Math.pow(dist, 1.6));
      const alpha = Math.min(1, (ring + inner) * outerFade);
      const idx = (y * size + x) * 4;
      data[idx] = 90;
      data[idx + 1] = 170;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const _up = new THREE.Vector3(0, 1, 0);
const _tempVec = new THREE.Vector3();

export class BossShieldImpact {
  constructor(scene, position, normal, lightPool = null) {
    this.scene = scene;
    this.elapsed = 0;
    this.duration = 0.52;
    this.disposed = false;

    const material = new THREE.MeshBasicMaterial({
      color: 0x66bbff,
      map: shieldTexture,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(shieldGeometry, material);
    this.mesh.position.copy(position);

    _tempVec.copy(normal);
    if (Math.abs(_tempVec.y) > 0.99) {
      this.mesh.quaternion.setFromUnitVectors(_up, _tempVec);
    } else {
      this.mesh.lookAt(_tempVec.add(position));
    }
    this.mesh.position.addScaledVector(normal, 0.35);
    this.mesh.renderOrder = 2;

    if (lightPool) {
      lightPool.flash(this.mesh.position, 0x48a8ff, {
        intensity: 28,
        distance: 36,
        ttl: 0.05,
        fade: 0.18,
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

    const envelope = Math.sin(t * Math.PI);
    this.mesh.material.opacity = envelope * 0.88;
    this.mesh.scale.setScalar(5.5 + t * 11.5);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.material.dispose();
    this.scene.remove(this.mesh);
  }
}
