import {
  spawnMissionWaveFromPool,
  EARTH_DEFENSE_POOL_SIZE,
  initEarthDefenseMissionEnemyPool,
} from "../game/gameEnemies.js";
import {
  startEarthBossFight,
  updateEarthBossFight,
  preloadEarthBossSentinel,
  prewarmEarthBossSentinel,
} from "../game/earthBossFight.js";
import { preloadBarrierModel } from "../game/levelBarriers.js";
import {
  startEarthEscapeSequence,
  updateEarthEscapeSequence,
  completeEarthEscape,
} from "../game/earthEscapeSequence.js";
import {
  PRIMARY_WEAPONS,
  unlockPrimaryWeapon,
} from "../game/weaponUnlocks.js";
import {
  enableWeaponPickupTracker,
  updateWeaponPickupTracker,
} from "./weaponPickupTracker.js";
import {
  enableLevelBarrierTracker,
  updateLevelBarrierTracker,
} from "./levelBarrierTracker.js";

const EARTH_CHARGING_CANNON_TRACKER_ID = "earthChargingCannon";
const EARTH_BARRIER_TRACKER_ID = "earthBarrier";

export const earthDefenseMission = {
  id: "capital-ship-earth-defense",
  defaultLevelId: "earthdefense",
  startStepId: "arrival",

  async start(manager) {
    const game = manager.game;
    game.enemyRespawnQueue.length = 0;
    void preloadEarthBossSentinel(game)
      .then(() => prewarmEarthBossSentinel(game))
      .catch((error) => {
        console.warn("[EarthBoss] Sentinel preload failed:", error);
      });
    void preloadBarrierModel().catch((error) => {
      console.warn("[EarthDefense] Barrier model preload failed:", error);
    });
    unlockPrimaryWeapon(PRIMARY_WEAPONS.GATLING);
    if (game.player) {
      game.player.primaryWeaponUnlocks = {
        ...(game.player.primaryWeaponUnlocks || {}),
        [PRIMARY_WEAPONS.GATLING]: true,
      };
    }
    game._earthEscapeCompleted = false;
    game.gameManager.setState({
      selectedMissileMode: "homing",
      playerLaserEnabled: true,
      playerMissilesEnabled: true,
      earthIntroTextDone: false,
      earthEscapeActive: false,
    });
    game.setPrimaryWeapon?.(PRIMARY_WEAPONS.GATLING);

    if (!game.spawnPoints?.length) {
      game._extractSpawnPoints?.();
    }
    if (!game._missionInitialEnemyPositions?.length && game.spawnPoints?.length) {
      game._missionInitialEnemyPositions = game.spawnPoints.map((p) => p.clone());
      game._missionEnemyPerSlotOptions = game.spawnPoints.map((_, i) => ({
        isHeavy: game.enemySpawnHeavyFlags?.[i] === true,
        isPortalBot: game.enemySpawnPortalFlags?.[i] === true,
      }));
    }

    if (!game._missionEnemyPool?.length) {
      await initEarthDefenseMissionEnemyPool(game);
    }

    const positions = game._missionInitialEnemyPositions;
    if (positions?.length) {
      const spawned = spawnMissionWaveFromPool(game, positions, {
        initialCount: EARTH_DEFENSE_POOL_SIZE,
        activateRadius: 480,
        maxSpawnsPerFrame: 6,
      });
      if (!spawned) {
        console.warn(
          "[EarthDefense] Failed to spawn mission enemies (pool or positions missing)",
        );
      }
    } else {
      console.warn("[EarthDefense] No authored enemy spawn positions found");
    }
  },

  steps: {
    arrival: {
      title: "Earth Defense",
      enter(manager) {
        manager.setObjectives("Earth Defense", [
          {
            id: "arrive",
            text: "Engage the capital ship.",
            completed: false,
          },
        ]);
      },
      onEvent(manager, type, payload) {
        if (
          type === "weaponPickupCollected" &&
          payload?.weapon === PRIMARY_WEAPONS.CHARGING_LASER
        ) {
          manager.game.dialogManager?.playDialog?.(
            "earthNowThatIsSomeFirepower",
          );
        } else if (type === "levelBarrierDestroyed") {
          manager.game.dialogManager?.playDialog?.("earthWereIn");
          startEarthBossFight(manager.game, { engage: false });
        } else if (type === "earthBossFightStart") {
          startEarthBossFight(manager.game, { engage: true });
          manager.updateObjective("arrive", {
            text: "Destroy the Primean.",
          });
        } else if (type === "earthBossDefeated") {
          manager.updateObjective("arrive", {
            text: "Primean destroyed.",
            completed: true,
          });
        } else if (
          type === "dialogCompleted" &&
          payload?.id === "earthAlrightYouKnowTheDrill"
        ) {
          manager.updateObjective("arrive", {
            text: "Return to the extraction point.",
            completed: false,
          });
          startEarthEscapeSequence(manager.game);
        } else if (type === "earthEscapeComplete") {
          completeEarthEscape(manager.game);
        } else if (type === "earthEscapeFailed") {
          manager.updateObjective("arrive", {
            text: "Escape failed.",
            completed: false,
          });
        } else if (
          type === "dialogMissionMilestone" &&
          payload?.event === "earthTrackChargingCannon"
        ) {
          enableWeaponPickupTracker(manager, {
            id: EARTH_CHARGING_CANNON_TRACKER_ID,
            pickupType: "charging_laser",
            label: "CHARGING CANNON",
          });
        } else if (
          type === "dialogMissionMilestone" &&
          payload?.event === "earthTrackBarrier"
        ) {
          enableLevelBarrierTracker(manager, {
            id: EARTH_BARRIER_TRACKER_ID,
            label: "BARRIER",
          });
        }
      },
      update(manager, delta) {
        updateEarthBossFight(manager.game, delta);
        updateEarthEscapeSequence(manager.game, delta);
        updateWeaponPickupTracker(manager, EARTH_CHARGING_CANNON_TRACKER_ID);
        updateLevelBarrierTracker(manager, EARTH_BARRIER_TRACKER_ID);
      },
    },
  },
};

export default earthDefenseMission;
