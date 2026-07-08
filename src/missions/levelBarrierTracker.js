import * as THREE from "three";
import proceduralAudio from "../audio/ProceduralAudio.js";

const TRACK_MAX_DISTANCE = 600;
const _trackWorld = new THREE.Vector3();
const _trackProjected = new THREE.Vector3();

function getTrackerState(manager, id) {
  if (!manager.runtime._levelBarrierTrackers) {
    manager.runtime._levelBarrierTrackers = {};
  }
  if (!manager.runtime._levelBarrierTrackers[id]) {
    manager.runtime._levelBarrierTrackers[id] = {
      enabled: false,
      shown: false,
      el: null,
      label: null,
    };
  }
  return manager.runtime._levelBarrierTrackers[id];
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

function getActiveBarrierTarget(game) {
  const barrier = game._levelBarriers?.find((entry) => entry.active) ?? null;
  if (!barrier) return null;
  return barrier.visual || barrier.mesh || null;
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

export function enableLevelBarrierTracker(manager, { id, label }) {
  const state = getTrackerState(manager, id);
  const alreadyTracking =
    state.enabled && state.label === label;
  state.enabled = true;
  if (!alreadyTracking) state.shown = false;
  ensureTrackerElement(state, label);
}

export function updateLevelBarrierTracker(manager, id) {
  const state = manager.runtime._levelBarrierTrackers?.[id];
  if (!state?.enabled) return;

  const game = manager.game;
  if (!game.camera) return;

  const target = getActiveBarrierTarget(game);
  if (!target) {
    dismissTracker(state);
    state.enabled = false;
    return;
  }

  target.getWorldPosition(_trackWorld);
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

export function disposeLevelBarrierTrackers(manager) {
  const trackers = manager.runtime._levelBarrierTrackers;
  if (!trackers) return;
  for (const state of Object.values(trackers)) {
    state.el?.remove();
  }
  manager.runtime._levelBarrierTrackers = {};
}
