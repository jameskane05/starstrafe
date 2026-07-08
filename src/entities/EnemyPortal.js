import * as THREE from "three";
import sfxManager from "../audio/sfxManager.js";

const PORTAL_RADIUS = 6;
const PORTAL_TUBE = 0.28;
const PORTAL_OPEN_DURATION = 0.7;
const PORTAL_COLLAPSE_DURATION = 0.45;
const PORTAL_COLLAPSE_BURST = 18;
const SUMMON_INTERVAL = 6;
const MAX_SUMMONED_ALIVE = 4;

const _tmpPos = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpTangent = new THREE.Vector3();
const _tmpBitangent = new THREE.Vector3();
const _color = new THREE.Color(0x8affff);

// Portal geometries are identical for every portal — build once and share so
// each summon has no geometry-construction / GPU-upload cost.
const PORTAL_RING_GEO = new THREE.TorusGeometry(PORTAL_RADIUS, PORTAL_TUBE, 16, 72);
const PORTAL_ARC_GEO = new THREE.TorusGeometry(
  PORTAL_RADIUS * 1.08,
  PORTAL_TUBE * 0.45,
  10,
  42,
  Math.PI * 1.12,
);
const PORTAL_DISC_GEO = new THREE.CircleGeometry(PORTAL_RADIUS * 0.88, 96);
const PORTAL_CORE_GEO = new THREE.TorusGeometry(
  PORTAL_RADIUS * 0.48,
  PORTAL_TUBE * 0.22,
  8,
  48,
);
const SHARED_PORTAL_GEOMETRIES = new Set([
  PORTAL_RING_GEO,
  PORTAL_ARC_GEO,
  PORTAL_DISC_GEO,
  PORTAL_CORE_GEO,
]);

const SHARED_PORTAL_RING_MAT = new THREE.MeshStandardMaterial({
  color: 0x162033,
  emissive: 0x43d8ff,
  emissiveIntensity: 1.6,
  metalness: 0.2,
  roughness: 0.3,
  transparent: true,
  opacity: 0.92,
  toneMapped: false,
});
const SHARED_PORTAL_ARC_MAT = new THREE.MeshStandardMaterial({
  color: 0xb64dff,
  emissive: 0x8a4dff,
  emissiveIntensity: 1.8,
  metalness: 0.1,
  roughness: 0.25,
  transparent: true,
  opacity: 0.9,
  toneMapped: false,
});
const SHARED_PORTAL_CORE_MAT = new THREE.MeshBasicMaterial({
  color: 0x8affff,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const SHARED_PORTAL_MATERIALS = new Set([
  SHARED_PORTAL_RING_MAT,
  SHARED_PORTAL_ARC_MAT,
]);

let sharedSwirlMaterial = null;

function createSwirlMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.75 },
      uColorA: { value: new THREE.Color(0x43d8ff) },
      uColorB: { value: new THREE.Color(0xb64dff) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;

        float angle = atan(p.y, p.x);
        float spiral = sin(angle * 5.0 - r * 17.0 + uTime * 5.4);
        float rings = sin(r * 28.0 - uTime * 6.0);
        float core = smoothstep(1.0, 0.08, r);
        float rim = smoothstep(0.95, 0.48, r) * smoothstep(0.15, 0.55, r);
        float alpha = (0.28 + spiral * 0.18 + rings * 0.08) * rim + core * 0.42;
        vec3 color = mix(uColorA, uColorB, 0.5 + 0.5 * spiral);
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0) * uOpacity);
      }
    `,
  });
}

function getSwirlMaterial() {
  if (!sharedSwirlMaterial) sharedSwirlMaterial = createSwirlMaterial();
  return sharedSwirlMaterial;
}

function allocSwirlMaterial() {
  return getSwirlMaterial().clone();
}

function allocCoreMaterial() {
  return SHARED_PORTAL_CORE_MAT.clone();
}

function disposeObject(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (!SHARED_PORTAL_GEOMETRIES.has(child.geometry)) {
      child.geometry?.dispose?.();
    }
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (
        SHARED_PORTAL_MATERIALS.has(material) ||
        material === sharedSwirlMaterial
      ) {
        continue;
      }
      material?.dispose?.();
    }
  });
}

/**
 * Compile the portal swirl shader + standard materials once, offscreen, so the
 * first portal a boss opens mid-fight doesn't hitch. Safe to call repeatedly.
 */
export function prewarmEnemyPortalVisuals(game) {
  if (game._enemyPortalPrewarmed) return;
  if (!game?.renderer || !game?.scene || !game?.camera) return;
  game._enemyPortalPrewarmed = true;

  const group = new THREE.Group();
  group.position.set(0, -100000, 0);
  group.add(new THREE.Mesh(PORTAL_RING_GEO, SHARED_PORTAL_RING_MAT));
  group.add(new THREE.Mesh(PORTAL_DISC_GEO, getSwirlMaterial()));
  group.add(new THREE.Mesh(PORTAL_CORE_GEO, allocCoreMaterial()));
  game.scene.add(group);
  try {
    game.renderer.compile(game.scene, game.camera);
  } catch (e) {
    console.warn("[EnemyPortal] prewarm compile failed:", e);
  }
  game.scene.remove(group);
}

export class EnemyPortal {
  constructor(game, position, ownerEnemy, options = {}) {
    this.game = game;
    this.position = position.clone();
    this.ownerEnemy = ownerEnemy;
    this.spawnEnemy = options.spawnEnemy ?? null;
    this.summonInterval = options.summonInterval ?? SUMMON_INTERVAL;
    this.maxSummonedAlive = options.maxSummonedAlive ?? MAX_SUMMONED_ALIVE;
    this.summonTimer = this.summonInterval * 0.65;
    this.age = 0;
    this.state = "opening";
    this.collapseTimer = 0;
    this.disposed = false;
    this.summoned = [];
    this.particleTimer = 0;

    this.group = this._createVisuals();
    this.group.position.copy(this.position);
    this.group.scale.setScalar(0.01);
    this.game.scene.add(this.group);

    this.light = new THREE.PointLight(0x58d8ff, 0, 36, 2);
    this.light.position.copy(this.position);
    this.game.scene.add(this.light);
    this.game.dynamicLights?.flash(this.position, 0x58d8ff, {
      intensity: 70,
      distance: 55,
      ttl: 0.28,
      fade: 0.5,
    });
  }

  _createVisuals() {
    const group = new THREE.Group();
    group.name = "EnemyPortal";

    const ring = new THREE.Mesh(PORTAL_RING_GEO, SHARED_PORTAL_RING_MAT);
    group.add(ring);

    const arcPivotA = new THREE.Group();
    const arcA = new THREE.Mesh(PORTAL_ARC_GEO, SHARED_PORTAL_ARC_MAT);
    arcA.rotation.z = 0.25;
    arcPivotA.add(arcA);
    group.add(arcPivotA);

    const arcPivotB = new THREE.Group();
    const arcB = new THREE.Mesh(PORTAL_ARC_GEO, SHARED_PORTAL_ARC_MAT);
    arcB.rotation.z = Math.PI + 0.95;
    arcB.rotation.y = Math.PI;
    arcPivotB.add(arcB);
    group.add(arcPivotB);

    const disc = new THREE.Mesh(PORTAL_DISC_GEO, allocSwirlMaterial());
    disc.renderOrder = 80;
    group.add(disc);

    const core = new THREE.Mesh(PORTAL_CORE_GEO, allocCoreMaterial());
    group.add(core);

    group.userData.ring = ring;
    group.userData.arcPivotA = arcPivotA;
    group.userData.arcPivotB = arcPivotB;
    group.userData.disc = disc;
    group.userData.core = core;
    return group;
  }

  update(delta) {
    if (this.disposed) return false;
    this.age += delta;

    if (this.game.camera) {
      this.group.lookAt(this.game.camera.position);
    }

    const openT = Math.min(1, this.age / PORTAL_OPEN_DURATION);
    let scale = THREE.MathUtils.smootherstep(openT, 0, 1);
    if (this.state === "collapsing") {
      this.collapseTimer += delta;
      const collapseT = Math.min(1, this.collapseTimer / PORTAL_COLLAPSE_DURATION);
      scale = 1 - THREE.MathUtils.smootherstep(collapseT, 0, 1);
      if (collapseT >= 1) {
        this.dispose();
        return false;
      }
    } else if (openT >= 1) {
      this.state = "open";
    }

    this.group.scale.setScalar(Math.max(0.01, scale));
    this._updateVisuals(delta, scale);
    this._emitVortexParticles(delta);

    if (this.state === "open" && !this.game.isMultiplayer) {
      this._updateSummoning(delta);
    }

    return true;
  }

  _updateVisuals(delta, scale) {
    const { arcPivotA, arcPivotB, disc, core } = this.group.userData;
    arcPivotA.rotation.z += delta * 1.35;
    arcPivotB.rotation.z -= delta * 1.9;
    core.rotation.z -= delta * 2.4;
    disc.material.uniforms.uTime.value = this.age;
    disc.material.uniforms.uOpacity.value =
      scale * (0.55 + Math.sin(this.age * 5.5) * 0.12);
    const pulse = 0.75 + Math.sin(this.age * 6.0) * 0.25;
    core.material.opacity = scale * (0.2 + pulse * 0.22);
    this.light.intensity = scale * (7 + pulse * 5);
    this.light.position.copy(this.position);
  }

  _updateSummoning(delta) {
    this._pruneSummoned();
    if (this.summoned.length >= this.maxSummonedAlive) return;

    this.summonTimer -= delta;
    if (this.summonTimer > 0) return;
    this.summonTimer = this.summonInterval;
    this._summonEnemy();
  }

  _summonEnemy() {
    if (!this.spawnEnemy) return;
    const spawnPos = this.getSpawnPosition();
    const enemy = this.spawnEnemy(spawnPos, {
      summoned: true,
      cloneMaterials: false,
    });
    if (enemy) this.summoned.push(enemy);
    this._emitBurst(spawnPos, 36);
    this.game.dynamicLights?.flash(spawnPos, 0x8a4dff, {
      intensity: 85,
      distance: 60,
      ttl: 0.22,
      fade: 0.45,
    });
    sfxManager.play("engine-boost", spawnPos, 0.65);
  }

  getSpawnPosition() {
    _tmpDir.set(0, 0, 1).applyQuaternion(this.group.quaternion).normalize();
    return _tmpPos
      .copy(this.position)
      .addScaledVector(_tmpDir, 2.5)
      .addScaledVector(_tmpDir, Math.random() * 2)
      .add(new THREE.Vector3(
        (Math.random() - 0.5) * 2.5,
        (Math.random() - 0.5) * 2.0,
        (Math.random() - 0.5) * 2.5,
      ))
      .clone();
  }

  _pruneSummoned() {
    const enemies = this.game.enemies ?? [];
    this.summoned = this.summoned.filter(
      (enemy) =>
        enemy &&
        !enemy.disposed &&
        enemy.health > 0 &&
        enemies.includes(enemy),
    );
  }

  _emitVortexParticles(delta) {
    const particles = this.game.particles;
    if (!particles) return;
    this.particleTimer += delta;
    const interval = 1 / 24;
    while (this.particleTimer >= interval) {
      this.particleTimer -= interval;
      const theta = Math.random() * Math.PI * 2;
      const radius = PORTAL_RADIUS * (0.65 + Math.random() * 0.28);
      this._emitVortexParticle(theta, radius);
    }
  }

  _emitVortexParticle(theta, radius) {
    const normal = _tmpDir
      .set(0, 0, 1)
      .applyQuaternion(this.group.quaternion)
      .normalize();
    _tmpTangent.set(1, 0, 0).applyQuaternion(this.group.quaternion).normalize();
    _tmpBitangent.set(0, 1, 0).applyQuaternion(this.group.quaternion).normalize();

    const radialX = Math.cos(theta);
    const radialY = Math.sin(theta);
    const pos = _tmpPos
      .copy(this.position)
      .addScaledVector(_tmpTangent, radialX * radius)
      .addScaledVector(_tmpBitangent, radialY * radius);
    const swirl = _tmpTangent
      .clone()
      .multiplyScalar(-radialY)
      .addScaledVector(_tmpBitangent, radialX)
      .multiplyScalar(10 + Math.random() * 6)
      .addScaledVector(normal, (Math.random() - 0.5) * 2);
    const inward = _tmpTangent
      .clone()
      .multiplyScalar(-radialX * 2.5)
      .addScaledVector(_tmpBitangent, -radialY * 2.5);
    swirl.add(inward);

    this.game.particles.lineSparks?.emit({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      vx: swirl.x,
      vy: swirl.y,
      vz: swirl.z,
      r: 0.45,
      g: 0.85,
      b: 1.0,
      alpha: 0.9,
      life: 0.22 + Math.random() * 0.24,
      drag: 0.9,
      rise: 0,
      trailLength: 0.35 + Math.random() * 0.35,
    });

    if (Math.random() < 0.2) {
      this.game.particles.sparks?.emit({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: swirl.x * 0.35,
        vy: swirl.y * 0.35,
        vz: swirl.z * 0.35,
        r: 0.7,
        g: 0.45,
        b: 1.0,
        alpha: 0.75,
        size: 8 + Math.random() * 8,
        life: 0.25 + Math.random() * 0.25,
        drag: 0.92,
        rise: 0,
      });
    }
  }

  _emitBurst(position, count) {
    _color.setHex(0x8a4dff);
    this.game.explosionEffect?.emitExplosionParticles(
      position,
      { r: _color.r, g: _color.g, b: _color.b },
      count,
    );
    this.game.sparksEffect?.emitElectricalSparks(
      position,
      _tmpDir.set(0, 0, 1).applyQuaternion(this.group.quaternion),
      Math.max(4, Math.floor(count * 0.35)),
      0x8affff,
    );
  }

  onOwnerDestroyed() {
    if (this.disposed || this.state === "collapsing") return;
    this.state = "collapsing";
    this.collapseTimer = 0;
    this._emitBurst(this.position, PORTAL_COLLAPSE_BURST);
    this.game.dynamicLights?.flash(this.position, 0xb64dff, {
      intensity: 95,
      distance: 65,
      ttl: 0.24,
      fade: 0.5,
    });
    sfxManager.play("engine-boost", this.position, 0.8);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ownerEnemy?.portal === this) this.ownerEnemy.portal = null;
    this.ownerEnemy = null;
    this.group.parent?.remove(this.group);
    disposeObject(this.group);
    this.light.parent?.remove(this.light);
    this.light.dispose?.();
    this.summoned.length = 0;
  }
}
