import { spawnAuthoredEnemiesFast } from "../game/gameEnemies.js";
import {
  enableWeaponPickupTracker,
  updateWeaponPickupTracker,
} from "./weaponPickupTracker.js";
import {
  stopSaturnaliaCollapseForLevelChange,
  armSaturnaliaDestructionCountdown,
  pauseSaturnaliaDestructionCountdown,
  completeSaturnaliaEscape,
} from "../game/saturnaliaCollapseSequence.js";
import {
  createSaturnaliaChaseController,
  disposeSaturnaliaChase,
  prewarmSaturnaliaChase,
  startSaturnaliaChase,
  startSaturnaliaChaseEscape,
  alignSaturnaliaDebugSpawn,
  updateSaturnaliaChase,
} from "./saturnaliaChase.js";

const SATURNALIA_WEAPON_TRACKER_ID = "saturnaliaGatlingGun";

export const saturnaliaMission = {
  id: "saturnalia",
  defaultLevelId: "saturnalia",
  startStepId: "arrival",

  async start(manager, options = {}) {
    const game = manager.game;
    disposeSaturnaliaChase(game);
    stopSaturnaliaCollapseForLevelChange(game);
    game._saturnaliaEscapeCompleted = false;
    game.enemyRespawnQueue.length = 0;
    game.gameManager.setState({
      selectedMissileMode: "homing",
      playerLaserEnabled: true,
      playerMissilesEnabled: true,
      saturnaliaCollapseActive: false,
      saturnaliaEscapeSucceeded: false,
      saturnaliaIntroTextDone: false,
    });

    const positions = game.spawnPoints?.map((p) => p.clone()) ?? [];
    if (positions.length) {
      await spawnAuthoredEnemiesFast(game, positions);
    }
    game._saturnaliaChase = await createSaturnaliaChaseController(game);
    prewarmSaturnaliaChase(game);
    if (options.debugSpawnIndex != null) {
      const chase = startSaturnaliaChase(game);
      alignSaturnaliaDebugSpawn(game);
      if (chase?.enemy?.mesh) {
        manager.setDirectionalHelperTarget({
          type: "saturnaliaChase",
          object3D: chase.enemy.mesh,
        });
      }
      manager.runtime.debugChaseStarted = true;
    }
  },

  steps: {
    arrival: {
      title: "Saturnalia",
      enter(manager) {
        const chaseStarted = manager.runtime.debugChaseStarted === true;
        manager.setObjectives("Saturnalia", [
          {
            id: "arrive",
            text: chaseStarted
              ? "Pursue the fleeing signal through Saturnalia."
              : "Reach Saturnalia.",
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
          enableWeaponPickupTracker(manager, {
            id: SATURNALIA_WEAPON_TRACKER_ID,
            pickupType: "gatling",
            label: "GATLING GUN",
          });
        } else if (type === "saturnaliaArmDestructionCountdown") {
          armSaturnaliaDestructionCountdown(manager.game, { paused: true });
        } else if (
          type === "dialogMissionMilestone" &&
          payload?.event === "saturnaliaChaseEscape" &&
          !manager.runtime.chaseEscapeStarted
        ) {
          manager.runtime.chaseEscapeStarted = true;
          pauseSaturnaliaDestructionCountdown(manager.game);
          startSaturnaliaChaseEscape(manager.game);
        } else if (type === "saturnaliaChaseEscaped") {
          manager.updateObjective("arrive", {
            text: "Escape Saturnalia.",
          });
          // Let the departure explosion play out before Starspeed reacts.
          manager.runtime.fuseDialogTimer = 2;
        } else if (type === "saturnaliaEscapeComplete") {
          void completeSaturnaliaEscape(manager.game, manager);
        }
      },
      update(manager, delta) {
        updateSaturnaliaChase(manager.game, delta);
        updateWeaponPickupTracker(manager, SATURNALIA_WEAPON_TRACKER_ID);
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
