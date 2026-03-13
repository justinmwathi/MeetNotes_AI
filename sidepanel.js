// sidepanel.js

// ─── State ────────────────────────────────────────────────────────────────────
let transcript = [];
let summary = null;
let meetingActive = false;
let timerInterval = null;
let startTime = null;

// ─── Elements ─────────────────────────────────────────────────────────────────
const statusDot     = document.getElementById("status-dot");
const statusText    = document.getElementById("status-text");
const timerEl       = document.getElementById("timer");
const transcriptList  = document.getElementById("transcript-list");
const transcriptEmpty = document.getElementById("transcript-empty");
const summaryContent  = document.getElementById("summary-content");
const summaryEmpty    = document.getElementById("summary-empty");
const summaryError    = document.getElementById("summary-error");
const btnSummarise    = document.getElementById("btn-summarise");
const btnCopy         = document.getElementById("btn-copy");
const btnClear        = document.getElementById("btn-clear");

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Check API key
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  if (!apiKey) {
    showBanner("No API key set. <a class='settings-link' href='options.html' target='_blank'>Add it in Settings →</a>", "warn");
  }

  // Load persisted state from background
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
    if (res?.state) {
      applyState(res.state);
    }
  });

  // Load last meeting if available
  chrome.storage.local.get("lastMeeting", ({ lastMeeting }) => {
    if (lastMeeting?.summary && !meetingActive) {
      renderSummary(lastMeeting.summary);
    }
    if (lastMeeting?.transcript?.length) {
      transcript = lastMeeting.transcript;
      renderTranscript();
    }
  });
}

function applyState(state) {
  meetingActive = state.active;
  transcript = state.transcript || [];
  startTime = state.startTime;

  updateStatusUI();
  renderTranscript();

  if (state.active && startTime) startTimer(startTime);
}

// ─── Message Listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "MEETING_STARTED":
      meetingActive = true;
      startTime = Date.now();
      transcript = [];
      updateStatusUI();
      startTimer(startTime);
      renderTranscript();
      break;

    case "MEETING_ENDED":
      meetingActive = false;
      updateStatusUI();
      stopTimer();
      btnSummarise.disabled = transcript.length === 0;
      break;

    case "TRANSCRIPT_UPDATE":
      transcript = message.transcript;
      renderTranscript();
      btnSummarise.disabled = false;
      break;

    case "SUMMARY_READY":
      renderSummary(message.summary);
      switchTab("summary");
      break;

    case "NOTES_CLEARED":
      transcript = [];
      summary = null;
      renderTranscript();
      clearSummary();
      break;

    case "CAPTURE_ERROR":
      showBanner(`Audio capture failed: ${message.error}`, "error");
      break;
  }
});

// ─── UI Rendering ─────────────────────────────────────────────────────────────
function updateStatusUI() {
  if (meetingActive) {
    statusDot.className = "dot recording";
    statusText.textContent = "Recording meeting...";
    btnSummarise.disabled = transcript.length === 0;
  } else {
    statusDot.className = "dot";
    statusText.textContent = "No active meeting";
    timerEl.textContent = "";
  }
}

function renderTranscript() {
  const hasLines = transcript.length > 0;
  transcriptEmpty.style.display = hasLines ? "none" : "flex";
  transcriptList.style.display = hasLines ? "flex" : "none";

  transcriptList.innerHTML = "";
  transcript.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "transcript-line";
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    div.innerHTML = `<span class="ts">${time}</span>${escapeHtml(entry.text)}`;
    transcriptList.appendChild(div);
  });

  // Auto-scroll to bottom
  transcriptList.scrollTop = transcriptList.scrollHeight;
}

function renderSummary(text) {
  summary = text;
  summaryEmpty.style.display = "none";
  summaryError.style.display = "none";
  summaryContent.style.display = "block";
  summaryContent.innerHTML = formatMarkdown(text);
  btnCopy.style.display = "inline-flex";
  btnSummarise.textContent = "Re-summarise";
}

function clearSummary() {
  summaryContent.style.display = "none";
  summaryEmpty.style.display = "flex";
  summaryError.style.display = "none";
  btnCopy.style.display = "none";
  summary = null;
}

function showBanner(html, type = "warn") {
  const existing = document.querySelector(".banner");
  if (existing) existing.remove();

  const div = document.createElement("div");
  div.className = `banner banner-${type}`;
  div.innerHTML = html;

  document.querySelector("main").prepend(div);
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
}

// ─── Button Actions ───────────────────────────────────────────────────────────
btnSummarise.addEventListener("click", async () => {
  btnSummarise.disabled = true;
  btnSummarise.innerHTML = `<div class="spinner"></div> Summarising...`;

  const res = await chrome.runtime.sendMessage({ type: "SUMMARISE_NOW" });

  btnSummarise.disabled = false;
  btnSummarise.textContent = "Re-summarise";

  if (res?.summary?.error) {
    summaryError.style.display = "block";
    summaryError.innerHTML = `<div class="banner banner-error">${escapeHtml(res.summary.error)}</div>`;
    summaryEmpty.style.display = "none";
    switchTab("summary");
  }
});

btnCopy.addEventListener("click", () => {
  if (!summary) return;
  navigator.clipboard.writeText(summary).then(() => {
    btnCopy.textContent = "Copied!";
    setTimeout(() => (btnCopy.textContent = "Copy Notes"), 2000);
  });
});

btnClear.addEventListener("click", () => {
  if (!confirm("Clear all transcript and notes?")) return;
  chrome.runtime.sendMessage({ type: "CLEAR_NOTES" });
});

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer(from) {
  stopTimer();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - from) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatMarkdown(text) {
  // Basic markdown: bold, line breaks, bullet points
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/^## (.*)/gm, "<strong style='font-size:13px;color:var(--text)'>$1</strong>")
    .replace(/^- (.*)/gm, "• $1")
    .replace(/\n/g, "<br>");
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();