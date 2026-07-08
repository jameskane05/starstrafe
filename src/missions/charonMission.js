import { spawnMissionWaveFromPool } from "../game/gameEnemies.js";
import { initCharonReactorCoreForCharonMission } from "../game/charonReactorCore.js";

/** Call when the Charon reactor core is destroyed; sets mission flags and queues Mobius taunt autoplay. */
export function notifyCharonReactorCoreDestroyed(game) {
  if (!game?.gameManager?.getState) return;
  if (game.gameManager.getState().currentMissionId !== "charon") return;
  game.gameManager.setState({
    charonReactorCoreDestroyed: true,
    charonMobiusReactorTauntPending: true,
  });
}

export const charonMission = {
  id: "charon",
  defaultLevelId: "charon",
  startStepId: "briefing",

  start(manager) {
    const game = manager.game;
    game.enemyRespawnQueue.length = 0;
    game.gameManager.setState({
      charonIntroTextDone: false,
      selectedMissileMode: "homing",
      playerLaserEnabled: true,
      playerMissilesEnabled: true,
      charonHeavyMissileIntroPending: false,
      charonHeavyMissileIntroDone: false,
      charonReactorCoreDestroyed: false,
      charonMobiusReactorTauntPending: false,
      charonMobiusReactorTauntDone: false,
      charonEscapeActive: false,
      charonEscapeSucceeded: false,
    });
    const positions = game._missionInitialEnemyPositions;
    if (positions?.length) {
      spawnMissionWaveFromPool(game, positions);
    }
    initCharonReactorCoreForCharonMission(game);
  },

  steps: {
    briefing: {
      title: "Charon",
      enter(manager) {
        manager.setObjectives("Charon", [
          {
            id: "awaitBriefing",
            text: "Await mission briefing.",
            completed: false,
          },
        ]);
      },
      onEvent(manager, type, _payload) {
        if (type === "charonTriggerMain") {
          // Dialog: levelTriggerData playDialog → charonControlRoomIced
        }
        if (type === "charonEscapeComplete") {
          manager.setObjectives("Charon", [
            {
              id: "evacuated",
              text: "Reached the main dome.",
              completed: true,
            },
          ]);
        }
      },
    },
  },
};

export default charonMission;
