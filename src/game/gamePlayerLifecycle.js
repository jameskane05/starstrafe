/**
 * gamePlayerLifecycle.js - DAMAGE INDICATORS AND PLAYER DEATH/RESPAWN
 * =============================================================================
 *
 * ROLE: Visual and flow handling for player damage (direction indicators) and
 * death: respawn overlay, countdown, and respawn execution for solo and multiplayer.
 *
 * KEY RESPONSIBILITIES:
 * - showDamageIndicator(game, hitWorldPos): flash screen-edge indicators by hit direction
 * - handleLocalPlayerDeath(game): hide cockpit, show respawn overlay
 * - Respawn countdown and respawn execution; sync with NetworkManager in multiplayer
 *
 * RELATED: gameInGameUI.js (HUD/ESC menu), NetworkManager.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import NetworkManager from "../network/NetworkManager.js";
import {
  setCameraQuaternionFromSpawnMarker,
} from "../utils/playerSpawnOrientation.js";
import { checkSphereCollision, isInsideMesh } from "../physics/Physics.js";
import { refreshCockpitVisibility } from "./gameInGameUI.js";

const SOLO_RESPAWN_MIN_DIST = 10;
const SOLO_RESPAWN_MAX_DIST = 20;
const SOLO_RESPAWN_WALL_MARGIN = 2.5;
const _respawnOffset = new THREE.Vector3();

export function isSoloPlayerCombatInactive(game) {
  return (
    !game.isMultiplayer &&
    (game._soloRespawning || (game.player?.health ?? 0) <= 0)
  );
}

function getPlayerWorldPosition(game, out) {
  if (game.xrManager?.isPresenting && game.xrManager.rig) {
    return out.copy(game.xrManager.rig.position);
  }
  return out.copy(game.camera.position);
}

function isValidSoloRespawnPoint(x, y, z, clearance) {
  return isInsideMesh(x, y, z) && !checkSphereCollision(x, y, z, clearance);
}

function pickSoloRespawnPosition(origin, game) {
  const clearance =
    (game.player?.collisionRadius ?? 1.5) + SOLO_RESPAWN_WALL_MARGIN;

  for (let attempt = 0; attempt < 20; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist =
      SOLO_RESPAWN_MIN_DIST +
      Math.random() * (SOLO_RESPAWN_MAX_DIST - SOLO_RESPAWN_MIN_DIST);
    const yOff = (Math.random() - 0.5) * 4;
    const x = origin.x + Math.cos(angle) * dist;
    const z = origin.z + Math.sin(angle) * dist;
    const y = origin.y + yOff;
    if (isValidSoloRespawnPoint(x, y, z, clearance)) {
      return _respawnOffset.set(x, y, z).clone();
    }
  }

  if (isValidSoloRespawnPoint(origin.x, origin.y, origin.z, clearance)) {
    return origin.clone();
  }
  return origin.clone();
}

function setPlayerWorldPosition(game, position) {
  if (game.xrManager?.isPresenting && game.xrManager.rig) {
    game.xrManager.rig.position.copy(position);
  } else {
    game.camera.position.copy(position);
  }
}

export function showDamageIndicator(game, hitWorldPos) {
  const camPos = game.camera.position.clone();
  const camDir = new THREE.Vector3();
  game.camera.getWorldDirection(camDir);

  const toHit = hitWorldPos.clone().sub(camPos).normalize();

  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  camRight.crossVectors(camDir, game.camera.up).normalize();
  camUp.crossVectors(camRight, camDir).normalize();

  const dotRight = toHit.dot(camRight);
  const dotUp = toHit.dot(camUp);
  const dotForward = toHit.dot(camDir);

  const indicators = [];
  const threshold = 0.3;
  const directHit = dotForward >= 0.5;

  if (!directHit) {
    if (dotRight > threshold) indicators.push("right");
    if (dotRight < -threshold) indicators.push("left");
    if (dotUp > threshold) indicators.push("top");
    if (dotUp < -threshold) indicators.push("bottom");
  }

  indicators.push("center");

  indicators.forEach((dir) => {
    const el = document.querySelector(`.damage-indicator-${dir}`);
    if (el) {
      el.classList.remove("fading");
      if (dir === "center" && directHit) {
        el.classList.add("damage-indicator-center--full");
      }
      el.classList.add("active");

      setTimeout(() => {
        el.classList.remove("active");
        el.classList.add("fading");
      }, 80);

      setTimeout(() => {
        el.classList.remove("fading");
        if (dir === "center") {
          el.classList.remove("damage-indicator-center--full");
        }
      }, 450);
    }
  });
}

export function handleLocalPlayerDeath(game) {
  const overlay = document.getElementById("respawn-overlay");
  overlay.classList.add("active");
  refreshCockpitVisibility(game);

  let timeLeft = 5;
  const timerEl = document.getElementById("respawn-time");
  timerEl.textContent = timeLeft;

  const interval = setInterval(() => {
    timeLeft--;
    timerEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(interval);
    }
  }, 1000);
}

export function startSoloRespawn(game) {
  game._soloRespawning = true;

  if (!game._soloDeathWorldPos) {
    game._soloDeathWorldPos = new THREE.Vector3();
  }
  getPlayerWorldPosition(game, game._soloDeathWorldPos);

  for (let i = 0; i < game.enemies.length; i++) {
    const enemy = game.enemies[i];
    enemy.state = "wander";
    enemy.hasLOS = false;
    enemy._pickNewWaypoint?.();
  }

  const overlay = document.getElementById("respawn-overlay");
  overlay.classList.add("active");
  refreshCockpitVisibility(game);

  let timeLeft = 3;
  const timerEl = document.getElementById("respawn-time");
  timerEl.textContent = timeLeft;

  const interval = setInterval(() => {
    timeLeft--;
    timerEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(interval);
      finishSoloRespawn(game);
    }
  }, 1000);
}

export function finishSoloRespawn(game) {
  const overlay = document.getElementById("respawn-overlay");
  overlay.classList.remove("active");

  game.player.health = game.player.maxHealth;
  game.player.missiles = game.player.maxMissiles;
  game.player.lastDamageTime = 0;

  const savedQuat = game.camera.quaternion.clone();
  let origin = game._soloDeathWorldPos;
  let authoredSpawnIndex = -1;

  if (!origin) {
    const ck = game._lastTriggerRespawnWorldPos;
    if (ck) {
      origin = ck;
    } else if (game.playerSpawnPoints?.length > 0) {
      authoredSpawnIndex = Math.floor(
        Math.random() * game.playerSpawnPoints.length,
      );
      origin = game.playerSpawnPoints[authoredSpawnIndex];
    } else {
      origin = game.camera.position;
    }
  }

  const respawnPos = pickSoloRespawnPosition(origin, game);
  setPlayerWorldPosition(game, respawnPos);

  if (authoredSpawnIndex >= 0) {
    const mq = game.playerSpawnMarkerQuaternions?.[authoredSpawnIndex];
    if (mq) {
      setCameraQuaternionFromSpawnMarker(game.camera.quaternion, mq);
    } else {
      game.camera.quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (-70 * Math.PI) / 180,
      );
    }
    if (game.xrManager?.isPresenting) {
      game.camera.quaternion.identity();
    }
  } else {
    game.camera.quaternion.copy(savedQuat);
    if (game.xrManager?.isPresenting) {
      game.camera.quaternion.identity();
    }
  }

  game.player?.velocity?.set(0, 0, 0);
  game._soloDeathWorldPos = null;

  game._hudLast.health = null;
  game._hudLast.missiles = null;
  game._hudLast.boost = null;
  game._soloRespawning = false;
  refreshCockpitVisibility(game);
}

export function handleLocalPlayerRespawn(game, data = null) {
  const overlay = document.getElementById("respawn-overlay");
  overlay.classList.remove("active");
  refreshCockpitVisibility(game);

  const localPlayer = NetworkManager.getLocalPlayer();
  if (localPlayer && game.player) {
    game.player.health = localPlayer.health;
    game.player.maxHealth = localPlayer.maxHealth;
    game.player.missiles = localPlayer.missiles;
    game.player.boostFuel = localPlayer.boostFuel ?? game.player.maxBoostFuel;
    game.player.maxBoostFuel =
      localPlayer.maxBoostFuel ?? game.player.maxBoostFuel;
    game.player.lastDamageTime = 0;
    game.player.velocity?.set(0, 0, 0);

    const usePayload =
      data &&
      typeof data.x === "number" &&
      typeof data.y === "number" &&
      typeof data.z === "number";
    if (usePayload) {
      game.camera.position.set(data.x, data.y, data.z);
      game.camera.quaternion.set(data.qx, data.qy, data.qz, data.qw);
      if (game.prediction) {
        game.prediction.applyServerState(
          { x: data.x, y: data.y, z: data.z },
          { x: data.qx, y: data.qy, z: data.qz, w: data.qw },
          0,
        );
        game.prediction.snapToServer(
          game.camera.position,
          game.camera.quaternion,
        );
      }
    } else {
      game.camera.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
      game.camera.quaternion.set(
        localPlayer.qx,
        localPlayer.qy,
        localPlayer.qz,
        localPlayer.qw,
      );
    }

    game._hudLast.health = null;
    game._hudLast.missiles = null;
    game._hudLast.boost = null;
  }
}

export function showKillFeed(game, killer, victim) {
  const feed = document.getElementById("kill-feed");
  const entry = document.createElement("div");
  entry.className = "kill-entry";
  entry.innerHTML = `<span class="killer">${killer}</span> → <span class="victim">${victim}</span>`;
  feed.appendChild(entry);

  setTimeout(() => entry.remove(), 5000);
}
