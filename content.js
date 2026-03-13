// content.js
// Injected into: Google Meet, BigBlueButton (UoEld), Zoom (web client)
// Responsibilities:
//   1. Detect the current platform
//   2. Detect when a meeting starts / ends
//   3. Run Web Speech API transcription
//   4. Forward transcript chunks to background.js

(function () {
  "use strict";

  let inMeeting   = false;
  let recognition = null;
  let platform    = null;

  //Platform Detection 
  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes("meet.google.com"))           return "google";
    if (host.includes("webconference.uoeld.ac.ke")) return "bbb";
    return null;
  }

  // Each platform has different DOM signals for an active meeting.
  // Returns true if user is currently inside a live call.
  function isInActiveMeeting(p) {
    switch (p) {

      case "google":
        // Google Meet shows a Leave button with these selectors
        return !!(
          document.querySelector('[data-tooltip*="Leave"]')     ||
          document.querySelector('button[aria-label*="Leave"]') ||
          document.querySelector('[jsname="CQylAd"]')
        );

     

      case "bbb":
        return !!(
          document.querySelector('button[aria-label*="Leave meeting"]') ||
          document.querySelector('#leaveSessionButton')                 ||
          document.querySelector('[data-test="leaveSessionButton"]')    ||
          document.querySelector('.leave-button')
        );

      default:
        return false;
    }
  }

  // ─── Meeting Lifecycle ─────────────────
  function checkMeetingStatus() {
    if (!platform) return;

    const nowInMeeting = isInActiveMeeting(platform);

    if (nowInMeeting && !inMeeting) {
      inMeeting = true;
      onMeetingStart();
    } else if (!nowInMeeting && inMeeting) {
      inMeeting = false;
      onMeetingEnd();
    }
  }

  function onMeetingStart() {
    console.log(`[MeetNotes] Meeting started — platform: ${platform}`);
    chrome.runtime.sendMessage({ type: "MEETING_STARTED", platform });
    startTranscription();
  }

  function onMeetingEnd() {
    console.log(`[MeetNotes] Meeting ended — platform: ${platform}`);
    stopTranscription();
    chrome.runtime.sendMessage({ type: "MEETING_ENDED", platform });
  }

  // ─── Polling + DOM Observation ────────────────────────────────────────────────
  // Poll every 3 seconds as a safety net — MutationObserver alone can miss
  // state changes driven by React / Angular re-renders.
  setInterval(checkMeetingStatus, 3000);

  const observer = new MutationObserver(() => checkMeetingStatus());
  observer.observe(document.body, { childList: true, subtree: true });

  // ─── Language Setting ─────────────────────────────────────────────────────────
  async function getLang() {
    return new Promise((resolve) => {
      chrome.storage.sync.get("lang", ({ lang }) => {
        resolve(lang || "en-US");
      });
    });
  }

  // ─── Web Speech API Transcription ─────────────────────────────────────────────
  async function startTranscription() {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      console.warn("[MeetNotes] Web Speech API not available in this browser");
      chrome.runtime.sendMessage({
        type: "CAPTURE_ERROR",
        error: "Web Speech API is not supported in this browser. Use Chrome.",
      });
      return;
    }

    const lang = await getLang();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();

    recognition.continuous      = true;   // keep listening through silences
    recognition.interimResults  = true;   // stream partial results to the UI
    recognition.lang            = lang;   // pulled from options page setting
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log(`[MeetNotes] Transcription started (lang: ${lang}, platform: ${platform})`);
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result  = event.results[i];
        const text    = result[0].transcript;
        const isFinal = result.isFinal;

        chrome.runtime.sendMessage({
          type: "TRANSCRIPT_CHUNK",
          text,
          isFinal,
          platform,
          timestamp: Date.now(),
        });
      }
    };

    recognition.onerror = (event) => {
      console.error("[MeetNotes] Speech recognition error:", event.error);

      // Non-fatal — restart automatically after a short delay
      if (event.error === "no-speech" || event.error === "network") {
        setTimeout(() => {
          if (inMeeting && recognition) {
            try { recognition.start(); } catch (_) {}
          }
        }, 2000);
      }

      // Microphone permission was denied by the user
      if (event.error === "not-allowed") {
        chrome.runtime.sendMessage({
          type: "CAPTURE_ERROR",
          error: "Microphone access was denied. Allow mic access in Chrome site settings.",
        });
      }
    };

    recognition.onend = () => {
      // Auto-restart if still in a meeting.
      // Recognition stops on its own after long silences — this keeps it alive.
      if (inMeeting) {
        setTimeout(() => {
          if (inMeeting && recognition) {
            try { recognition.start(); } catch (_) {}
          }
        }, 500);
      }
    };

    try {
      recognition.start();
    } catch (err) {
      console.error("[MeetNotes] Could not start recognition:", err);
    }
  }

  function stopTranscription() {
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
      recognition = null;
      console.log("[MeetNotes] Transcription stopped");
    }
  }

  //Message Listener (from popup / sidepanel)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "FORCE_STOP")               stopTranscription();
    if (message.type === "FORCE_START" && inMeeting) startTranscription();
  });


  platform = detectPlatform();

  if (platform) {
    console.log(`[MeetNotes] Content script active — platform: ${platform} — ${window.location.href}`);
    // Run an immediate check in case the page loaded while already in a meeting
    checkMeetingStatus();
  } else {
    console.log("[MeetNotes] Platform not recognised — script idle");
  }

})();