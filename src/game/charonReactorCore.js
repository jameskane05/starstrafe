/**
 * Charon mission: destructible reactor core mesh named "Core" in level data GLB.
 * Player weapons reduce HP; at 0 → flash VFX, hide mesh, notify mission/dialog.
 */

import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";
import { LaserImpact } from "../entities/LaserImpact.js";
import { Explosion } from "../entities/Explosion.js";
import sfxManager from "../audio/sfxManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import { notifyCharonReactorCoreDestroyed } from "../missions/charonMission.js";
import { startCharonReactorEscapeSequence } from "./charonEscapeSequence.js";

const CORE_MESH_NAME = "Core";
const CHARON_LEVEL_DATA_ID = "charonLevelData";
/** Effective HP (laser 25 × ~24 hits, or fewer missiles). */
export const CHARON_CORE_MAX_HP = 600;

const HEALTH_BAR_WIDTH = 12;
const HEALTH_BAR_HEIGHT = 0.45;
const HEALTH_BAR_Y_OFFSET = 11;

const _hitPos = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _oc = new THREE.Vector3();

let flashEl = null;

function createCoreHealthBar(scene, center) {
  const group = new THREE.Group();
  group.position.copy(center);
  group.position.y += HEALTH_BAR_Y_OFFSET;

  const bgGeo = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
  const bgMat = new THREE.MeshBasicMaterial({
    color: 0x111111,
    transparent: true,
    opacity: 0.6,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const bg = new THREE.Mesh(bgGeo, bgMat);
  group.add(bg);

  const fillGeo = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0xff3300,
    transparent: true,
    opacity: 0.9,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.z = 0.01;
  group.add(fill);

  const borderGeo = new THREE.EdgesGeometry(bgGeo);
  const borderMat = new THREE.LineBasicMaterial({
    color: 0xff5500,
    transparent: true,
    opacity: 0.8,
    depthTest: true,
    depthWrite: false,
  });
  const border = new THREE.LineSegments(borderGeo, borderMat);
  group.add(border);

  scene.add(group);
  return { group, bg, bgMat, fill, fillGeo, fillMat, border, borderMat };
}

function updateCoreHealthBar(bar, hp, maxHp, camera) {
  if (!bar) return;
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  bar.fill.scale.x = ratio || 0.001;
  bar.fill.position.x = -(1 - ratio) * HEALTH_BAR_WIDTH * 0.5;

  const t = ratio;
  bar.fillMat.color.setRGB(1 - t * 0.6, t * 0.8, t * 0.15);

  bar.group.quaternion.copy(camera.quaternion);
}

function disposeCoreHealthBar(bar, scene) {
  if (!bar) return;
  bar.bgMat.dispose();
  bar.bg.geometry.dispose();
  bar.fillMat.dispose();
  bar.fillGeo.dispose();
  bar.borderMat.dispose();
  bar.border.geometry.dispose();
  scene.remove(bar.group);
}

function ensureFlashOverlay() {
  if (flashEl) return flashEl;
  flashEl = document.createElement("div");
  flashEl.id = "charon-reactor-flash-overlay";
  flashEl.setAttribute("aria-hidden", "true");
  Object.assign(flashEl.style, {
    position: "fixed",
    inset: "0",
    zIndex: "10000",
    background: "#fff",
    opacity: "0",
    pointerEvents: "none",
    transition: "none",
  });
  document.body.appendChild(flashEl);
  return flashEl;
}

function segmentFirstSphereHitDistance(p0, p1, center, radius) {
  _seg.subVectors(p1, p0);
  const segLen = _seg.length();
  if (segLen < 1e-6) return null;
  _seg.multiplyScalar(1 / segLen);
  _oc.subVectors(p0, center);
  const b = 2 * _oc.dot(_seg);
  const c = _oc.dot(_oc) - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = (-b - root) / 2;
  const t1 = (-b + root) / 2;
  const tNear = Math.min(t0, t1);
  const tFar = Math.max(t0, t1);
  const tHit = tNear >= 0 ? tNear : tFar >= 0 ? tFar : null;
  if (tHit == null || tHit > segLen) return null;
  return tHit;
}

function charonCoreActive(game) {
  if (game.isMultiplayer) return false;
  if (game.gameManager?.getState?.()?.currentLevel !== "charon") return false;
  if (game.gameManager?.getState?.()?.charonReactorCoreDestroyed) return false;
  return Boolean(game._charonReactorCore?.mesh);
}

export function bindCharonReactorCoreFromLevelData(game) {
  game._charonReactorCore = null;
  if (game.gameManager?.getState?.()?.currentLevel !== "charon") return;
  const levelData = game.sceneManager?.getObject?.(CHARON_LEVEL_DATA_ID);
  if (!levelData) return;
  const root = levelData.getObjectByName(CORE_MESH_NAME);
  if (!root) return;
  let mesh = null;
  if (root.isMesh) mesh = root;
  else {
    root.traverse((c) => {
      if (c.isMesh && !mesh) mesh = c;
    });
  }
  if (!mesh) return;
  root.visible = true;
  const sphere = new THREE.Sphere();
  game._charonReactorCore = {
    root,
    mesh,
    hp: CHARON_CORE_MAX_HP,
    sphere,
    healthBar: null,
  };
  updateCharonReactorCoreBounds(game);
  game._charonReactorCore.healthBar = createCoreHealthBar(
    game.scene,
    sphere.center,
  );
}

export function updateCharonReactorCoreBounds(game) {
  const st = game._charonReactorCore;
  if (!st?.mesh) return;
  st.mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(st.mesh);
  box.getBoundingSphere(st.sphere);
  st.sphere.radius *= 1.12;
}

export function updateCharonReactorCoreHealthBar(game) {
  const st = game._charonReactorCore;
  if (!st?.healthBar) return;
  updateCoreHealthBar(st.healthBar, st.hp, CHARON_CORE_MAX_HP, game.camera);
}

export function initCharonReactorCoreForCharonMission(game) {
  if (game.gameManager?.getState?.()?.currentMissionId !== "charon") return;
  clearCoreSplatFx(game);
  const st = game._charonReactorCore;
  if (st) {
    st.hp = CHARON_CORE_MAX_HP;
    if (st.root) st.root.visible = true;
    if (!st.healthBar) {
      updateCharonReactorCoreBounds(game);
      st.healthBar = createCoreHealthBar(game.scene, st.sphere.center);
    }
  } else {
    bindCharonReactorCoreFromLevelData(game);
    if (game._charonReactorCore)
      game._charonReactorCore.hp = CHARON_CORE_MAX_HP;
  }
}

/**
 * Distance from p0 toward p1 where the segment enters the (expanded) core sphere, or null.
 * @param {number} inflate - extra radius (e.g. missile collision radius)
 */
export function getCharonCoreHitDistanceAlongSegment(
  game,
  p0,
  p1,
  inflate = 0,
) {
  if (!charonCoreActive(game)) return null;
  updateCharonReactorCoreBounds(game);
  const { sphere } = game._charonReactorCore;
  const r = sphere.radius + inflate;
  return segmentFirstSphereHitDistance(p0, p1, sphere.center, r);
}

const EXPLOSION_SHAKE_DURATION = 3.0;
const EXPLOSION_SHAKE_AMP = 0.45;
const _expShake = new THREE.Vector3();

export function startCharonReactorExplosionFlash(game) {
  const el = ensureFlashOverlay();
  game._charonReactorFlash = {
    phase: "peak",
    timer: 0,
    peakSec: 0.14,
    fadeSec: 3.0,
  };
  game._charonCoreExplosionShake = { elapsed: 0, applied: null };
  el.style.transition = "none";
  el.style.opacity = "1";
}

export function updateCharonReactorExplosionFlash(game, delta) {
  if (game._charonCoreDeathHoldTimer != null) {
    game._charonCoreDeathHoldTimer -= delta;
    const fx = game._charonCoreDeathFxHold;
    if (fx) {
      fx.timeDyno.value = game.clock?.elapsedTime ?? 0;
      fx.splatMesh.updateVersion();
    }
    if (game._charonCoreDeathHoldTimer <= 0) {
      game._charonCoreDeathHoldTimer = null;
      const cb = game._charonCoreDeathHoldCallback;
      game._charonCoreDeathHoldCallback = null;
      cb?.();
    }
  }

  const eshk = game._charonCoreExplosionShake;
  if (eshk) {
    const rig =
      game.xrManager?.isPresenting && game.xrManager.rig
        ? game.xrManager.rig
        : game.camera;
    if (rig) {
      if (eshk.applied) rig.position.sub(eshk.applied);
      eshk.elapsed += delta;
      if (eshk.elapsed >= EXPLOSION_SHAKE_DURATION) {
        game._charonCoreExplosionShake = null;
      } else {
        const t = eshk.elapsed / EXPLOSION_SHAKE_DURATION;
        const decay = (1 - t) * (1 - t);
        const amp = EXPLOSION_SHAKE_AMP * decay;
        _expShake.set(
          (Math.random() - 0.5) * 2 * amp,
          (Math.random() - 0.5) * 2 * amp,
          (Math.random() - 0.5) * 2 * amp,
        );
        rig.position.add(_expShake);
        eshk.applied = _expShake.clone();
      }
    }
  }

  const f = game._charonReactorFlash;
  if (!f) return;
  const el = ensureFlashOverlay();
  f.timer += delta;
  if (f.phase === "peak") {
    if (f.timer >= f.peakSec) {
      f.phase = "fade";
      f.timer = 0;
      el.style.transition = `opacity ${f.fadeSec}s ease-out`;
      requestAnimationFrame(() => {
        el.style.opacity = "0";
      });
    }
  } else if (f.phase === "fade" && f.timer >= f.fadeSec + 0.2) {
    game._charonReactorFlash = null;
    el.style.transition = "none";
  }
}

const CORE_SHOCKWAVE_DURATION = 1.0;

const HIT_FLASH_THRESHOLD = 0.75;
const HIT_FLASH_DURATION = 0.12;
const HIT_FLASH_INTENSITY = 0.09;
const CRITICAL_THRESHOLD = 0.3;
const CRITICAL_SUSTAINED_MAX = 0.28;
const CRITICAL_HIT_FLASH_INTENSITY = 0.15;

function ensureCoreSplatFx(game) {
  if (game._charonCoreSplatFx) return game._charonCoreSplatFx;
  const sw = applySplatShockwave(game);
  if (!sw) return null;
  game._charonCoreSplatFx = { ...sw, hitFlashTimer: 0 };
  return game._charonCoreSplatFx;
}

function triggerCoreHitFlash(game) {
  const st = game._charonReactorCore;
  if (!st || st.hp <= 0) return;
  if (st.hp / CHARON_CORE_MAX_HP >= HIT_FLASH_THRESHOLD) return;
  const fx = ensureCoreSplatFx(game);
  if (fx) fx.hitFlashTimer = HIT_FLASH_DURATION;
}

function clearCoreSplatFx(game) {
  const fx = game._charonCoreSplatFx;
  if (fx) {
    clearSplatShockwave(game, fx);
    game._charonCoreSplatFx = null;
  }
  if (game._charonCoreDeathFxHold) {
    clearSplatShockwave(game, game._charonCoreDeathFxHold);
    game._charonCoreDeathFxHold = null;
  }
  game._charonCoreDeathHoldTimer = null;
  game._charonCoreDeathHoldCallback = null;
}

export function updateCoreSplatFx(game, delta) {
  const fx = game._charonCoreSplatFx;
  if (!fx) return;

  const st = game._charonReactorCore;
  const ratio = st ? Math.max(0, st.hp / CHARON_CORE_MAX_HP) : 0;

  if (fx.hitFlashTimer > 0) {
    fx.hitFlashTimer = Math.max(0, fx.hitFlashTimer - delta);
  }

  const isCritical = ratio < CRITICAL_THRESHOLD && ratio > 0;
  const flashMax = isCritical
    ? CRITICAL_HIT_FLASH_INTENSITY
    : HIT_FLASH_INTENSITY;
  const hitFlash =
    fx.hitFlashTimer > 0
      ? flashMax * (fx.hitFlashTimer / HIT_FLASH_DURATION)
      : 0;

  let sustained = 0;
  if (isCritical) {
    sustained = CRITICAL_SUSTAINED_MAX * (1 - ratio / CRITICAL_THRESHOLD);
  }

  const intensity = Math.min(1, hitFlash + sustained);
  fx.intensityDyno.value = intensity;
  fx.timeDyno.value = game.clock?.elapsedTime ?? 0;
  fx.splatMesh.updateVersion();
}

export function applySplatShockwave(game, splatObjectId = "charonLevel") {
  const splatMesh = game.sceneManager?.getObject?.(splatObjectId);
  if (!splatMesh) return null;

  const intensityDyno = dyno.dynoFloat(0);
  const timeDyno = dyno.dynoFloat(0);

  splatMesh.objectModifier = dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const d = new dyno.Dyno({
        inTypes: { gsplat: dyno.Gsplat, t: "float", intensity: "float" },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          dyno.unindent(`
            vec3 shockHash(vec3 p) {
              return fract(sin(p * 123.456) * 123.456);
            }
            mat2 shockRot(float a) {
              float s = sin(a), c = cos(a);
              return mat2(c, -s, s, c);
            }
          `),
        ],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat};
          vec3 pos = ${inputs.gsplat}.center;
          vec4 col = ${inputs.gsplat}.rgba;
          vec3 scl = ${inputs.gsplat}.scales;
          float inten = ${inputs.intensity};
          float tt = ${inputs.t};

          // fractal color distortion
          float m = 100.0;
          vec3 p = pos * 0.1;
          p.y += 0.5;
          for (int i = 0; i < 8; i++) {
            p = abs(p) / clamp(abs(p.x * p.y), 0.3, 3.0) - 1.0;
            p.xy *= shockRot(radians(90.0));
            if (i > 1) m = min(m, length(p.xy) + step(0.3, fract(p.z * 0.5 + tt * 0.5 + float(i) * 0.2)));
          }
          float fractalVal = step(m, 0.5) * 1.3 * inten;
          vec4 effect = vec4(-pos.y * 0.3, 0.5, 0.7, 0.3) * inten + fractalVal;
          ${outputs.gsplat}.rgba = mix(col, col * effect, inten);

          // vertex displacement: radial push + swirl + jitter
          vec3 noise = shockHash(pos * 3.0 + tt * 7.0) * 2.0 - 1.0;
          float radial = inten * inten * 0.5;
          vec3 dir = normalize(pos + 0.001);
          vec3 displaced = pos + dir * radial * (0.5 + noise.x * 0.5);
          displaced.xz *= shockRot(inten * inten * 0.3 * (noise.y + 0.3));
          displaced += noise * inten * inten * 0.15;
          ${outputs.gsplat}.center = mix(pos, displaced, inten);

          // splats bloat outward
          ${outputs.gsplat}.scales = scl * (1.0 + inten * inten * 0.25);

          // fade toward white at peak
          vec3 white = vec3(1.0, 0.95, 0.85);
          float whiteBlend = inten * inten * inten * 0.5;
          ${outputs.gsplat}.rgba.rgb = mix(${outputs.gsplat}.rgba.rgb, white, whiteBlend);
        `),
      });
      gsplat = d.apply({
        gsplat,
        t: timeDyno,
        intensity: intensityDyno,
      }).gsplat;
      return { gsplat };
    },
  );
  splatMesh.updateGenerator();

  return { splatMesh, intensityDyno, timeDyno };
}

export function clearSplatShockwave(game, shockwave) {
  if (!shockwave?.splatMesh) return;
  shockwave.splatMesh.objectModifier = null;
  shockwave.splatMesh.updateGenerator();
}

function destroyCharonReactorCore(game) {
  const st = game._charonReactorCore;
  if (!st || game.gameManager.getState().charonReactorCoreDestroyed) return;
  game._charonCoreRetryWorldPos = st.sphere.center.clone();
  disposeCoreHealthBar(st.healthBar, game.scene);
  st.healthBar = null;
  if (st.root) st.root.visible = false;
  game._charonReactorCore = null;

  const fx = game._charonCoreSplatFx;
  if (fx) {
    fx.intensityDyno.value = 1;
    fx.timeDyno.value = game.clock?.elapsedTime ?? 0;
    fx.splatMesh.updateVersion();
    game._charonCoreDeathFxHold = fx;
    game._charonCoreSplatFx = null;
  }

  const boomPos = st.sphere.center.clone();
  game.explosions.push(
    new Explosion(game.scene, boomPos, 0xffffff, game.dynamicLights, {
      big: true,
    }),
  );
  sfxManager.play("ship-explosion", boomPos, 1);
  proceduralAudio?.checkpointGoalSuccess?.();
  notifyCharonReactorCoreDestroyed(game);

  const DEATH_HOLD_SEC = CORE_SHOCKWAVE_DURATION;
  game._charonCoreDeathHoldTimer = DEATH_HOLD_SEC;
  game._charonCoreDeathHoldCallback = () => {
    if (game._charonCoreDeathFxHold) {
      clearSplatShockwave(game, game._charonCoreDeathFxHold);
      game._charonCoreDeathFxHold = null;
    }
    startCharonReactorExplosionFlash(game);
    startCharonReactorEscapeSequence(game);
  };
}

/**
 * @returns {boolean} true if this shot was consumed by the core (hit or near-miss on core window)
 */
export function applyCharonReactorCoreLaserHit(
  game,
  prevPos,
  nextPos,
  hitDistance,
  projColor,
) {
  if (!charonCoreActive(game)) return false;
  const st = game._charonReactorCore;
  const segLen = prevPos.distanceTo(nextPos);
  const t = segLen > 1e-6 ? hitDistance / segLen : 0;
  _hitPos.copy(prevPos).lerp(nextPos, t);
  st.hp -= 25;
  triggerCoreHitFlash(game);
  _hitNormal.subVectors(_hitPos, st.sphere.center).normalize();
  if (_hitNormal.lengthSq() < 1e-6) _hitNormal.set(0, 1, 0);
  game.impacts.push(
    new LaserImpact(
      game.scene,
      _hitPos,
      _hitNormal,
      projColor,
      game.dynamicLights,
    ),
  );
  if (game.particles) {
    game.sparksEffect.emitElectricalSparks(_hitPos, _hitNormal, 40, projColor);
  }
  game.dynamicLights?.flash(_hitPos, projColor, {
    intensity: 10,
    distance: 18,
    ttl: 0.06,
    fade: 0.12,
  });
  if (st.hp <= 0) destroyCharonReactorCore(game);
  return true;
}

export function applyCharonReactorCoreMissileHit(game, hitPos, damage) {
  if (!charonCoreActive(game)) return false;
  const st = game._charonReactorCore;
  st.hp -= damage;
  triggerCoreHitFlash(game);
  game.explosions.push(
    new Explosion(game.scene, hitPos.clone(), 0xff6622, game.dynamicLights, {
      big: true,
    }),
  );
  sfxManager.play("ship-explosion", hitPos, 0.55);
  if (game.particles) {
    game.explosionEffect.emitExplosionParticles(
      hitPos,
      { r: 1, g: 0.35, b: 0.05 },
      24,
    );
  }
  if (st.hp <= 0) destroyCharonReactorCore(game);
  return true;
}
