import { GAME_STATES } from "../data/gameData.js";

export const musicTracks = {
  menu: {
    id: "menu",
    path: "./audio/music/24HRDiner.mp3",
    description: "Main menu ambiance",
    preload: true,
    loop: true,
    criteria: {
      currentState: { $in: [GAME_STATES.LOADING, GAME_STATES.MENU, GAME_STATES.PAUSED] },
    },
    fadeTime: 1.5,
    priority: 10,
  },
  gameplay: {
    id: "gameplay",
    path: "./audio/music/ModernProblems.mp3",
    description: "In-match gameplay music",
    preload: false,
    loop: true,
    criteria: {
      currentState: GAME_STATES.PLAYING,
    },
    fadeTime: 2.0,
    priority: 20,
  },
};

function checkCriteria(gameState, criteria) {
  for (const [key, condition] of Object.entries(criteria)) {
    const stateValue = gameState[key];

    if (typeof condition === "object" && condition !== null) {
      if (condition.$eq !== undefined && stateValue !== condition.$eq) return false;
      if (condition.$ne !== undefined && stateValue === condition.$ne) return false;
      if (condition.$gt !== undefined && stateValue <= condition.$gt) return false;
      if (condition.$gte !== undefined && stateValue < condition.$gte) return false;
      if (condition.$lt !== undefined && stateValue >= condition.$lt) return false;
      if (condition.$lte !== undefined && stateValue > condition.$lte) return false;
      if (condition.$in !== undefined && !condition.$in.includes(stateValue)) return false;
      if (condition.$nin !== undefined && condition.$nin.includes(stateValue)) return false;
    } else {
      if (stateValue !== condition) return false;
    }
  }
  return true;
}

export function getMusicForState(gameState) {
  const sortedTracks = Object.values(musicTracks).sort(
    (a, b) => (b.priority || 0) - (a.priority || 0)
  );

  for (const track of sortedTracks) {
    if (track.criteria && checkCriteria(gameState, track.criteria)) {
      return track;
    }
  }

  return sortedTracks.find((t) => t.isDefault) || null;
}

export function getAllTrackIds() {
  return Object.keys(musicTracks);
}

export default musicTracks;
