/**
 * Binds level trigger volumes by ordinal id (`Trigger`, `Trigger.001`, …). Mesh names may
 * append `-Label`; that suffix is ignored when resolving (see SceneManager).
 *
 * Geometry (world-space AABB from named objects in the GLB) is baked at load; this file links names → behavior.
 */

import { GAME_STATES } from "./gameData.js";

/**
 * @typedef {object} LevelTriggerBinding
 * @property {string} objectName - Ordinal id matching volume after strip (e.g. "Trigger", "Trigger.002").
 *   Several meshes may share one id (e.g. Trigger.002-A / -B); one `once` binding fires once for any of them,
 *   then all volumes with that id are ignored (LevelTriggerManager).
 * @property {string} id - Stable id for once-tracking and logging
 * @property {boolean} [once]
 * @property {object} [criteria] - Passed to sceneData.checkCriteria(gameState)
 * @property {object} [onEnter]
 * @property {object} [onEnter.setState] - Partial GameManager.setState
 * @property {string | { desktop?: string, mobile?: string }} [onEnter.playDialog] -
 *   Dialog track id, or desktop/mobile ids (same rules as dialog playNext).
 * @property {string} [onEnter.emitMissionEvent] - MissionManager.reportEvent(type, payload)
 * @property {object} [onEnter.missionPayload] - Extra payload merged with trigger metadata
 */

/** @type {LevelTriggerBinding[]} */
export const charonLevelTriggerBindings = [
  {
    objectName: "Trigger",
    id: "charon-trigger-main",
    once: true,
    criteria: {
      currentMissionId: "charon",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "charonControlRoomIced",
      emitMissionEvent: "charonTriggerMain",
    },
  },
  {
    objectName: "Trigger.001",
    id: "charon-trigger-001-resistance",
    once: true,
    criteria: {
      currentMissionId: "charon",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "charonAlcairEncounteringResistance",
    },
  },
  {
    objectName: "Trigger.002",
    id: "charon-trigger-002-pump-air",
    once: true,
    criteria: {
      currentMissionId: "charon",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "charonStarspeedWhyPumpAir",
    },
  },
  {
    objectName: "Trigger.003",
    id: "charon-trigger-003-any-sympathies",
    once: true,
    criteria: {
      currentMissionId: "charon",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "charonStarspeedAnySympathies",
    },
  },
  {
    objectName: "Trigger.004",
    id: "charon-trigger-004-submit-starspeed",
    once: true,
    criteria: {
      currentMissionId: "charon",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "charonHostileSubmitStarspeed",
    },
  },
  {
    objectName: "Trigger.005",
    id: "charon-trigger-005-map-tutorial",
    once: true,
    criteria: {
      currentMissionId: "charon",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: {
        desktop: "charonAlcairToggleMapDesktop",
        mobile: "charonAlcairToggleMapMobile",
      },
    },
  },
  {
    objectName: "Trigger.006",
    id: "charon-trigger-006-energy-field",
    once: true,
    criteria: {
      currentMissionId: "charon",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "charonLeaderThatEnergyField",
    },
  },
];

/** @type {LevelTriggerBinding[]} */
export const saturnaliaLevelTriggerBindings = [
  {
    objectName: "Trigger.001",
    id: "saturnalia-trigger-001-chase",
    once: true,
    criteria: {
      currentMissionId: "saturnalia",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "saturnaliaPilotHelpUs",
      emitMissionEvent: "saturnaliaChaseStart",
    },
  },
  {
    objectName: "Trigger.002",
    id: "saturnalia-trigger-002-booster-gates",
    once: true,
    criteria: {
      currentMissionId: "saturnalia",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "saturnaliaFlyThroughBoosterGates",
    },
  },
  {
    objectName: "Trigger.003",
    id: "saturnalia-trigger-003-getting-hairy",
    once: true,
    criteria: {
      currentMissionId: "saturnalia",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "saturnaliaGettingHairy",
    },
  },
  {
    objectName: "Trigger.004",
    id: "saturnalia-trigger-004-keep-going",
    once: true,
    criteria: {
      currentMissionId: "saturnalia",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "saturnaliaKeepGoing",
    },
  },
  {
    objectName: "Trigger.005",
    id: "saturnalia-trigger-005-spooky",
    once: true,
    criteria: {
      currentMissionId: "saturnalia",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "saturnaliaSpooky",
    },
  },
  {
    objectName: "Trigger.006",
    id: "saturnalia-trigger-006-charging-cannon-upgrade",
    once: true,
    criteria: {
      currentMissionId: "saturnalia",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "saturnaliaChargingCannonUpgrade",
      emitMissionEvent: "saturnaliaTrackChargingCannon",
    },
  },
  {
    objectName: "Trigger.007",
    id: "saturnalia-trigger-007-just-a-little-farther",
    once: true,
    criteria: {
      currentMissionId: "saturnalia",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "saturnaliaComeOnJustALittleFurther",
    },
  },
  {
    objectName: "Trigger.008",
    id: "saturnalia-trigger-008-i-dont-like-this",
    once: true,
    criteria: {
      currentMissionId: "saturnalia",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "saturnaliaIDontLikeThis",
      emitMissionEvent: "saturnaliaArmDestructionCountdown",
    },
  },
  {
    objectName: "Trigger.009",
    id: "saturnalia-trigger-009-escape",
    once: true,
    criteria: {
      currentMissionId: "saturnalia",
      currentState: GAME_STATES.PLAYING,
      saturnaliaCollapseActive: true,
    },
    onEnter: {
      emitMissionEvent: "saturnaliaEscapeComplete",
    },
  },
];

/** @type {LevelTriggerBinding[]} */
export const earthDefenseLevelTriggerBindings = [
  {
    objectName: "Trigger.000",
    id: "earthdefense-trigger-000-primean-at-core",
    once: true,
    criteria: {
      currentMissionId: "capital-ship-earth-defense",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "earthPrimeanAtShipsCore",
    },
  },
  {
    objectName: "Trigger.001",
    id: "earthdefense-trigger-001-warp-portal-drone",
    once: true,
    criteria: {
      currentMissionId: "capital-ship-earth-defense",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "earthSirThatDrone",
    },
  },
  {
    objectName: "Trigger.002",
    id: "earthdefense-trigger-002-whole-fleet-fragged",
    once: true,
    criteria: {
      currentMissionId: "capital-ship-earth-defense",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "earthJesusTheWholeFleet",
    },
  },
  {
    objectName: "Trigger.004",
    id: "earthdefense-trigger-004-blocked-off-core",
    once: true,
    criteria: {
      currentMissionId: "capital-ship-earth-defense",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "earthHesBlockedOffTheCore",
    },
  },
  {
    objectName: "Trigger.005",
    id: "earthdefense-trigger-005-you-are-too-late",
    once: true,
    criteria: {
      currentMissionId: "capital-ship-earth-defense",
      currentState: GAME_STATES.PLAYING,
    },
    onEnter: {
      playDialog: "earthYouAreTooLate",
      emitMissionEvent: "earthBossFightStart",
    },
  },
];

const byLevel = {
  charon: charonLevelTriggerBindings,
  saturnalia: saturnaliaLevelTriggerBindings,
  earthdefense: earthDefenseLevelTriggerBindings,
};

/**
 * @param {string} levelId
 * @returns {LevelTriggerBinding[]}
 */
export function getLevelTriggerBindings(levelId) {
  return byLevel[levelId] ?? [];
}
