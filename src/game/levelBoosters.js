import * as THREE from "three";
import { applyCharonEscapeShakeStartFrame } from "./charonEscapeSequence.js";
import sfxManager from "../audio/sfxManager.js";

const BOOSTER_RADIUS = 5.5;
const BOOSTER_TUBE = 0.38;
const BOOSTER_TRIGGER_RADIUS = 7;
const BOOST_RECHARGE_DURATION = 1;
const OVERBOOST_DURATION = 5;
const OVERBOOST_MULTIPLIER = 1.08;
const BOOST_GATE_FEEDBACK_DURATION = 1.5;
const BOOST_GATE_BLUR_MULTIPLIER = 1.2;

const _forward = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _boosterWobbleAxis = new THREE.Vector3(0, 0, 1);
const _boosterWobbleQuat = new THREE.Quaternion();

function createBoosterVisual(position, quaternion = null) {
  const group = new THREE.Group();
  group.name = "LevelBoostGate";
  group.position.copy(position);
  if (quaternion) group.quaternion.copy(quaternion);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x102430,
    emissive: 0x00d8ff,
    emissiveIntensity: 1.2,
    metalness: 0.25,
    roughness: 0.35,
    transparent: true,
    opacity: 0.9,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(BOOSTER_RADIUS, BOOSTER_TUBE, 14, 64),
    ringMat,
  );
  ring.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  group.add(ring);

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x8affff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const core = new THREE.Mesh(
    new THREE.TorusGeometry(BOOSTER_RADIUS * 0.72, BOOSTER_TUBE * 0.22, 8, 48),
    coreMat,
  );
  core.quaternion.copy(ring.quaternion);
  const corePivot = new THREE.Group();
  corePivot.add(core);
  group.add(corePivot);

  const arcMat = new THREE.MeshStandardMaterial({
    color: 0x8affff,
    emissive: 0x00d8ff,
    emissiveIntensity: 1.2,
    metalness: 0.12,
    roughness: 0.28,
    transparent: true,
    opacity: 0.85,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });
  const arcGeometry = new THREE.TorusGeometry(
    BOOSTER_RADIUS * 1.08,
    BOOSTER_TUBE * 0.2,
    10,
    36,
    1.45,
  );
  const arcPivotA = new THREE.Group();
  const arcA = new THREE.Mesh(arcGeometry, arcMat);
  arcA.rotation.z = 0.4;
  arcA.quaternion.multiply(ring.quaternion);
  arcPivotA.add(arcA);
  group.add(arcPivotA);

  const arcPivotB = new THREE.Group();
  const arcB = new THREE.Mesh(arcGeometry, arcMat.clone());
  arcB.rotation.z = Math.PI + 0.85;
  arcB.rotation.y = Math.PI / 2;
  arcB.quaternion.multiply(ring.quaternion);
  arcPivotB.add(arcB);
  group.add(arcPivotB);

  group.userData.ring = ring;
  group.userData.core = core;
  group.userData.corePivot = corePivot;
  group.userData.arcPivotA = arcPivotA;
  group.userData.arcPivotB = arcPivotB;
  group.userData.pulseMeshes = [ring, arcA, arcB];
  group.userData.baseQuaternion = group.quaternion.clone();
  group.renderOrder = 0;
  group.traverse((child) => {
    if (child.isMesh) child.renderOrder = 0;
  });
  group.userData.dispose = () => {
    ring.geometry.dispose();
    ring.material.dispose();
    core.geometry.dispose();
    core.material.dispose();
    arcGeometry.dispose();
    arcA.material.dispose();
    arcB.material.dispose();
  };
  return group;
}

export function initLevelBoosters(game) {
  disposeLevelBoosters(game);
  const points = game.levelBoostPoints ?? [];
  if (!points.length) return;

  game._levelBoosters = points.map((position, index) => {
    const mesh = createBoosterVisual(
      position,
      game.levelBoostQuaternions?.[index] ?? null,
    );
    game.scene.add(mesh);
    return {
      position: position.clone(),
      quaternion: game.levelBoostQuaternions?.[index]?.clone?.() ?? null,
      baseQuaternion: mesh.quaternion.clone(),
      mesh,
      active: true,
      cooldown: 0,
    };
  });
}

export function disposeLevelBoosters(game) {
  if (!game._levelBoosters?.length) {
    game._levelBoosters = [];
    return;
  }
  for (const booster of game._levelBoosters) {
    booster.mesh?.parent?.remove(booster.mesh);
    booster.mesh?.userData?.dispose?.();
  }
  game._levelBoosters = [];
}

export function activateLevelBooster(game, booster) {
  const player = game.player;
  if (!player || !booster.active) return;

  booster.active = false;
  booster.cooldown = OVERBOOST_DURATION + 2;
  booster.mesh.visible = false;

  game._levelBoostRecharge = {
    elapsed: 0,
    duration: BOOST_RECHARGE_DURATION,
    startFuel: player.boostFuel,
  };
  game._levelOverboost = {
    elapsed: 0,
    duration: OVERBOOST_DURATION,
    multiplier: OVERBOOST_MULTIPLIER,
  };

  _forward.set(0, 0, -1).applyQuaternion(game.camera.quaternion).normalize();
  player.velocity.addScaledVector(_forward, Math.max(1.25, player.maxSpeed * 0.05));
  game._levelBoostShake = {
    elapsed: 0,
    duration: BOOST_GATE_FEEDBACK_DURATION,
    amplitude: 0.14,
  };
  game._levelBoostBlurPulse = {
    elapsed: 0,
    duration: BOOST_GATE_FEEDBACK_DURATION,
    multiplier: BOOST_GATE_BLUR_MULTIPLIER,
  };
  sfxManager.play("engine-boost", booster.position, 1);
  player.updateCockpitStatusDisplay?.({ overboostActive: true });
}

export function clearLevelOverboost(game) {
  if (!game?.player) return;
  game._levelOverboost = null;
  game.player.overboostMultiplier = 1;
  game.player.overboostActive = false;
  game.player.updateCockpitStatusDisplay?.({ overboostActive: false });
}

function updateLevelBoostEffects(game, delta) {
  const player = game.player;
  if (!player) return;

  const recharge = game._levelBoostRecharge;
  if (recharge) {
    recharge.elapsed += delta;
    const t = Math.min(1, recharge.elapsed / recharge.duration);
    const eased = 1 - (1 - t) * (1 - t);
    player.boostFuel = THREE.MathUtils.lerp(
      recharge.startFuel,
      player.maxBoostFuel,
      eased,
    );
    if (t >= 1) game._levelBoostRecharge = null;
  }

  const overboost = game._levelOverboost;
  if (overboost) {
    overboost.elapsed += delta;
    player.overboostMultiplier = overboost.multiplier;
    player.overboostActive = true;
    if (overboost.elapsed >= overboost.duration) {
      player.overboostMultiplier = 1;
      player.overboostActive = false;
      game._levelOverboost = null;
    }
  } else {
    player.overboostMultiplier = 1;
    player.overboostActive = false;
  }

  const shake = game._levelBoostShake;
  if (shake) {
    applyCharonEscapeShakeStartFrame(game);
    shake.elapsed += delta;
    const t = Math.min(1, shake.elapsed / shake.duration);
    const amp = shake.amplitude * Math.sin(Math.PI * t);
    _shake.set(
      (Math.random() - 0.5) * amp,
      (Math.random() - 0.5) * amp,
      (Math.random() - 0.5) * amp,
    );
    const rig =
      game.xrManager?.isPresenting && game.xrManager.rig
        ? game.xrManager.rig
        : game.camera;
    rig.position.add(_shake);
    game._shakeApplyPos = _shake.clone();
    if (t >= 1) game._levelBoostShake = null;
  }
}

export function updateLevelBoosters(game, delta) {
  updateLevelBoostEffects(game, delta);
  const boosters = game._levelBoosters ?? [];
  if (!boosters.length || !game.camera || !game.player) return;

  const playerPos =
    game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig.position
      : game.camera.position;

  for (let i = 0; i < boosters.length; i++) {
    const booster = boosters[i];
    if (!booster.active) {
      booster.cooldown -= delta;
      if (booster.cooldown <= 0) {
        booster.active = true;
        booster.mesh.visible = true;
      }
      continue;
    }

    const elapsed = game.clock?.elapsedTime ?? performance.now() / 1000;
    booster.mesh.userData.arcPivotA.rotation.z += delta * 0.9;
    booster.mesh.userData.arcPivotB.rotation.z -= delta * 1.35;
    booster.mesh.userData.corePivot.rotation.z -= delta * 0.75;
    const wobbleZ = Math.sin(elapsed * 1.8 + i * 0.7) * 0.08;
    _boosterWobbleQuat.setFromAxisAngle(_boosterWobbleAxis, wobbleZ);
    booster.mesh.quaternion
      .copy(booster.baseQuaternion)
      .multiply(_boosterWobbleQuat);
    const pulse = 0.75 + Math.sin(game.clock.elapsedTime * 4) * 0.18;
    for (const mesh of booster.mesh.userData.pulseMeshes ?? []) {
      if (mesh.material?.emissiveIntensity != null) {
        mesh.material.emissiveIntensity = 0.85 + pulse * 0.7;
      }
    }
    booster.mesh.userData.core.material.opacity = 0.18 + pulse * 0.08;

    if (playerPos.distanceToSquared(booster.position) < BOOSTER_TRIGGER_RADIUS ** 2) {
      activateLevelBooster(game, booster);
    }
  }
}
