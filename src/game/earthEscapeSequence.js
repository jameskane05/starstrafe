import * as THREE from "three";
import { castRay } from "../physics/Physics.js";
import { Explosion } from "../entities/Explosion.js";
import sfxManager from "../audio/sfxManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import {
  applySplatShockwave,
  clearSplatShockwave,
} from "./charonReactorCore.js";
import { clearEarthBossSplatFx } from "./earthBossFight.js";
import {
  hideMissionCompleteOverlay,
  leaveMatch,
} from "./gameInGameUI.js";
import {
  mountEarthOutroOverlayBlack,
  runEarthOutroTypewriterAndFade,
} from "./earthOutroSequence.js";

const ESCAPE_DURATION_SEC = 90;
const EXPLOSION_INTERVAL_MIN = 0.28;
const EXPLOSION_INTERVAL_MAX = 0.72;
const RUMBLE_INTERVAL_MIN = 10;
const RUMBLE_INTERVAL_MAX = 20;
const RUMBLE_BURST_DURATION = 1.0;
const CONE_HALF_ANGLE_RAD = 0.38;
const RAYCAST_MAX = 950;
const FALLBACK_DIST = 420;
const GUSHER_LIFETIME = 2.5;
const MAX_GUSHERS = 6;
const ESCAPE_PULSE_INTERVAL = 5;
const ESCAPE_PULSE_DURATION = 0.8;
const ESCAPE_PULSE_MAX_INTENSITY = 0.08;
const SPLAT_OBJECT_ID = "earthdefenseLevel";

const ESCAPE_FLASH = 0xffa14a;
const ESCAPE_FIRE_A = { r: 1.0, g: 0.55, b: 0.18 };
const ESCAPE_FIRE_B = { r: 1.0, g: 0.8, b: 0.35 };
const ESCAPE_BIG_EXPLOSION_COLORS = {
  fireColorRange: {
    rMin: 0.95,
    rMax: 1.0,
    gMin: 0.45,
    gMax: 0.75,
    bMin: 0.1,
    bMax: 0.3,
  },
  sparksColorRange: {
    rMin: 1.0,
    rMax: 1.0,
    gMin: 0.65,
    gMax: 0.9,
    bMin: 0.25,
    bMax: 0.5,
  },
  debrisFireColorRange: {
    rMin: 0.9,
    rMax: 1.0,
    gMin: 0.4,
    gMax: 0.7,
    bMin: 0.08,
    bMax: 0.25,
  },
  lineSparksColorRange: {
    rMin: 1.0,
    rMax: 1.0,
    gMin: 0.75,
    gMax: 0.95,
    bMin: 0.35,
    bMax: 0.6,
  },
};

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

function escapeProgress(game) {
  const timeLeft = game._earthEscapeTimeLeft ?? ESCAPE_DURATION_SEC;
  return 1 - Math.max(0, timeLeft) / ESCAPE_DURATION_SEC;
}

function ensureEscapeHud(game) {
  let el = document.getElementById("earth-escape-countdown");
  if (!el) {
    el = document.createElement("div");
    el.id = "earth-escape-countdown";
    el.className =
      "pickup-message pickup-message--escape pickup-message--persistent visible";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  } else {
    el.classList.add("visible");
  }
  game._earthEscapeHudEl = el;
  return el;
}

function hideEscapeHud(game) {
  const el =
    game._earthEscapeHudEl ?? document.getElementById("earth-escape-countdown");
  if (el) {
    el.classList.remove("visible");
    el.textContent = "";
  }
  game._earthEscapeHudEl = null;
}

function ensureEscapeFlashOverlay() {
  let el = document.getElementById("earth-escape-flash-overlay");
  if (el) return el;
  el = document.createElement("div");
  el.id = "earth-escape-flash-overlay";
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    zIndex: "9999",
    pointerEvents: "none",
    opacity: "0",
    background:
      "radial-gradient(ellipse at center, rgba(255, 72, 32, 0.55) 0%, rgba(180, 24, 8, 0.28) 42%, rgba(80, 8, 0, 0.08) 100%)",
    transition: "opacity 0.08s linear",
  });
  document.body.appendChild(el);
  return el;
}

function updateEscapeFlashOverlay(pulseIntensity, progress) {
  const el = ensureEscapeFlashOverlay();
  if (pulseIntensity <= 0) {
    el.style.opacity = "0";
    return;
  }
  const normalized = pulseIntensity / ESCAPE_PULSE_MAX_INTENSITY;
  el.style.opacity = String(
    Math.min(0.28, normalized * (0.14 + progress * 0.14)),
  );
}

function clearEscapeFlashOverlay() {
  const el = document.getElementById("earth-escape-flash-overlay");
  if (el) el.style.opacity = "0";
}

function initSplatPulse(game) {
  clearEarthBossSplatFx(game);
  const sw = applySplatShockwave(game, SPLAT_OBJECT_ID);
  if (!sw) {
    console.warn(`[EarthEscape] Splat pulse unavailable (missing ${SPLAT_OBJECT_ID})`);
    return;
  }
  game._earthEscapeSplatPulse = {
    ...sw,
    timer: ESCAPE_PULSE_INTERVAL * 0.5,
    active: 0,
  };
}

function clearSplatPulse(game) {
  const pulse = game._earthEscapeSplatPulse;
  if (!pulse) return;
  clearSplatShockwave(game, pulse);
  game._earthEscapeSplatPulse = null;
}

function updateSplatPulse(game, delta, progress) {
  const pulse = game._earthEscapeSplatPulse;
  if (!pulse) {
    updateEscapeFlashOverlay(0, progress);
    return;
  }

  let pulseIntensity = 0;
  if (pulse.active > 0) {
    pulse.active = Math.max(0, pulse.active - delta);
    const t = 1 - pulse.active / ESCAPE_PULSE_DURATION;
    const env = t < 0.2 ? t / 0.2 : (1 - t) / 0.8;
    pulseIntensity =
      Math.max(0, env) *
      ESCAPE_PULSE_MAX_INTENSITY *
      (0.75 + progress * 0.35);
    pulse.intensityDyno.value = pulseIntensity;
  } else {
    pulse.intensityDyno.value = 0;
    pulse.timer -= delta;
    if (pulse.timer <= 0) {
      pulse.timer = ESCAPE_PULSE_INTERVAL;
      pulse.active = ESCAPE_PULSE_DURATION;
    }
  }

  pulse.timeDyno.value = game.clock?.elapsedTime ?? 0;
  pulse.splatMesh.updateVersion();
  updateEscapeFlashOverlay(pulseIntensity, progress);
}

function addEscapeFlameGusher(game, pos, dir, scale) {
  if (!game._earthEscapeGushers) game._earthEscapeGushers = [];
  if (game._earthEscapeGushers.length >= MAX_GUSHERS) {
    game._earthEscapeGushers.shift();
  }
  game._earthEscapeGushers.push({
    pos,
    dir,
    scale,
    elapsed: 0,
    lifetime: GUSHER_LIFETIME + Math.random(),
    emitTimer: 0,
  });
}

function updateEscapeFlameGushers(game, delta) {
  const gushers = game._earthEscapeGushers;
  if (!gushers?.length) return;
  const fx = game.explosionEffect;
  if (!fx) return;

  for (let i = gushers.length - 1; i >= 0; i -= 1) {
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
        fireColorRange: ESCAPE_BIG_EXPLOSION_COLORS.fireColorRange,
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
  sampleConeDirection(cam, _dir);
  const hit = castRay(
    cam.position.x,
    cam.position.y,
    cam.position.z,
    cam.position.x + _dir.x * RAYCAST_MAX,
    cam.position.y + _dir.y * RAYCAST_MAX,
    cam.position.z + _dir.z * RAYCAST_MAX,
  );
  let dist = FALLBACK_DIST;
  if (hit) {
    const toi = Number(hit.timeOfImpact ?? hit.toi) || 0;
    if (toi > 1 && toi < RAYCAST_MAX) dist = toi;
  }
  const pos = cam.position.clone().addScaledVector(_dir, dist);
  const progress = escapeProgress(game);
  const particleScale = 1 + Math.sqrt(progress) * 1.5;
  const shockScale = 1 + Math.sqrt(progress);

  game.explosions.push(
    new Explosion(game.scene, pos, ESCAPE_FLASH, game.dynamicLights, {
      big: true,
      scaleMult: shockScale,
    }),
  );
  sfxManager.play("ship-explosion", pos, Math.min(1, 0.55 * particleScale));
  const fx = game.explosionEffect;
  if (fx) {
    const bigCount = Math.min(3, Math.ceil(1 + particleScale * 0.3));
    for (let k = 0; k < bigCount; k += 1) {
      fx.emitBigExplosion(pos, particleScale, ESCAPE_BIG_EXPLOSION_COLORS);
    }
    fx.emitExplosionParticles(
      pos,
      ESCAPE_FIRE_A,
      Math.ceil(60 + particleScale * 15),
      particleScale,
    );
    fx.emitExplosionParticles(
      pos,
      ESCAPE_FIRE_B,
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
  game.dynamicLights?.flash(pos, ESCAPE_FLASH, {
    intensity: 120 * shockScale,
    distance: 90 * shockScale,
    ttl: 0.2 * Math.max(1, shockScale * 0.4),
    fade: 0.45 * Math.max(1, shockScale * 0.4),
  });
}

function computeShakeOffset(game, phase) {
  const progress = escapeProgress(game);
  const quietAmp = 0.008 + progress * 0.012;
  const burstAmp = 0.06 + progress * 0.14;
  const burstT = phase.burstTimer ?? 0;
  const burstEnvelope =
    burstT > 0
      ? burstT < 0.15
        ? burstT / 0.15
        : Math.max(0, burstT / RUMBLE_BURST_DURATION)
      : 0;
  const amp = quietAmp + (burstAmp - quietAmp) * burstEnvelope;
  const t = game.clock.elapsedTime;
  const wobble =
    Math.sin(t * 37.2) * 0.5 +
    Math.sin(t * 21.5 + 1.7) * 0.35 +
    Math.sin(t * 53.1 + 0.3) * 0.15;
  const final = amp * (0.85 + 0.15 * wobble);
  return _shake.set(
    (Math.random() - 0.5) * 2 * final,
    (Math.random() - 0.5) * 2 * final,
    (Math.random() - 0.5) * 2 * final,
  );
}

function clearShakeOffset(game) {
  if (!game._earthEscapeShakeApplied) return;
  const rig =
    game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig
      : game.camera;
  if (rig) rig.position.sub(game._earthEscapeShakeApplied);
  game._earthEscapeShakeApplied = null;
}

export function applyEarthEscapeShakeStartFrame(game) {
  clearShakeOffset(game);
}

export function applyEarthEscapeShakeEndFrame(game) {
  if (!game._earthEscapeSequenceActive || !game._earthEscapeShakePhase) return;
  const rig =
    game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig
      : game.camera;
  if (!rig) return;
  const off = computeShakeOffset(game, game._earthEscapeShakePhase);
  rig.position.add(off);
  game._earthEscapeShakeApplied = off.clone();
}

export function completeEarthEscape(game) {
  if (game.isMultiplayer || game._earthEscapeCompleted) return;
  if (
    game.gameManager?.getState?.()?.currentMissionId !==
    "capital-ship-earth-defense"
  ) {
    return;
  }

  game._earthEscapeCompleted = true;
  clearShakeOffset(game);
  clearSplatPulse(game);
  clearEscapeFlashOverlay();
  hideEscapeHud(game);
  game._earthEscapeGushers = null;
  game._earthEscapeSequenceActive = false;
  game.gameManager?.setState?.({ earthEscapeActive: false });

  void runEarthEscapeOutroAndVictory(game);
}

const ESCAPE_FADE_MS = 2000;
const ESCAPE_OVERLAY_ID = "earth-escape-overlay";

function fadeEarthEscapeToBlack() {
  let el = document.getElementById(ESCAPE_OVERLAY_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ESCAPE_OVERLAY_ID;
    el.setAttribute("role", "presentation");
    document.body.appendChild(el);
  }
  el.classList.remove("earth-escape-overlay--visible");
  el.style.opacity = "0";
  void el.offsetWidth;

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      el.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const fallback = setTimeout(finish, ESCAPE_FADE_MS + 250);
    const onEnd = (e) => {
      if (e.target !== el || e.propertyName !== "opacity") return;
      finish();
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add("earth-escape-overlay--visible");
        el.addEventListener("transitionend", onEnd);
      });
    });
  });
}

async function runEarthEscapeOutroAndVictory(game) {
  try {
    await fadeEarthEscapeToBlack();
    document.getElementById(ESCAPE_OVERLAY_ID)?.remove();
    mountEarthOutroOverlayBlack();
    await runEarthOutroTypewriterAndFade({ retainBlackScreen: true });
  } catch (e) {
    console.warn("[EarthEscape] Outro sequence failed:", e);
  }

  game.missionManager?.completeMission("Earth Defense complete", {
    stepTitle: "Earth Defense",
    suppressCompleteMessage: true,
  });
  game.showMissionCompleteOverlay?.({
    title: "Victory",
    subtitle: "The rogue swarm has been defeated. Starspeed prevails.",
    menuOnly: true,
    solidBlackBackdrop: true,
    zIndex: 3200,
    outroOverlayId: "earth-outro-overlay",
    onMenu: async () => {
      hideMissionCompleteOverlay(game);
      document.getElementById("earth-outro-overlay")?.remove();
      leaveMatch(game);
    },
  });
}

function failEarthEscape(game) {
  clearShakeOffset(game);
  clearSplatPulse(game);
  clearEscapeFlashOverlay();
  hideEscapeHud(game);
  game._earthEscapeGushers = null;
  game._earthEscapeSequenceActive = false;
  game.gameManager?.setState?.({ earthEscapeActive: false });
  game.missionManager?.reportEvent?.("earthEscapeFailed", {});
}

export function startEarthEscapeSequence(game) {
  if (game.isMultiplayer || game._earthEscapeSequenceActive) return;
  game._earthEscapeSequenceActive = true;
  game._earthEscapeTimeLeft = ESCAPE_DURATION_SEC;
  game._earthEscapeExplosionTimer = 0.15;
  game._earthEscapeRumbleTimer =
    RUMBLE_INTERVAL_MIN +
    Math.random() * (RUMBLE_INTERVAL_MAX - RUMBLE_INTERVAL_MIN);
  game._earthEscapeBeepTimer = 2 + Math.random() * 3;
  game._earthEscapeShakePhase = { burstTimer: 0 };
  game._earthEscapeGushers = null;
  initSplatPulse(game);
  ensureEscapeHud(game);
  game.gameManager?.setState?.({ earthEscapeActive: true });
}

export function updateEarthEscapeSequence(game, delta) {
  if (!game._earthEscapeSequenceActive || game.isMultiplayer) return;
  const d = Math.max(0, delta);

  const el =
    game._earthEscapeHudEl ?? document.getElementById("earth-escape-countdown");
  if (el) {
    el.textContent = `ESCAPE ${Math.max(0, game._earthEscapeTimeLeft).toFixed(2)}`;
  }

  game._earthEscapeTimeLeft -= d;
  if (game._earthEscapeTimeLeft <= 0) {
    failEarthEscape(game);
    return;
  }

  const progress = escapeProgress(game);

  game._earthEscapeExplosionTimer -= d;
  if (game._earthEscapeExplosionTimer <= 0) {
    spawnMegaForwardExplosion(game);
    game._earthEscapeExplosionTimer =
      EXPLOSION_INTERVAL_MIN +
      Math.random() * (EXPLOSION_INTERVAL_MAX - EXPLOSION_INTERVAL_MIN);
  }

  const phase = game._earthEscapeShakePhase;
  if (phase.burstTimer > 0) {
    phase.burstTimer = Math.max(0, phase.burstTimer - d);
  }
  game._earthEscapeRumbleTimer -= d;
  if (game._earthEscapeRumbleTimer <= 0) {
    game._earthEscapeRumbleTimer =
      RUMBLE_INTERVAL_MIN +
      Math.random() * (RUMBLE_INTERVAL_MAX - RUMBLE_INTERVAL_MIN);
    phase.burstTimer = RUMBLE_BURST_DURATION;
    spawnMegaForwardExplosion(game);
    spawnMegaForwardExplosion(game);
    sfxManager.play("ship-explosion", game.camera.position, 0.35);
  }

  game._earthEscapeBeepTimer -= d;
  if (game._earthEscapeBeepTimer <= 0) {
    proceduralAudio.escapeWarningBeep(progress);
    const minInterval = 0.8;
    const maxInterval = 5;
    game._earthEscapeBeepTimer =
      minInterval +
      (1 - progress) * (maxInterval - minInterval) +
      Math.random() * 1.5;
  }

  updateSplatPulse(game, d, progress);
  updateEscapeFlameGushers(game, d);
}

export function stopEarthEscapeSequenceForLevelChange(game) {
  clearShakeOffset(game);
  clearSplatPulse(game);
  clearEscapeFlashOverlay();
  const hadHud =
    game._earthEscapeHudEl || document.getElementById("earth-escape-countdown");
  if (!game._earthEscapeSequenceActive && !hadHud) return;
  hideEscapeHud(game);
  game._earthEscapeSequenceActive = false;
  game._earthEscapeTimeLeft = 0;
  game._earthEscapeShakePhase = null;
  game._earthEscapeGushers = null;
  game._earthEscapeCompleted = false;
  game.gameManager?.setState?.({ earthEscapeActive: false });
}
