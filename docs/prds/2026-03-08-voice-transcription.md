# PRD: Voice Transcription

**Date:** 2026-03-08 **Status:** ✅ Complete **Research:** `docs/research/voice-transcription-options.md`**Reference implementation:** [TeamAI](https://github.com/PeterBlenessy/TeamAI) — see `src/components/UserInput.vue` for Web Speech API integration **Web Speech API docs:** [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)

## Problem

Users take meeting notes manually while participating in conversations — splitting attention between listening and typing. Notesage is a markdown editor with AI capabilities but has no way to capture spoken audio and produce written documents. Adding voice-to-text would let users record meetings, lectures, or brainstorming sessions and get structured markdown transcripts without leaving the app.

## Goals

1. **Dictation:** Users can speak into their microphone and see text appear in the editor or chat input in real-time
2. **Meeting recording:** Users can record full meetings (mic + system audio) and get a timestamped markdown transcript
3. **Local-only:** All transcription runs on-device — no audio data leaves the machine, no API keys required
4. **Low friction:** One-click to start recording, one-click to stop and get a transcript
5. **Structured output:** Meeting transcripts are saved as markdown files with YAML frontmatter (date, duration, participants, tags)

## Implementation Notes

Key decisions and deviations made during development:

**WKWebView Web Speech API fallback:** As predicted in the risk assessment, `SpeechRecognition` is not available in Tauri's WKWebView. The implementation uses the whisper-rs fallback path exclusively — mic capture via `cpal`, streaming transcription via whisper-rs `base` model, results pushed to frontend via `dictation-result` Tauri events. The `useSpeechRecognition` hook abstracts this, so the UI code is identical regardless of the underlying engine.

**Device-native sample rate with resampling:** Rather than forcing `cpal` to open the mic at 16kHz (which fails on many devices that only support 44.1kHz or 48kHz), the implementation captures at the device's native sample rate and resamples to 16kHz mono f32 before feeding to whisper-rs. This ensures compatibility across all macOS audio hardware.

**Hallucination filtering:** Whisper models produce hallucinated output on silence or background noise (e.g., repeated "Thank you", "Bye", "you", or artifacts like "[BLANK_AUDIO]"). The implementation includes a hallucination filter that detects and suppresses these patterns — checking for repetitive short segments, known hallucination phrases, and segments that are suspiciously uniform. This significantly improves transcript quality for recordings with pauses or low-quality audio.

**Concurrent model downloads with cancel support:** The model management system supports downloading multiple models simultaneously, each with independent progress tracking. Downloads can be cancelled mid-flight without leaving partial files (uses temp file + atomic rename pattern). The frontend shows per-model progress bars with cancel buttons.

**Status bar download indicator:** When a model download is in progress, a download indicator appears in the editor status bar showing the model name and progress percentage. This keeps the user informed even when the settings dialog is closed.

**Task #4 (system audio capture) deferred:** System audio capture via `screencapturekit` is deferred due to: (1) the crate's limited production usage and maturity risk, (2) the additional Screen Recording permission adding user friction, and (3) echo cancellation complexity when mixing mic + system audio. Mic-only recording covers the primary use cases (dictation, personal meeting notes, lecture recording). The infrastructure stub remains in place for future implementation.

## Non-Goals

- Cloud transcription APIs (may be added as optional upgrade later)
- Video recording or screen capture
- Real-time collaborative transcription (multi-user)
- Automatic meeting detection (e.g., auto-start when Zoom opens)
- Transcript editing with audio playback sync (like Descript)
- Speaker diarization via ML in v1 (channel-based attribution only)
- Mobile/iOS support

## User Stories

**Dictation (Option 1):**

- As a user, I want to click a microphone button in the chat input to dictate a message instead of typing
- As a user, I want to click a microphone button in the editor toolbar to dictate text at the cursor position
- As a user, I want to see interim transcription results as I speak, so I know it's working
- As a user, I want dictation to work without an internet connection

**Meeting recording (Option 2):**

- As a user, I want to start a meeting recording from the toolbar or a keyboard shortcut
- As a user, I want to choose whether to record just my microphone, just system audio (Zoom/Teams), or both
- As a user, I want to see a recording indicator (timer, waveform) so I know recording is active
- As a user, I want to stop recording and have Notesage generate a timestamped markdown transcript
- As a user, I want the transcript saved as a new `.md` file in my project with proper frontmatter
- As a user, I want to choose which Whisper model to use (trade-off: speed vs accuracy)
- As a user, I want to download larger Whisper models from within the app settings

## Technical Approach

### Option 1: Web Speech API — Real-Time Dictation

Lightweight browser-native speech recognition for quick dictation into chat or editor. Based on the TeamAI implementation pattern.

**How it works:**

```
User clicks mic button
     ↓
navigator.mediaDevices.getUserMedia({ audio: true })
     ↓
webkitSpeechRecognition / SpeechRecognition
     ↓
recognition.onresult → interim/final transcript
     ↓
Text inserted at cursor (editor or chat input)
```

**Implementation:**

- `useSpeechRecognition` React hook encapsulating the Web Speech API lifecycle
- Feature detection: check for `webkitSpeechRecognition` or `SpeechRecognition` in `window`
- `recognition.continuous = false` — stop when user pauses (like TeamAI)
- `recognition.interimResults = true` — show text as user speaks
- Language selection from settings (reuse existing i18n locale or separate speech language setting)
- Mic button in `ChatInput.tsx` (prepend area, same pattern as TeamAI's `UserInput.vue`)
- Mic button in `Toolbar.tsx` for dictation into editor at cursor position

**WKWebView compatibility concern:**

Research indicates `SpeechRecognition` is broken in WKWebView (works in Safari proper but not WebView contexts). This needs to be validated during implementation:

- If it works in Tauri's WKWebView on the target macOS version → use directly
- If not → fall back to Option 2's `whisper-rs` pipeline with real-time streaming via the `base` model as the dictation engine (mic capture via `cpal`, streaming transcription via `whisper-rs`, results pushed to frontend via Tauri events)

**Fallback architecture (if Web Speech API fails in WKWebView):**

```
User clicks mic button
     ↓
Frontend calls start_dictation() Tauri command
     ↓
Rust: cpal mic capture → streaming PCM chunks
     ↓
Rust: whisper-rs (base model, streaming mode)
     ↓
Tauri event: dictation-result { text, is_final }
     ↓
Frontend inserts text at cursor
```

**New components:**

- `src/hooks/useSpeechRecognition.ts` — Web Speech API hook (primary) or Tauri dictation bridge (fallback)
- Mic toggle button added to `ChatInput.tsx` and `Toolbar.tsx`

**State:**

- `recording-store.ts` (or extend `settings-store`): `isDictating: boolean`, `speechLanguage: string`

### Option 2: whisper-rs — Meeting Transcription

Full meeting recording and transcription via whisper.cpp running natively in the Rust backend with Metal GPU acceleration.

**How it works:**

```
Audio Input
├── Microphone (cpal) ← SHIPPED
└── System Audio (screencapturekit, macOS 13+) ← DEFERRED
     ↓
  Capture at device-native sample rate → resample to 16kHz mono f32
     ↓
  whisper-rs (Metal GPU on Apple Silicon) + hallucination filtering
     ↓
  TranscriptionResult { segments: [{ start, end, text }] }
     ↓
  Markdown formatter (timestamps, speaker labels by channel)
     ↓
  New .md file in project
```

**Rust backend — new module** `src-tauri/src/commands/transcription.rs`**:**

```rust
// Managed state
pub struct TranscriptionState {
    recording: Mutex<Option<RecordingSession>>,
    whisper_model: Mutex<Option<WhisperContext>>,
    models_dir: PathBuf,  // ~/.notesage/whisper-models/
}

struct RecordingSession {
    mic_stream: Option<cpal::Stream>,
    system_stream: Option</* screencapturekit stream */>,
    mic_buffer: Arc<Mutex<Vec<f32>>>,
    system_buffer: Arc<Mutex<Vec<f32>>>,
    start_time: Instant,
}

// Tauri commands
#[tauri::command]
async fn start_recording(
    state: State<'_, TranscriptionState>,
    source: String,  // "microphone" | "system" | "both"
) -> Result<(), String>

#[tauri::command]
async fn stop_recording(
    state: State<'_, TranscriptionState>,
) -> Result<AudioBufferInfo, String>
// Returns buffer metadata (duration, sample rate, channels)

#[tauri::command]
async fn transcribe(
    window: Window,
    state: State<'_, TranscriptionState>,
    model: String,  // "tiny" | "base" | "small" | "medium" | "large-v3"
) -> Result<TranscriptionResult, String>
// Emits transcription-progress events during processing

#[tauri::command]
async fn start_dictation(
    window: Window,
    state: State<'_, TranscriptionState>,
) -> Result<(), String>
// Streaming: captures mic + runs whisper-rs base model in chunks
// Emits dictation-result { text, is_final } events

#[tauri::command]
async fn stop_dictation(
    state: State<'_, TranscriptionState>,
) -> Result<(), String>

// Model management
#[tauri::command]
async fn list_whisper_models(
    state: State<'_, TranscriptionState>,
) -> Result<Vec<ModelInfo>, String>

#[tauri::command]
async fn download_whisper_model(
    window: Window,
    state: State<'_, TranscriptionState>,
    size: String,
) -> Result<(), String>
// Emits model-download-progress { size, downloaded, total } events

#[tauri::command]
async fn delete_whisper_model(
    state: State<'_, TranscriptionState>,
    size: String,
) -> Result<(), String>
```

**TranscriptionResult struct:**

```rust
#[derive(Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptionSegment>,
    pub duration_secs: f64,
    pub language: String,
}

#[derive(Serialize, Deserialize)]
pub struct TranscriptionSegment {
    pub start: f64,      // seconds
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,  // "You" (mic) / "Remote" (system) / None
}

#[derive(Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,       // "base", "small", etc.
    pub size_bytes: u64,
    pub downloaded: bool,
    pub path: Option<String>,
}
```

**Cargo dependencies:**

```toml
whisper-rs = { version = "0.15", features = ["metal"] }
cpal = "0.15"
hound = "3.5"          # WAV encoding
# screencapturekit = "1.5"  # macOS system audio — DEFERRED (see Implementation Notes)
```

**Model storage:**

- Models stored in `~/.notesage/whisper-models/`
- Ship app with no models bundled (too large for app binary)
- First-run: prompt user to download `base` model (\~142 MB)
- Settings UI for managing models (download, delete, see sizes)
- Models are GGML format, downloaded from Hugging Face

**Speaker attribution (channel-based):**

When recording "both" (mic + system audio), audio is captured into separate buffers. Each buffer is transcribed independently, then segments are merged by timestamp and labeled:

- Mic channel → `speaker: "You"`
- System channel → `speaker: "Remote"` (or `"Participant"`)

This gives reliable 2-party attribution without any ML diarization.

### Frontend

**New components:**

- `src/components/recording/RecordingBar.tsx` — floating recording indicator (timer, waveform, source indicator, stop button). Appears at top of editor area when recording.
- `src/components/recording/TranscriptionDialog.tsx` — post-recording dialog: select model, show progress, preview transcript, save as file.
- `src/components/settings/TranscriptionSettings.tsx` — model management (download/delete), default model selection, speech language.

**New hooks:**

- `src/hooks/useSpeechRecognition.ts` — Web Speech API dictation (Option 1) with whisper-rs fallback
- `src/hooks/useRecording.ts` — meeting recording lifecycle (start, stop, status)
- `src/hooks/useTranscription.ts` — transcription orchestration (model loading, progress tracking, result formatting)

**New store:**

- `src/stores/recording-store.ts` (Zustand, partially persisted):
  - `isRecording: boolean` (runtime)
  - `isDictating: boolean` (runtime)
  - `recordingSource: 'microphone' | 'system' | 'both'` (runtime)
  - `recordingStartTime: number | null` (runtime)
  - `defaultModel: string` (persisted, default: `'base'`)
  - `speechLanguage: string` (persisted, default: `'en'`)
  - `lastUsedSource: string` (persisted)

**Markdown output formatter (**`src/lib/transcript-formatter.ts`**):**

```typescript
interface TranscriptionResult {
  segments: { start: number; end: number; text: string; speaker?: string }[];
  duration_secs: number;
  language: string;
}

function formatTranscript(result: TranscriptionResult, title: string): string {
  // Returns markdown with YAML frontmatter + timestamped speaker segments
}
```

**Output format:**

```markdown
---
type: meeting-transcript
date: 2026-03-08
duration: "45:23"
participants:
  - You
  - Remote
tags:
  - meeting
---

# Meeting Transcript — March 8, 2026

**[00:00:12] You:** Welcome everyone to the weekly standup...

**[00:00:45] Remote:** Thanks. I wanted to discuss the roadmap...

**[00:15:03] You:** Let's move on to the design review...
```

## UI/UX

### Dictation (Option 1)

**Chat input mic button:**

- Mic icon (`Mic` from lucide-react) added to left side of `ChatInput.tsx`
- Default: muted grey. Active: primary color with pulse animation
- Click to start, click again to stop
- Interim text appears in the input field as user speaks
- On speech end: text stays in input, user can edit before sending

**Editor toolbar mic button:**

- Mic icon in the top toolbar (after existing formatting buttons)
- Same toggle behavior
- Text inserted at cursor position as user speaks
- Interim results shown as ghost text (dimmed), final result committed

### Meeting Recording (Option 2)

**Start recording:**

- Toolbar button: `Circle` icon (record) next to export button
- Keyboard shortcut: `Cmd+Shift+R`
- Click shows a popover: source selection (Microphone / System Audio / Both) + Start button
- System audio option shows note: "Requires macOS 13+ and Screen Recording permission"

**Recording indicator:**

- `RecordingBar.tsx`: fixed bar at top of editor content area (below tab bar)
- Shows: red recording dot (pulsing), elapsed time (`00:12:34`), source label, audio level meter (simple bar visualization), Stop button
- Minimal height (\~36px), doesn't push editor content down (overlays with slight transparency)

**Stop + transcribe:**

- Stop button in recording bar → opens `TranscriptionDialog.tsx`
- Dialog shows: recording summary (duration, source), model selector dropdown (only downloaded models), "Transcribe" button
- Progress: indeterminate → percentage as whisper processes
- Preview: scrollable transcript preview
- Actions: "Save as Note" (creates .md in current project), "Copy to Clipboard", "Insert at Cursor"

**Settings &gt; Transcription:**

- New tab in settings dialog (between "Skills & Agents" and project settings)
- Model management: list of available models with size, download status, download/delete buttons
- Download progress bar per model
- Default model selector
- Speech language dropdown
- Default recording source

### Empty/Error States

- **No model downloaded:** "Download a Whisper model to start transcribing" with prominent download button for `base` model
- **System audio permission denied:** Toast with instructions to enable Screen Recording in System Preferences
- **Mic permission denied:** Toast with instructions to enable Microphone in System Preferences
- **Web Speech API unavailable:** Silent fallback to whisper-rs dictation (no error shown to user)
- **Recording in progress, user tries to close tab:** Warning dialog "Recording in progress. Stop recording before closing?"

## Data Model

### Tauri Commands

See Technical Approach section for full command signatures. Summary:

| Command | Purpose |
| --- | --- |
| `start_recording` | Begin audio capture (mic/system/both) |
| `stop_recording` | End capture, return buffer info |
| `transcribe` | Run whisper-rs on buffer, emit progress events |
| `start_dictation` | Streaming mic → whisper-rs → text events |
| `stop_dictation` | End dictation stream |
| `list_whisper_models` | List available/downloaded models |
| `download_whisper_model` | Download model with progress events |
| `delete_whisper_model` | Remove downloaded model |

### Tauri Events

| Event | Payload | Direction |
| --- | --- | --- |
| `transcription-progress` | `{ percent: number, segment?: string }` | Rust → Frontend |
| `dictation-result` | `{ text: string, is_final: boolean }` | Rust → Frontend |
| `model-download-progress` | `{ model: string, downloaded: u64, total: u64 }` | Rust → Frontend |
| `recording-level` | `{ mic: number, system: number }` | Rust → Frontend (for waveform) |

### Store

`recording-store.ts` — see Frontend section above.

### Info.plist Additions

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Notesage needs microphone access for voice dictation and meeting recording</string>
```

## Dependencies

### Rust Crates (new)

| Crate | Version | Purpose | Size Impact | Status |
| --- | --- | --- | --- | --- |
| `whisper-rs` | 0.15 | Whisper transcription (Metal GPU) | \~2 MB binary increase | Shipped |
| `cpal` | 0.15 | Audio capture (CoreAudio) | \~200 KB | Shipped |
| `hound` | 3.5 | WAV encoding | \~50 KB | Shipped |
| `screencapturekit` | 1.5 | System audio capture (macOS 13+) | \~100 KB | Deferred |

### Whisper Models (user-downloaded)

| Model | Download Size | Disk Size |
| --- | --- | --- |
| tiny | 75 MB | 75 MB |
| base | 142 MB | 142 MB |
| small | 466 MB | 466 MB |
| medium | 1.5 GB | 1.5 GB |
| large-v3 | 2.9 GB | 2.9 GB |

### Frontend (no new npm packages)

All UI built with existing shadcn/ui components. Web Speech API is browser-native.

### Prerequisites

- Microphone permission (macOS system prompt)
- macOS 13+ for system audio capture (ScreenCaptureKit) — DEFERRED
- Screen Recording permission for system audio (macOS system prompt) — DEFERRED

## Quality Gates

### Functional

- [x] Dictation: click mic in chat input → speak → text appears in input field

- [x] Dictation: click mic in editor toolbar → speak → text inserted at cursor

- [x] Dictation: works without internet connection (whisper-rs fallback if Web Speech API unavailable)

- [x] Recording: can record microphone audio and stop cleanly

- [ ] ~~Recording: can record system audio on macOS 13+ with permission~~ (DEFERRED — task #4)

- [ ] ~~Recording: can record both mic + system audio simultaneously~~ (DEFERRED — task #4)

- [x] Recording: elapsed timer updates every second during recording

- [x] Transcription: base model produces readable English transcript

- [x] Transcription: progress events update UI during processing

- [x] Transcription: timestamps in output are accurate (within \~1s)

- [ ] ~~Transcription: channel-based speaker attribution works (mic = "You", system = "Remote")~~ (DEFERRED — requires task #4)

- [x] Output: transcript saved as valid markdown with correct YAML frontmatter

- [x] Output: transcript opens in editor and renders correctly

- [x] Models: can download base model from settings with progress indicator

- [x] Models: can delete downloaded models to free disk space

- [x] Models: first-run prompt guides user to download initial model

- [x] Permissions: graceful handling when mic/screen recording permission denied

- [x] Edge case: recording survives tab switch (doesn't stop)

- [x] Edge case: warning when trying to close app during active recording

- [x] No console errors during normal recording/transcription flow

### Design

- [x] Mic buttons match existing toolbar/chat input styling

- [x] Recording bar is visually polished (red dot, clean typography, audio meter)

- [x] Transcription dialog follows existing dialog patterns (ExportDialog reference)

- [x] Settings tab matches existing settings layout

- [x] Model download progress is smooth and informative

- [x] Works in both light and dark mode

- [x] All interactive elements have hover/active/focus states

### Performance

- [x] Dictation latency &lt; 500ms (text appears within 500ms of speaking)

- [x] Recording does not cause editor lag or UI jank

- [x] Base model transcription processes faster than real-time on Apple Silicon

- [x] Model download can be cancelled without leaving corrupt files

## Out of Scope (Future Enhancements)

- Cloud API transcription (OpenAI GPT-4o Transcribe, Deepgram) as optional quality/diarization upgrade
- ML-based speaker diarization for single-source recordings (pyannote, Vosk speaker ID)
- Real-time live transcript display during meeting recording (hybrid approach: base model streaming + large model reprocess)
- Audio playback synced with transcript (click timestamp → play from that point)
- Automatic chapter/section detection in transcripts
- Meeting summary generation via AI (feed transcript to chat)
- Import external audio files (.mp3, .wav, .m4a) for transcription
- Text-to-speech for reading documents aloud (`SpeechSynthesisUtterance` — works in WKWebView)
- Windows/Linux system audio capture
- Custom Whisper model fine-tuning