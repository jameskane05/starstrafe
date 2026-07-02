import { GAME_STATES } from "./gameData.js";
import { say, dialogPublicUrl } from "./dialogDataHelpers.js";

export const trainingGroundsDialogTracks = {
  trainingGroundsIntro: {
    id: "trainingGroundsIntro",
    speakerId: "alcair",
    audio: dialogPublicUrl("audio/dialog/training/training-00-greetings.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/training/training-00-greetings.json"),
    captions: [
      say("Greetings, Starspeed!", 3.54),
      say("I am Alcair, your shipboard computer,", 3.0),
      say("here to guide you through this training exercise", 3.56),
      say("for the XR0 anti-gravity starfighter.", 5.0),
      say("Flight control, do you read?", 2.52),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "introDialog",
    },
    autoPlay: true,
    priority: 200,
    placeholderAnimation: true,
    delay: 3,
    playNext: "trainingGroundsIntroFollowUp",
  },
  trainingGroundsIntroFollowUp: {
    id: "trainingGroundsIntroFollowUp",
    speakerId: "flightControl",
    audio: dialogPublicUrl("audio/dialog/training/training-01-were-all-set.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/training/training-01-were-all-set.json"),
    captions: [
      say("We're all set.", 2.25),
      say("Let's get going, pilot.", 2.0),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "introDialog",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    playNext: {
      desktop: "trainingGroundsIntroLookDesktop",
      mobile: "trainingGroundsIntroLookMobile",
    },
  },
  trainingGroundsIntroLookDesktop: {
    id: "trainingGroundsIntroLookDesktop",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-02-look-direction-desktop.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-02-look-direction-desktop.json",
    ),
    captions: [
      say("Your mouse controls look direction.", 2.38),
      say("WASD keys control forward, backward,", 3.72),
      say("and lateral motion along that look direction.", 3.16),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "introDialog",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    playNext: "trainingGroundsIntroFollowUpCont",
  },
  trainingGroundsIntroLookMobile: {
    id: "trainingGroundsIntroLookMobile",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-02-look-direction-mobile.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-02-look-direction-mobile.json",
    ),
    captions: [
      say("The right joystick controls look direction.", 3.38),
      say("Left joystick controls your forward, backward,", 3.42),
      say("and lateral motion along that look direction.", 3.34),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "introDialog",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    playNext: "trainingGroundsIntroFollowUpCont",
  },
  trainingGroundsIntroFollowUpCont: {
    id: "trainingGroundsIntroFollowUpCont",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-03-steer-through-these-goals.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-03-steer-through-these-goals.json",
    ),
    captions: [say("Steer through these goals now.", 2.26)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "introDialog",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  /** After first movement goal (desktop); triggered from mission, not autoPlay. */
  trainingGroundsBoostDesktop: {
    id: "trainingGroundsBoostDesktop",
    speakerId: "alcair",
    audio: dialogPublicUrl("audio/dialog/training/training-03-boost-desktop.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/training/training-03-boost-desktop.json"),
    captions: [
      say("Well done.", 0.4, 0.72),
      say("You can go faster for a limited time", 2.34, 2.04),
      say("using thrusters by holding shift.", 2.62, 4.48),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "movementGoals",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsBoostMobile: {
    id: "trainingGroundsBoostMobile",
    speakerId: "alcair",
    audio: dialogPublicUrl("audio/dialog/training/training-03-boost-mobile.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/training/training-03-boost-mobile.json"),
    captions: [
      say("Well done. On to the next!", 2.32, 1.2),
      say("You can go faster for a limited time using thrusters", 4.3, 4.34),
      say("by pressing the boost button on the left", 2.74, 8.68),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "movementGoals",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  /** After second movement goal (desktop); mission-triggered. */
  trainingGroundsStrafeUpDownDesktop: {
    id: "trainingGroundsStrafeUpDownDesktop",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-03-strafe-updown-desktop.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-03-strafe-updown-desktop.json",
    ),
    captions: [
      say("All right, one more.", 1.28, 1.3),
      say("To strafe straight up and down,", 2.08, 3.48),
      say("press Z and C, respectively.", 2.64, 6.02),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "movementGoals",
      isMobile: false,
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsStrafeUpDownMobile: {
    id: "trainingGroundsStrafeUpDownMobile",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-03-strafe-updown-mobile.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-03-strafe-updown-mobile.json",
    ),
    captions: [
      say("All right, one more.", 0.92, 0.4),
      say("To strafe straight up and down,", 1.58, 2.14),
      say("press the buttons above the left joystick.", 2.6, 4.02),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "movementGoals",
      isMobile: true,
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsAceFlyingRollControl: {
    id: "trainingGroundsAceFlyingRollControl",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-04-ace-flying-roll-control.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-04-ace-flying-roll-control.json",
    ),
    captions: [
      say("Ace flying!", 0.96, 0.88),
      say("Now the tricky part: roll control.", 3.7, 2.68),
      say("Your ship will attempt to level itself during flight,", 3.5, 7.12),
      say("but at times you'll want to manually adjust", 2.72, 10.96),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "aceFlyingBrief",
    },
    autoPlay: true,
    priority: 200,
    placeholderAnimation: true,
    playNext: {
      desktop: "trainingGroundsRollKeyboardDesktop",
      mobile: "trainingGroundsRollKeyboardMobile",
    },
  },
  trainingGroundsRollKeyboardDesktop: {
    id: "trainingGroundsRollKeyboardDesktop",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-05-roll-left-right-keyboard.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-05-roll-left-right-keyboard.json",
    ),
    captions: [
      say(
        "The Q and E keys roll left and right, respectively.",
        4.74,
        0.64,
      ),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "aceFlyingBrief",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    playNext: "trainingGroundsBarrelRollBrief",
  },
  trainingGroundsRollKeyboardMobile: {
    id: "trainingGroundsRollKeyboardMobile",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-05-roll-left-right-mobile.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-05-roll-left-right-mobile.json",
    ),
    captions: [
      say("The buttons above the right joystick", 2.72, 0.56),
      say("roll left and right, respectively.", 2.96, 3.54),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "aceFlyingBrief",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    playNext: "trainingGroundsBarrelRollBrief",
  },
  trainingGroundsBarrelRollBrief: {
    id: "trainingGroundsBarrelRollBrief",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-06-my-advice-barrel-roll.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-06-my-advice-barrel-roll.json",
    ),
    captions: [
      say("My advice?", 0.8, 1.46),
      say("Forget there's a floor.", 1.42, 2.9),
      say("Do a barrel roll in both directions now.", 3.26, 5.54),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "aceFlyingBrief",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsLaserIntro: {
    id: "trainingGroundsLaserIntro",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-07-not-bad-target-practice.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-07-not-bad-target-practice.json",
    ),
    captions: [
      say("Not bad...", 1.1, 1.34),
      say("for a mammal.", 0.72, 3.34),
      say("Time for target practice.", 1.52, 5.4),
      say("Enemy bots are armed.", 1.74, 7.14),
    ],
    /** End of “Enemy bots are armed” (7.14 + 1.74) — training mission spawns bots here. */
    missionMilestones: [{ atTimeSec: 8.88, event: "trainingLaserBotsSpawn" }],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "laserDialog",
    },
    autoPlay: true,
    priority: 200,
    placeholderAnimation: true,
    playNext: {
      desktop: "trainingGroundsLaserIntroDesktop",
      mobile: "trainingGroundsLaserIntroMobile",
    },
  },
  trainingGroundsLaserIntroDesktop: {
    id: "trainingGroundsLaserIntroDesktop",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-08-engage-lasers-desktop.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-08-engage-lasers-desktop.json",
    ),
    captions: [
      say("Engage lasers with the left mouse button.", 3.32, 0.68),
      say("Seek and destroy the targets now.", 1.9, 5.14),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "laserDialog",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsLaserIntroMobile: {
    id: "trainingGroundsLaserIntroMobile",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-08-engage-lasers-mobile.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-08-engage-lasers-mobile.json",
    ),
    captions: [
      say(
        "Engage lasers with the button beside the right joystick.",
        4.86,
        1.56,
      ),
      say("Seek and destroy the targets now.", 2.3, 7.28),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "laserDialog",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsMissileIntroDesktop: {
    id: "trainingGroundsMissileIntroDesktop",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-09-missiles-desktop.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-09-missiles-desktop.json",
    ),
    captions: [
      say("Bots disarmed!", 1.2, 0.64),
      say("Let's test missile projectiles.", 2.14, 2.9),
      say("Press the right mouse button to fire.", 2.36, 5.94),
      say("You'll have two kinds available to start.", 2.14, 9),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "missileDialog",
      isMobile: false,
    },
    autoPlay: true,
    priority: 200,
    placeholderAnimation: true,
    playNext: "trainingGroundsMissileHomingKinetic",
  },
  trainingGroundsMissileIntroMobile: {
    id: "trainingGroundsMissileIntroMobile",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-09-missiles-mobile.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-09-missiles-mobile.json",
    ),
    captions: [
      say("Bots disarmed!", 1.26, 0.84),
      say("Let's test missile projectiles.", 2.04, 3.14),
      say("Press the button beside the left joystick to fire.", 2.8, 6),
      say("You'll have two kinds available to start", 2.18, 9.36),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "missileDialog",
      isMobile: true,
    },
    autoPlay: true,
    priority: 200,
    placeholderAnimation: true,
    playNext: "trainingGroundsMissileHomingKinetic",
  },
  trainingGroundsMissileHomingKinetic: {
    id: "trainingGroundsMissileHomingKinetic",
    speakerId: "alcair",
    audio: dialogPublicUrl("audio/dialog/training/training-10-homing-kinetic.audio.mp3"),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-10-homing-kinetic.json",
    ),
    captions: [
      say("Homing missiles are the default", 1.9, 0.98),
      say("and track to the nearest target,", 1.82, 3.16),
      say("while kinetic rounds bounce off walls", 2.86, 5.42),
      say("and do splash damage.", 1.68, 8.34),
    ],
    missionMilestones: [{ atTimeSec: 0.2, event: "trainingMissileBotsSpawn" }],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "missileDialog",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    playNext: {
      desktop: "trainingGroundsMissileToggleDesktop",
      mobile: "trainingGroundsMissileToggleMobile",
    },
  },
  trainingGroundsMissileToggleDesktop: {
    id: "trainingGroundsMissileToggleDesktop",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-11-toggle-between-desktop.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-11-toggle-between-desktop.json",
    ),
    captions: [say("Press G to toggle between the two.", 2.66, 0.94)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "missileDialog",
      isMobile: false,
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsMissileToggleMobile: {
    id: "trainingGroundsMissileToggleMobile",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-11-toggle-between-mobile.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-11-toggle-between-mobile.json",
    ),
    captions: [
      say("Long-press the missile button", 2.0, 0.98),
      say("to toggle between the two.", 1.62, 2.95),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "missileDialog",
      isMobile: true,
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsTildeRemapDesktop: {
    id: "trainingGroundsTildeRemapDesktop",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-12-tilde-remap-desktop.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-12-tilde-remap-desktop.json",
    ),
    captions: [
      say("Hold the tilde key to view the controls cheat sheet.", 4.6, 0.18),
      say("And remember, you can remap many of these controls", 3.56, 4.8),
      say(
        "in your settings menu by hitting the escape key, then options.",
        4.92,
        8.4,
      ),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "tildeRemapDesktop",
      isMobile: false,
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsAmmoCollectible: {
    id: "trainingGroundsAmmoCollectible",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-13-ammo-collectible.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-13-ammo-collectible.json",
    ),
    captions: [
      say("You have a limited supply of missiles,", 2.46, 0.23),
      say("but you can find more in your environment.", 2.26, 3.15),
      say("Fly into the ammo collectible to restock", 2.8, 5.95),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "ammoCollectibleBrief",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  },
  trainingGroundsTrainingComplete: {
    id: "trainingGroundsTrainingComplete",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/training/training-13-training-complete.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/training/training-13-training-complete.json",
    ),
    captions: [
      say("With your training complete,", 1.4, 0.34),
      say("you can continue practicing against these bots", 3.04, 2.32),
      say("or go head-to-head against real pilots in multiplayer.", 3.64, 5.4),
      say(
        "Your first mission to the ice moon of Charon launches soon.",
        3.72,
        9.94,
      ),
      say("Better be ready.", 0.86, 14.56),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "trainingGrounds",
      missionStepId: "trainingCompleteOutro",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
  }
};
