import * as THREE from "three";
import proceduralAudio from "../audio/ProceduralAudio.js";

const TRACK_MAX_DISTANCE = 600;
const _trackWorld = new THREE.Vector3();
const _trackProjected = new THREE.Vector3();

function getTrackerState(manager, id) {
  if (!manager.runtime._weaponPickupTrackers) {
    manager.runtime._weaponPickupTrackers = {};
  }
  if (!manager.runtime._weaponPickupTrackers[id]) {
    manager.runtime._weaponPickupTrackers[id] = {
      enabled: false,
      shown: false,
      el: null,
      pickupType: null,
      label: null,
    };
  }
  return manager.runtime._weaponPickupTrackers[id];
}

function ensureTrackerElement(state, label) {
  if (state.el) {
    if (label && state.label !== label) {
      state.el.innerHTML = `<span class="objective-tracker-diamond">◇</span>${label}`;
      state.label = label;
    }
    return state.el;
  }
  const el = document.createElement("div");
  el.className = "objective-tracker";
  el.innerHTML = `<span class="objective-tracker-diamond">◇</span>${label}`;
  document.body.appendChild(el);
  state.el = el;
  state.label = label;
  return el;
}

function getWeaponPickup(game, pickupType) {
  return game._weaponPickups?.find(
    (pickup) => pickup.type === pickupType && pickup.active,
  );
}

function showTracker(state) {
  if (state.shown) return;
  state.shown = true;
  state.el?.classList.add("visible");
  proceduralAudio.objectiveTrackerOn();
}

function dismissTracker(state, { silent = false } = {}) {
  if (!state.shown) return;
  state.shown = false;
  state.el?.classList.remove("visible");
  if (!silent) proceduralAudio.objectiveTrackerOff();
}

export function enableWeaponPickupTracker(manager, { id, pickupType, label }) {
  const state = getTrackerState(manager, id);
  const alreadyTracking =
    state.enabled && state.pickupType === pickupType && state.label === label;
  state.enabled = true;
  state.pickupType = pickupType;
  if (!alreadyTracking) state.shown = false;
  ensureTrackerElement(state, label);
}

export function updateWeaponPickupTracker(manager, id) {
  const state = manager.runtime._weaponPickupTrackers?.[id];
  if (!state?.enabled) return;

  const game = manager.game;
  if (!game.camera) return;

  const pickup = getWeaponPickup(game, state.pickupType);
  if (!pickup?.collectible?.group) {
    const anyActiveOfType = game._weaponPickups?.some(
      (entry) => entry.type === state.pickupType && entry.active,
    );
    if (!anyActiveOfType) {
      dismissTracker(state);
      state.enabled = false;
    } else {
      dismissTracker(state, { silent: true });
    }
    return;
  }

  pickup.collectible.group.getWorldPosition(_trackWorld);
  const dist = _trackWorld.distanceTo(game.camera.position);
  if (dist > TRACK_MAX_DISTANCE) {
    dismissTracker(state);
    return;
  }

  const el = ensureTrackerElement(state, state.label);
  _trackProjected.copy(_trackWorld).project(game.camera);
  const inFront = _trackProjected.z < 1;
  if (!inFront) {
    el.style.visibility = "hidden";
    return;
  }
  el.style.visibility = "";

  const vp = window.visualViewport;
  const width = vp ? Math.round(vp.width) : window.innerWidth;
  const height = vp ? Math.round(vp.height) : window.innerHeight;
  const x = THREE.MathUtils.clamp(
    (_trackProjected.x * 0.5 + 0.5) * width,
    32,
    width - 32,
  );
  const y = THREE.MathUtils.clamp(
    (-_trackProjected.y * 0.5 + 0.5) * height,
    32,
    height - 32,
  );
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  showTracker(state);
}

export function disposeWeaponPickupTrackers(manager) {
  const trackers = manager.runtime._weaponPickupTrackers;
  if (!trackers) return;
  for (const state of Object.values(trackers)) {
    state.el?.remove();
  }
  manager.runtime._weaponPickupTrackers = {};
}
