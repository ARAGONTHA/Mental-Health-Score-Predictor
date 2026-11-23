(() => {
  "use strict";

  const API_BASE = "https://mental-health-score-predictor-fxqf.onrender.com";

  // Render free-tier services can take about a minute to wake up.
  const REQUEST_TIMEOUT_MS = 75000;
  const SLOW_NOTICE_MS = 6000;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const $ = (id) => document.getElementById(id);
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------
  // Elements
  // ---------------------------------------------------------
  const form = $("predict-form");
  const submitBtn = $("submit-btn");
  const submitLabel = submitBtn.querySelector(".btn-label");
  const resetBtn = $("reset-btn");
  const errorRetryBtn = $("error-retry-btn");
  const resultCard = $("result-card");
  const srStatus = $("sr-status");

  const states = {
    idle: $("state-idle"),
    loading: $("state-loading"),
    result: $("state-result"),
    error: $("state-error"),
  };

  const loadingCopyEl = $("loading-copy");
  const scoreNumberEl = $("score-number");
  const scoreBandEl = $("score-band");
  const scoreContextEl = $("score-context");
  const gaugeFill = $("gauge-fill");
  const errorLabelEl = $("error-label");
  const errorCopyEl = $("error-copy");

  const segGroup = $("stress_level_group");
  const segButtons = Array.from(segGroup.querySelectorAll(".seg-btn"));
  const stressHiddenInput = $("stress_level");

  // ---------------------------------------------------------
  // Validation rules (mirror the FastAPI / Pydantic model)
  // ---------------------------------------------------------
  const ALLOWED = {
    gender: ["Male", "Female"],
    academic_level: ["High School", "Undergraduate", "Graduate"],
    most_used_platform: [
      "Facebook", "Instagram", "Snapchat", "Twitter", "YouTube", "TikTok",
      "LinkedIn", "LINE", "KakaoTalk", "VKontakte", "WhatsApp", "WeChat",
    ],
    purpose_of_use: ["Networking", "Education", "Entertainment", "News"],
    stress_level: ["Low", "Medium", "High", "Very High"],
  };

  const NUMERIC_RULES = {
    age: { min: 10, max: 100, integer: true },
    avg_daily_usage_hours: { min: 0, max: 24, integer: false },
    daily_unlocks: { min: 0, max: Infinity, integer: true },
    study_hours: { min: 0, max: 24, integer: false },
    physical_activity_hours: { min: 0, max: 24, integer: false },
    sleep_hours_per_night: { min: 0, max: 24, integer: false },
  };

  // DOM order, so the first error is the first one focused
  const FIELD_ORDER = [
    "age", "gender", "country",
    "academic_level", "most_used_platform", "purpose_of_use",
    "avg_daily_usage_hours", "daily_unlocks",
    "study_hours", "physical_activity_hours", "sleep_hours_per_night",
    "stress_level",
  ];

  const MAX_COUNTRY_LENGTH = 80;

  // ---------------------------------------------------------
  // Announcements for assistive tech
  // ---------------------------------------------------------
  function announce(message) {
    // Clear first so repeating the same message is still announced.
    srStatus.textContent = "";
    window.setTimeout(() => { srStatus.textContent = message; }, 50);
  }

  // ---------------------------------------------------------
  // Gauge ticks (0..10, every 2 units), drawn on both gauges
  // ---------------------------------------------------------
  function drawTicks() {
    const cx = 120, cy = 140, rOuter = 100, rInner = 90;
    document.querySelectorAll(".gauge-ticks").forEach((g) => {
      while (g.firstChild) g.removeChild(g.firstChild);
      for (let i = 0; i <= 10; i += 2) {
        const angle = Math.PI - (i / 10) * Math.PI;
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", (cx + rOuter * Math.cos(angle)).toFixed(1));
        line.setAttribute("y1", (cy - rOuter * Math.sin(angle)).toFixed(1));
        line.setAttribute("x2", (cx + rInner * Math.cos(angle)).toFixed(1));
        line.setAttribute("y2", (cy - rInner * Math.sin(angle)).toFixed(1));
        g.appendChild(line);
      }
    });
  }

  // ---------------------------------------------------------
  // Field-level error helpers
  // ---------------------------------------------------------
  // For the stress control the "input" is the hidden field; ARIA state goes on the radiogroup.
  function ariaTarget(input) {
    return input === stressHiddenInput ? segGroup : input;
  }

  function setFieldError(input, message) {
    const wrap = input.closest(".field");
    if (!wrap) return;
    wrap.classList.add("field-error");
    ariaTarget(input).setAttribute("aria-invalid", "true");
    const msgEl = wrap.querySelector(".error-msg");
    if (msgEl) msgEl.textContent = message;
  }

  function clearFieldError(input) {
    const wrap = input.closest(".field");
    if (!wrap) return;
    wrap.classList.remove("field-error");
    ariaTarget(input).removeAttribute("aria-invalid");
    const msgEl = wrap.querySelector(".error-msg");
    if (msgEl) msgEl.textContent = "";
  }

  function clearAllErrors() {
    FIELD_ORDER.forEach((key) => clearFieldError($(key)));
  }

  function focusField(input) {
    const target = input === stressHiddenInput
      ? (segButtons.find((b) => b.tabIndex === 0) || segButtons[0])
      : input;
    if (target && typeof target.focus === "function") target.focus({ preventScroll: false });
  }

  // ---------------------------------------------------------
  // Stress segmented control (radiogroup with roving tabindex)
  // ---------------------------------------------------------
  function selectStress(btn, { focus = false } = {}) {
    segButtons.forEach((b) => {
      const on = b === btn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    stressHiddenInput.value = btn.dataset.value;
    clearFieldError(stressHiddenInput);
    if (focus) btn.focus();
  }

  function initStressControl() {
    segButtons.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });

    segButtons.forEach((btn) => {
      btn.addEventListener("click", () => selectStress(btn));
    });

    segGroup.addEventListener("keydown", (e) => {
      const idx = segButtons.indexOf(document.activeElement);
      if (idx === -1) return;
      let next = -1;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown": next = (idx + 1) % segButtons.length; break;
        case "ArrowLeft":
        case "ArrowUp": next = (idx - 1 + segButtons.length) % segButtons.length; break;
        case "Home": next = 0; break;
        case "End": next = segButtons.length - 1; break;
        default: return;
      }
      e.preventDefault();
      selectStress(segButtons[next], { focus: true });
    });
  }

  // ---------------------------------------------------------
  // Read + validate the form
  // Returns { payload, errors } where errors is [[key, message], ...]
  // ---------------------------------------------------------
  function readAndValidate() {
    const errors = [];
    const payload = {};

    // Numeric fields: sent as real numbers, never strings.
    Object.keys(NUMERIC_RULES).forEach((key) => {
      const rule = NUMERIC_RULES[key];
      const input = $(key);
      const raw = input.value.trim();

      if (raw === "") {
        errors.push([key, input.validity && input.validity.badInput ? "Enter a valid number." : "This field is required."]);
        return;
      }
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        errors.push([key, "Enter a valid number."]);
      } else if (rule.integer && !Number.isInteger(num)) {
        errors.push([key, "Use a whole number."]);
      } else if (num < rule.min || num > rule.max) {
        errors.push([key, rule.max === Infinity ? `Must be ${rule.min} or more.` : `Must be between ${rule.min} and ${rule.max}.`]);
      } else {
        payload[key] = num;
      }
    });

    // Fixed-choice fields: must be one of the backend's accepted values.
    ["gender", "academic_level", "most_used_platform", "purpose_of_use", "stress_level"].forEach((key) => {
      const value = $(key).value;
      if (!value) {
        errors.push([key, key === "stress_level" ? "Pick a stress level." : "Choose an option."]);
      } else if (!ALLOWED[key].includes(value)) {
        errors.push([key, "Choose one of the listed options."]);
      } else {
        payload[key] = value;
      }
    });

    // Country: free text (datalist is only a suggestion list).
    const country = $("country").value.trim().replace(/\s+/g, " ");
    if (!country) {
      errors.push(["country", "This field is required."]);
    } else if (country.length > MAX_COUNTRY_LENGTH) {
      errors.push(["country", `Keep this under ${MAX_COUNTRY_LENGTH} characters.`]);
    } else if (!/\p{L}/u.test(country)) {
      errors.push(["country", "Enter a country name."]);
    } else {
      payload.country = country;
    }

    errors.sort((a, b) => FIELD_ORDER.indexOf(a[0]) - FIELD_ORDER.indexOf(b[0]));

    // Build the payload in the exact key order the backend contract documents.
    const ordered = {};
    FIELD_ORDER.forEach((key) => { if (key in payload) ordered[key] = payload[key]; });
    return { payload: ordered, errors };
  }

  // ---------------------------------------------------------
  // UI state switching
  // ---------------------------------------------------------
  function showState(name) {
    const inner = $("result-inner");
    inner.dataset.state = name;
    Object.keys(states).forEach((key) => { states[key].hidden = key !== name; });
    inner.setAttribute("aria-busy", name === "loading" ? "true" : "false");
  }

  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    submitBtn.classList.toggle("loading", isSubmitting);
    submitBtn.setAttribute("aria-busy", isSubmitting ? "true" : "false");
    submitLabel.textContent = isSubmitting ? "Analyzing…" : "Read my signal";
  }

  // On single-column layouts the result sits above the form, so bring it into view.
  function revealResultCardIfStacked() {
    if (!window.matchMedia("(max-width: 1020px)").matches) return;
    resultCard.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function bandFor(score) {
    if (score < 4) {
      return {
        key: "strained",
        label: "Signal: strained",
        context: "Based on your answers, the model estimates elevated strain right now. This is only an estimate; small shifts in sleep or screen time may help.",
      };
    }
    if (score < 7) {
      return {
        key: "balanced",
        label: "Signal: balanced",
        context: "Your answers point to a fairly steady rhythm, with some room to recover and reset. This is a model estimate, not an assessment.",
      };
    }
    return {
      key: "strong",
      label: "Signal: strong",
      context: "Your answers point to a well-supported baseline. This is a model estimate and says nothing certain about how you feel.",
    };
  }

  // ---------------------------------------------------------
  // Result rendering + gauge animation
  // ---------------------------------------------------------
  let countUpFrame = 0;

  function animateNumber(target) {
    window.cancelAnimationFrame(countUpFrame);
    if (reducedMotion()) {
      scoreNumberEl.textContent = target.toFixed(2);
      return;
    }
    const duration = 900;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      scoreNumberEl.textContent = (target * eased).toFixed(2);
      if (t < 1) countUpFrame = window.requestAnimationFrame(tick);
    };
    countUpFrame = window.requestAnimationFrame(tick);
  }

  function renderResult(rawScore) {
    // Always keep the displayed number and the gauge within the documented 0–10 range.
    const score = Math.max(0, Math.min(10, rawScore));
    if (score !== rawScore) console.warn("[SIGNAL] Score outside 0–10 was clamped:", rawScore);

    const band = bandFor(score);
    states.result.dataset.band = band.key;
    scoreBandEl.textContent = band.label;
    scoreContextEl.textContent = band.context;

    // Show the state BEFORE measuring: getTotalLength() needs the path to be rendered.
    showState("result");

    const length = gaugeFill.getTotalLength();
    gaugeFill.style.strokeDasharray = `${length} ${length}`;
    gaugeFill.style.transition = "none";
    gaugeFill.style.strokeDashoffset = String(length);
    gaugeFill.style.opacity = score <= 0 ? "0" : "1"; // a 0-length round cap would draw a dot
    void gaugeFill.getBoundingClientRect(); // commit the start position
    gaugeFill.style.transition = "";
    gaugeFill.style.strokeDashoffset = String(length * (1 - score / 10));

    animateNumber(score);
    announce(`Predicted score ${score.toFixed(2)} out of 10. ${band.label}. ${band.context}`);
    revealResultCardIfStacked();
  }

  let retryHandler = null; // what the "Try again" button does for the current error

  function renderError(label, copy, { retry = false } = {}) {
    errorLabelEl.textContent = label;
    errorCopyEl.textContent = copy;
    retryHandler = retry ? () => submitPayload(lastPayload) : null;
    showState("error");
    announce(`${label}. ${copy}`);
    revealResultCardIfStacked();
  }

  // ---------------------------------------------------------
  // Parse FastAPI / Pydantic 422 responses into field messages
  // ---------------------------------------------------------
  function applyServerValidationErrors(detail) {
    if (!Array.isArray(detail)) return false;
    let matched = false;
    detail.forEach((err) => {
      const field = Array.isArray(err.loc) ? err.loc[err.loc.length - 1] : null;
      const target = field && FIELD_ORDER.includes(field) ? $(field) : null;
      if (target) {
        setFieldError(target, typeof err.msg === "string" ? err.msg : "Invalid value.");
        matched = true;
      }
    });
    return matched;
  }

  // ---------------------------------------------------------
  // API request
  // ---------------------------------------------------------
  let inFlight = false;
  let lastPayload = null;

  async function submitPayload(payload) {
    if (inFlight || !payload) return; // block duplicate submissions
    inFlight = true;
    lastPayload = payload;

    setSubmitting(true);
    showState("loading");
    loadingCopyEl.textContent = "Running your habits through the model.";
    announce("Analyzing your answers.");
    revealResultCardIfStacked();

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    const slowId = window.setTimeout(() => {
      loadingCopyEl.textContent = "The server is waking up. The first request can take up to a minute.";
    }, SLOW_NOTICE_MS);

    try {
      let res;
      try {
        res = await fetch(`${API_BASE}/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err) {
        console.error("[SIGNAL] Request failed before a response arrived:", err);
        if (timedOut) {
          renderError("Taking too long", "The prediction service didn't respond in time. It may be starting up. Please try again in a moment.", { retry: true });
        } else {
          renderError("Can't reach the service", "Check your internet connection and try again. If it keeps happening, the service may be temporarily unavailable.", { retry: true });
        }
        return;
      }

      const bodyText = await res.text().catch((err) => {
        console.error("[SIGNAL] Could not read response body:", err);
        return "";
      });
      let body = null;
      try { body = bodyText ? JSON.parse(bodyText) : null; } catch (_) { body = null; }

      if (res.status === 422) {
        console.error("[SIGNAL] 422 validation error from API:", body || bodyText);
        const matched = body && applyServerValidationErrors(body.detail);
        renderError(
          "Check your inputs",
          matched
            ? "The service rejected a few answers. They're marked in the form."
            : "The service rejected this submission. Please review your answers and try again."
        );
        if (matched) {
          const first = FIELD_ORDER.find((k) => $(k).closest(".field").classList.contains("field-error"));
          if (first) focusField($(first));
        }
        return;
      }

      if (!res.ok) {
        console.error(`[SIGNAL] HTTP ${res.status} from API:`, body || bodyText.slice(0, 500));
        if (res.status >= 500) {
          const waking = [502, 503, 504].includes(res.status);
          renderError(
            waking ? "Service is starting up" : "Something went wrong",
            waking
              ? "The prediction service isn't ready yet. Wait a few seconds and try again."
              : "The prediction service hit an error. Please try again in a moment.",
            { retry: true }
          );
        } else {
          renderError("Prediction failed", "The service couldn't process this request. Please try again.", { retry: true });
        }
        return;
      }

      if (body === null || typeof body !== "object") {
        console.error("[SIGNAL] Response was not valid JSON:", bodyText.slice(0, 500));
        renderError("Unexpected response", "The service replied in a format we couldn't read. Please try again.", { retry: true });
        return;
      }

      const score = body.predicted_mental_health_score;
      if (typeof score !== "number" || !Number.isFinite(score)) {
        console.error("[SIGNAL] Missing or non-numeric predicted_mental_health_score:", body);
        renderError("Unexpected response", "The service replied, but the score was missing or invalid. Please try again.", { retry: true });
        return;
      }

      renderResult(score);
    } catch (err) {
      // Anything unexpected in our own code lands here, not in a misleading "server down" message.
      console.error("[SIGNAL] Unexpected error while handling the prediction:", err);
      renderError("Something went wrong", "An unexpected error occurred in the page. Please reload and try again.");
    } finally {
      window.clearTimeout(timeoutId);
      window.clearTimeout(slowId);
      inFlight = false;
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------
  // Event wiring (each listener is attached exactly once)
  // ---------------------------------------------------------
  function onSubmit(e) {
    e.preventDefault();
    if (inFlight) return;
    clearAllErrors();

    const { payload, errors } = readAndValidate();
    if (errors.length > 0) {
      errors.forEach(([key, msg]) => setFieldError($(key), msg));
      announce(`${errors.length} ${errors.length === 1 ? "field needs" : "fields need"} attention. ${errors[0][1]}`);
      focusField($(errors[0][0]));
      return;
    }
    submitPayload(payload);
  }

  function onFieldEdit(e) {
    clearFieldError(e.target);
  }

  function goToIdle() {
    retryHandler = null;
    showState("idle");
    announce("Ready for a new assessment.");
  }

  function init() {
    drawTicks();
    initStressControl();

    form.addEventListener("submit", onSubmit);
    form.addEventListener("input", onFieldEdit);
    form.addEventListener("change", onFieldEdit);

    resetBtn.addEventListener("click", () => {
      goToIdle();
      const first = $("age");
      first.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
      first.focus({ preventScroll: true });
    });

    errorRetryBtn.addEventListener("click", () => {
      if (retryHandler) {
        retryHandler();
      } else {
        goToIdle();
        const firstBad = FIELD_ORDER.find((k) => $(k).closest(".field").classList.contains("field-error"));
        if (firstBad) focusField($(firstBad));
      }
    });
  }

  init();
})();
