/**
 * debugSpawner.js — jump straight into solo missions / steps via URL (dev builds).
 *
 * Params (all optional except debugMission to activate):
 *   debugMission   — mission id registered in missions/missionsIndex.js (e.g. trainingGrounds)
 *   debugStep      — step id on that mission (e.g. laserWave, missileWave). Omit to use mission.startStepId.
 *                    Saturnalia also accepts `escape` (not a mission step) to jump into the
 *                    end collapse / Trigger.009 escape sequence.
 *   debugLevel     — level id (e.g. arenatech). Omit to use mission.defaultLevelId.
 *   debugSpawn     — player spawn point index (e.g. 5 for Spawn.005). Omit to use default (0).
 *
 * Examples:
 *   ?debugMission=trainingGrounds
 *   ?debugMission=trainingGrounds&debugStep=missileWave
 *   ?debugMission=trainingGrounds&debugStep=laserWave&debugLevel=arenatech
 *   ?debugMission=charon
 *   ?debugMission=charon&debugSpawn=5
 *   ?debugMission=saturnalia&debugSpawn=0
 *   ?debugMission=saturnalia&debugSpawn=0&debugStep=escape
 *
 * Training Grounds step ids: introDialog, movementGoals, rollDialog, rollTraining,
 * laserDialog, laserWave, missileDialog, missileWave
 *
 * Charon step ids: briefing
 *
 * Saturnalia step ids: arrival (default)
 * Saturnalia debugStep aliases: escape — start destruction countdown + collapse FX immediately
 *
 * Add new missions in missions/missionsIndex.js; step ids are keys of mission.steps.
 */

import { MISSIONS } from "../missions/missionsIndex.js";

const P_MISSION = "debugMission";
const P_STEP = "debugStep";
const P_LEVEL = "debugLevel";
const P_SPAWN = "debugSpawn";

/** Non-step aliases accepted by mission.start (not keys of mission.steps). */
const DEBUG_STEP_ALIASES = {
  saturnalia: new Set(["escape"]),
};

export function getDebugMissionSpawn() {
  const urlParams = new URLSearchParams(window.location.search);
  const missionId = urlParams.get(P_MISSION)?.trim();
  if (!missionId) return null;

  const mission = MISSIONS[missionId];
  if (!mission) {
    console.warn(
      `[DebugSpawner] Unknown ${P_MISSION}="${missionId}". Registered:`,
      Object.keys(MISSIONS),
    );
    return null;
  }

  const levelId =
    urlParams.get(P_LEVEL)?.trim() ||
    mission.defaultLevelId ||
    null;

  const stepRaw = urlParams.get(P_STEP)?.trim();
  let debugStepId;
  if (stepRaw) {
    const aliases = DEBUG_STEP_ALIASES[missionId];
    if (mission.steps?.[stepRaw] || aliases?.has(stepRaw)) {
      debugStepId = stepRaw;
    } else {
      console.warn(
        `[DebugSpawner] Unknown ${P_STEP}="${stepRaw}" for mission "${missionId}". Steps:`,
        mission.steps ? Object.keys(mission.steps) : [],
        aliases?.size ? `Aliases: ${[...aliases].join(", ")}` : "",
      );
    }
  }

  const spawnRaw = urlParams.get(P_SPAWN)?.trim();
  const debugSpawnIndex = spawnRaw != null ? parseInt(spawnRaw, 10) : null;

  const config = {
    missionId,
    levelId,
    ...(debugStepId ? { debugStepId } : {}),
    ...(debugSpawnIndex != null && !isNaN(debugSpawnIndex) ? { debugSpawnIndex } : {}),
  };
  console.log("[DebugSpawner] URL spawn:", config);
  return config;
}

export function isDebugMissionSpawnActive() {
  return new URLSearchParams(window.location.search).has(P_MISSION);
}

export function getDebugMissionSpawnParamMission() {
  return new URLSearchParams(window.location.search).get(P_MISSION)?.trim() ?? null;
}

export default {
  getDebugMissionSpawn,
  isDebugMissionSpawnActive,
  getDebugMissionSpawnParamMission,
};
