import { spawnAuthoredEnemiesFast } from "../game/gameEnemies.js";
import {
  createSaturnaliaChaseController,
  disposeSaturnaliaChase,
  prewarmSaturnaliaChase,
  startSaturnaliaChase,
  updateSaturnaliaChase,
} from "./saturnaliaChase.js";

export const saturnaliaMission = {
  id: "saturnalia",
  defaultLevelId: "saturnalia",
  startStepId: "arrival",

  async start(manager) {
    const game = manager.game;
    disposeSaturnaliaChase(game);
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
      onEvent(manager, type) {
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
        }
      },
      update(manager, delta) {
        updateSaturnaliaChase(manager.game, delta);
      },
    },
  },
};

export default saturnaliaMission;
