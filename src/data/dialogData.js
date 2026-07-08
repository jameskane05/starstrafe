import { checkCriteria } from "./sceneData.js";
import { sayAs } from "./dialogDataHelpers.js";
import { trainingGroundsDialogTracks } from "./dialogDataTraining.js";
import { charonDialogTracks } from "./dialogDataCharon.js";
import { saturnaliaDialogTracks } from "./dialogDataSaturnalia.js";
import { earthDialogTracks } from "./dialogDataEarth.js";

export { sayAs };

export const dialogSpeakers = {
  alcair: {
    id: "alcair",
    label: "ALCAIR",
    vrmUrl: "./vrm/alcair-opt.vrm",
  },
  flightControl: {
    id: "flightControl",
    label: "FLIGHT CONTROL",
    vrmUrl: "./vrm/flightControl-opt.vrm",
  },
  leader: {
    id: "leader",
    label: "LEADER",
    vrmUrl: "./vrm/leader-opt.vrm",
    cameraOffset: { z: 0.12 },
  },
  starspeed: {
    id: "starspeed",
    label: "STARSPEED",
    vrmUrl: "./vrm/starspeed-opt.vrm",
    cameraOffset: { z: 0.12 },
  },
  mobius: {
    id: "mobius",
    label: "MOBIUS",
    vrmUrl: "./vrm/mobius-opt.vrm",
    cameraOffset: { z: 0.22 },
  },
  colonist: {
    id: "colonist",
    label: "COLONIST",
    vrmUrl: "./vrm/colonist.vrm",
    cameraOffset: { z: 0.12 },
  },
};

export const dialogTracks = {
  ...trainingGroundsDialogTracks,
  ...charonDialogTracks,
  ...saturnaliaDialogTracks,
  ...earthDialogTracks,
};

export function getDialogsForState(state, playedDialogs = new Set()) {
  const autoPlayDialogs = Object.values(dialogTracks).filter(
    (d) => d.autoPlay === true,
  );
  const sorted = autoPlayDialogs.sort(
    (a, b) => (b.priority || 0) - (a.priority || 0),
  );
  const matching = [];
  for (const dialog of sorted) {
    if (dialog.once && playedDialogs.has(dialog.id)) continue;
    if (!dialog.criteria || checkCriteria(state, dialog.criteria)) {
      matching.push(dialog);
    }
  }
  return matching;
}

export function getDialogById(id) {
  return dialogTracks[id] || null;
}

export function getDialogSpeakerById(id) {
  return dialogSpeakers[id] || null;
}

export default dialogTracks;
