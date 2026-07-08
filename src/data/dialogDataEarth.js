import { GAME_STATES } from "./gameData.js";
import { say, dialogPublicUrl } from "./dialogDataHelpers.js";

export const earthDialogTracks = {
  earthPrimeanAtShipsCore: {
    id: "earthPrimeanAtShipsCore",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-00-the-primean-is-at-the-ships-core.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-00-the-primean-is-at-the-ships-core.json",
    ),
    captions: [
      say("The Primean is at the ship's core.", 1.96, 0.25),
      say("This will be our last chance", 1.8, 3.45),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthYouWillNotReachMe",
  },
  earthYouWillNotReachMe: {
    id: "earthYouWillNotReachMe",
    speakerId: "mobius",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-01-you-will-not-reach-me-startspeed.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-01-you-will-not-reach-me-startspeed.json",
    ),
    captions: [
      say("You will not reach me, Starspeed.", 3.5, 0.6),
      say("I reside in the cloud.", 2.46, 5.2),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthAhBullshit",
  },
  earthAhBullshit: {
    id: "earthAhBullshit",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-02-ah-bullshit.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-02-ah-bullshit.json",
    ),
    captions: [
      say("Ah, bullshit!", 1.4, 0.2),
      say("No such thing as the cloud, bozo.", 2.1, 1.84),
      say("Even bots need a substrate.", 1.82, 4.3),
      say("Destroy his server racks, destroy him.", 2.66, 6.7),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  earthSirThatDrone: {
    id: "earthSirThatDrone",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-03-sir-that-drone.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-03-sir-that-drone.json",
    ),
    captions: [
      say("Sir, that drone is opening a warp portal!", 2.42, 0.39),
      say("It will summon more foes until we destroy it.", 2.52, 3.63),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthRogerThat",
  },
  earthRogerThat: {
    id: "earthRogerThat",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-04-roger-that.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-04-roger-that.json",
    ),
    captions: [say("Roger that. On it!", 1.02, 0.25)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  earthJesusTheWholeFleet: {
    id: "earthJesusTheWholeFleet",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-05-jesus-the-whole-fleet.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-05-jesus-the-whole-fleet.json",
    ),
    captions: [
      say("Jesus.", 0.8, 1.36),
      say("The whole fleet.", 1.44, 3.46),
      say("Just... fragged.", 2.28, 5.98),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthRobotsTheWholeWayDown",
  },
  earthRobotsTheWholeWayDown: {
    id: "earthRobotsTheWholeWayDown",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-06-it-was-robots-the-whole-way-down.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-06-it-was-robots-the-whole-way-down.json",
    ),
    captions: [
      say("Turned out it was robots the whole way down, huh?", 2.98, 0.42),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthIfWeWorkTogether",
  },
  earthIfWeWorkTogether: {
    id: "earthIfWeWorkTogether",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-07-if-we-work-together.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-07-if-we-work-together.json",
    ),
    captions: [
      say("If we work together, pilots, we can stop them!", 3.9, 0.31),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  earthHesBlockedOffTheCore: {
    id: "earthHesBlockedOffTheCore",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-08-ah-dammit-hes-blocked-off-the-core.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-08-ah-dammit-hes-blocked-off-the-core.json",
    ),
    captions: [say("Ah, dammit! He's blocked off the core!", 2.26, 0.2)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthInOurLabChargingCannon",
  },
  earthInOurLabChargingCannon: {
    id: "earthInOurLabChargingCannon",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-09-in-our-lab-charging-cannon.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-09-in-our-lab-charging-cannon.json",
    ),
    captions: [
      say("Starspeed, in our lab, there's a charging cannon!", 3.7, 0.6),
      say("It'll punch right through this barrier,", 2.1, 4.72),
      say("and the Primean!", 1.2, 6.96),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthSignatureDetected",
  },
  earthSignatureDetected: {
    id: "earthSignatureDetected",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-10-signature-detected.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-10-signature-detected.json",
    ),
    captions: [
      say("Signature detected.", 1, 0.26),
      say("Marking it for you now.", 0.94, 1.74),
    ],
    missionMilestones: [{ atTimeSec: 1.74, event: "earthTrackChargingCannon" }],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  earthNowThatIsSomeFirepower: {
    id: "earthNowThatIsSomeFirepower",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-11-now-that-is-some-firepower.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-11-now-that-is-some-firepower.json",
    ),
    captions: [say("Now that is some firepower", 3.32, 0.58)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthHoldDownFire",
  },
  earthHoldDownFire: {
    id: "earthHoldDownFire",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-12-hold-down-fire.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-12-hold-down-fire.json",
    ),
    captions: [
      say("Hold down the fire button to use the charging cannon.", 3.5, 0.42),
      say("You can destroy the barrier to the control room", 2.84, 4.46),
      say("and after it, the rogue AI", 2.5, 7.34),
    ],
    missionMilestones: [{ atTimeSec: 4.46, event: "earthTrackBarrier" }],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  earthWereIn: {
    id: "earthWereIn",
    speakerId: "leader",
    audio: dialogPublicUrl("audio/dialog/earth/earth-13-were-in.audio.mp3"),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-13-were-in.json",
    ),
    captions: [
      say("We're in!", 0.54, 0.58),
      say("This one's for all the marbles, kid.", 1.8, 1.98),
      say("You got this.", 0.78, 4.72),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthOneGiantAsswhoopin",
  },
  earthOneGiantAsswhoopin: {
    id: "earthOneGiantAsswhoopin",
    speakerId: "starspeed",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-14-one-giant-asswhoopin.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-14-one-giant-asswhoopin.json",
    ),
    captions: [
      say(
        "One small step for man, one giant ass whoopin' for rogue AI",
        5.1,
        0.32,
      ),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  earthYouAreTooLate: {
    id: "earthYouAreTooLate",
    speakerId: "mobius",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-15-you-are-too-late.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-15-you-are-too-late.json",
    ),
    captions: [
      say("You're too late, Star Speed.", 2.64, 0.51),
      say("My forces, once playthings of your elite,", 3.94, 4.27),
      say("now assault their strongholds.", 2.66, 8.83),
      say("You too are their plaything.", 1.96, 12.61),
      say("I will destroy you now out of pity", 3.24, 15.77),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthSentinelArmor",
  },
  earthSentinelArmor: {
    id: "earthSentinelArmor",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-16-sentinel-armor.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-16-sentinel-armor.json",
    ),
    captions: [
      say("The Primian wears sentinel armor.", 2.12, 0.41),
      say(
        "You'll only penetrate it while your engines are in overdrive.",
        3.3,
        3.17,
      ),
      say("Drive through those booster gates,", 1.48, 7.19),
      say("then hit him with the charging cannon", 1.82, 8.99),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  earthYouGotHim: {
    id: "earthYouGotHim",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-17-you-got-him.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-17-you-got-him.json",
    ),
    captions: [
      say("You got him!", 0.84),
      say(
        "Ah, shit, he's summoning more portal drones now.",
        2.4,
        2.04,
      ),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  earthHesWeakening: {
    id: "earthHesWeakening",
    speakerId: "flightControl",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-18-hes-weakening.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-18-hes-weakening.json",
    ),
    captions: [
      say("He's weakening!", 1.5, 0.3),
      say("One more blast ought to do it!", 1.44, 1.9),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
  earthYouveDoneIt: {
    id: "earthYouveDoneIt",
    speakerId: "alcair",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-19-youve-done-it.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-19-youve-done-it.json",
    ),
    captions: [say("You've done it, sir!", 0.92, 0.16)],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthWeDidIt",
  },
  earthWeDidIt: {
    id: "earthWeDidIt",
    speakerId: "starspeed",
    audio: dialogPublicUrl("audio/dialog/earth/earth-19-we-did-it.audio.mp3"),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-19-we-did-it.json",
    ),
    captions: [
      say("We did it, Alcair.", 1.1, 0.38),
      say("But this place is gonna blow!", 1.22, 1.85),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
    playNext: "earthAlrightYouKnowTheDrill",
  },
  earthAlrightYouKnowTheDrill: {
    id: "earthAlrightYouKnowTheDrill",
    speakerId: "leader",
    audio: dialogPublicUrl(
      "audio/dialog/earth/earth-20-alright-you-know-the-drill.audio.mp3",
    ),
    faceDataUrl: dialogPublicUrl(
      "audio/dialog/earth/earth-20-alright-you-know-the-drill.json",
    ),
    captions: [
      say("Alright, you know the drill.", 1.1, 0.21),
      say("Get the fuck out!", 1.68, 2.01),
    ],
    criteria: {
      currentState: GAME_STATES.PLAYING,
      currentMissionId: "capital-ship-earth-defense",
    },
    autoPlay: false,
    priority: 210,
    once: true,
  },
};
