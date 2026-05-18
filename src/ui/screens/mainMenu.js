/**
 * mainMenu.js - MAIN MENU SCREEN
 * =============================================================================
 *
 * ROLE: Renders the main menu DOM: title, callsign, Solo/Create/Join/Options.
 * Binds button handlers and gamepad indicator. Used by MenuManager when
 * currentScreen is MAIN_MENU.
 *
 * RELATED: MenuManager.js, gameData.js (LEVELS), Gamepad.js.
 *
 * =============================================================================
 */

import { GamepadInput } from "../../game/Gamepad.js";
import { LEVELS } from "../../data/gameData.js";
import { SCREENS } from "../MenuManager.js";

const CAMPAIGN_MISSIONS = [
  {
    id: "charon",
    title: "#1: Charon",
    description:
      "Discover what dangers lie kilometers below the surface of the ice moon mine.",
    preview: LEVELS.charon.preview,
    enabled: true,
  },
  {
    id: "saturnalia-rhea",
    title: "#2: Saturnalia",
    description:
      "With the AI swarm bound for Earth, race through a posh ring world resort with a warning.",
    preview: LEVELS.saturnalia.preview,
    enabled: true,
  },
  {
    id: "capital-ship-earth-defense",
    title: "#3: Earth Defense",
    description:
      "Earth's fleet is compromised. Only you and Alcair can stop them.",
    preview: LEVELS.earthdefense.preview,
    enabled: true,
  },
];

function isVideoMainMenu() {
  return (
    typeof document !== "undefined" &&
    document.body.classList.contains("video-main-menu")
  );
}

function updateGamepadIndicator() {
  const indicator = document.getElementById("gamepad-indicator");
  if (indicator) {
    if (GamepadInput.connected) {
      indicator.textContent =
        "🎮 Gamepad: D-Pad - Navigate | A - Select | B - Back";
      indicator.classList.add("active");
    } else {
      indicator.textContent = "";
      indicator.classList.remove("active");
    }
  }
}

function renderTitle() {
  return `
    <div class="menu-title">
      <p class="subtitle"><a href="https://jamesckane.com" target="_blank" rel="noopener noreferrer" class="subtitle-link">JAMES C. KANE</a>'S</p>
      <img class="menu-title-logo" src="/images/ui/Starspeed_WordMark.png" alt="Starspeed game title: metallic silver wordmark with stylized wing on the S and a glowing orange line through the text ending in a starburst." />
      <p class="subtitle">ZERO-G AERIAL COMBAT</p>
    </div>
  `;
}

function renderMainMenuSidebar(manager, { inert = false } = {}) {
  return `
    ${renderTitle()}
    ${renderMainMenuPanel(manager, { inert })}
  `;
}

function renderMainMenuPanel(manager, { inert = false } = {}) {
  const matchmakingActive = Boolean(manager.matchmakingMessage);
  const disabledAttr = matchmakingActive || inert ? "disabled" : "";

  return `
    <div class="menu-panel">
      <div class="menu-content">
        <div class="menu-buttons">
          <label>CALLSIGN</label>
          <div class="name-input-group">
            <input type="text" id="${inert ? "player-name-exit" : "player-name"}" value="${manager.playerName}" maxlength="16" ${disabledAttr} />
          </div>
          <label>SINGLE-PLAYER</label>
          <button class="menu-btn" id="${inert ? "btn-training-exit" : "btn-training"}" ${disabledAttr}>TRAINING GROUNDS</button>
          <button class="menu-btn" id="${inert ? "btn-campaign-exit" : "btn-campaign"}" ${disabledAttr}>CAMPAIGN</button>
          <label>MULTI-PLAYER</label>
          <button class="menu-btn" id="${inert ? "btn-quick-exit" : "btn-quick"}" ${disabledAttr}>QUICKMATCH</button>
          <button class="menu-btn" id="${inert ? "btn-join-exit" : "btn-join"}" ${disabledAttr}>JOIN MATCH</button>
          <button class="menu-btn" id="${inert ? "btn-create-exit" : "btn-create"}" ${disabledAttr}>CREATE MATCH</button>
          <label>MISC</label>
          <div class="menu-buttons-row">
            <button class="menu-btn" id="${inert ? "btn-feedback-exit" : "btn-feedback"}" ${disabledAttr}>FEEDBACK</button>
            <button class="menu-btn" id="${inert ? "btn-options-exit" : "btn-options"}" ${disabledAttr}>OPTIONS</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderMainMenu(manager) {
  const matchmakingActive = Boolean(manager.matchmakingMessage);
  const videoCapture = isVideoMainMenu();

  if (manager.startScene && manager.startScene.renderer) {
    manager.startScene.renderer.domElement.style.display = "block";
  }

  if (videoCapture) {
    manager.menuContent.innerHTML = `
    <div class="menu-screen main-menu main-menu-video">
      <div class="main-menu-video-title">
        <div class="menu-title">
          <p class="subtitle"><a href="https://jamesckane.com" target="_blank" rel="noopener noreferrer" class="subtitle-link">JAMES C. KANE</a>'S</p>
          <img class="menu-title-logo" src="/images/ui/Starspeed_WordMark.png" alt="Starspeed game title: metallic silver wordmark with stylized wing on the S and a glowing orange line through the text ending in a starburst." />
          <p class="subtitle">ZERO-G AERIAL COMBAT</p>
        </div>
      </div>
    </div>
  `;
    updateGamepadIndicator();
    return;
  }

  manager.menuContent.innerHTML = `
    <div class="menu-screen main-menu">
      <div class="main-menu-right">
        ${renderMainMenuSidebar(manager)}
      </div>
      ${
        matchmakingActive
          ? `
      <div class="matchmaking-modal">
        <div class="matchmaking-modal-content">
          <div class="matchmaking-modal-title">MATCHMAKING</div>
          <div class="matchmaking-modal-message">${manager.matchmakingMessage}</div>
        </div>
      </div>
      `
          : ""
      }
    </div>
  `;

  document.getElementById("player-name").addEventListener("input", (e) => {
    manager.saveCallsign(e.target.value || "Pilot");
  });

  document.getElementById("btn-training").addEventListener("click", () => {
    manager.emit("trainingGroundsStart", "newworld");
  });

  document.getElementById("btn-campaign").addEventListener("click", () => {
    manager.showScreen(SCREENS.CAMPAIGN_MISSIONS);
  });

  document.getElementById("btn-create").addEventListener("click", () => {
    manager.showScreen(SCREENS.CREATE_GAME);
  });

  document.getElementById("btn-join").addEventListener("click", () => {
    manager.showScreen(SCREENS.JOIN_GAME);
  });

  document.getElementById("btn-quick").addEventListener("click", () => {
    manager.quickMatch();
  });

  document.getElementById("btn-options").addEventListener("click", () => {
    manager.showScreen(SCREENS.OPTIONS);
  });

  document.getElementById("btn-feedback").addEventListener("click", () => {
    manager.showFeedbackModal({});
  });

  updateGamepadIndicator();
}

export function renderCampaignMissions(manager) {
  if (manager.startScene && manager.startScene.renderer) {
    manager.startScene.renderer.domElement.style.display = "block";
  }

  manager.selectedCampaignMissionId ||= "charon";

  manager.menuContent.innerHTML = `
    <div class="menu-screen main-menu main-menu-campaign">
      <div class="main-menu-right campaign-menu-right">
        ${renderTitle()}
        <div class="main-menu-transition-stage">
          <div class="main-menu-slide-exit" aria-hidden="true">
            ${renderMainMenuPanel(manager, { inert: true })}
          </div>
          <div class="menu-panel campaign-menu-panel campaign-menu-slide-enter">
            <div class="menu-content campaign-menu-content">
              <div class="campaign-heading">
                <button class="menu-btn campaign-back-arrow" id="btn-campaign-back" aria-label="Back to main menu">&larr;</button>
                <span class="campaign-heading-copy">
                  <label>CAMPAIGN</label>
                  <h2>MISSION SELECT</h2>
                </span>
              </div>
              <div class="campaign-mission-list">
                ${CAMPAIGN_MISSIONS.map(
                  (mission) => `
                    <button class="campaign-mission-card ${mission.enabled ? "" : "disabled"} ${mission.id === manager.selectedCampaignMissionId ? "selected" : ""}" data-mission-id="${mission.id}" ${mission.enabled ? "" : "disabled"}>
                      <img class="map-preview campaign-mission-preview" src="${mission.preview}" alt="" />
                      <span class="campaign-mission-copy">
                        <span class="campaign-mission-title">${mission.title}</span>
                        <span class="campaign-mission-description">${mission.description}</span>
                      </span>
                    </button>
                  `,
                ).join("")}
              </div>
              <button class="menu-btn primary campaign-start-btn" id="btn-campaign-start">START</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document
    .querySelectorAll(".campaign-mission-card:not(:disabled)")
    .forEach((card) => {
      card.addEventListener("click", () => {
        manager.selectedCampaignMissionId = card.dataset.missionId;
        document
          .querySelectorAll(".campaign-mission-card")
          .forEach((el) => el.classList.toggle("selected", el === card));
      });
    });

  document.getElementById("btn-campaign-back").addEventListener("click", () => {
    const stage = document.querySelector(".main-menu-transition-stage");
    if (!stage || stage.classList.contains("campaign-menu-reversing")) {
      return;
    }

    stage.classList.add("campaign-menu-reversing");
    window.setTimeout(() => {
      manager.showScreen(SCREENS.MAIN_MENU);
    }, 370);
  });

  document.getElementById("btn-campaign-start").addEventListener("click", () => {
    manager.emit("campaignStart", manager.selectedCampaignMissionId);
  });

  updateGamepadIndicator();
}
