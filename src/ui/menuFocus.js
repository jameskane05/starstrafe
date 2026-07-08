/**
 * menuFocus.js - MENU KEYBOARD AND GAMEPAD FOCUS
 * =============================================================================
 *
 * ROLE: Manages focusable elements and navigation in menu screens. Arrow keys
 * and gamepad d-pad move focus; Enter/A selects; Escape/B backs. Polls gamepad
 * for menu navigation when not in PLAYING.
 *
 * KEY RESPONSIBILITIES:
 * - init(manager): keydown listener, gamepad polling
 * - updateFocus(manager), getFocusableElements(container); handleMenuKeydown
 * - startGamepadPolling / stopGamepadPolling; FOCUS_SELECTOR for focusable items
 *
 * RELATED: MenuManager.js, Gamepad.js, ProceduralAudio.js.
 *
 * =============================================================================
 */

import { GamepadInput } from "../game/Gamepad.js";
import { SCREENS } from "./MenuManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import NetworkManager from "../network/NetworkManager.js";

const FOCUS_SELECTOR =
  [
    ".menu-btn",
    ".campaign-mission-card:not(:disabled)",
    ".back-btn",
    ".mode-btn:not(.disabled)",
    ".vis-btn",
    ".limit-btn",
    ".players-btn",
    ".join-btn",
    ".refresh-btn",
    ".rebind-btn",
    ".options-btn:not(:disabled)",
    ".options-tab",
    ".sidebar-btn",
    ".volume-slider",
    ".ready-checkbox input",
    "#chk-ready",
    "#lobby-level-select",
    ".kick-btn",
    ".mute-btn",
  ].join(", ");

export function init(manager) {
  document.addEventListener("keydown", (e) => handleMenuKeydown(manager, e));
  startGamepadPolling(manager);
}

export function startGamepadPolling(manager) {
  if (manager.gamepadPollInterval) return;
  manager.gamepadPollInterval = setInterval(
    () => pollGamepadForMenu(manager),
    16,
  );
}

export function stopGamepadPolling(manager) {
  if (manager.gamepadPollInterval) {
    clearInterval(manager.gamepadPollInterval);
    manager.gamepadPollInterval = null;
  }
}

function handleMenuKeydown(manager, e) {
  if (manager.currentScreen === SCREENS.PLAYING) return;
  if (manager.feedbackModalEl && manager.feedbackModalEl.style.display === "flex")
    return;
  if (
    document.activeElement?.tagName === "INPUT" ||
    document.activeElement?.tagName === "SELECT" ||
    document.activeElement?.tagName === "TEXTAREA"
  ) {
    if (e.code === "Escape") {
      document.activeElement.blur();
      updateFocus(manager);
    }
    return;
  }

  switch (e.code) {
    case "ArrowUp":
    case "KeyW":
      e.preventDefault();
      navigateFocus(manager, -1);
      break;
    case "ArrowDown":
    case "KeyS":
      e.preventDefault();
      navigateFocus(manager, 1);
      break;
    case "Enter":
    case "Space":
      e.preventDefault();
      activateFocused(manager);
      break;
    case "Escape":
      handleMenuBack(manager);
      break;
  }
}

function pollGamepadForMenu(manager) {
  if (manager.currentScreen === SCREENS.PLAYING) return;
  if (manager.feedbackModalEl && manager.feedbackModalEl.style.display === "flex")
    return;

  GamepadInput.poll();
  if (!GamepadInput.connected) return;

  const now = Date.now();
  if (now - manager.lastNavTime < manager.navCooldown) return;

  const state = GamepadInput.state;

  if (state.buttons.dpadUp || state.leftStick.y < -0.5) {
    navigateFocus(manager, -1);
    manager.lastNavTime = now;
  } else if (state.buttons.dpadDown || state.leftStick.y > 0.5) {
    navigateFocus(manager, 1);
    manager.lastNavTime = now;
  }

  if (GamepadInput.justPressed("a")) {
    activateFocused(manager);
  }

  if (GamepadInput.justPressed("b")) {
    handleMenuBack(manager);
  }
}

export function navigateFocus(manager, direction) {
  updateFocusableElements(manager);
  if (manager.focusableElements.length === 0) return;

  manager.focusIndex =
    (manager.focusIndex + direction + manager.focusableElements.length) %
    manager.focusableElements.length;
  updateFocus(manager);
  proceduralAudio.uiNavigate();
}

export function updateFocusableElements(manager) {
  manager.focusableElements = Array.from(
    manager.menuContent.querySelectorAll(FOCUS_SELECTOR),
  ).filter((el) => !el.disabled && el.offsetParent !== null);
}

export function updateFocus(manager) {
  manager.focusableElements.forEach((el, i) => {
    el.classList.toggle("nav-focus", i === manager.focusIndex);
  });

  if (manager.focusableElements[manager.focusIndex]) {
    manager.focusableElements[manager.focusIndex].scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }
}

export function activateFocused(manager) {
  updateFocusableElements(manager);
  const el = manager.focusableElements[manager.focusIndex];
  if (el) {
    proceduralAudio.uiClick();
    el.click();
    if (el.type === "checkbox") {
      el.checked = !el.checked;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}

export function handleMenuBack(manager) {
  switch (manager.currentScreen) {
    case SCREENS.CREATE_GAME:
    case SCREENS.JOIN_GAME:
    case SCREENS.CAMPAIGN_MISSIONS:
    case SCREENS.OPTIONS:
      manager.showScreen(SCREENS.MAIN_MENU);
      break;
    case SCREENS.LOBBY:
      NetworkManager.leaveRoom();
      break;
  }
}

export function resetFocus(manager) {
  manager.focusIndex = 0;
  updateFocusableElements(manager);
  updateFocus(manager);
}
