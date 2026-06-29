import { charonMission } from "./charonMission.js";
import { saturnaliaMission } from "./saturnaliaMission.js";
import { trainingGroundsMission } from "./trainingGroundsMission.js";
import { earthDefenseMission } from "./earthDefenseMission.js";

export const MISSIONS = {
  charon: charonMission,
  saturnalia: saturnaliaMission,
  trainingGrounds: trainingGroundsMission,
  earthdefense: earthDefenseMission,
  "capital-ship-earth-defense": earthDefenseMission,
};
