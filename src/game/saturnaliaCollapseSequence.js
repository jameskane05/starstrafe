/**
 * Saturnalia: after the chase drone escapes to the end of the level, the
 * station starts tearing itself apart — same treatment as the Charon reactor
 * escape (forward-cone mega explosions, rumble shake, splat pulse) but warm
 * gold/orange and with no countdown or fail state.
 */

import * as THREE from "three";
import { castRay } from "../physics/Physics.js";
import { Explosion } from "../entities/Explosion.js";
import sfxManager from "../audio/sfxManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import {
  applySplatShockwave,
  clearSplatShockwave,
} from "./charonReactorCore.js";

const EXPLOSION_INTERVAL_MIN = 0.32;
const EXPLOSION_INTERVAL_MAX = 0.85;
const RUMBLE_INTERVAL_MIN = 8;
const RUMBLE_INTERVAL_MAX = 16;
const RUMBLE_BURST_DURATION = 1.0;
const CONE_HALF_ANGLE_RAD = 0.38;
const RAYCAST_MAX = 950;
const FALLBACK_DIST = 420;
const GUSHER_LIFETIME = 2.5;
const MAX_GUSHERS = 6;
const PULSE_INTERVAL = 6;
const PULSE_DURATION = 0.8;
const PULSE_MAX_INTENSITY = 0.07;
/** Ramp from gentle rumbles to full collapse over this long. */
const INTENSITY_RAMP_SEC = 45;

const COLLAPSE_FLASH = 0xffa14a;
const COLLAPSE_FIRE_A = { r: 1.0, g: 0.55, b: 0.18 };
const COLLAPSE_FIRE_B = { r: 1.0, g: 0.8, b: 0.35 };
const COLLAPSE_BIG_EXPLOSION_COLORS = {
  fireColorRange: {
    rMin: 0.95, rMax: 1.0,
    gMin: 0.45, gMax: 0.75,
    bMin: 0.1, bMax: 0.3,
  },
  sparksColorRange: {
    rMin: 1.0, rMax: 1.0,
    gMin: 0.65, gMax: 0.9,
    bMin: 0.25, bMax: 0.5,
  },
  debrisFireColorRange: {
    rMin: 0.9, rMax: 1.0,
    gMin: 0.4, gMax: 0.7,
    bMin: 0.08, bMax: 0.25,
  },
  lineSparksColorRange: {
    rMin: 1.0, rMax: 1.0,
    gMin: 0.75, gMax: 0.95,
    bMin: 0.35, bMax: 0.6,
  },
};

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

function collapseProgress(game) {
  const elapsed = game._saturnaliaCollapseElapsed ?? 0;
  return THREE.MathUtils.clamp(elapsed / INTENSITY_RAMP_SEC, 0, 1);
}

function initCollapseSplatPulse(game) {
  const sw = applySplatShockwave(game, "saturnaliaLevel");
  if (!sw) return;
  game._saturnaliaCollapsePulse = {
    ...sw,
    timer: PULSE_INTERVAL * 0.5,
    active: 0,
  };
}

function updateCollapseSplatPulse(game, delta) {
  const p = game._saturnaliaCollapsePulse;
  if (!p) return;

  if (p.active > 0) {
    p.active = Math.max(0, p.active - delta);
    const t = 1 - p.active / PULSE_DURATION;
    const env = t < 0.2 ? t / 0.2 : (1 - t) / 0.8;
    p.intensityDyno.value = Math.max(0, env) * PULSE_MAX_INTENSITY;
  } else {
    p.intensityDyno.value = 0;
    p.timer -= delta;
    if (p.timer <= 0) {
      p.timer = PULSE_INTERVAL;
      p.active = PULSE_DURATION;
    }
  }

  p.timeDyno.value = game.clock?.elapsedTime ?? 0;
  p.splatMesh.updateVersion();
}

function clearCollapseSplatPulse(game) {
  const p = game._saturnaliaCollapsePulse;
  if (!p) return;
  clearSplatShockwave(game, p);
  game._saturnaliaCollapsePulse = null;
}

function addCollapseFlameGusher(game, pos, dir, scale) {
  if (!game._saturnaliaCollapseGushers) game._saturnaliaCollapseGushers = [];
  if (game._saturnaliaCollapseGushers.length >= MAX_GUSHERS) {
    game._saturnaliaCollapseGushers.shift();
  }
  game._saturnaliaCollapseGushers.push({
    pos, dir, scale,
    elapsed: 0,
    lifetime: GUSHER_LIFETIME + Math.random() * 1,
    emitTimer: 0,
  });
}

function updateCollapseFlameGushers(game, delta) {
  const gushers = game._saturnaliaCollapseGushers;
  if (!gushers?.length) return;
  const fx = game.explosionEffect;
  if (!fx) return;

  for (let i = gushers.length - 1; i >= 0; i--) {
    const g = gushers[i];
    g.elapsed += delta;
    if (g.elapsed >= g.lifetime) {
      gushers.splice(i, 1);
      continue;
    }
    g.emitTimer -= delta;
    if (g.emitTimer <= 0) {
      const fade = 1 - g.elapsed / g.lifetime;
      fx.emitFlameGusher(g.pos, g.dir, g.scale * fade, {
        fireColorRange: COLLAPSE_BIG_EXPLOSION_COLORS.fireColorRange,
      });
      g.emitTimer = 0.06;
    }
  }
}

function sampleConeDirection(camera, out) {
  camera.getWorldDirection(_fwd);
  _fwd.normalize();
  _right.crossVectors(_fwd, _worldUp);
  if (_right.lengthSq() < 1e-6) {
    _right.crossVectors(_fwd, new THREE.Vector3(1, 0, 0));
  }
  _right.normalize();
  _up.crossVectors(_right, _fwd).normalize();
  const u = (Math.random() - 0.5) * 2;
  const v = (Math.random() - 0.5) * 2;
  const spread = Math.tan(CONE_HALF_ANGLE_RAD);
  out
    .copy(_fwd)
    .addScaledVector(_right, u * spread)
    .addScaledVector(_up, v * spread)
    .normalize();
  return out;
}

function spawnMegaForwardExplosion(game) {
  const cam = game.camera;
  if (!cam) return;
  const ox = cam.position.x;
  const oy = cam.position.y;
  const oz = cam.position.z;
  sampleConeDirection(cam, _dir);
  const hit = castRay(
    ox, oy, oz,
    ox + _dir.x * RAYCAST_MAX,
    oy + _dir.y * RAYCAST_MAX,
    oz + _dir.z * RAYCAST_MAX,
  );
  let dist = FALLBACK_DIST;
  if (hit) {
    const toi = Number(hit.timeOfImpact ?? hit.toi) || 0;
    if (toi > 1 && toi < RAYCAST_MAX) dist = toi;
  }
  const pos = new THREE.Vector3(
    ox + _dir.x * dist,
    oy + _dir.y * dist,
    oz + _dir.z * dist,
  );

  const progress = collapseProgress(game);
  const particleScale = 1 + Math.sqrt(progress) * 1.4;
  const shockScale = 1 + Math.sqrt(progress) * 0.9;

  game.explosions.push(
    new Explosion(game.scene, pos, COLLAPSE_FLASH, game.dynamicLights, {
      big: true,
      scaleMult: shockScale,
    }),
  );
  sfxManager.play("ship-explosion", pos, Math.min(1, 0.55 * particleScale));
  const fx = game.explosionEffect;
  if (fx) {
    const bigCount = Math.min(3, Math.ceil(1 + particleScale * 0.3));
    for (let k = 0; k < bigCount; k++) {
      fx.emitBigExplosion(pos, particleScale, COLLAPSE_BIG_EXPLOSION_COLORS);
    }
    fx.emitExplosionParticles(
      pos,
      COLLAPSE_FIRE_A,
      Math.ceil(55 + particleScale * 15),
      particleScale,
    );
    fx.emitExplosionParticles(
      pos,
      COLLAPSE_FIRE_B,
      Math.ceil(35 + particleScale * 10),
      particleScale,
    );
    fx.emitImpactSparks(pos, particleScale);

    const gusherDir = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
    ).normalize();
    addCollapseFlameGusher(game, pos.clone(), gusherDir, particleScale);
  }
  game.dynamicLights?.flash(pos, COLLAPSE_FLASH, {
    intensity: 120 * shockScale,
    distance: 90 * shockScale,
    ttl: 0.2 * Math.max(1, shockScale * 0.4),
    fade: 0.45 * Math.max(1, shockScale * 0.4),
  });
}

function computeShakeOffset(game, phase) {
  const progress = collapseProgress(game);
  const quietAmp = 0.008 + progress * 0.012;
  const burstAmp = 0.06 + progress * 0.12;
  const burstT = phase.burstTimer ?? 0;
  const burstEnvelope =
    burstT > 0
      ? (burstT < 0.15 ? burstT / 0.15 : Math.max(0, burstT / RUMBLE_BURST_DURATION))
      : 0;
  const amp = quietAmp + (burstAmp - quietAmp) * burstEnvelope;

  const t = game.clock.elapsedTime;
  const wobble =
    Math.sin(t * 37.2) * 0.5 +
    Math.sin(t * 21.5 + 1.7) * 0.35 +
    Math.sin(t * 53.1 + 0.3) * 0.15;
  const final = amp * (0.85 + 0.15 * wobble);
  _shake.set(
    (Math.random() - 0.5) * 2 * final,
    (Math.random() - 0.5) * 2 * final,
    (Math.random() - 0.5) * 2 * final,
  );
  return _shake;
}

export function startSaturnaliaCollapseSequence(game) {
  if (game.isMultiplayer) return;
  if (game.gameManager?.getState?.()?.currentMissionId !== "saturnalia") return;
  if (game._saturnaliaCollapseActive) return;

  game._saturnaliaCollapseActive = true;
  game._saturnaliaCollapseElapsed = 0;
  game._saturnaliaCollapseExplosionTimer = 0.1;
  game._saturnaliaCollapseRumbleTimer = 1.2;
  game._saturnaliaCollapseShakePhase = { burstTimer: RUMBLE_BURST_DURATION };
  game._saturnaliaCollapseBeepTimer = 2 + Math.random() * 3;

  initCollapseSplatPulse(game);
  game.gameManager.setState({ saturnaliaCollapseActive: true });
}

export function applySaturnaliaCollapseShakeEndFrame(game) {
  if (!game._saturnaliaCollapseActive || !game._saturnaliaCollapseShakePhase) return;
  const rig =
    game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig
      : game.camera;
  if (!rig) return;

  const off = computeShakeOffset(game, game._saturnaliaCollapseShakePhase);
  rig.position.add(off);
  game._shakeApplyPos = off.clone();
}

export function updateSaturnaliaCollapseSequence(game, delta) {
  if (!game._saturnaliaCollapseActive) return;
  if (game.isMultiplayer) return;

  const d = Math.max(0, delta);
  game._saturnaliaCollapseElapsed = (game._saturnaliaCollapseElapsed ?? 0) + d;

  game._saturnaliaCollapseExplosionTimer -= d;
  if (game._saturnaliaCollapseExplosionTimer <= 0) {
    spawnMegaForwardExplosion(game);
    game._saturnaliaCollapseExplosionTimer =
      EXPLOSION_INTERVAL_MIN +
      Math.random() * (EXPLOSION_INTERVAL_MAX - EXPLOSION_INTERVAL_MIN);
  }

  const phase = game._saturnaliaCollapseShakePhase;
  if (phase.burstTimer > 0) {
    phase.burstTimer = Math.max(0, phase.burstTimer - d);
  }

  game._saturnaliaCollapseRumbleTimer -= d;
  if (game._saturnaliaCollapseRumbleTimer <= 0) {
    game._saturnaliaCollapseRumbleTimer =
      RUMBLE_INTERVAL_MIN +
      Math.random() * (RUMBLE_INTERVAL_MAX - RUMBLE_INTERVAL_MIN);
    phase.burstTimer = RUMBLE_BURST_DURATION;
    spawnMegaForwardExplosion(game);
    spawnMegaForwardExplosion(game);
    sfxManager.play("ship-explosion", game.camera.position, 0.35);
  }

  game._saturnaliaCollapseBeepTimer -= d;
  if (game._saturnaliaCollapseBeepTimer <= 0) {
    const progress = collapseProgress(game);
    proceduralAudio.escapeWarningBeep(progress);
    game._saturnaliaCollapseBeepTimer =
      1.2 + (1 - progress) * 4 + Math.random() * 1.5;
  }

  updateCollapseSplatPulse(game, d);
  updateCollapseFlameGushers(game, d);
}

export function stopSaturnaliaCollapseForLevelChange(game) {
  if (!game._saturnaliaCollapseActive) return;
  clearCollapseSplatPulse(game);
  game._saturnaliaCollapseActive = false;
  game._saturnaliaCollapseShakePhase = null;
  game._saturnaliaCollapseGushers = null;
  game.gameManager?.setState?.({ saturnaliaCollapseActive: false });
}
