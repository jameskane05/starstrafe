/**
 * Dialog tracks for the Charon campaign (`currentMissionId: "charon"`).
 * Merged with other level dialog tracks in dialogData.js.
 */

import { GAME_STATES } from "./gameData.js";
import { say, sayAs, dialogPublicUrl } from "./dialogDataHelpers.js";

export const charonDialogTracks = {
  charonIntroEntering: {
    id: "charonIntroEntering",
    speakerId: "alcair",
    audio: dialogPublicUrl("audio/dialog/charon/charon-00-entering-charon.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-00-entering-charon.json"),
    captions: [
      say("Entering Charon Station now.", 2.02, 0.24),
      say("The distress beacon is deep within the mining facility.", 2.94, 3),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      missionStepId: "briefing",
      charonIntroTextDone: true,
      debugSpawnActive: { $ne: true },
    },
    autoPlay: true,
    priority: 200,
    placeholderAnimation: true,
    delay: 0.45,
    once: true,
    playNext: "charonLeaderSpelunkin",
  },

  charonLeaderSpelunkin: {
    id: "charonLeaderSpelunkin",
    speakerId: "leader",
    audio: dialogPublicUrl("audio/dialog/charon/charon-01-spellunkin.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-01-spellunkin.json"),
    captions: [
      say("Gonna have to go spelunkin'.", 1.34, 0.26),
      say("Expect hostiles.", 1.18, 2.4),
      say("I got the west entrance.", 1.12, 4),
      say("You take east.", 0.72, 5.34),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      missionStepId: "briefing",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonStarspeedCopyThat",
  },

  charonStarspeedCopyThat: {
    id: "charonStarspeedCopyThat",
    speakerId: "starspeed",
    audio: dialogPublicUrl("audio/dialog/charon/charon-01-copy-that.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-01-copy-that.json"),
    captions: [say("Copy that.", 0.42, 0.32), say("Aye, sir.", 0.36, 1.3)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      missionStepId: "briefing",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonAlcairToggleMapDesktop: {
    id: "charonAlcairToggleMapDesktop",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-14-toggle-map-desktop.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-14-toggle-map-desktop.json",
    ),
    captions: [
      say("Press Tab to activate your holo-map, sir.", 2.72, 1.16),
      say("Left click to rotate, right click to drag.", 2.86, 4.82),
      say("Your weapons will be disabled while the map is open,", 2.66, 8.5),
      say(
        "but this should help you orient yourself as we explore.",
        2.9,
        11.72,
      ),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonAlcairToggleMapMobile: {
    id: "charonAlcairToggleMapMobile",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-14-toggle-map-mobile.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-14-toggle-map-mobile.json",
    ),
    captions: [
      say("Press the globe icon to toggle your holo-map, sir.", 3.64, 0.54),
      say(
        "Swipe to rotate, pinch to zoom, and use two fingers to pan.",
        4.72,
        5.22,
      ),
      say("This should help orient yourself as you explore.", 3.08, 10.76),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonAlcairEncounteringResistance: {
    id: "charonAlcairEncounteringResistance",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-03-encountering-resistance.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-03-encountering-resistance.json",
    ),
    captions: [
      say("We're encountering resistance.", 1.48, 0.46),
      say("Just drone class. Light lasers, slow.", 2.78, 2.92),
      say(
        "We should move through this structure and cull the bots.",
        2.46,
        6.78,
      ),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonLeaderMachineBrainsRunHot: {
    id: "charonLeaderMachineBrainsRunHot",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-02-machine-brains-run-hot.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-02-machine-brains-run-hot.json",
    ),
    captions: [
      say("Machine brains run hot.", 1.9, 0.27),
      say("They need the ice.", 1.14, 3.35),
      say("They like it out of here.", 1.16, 5.79),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonControlRoomIced: {
    id: "charonControlRoomIced",
    speakerId: "flightControl",
    audio: dialogPublicUrl("audio/dialog/charon/charon-02-control-room.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-02-control-room.json"),
    captions: [
      say("They let the control room ice over like that?", 3.22, 0.24),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonLeaderMachineBrainsRunHot",
  },

  charonStarspeedWhyPumpAir: {
    id: "charonStarspeedWhyPumpAir",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-04-why-do-they-pump-air.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-04-why-do-they-pump-air.json",
    ),
    captions: [
      say("Why do they pump air in?", 1.6, 0.37),
      say("Nothing here breathes.", 1.1, 3.25),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonLeaderItsSoItDontExplode",
  },

  charonLeaderItsSoItDontExplode: {
    id: "charonLeaderItsSoItDontExplode",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-05-its-so-it-dont-explode.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-05-its-so-it-dont-explode.json",
    ),
    captions: [say("Uh, it's so it don't explode.", 2.0, 0.37)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonStarspeedOh",
  },

  charonStarspeedOh: {
    id: "charonStarspeedOh",
    speakerId: "starspeed",
    audio: dialogPublicUrl("audio/dialog/charon/charon-06-oh.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-06-oh.json"),
    captions: [say("...oh.", 2.22, 2.74)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonStarspeedAnySympathies: {
    id: "charonStarspeedAnySympathies",
    speakerId: "starspeed",
    audio: dialogPublicUrl("audio/dialog/charon/charon-07-any-sympathies.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-07-any-sympathies.json"),
    captions: [
      say("Alcair, any sympathies for your fellow machines?", 3.56, 0.26),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonAlcairSirYouProgrammedMe",
  },

  charonAlcairSirYouProgrammedMe: {
    id: "charonAlcairSirYouProgrammedMe",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-08-sir-you-programmed-me.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-08-sir-you-programmed-me.json",
    ),
    captions: [
      say("Sir, you programmed me yourself.", 2.6, 0.32),
      say("I could never, and you know it.", 1.88, 3.46),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonStarspeedEasyJustKidding",
  },

  charonStarspeedEasyJustKidding: {
    id: "charonStarspeedEasyJustKidding",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-09-easy-just-kidding.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-09-easy-just-kidding.json",
    ),
    captions: [say("Easy! Just kidding...", 2.1, 0.19)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonAlcairMissilesIncoming: {
    id: "charonAlcairMissilesIncoming",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-10-missiles-incoming.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-10-missiles-incoming.json",
    ),
    captions: [say("Missiles incoming!", 1.02, 0.19)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonHeavyMissileIntroPending: true,
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: true,
    priority: 250,
    placeholderAnimation: true,
    once: true,
    playNext: "charonStarspeedWhoaNotDroneClass",
  },

  charonStarspeedWhoaNotDroneClass: {
    id: "charonStarspeedWhoaNotDroneClass",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-10-whoa-not-drone-class.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-10-whoa-not-drone-class.json",
    ),
    captions: [
      say("Whoa!", 1.14, 0.25),
      say("Leader, these are not drone class!", 2.04, 1.45),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonLeaderYeahSeeingHeavies",
  },

  charonLeaderYeahSeeingHeavies: {
    id: "charonLeaderYeahSeeingHeavies",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-11-yeah-seeing-heavies.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-11-yeah-seeing-heavies.json",
    ),
    captions: [
      say("Yeah, I'm seeing heavies.", 1.26, 0.35),
      say("These shouldn't be here.", 0.92, 2.61),
      say("Something's up.", 0.66, 3.57),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonLeaderSeenEnoughBlowThisPlace",
  },

  charonLeaderSeenEnoughBlowThisPlace: {
    id: "charonLeaderSeenEnoughBlowThisPlace",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-12-seen-enough-blow-this-place.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-12-seen-enough-blow-this-place.json",
    ),
    captions: [
      sayAs("flightControl", "I've seen enough.", 1.26, 0.44),
      say("We need to blow this place.", 1.22, 2.28),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonStarspeedAyeControl",
  },

  charonStarspeedAyeControl: {
    id: "charonStarspeedAyeControl",
    speakerId: "starspeed",
    audio: dialogPublicUrl("audio/dialog/charon/charon-12-aye-control.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-12-aye-control.json"),
    captions: [
      say("Aye, Control.", 1.06, 0.23),
      say("We'll find the core and plant munitions.", 1.68, 1.31),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonHostileSubmitStarspeed: {
    id: "charonHostileSubmitStarspeed",
    speakerId: "mobius",
    audio: dialogPublicUrl("audio/dialog/charon/charon-13-submit-starspeed.audio.mp3"),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-13-submit-starspeed.json",
    ),
    captions: [
      say("Submit, Starspeed.", 2.32, 0.9),
      say("You cannot overcome the swarm.", 3.24, 3.96),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonStarspeedWhatTheF",
  },

  charonStarspeedWhatTheF: {
    id: "charonStarspeedWhatTheF",
    speakerId: "starspeed",
    audio: dialogPublicUrl("audio/dialog/charon/charon-14-what-the-f.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-14-what-the-f.json"),
    captions: [say("What the fu-", 1.36, 0.43)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonLeaderWhateverThatWas",
  },

  charonLeaderWhateverThatWas: {
    id: "charonLeaderWhateverThatWas",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-15-whatever-that-was.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-15-whatever-that-was.json",
    ),
    captions: [say("Whatever that was, let's kill it.", 3.34, 0.25)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonStarspeedNoArgumentHere",
  },

  charonStarspeedNoArgumentHere: {
    id: "charonStarspeedNoArgumentHere",
    speakerId: "starspeed",
    audio: dialogPublicUrl("audio/dialog/charon/charon-15-no-argument-here.audio.mp3"),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-15-no-argument-here.json",
    ),
    captions: [say("No argument here.", 0.78, 0.8)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonLeaderThatEnergyField: {
    id: "charonLeaderThatEnergyField",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-16-that-energy-field.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-16-that-energy-field.json",
    ),
    captions: [
      say("That energy field!", 1.44, 1.45),
      say("Destroy it!", 0.66, 2.93),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonMobiusLaugh",
  },

  charonMobiusLaugh: {
    id: "charonMobiusLaugh",
    speakerId: "mobius",
    audio: dialogPublicUrl("audio/dialog/charon/charon-17-mobius-laugh.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-17-mobius-laugh.json"),
    captions: [say("[laughing]", 3)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonReactorCoreDestroyed: { $ne: true },
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },

  charonAlcairSirWeNeedToLeave: {
    id: "charonAlcairSirWeNeedToLeave",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-19-sir-we-need-to-leave.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-19-sir-we-need-to-leave.json",
    ),
    captions: [say("Sir, we need to leave. Now!", 1.96, 0.16)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
      charonMobiusReactorTauntPending: true,
    },
    autoPlay: true,
    priority: 250,
    placeholderAnimation: true,
    once: true,
    playNext: "charonMobiusPointlessReactorTaunt",
  },

  charonMobiusPointlessReactorTaunt: {
    id: "charonMobiusPointlessReactorTaunt",
    speakerId: "mobius",
    audio: dialogPublicUrl(
      "audio/dialog/charon/charon-18-pointless-you-matter-not.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/charon/charon-18-pointless-you-matter-not.json",
    ),
    captions: [
      say("Pointless.", 0.86, 0.64),
      say(
        "We will reach a helpless, hopeless Earth soon and lay waste to it.",
        5.92,
        2.94,
      ),
      say("You matter not, Starspeed.", 2.46, 9.98),
      say("You are immaterial.", 1.54, 13.7),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
    playNext: "charonLeaderStarspeedOut",
  },

  charonLeaderStarspeedOut: {
    id: "charonLeaderStarspeedOut",
    speakerId: "leader",
    audio: dialogPublicUrl("audio/dialog/charon/charon-20-starspeed-out.audio.mp3"),
    faceDataUrl: dialogPublicUrl("audio/dialog/charon/charon-20-starspeed-out.json"),
    captions: [say("Starspeed - out!", 1.5, 0.2)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "charon",
    },
    autoPlay: false,
    priority: 200,
    placeholderAnimation: true,
    once: true,
  },
};
