# MeetNotes AI — Chrome Extension

An AI-powered Google Meet note taker. Automatically detects when you join a meeting, transcribes speech in real time using the Web Speech API, and generates structured notes using Claude AI when the meeting ends.

---

## Features

- Auto-detects Google Meet sessions
- Real-time speech transcription (Web Speech API — free, no cost)
- AI-generated summaries with decisions, action items, and key points
- Live side panel with transcript and notes
- Notes persist across browser sessions
- Settings page for API key and language preferences

---

## Project Structure

```
meet-notes-extension/
├── manifest.json       # Extension config (MV3)
├── background.js       # Service worker — audio capture, AI calls, state
├── content.js          # Injected into meet.google.com — detects meeting, runs transcription
├── sidepanel.html      # Main notes UI (transcript + summary tabs)
├── sidepanel.js        # Side panel logic
├── popup.html          # Toolbar popup
├── popup.js            # Popup logic
├── options.html        # Settings page (API key, language, summary style)
└── icons/              # Extension icons
```

---

## Setup

### 1. Get a Claude API Key
Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key.

### 2. Add Icons
Place three PNG icons in the `icons/` folder:
- `icon16.png` (16×16)
- `icon48.png` (48×48)
- `icon128.png` (128×128)

### 3. Load in Chrome
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Click the MeetNotes icon → **Settings** → paste your API key → Save

### 4. Use It
1. Join any Google Meet call
2. The side panel opens automatically
3. Speech is transcribed live in the **Transcript** tab
4. Click **Summarise** to generate AI notes

---

## How It Works

```
content.js              Watches meet.google.com DOM for meeting start/end
    ↓
Web Speech API          Transcribes audio in the browser tab (free)
    ↓
background.js           Accumulates transcript, manages state
    ↓
Claude API              Generates structured summary on demand
    ↓
sidepanel.js            Renders transcript and notes in real time
```

---

## Extending This

Some ideas for next steps:

- **Whisper API** — replace Web Speech API for better accuracy and multilingual support
- **Speaker diarisation** — label who said what (requires audio processing)
- **Export to Notion / Google Docs** — add a one-click export button
- **Email summary** — send notes to participants after the call
- **Custom prompts** — let users define what the AI should extract

---

## Permissions Used

| Permission | Why |
|---|---|
| `tabCapture` | Capture tab audio for future Whisper integration |
| `storage` | Save API key and meeting notes |
| `activeTab` | Open side panel on the current tab |
| `sidePanel` | Render the notes panel inside Chrome |
| `notifications` | Alert when a meeting is detected |

---

## Author

**Kimani Justin Mwathi** — [github.com/justinmwathi](https://github.com/justinmwathi)