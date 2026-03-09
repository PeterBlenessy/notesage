# Voice Transcription — Implementation Tasks

**PRD:** `docs/prds/2026-03-08-voice-transcription.md`
**Total tasks:** 16 (3S, 8M, 5L)

## Summary

Implementation in two tracks that share infrastructure:

**Track A (Option 1 — Dictation):** Tasks #1, #8, #9, #10, #11
**Track B (Option 2 — Meeting Recording):** Tasks #2, #3, #4, #5, #6, #7, #8, #12, #13, #14, #15

Track B backend (#2–#7) is the heaviest lift — `whisper-rs` integration and audio capture. Track A can start in parallel with the `useSpeechRecognition` hook (#9) while backend work progresses. Tasks #8 (recording-store) and #12–#15 (frontend UI) depend on backend completion.

### Risks & Open Questions

1. **WKWebView SpeechRecognition:** Research says it's broken, but needs hands-on validation. Task #9 includes a spike. If broken, dictation falls back to whisper-rs streaming (#6), making Track B a hard prerequisite for Track A.
2. **screencapturekit crate maturity:** Used in one known project. System audio capture (#4) may need debugging. If it doesn't work, gracefully degrade to mic-only.
3. **whisper-rs Metal compilation:** First time adding C++ FFI dependencies to the project. May need Xcode Command Line Tools and specific build flags. Task #2 is scoped as L to account for this.
4. **Binary size increase:** whisper-rs adds ~2 MB to the binary (the models are downloaded separately). Monitor after #2.

### Suggested Implementation Order

```
#1  Info.plist (S)          ─┐
#2  whisper-rs + cpal (L)   ─┤  Backend foundation
#3  Mic recording (M)       ─┤
#4  System audio (L)        ─┘
#5  Whisper transcribe (L)  ─── Core transcription
#6  Streaming dictation (L) ─── Dictation backend (fallback for Option 1)
#7  Model management (M)    ─── Download/delete models
#8  recording-store (M)     ─── Frontend state
#9  useSpeechRecognition (M)─── Option 1: Web Speech API + fallback
#10 Chat input mic (M)      ─┐  Option 1: UI
#11 Toolbar mic (M)         ─┘
#12 RecordingBar (M)        ─┐
#13 TranscriptionDialog (L) ─┤  Option 2: UI
#14 Transcript formatter (S)─┤
#15 TranscriptionSettings(M)─┘
#16 Keyboard shortcuts (S)  ─── Final polish
```

---

## Tasks

### ✅ #1 — Add NSMicrophoneUsageDescription to Info.plist

**Complexity:** S
**Category:** backend
**Dependencies:** None
**Files:** `src-tauri/Info.plist`

Add the microphone usage description key required by macOS for audio access. Without this, both Web Speech API (`getUserMedia`) and native `cpal` mic capture will fail silently or crash.

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Notesage needs microphone access for voice dictation and meeting recording</string>
```

**Acceptance criteria:**
- App prompts for microphone permission when first accessing audio
- Permission persists across app restarts

---

### ✅ #2 — Add whisper-rs and cpal dependencies, scaffold transcription module

**Complexity:** L
**Category:** backend
**Dependencies:** None
**Files:** `src-tauri/Cargo.toml`, `src-tauri/src/commands/transcription.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

Add core Rust dependencies and scaffold the transcription command module with managed state.

**Cargo.toml additions:**
```toml
# Voice transcription
whisper-rs = { version = "0.15", features = ["metal"] }
cpal = "0.15"
hound = "3.5"
```

**Implementation:**
- Create `commands/transcription.rs` with `TranscriptionState` managed state struct (empty `Mutex` fields for recording session, whisper context, models directory)
- Define `TranscriptionResult`, `TranscriptionSegment`, `ModelInfo`, `AudioBufferInfo` serde structs
- Add `pub mod transcription;` and `pub use transcription::*;` to `commands/mod.rs`
- Add `.manage(TranscriptionState::new())` to `lib.rs` builder
- Verify `cargo build` succeeds with Metal acceleration on Apple Silicon
- Follow existing module pattern (e.g., `commands/acp.rs` for managed state, `commands/export.rs` for structs)

**Acceptance criteria:**
- `cargo build` compiles without errors
- `TranscriptionState` is registered as managed state
- All struct types compile and serialize correctly

---

### ✅ #3 — Implement microphone recording commands (start_recording / stop_recording)

**Complexity:** M
**Category:** backend
**Dependencies:** #2
**Files:** `src-tauri/src/commands/transcription.rs`, `src-tauri/src/lib.rs`

Implement `start_recording` and `stop_recording` Tauri commands for microphone capture using `cpal`.

**Implementation:**
- `start_recording(source: "microphone")`: open default input device via `cpal`, configure for 16kHz mono f32 PCM (Whisper's native format), start stream writing to `Arc<Mutex<Vec<f32>>>` buffer, store stream handle in `RecordingSession`
- `stop_recording()`: drop the cpal stream, return `AudioBufferInfo` (duration, sample count, sample rate)
- Handle errors: no input device, device busy, permission denied
- Emit `recording-level` events at ~10 Hz with RMS amplitude for waveform visualization
- Register both commands in `generate_handler![]` in `lib.rs`

**Acceptance criteria:**
- Can start mic recording, speak for 10 seconds, stop, and the buffer contains valid audio data
- `recording-level` events emit during recording
- Graceful error when no microphone available

---

### ⏸️ #4 — Implement system audio capture via screencapturekit (DEFERRED)

**Complexity:** L
**Category:** backend
**Dependencies:** #2
**Files:** `src-tauri/Cargo.toml`, `src-tauri/src/commands/transcription.rs`

**⚠️ Deferred:** This task is deferred due to multiple risk factors: (1) the `screencapturekit` crate has limited production usage and may require significant debugging, (2) system audio capture requires an additional Screen Recording permission which adds user friction, and (3) echo cancellation complexity when mixing mic + system audio. Mic-only recording (task #3) covers the primary use cases — voice dictation, meeting notes from the user's own microphone, and lecture recording. The stub infrastructure remains in place for future implementation if demand warrants it.

**Cargo.toml addition:**
```toml
screencapturekit = "1.5"  # macOS 13+ system audio
```

**Implementation:**
- `start_recording(source: "system")`: use `screencapturekit` to capture system audio output, resample to 16kHz mono f32 if needed, write to separate buffer
- `start_recording(source: "both")`: start both mic (cpal) and system (screencapturekit) streams simultaneously into separate buffers
- Handle macOS permission flow: Screen Recording permission prompt
- Graceful fallback: if macOS < 13 or permission denied, return descriptive error string
- Emit `recording-level` events with both `mic` and `system` levels when recording "both"

**Acceptance criteria:**
- Can capture system audio while a video plays in another app
- "Both" mode captures mic and system audio into separate buffers simultaneously
- Descriptive error when Screen Recording permission is denied
- Graceful error on macOS < 13

---

### ✅ #5 — Implement transcribe command (whisper-rs inference)

**Complexity:** L
**Category:** backend
**Dependencies:** #2, #3
**Files:** `src-tauri/src/commands/transcription.rs`, `src-tauri/src/lib.rs`

Implement the `transcribe` Tauri command that runs whisper-rs on recorded audio buffers and returns timestamped segments.

**Implementation:**
- `transcribe(model: String)`: load GGML model file from `~/.notesage/whisper-models/{model}.bin`, create `WhisperContext` with Metal acceleration, run full transcription on buffered audio
- For "both" source: transcribe mic and system buffers independently, merge segments by timestamp, label with `speaker: "You"` (mic) / `speaker: "Remote"` (system)
- Emit `transcription-progress` events with percentage and current segment text
- Use `whisper-rs` callback API for progress reporting
- Cache loaded `WhisperContext` in `TranscriptionState` to avoid reloading on consecutive transcriptions with the same model
- Register `transcribe` in `generate_handler![]`

**Acceptance criteria:**
- Record 30 seconds of speech, transcribe with base model → get readable text with timestamps
- Progress events emit during transcription
- Channel-based speaker attribution works when source is "both"
- Transcription completes faster than real-time on Apple Silicon with base model

---

### ✅ #6 — Implement streaming dictation commands (start_dictation / stop_dictation)

**Complexity:** L
**Category:** backend
**Dependencies:** #2, #3, #5
**Files:** `src-tauri/src/commands/transcription.rs`, `src-tauri/src/lib.rs`

Implement real-time streaming dictation that captures mic audio and transcribes in chunks, emitting results as Tauri events. This serves as the fallback when Web Speech API is unavailable in WKWebView.

**Implementation:**
- `start_dictation()`: start mic capture via cpal, accumulate audio in chunks (~3-5 seconds), run whisper-rs `base` model on each chunk, emit `dictation-result { text, is_final }` events
- Use a background `tokio::spawn` task for the transcription loop
- `stop_dictation()`: signal the background task to stop, drop mic stream, emit final result
- Optimize for latency: use `tiny` or `base` model only, keep context loaded
- Register both commands in `generate_handler![]`

**Acceptance criteria:**
- Start dictation → speak → text events arrive within ~3-5 seconds
- Stop dictation cleanly terminates the background task
- No audio buffer leaks or dangling tasks after stop

---

### ✅ #7 — Implement model management commands

**Complexity:** M
**Category:** backend
**Dependencies:** #2
**Files:** `src-tauri/src/commands/transcription.rs`, `src-tauri/src/lib.rs`

Implement Tauri commands for downloading, listing, and deleting Whisper GGML models.

**Implementation:**
- `list_whisper_models()`: scan `~/.notesage/whisper-models/` directory, return `Vec<ModelInfo>` with name, size, downloaded status for all known models (tiny, base, small, medium, large-v3)
- `download_whisper_model(size: String)`: download GGML model from Hugging Face (`ggerganov/whisper.cpp` repo) using `reqwest` streaming, emit `model-download-progress` events, write to temp file then rename (atomic). Use existing `reqwest` dependency.
- `delete_whisper_model(size: String)`: delete model file, clear cached `WhisperContext` if it was using that model
- Create `~/.notesage/whisper-models/` directory on first use
- Register all three commands in `generate_handler![]`

**Acceptance criteria:**
- Can download base model with progress events updating smoothly
- Downloaded model appears in list_whisper_models results
- Can delete model and reclaim disk space
- Interrupted download doesn't leave partial files (temp file + rename pattern)

---

### ✅ #8 — Create recording-store (Zustand)

**Complexity:** M
**Category:** frontend
**Dependencies:** None (can parallel with backend)
**Files:** `src/stores/recording-store.ts`

Create the Zustand store for recording and dictation state.

**Implementation:**
- Runtime state: `isRecording`, `isDictating`, `recordingSource`, `recordingStartTime`, `transcriptionProgress`, `availableModels`
- Persisted state: `defaultModel` (default: `'base'`), `speechLanguage` (default: `'en'`), `lastUsedSource` (default: `'microphone'`)
- Actions: `startRecording()`, `stopRecording()`, `startDictating()`, `stopDictating()`, `setTranscriptionProgress()`, `setAvailableModels()`, `setDefaultModel()`, `setSpeechLanguage()`
- Follow existing store patterns (e.g., `activity-store.ts` for mixed persisted/runtime state)

**Acceptance criteria:**
- Store initializes with correct defaults
- Persisted fields survive app restart
- Runtime fields reset on rehydration

---

### ✅ #9 — Implement useSpeechRecognition hook (Web Speech API + fallback)

**Complexity:** M
**Category:** frontend
**Dependencies:** #6, #8
**Files:** `src/hooks/useSpeechRecognition.ts`

Implement the dictation hook that tries Web Speech API first and falls back to whisper-rs streaming.

**Implementation:**
- On mount: detect `webkitSpeechRecognition` / `SpeechRecognition` availability in `window`
- **If available:** wrap Web Speech API lifecycle (same pattern as [TeamAI UserInput.vue](https://github.com/PeterBlenessy/TeamAI/blob/main/src/components/UserInput.vue)): `getUserMedia` permission, `recognition.start()`, `onresult` → emit text, `onspeechend` → stop
- **If not available (WKWebView fallback):** call `start_dictation` / `stop_dictation` Tauri commands, listen for `dictation-result` events
- Expose: `{ startDictation, stopDictation, isDictating, interimText, finalText, isWebSpeechAvailable }`
- Read `speechLanguage` from `recording-store`
- Handle errors gracefully: mic permission denied → toast, API not available → silent fallback

**Acceptance criteria:**
- Hook correctly detects Web Speech API availability
- If available: speech produces text via browser API
- If not available: speech produces text via whisper-rs Tauri events
- Clean stop with no lingering listeners or streams

---

### ✅ #10 — Add mic button to ChatInput

**Complexity:** M
**Category:** frontend
**Dependencies:** #9
**Files:** `src/components/chat/ChatInput.tsx`

Add microphone toggle button to the chat input area for voice dictation.

**Implementation:**
- `Mic` / `MicOff` icon (lucide-react) in the input area (before the send button or in prepend area)
- Click toggles `useSpeechRecognition.startDictation()` / `stopDictation()`
- Active state: primary color with subtle pulse animation (CSS `@keyframes`)
- Interim text appended to the input value as user speaks
- On speech end / final result: text stays in input for user to review/edit before sending
- Loading spinner while speech is being detected (like TeamAI's `speechDetected` state)
- Tooltip: "Start voice input" / "Stop voice input"

**Acceptance criteria:**
- Mic button visible in chat input
- Click → speak → text appears in input field
- Active state visually distinct (color + animation)
- Works in both light and dark mode

---

### ✅ #11 — Add mic button to editor Toolbar

**Complexity:** M
**Category:** frontend
**Dependencies:** #9
**Files:** `src/components/editor/Toolbar.tsx`

Add microphone toggle button to the editor toolbar for dictation at cursor position.

**Implementation:**
- `Mic` icon added after existing formatting buttons (or in a new "tools" section with the export button)
- Click toggles dictation via `useSpeechRecognition`
- Interim results: insert text at current cursor position using `editor.commands.insertContent()`
- Final result: committed to document (interim text replaced by final)
- If editor is not focused or no active tab, button is disabled
- Active state matches chat input mic button styling

**Acceptance criteria:**
- Mic button visible in toolbar
- Click → speak → text inserted at cursor in editor
- Interim → final text transition is smooth (no duplicate text)
- Button disabled when no editor is active

---

### ✅ #12 — Create RecordingBar component

**Complexity:** M
**Category:** frontend
**Dependencies:** #3, #8
**Files:** `src/components/recording/RecordingBar.tsx`, `src/hooks/useRecording.ts`

Implement the floating recording indicator bar and the recording lifecycle hook.

**Implementation:**

`useRecording` hook:
- `startRecording(source)`: call `start_recording` Tauri command, update `recording-store`, start elapsed timer interval
- `stopRecording()`: call `stop_recording` Tauri command, return buffer info, clear timer
- Listen for `recording-level` events → expose `micLevel` / `systemLevel` for waveform
- Expose: `{ startRecording, stopRecording, isRecording, elapsedTime, source, micLevel, systemLevel }`

`RecordingBar.tsx`:
- Fixed overlay at top of editor content area (~36px height)
- Red pulsing dot (CSS animation), elapsed time (`mm:ss`), source label ("Mic" / "System" / "Mic + System"), simple audio level bar, Stop button
- Only visible when `isRecording` is true
- Frosted glass / semi-transparent background (consistent with floating toolbar style)
- Stop button opens TranscriptionDialog (#13)

**Acceptance criteria:**
- Recording bar appears when recording starts, disappears when stopped
- Timer counts up accurately
- Audio level meter responds to sound
- Polished appearance in both light and dark mode

---

### ✅ #13 — Create TranscriptionDialog component

**Complexity:** L
**Category:** frontend
**Dependencies:** #5, #7, #8, #12
**Files:** `src/components/recording/TranscriptionDialog.tsx`, `src/hooks/useTranscription.ts`

Implement the post-recording transcription dialog with model selection, progress, preview, and save.

**Implementation:**

`useTranscription` hook:
- `transcribe(model)`: call `transcribe` Tauri command, listen for `transcription-progress` events, return `TranscriptionResult`
- `listModels()`: call `list_whisper_models`, update `recording-store.availableModels`
- Expose: `{ transcribe, isTranscribing, progress, result, availableModels }`

`TranscriptionDialog.tsx` (shadcn/ui `Dialog`):
- Header: "Transcribe Recording"
- Recording summary: duration, source
- Model selector: dropdown of downloaded models with size labels. If no models downloaded → show "Download a model in Settings" message with link
- "Transcribe" button → progress bar (percentage from events) → transcript preview
- Preview: scrollable area showing formatted markdown (use `MarkdownContent` component)
- Actions footer: "Save as Note" (creates .md file in active project via `useFileOperations`), "Copy to Clipboard", "Insert at Cursor" (inserts at editor cursor position)
- Follow `ExportDialog.tsx` pattern for dialog layout and state management

**Acceptance criteria:**
- Dialog shows after stopping recording
- Model selector only shows downloaded models
- Transcription progress updates smoothly
- Preview renders formatted transcript
- "Save as Note" creates a valid .md file with frontmatter in the active project
- "Copy to Clipboard" works
- "Insert at Cursor" inserts at editor position

---

### ✅ #14 — Implement transcript markdown formatter

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:** `src/lib/transcript-formatter.ts`

Pure function that converts `TranscriptionResult` into formatted markdown with YAML frontmatter.

**Implementation:**
- `formatTranscript(result: TranscriptionResult, title: string): string`
- YAML frontmatter: `type: meeting-transcript`, `date`, `duration` (formatted mm:ss), `participants` (unique speakers), `tags: [meeting]`
- Title: `# Meeting Transcript — {date}`
- Segments: `**[HH:MM:SS] {Speaker}:** {text}` (one per line, grouped into paragraphs)
- Format timestamps as `HH:MM:SS` or `MM:SS` (skip hours if < 1 hour)
- Handle missing speakers gracefully (omit speaker label)

**Acceptance criteria:**
- Output is valid markdown
- YAML frontmatter parses correctly
- Timestamps are correctly formatted
- Round-trips through Notesage editor without corruption

---

### ✅ #15 — Create TranscriptionSettings component

**Complexity:** M
**Category:** frontend
**Dependencies:** #7, #8
**Files:** `src/components/settings/TranscriptionSettings.tsx`, `src/components/settings/SettingsDialog.tsx`

Add a "Transcription" tab to the settings dialog for model management and preferences.

**Implementation:**
- New tab in `SettingsDialog.tsx` (between existing tabs, use same tab pattern)
- **Model management section:** table/list of models (tiny, base, small, medium, large-v3) with columns: name, size, status (Downloaded / Not downloaded), action button (Download / Delete)
- Download button → progress bar inline → "Downloaded" label
- Delete button with confirmation (shadcn/ui AlertDialog)
- **Preferences section:** default model selector (dropdown), speech language dropdown, default recording source radio group
- All preferences wired to `recording-store` persisted fields
- Follow `SkillsSettings.tsx` pattern for layout (cards, sections, action buttons)

**Acceptance criteria:**
- Transcription tab appears in settings
- Can download and delete models from the UI
- Download progress visible and smooth
- Preferences persist across app restarts
- Matches existing settings design

---

### ✅ #16 — Register keyboard shortcuts (Cmd+Shift+R)

**Complexity:** S
**Category:** frontend
**Dependencies:** #12
**Files:** `src/App.tsx` (or wherever global shortcuts are registered), `docs/keyboard-shortcuts.md`

Register `Cmd+Shift+R` as the keyboard shortcut for starting/stopping meeting recording.

**Implementation:**
- Add global keydown listener for `Cmd+Shift+R`
- If not recording → open recording source popover (or start with last-used source)
- If recording → stop recording (same as clicking Stop in RecordingBar)
- Update `docs/keyboard-shortcuts.md` with the new shortcut
- Ensure no conflict with existing shortcuts

**Acceptance criteria:**
- `Cmd+Shift+R` starts/stops recording
- Shortcut documented in keyboard-shortcuts.md
- No conflict with existing shortcuts (Cmd+Shift+R is currently unused)
