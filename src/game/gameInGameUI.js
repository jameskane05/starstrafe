/**
 * gameInGameUI.js - IN-GAME HUD, ESC MENU, AND LEADERBOARD
 * =============================================================================
 *
 * ROLE: Sets up and controls in-play UI: HUD elements (health, kills, missiles,
 * boost), ESC pause menu, leaderboard overlay, and controls help. Binds DOM
 * elements and keyboard (KeyBindings) for menu toggle and resume.
 *
 * KEY RESPONSIBILITIES:
 * - setup(game): bind HUD refs, game menu and leaderboard buttons to DOM
 * - updateHUD(game), toggleEscMenu(game), showEscMenu / resumeGame
 * - showLeaderboard / hideLeaderboard; controls help visibility
 *
 * RELATED: MenuManager.js, KeyBindings.js, gameData.js, ShipDestruction.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import MenuManager from "../ui/MenuManager.js";
import NetworkManager from "../network/NetworkManager.js";
import { KeyBindings, getKeyDisplayName } from "./KeyBindings.js";
import { GAME_STATES } from "../data/gameData.js";
import { cleanupDestruction } from "../vfx/ShipDestruction.js";
import proceduralAudio from "../audio/ProceduralAudio.js";

const _helperWorld = new THREE.Vector3();
const _helperProjected = new THREE.Vector3();
const _helperView = new THREE.Vector3();
const _helperDir2 = new THREE.Vector2();
const _helperDir3 = new THREE.Vector3();
const _helperCamWorld = new THREE.Vector3();
const _missionDistancePlayer = new THREE.Vector3();
const _missionDistanceTarget = new THREE.Vector3();

/** Camera–target distance at which the helper is most faded/shrunk; ramps to full size by `PROX_FAR`. */
const DIRECTIONAL_HELPER_PROX_NEAR = 14;
const DIRECTIONAL_HELPER_PROX_FAR = 95;

/** Set true to show the mission objectives panel (title + checklist). */
const SHOW_MISSION_OBJECTIVES_PANEL = false;

function normalizeAngle(angle) {
  let out = angle;
  while (out <= -Math.PI) out += Math.PI * 2;
  while (out > Math.PI) out -= Math.PI * 2;
  return out;
}

function lerpAngle(from, to, t) {
  return from + normalizeAngle(to - from) * t;
}

function createDirectionalHelper3D() {
  const root = new THREE.Group();
  const materials = [];

  const makeMaterial = (options) => {
    const material = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      ...options,
    });
    materials.push(material);
    return material;
  };

  const frame = new THREE.Mesh(
    new THREE.TorusGeometry(0.034, 0.0026, 10, 36),
    makeMaterial({
      color: 0x103640,
      emissive: 0x00e8ff,
      emissiveIntensity: 1.15,
      metalness: 0.2,
      roughness: 0.32,
    }),
  );
  root.add(frame);

  const tickGeometry = new THREE.BoxGeometry(0.006, 0.018, 0.004);
  const tickMaterial = makeMaterial({
    color: 0x8adfeb,
    emissive: 0x00d8f5,
    emissiveIntensity: 1.7,
    metalness: 0.08,
    roughness: 0.22,
  });
  const tickOffsets = [
    [0, 0.048, 0],
    [0, -0.048, 0],
    [-0.048, 0, 0],
    [0.048, 0, 0],
  ];
  for (const [x, y, z] of tickOffsets) {
    const tick = new THREE.Mesh(tickGeometry, tickMaterial.clone());
    materials.push(tick.material);
    tick.position.set(x, y, z);
    if (x !== 0) tick.rotation.z = Math.PI / 2;
    root.add(tick);
  }

  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.008, 0.024, 0.004),
    makeMaterial({
      color: 0xa7f7ff,
      emissive: 0x00e8ff,
      emissiveIntensity: 2.1,
      metalness: 0.08,
      roughness: 0.2,
    }),
  );
  shaft.position.y = 0.014;
  root.add(shaft);

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.011, 0.02, 5),
    makeMaterial({
      color: 0xc8ffff,
      emissive: 0x8affff,
      emissiveIntensity: 2.45,
      metalness: 0.08,
      roughness: 0.18,
    }),
  );
  head.position.y = 0.036;
  root.add(head);

  const finGeometry = new THREE.BoxGeometry(0.006, 0.014, 0.004);
  const finMaterial = makeMaterial({
    color: 0x0f3942,
    emissive: 0x00cfe6,
    emissiveIntensity: 1.0,
    metalness: 0.3,
    roughness: 0.32,
  });
  const finLeft = new THREE.Mesh(finGeometry, finMaterial);
  finLeft.position.set(-0.012, 0.011, 0);
  finLeft.rotation.z = 0.64;
  root.add(finLeft);

  const finRight = new THREE.Mesh(finGeometry, finMaterial.clone());
  materials.push(finRight.material);
  finRight.position.set(0.012, 0.011, 0);
  finRight.rotation.z = -0.64;
  root.add(finRight);

  root.visible = false;
  root.userData.materials = materials;
  root.userData.frame = frame;
  root.userData.currentAngle = 0;
  root.userData.pendingAngle = null;
  return root;
}

export function refreshCockpitVisibility(game) {
  const ck = game.player?.cockpit;
  if (!ck) return;
  const respawnEl = document.getElementById("respawn-overlay");
  const respawnActive = respawnEl?.classList.contains("active");
  ck.visible = !game.hidePilotChrome && !respawnActive;
}

export function setHidePilotChrome(game, hidden) {
  game.hidePilotChrome = !!hidden;
  document.body.classList.toggle("pilot-chrome-hidden", game.hidePilotChrome);
  refreshCockpitVisibility(game);
}

export function toggleHidePilotChrome(game) {
  setHidePilotChrome(game, !game.hidePilotChrome);
}

export function setup(game) {
  game.hud = {
    health: document.getElementById("health"),
    missiles: document.getElementById("missiles"),
    boost: document.getElementById("boost"),
    mobileMissiles: document.getElementById("mobile-missiles"),
    mobileBoost: document.getElementById("mobile-boost"),
    mobileMissileButton: document.querySelector(
      "#mobile-controls button[data-action=\"fire-missile\"]",
    ),
    mobileMissilesCounter: document.querySelector(
      "#mobile-controls .mobile-missiles",
    ),
  };
  game.controlsHelpEl = document.getElementById("controls-help");
  if (!game.missionPanel) {
    game.missionPanel = document.createElement("div");
    game.missionPanel.id = "mission-panel";
    game.missionPanel.className = "mission-panel collapsed";
    game.missionPanel.innerHTML = `
      <button
        id="mission-panel-toggle"
        class="mission-panel-toggle"
        type="button"
        aria-expanded="false"
      >
        <span>OBJECTIVES</span>
        <span class="mission-panel-chevron">+</span>
      </button>
      <div id="mission-panel-content" class="mission-panel-content"></div>
    `;
    document.body.appendChild(game.missionPanel);
    game.missionPanelContent = game.missionPanel.querySelector(
      "#mission-panel-content",
    );
    const missionPanelToggle = game.missionPanel.querySelector(
      "#mission-panel-toggle",
    );
    missionPanelToggle?.addEventListener("click", () => {
      game.missionPanelCollapsed = !game.missionPanelCollapsed;
      syncMissionPanelState(game);
    });
  }
  if (game.missionPanelCollapsed == null) {
    game.missionPanelCollapsed = isMobileLayout(game);
  }
  syncMissionPanelState(game);

  if (!game.directionalHelperRoot && game.camera) {
    game.directionalHelperRoot = createDirectionalHelper3D();
    game.camera.add(game.directionalHelperRoot);
  }
  if (game._directionalHelperOpacity == null) {
    game._directionalHelperOpacity = 0;
  }

  const gameMenuBtn = document.getElementById("game-menu-btn");
  const gameLeaderboardBtn = document.getElementById("game-leaderboard-btn");
  if (gameMenuBtn) {
    gameMenuBtn.addEventListener("click", () => showEscMenu(game));
  }
  if (gameLeaderboardBtn) {
    gameLeaderboardBtn.addEventListener("click", () => {
      if (!game.gameManager?.isPlaying()) return;
      const isOpen = document
        .getElementById("tab-leaderboard")
        ?.classList.contains("active");
      if (isOpen) hideLeaderboard(game);
      else showLeaderboard(game);
    });
  }
  updateLeaderboardButtonVisibility(game);
}

export function toggleEscMenu(game) {
  if (!game.gameManager?.isPlaying()) return;

  if (game.inOptions) {
    MenuManager.closeOptionsInGame();
    return;
  }

  if (game.isEscMenuOpen) {
    resumeGame(game);
  } else if (document.getElementById("mission-complete-overlay")) {
    return;
  } else if (document.pointerLockElement) {
    document.exitPointerLock?.();
  } else {
    showEscMenu(game);
  }
}

export function showEscMenu(game) {
  if (game.isEscMenuOpen) return;
  if (document.getElementById("mission-complete-overlay")) return;
  game.isEscMenuOpen = true;
  document.exitPointerLock?.();
  document.getElementById("crosshair")?.classList.remove("active");

  if (!game.escMenu) {
    game.escMenu = document.createElement("div");
    game.escMenu.id = "esc-menu";
    document.body.appendChild(game.escMenu);
  }

  game.escMenu.innerHTML = `
    <div class="esc-overlay"></div>
    <div class="esc-content">
      <h2>MENU</h2>
      <div class="esc-buttons">
        <button id="esc-resume" class="esc-btn">RESUME</button>
        <button id="esc-options" class="esc-btn">OPTIONS</button>
        <button id="esc-feedback" class="esc-btn">FEEDBACK</button>
        <button id="esc-leave" class="esc-btn esc-btn-danger">LEAVE MATCH</button>
      </div>
    </div>
  `;

  game.escMenu.querySelector(".esc-overlay")?.addEventListener("click", () => {
    resumeGame(game);
  });
  game.escMenu.querySelector(".esc-content")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document
    .getElementById("esc-resume")
    .addEventListener("click", () => resumeGame(game));
  document
    .getElementById("esc-options")
    .addEventListener("click", () => showOptionsMenu(game));
  document.getElementById("esc-feedback").addEventListener("click", () => {
    game.escMenu.style.display = "none";
    MenuManager.showFeedbackModal({
      onClose: () => {
        if (game.isEscMenuOpen && game.escMenu) {
          game.escMenu.style.display = "flex";
        }
      },
    });
  });
  document
    .getElementById("esc-leave")
    .addEventListener("click", () => leaveMatch(game));

  game.escMenu.style.display = "flex";
}

export function showOptionsMenu(game) {
  if (game.escMenu) {
    game.escMenu.style.display = "none";
  }
  game.inOptions = true;
  MenuManager.showOptionsFromGame(() => {
    game.inOptions = false;
    resumeGame(game);
  });
}

export function showLeaderboard(game) {
  if (!game.isMultiplayer) return;
  if (!game.leaderboardEl) {
    game.leaderboardEl = document.createElement("div");
    game.leaderboardEl.id = "tab-leaderboard";
    document.body.appendChild(game.leaderboardEl);
  }

  let players;
  let localId;

  if (game.isMultiplayer) {
    localId = NetworkManager.sessionId;
    players = NetworkManager.getPlayers()
      .map(([id, p]) => ({
        id,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
      }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  } else {
    const state = game.gameManager.getState();
    localId = "local";
    players = [
      {
        id: "local",
        name: MenuManager.playerName || "Pilot",
        kills: state.enemiesKilled || 0,
        deaths: state.deaths || 0,
      },
    ];
  }

  let timerHtml = "";
  if (game.isMultiplayer) {
    const state = NetworkManager.getState();
    const elapsed = state?.matchTime ?? 0;
    const max = state?.maxMatchTime ?? 480;
    timerHtml = `<div class="leaderboard-timer" id="leaderboard-timer">${formatMatchTime(elapsed)} / ${formatMatchTime(max)}</div>`;
  }

  game.leaderboardEl.innerHTML = `
    <div class="leaderboard">
      <h2>LEADERBOARD</h2>
      <div class="leaderboard-header">
        <span class="lb-rank">#</span>
        <span class="lb-name">PILOT</span>
        <span class="lb-deaths">D</span>
      </div>
      ${players
        .map(
          (p, i) => `
        <div class="leaderboard-row ${p.id === localId ? "local" : ""}">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${p.name}</span>
          <span class="lb-deaths">${p.deaths}</span>
        </div>
      `,
        )
        .join("")}
      ${timerHtml}
    </div>
  `;

  game.leaderboardEl.classList.add("active");
}

export function hideLeaderboard(game) {
  if (game.leaderboardEl) {
    game.leaderboardEl.classList.remove("active");
  }
}

export function updateLeaderboardButtonVisibility(game) {
  const visible = Boolean(game.isMultiplayer);
  const desktopBtn = document.getElementById("game-leaderboard-btn");
  const mobileBtn = document.getElementById("mobile-leaderboard-btn");
  if (desktopBtn) {
    desktopBtn.style.display = visible ? "" : "none";
    desktopBtn.disabled = !visible;
  }
  if (mobileBtn) {
    mobileBtn.style.display = visible ? "" : "none";
    mobileBtn.disabled = !visible;
  }
  if (!visible) {
    hideLeaderboard(game);
  }
}

function formatMatchTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function updateLeaderboardTimer(game) {
  if (!game.isMultiplayer || !game.leaderboardEl?.classList.contains("active"))
    return;
  const el = document.getElementById("leaderboard-timer");
  if (!el) return;
  const state = NetworkManager.getState();
  const elapsed = state?.matchTime ?? 0;
  const max = state?.maxMatchTime ?? 480;
  el.textContent = `${formatMatchTime(elapsed)} / ${formatMatchTime(max)}`;
}

export function showControlsHelp(game, visible) {
  if (!game.controlsHelpEl) return;
  if (!game.gameManager?.isPlaying()) {
    if (!visible) game.controlsHelpEl.classList.remove("visible");
    return;
  }
  if (visible) {
    const bindings = KeyBindings.getAllBindings();
    const rows = [
      ["Move", "forward", "backward", "left", "right"],
      ["Look", "lookUp", "lookDown", "lookLeft", "lookRight"],
      ["Roll", "rollLeft", "rollRight"],
      ["Strafe", "strafeUp", "strafeDown"],
      ["Boost", "boost"],
      ["Fire", null],
      ["Switch primary", "switchPrimaryWeapon"],
      ["Missile fire", null],
      ["Switch missile mode", "switchMissileMode"],
      ["Homing missile", "missile"],
      ["Kinetic missile", "kineticMissile"],
      ["Headlight", "toggleHeadlight"],
      ["Hide HUD / cockpit", null],
      ["Map", "toggleAutomap"],
      ["Leaderboard", "leaderboard"],
      ["Pause", "pause"],
    ];
    const rowLabels = {
      Fire: "Left Click",
      "Missile fire": "Right Click",
      "Hide HUD / cockpit": "Alt+H (toggle)",
    };
    const html = rows
      .map(([label, ...actions]) => {
        const keys = actions
          .filter(Boolean)
          .map((a) => bindings[a] && getKeyDisplayName(bindings[a]))
          .filter(Boolean)
          .join(" ");
        const display = rowLabels[label] || keys || "-";
        return `<span class="ctrl-row"><span class="ctrl-label">${label}:</span><span class="ctrl-key">${display}</span></span>`;
      })
      .join("");
    game.controlsHelpEl.querySelector(".controls-help-content").innerHTML =
      html;
    game.controlsHelpEl.classList.add("visible");
  } else {
    game.controlsHelpEl.classList.remove("visible");
  }
}

export function resumeGame(game) {
  if (!game.isEscMenuOpen) return;
  game.isEscMenuOpen = false;

  if (game.escMenu) {
    game.escMenu.style.display = "none";
  }

  document.getElementById("crosshair").classList.add("active");

  if (!game.input.mobile.shouldSkipPointerLock()) {
    const canvas = game.renderer.domElement;
    canvas.requestPointerLock?.()?.catch?.(() => {
      const clickToLock = () => {
        canvas.requestPointerLock?.();
        canvas.removeEventListener("click", clickToLock);
      };
      canvas.addEventListener("click", clickToLock);
    });
  }
}

const MISSION_COMPLETE_OVERLAY_MS = 440;

export function hideMissionCompleteOverlay(game) {
  const el =
    game._missionCompleteOverlayEl ??
    document.getElementById("mission-complete-overlay");
  if (!el) return;
  game._missionCompleteOverlayEl = null;
  el.classList.remove("mission-complete-overlay--visible");
  window.setTimeout(() => el.remove(), MISSION_COMPLETE_OVERLAY_MS);
}

export function showMissionCompleteOverlay(game, options = {}) {
  document.getElementById("mission-complete-overlay")?.remove();
  game._missionCompleteOverlayEl = null;

  document.exitPointerLock?.();
  document.getElementById("crosshair")?.classList.remove("active");

  const state = game.gameManager?.getState?.() ?? {};
  const subtitle =
    options.subtitle ??
    state.missionStepTitle ??
    (state.currentMissionId === "trainingGrounds"
      ? "Training complete"
      : "Mission complete");
  const title = options.title ?? "Mission complete";
  const continueLabel = options.continueLabel ?? "Continue";
  const menuOnly = options.menuOnly === true;

  const root = document.createElement("div");
  root.id = "mission-complete-overlay";
  root.className = "mission-complete-overlay";
  if (options.solidBlackBackdrop) {
    root.classList.add("mission-complete-overlay--solid-black");
  }
  if (options.zIndex != null) {
    root.style.zIndex = String(options.zIndex);
  }
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "mission-complete-heading");
  root.innerHTML = `
    <div class="mission-complete-backdrop" aria-hidden="true"></div>
    <div class="mission-complete-card">
      <h2 id="mission-complete-heading" class="mission-complete-title"></h2>
      <p class="mission-complete-subtitle"></p>
      <div class="mission-complete-actions">
        ${
          menuOnly
            ? ""
            : `<button type="button" class="mission-complete-btn mission-complete-btn-primary" id="mission-complete-continue"></button>`
        }
        <button type="button" class="mission-complete-btn${
          menuOnly ? " mission-complete-btn-primary" : ""
        }" id="mission-complete-menu">
          Main menu
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  const titleEl = root.querySelector(".mission-complete-title");
  if (titleEl) titleEl.textContent = title;
  const subEl = root.querySelector(".mission-complete-subtitle");
  if (subEl) subEl.textContent = subtitle;
  const continueBtn = root.querySelector("#mission-complete-continue");
  if (continueBtn) continueBtn.textContent = continueLabel;
  game._missionCompleteOverlayEl = root;

  const releaseOutroUnderlay = () => {
    const outroId = options.outroOverlayId;
    if (!outroId) return;
    const outro = document.getElementById(outroId);
    if (!outro) return;
    outro.style.pointerEvents = "none";
    outro.style.zIndex = "3000";
  };

  const revealOverlay = () => {
    root.classList.add("mission-complete-overlay--visible");
    if (options.solidBlackBackdrop) {
      const backdrop = root.querySelector(".mission-complete-backdrop");
      if (backdrop) backdrop.style.opacity = "1";
    }
  };

  const defaultOnContinue = () => {
    hideMissionCompleteOverlay(game);
    game.missionManager?.stopMission({ preserveState: true });
    game.gameManager.clearMissionState();
    document.getElementById("crosshair")?.classList.add("active");
    if (!game.input?.mobile?.shouldSkipPointerLock?.()) {
      const canvas = game.renderer.domElement;
      canvas.requestPointerLock?.()?.catch?.(() => {
        const clickToLock = () => {
          canvas.requestPointerLock?.();
          canvas.removeEventListener("click", clickToLock);
        };
        canvas.addEventListener("click", clickToLock);
      });
    }
  };

  const onContinue = async () => {
    if (root.dataset.done) return;
    root.dataset.done = "1";
    root.querySelector("#mission-complete-continue")?.removeEventListener(
      "click",
      onContinue,
    );
    root.querySelector("#mission-complete-menu")?.removeEventListener(
      "click",
      onMenu,
    );
    if (options.onContinue) {
      await options.onContinue();
      return;
    }
    defaultOnContinue();
  };

  const onMenu = async () => {
    if (root.dataset.done) return;
    root.dataset.done = "1";
    root.querySelector("#mission-complete-continue")?.removeEventListener(
      "click",
      onContinue,
    );
    root.querySelector("#mission-complete-menu")?.removeEventListener(
      "click",
      onMenu,
    );
    if (options.onMenu) {
      await options.onMenu();
      return;
    }
    leaveMatch(game);
  };

  root
    .querySelector("#mission-complete-continue")
    ?.addEventListener("click", onContinue);
  root.querySelector("#mission-complete-menu")?.addEventListener("click", onMenu);

  releaseOutroUnderlay();
  if (options.solidBlackBackdrop) {
    revealOverlay();
  } else {
    requestAnimationFrame(() => {
      requestAnimationFrame(revealOverlay);
    });
  }
}

export function leaveMatch(game) {
  game.isEscMenuOpen = false;
  hideMissionCompleteOverlay(game);

  if (game.escMenu) {
    game.escMenu.style.display = "none";
  }

  cleanupDestruction(game.scene);
  game.missionManager?.stopMission();
  game.pendingMissionConfig = null;

  if (game.isMultiplayer) {
    NetworkManager.leaveRoom();
    game.cleanupMultiplayer();
    game.isMultiplayer = false;
  }

  game.renderer.domElement.style.display = "none";

  setHidePilotChrome(game, false);
  document.getElementById("crosshair").classList.remove("active");
  document.getElementById("hud").classList.remove("active");
  if (game.missionPanel) {
    game.missionPanel.style.display = "none";
  }
  game.directionalHelperTarget = null;
  game.missionPanelCollapsed = isMobileLayout(game);
  syncMissionPanelState(game);
  game.player = null;
  MenuManager.show();
  game.gameManager.setState({
    currentState: GAME_STATES.MENU,
    isRunning: false,
    isMultiplayer: false,
  });
}

export function updateHUD(game, delta) {
  if (!game.hud || !game.player) return;
  delta = Number.isFinite(delta) ? delta : 0.1;

  game._hudAccum += delta;
  if (game._hudAccum < 0.1) return;
  game._hudAccum = 0;

  const healthPercent = Math.max(
    0,
    Math.round((game.player.health / game.player.maxHealth) * 100),
  );
  const missiles = game.player.missiles;
  const boostPercent = Math.max(
    0,
    Math.round((game.player.boostFuel / game.player.maxBoostFuel) * 100),
  );

  if (healthPercent !== game._hudLast.health) {
    if (game.hud.health) game.hud.health.textContent = String(healthPercent);
    game._hudLast.health = healthPercent;
  }
  const maxMissiles = game.player.maxMissiles || missiles;
  if (missiles !== game._hudLast.missiles) {
    const text = `${missiles}/${maxMissiles}`;
    if (game.hud.missiles) game.hud.missiles.textContent = text;
    if (game.hud.mobileMissiles) game.hud.mobileMissiles.textContent = text;
    game._hudLast.missiles = missiles;
  }
  if (boostPercent !== game._hudLast.boost) {
    const text = String(boostPercent);
    if (game.hud.boost) game.hud.boost.textContent = text;
    if (game.hud.mobileBoost) game.hud.mobileBoost.textContent = text;
    game._hudLast.boost = boostPercent;
  }

  const missilesEnabled = game.canFireMissiles();
  if (missilesEnabled !== game._hudLast.missilesEnabled) {
    game._hudLast.missilesEnabled = missilesEnabled;
    const locked = !missilesEnabled;
    const btn = game.hud.mobileMissileButton;
    const ctr = game.hud.mobileMissilesCounter;
    if (btn) {
      btn.classList.toggle("mobile-missiles-locked", locked);
      if (locked) btn.setAttribute("aria-disabled", "true");
      else btn.removeAttribute("aria-disabled");
    }
    if (ctr) ctr.classList.toggle("mobile-missiles-locked", locked);
  }

  game.player.updateCockpitStatusDisplay?.({
    healthPercent,
    missiles,
    maxMissiles,
    boostPercent,
    primaryWeapon: game.getSelectedPrimaryWeapon?.(),
  });

  updateMissionPanel(game);
}

export function updateDirectionalHelper(game, delta) {
  const helper = game.directionalHelperRoot;
  if (!helper || !game.camera) return;

  const target = game.directionalHelperTarget;
  const worldPos = resolveDirectionalHelperTarget(target, _helperWorld);

  // Beep on tracker acquire/dismiss, debounced so brief flickers
  // (e.g. between checkpoint activations) don't chirp.
  const hasTarget = !!worldPos;
  if (hasTarget === !!game._directionalHelperHadTarget) {
    game._directionalHelperTargetPendingTime = 0;
  } else {
    game._directionalHelperTargetPendingTime =
      (game._directionalHelperTargetPendingTime ?? 0) + (delta || 0.016);
    if (game._directionalHelperTargetPendingTime >= 0.2) {
      game._directionalHelperHadTarget = hasTarget;
      game._directionalHelperTargetPendingTime = 0;
      if (game.gameManager?.isPlaying() && !game.isEscMenuOpen) {
        if (hasTarget) proceduralAudio.objectiveTrackerOn();
        else proceduralAudio.objectiveTrackerOff();
      }
    }
  }

  const canShow =
    game.gameManager?.isPlaying() &&
    !game.isEscMenuOpen &&
    !game.hidePilotChrome &&
    worldPos &&
    !game.xrManager?.isPresenting;

  let targetOpacity = 0;
  let targetScale = 0.84;
  let desiredAngle = helper.userData.currentAngle ?? 0;
  let desiredPosition = helper.position.clone();

  if (canShow) {
    game.camera.getWorldPosition(_helperCamWorld);
    const distToTarget = _helperCamWorld.distanceTo(worldPos);
    const proxSpan = Math.max(1e-3, DIRECTIONAL_HELPER_PROX_FAR - DIRECTIONAL_HELPER_PROX_NEAR);
    const proxT = THREE.MathUtils.clamp(
      (distToTarget - DIRECTIONAL_HELPER_PROX_NEAR) / proxSpan,
      0,
      1,
    );
    const proxEase = proxT * proxT * (3 - 2 * proxT);
    const proxScaleMul = THREE.MathUtils.lerp(0.5, 1, proxEase);
    const proxOpacityMul = THREE.MathUtils.lerp(0.38, 1, proxEase);

    _helperProjected.copy(worldPos).project(game.camera);
    _helperView.copy(worldPos).applyMatrix4(game.camera.matrixWorldInverse);
    const inFront = _helperView.z < 0;
    const insideFrustum =
      inFront &&
      Math.abs(_helperProjected.x) <= 1 &&
      Math.abs(_helperProjected.y) <= 1;
    const vp = window.visualViewport;
    const width = vp ? Math.round(vp.width) : window.innerWidth;
    const height = vp ? Math.round(vp.height) : window.innerHeight;
    const depth = 0.6;
    const halfHeight =
      Math.tan(THREE.MathUtils.degToRad(game.camera.fov * 0.5)) * depth;
    const halfWidth = halfHeight * (width / Math.max(1, height));

    if (insideFrustum) {
      desiredPosition = _helperDir3.set(
        THREE.MathUtils.clamp(_helperProjected.x, -0.92, 0.92) * halfWidth,
        THREE.MathUtils.clamp(_helperProjected.y, -0.92, 0.92) * halfHeight,
        -depth,
      );
      desiredAngle = 0;
      targetOpacity = 0.28 * proxOpacityMul;
      targetScale = 0.52 * proxScaleMul;
    } else {
      _helperDir2.set(
        inFront ? _helperProjected.x : _helperView.x,
        inFront ? _helperProjected.y : _helperView.y,
      );
      if (_helperDir2.lengthSq() < 1e-6) {
        _helperDir2.set(0, -1);
      } else {
        _helperDir2.normalize();
      }
      const radius = 0.72;
      desiredPosition = _helperDir3.set(
        _helperDir2.x * halfWidth * radius,
        _helperDir2.y * halfHeight * radius,
        -depth,
      );
      desiredAngle = Math.atan2(_helperDir2.y, _helperDir2.x) - Math.PI / 2;
      targetOpacity = 1 * proxOpacityMul;
      targetScale = 1 * proxScaleMul;
    }
  }

  const rate = 10;
  const t = 1 - Math.exp(-rate * Math.max(0, delta || 0.016));
  const currentAngle = helper.userData.currentAngle ?? 0;
  const pendingAngle = helper.userData.pendingAngle;

  if (targetOpacity > 0) {
    if (pendingAngle != null) {
      targetOpacity = 0;
      if (game._directionalHelperOpacity <= 0.08) {
        helper.userData.currentAngle = pendingAngle;
        helper.userData.pendingAngle = null;
      }
    } else if (
      game._directionalHelperOpacity > 0.28 &&
      Math.abs(normalizeAngle(desiredAngle - currentAngle)) > Math.PI * 0.72
    ) {
      helper.userData.pendingAngle = desiredAngle;
      targetOpacity = 0;
    } else {
      helper.userData.currentAngle = lerpAngle(currentAngle, desiredAngle, t * 0.8);
      helper.position.lerp(desiredPosition, t * 0.9);
    }
  } else if (pendingAngle == null) {
    helper.position.lerp(desiredPosition, t * 0.5);
  }

  game._directionalHelperOpacity +=
    (targetOpacity - game._directionalHelperOpacity) * t;
  const opacity = game._directionalHelperOpacity;
  const scale = 0.84 + (targetScale - 0.84) * opacity;

  helper.visible = opacity > 0.01;
  helper.scale.setScalar(scale);
  helper.rotation.set(0, 0, helper.userData.currentAngle ?? desiredAngle);
  for (const material of helper.userData.materials ?? []) {
    material.opacity = opacity * 0.82;
  }
  if (helper.userData.frame?.material) {
    helper.userData.frame.material.emissiveIntensity = 0.55 + opacity * 1.1;
  }
}

export function cycleEnemyTargetReticle(_game) {}

function updateMissionPanel(game) {
  if (!game.missionPanel) return;
  if (!SHOW_MISSION_OBJECTIVES_PANEL) {
    game.missionPanel.style.display = "none";
    if (game.missionPanelContent) {
      game.missionPanelContent.innerHTML = "";
    }
    return;
  }
  const state = game.gameManager?.getState?.();
  const activeMission =
    state?.currentMissionId &&
    ["active", "complete"].includes(state?.missionStatus);
  const objectives = state?.currentObjectives ?? [];

  if (!activeMission || !objectives.length) {
    game.missionPanel.style.display = "none";
    if (game.missionPanelContent) {
      game.missionPanelContent.innerHTML = "";
    }
    return;
  }

  const statusLabel =
    state.missionStatus === "complete" ? "COMPLETE" : "OBJECTIVES";
  const hideObjectivesUiForTraining =
    state.currentMissionId === "trainingGrounds";
  let distanceReadout = "";
  if (
    state.currentMissionId === "saturnalia" &&
    game.directionalHelperTarget?.object3D
  ) {
    const playerPos =
      game.xrManager?.isPresenting && game.xrManager.rig
        ? game.xrManager.rig.position
        : game.camera?.position;
    if (playerPos) {
      game.directionalHelperTarget.object3D.getWorldPosition(
        _missionDistanceTarget,
      );
      _missionDistancePlayer.copy(playerPos);
      const centimeters = Math.max(
        0,
        Math.round(_missionDistancePlayer.distanceTo(_missionDistanceTarget) * 100),
      );
      distanceReadout = `
        <div class="mission-panel-distance">${centimeters.toLocaleString()} CM</div>
      `;
    }
  }
  game.missionPanel.style.display = hideObjectivesUiForTraining
    ? "none"
    : "block";
  if (game.missionPanelContent) {
    game.missionPanelContent.innerHTML = `
      <div class="mission-panel-title">${state.missionStepTitle || "Mission"}</div>
      ${distanceReadout}
      <div class="mission-panel-list">
        ${objectives
          .map(
            (objective) => `
              <div class="mission-panel-item ${objective.completed ? "completed" : ""}">
                <span class="mission-panel-marker">${objective.completed ? "✓" : "○"}</span>
                <span>${objective.text}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }
  syncMissionPanelState(game);
}

function syncMissionPanelState(game) {
  if (!game.missionPanel) return;
  const collapsed = game.missionPanelCollapsed !== false;
  game.missionPanel.classList.toggle("collapsed", collapsed);
  const toggle = game.missionPanel.querySelector("#mission-panel-toggle");
  const chevron = game.missionPanel.querySelector(".mission-panel-chevron");
  if (toggle) {
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
  if (chevron) {
    chevron.textContent = collapsed ? "+" : "−";
  }
}

function isMobileLayout(game) {
  return Boolean(game?.gameManager?.state?.isMobile);
}

function resolveDirectionalHelperTarget(target, out) {
  if (!target) return null;
  if (typeof target.getWorldPosition === "function") {
    const result = target.getWorldPosition(out);
    if (!result) return null;
    if (result !== out) out.copy(result);
    return out;
  }
  if (target.object3D?.getWorldPosition) {
    target.object3D.getWorldPosition(out);
    return out;
  }
  if (target.position) {
    out.copy(target.position);
    return out;
  }
  return null;
}
