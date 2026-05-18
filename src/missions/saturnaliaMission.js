export const saturnaliaMission = {
  id: "saturnalia-rhea",
  defaultLevelId: "saturnalia",
  startStepId: "arrival",

  start(manager) {
    const game = manager.game;
    game.enemyRespawnQueue.length = 0;
    game.gameManager.setState({
      selectedMissileMode: "homing",
      playerLaserEnabled: true,
      playerMissilesEnabled: true,
    });
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
    },
  },
};

export default saturnaliaMission;
