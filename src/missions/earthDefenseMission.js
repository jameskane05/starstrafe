export const earthDefenseMission = {
  id: "capital-ship-earth-defense",
  defaultLevelId: "earthdefense",
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
    },
  },
};

export default earthDefenseMission;
