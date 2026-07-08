/**
 * feedbackModal.js - FEEDBACK SUBMISSION MODAL
 * =============================================================================
 *
 * ROLE: Modal form for submitting feedback: name, email, ratings (gameplay,
 * performance, graphics, overall), comment. Submits to feedback API; getSystemInfo
 * and getFeedbackApiBase from feedbackApiBase. Used from menu or results.
 *
 * RELATED: feedbackApiBase.js, NetworkManager.js, systemInfo.js.
 *
 * =============================================================================
 */

import NetworkManager from "../../network/NetworkManager.js";
import { getSystemInfo } from "../../utils/systemInfo.js";
import { getFeedbackApiBase } from "../feedbackApiBase.js";

const ratingLabels = [
  { id: "gameplay", label: "Gameplay" },
  { id: "performance", label: "Performance" },
  { id: "graphics", label: "Graphics" },
  { id: "overall", label: "Overall" },
];

export function showFeedbackModal(manager, options = {}) {
  const { onClose = () => {} } = options;
  if (!manager.feedbackModalEl) {
    manager.feedbackModalEl = document.createElement("div");
    manager.feedbackModalEl.id = "feedback-modal";
    manager.feedbackModalEl.className = "feedback-modal";
    document.body.appendChild(manager.feedbackModalEl);
  }

  manager.feedbackModalEl.innerHTML = `
    <div class="feedback-modal-overlay"></div>
    <div class="feedback-modal-content">
      <div class="feedback-modal-header">
        <button type="button" class="feedback-modal-close" id="feedback-close" aria-label="Back">←</button>
        <h3>FEEDBACK</h3>
      </div>
      <form id="feedback-form" class="feedback-form">
        <div class="form-row feedback-form-row">
          <div class="form-group">
            <label>NAME</label>
            <input type="text" id="feedback-name" maxlength="64" />
          </div>
          <div class="form-group">
            <label>CONTACT EMAIL</label>
            <input type="email" id="feedback-email" maxlength="128" />
          </div>
        </div>
        <div class="form-group feedback-type-group">
          <label>TYPE</label>
          <div class="feedback-type-radios" id="feedback-type-radios">
            <label class="feedback-type-btn">
              <input type="radio" name="feedback-type" value="feedback" checked />
              <span class="feedback-type-dot"></span>
              <span class="feedback-type-label">Feedback</span>
            </label>
            <label class="feedback-type-btn">
              <input type="radio" name="feedback-type" value="bug" />
              <span class="feedback-type-dot"></span>
              <span class="feedback-type-label">Bug Report</span>
            </label>
          </div>
        </div>
        <div class="form-group">
          <label>MESSAGE</label>
          <textarea id="feedback-message" rows="4" maxlength="2000"></textarea>
        </div>
        <div class="feedback-ratings" id="feedback-ratings-container">
          ${ratingLabels
            .map(
              (r) => `
            <div class="form-group feedback-rating-row" data-rating="${r.id}">
              <label>${r.label}</label>
              <div class="feedback-stars" data-rating-id="${r.id}" role="group" aria-label="${r.label} rating">
                <input type="hidden" id="feedback-rating-${r.id}" value="" />
                ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="feedback-star" data-value="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
        <p class="feedback-disclaimer">When you submit this form, we automatically collect technical information from your browser (OS, device memory, GPU) to help diagnose issues and improve the experience for as many users as possible.</p>
        <div id="feedback-error" class="feedback-error" style="display:none;"></div>
        <div class="feedback-modal-buttons">
          <button type="button" class="menu-btn secondary" id="feedback-cancel">CANCEL</button>
          <button type="submit" class="menu-btn" id="feedback-submit">SUBMIT</button>
        </div>
      </form>
    </div>
  `;

  manager.feedbackModalEl.style.display = "flex";

  const getFeedbackType = () =>
    document.querySelector('input[name="feedback-type"]:checked')?.value ||
    "feedback";
  const updateRatingVisibility = () => {
    const type = getFeedbackType();
    const container = document.getElementById("feedback-ratings-container");
    if (container) container.style.display = type === "bug" ? "none" : "";
  };
  updateRatingVisibility();
  document
    .getElementById("feedback-type-radios")
    .addEventListener("change", updateRatingVisibility);

  manager.feedbackModalEl.querySelectorAll(".feedback-stars").forEach((container) => {
    const id = container.dataset.ratingId;
    const input = document.getElementById(`feedback-rating-${id}`);
    const stars = container.querySelectorAll(".feedback-star");
    const updateStars = (value) => {
      const n = value === "" ? 0 : parseInt(value, 10);
      stars.forEach((star, i) => star.classList.toggle("filled", i < n));
    };
    stars.forEach((star) => {
      star.addEventListener("click", () => {
        const value = star.dataset.value;
        input.value = value;
        updateStars(value);
      });
    });
  });

  const close = () => {
    manager.feedbackModalEl.style.display = "none";
    document.removeEventListener("keydown", handleEscape, true);
    onClose();
  };

  const handleEscape = (e) => {
    if (e.code === "Escape") {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", handleEscape, true);

  manager.feedbackModalEl
    .querySelector(".feedback-modal-overlay")
    .addEventListener("click", close);
  manager.feedbackModalEl
    .querySelector("#feedback-cancel")
    .addEventListener("click", close);
  manager.feedbackModalEl
    .querySelector("#feedback-close")
    .addEventListener("click", close);

  manager.feedbackModalEl
    .querySelector("#feedback-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("feedback-name").value.trim();
      const email = document.getElementById("feedback-email").value.trim();
      const message = document
        .getElementById("feedback-message")
        .value.trim();
      const type = getFeedbackType();
      const ratingEl = (id) =>
        document.getElementById(`feedback-rating-${id}`).value;
      const ratings = {
        gameplay:
          ratingEl("gameplay") === ""
            ? null
            : parseInt(ratingEl("gameplay"), 10),
        performance:
          ratingEl("performance") === ""
            ? null
            : parseInt(ratingEl("performance"), 10),
        graphics:
          ratingEl("graphics") === ""
            ? null
            : parseInt(ratingEl("graphics"), 10),
        overall:
          ratingEl("overall") === ""
            ? null
            : parseInt(ratingEl("overall"), 10),
      };

      const errEl = document.getElementById("feedback-error");
      if (!message) {
        errEl.textContent = "Please enter a message.";
        errEl.style.display = "block";
        return;
      }

      errEl.style.display = "none";
      document.getElementById("feedback-submit").disabled = true;

      const base = getFeedbackApiBase();
      const payload = {
        name,
        email,
        message,
        type,
        ratings,
        systemInfo: getSystemInfo(),
      };

      try {
        const res = await fetch(`${base}/api/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(res.statusText || "Submit failed");
        manager.feedbackModalEl.innerHTML = `
          <div class="feedback-modal-overlay"></div>
          <div class="feedback-modal-content feedback-confirmation">
            <p class="feedback-confirmation-message">Thank you for your feedback!</p>
            <button type="button" class="menu-btn" id="feedback-confirm-close">OK</button>
          </div>
        `;
        manager.feedbackModalEl.querySelector(".feedback-modal-overlay").addEventListener("click", close);
        manager.feedbackModalEl.querySelector("#feedback-confirm-close").addEventListener("click", close);
      } catch (err) {
        const isNetwork =
          err?.message === "Failed to fetch" || err?.name === "TypeError";
        errEl.textContent = isNetwork
          ? "Server unreachable. Start the game server (e.g. cd server && npm start)."
          : err.message || "Failed to submit. Try again.";
        errEl.style.display = "block";
      } finally {
        const btn = document.getElementById("feedback-submit");
        if (btn) btn.disabled = false;
      }
    });
}
