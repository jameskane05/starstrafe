import proceduralAudio from "../audio/ProceduralAudio.js";

const OVERLAY_ID = "saturnalia-outro-overlay";

const LINE1 =
  "The rogue swarm has already engaged Earth's fleet in orbit.";
const LINE2 =
  "Starspeed, Leader and Alcair must head straight for the embattled capital ship to confront the threat.";

const MS_PER_CHAR = 30;
const PAUSE_BEFORE_LINE2_MS = 500;
const PAUSE_AFTER_TYPE_MS = 2000;
const FADE_DURATION_MS = 2000;
const PANEL_FADE_IN_MS = 1500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldBeepForChar(ch) {
  return /[a-z0-9]/i.test(ch);
}

export function mountSaturnaliaOutroOverlayBlack() {
  let el = document.getElementById(OVERLAY_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = OVERLAY_ID;
    el.className = "charon-opening-overlay";
    el.setAttribute("role", "presentation");
    el.innerHTML = `
      <div class="charon-opening-panel">
        <p class="charon-opening-line" data-line="1"></p>
        <p class="charon-opening-line" data-line="2"></p>
      </div>
    `;
    document.body.appendChild(el);
  }
  el.classList.remove("charon-opening-overlay--fade-out");
  el.style.removeProperty("opacity");
  el.style.pointerEvents = "auto";
  const panel = el.querySelector(".charon-opening-panel");
  if (panel) {
    panel.style.transition = "none";
    panel.style.opacity = "0";
  }
  const a = el.querySelector('[data-line="1"]');
  const b = el.querySelector('[data-line="2"]');
  if (a) a.textContent = "";
  if (b) b.textContent = "";
}

async function typeLine(element, fullText, onChar) {
  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i];
    element.textContent += ch;
    if (shouldBeepForChar(ch)) onChar();
    await sleep(MS_PER_CHAR);
  }
}

export async function runSaturnaliaOutroTypewriterAndFade(options = {}) {
  const retainBlackScreen = options.retainBlackScreen === true;
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  proceduralAudio.unlockFromUserGesture?.();

  const line1 = overlay.querySelector('[data-line="1"]');
  const line2 = overlay.querySelector('[data-line="2"]');
  if (!line1 || !line2) {
    overlay.remove();
    return;
  }

  const beep = () => {
    proceduralAudio.uiTypewriterBeep?.();
  };

  const panel = overlay.querySelector(".charon-opening-panel");
  if (panel) {
    void panel.offsetWidth;
    panel.style.transition = `opacity ${PANEL_FADE_IN_MS}ms ease-out`;
    panel.style.opacity = "1";
  }

  await typeLine(line1, LINE1, beep);
  await sleep(PAUSE_BEFORE_LINE2_MS);
  await typeLine(line2, LINE2, beep);
  await sleep(PAUSE_AFTER_TYPE_MS);

  if (retainBlackScreen) {
    if (panel) {
      panel.style.transition = "";
      panel.style.opacity = "0";
    }
    line1.textContent = "";
    line2.textContent = "";
    return;
  }

  if (panel) {
    panel.style.transition = "";
    panel.style.opacity = "";
  }

  overlay.style.removeProperty("opacity");
  overlay.classList.remove("charon-opening-overlay--fade-out");
  void overlay.offsetWidth;

  await new Promise((r) => {
    requestAnimationFrame(() => requestAnimationFrame(r));
  });
  overlay.classList.add("charon-opening-overlay--fade-out");

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      overlay.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const fallback = setTimeout(finish, FADE_DURATION_MS + 250);
    const onEnd = (e) => {
      if (e.target !== overlay || e.propertyName !== "opacity") return;
      finish();
    };
    overlay.addEventListener("transitionend", onEnd);
  });

  overlay.remove();
}
