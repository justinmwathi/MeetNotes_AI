// popup.js

const statusDot      = document.getElementById("status-dot");
const statusText     = document.getElementById("status-text");
const transcriptCount = document.getElementById("transcript-count");
const btnOpenPanel   = document.getElementById("btn-open-panel");
const btnSummarise   = document.getElementById("btn-summarise");

async function init() {
  const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (res?.state) {
    const { active, transcriptCount: count } = res.state;
    updateUI(active, count || 0);
  }
}

function updateUI(active, count) {
  statusDot.className = "dot" + (active ? " active" : "");
  statusText.textContent = active ? "Recording meeting..." : "No active meeting";
  transcriptCount.textContent = count;
  btnSummarise.disabled = count === 0;
}

btnOpenPanel.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
});

btnSummarise.addEventListener("click", async () => {
  btnSummarise.textContent = "Summarising...";
  btnSummarise.disabled = true;
  await chrome.runtime.sendMessage({ type: "SUMMARISE_NOW" });
  // Result will appear in the side panel
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "MEETING_STARTED") updateUI(true, 0);
  if (message.type === "MEETING_ENDED") updateUI(false, 0);
  if (message.type === "TRANSCRIPT_UPDATE") {
    updateUI(true, message.transcript?.length || 0);
  }
});

init();