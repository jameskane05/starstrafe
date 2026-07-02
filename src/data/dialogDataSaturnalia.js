import { GAME_STATES } from "./gameData.js";
import { say, dialogPublicUrl } from "./dialogDataHelpers.js";

export const saturnaliaDialogTracks = {
  saturnaliaLookAtThisPlace: {
    id: "saturnaliaLookAtThisPlace",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-01-look-at-this-place.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-01-look-at-this-place.json",
    ),
    captions: [
      say("Look at this place.", 1.14, 0.36),
      say("All the wealth of the universe", 1.5, 3.18),
      say("concentrated in one space station", 2.48, 4.72),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
      missionStepId: "arrival",
    },
    autoPlay: true,
    priority: 200,
    delay: 1,
    once: true,
    playNext: "saturnaliaWhoeverControlsSwarm",
  },
  saturnaliaWhoeverControlsSwarm: {
    id: "saturnaliaWhoeverControlsSwarm",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-02-its-possible-whoever-controls-the-swarm.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-02-its-possible-whoever-controls-the-swarm.json",
    ),
    captions: [
      say("It's possible whoever controls the swarm is here.", 2.67),
      say("There's a comms beacon ahead.", 1.52, 3.63),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
      missionStepId: "arrival",
    },
    autoPlay: false,
    priority: 200,
    once: true,
    playNext: "saturnaliaLeaderStickTogether",
  },
  saturnaliaLeaderStickTogether: {
    id: "saturnaliaLeaderStickTogether",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-03-well-stick-together-this-time-kid.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-03-well-stick-together-this-time-kid.json",
    ),
    captions: [
      say("We'll stick together this time, kid.", 1.8, 0.2),
      say("I'm your wing.", 0.58, 2.74),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
      missionStepId: "arrival",
    },
    autoPlay: false,
    priority: 200,
    once: true,
  },
  saturnaliaPilotHelpUs: {
    id: "saturnaliaPilotHelpUs",
    speakerId: "colonist",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-04-pilot-help-us.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-04-pilot-help-us.json",
    ),
    captions: [
      say("Pilot, help us!", 1.0),
      say("Follow this drone.", 1.2, 1.08),
      say("We hacked it.", 0.86, 2.42),
      say("We don't have much time.", 1.18, 3.42),
      say("They're trying to get in.", 1.42, 4.78),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 220,
    once: true,
    playNext: "saturnaliaWellFollowAlong",
  },
  saturnaliaWellFollowAlong: {
    id: "saturnaliaWellFollowAlong",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-05-well-follow-along.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-05-well-follow-along.json",
    ),
    captions: [
      say("We'll follow along.", 0.96, 0.15),
      say("We're right behind you", 0.82, 1.69),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 220,
    once: true,
  },
  saturnaliaFlyThroughBoosterGates: {
    id: "saturnaliaFlyThroughBoosterGates",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-06-fly-through-those-booster-gates.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-06-fly-through-those-booster-gates.json",
    ),
    captions: [
      say("Fly through those booster gates.", 1.52, 0.28),
      say("You'll get a burst of speed", 1.44, 2.12),
      say("and your thrusters will stay at one hundred", 2.1, 3.62),
      say("for several seconds", 1.04, 5.8),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  saturnaliaGettingHairy: {
    id: "saturnaliaGettingHairy",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-07-getting-hairy.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-07-getting-hairy.json",
    ),
    captions: [say("It's getting hairy out there", 1.16, 1.02)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "saturnaliaWeCanBlowByEm",
  },
  saturnaliaWeCanBlowByEm: {
    id: "saturnaliaWeCanBlowByEm",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-08-we-can-blow-by-em.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-08-we-can-blow-by-em.json",
    ),
    captions: [
      say("We can blow by 'em.", 0.94, 0.14),
      say("They can't keep up", 0.86, 1.46),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  saturnaliaKeepGoing: {
    id: "saturnaliaKeepGoing",
    speakerId: "colonist",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-09-keep-going.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-09-keep-going.json",
    ),
    captions: [
      say("Keep going through the transit station,", 2.6, 0.34),
      say("then down", 0.68, 3.68),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "saturnaliaWaitUndercity",
  },
  saturnaliaWaitUndercity: {
    id: "saturnaliaWaitUndercity",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-10-wait-youre-in-the-undercity.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-10-wait-youre-in-the-undercity.json",
    ),
    captions: [
      say("Wait,", 0.22, 0.78),
      say("you're in the undercity?", 1, 2.16),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "saturnaliaWeFledDownHere",
  },
  saturnaliaWeFledDownHere: {
    id: "saturnaliaWeFledDownHere",
    speakerId: "colonist",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-11-we-fled-down-here.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-11-we-fled-down-here.json",
    ),
    captions: [
      say("We fled down here when the drones turned on us.", 2.64, 0.22),
      say("We're trapped", 0.66, 3.44),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  saturnaliaSpooky: {
    id: "saturnaliaSpooky",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-12-spooky.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-12-spooky.json",
    ),
    captions: [
      say("Spooky.", 0.62, 1.02),
      say("Who designed the subcity like this?", 2.14, 2.56),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "saturnaliaYouThinkPeopleMadeThisPlace",
  },
  saturnaliaYouThinkPeopleMadeThisPlace: {
    id: "saturnaliaYouThinkPeopleMadeThisPlace",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-13-you-think-people-made-this-place.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-13-you-think-people-made-this-place.json",
    ),
    captions: [say("You think *people* made this place?", 3, 0.36)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  saturnaliaChargingCannonUpgrade: {
    id: "saturnaliaChargingCannonUpgrade",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-14-charging-cannon-upgrade.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-14-charging-cannon-upgrade.json",
    ),
    captions: [say("Sir, there's a charging cannon upgrade ahead", 2.84, 0.31)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "saturnaliaPickItUpStarspeed",
  },
  saturnaliaPickItUpStarspeed: {
    id: "saturnaliaPickItUpStarspeed",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-15-pick-it-up-starspeed.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-15-pick-it-up-starspeed.json",
    ),
    captions: [
      say("Pick it up, Starspeed!", 1.04, 0.3),
      say("Hold your fire button to charge,", 1.64, 2.06),
      say("release to fire.", 1.1, 3.98),
      say("This will tear through them like butter.", 1.62, 5.62),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  saturnaliaComeOnJustALittleFurther: {
    id: "saturnaliaComeOnJustALittleFurther",
    speakerId: "colonist",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-16-come-on-just-a-little-further.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-16-come-on-just-a-little-further.json",
    ),
    captions: [say("Come on, just a little farther!", 1.7, 0.25)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "saturnaliaNoVitalsDetected",
  },
  saturnaliaNoVitalsDetected: {
    id: "saturnaliaNoVitalsDetected",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-17-sir-no-vitals-are-detected.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-17-sir-no-vitals-are-detected.json",
    ),
    captions: [say("Sir, no vitals are detected anywhere nearby.", 3.88, 0.48)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "saturnaliaWhatWasThat",
  },
  saturnaliaWhatWasThat: {
    id: "saturnaliaWhatWasThat",
    speakerId: "colonist",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-18-what-was-that.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-18-what-was-that.json",
    ),
    captions: [
      say("What was that?", 0.46, 0.48),
      say("Really, we're just ahead", 1.16, 2.34),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  saturnaliaIDontLikeThis: {
    id: "saturnaliaIDontLikeThis",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-19-i-dont-like-this.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-19-i-dont-like-this.json",
    ),
    captions: [
      say("I don't like this.", 0.92, 0.5),
      say(
        "No way these weird assholes are down in the engine rooms.",
        2.92,
        2.38,
      ),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "saturnaliaMobiusLaughs",
  },
  saturnaliaMobiusLaughs: {
    id: "saturnaliaMobiusLaughs",
    speakerId: "mobius",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-20-mobius-laughs.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-20-mobius-laughs.json",
    ),
    captions: [say("[laughs]", 3)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 210,
    placeholderAnimation: true,
    once: true,
    missionMilestones: [{ atTimeSec: 0.1, event: "saturnaliaChaseEscape" }],
  },
  saturnaliaDidTheyJustLightTheFuse: {
    id: "saturnaliaDidTheyJustLightTheFuse",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-21-did-they-just-light-the-fuse.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/saturnalia/saturn-21-did-they-just-light-the-fuse.json",
    ),
    captions: [
      say(
        "Did they just light the fuse on the hundred trillion dollar luxury space station?",
        4.36,
        0.36,
      ),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "saturnalia",
    },
    autoPlay: false,
    priority: 220,
    once: true,
  },
};
