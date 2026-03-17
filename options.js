const apiKeyInput     = document.getElementById("api-key");
const langSelect      = document.getElementById("lang");
const styleSelect     = document.getElementById("summary-style");
const btnSave         = document.getElementById("btn-save");
const btnClearData    = document.getElementById("btn-clear-data");
const toast           = document.getElementById("toast");

// Load saved settings
chrome.storage.sync.get(["apiKey", "lang", "summaryStyle"], (data) => {
  if (data.apiKey) apiKeyInput.value = data.apiKey;
  if (data.lang) langSelect.value = data.lang;
  if (data.summaryStyle) styleSelect.value = data.summaryStyle;
});

btnSave.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showToast("API key cannot be empty.", true);
    return;
  }

  if (!apiKey.startsWith("sk-")) {
    showToast("Invalid OpenAI API key.", true);
    return;
  }

  chrome.storage.sync.set({
    apiKey,
    lang: langSelect.value,
    summaryStyle: styleSelect.value,
  }, () => {
    showToast("Settings saved.");
  });
});

btnClearData.addEventListener("click", () => {
  if (!confirm("Clear all stored data?")) return;

  chrome.storage.sync.clear();
  chrome.storage.local.clear();
  apiKeyInput.value = "";

  showToast("All data cleared.");
});

function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.className = "toast" + (isError ? " error" : "");
  toast.style.display = "block";
  setTimeout(() => (toast.style.display = "none"), 3000);
}