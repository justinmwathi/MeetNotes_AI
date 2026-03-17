// background.js — Service Worker
// Handles: tab audio capture, transcript accumulation, AI summarisation

// ─── State ────────────────────────────────────────────────────────────────────
let meetingState = {
  active: false,
  tabId: null,
  startTime: null,
  transcript: [],        // Array of { speaker, text, timestamp }
  mediaRecorder: null,
  stream: null,
};

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "MEETING_STARTED":
      handleMeetingStarted(sender.tab);
      sendResponse({ ok: true });
      break;

    case "MEETING_ENDED":
      handleMeetingEnded();
      sendResponse({ ok: true });
      break;

    case "START_RECORDING":
      startCapture(message.tabId).then(() => sendResponse({ ok: true }));
      return true; // keep channel open for async

    case "STOP_RECORDING":
      stopCapture();
      sendResponse({ ok: true });
      break;

    case "GET_STATE":
      sendResponse({ state: getSafeState() });
      break;

    case "TRANSCRIPT_CHUNK":
      // Forwarded from content script (Web Speech API results)
      appendTranscript(message.text, message.isFinal);
      sendResponse({ ok: true });
      break;

    case "SUMMARISE_NOW":
      summariseMeeting().then((summary) => sendResponse({ summary }));
      return true;

    case "CLEAR_NOTES":
      clearNotes();
      sendResponse({ ok: true });
      break;
  }
});

// ─── Meeting Lifecycle ────────────────────────────────────────────────────────
function handleMeetingStarted(tab) {
  if (meetingState.active) return;

  meetingState = {
    ...meetingState,
    active: true,
    tabId: tab.id,
    startTime: Date.now(),
    transcript: [],
  };

  saveMeetingState();

  // Open the side panel automatically
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
    // Side panel may already be open or not supported
  });

  chrome.notifications.create("meeting-started", {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "MeetNotes AI",
    message: "Meeting detected. Recording started.",
  });

  console.log("[MeetNotes] Meeting started on tab", tab.id);
}

function handleMeetingEnded() {
  if (!meetingState.active) return;

  stopCapture();
  meetingState.active = false;

  saveMeetingState();
  broadcastToUI({ type: "MEETING_ENDED" });

  console.log("[MeetNotes] Meeting ended. Transcript lines:", meetingState.transcript.length);
}

// ─── Audio Capture ────────────────────────────────────────────────────────────
async function startCapture(tabId) {
  try {
    // tabCapture captures the tab's audio stream
    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture(
        { audio: true, video: false },
        (capturedStream) => {
          if (chrome.runtime.lastError || !capturedStream) {
            reject(chrome.runtime.lastError?.message || "Capture failed");
          } else {
            resolve(capturedStream);
          }
        }
      );
    });

    meetingState.stream = stream;

    // Optional: MediaRecorder for raw audio storage (e.g., for Whisper API)
    // Currently we rely on Web Speech API via content script for transcription
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    const chunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      // Store or send blob to Whisper API here if desired
      console.log("[MeetNotes] Audio blob ready:", blob.size, "bytes");
    };

    mediaRecorder.start(10000); // chunk every 10 seconds
    meetingState.mediaRecorder = mediaRecorder;

    broadcastToUI({ type: "CAPTURE_STARTED" });
    console.log("[MeetNotes] Tab audio capture started");

  } catch (err) {
    console.error("[MeetNotes] Capture error:", err);
    broadcastToUI({ type: "CAPTURE_ERROR", error: err.toString() });
  }
}

function stopCapture() {
  if (meetingState.mediaRecorder?.state !== "inactive") {
    meetingState.mediaRecorder?.stop();
  }
  meetingState.stream?.getTracks().forEach((t) => t.stop());
  meetingState.mediaRecorder = null;
  meetingState.stream = null;
}

// ─── Transcript Management ────────────────────────────────────────────────────
function appendTranscript(text, isFinal) {
  if (!text?.trim()) return;

  const entry = {
    text: text.trim(),
    timestamp: Date.now(),
    isFinal,
  };

  if (isFinal) {
    meetingState.transcript.push(entry);
    saveMeetingState();
    broadcastToUI({ type: "TRANSCRIPT_UPDATE", transcript: meetingState.transcript });
  }
}

// ─── AI Summarisation ─────────────────────────────────────────────────────────
async function summariseMeeting() {
  const { apiKey } = await chrome.storage.sync.get("apiKey");

  if (!apiKey) {
    return { error: "No API key set. Add your OpenAI API key in Settings." };
  }

  const transcriptText = meetingState.transcript
    .filter((t) => t.isFinal)
    .map((t) => t.text)
    .join(" ");

  if (!transcriptText.trim()) {
    return { error: "No transcript available to summarise." };
  }

  const meetingDuration = meetingState.startTime
    ? Math.round((Date.now() - meetingState.startTime) / 60000)
    : "unknown";

  const prompt = `You are a professional meeting note-taker. Below is a transcript from a Google Meet call that lasted approximately ${meetingDuration} minutes.

Please extract and structure the following:

1. Meeting Summary — 2–3 sentence overview
2. Key Decisions — bullet list
3. Action Items — bullet list with owners
4. Key Points
5. Open Questions

Be concise.

TRANSCRIPT:
${transcriptText}`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,   // ✅ FIXED HEADER
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",   // ✅ lightweight + cheap + good for summaries
        input: prompt,
        max_output_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return { error: `API error: ${err.error?.message || response.statusText}` };
    }

    const data = await response.json();

    const summary =
      data.output?.[0]?.content?.[0]?.text || "No summary returned.";

    // Save summary
    const saved = {
      summary,
      transcript: meetingState.transcript,
      startTime: meetingState.startTime,
      generatedAt: Date.now(),
    };

    await chrome.storage.local.set({ lastMeeting: saved });

    broadcastToUI({ type: "SUMMARY_READY", summary });

    return { summary };

  } catch (err) {
    console.error("[MeetNotes] Summarise error:", err);
    return { error: `Network error: ${err.message}` };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSafeState() {
  return {
    active: meetingState.active,
    tabId: meetingState.tabId,
    startTime: meetingState.startTime,
    transcriptCount: meetingState.transcript.length,
    transcript: meetingState.transcript,
  };
}

function saveMeetingState() {
  chrome.storage.session.set({ meetingState: getSafeState() }).catch(() => {
    // session storage may not be available in all MV3 contexts
    chrome.storage.local.set({ meetingState: getSafeState() });
  });
}

function clearNotes() {
  meetingState.transcript = [];
  chrome.storage.local.remove("lastMeeting");
  broadcastToUI({ type: "NOTES_CLEARED" });
}

function broadcastToUI(message) {
  // Send to all extension pages (popup, sidepanel, options)
  chrome.runtime.sendMessage(message).catch(() => {
    // Ignore — no listener open is fine
  });
}

console.log("[MeetNotes] Background service worker loaded");