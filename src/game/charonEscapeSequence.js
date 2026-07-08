/**
 * Charon: after reactor core destruction — 60s escape; win = world AABB of
 * `Trigger.007` (Blender: Trigger.007-Dome, main room). HUD, shake, forward-cone mega explosions.
 */

import * as THREE from "three";
import { castRay } from "../physics/Physics.js";
import { Explosion } from "../entities/Explosion.js";
import sfxManager from "../audio/sfxManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import { respawnCharonEscapeEnemies } from "./gameEnemies.js";
import {
  applySplatShockwave,
  bindCharonReactorCoreFromLevelData,
  CHARON_CORE_MAX_HP,
  clearSplatShockwave,
} from "./charonReactorCore.js";
import {
  hideMissionCompleteOverlay,
  leaveMatch,
} from "./gameInGameUI.js";
import {
  mountCharonOutroOverlayBlack,
  runCharonOutroTypewriterAndFade,
} from "./charonOutroSequence.js";

const ESCAPE_DURATION_SEC = 60;
const EXPLOSION_INTERVAL_MIN = 0.28;
const EXPLOSION_INTERVAL_MAX = 0.72;
const RUMBLE_INTERVAL_MIN = 10;
const RUMBLE_INTERVAL_MAX = 20;
const RUMBLE_BURST_DURATION = 1.0;
const CONE_HALF_ANGLE_RAD = 0.38;
const RAYCAST_MAX = 950;
const GUSHER_LIFETIME = 2.5;
const MAX_GUSHERS = 6;
const ESCAPE_PULSE_INTERVAL = 5;
const ESCAPE_PULSE_DURATION = 0.8;
const ESCAPE_PULSE_MAX_INTENSITY = 0.08;
const ESCAPE_BLUE_FLASH = 0x4aa8ff;
const ESCAPE_BLUE_FIRE_A = { r: 0.35, g: 0.75, b: 1.0 };
const ESCAPE_BLUE_FIRE_B = { r: 0.55, g: 0.92, b: 1.0 };
const ESCAPE_BLUE_BIG_EXPLOSION_COLORS = {
  fireColorRange: {
    rMin: 0.25, rMax: 0.55,
    gMin: 0.7, gMax: 0.95,
    bMin: 0.95, bMax: 1.0,
  },
  sparksColorRange: {
    rMin: 0.35, rMax: 0.7,
    gMin: 0.75, gMax: 1.0,
    bMin: 0.95, bMax: 1.0,
  },
  debrisFireColorRange: {
    rMin: 0.2, rMax: 0.5,
    gMin: 0.65, gMax: 0.95,
    bMin: 0.9, bMax: 1.0,
  },
  lineSparksColorRange: {
    rMin: 0.45, rMax: 0.75,
    gMin: 0.85, gMax: 1.0,
    bMin: 1.0, bMax: 1.0,
  },
};

function initEscapeSplatPulse(game) {
  const sw = applySplatShockwave(game);
  if (!sw) return;
  game._charonEscapeSplatPulse = {
    ...sw,
    timer: ESCAPE_PULSE_INTERVAL * 0.5,
    active: 0,
  };
}

function updateEscapeSplatPulse(game, delta) {
  const p = game._charonEscapeSplatPulse;
  if (!p) return;

  if (p.active > 0) {
    p.active = Math.max(0, p.active - delta);
    const t = 1 - p.active / ESCAPE_PULSE_DURATION;
    const env = t < 0.2 ? t / 0.2 : (1 - t) / 0.8;
    p.intensityDyno.value = Math.max(0, env) * ESCAPE_PULSE_MAX_INTENSITY;
  } else {
    p.intensityDyno.value = 0;
    p.timer -= delta;
    if (p.timer <= 0) {
      p.timer = ESCAPE_PULSE_INTERVAL;
      p.active = ESCAPE_PULSE_DURATION;
    }
  }

  p.timeDyno.value = game.clock?.elapsedTime ?? 0;
  p.splatMesh.updateVersion();
}

function clearEscapeSplatPulse(game) {
  const p = game._charonEscapeSplatPulse;
  if (!p) return;
  clearSplatShockwave(game, p);
  game._charonEscapeSplatPulse = null;
}

function addEscapeFlameGusher(game, pos, dir, scale) {
  if (!game._charonEscapeGushers) game._charonEscapeGushers = [];
  if (game._charonEscapeGushers.length >= MAX_GUSHERS) {
    game._charonEscapeGushers.shift();
  }
  game._charonEscapeGushers.push({
    pos, dir, scale,
    elapsed: 0,
    lifetime: GUSHER_LIFETIME + Math.random() * 1,
    emitTimer: 0,
  });
}

function updateEscapeFlameGushers(game, delta) {
  const gushers = game._charonEscapeGushers;
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
        fireColorRange: ESCAPE_BLUE_BIG_EXPLOSION_COLORS.fireColorRange,
      });
      g.emitTimer = 0.06;
    }
  }
}
const FALLBACK_DIST = 420;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

function clearEscapeShakeOffset(game) {
  if (game._charonCoreExplosionShake?.applied) {
    const rig =
      game.xrManager?.isPresenting && game.xrManager.rig
        ? game.xrManager.rig
        : game.camera;
    if (rig) rig.position.sub(game._charonCoreExplosionShake.applied);
    game._charonCoreExplosionShake = null;
  }
  if (!game._shakeApplyPos) return;
  const rig =
    game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig
      : game.camera;
  if (rig) rig.position.sub(game._shakeApplyPos);
  game._shakeApplyPos = null;
}

function ensureEscapeHud(game) {
  let el = document.getElementById("charon-escape-countdown");
  if (!el) {
    el = document.createElement("div");
    el.id = "charon-escape-countdown";
    el.className =
      "pickup-message pickup-message--escape pickup-message--persistent visible";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  } else {
    el.classList.add("visible");
  }
  game._charonEscapeHudEl = el;
  return el;
}

function hideEscapeHud(game) {
  const el = game._charonEscapeHudEl ?? document.getElementById("charon-escape-countdown");
  if (el) {
    el.classList.remove("visible");
    el.textContent = "";
  }
  game._charonEscapeHudEl = null;
}

function pointInCharonEscapeRoom(game, worldPos) {
  const a = game._charonEscapeRoomAabb;
  if (!a?.min || !a?.max) return false;
  return (
    worldPos.x >= a.min.x &&
    worldPos.x <= a.max.x &&
    worldPos.y >= a.min.y &&
    worldPos.y <= a.max.y &&
    worldPos.z >= a.min.z &&
    worldPos.z <= a.max.z
  );
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
  const tx = ox + _dir.x * RAYCAST_MAX;
  const ty = oy + _dir.y * RAYCAST_MAX;
  const tz = oz + _dir.z * RAYCAST_MAX;
  const hit = castRay(ox, oy, oz, tx, ty, tz);
  let dist = FALLBACK_DIST;
  if (hit) {
    const toi = Number(hit.timeOfImpact ?? hit.toi) || 0;
    if (toi > 1 && toi < RAYCAST_MAX) dist = toi;
  }
  const px = ox + _dir.x * dist;
  const py = oy + _dir.y * dist;
  const pz = oz + _dir.z * dist;
  const pos = new THREE.Vector3(px, py, pz);

  const timeLeft = game._charonEscapeTimeLeft ?? ESCAPE_DURATION_SEC;
  const progress = 1 - Math.max(0, timeLeft) / ESCAPE_DURATION_SEC;
  const particleScale = 1 + Math.sqrt(progress) * 1.5;
  const shockScale = 1 + Math.sqrt(progress) * 1;

  game.explosions.push(
    new Explosion(game.scene, pos, ESCAPE_BLUE_FLASH, game.dynamicLights, {
      big: true,
      scaleMult: shockScale,
    }),
  );
  sfxManager.play("ship-explosion", pos, Math.min(1, 0.55 * particleScale));
  const fx = game.explosionEffect;
  if (fx) {
    const bigCount = Math.min(3, Math.ceil(1 + particleScale * 0.3));
    for (let k = 0; k < bigCount; k++) {
      fx.emitBigExplosion(pos, particleScale, ESCAPE_BLUE_BIG_EXPLOSION_COLORS);
    }
    fx.emitExplosionParticles(
      pos,
      ESCAPE_BLUE_FIRE_A,
      Math.ceil(60 + particleScale * 15),
      particleScale,
    );
    fx.emitExplosionParticles(
      pos,
      ESCAPE_BLUE_FIRE_B,
      Math.ceil(40 + particleScale * 10),
      particleScale,
    );
    fx.emitImpactSparks(pos, particleScale);

    const gusherDir = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
    ).normalize();
    addEscapeFlameGusher(game, pos.clone(), gusherDir, particleScale);
  }
  game.dynamicLights?.flash(pos, ESCAPE_BLUE_FLASH, {
    intensity: 120 * shockScale,
    distance: 90 * shockScale,
    ttl: 0.2 * Math.max(1, shockScale * 0.4),
    fade: 0.45 * Math.max(1, shockScale * 0.4),
  });
}

function computeShakeOffset(game, delta, phase) {
  const timeLeft = game._charonEscapeTimeLeft ?? ESCAPE_DURATION_SEC;
  const progress = 1 - Math.max(0, timeLeft) / ESCAPE_DURATION_SEC;

  const quietAmp = 0.008 + progress * 0.012;
  const burstAmp = 0.06 + progress * 0.14;
  const burstT = phase.burstTimer ?? 0;
  const inBurst = burstT > 0;
  const burstEnvelope = inBurst
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

export function cacheCharonEscapeRoomAabb(game) {
  game._charonEscapeRoomAabb = null;
  if (game.gameManager?.getState?.()?.currentLevel !== "charon") return;
  const vols = game._levelTriggerVolumes;
  if (!vols?.length) return;
  const t = vols.find((v) => v.objectName === "Trigger.007");
  if (!t?.worldMin || !t?.worldMax) return;
  game._charonEscapeRoomAabb = {
    min: { x: t.worldMin.x, y: t.worldMin.y, z: t.worldMin.z },
    max: { x: t.worldMax.x, y: t.worldMax.y, z: t.worldMax.z },
  };
}

export function startCharonReactorEscapeSequence(game) {
  if (game.isMultiplayer) return;
  if (game.gameManager?.getState?.()?.currentMissionId !== "charon") return;
  if (game._charonEscapeSequenceActive) return;

  game._charonEscapeSequenceActive = true;
  game._charonEscapeTimeLeft = ESCAPE_DURATION_SEC;
  game._charonEscapeExplosionTimer = 0.15;
  game._charonEscapeRumbleTimer = RUMBLE_INTERVAL_MIN + Math.random() * (RUMBLE_INTERVAL_MAX - RUMBLE_INTERVAL_MIN);
  game._charonEscapeShakePhase = { burstTimer: 0 };
  game._charonEscapeBeepTimer = 2 + Math.random() * 3;

  respawnCharonEscapeEnemies(game);
  initEscapeSplatPulse(game);

  ensureEscapeHud(game);

  game.gameManager.setState({ charonEscapeActive: true });
}

function completeCharonReactorEscape(game) {
  clearEscapeShakeOffset(game);
  clearEscapeSplatPulse(game);
  game._charonEscapeSequenceActive = false;
  game._charonEscapeTimeLeft = 0;
  game._charonEscapeShakePhase = null;
  game._charonEscapeGushers = null;
  hideEscapeHud(game);
  game.gameManager.setState({
    charonEscapeActive: false,
    charonEscapeSucceeded: true,
  });
  mountCharonOutroOverlayBlack();
  void (async () => {
    try {
      await runCharonOutroTypewriterAndFade({ retainBlackScreen: true });
    } catch (e) {
      console.warn("[Charon] Outro sequence failed:", e);
    }
    game.missionManager?.reportEvent?.("charonEscapeComplete", {});
    game.missionManager?.completeMission("Charon escaped", {
      stepTitle: "Charon",
      suppressCompleteMessage: true,
    });
    game.showMissionCompleteOverlay?.({
      subtitle: "Charon",
      title: "Mission complete",
      continueLabel: "Continue to Saturnalia",
      solidBlackBackdrop: true,
      zIndex: 3200,
      onContinue: async () => {
        hideMissionCompleteOverlay(game);
        document.getElementById("charon-outro-overlay")?.remove();
        await game.continueToSaturnaliaCampaign?.();
      },
      onMenu: async () => {
        hideMissionCompleteOverlay(game);
        document.getElementById("charon-outro-overlay")?.remove();
        leaveMatch(game);
      },
    });
  })();
}

function failCharonReactorEscape(game) {
  clearEscapeShakeOffset(game);
  clearEscapeSplatPulse(game);
  game._charonEscapeSequenceActive = false;
  game._charonEscapeTimeLeft = 0;
  game._charonEscapeShakePhase = null;
  game._charonEscapeGushers = null;
  hideEscapeHud(game);

  const corePos = game._charonCoreRetryWorldPos;
  if (corePos && game.camera) {
    _dir.subVectors(game.camera.position, corePos);
    if (_dir.lengthSq() < 4) {
      _dir.set(0, 0, 1);
    } else {
      _dir.normalize();
    }
    const standoff = 18;
    const px = corePos.x + _dir.x * standoff;
    const py = corePos.y + _dir.y * standoff;
    const pz = corePos.z + _dir.z * standoff;
    if (game.xrManager?.isPresenting && game.xrManager.rig) {
      game.xrManager.rig.position.set(px, py, pz);
      game.xrManager.rig.quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (-70 * Math.PI) / 180,
      );
      game.camera.quaternion.identity();
    } else {
      game.camera.position.set(px, py, pz);
      game.camera.quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (-70 * Math.PI) / 180,
      );
    }
    game.player?.velocity?.set(0, 0, 0);
  }

  game.gameManager.setState({
    charonEscapeActive: false,
    charonReactorCoreDestroyed: false,
  });

  bindCharonReactorCoreFromLevelData(game);
  if (game._charonReactorCore) {
    game._charonReactorCore.hp = CHARON_CORE_MAX_HP;
  }
}

export function applyCharonEscapeShakeStartFrame(game) {
  if (game._shakeApplyPos) {
    const rig =
      game.xrManager?.isPresenting && game.xrManager.rig
        ? game.xrManager.rig
        : game.camera;
    if (rig) rig.position.sub(game._shakeApplyPos);
    game._shakeApplyPos = null;
  }
}

export function applyCharonEscapeShakeEndFrame(game, delta) {
  if (!game._charonEscapeSequenceActive || !game._charonEscapeShakePhase) return;
  const rig =
    game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig
      : game.camera;
  if (!rig) return;

  const off = computeShakeOffset(game, delta, game._charonEscapeShakePhase);
  rig.position.add(off);
  game._shakeApplyPos = off.clone();
}

export function updateCharonReactorEscapeSequence(game, delta) {
  if (!game._charonEscapeSequenceActive) return;
  if (game.isMultiplayer) return;

  const d = Math.max(0, delta);

  const worldPos =
    game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig.position
      : game.camera?.position;
  if (worldPos && pointInCharonEscapeRoom(game, worldPos)) {
    completeCharonReactorEscape(game);
    return;
  }

  const el = game._charonEscapeHudEl ?? document.getElementById("charon-escape-countdown");
  const displayT = Math.max(0, game._charonEscapeTimeLeft);
  if (el) {
    el.textContent = displayT.toFixed(2);
  }

  game._charonEscapeTimeLeft -= d;
  if (game._charonEscapeTimeLeft <= 0) {
    failCharonReactorEscape(game);
    return;
  }

  game._charonEscapeExplosionTimer -= d;
  if (game._charonEscapeExplosionTimer <= 0) {
    spawnMegaForwardExplosion(game);
    game._charonEscapeExplosionTimer =
      EXPLOSION_INTERVAL_MIN +
      Math.random() * (EXPLOSION_INTERVAL_MAX - EXPLOSION_INTERVAL_MIN);
  }

  const phase = game._charonEscapeShakePhase;
  if (phase.burstTimer > 0) {
    phase.burstTimer = Math.max(0, phase.burstTimer - d);
  }

  game._charonEscapeRumbleTimer -= d;
  if (game._charonEscapeRumbleTimer <= 0) {
    game._charonEscapeRumbleTimer =
      RUMBLE_INTERVAL_MIN + Math.random() * (RUMBLE_INTERVAL_MAX - RUMBLE_INTERVAL_MIN);
    phase.burstTimer = RUMBLE_BURST_DURATION;
    spawnMegaForwardExplosion(game);
    spawnMegaForwardExplosion(game);
    sfxManager.play("ship-explosion", game.camera.position, 0.35);
  }

  const timeLeft = game._charonEscapeTimeLeft;
  const progress = 1 - Math.max(0, timeLeft) / ESCAPE_DURATION_SEC;
  game._charonEscapeBeepTimer -= d;
  if (game._charonEscapeBeepTimer <= 0) {
    proceduralAudio.escapeWarningBeep(progress);
    const minInterval = 0.8;
    const maxInterval = 5;
    game._charonEscapeBeepTimer = minInterval + (1 - progress) * (maxInterval - minInterval) + Math.random() * 1.5;
  }

  updateEscapeSplatPulse(game, d);
  updateEscapeFlameGushers(game, d);
}

export function stopCharonEscapeSequenceForLevelChange(game) {
  clearEscapeShakeOffset(game);
  const hadHud =
    game._charonEscapeHudEl ||
    document.getElementById("charon-escape-countdown");
  if (!game._charonEscapeSequenceActive && !hadHud) return;
  clearEscapeSplatPulse(game);
  game._charonEscapeSequenceActive = false;
  game._charonEscapeTimeLeft = 0;
  game._charonEscapeShakePhase = null;
  game._charonEscapeGushers = null;
  hideEscapeHud(game);
  game.gameManager?.setState?.({
    charonEscapeActive: false,
  });
}
