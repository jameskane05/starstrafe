import * as THREE from "three";

const BEAM_CORE_COLOR = 0xfff0aa;
const BEAM_ORANGE = 0xff7a18;
const BEAM_RED = 0xff1d00;

const ringGeometry = new THREE.TorusGeometry(0.75, 0.035, 6, 28);
const coreGeometry = new THREE.SphereGeometry(0.34, 16, 12);
const sparkGeometry = new THREE.SphereGeometry(0.055, 8, 6);
const beamCoreGeometry = new THREE.CylinderGeometry(0.34, 0.42, 1, 12, 1, true);
beamCoreGeometry.rotateX(Math.PI / 2);
const beamOuterGeometry = new THREE.CylinderGeometry(0.78, 1.05, 1, 16, 1, true);
beamOuterGeometry.rotateX(Math.PI / 2);

const chargeRingMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(BEAM_ORANGE).multiplyScalar(3.6),
  transparent: true,
  opacity: 0.78,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const chargeCoreMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(BEAM_CORE_COLOR).multiplyScalar(4.2),
  transparent: true,
  opacity: 0.86,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const chargeSparkMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(BEAM_RED).multiplyScalar(3.4),
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const beamCoreMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(BEAM_CORE_COLOR).multiplyScalar(5.2),
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const beamOuterMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(BEAM_ORANGE).multiplyScalar(3.8),
  transparent: true,
  opacity: 0.48,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});

const _center = new THREE.Vector3();
const _forward = new THREE.Vector3(0, 0, 1);
const _beamForward = new THREE.Vector3(0, 0, -1);
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export class ChargingLaserBeam {
  constructor(scene) {
    this.scene = scene;
    this.elapsed = 0;
    this.duration = 1;
    this.disposed = false;

    this.group = new THREE.Group();
    this.chargeGroup = new THREE.Group();
    this.beamGroup = new THREE.Group();
    this.group.add(this.chargeGroup, this.beamGroup);
    this.materials = {
      chargeRing: chargeRingMaterial.clone(),
      chargeCore: chargeCoreMaterial.clone(),
      chargeSpark: chargeSparkMaterial.clone(),
      beamCore: beamCoreMaterial.clone(),
      beamOuter: beamOuterMaterial.clone(),
    };

    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(ringGeometry, this.materials.chargeRing);
      ring.rotation.x = Math.PI / 2;
      ring.scale.setScalar(0.45 + i * 0.26);
      this.chargeGroup.add(ring);
      this.rings.push(ring);
    }

    this.core = new THREE.Mesh(coreGeometry, this.materials.chargeCore);
    this.chargeGroup.add(this.core);

    this.sparks = [];
    for (let i = 0; i < 12; i++) {
      const spark = new THREE.Mesh(sparkGeometry, this.materials.chargeSpark);
      this.chargeGroup.add(spark);
      this.sparks.push(spark);
    }

    this.beamCore = new THREE.Mesh(beamCoreGeometry, this.materials.beamCore);
    this.beamOuter = new THREE.Mesh(beamOuterGeometry, this.materials.beamOuter);
    this.beamGroup.add(this.beamOuter, this.beamCore);
    this.beamGroup.visible = false;
    this.chargeGroup.visible = false;
    scene.add(this.group);
  }

  updateCharge(origin, direction, progress, time) {
    const t = THREE.MathUtils.clamp(progress, 0, 1);
    _center.copy(origin).addScaledVector(direction, 4.5);
    this.group.position.copy(_center);
    this.group.quaternion.setFromUnitVectors(_forward, direction);
    this.chargeGroup.visible = true;
    this.beamGroup.visible = false;

    const pulse = 0.78 + Math.sin(time * 24) * 0.08 + t * 0.58;
    this.core.scale.setScalar(pulse);
    this.core.material.opacity = 0.28 + t * 0.68;

    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      ring.rotation.z += 0.05 + t * 0.16 + i * 0.025;
      const s = (0.55 + i * 0.26) * (1.25 - t * 0.5);
      ring.scale.setScalar(Math.max(0.12, s));
      ring.material.opacity = 0.22 + t * 0.42;
    }

    _right.set(1, 0, 0).applyQuaternion(this.group.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.group.quaternion);
    for (let i = 0; i < this.sparks.length; i++) {
      const a = time * (3.4 + i * 0.13) + i * 2.399;
      const r = (1.25 - t * 0.75) * (0.7 + (i % 3) * 0.22);
      const z = -0.35 + ((i % 4) / 3) * 0.7;
      this.sparks[i].position
        .set(0, 0, z)
        .addScaledVector(_right, Math.cos(a) * r)
        .addScaledVector(_up, Math.sin(a * 1.13) * r);
      this.sparks[i].scale.setScalar(0.6 + t * 1.6);
      this.sparks[i].material.opacity = 0.18 + t * 0.65;
    }
  }

  fire(origin, direction, length) {
    const beamLength = Math.max(4, length);
    _center.copy(origin).addScaledVector(direction, beamLength * 0.5);
    this.group.position.copy(_center);
    this.group.quaternion.setFromUnitVectors(_beamForward, direction);
    this.beamCore.scale.set(1, 1, beamLength);
    this.beamOuter.scale.set(1, 1, beamLength);
    this.beamCore.material.opacity = 0.95;
    this.beamOuter.material.opacity = 0.48;
    this.elapsed = 0;
    this.chargeGroup.visible = false;
    this.beamGroup.visible = true;
  }

  update(delta) {
    if (this.disposed || !this.beamGroup.visible) return false;
    this.elapsed += delta;
    const t = this.elapsed / this.duration;
    if (t >= 1) {
      this.dispose();
      return false;
    }
    const flicker = 0.86 + Math.random() * 0.24;
    this.beamCore.material.opacity = 0.95 * (1 - t * 0.7) * flicker;
    this.beamOuter.material.opacity = 0.48 * (1 - t) * flicker;
    const radiusPulse = 1 + Math.sin(this.elapsed * 54) * 0.08;
    this.beamCore.scale.x = radiusPulse;
    this.beamCore.scale.y = radiusPulse;
    this.beamOuter.scale.x = 1.0 + Math.sin(this.elapsed * 32) * 0.12;
    this.beamOuter.scale.y = 1.0 + Math.cos(this.elapsed * 29) * 0.12;
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const material of Object.values(this.materials)) {
      material.dispose();
    }
    this.scene.remove(this.group);
  }
}
