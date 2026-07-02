import { spawnAuthoredEnemiesFast } from "../game/gameEnemies.js";
import * as THREE from "three";
import proceduralAudio from "../audio/ProceduralAudio.js";
import { stopSaturnaliaCollapseForLevelChange } from "../game/saturnaliaCollapseSequence.js";
import {
  createSaturnaliaChaseController,
  disposeSaturnaliaChase,
  prewarmSaturnaliaChase,
  startSaturnaliaChase,
  startSaturnaliaChaseEscape,
  updateSaturnaliaChase,
} from "./saturnaliaChase.js";

const CANNON_TRACK_MAX_DISTANCE = 150;
const _trackWorld = new THREE.Vector3();
const _trackProjected = new THREE.Vector3();

function ensureCannonTrackerElement(manager) {
  if (manager.runtime.cannonTrackerEl) return manager.runtime.cannonTrackerEl;
  const el = document.createElement("div");
  el.className = "objective-tracker";
  el.innerHTML =
    '<span class="objective-tracker-diamond">◇</span>CHARGING CANNON';
  document.body.appendChild(el);
  manager.runtime.cannonTrackerEl = el;
  return el;
}

function getChargingCannonPickup(game) {
  return game._weaponPickups?.find(
    (pickup) => pickup.type === "charging_laser" && pickup.active,
  );
}

function enableChargingCannonTracker(manager) {
  manager.runtime.trackChargingCannon = true;
  manager.runtime.cannonTrackerShown = false;
  ensureCannonTrackerElement(manager);
}

/** Intro animation + acquisition chirp; no-op while already shown. */
function showCannonTracker(manager) {
  if (manager.runtime.cannonTrackerShown) return;
  manager.runtime.cannonTrackerShown = true;
  ensureCannonTrackerElement(manager).classList.add("visible");
  proceduralAudio.objectiveTrackerOn();
}

/** Outro (CSS transition back to faded/shrunk) + dismissal chirp. */
function dismissCannonTracker(manager, { silent = false } = {}) {
  if (!manager.runtime.cannonTrackerShown) return;
  manager.runtime.cannonTrackerShown = false;
  manager.runtime.cannonTrackerEl?.classList.remove("visible");
  if (!silent) proceduralAudio.objectiveTrackerOff();
}

function updateChargingCannonTracker(manager) {
  if (!manager.runtime.trackChargingCannon) return;
  const game = manager.game;
  const pickup = getChargingCannonPickup(game);
  if (!pickup?.collectible?.group || !game.camera) {
    // Picked up (or gone) — dismiss for good.
    dismissCannonTracker(manager);
    manager.runtime.trackChargingCannon = false;
    return;
  }

  pickup.collectible.group.getWorldPosition(_trackWorld);
  const dist = _trackWorld.distanceTo(game.camera.position);
  if (dist > CANNON_TRACK_MAX_DISTANCE) {
    // Out of range — dismiss but keep tracking so it returns in range.
    dismissCannonTracker(manager);
    return;
  }

  const el = ensureCannonTrackerElement(manager);
  _trackProjected.copy(_trackWorld).project(game.camera);
  const inFront = _trackProjected.z < 1;
  if (!inFront) {
    // Behind the camera: hide without outro/beeps, stays "shown" logically.
    el.style.visibility = "hidden";
    return;
  }
  el.style.visibility = "";

  const vp = window.visualViewport;
  const width = vp ? Math.round(vp.width) : window.innerWidth;
  const height = vp ? Math.round(vp.height) : window.innerHeight;
  const x = THREE.MathUtils.clamp((_trackProjected.x * 0.5 + 0.5) * width, 32, width - 32);
  const y = THREE.MathUtils.clamp((-_trackProjected.y * 0.5 + 0.5) * height, 32, height - 32);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  showCannonTracker(manager);
}

export const saturnaliaMission = {
  id: "saturnalia",
  defaultLevelId: "saturnalia",
  startStepId: "arrival",

  async start(manager) {
    const game = manager.game;
    disposeSaturnaliaChase(game);
    stopSaturnaliaCollapseForLevelChange(game);
    game.enemyRespawnQueue.length = 0;
    game.gameManager.setState({
      selectedMissileMode: "homing",
      playerLaserEnabled: true,
      playerMissilesEnabled: true,
    });

    const positions = game.spawnPoints?.map((p) => p.clone()) ?? [];
    if (positions.length) {
      await spawnAuthoredEnemiesFast(game, positions);
    }
    game._saturnaliaChase = createSaturnaliaChaseController(game);
    prewarmSaturnaliaChase(game);
  },

  steps: {
    arrival: {
      title: "Saturnalia",
      enter(manager) {
        manager.setObjectives("Saturnalia", [
          {
            id: "arrive",
            text: "Reach Saturnalia.",
            completed: false,
          },
        ]);
      },
      onEvent(manager, type, payload) {
        if (type === "saturnaliaChaseStart") {
          const chase = startSaturnaliaChase(manager.game);
          if (chase?.enemy?.mesh) {
            manager.setDirectionalHelperTarget({
              type: "saturnaliaChase",
              object3D: chase.enemy.mesh,
            });
          }
          manager.updateObjective("arrive", {
            text: "Pursue the fleeing signal through Saturnalia.",
          });
        } else if (type === "saturnaliaTrackChargingCannon") {
          enableChargingCannonTracker(manager);
        } else if (
          type === "dialogMissionMilestone" &&
          payload?.event === "saturnaliaChaseEscape" &&
          !manager.runtime.chaseEscapeStarted
        ) {
          manager.runtime.chaseEscapeStarted = true;
          startSaturnaliaChaseEscape(manager.game);
        } else if (type === "saturnaliaChaseEscaped") {
          manager.updateObjective("arrive", {
            text: "Escape Saturnalia.",
          });
          // Let the departure explosion play out before Starspeed reacts.
          manager.runtime.fuseDialogTimer = 2;
        }
      },
      update(manager, delta) {
        updateSaturnaliaChase(manager.game, delta);
        updateChargingCannonTracker(manager);
        if (manager.runtime.fuseDialogTimer != null) {
          manager.runtime.fuseDialogTimer -= delta;
          if (manager.runtime.fuseDialogTimer <= 0) {
            manager.runtime.fuseDialogTimer = null;
            manager.game.dialogManager?.playDialog?.(
              "saturnaliaDidTheyJustLightTheFuse",
            );
          }
        }
      },
    },
  },
};

export default saturnaliaMission;
