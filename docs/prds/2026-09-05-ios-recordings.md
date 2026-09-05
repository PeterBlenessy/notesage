# PRD: Recordings on iOS — capture on the phone, transcribe on the Mac

|  |  |
| --- | --- |
| **Date** | 2026-09-05 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Record a meeting or a voice note on the phone; the transcript appears under it once the Mac has seen it — one Recordings folder, one pipeline, no model on the phone |
| **Tasks** | [ios-recordings-tasks](../tasks/2026-09-05-ios-recordings-tasks.md) |
| **Precedent** | `docs/features/ai-workflows.md` § Meeting Recording (the Mac pipeline this extends); `docs/features/inbox.md` (a folder both devices agree on, state kept beside the files) |
| **Related** | `docs/prds/2026-09-05-icloud-container-library.md` — being written in parallel (making the library the app's own iCloud container). This PRD does **not** depend on it; see § Dependencies |

## Problem

The ask, verbatim: *"we need to add recordings to iOS."*

Meetings happen away from the desk. The Mac records and transcribes a meeting
well (`⌘⇧R` → `Recording <stamp>/audio.wav` → whole-file Whisper →
`transcript.md`), but the Mac is the device least likely to be in the room.
The phone is always there, has a good microphone, and already shares the
library — and today it cannot record anything. The nearest workaround is Voice
Memos plus the share sheet, which produces an orphan `.m4a` in `Inbox/` that
nothing transcribes.

The half that is hard is not capture; it is transcription. On-device Whisper
means a 0.6 GB model download, a hot phone for the length of the meeting, and a
`whisper-rs` build that does not currently link on iOS (Accelerate symbols —
see the note at `src-tauri/Cargo.toml:190`). The Mac already has the model, the
GPU, the decoder, the job runner, the activity card and the "Move to project"
flow.

**So: ship capture on the phone with transcription on the Mac first, and make
on-device transcription an option later.** The phone records into the shared
`Recordings/` folder; the Mac notices the new bundle when it syncs in, runs the
existing pipeline, and writes `transcript.md` back beside the audio, where the
phone shows it.

## Goals / Non-Goals

### Goals

- **Record on the phone, screen locked, for the length of a meeting.** Pause,
  resume, survive a phone call, stop — and end up with one bundle in the
  library's `Recordings/` folder.
- **The Mac transcribes it without being asked.** A bundle that arrives from
  the phone is picked up by the running desktop app, queued through the
  existing transcription job, and the transcript lands back in the bundle.
- **The phone shows the recording immediately and the transcript when it
  exists.** Duration, playback with lock-screen controls, and an honest status
  ("Waiting for your Mac" · "Transcribing on Peter's Mac" · transcript).
- **Sync-sized files.** A one-hour meeting is ~30 MB, not ~350 MB.
- **Nothing new on the Mac's transcription path.** `transcribe_file` already
  decodes `.m4a` (#803); the desktop work is discovery and bookkeeping, not
  audio.

### Non-Goals

- **On-device transcription in this PRD's shipping phases.** Evaluated
  honestly in § Phase 4 and left as an opt-in later phase.
- **Live / streaming transcription, dictation into a note, or voice commands.**
  The Mac has none of these either (#264 removed live dictation on purpose).
- **System-audio or call recording.** Microphone only, like the Mac.
- **Speaker diarization.** `speaker_id` / `speaker_name` stay `null`, as on the
  Mac.
- **Moving the Mac's own recorder into the synced library.** See § Out of Scope
  for why that is its own change.
- **A Live Activity / Dynamic Island widget for the running recording.** iOS
  already shows the red microphone pill; a Live Activity is polish for later.

## User Stories

- As someone in a meeting, I want to start recording in two taps and put the
  phone face down, so that I can pay attention to the room and still have the
  words afterwards.
- As the same person, when a call comes in mid-meeting, I want the recording
  to pause and resume by itself, so that I do not have to remember to restart
  it.
- As someone back at the desk, I want the transcript to already be there when
  I open the Mac, so that "get the transcript" is not a task.
- As someone on the train, I want to listen back to this morning's recording
  from the lock screen, so that I can review it without opening the app.
- As someone who cares where their audio goes, I want the file to stay in my
  own library (local or my iCloud Drive) and never touch a server of ours, so
  that recording a client meeting is not a data-handling question.

## Decisions

Recorded here so implementation does not reopen them. Each one was checked
against the code, not assumed.

| Question | Decision | Why |
| --- | --- | --- |
| Transcribe on the phone or the Mac? | **Mac, first.** On-device is Phase 4, opt-in. | Whisper on iOS = 0.6 GB model + heat + a `whisper-rs` that does not link on iOS today. The Mac pipeline exists end to end. |
| File format | **`.m4a` (AAC-LC, mono, 48 kHz, 64 kbps) written by `AVAudioRecorder`.** Not WAV. | The Mac's `transcribe_file` no longer needs WAV: #803 replaced the RIFF parser with `audio_decode.rs` — symphonia with `aac`/`isomp4` features, CoreAudio fallback on macOS. AAC is ~12× smaller than 16-bit PCM (≈29 MB/h vs ≈345 MB/h), and iCloud has to carry every byte to every device. Voice Memos made the same call. Whisper resamples everything to 16 kHz mono anyway. |
| Where the phone records | **Into the app's local container first; moved into the library on stop.** Never straight into the iCloud folder. | A file growing for two hours inside iCloud Drive is re-uploaded repeatedly and would be visible to the Mac as a half-file. Local-then-move makes the bundle appear on the Mac whole, and gives crash recovery a single place to look. |
| Bundle layout | `<library root>/Recordings/Recording <YYYY-MM-DD HH-MM-SS>/` with **`audio.m4a` + `recording.json`**; the Mac adds **`transcript.md`**. | Same folder name and stamp format the Mac writes (`transcription.rs:730`). The manifest is new: today's Mac bundle carries no metadata at all, and an externally created bundle needs duration, start time, device and expected byte size somewhere. |
| The "pending transcription" marker | **`recording.json` present and `transcript.md` absent = pending.** The Mac writes its state (`running` / `done` / `failed`, with device and time) back into `recording.json`. | No separate marker file to keep in step. The transcript's existence is already the Mac's definition of done; the manifest carries status for the phone to display and for failures not to be retried blindly. |
| How the Mac notices | **A startup scan of `<library root>/Recordings` plus the existing recursive watcher** (`useStartWatchers` already watches `icloudNotesagePath` and `notesRootPath`). | Verified: nothing enumerates the Recordings folder today; the only transcription trigger is the `notesage:start-transcription` event fired from `stop_recording` and the card's Re-run. The watcher events already fire; nothing consumes them. |
| Partial-download guard | **Transcribe only when the on-disk size equals `audio.bytes` from the manifest** (plus a macOS `icloud_ensure_downloaded` for evicted files). | iCloud delivers the manifest and the audio separately; a truncated `.m4a` decodes silently to a truncated transcript. The phone knows the exact byte count at stop time. |
| Which library root | **The same rule the Inbox uses:** `settings.icloudNotesagePath` when sync is on, else `resolveNotesRoot(notesRootPath)`. | `inbox-store.ts:250` is the precedent. On the phone, the root is the granted folder, so `Recordings/` sits beside `Inbox/`. |
| Where the record control lives | **In the "+" long-press menu everywhere ("New Recording"), and as the "+" *primary* action inside the `Recordings/` folder.** No new chrome island at rest. | Tap-on-"+" = new note is established muscle memory (#586) and must not change. Pinning `Recordings/` gives a two-tap start; the long-press menu is the discoverable path from anywhere. |
| The in-progress state | **A native `bottomCenter` island** (`● 02:14 · pause · stop`) — the slot the Reader's speech transport uses — shown across the browser *and* the Reader while recording. | Taking notes during the meeting is the point; the recording must not trap the user on a screen. Recording and speech playback share one audio session, so the island and the Listen transport are mutually exclusive. |
| Audio session | **`.playAndRecord`, mode `.default`, options `[.allowBluetooth, .defaultToSpeaker]`**, with the existing `audio` background mode. | `.playAndRecord` with the `audio` background mode is what keeps the process alive when the screen locks. `.default` mode avoids `.voiceChat`'s aggressive processing on far-field meeting audio. Bluetooth headsets are how people record on the move. |
| Interruptions | **Auto-pause on `.began`; auto-resume on `.ended` + `.shouldResume`; otherwise stay paused and say so.** Route loss (headphones unplugged) keeps recording on the built-in mic. | Mirrors `SpeechPlayer.observeInterruptions()`; a phone call is exactly this path. The user is told the recording paused and did not resume, never left guessing. |
| Lock screen while recording | **None of ours.** iOS's own red microphone indicator is the affordance. | `MPNowPlayingInfoCenter` is for playback; abusing it for a recorder is fragile and reviewers notice. A Live Activity is the correct later answer. |
| Playback on the phone | **In-app `AVAudioPlayer` with `SpeechPlayer`'s Now Playing + remote-command pattern**, not QuickLook. | QuickLook (today's path for `media` files) is a modal with no lock-screen controls, no resume position, and no relation to the transcript. |
| Name collisions | **Native dedupe (`-1` suffix) at bundle creation**, the same `deduped(_:under:)` `createDirectory` uses. | Two devices can stamp the same second. |
| Language | **Manifest carries the phone's language code when it is one the Mac knows** (`SPEECH_LANGUAGES`), else omitted; the Mac falls back to its `speechLanguage`. | Same source of truth as the Mac's own default (device language, not `auto`). Per-recording override is a later refinement. |
| On-device engine, when it comes | **Apple `SpeechAnalyzer` (iOS 26+) with `SFSpeechRecognizer` on-device as the iOS 16–25 fallback — never Whisper.** Opt-in setting. | See § Phase 4 for the honest assessment. |

## Technical Approach

### The shape of it

```
phone                                   iCloud Drive                 Mac
─────                                   ────────────                 ───
tap New Recording
AVAudioRecorder → <local container>/…/audio.m4a   (growing; not synced)
stop → finalize
mkdir  Recordings/Recording <stamp>/    ───────────►  appears whole ─► useRecordingsInbox
move   audio.m4a                                                       size == manifest.audio.bytes?
write  recording.json (transcription: null)                            startTranscription(…)
                                                                       transcribe_file (symphonia/CoreAudio → Whisper)
Recording screen: "Waiting for your Mac"  ◄──────── recording.json {transcription: running, device}
                                          ◄──────── transcript.md + recording.json {done}
Recording screen: transcript rendered
```

Three properties hold it together: the bundle never exists on iCloud in a
partial state (local-then-move); the manifest tells the Mac exactly how many
bytes to wait for; and the transcript's existence is the completion state on
both devices, exactly as it is on the Mac today.

### Phone: capture (Phase 1)

**Native.** A new `Recorder.swift` in the plugin (`src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/`), a singleton like `SpeechPlayer` because the audio session is process-wide:

- `AVAudioRecorder` with `AVFormatIDKey: kAudioFormatMPEG4AAC`, `AVSampleRateKey: 48000`, `AVNumberOfChannelsKey: 1`, `AVEncoderBitRateKey: 64000`, writing to `<Application Support>/Recordings/<uuid>/audio.m4a`. Metering enabled for the level readout.
- Session: `.playAndRecord` / `.default` / `[.allowBluetooth, .defaultToSpeaker]`, activated on start, deactivated with `.notifyOthersOnDeactivation` on stop. `AVAudioSession.requestRecordPermission` on the first start; a denied state is surfaced to JS, never a silent failure.
- Observers: `interruptionNotification` (pause / conditional resume), `routeChangeNotification` (`.oldDeviceUnavailable` → keep going on the new route, emit an event so the island can note it), `mediaServicesWereResetNotification` (stop and finalize what exists).
- A 1 Hz tick to JS with pause-aware elapsed seconds (`recorder.currentTime`) and the metered level, via the same `evaluateJavaScript(CustomEvent)` push `SpeechPlayer` uses: `notesage:recording` with `{event: "tick" | "paused" | "resumed" | "interrupted" | "route" | "finished" | "error", …}`.
- Free-space check at start (refuse under 200 MB — an hour is ~30 MB, and a refusal at the start beats a truncation at minute 90).

**Audio-session arbitration.** One small `AudioOwner` enum in the plugin: `speech`, `recording`, `player` (Phase 3). Starting one stops the others explicitly; `SpeechPlayer.stop()` today deactivates the session unconditionally, which would kill a recording, so the arbiter owns activation and the players stop calling `setActive` themselves.

**Finalize into the library** (`LibraryAccess.finalizeRecording`): inside the security scope, `createDirectory("Recordings/Recording <stamp>")` with the existing dedupe, then a coordinated `.forReplacing` write that copies `audio.m4a` from the local container and writes `recording.json`, then deletes the local staging folder. The stamp is `Recording <YYYY-MM-DD HH-MM-SS>` in local time, identical to `transcription.rs:730`. Nothing here needs a binary write *command* — the bytes never cross IPC — which is why the "no binary write on the iOS surface" invariant stays true.

**Crash recovery.** On launch, any staging folder still present is an orphan. If `AVAudioFile` can open it, offer "Recover recording" (finalize it as above with `durationSecs` from the file); if not, offer to delete it. `AVAudioRecorder` writes the MP4 `moov` atom at stop, so an unrecoverable orphan after a force-quit is a real outcome and is reported as one.

**Rust.** `ios_library.rs` gains `ios_recording_start / pause / resume / stop / state / recover`, registered in both `generate_handler!` lists in `lib.rs` (the desktop list returns the usual "only available on iOS"). `ios_recording_stop` returns the final bundle rel path and the manifest. All paths go through `sanitize_rel_path`.

**Frontend.** `ios-api.ts` wrappers; a `recording` slice in `mobile-store` (`{ status: "idle" | "recording" | "paused" | "finalizing", startedAt, elapsedSecs, level, interrupted, bundleRel? }`, not persisted); a `startRecordingEvents()` subscriber next to `startSpeechEvents()` in `MobileApp.tsx`. The "+" menu (`LibraryBrowser.tsx:552-559`) gains `{ id: "create-recording", title: "New Recording", icon: "waveform.badge.plus" }`; inside `Recordings/` the primary action swaps to record. The `bottomCenter` island is a new `IosChromeRecorder` spec (`{ elapsed, paused, level }`, ids `rec-toggle`, `rec-stop`) rendered by `ChromeOverlay.swift` beside the existing `IosChromePlayer`, with the web `Chrome.tsx` fallback. Stop confirms only when the recording is under 5 s (an accidental tap); otherwise it just stops — the bundle is the confirmation.

### Mac: discovery and the pending-transcription contract (Phase 2)

**The contract.** `recording.json` (schema in § Data Model). A bundle is *pending* when the manifest exists and `transcript.md` does not. The Mac claims it by writing `transcription: { status: "running", device, updatedAt }`, and on completion `done` (with model and detected language) or `failed` (with the error). The phone only reads this field.

**Discovery.** A new `useRecordingsInbox` hook, mounted in `App.tsx` (the rule: a hook that is not mounted never runs — the reason `useTranscriptionJob` is there). It:

1. resolves `recordingsDir(root)` with the Inbox's root rule (`notes-root.ts`);
2. on `startupReady`, lists the folder and evaluates every `Recording *` subfolder;
3. subscribes to `file-changed-batch` and re-evaluates any bundle a `create` / `modify` event touches (the watcher already covers this tree; `useFileWatcher.ts` just never looked at audio);
4. skips bundles that have `transcript.md`, whose manifest says `running` on *another* device within the last hour, or that the activity store already tracks by `audioPath`;
5. gates on **size**: `stat` of `audio.m4a` must equal `audio.bytes`. If the file is an evicted iCloud placeholder (`.audio.m4a.icloud` beside a missing `audio.m4a`), calls `icloud_ensure_downloaded` and waits for the next watcher event;
6. queues eligible bundles FIFO and dispatches `startTranscription({ audioPath, recordingStartedAt, recordingDurationSecs, language })` **one at a time** — `transcribe_file` serializes on a single Whisper context anyway, and N concurrent jobs would just contend on the mutex;
7. writes the manifest's `transcription` field at claim, done and failure.

Everything downstream is untouched: `useTranscriptionJob` renders `transcript.md` into `dirname(audioPath)` via `writeTranscriptToBundle` (already container-agnostic — it only takes the directory), the `TranscriptionCard` shows the job, and "Move to project" moves the whole folder including the manifest.

**What the desktop gets for free.** Because Mac-recorded bundles carry no manifest, the scanner ignores them — the desktop recorder's behaviour does not change. A small addition makes the two symmetric: the Mac's `stop_recording` path writes the same `recording.json` for its own bundles (a `manifest.ts` helper; the Rust side is unchanged), so a future phone can show Mac recordings with their duration. Cheap, and it makes the format bilateral rather than phone-specific.

**Failure policy.** A `failed` manifest is not retried automatically; the `TranscriptionCard`'s Re-run does it (it already reuses the job id). The phone shows the failure text. This keeps a bundle the Mac cannot decode from burning a Whisper run every launch.

### Phone: playback and the recording screen (Phase 3)

**`AudioPlayer.swift`**, structured like `SpeechPlayer`: `AVAudioPlayer` over the library file (coordinated read to a temp copy, as `quickLook` does), `.playback` / `.spokenAudio` session through the arbiter, `MPNowPlayingInfoCenter` with real elapsed/duration seconds, remote commands play / pause / `skipForward(15)` / `skipBackward(15)` / `changePlaybackPosition`, interruption auto-pause, `routeChangeNotification` `.oldDeviceUnavailable` → pause (unplugging headphones must not blast the room). Events `notesage:audio` `{event: "progress" | "playing" | "finished"}`.

**The recording item in the browser.** A directory named `Recording *` is presented as one item, not a folder: waveform glyph, title, `31 min · Transcribed` / `Waiting for your Mac` / `Transcribing on Peter's Mac…` / `Transcription failed`, and the `ListenButton` ring reused for playback state. Tapping opens the **Recording screen** in the Reader (`kind: "recording"`): the transport (scrubber, ±15 s, rate), the status line, and the transcript rendered through the existing markdown path when `transcript.md` exists (the note is a normal `type: meeting-transcript` document, so nothing new renders it). If `recording.json` cannot be read (a renamed or foreign folder), the row degrades to a plain folder and `audio.m4a` plays from inside it.

**Seeing the Mac's result.** iOS has no watcher. The Recording screen re-reads `transcript.md` and the manifest on appear and on foreground (`visibilitychange`), and the browser refreshes its status pills on the same triggers the Inbox progress sync uses. Latency is iCloud's; the UI never claims more than it knows.

### Phone: on-device transcription (Phase 4 — later, opt-in)

The honest evaluation, so the decision to defer is a decision and not a shrug:

| Engine | Cost on the phone | Quality on meeting audio | Notes |
| --- | --- | --- | --- |
| Whisper `large-v3-turbo-q5_0` via `whisper-rs` | 0.6 GB download; the phone runs hot for roughly the recording's length; `whisper-rs` does not link on iOS today (Accelerate symbols, `Cargo.toml:190`) | The reference — it is what the Mac uses | Rejected. Every cost is paid up front and per meeting. |
| `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true` | Free; no download; fast; runs on the Neural Engine | Noticeably worse than Whisper on far-field, multi-speaker, code-switched audio; punctuation only via `addsPunctuation` (iOS 16+); on-device language coverage is a subset and **Swedish must be verified per iOS version on a device** — not from a desk | Available iOS 16+. Long files are handled by chunking the file into requests; segment timestamps come back as `SFTranscriptionSegment`. |
| `SpeechAnalyzer` / `SpeechTranscriber` (iOS 26) | Free; model assets managed by the OS (`AssetInventory`); designed for long-form files | Apple's new engine — materially better than `SFSpeechRecognizer`, still to be measured against Whisper on real recordings | iOS 26+ only. The right on-device engine when it can be required. |

Decision: when Phase 4 happens, it is `SpeechAnalyzer` on iOS 26+ with `SFSpeechRecognizer` on-device as the fallback, behind a setting ("Transcribe on this iPhone"), writing the same `transcript.md` (`type: meeting-transcript`, segments in frontmatter — `render-transcript.ts`'s format, ported) and `transcription: { status: "done", device: "<iPhone>", engine }`. The Mac then skips the bundle, and its Re-run still works for anyone who wants Whisper's version. Adds `NSSpeechRecognitionUsageDescription`. The measurement that gates it: `pnpm compare:whisper`-style side-by-side over the same three real recordings (one Swedish), WER against a reference — the same discipline `docs/transcription-model-comparison.md` applied to the Mac's model choice.

## UI/UX

**Starting.** Long-press "+" anywhere → *New Recording*. Inside `Recordings/`, tap "+" records. First use asks for the microphone (the system prompt, preceded by nothing of ours — the string in the prompt is the explanation). Denied → a sheet that says recording needs the microphone, with an "Open Settings" action; the "+" entry stays but leads here until granted.

**Recording.** The `bottomCenter` island: red dot, `02:14`, pause/resume, stop. A faint level bar under the time so a muted mic is visible as a flat line. The island persists across folder navigation and into the Reader; the Listen button is disabled with "Recording in progress" while it is up. Screen lock: nothing of ours; iOS's red pill in the status bar / Dynamic Island. Interrupted-and-not-resumed: the island turns to `Paused — call ended · Resume`.

**Stopping.** Under 5 s → "Discard?" confirmation (accidental tap). Otherwise the island collapses, a brief "Saved to Recordings" toast, and the new row appears in `Recordings/` with its duration. No transcript yet: `Waiting for your Mac`.

**The recording row.** Waveform glyph (`waveform` SF symbol), title `Recording 2026-09-05 14-02-11`, subtitle `31 min · Waiting for your Mac`. States: waiting · transcribing on `<device>` · transcribed (`31 min · Transcribed`) · failed (`Transcription failed on Peter's Mac`). `ListenButton` ring on the right, same component as articles.

**The recording screen.** Title, date, duration. Transport: play/pause, −15 / +15, scrubber, rate. Below: the transcript (rendered markdown) or the status with one line of explanation ("Your Mac transcribes recordings when it syncs them in. Keep Notesage open on the Mac.").

**Mac.** The existing `TranscriptionCard`, with a `from Peter's iPhone` caption on bundles that carry a manifest with a device. Nothing else new to learn.

Design-system notes: neutral palette throughout; the only chroma is the recording dot (`--color-destructive` is the red we already have and it means "live", which is right). Islands use the native Liquid Glass style the chrome already uses (ADR 0009). Reduced motion: no level animation.

## Data Model

### `recording.json` (v1) — written by the phone, annotated by the Mac

```json
{
  "version": 1,
  "createdBy": { "device": "Peter's iPhone", "app": "notesage-ios", "appVersion": "0.57.0" },
  "startedAt": "2026-09-05T14:02:11+02:00",
  "durationSecs": 1834.2,
  "source": "microphone",
  "language": "sv",
  "audio": { "file": "audio.m4a", "bytes": 14703112, "codec": "aac", "sampleRate": 48000, "channels": 1, "bitrate": 64000 },
  "transcription": null
}
```

The Mac sets `transcription` to
`{ "status": "running" | "done" | "failed", "device": "Peter's Mac", "updatedAt": "…", "model"?: "large-v3-turbo-q5_0", "language"?: "sv", "error"?: "…" }`.
`durationSecs` is pause-aware. `bytes` is the size-match gate. `device` is the
same label the Inbox reading-progress sidecar records. Unknown fields are
preserved on rewrite (the phone and the Mac each own their half).

TypeScript (`src/lib/transcription/manifest.ts`, shared by desktop and phone):

```ts
export const RECORDING_MANIFEST = "recording.json";
export interface RecordingManifest {
  version: 1;
  createdBy: { device: string; app: "notesage-ios" | "notesage-macos"; appVersion: string };
  startedAt: string;            // ISO-8601 with offset
  durationSecs: number;
  source: "microphone";
  language?: string;            // one of SPEECH_LANGUAGES codes
  audio: { file: string; bytes: number; codec: "aac" | "pcm"; sampleRate: number; channels: number; bitrate?: number };
  transcription: TranscriptionStatus | null;
}
export interface TranscriptionStatus {
  status: "running" | "done" | "failed";
  device: string;
  updatedAt: string;
  model?: string;
  engine?: "whisper" | "apple-speech";   // Phase 4
  language?: string;
  error?: string;
}
export function parseRecordingManifest(json: string): RecordingManifest | null;
export function isPendingTranscription(m: RecordingManifest, transcriptExists: boolean): boolean;
```

Swift mirror: `RecordingManifest: Codable` in the plugin; a shared JSON fixture
is decoded by both a Swift test and a vitest test so the two cannot drift.

### `mobile-store` additions

```ts
recording: {
  status: "idle" | "recording" | "paused" | "finalizing";
  startedAt: number | null;
  elapsedSecs: number;
  level: number;                // 0..1, metered
  interrupted: boolean;         // paused by the system and not resumed
  micPermission: "unknown" | "granted" | "denied";
} // not persisted
audio: { relPath: string; playing: boolean; position: number; duration: number; rate: number } | null; // Phase 3, not persisted
```

### Commands (iOS surface; desktop stubs return the platform error)

| Command | Args | Returns |
| --- | --- | --- |
| `ios_recording_start` | `{ language?: string }` | `()` — first call may trigger the mic prompt; denied → `Err("microphone-denied")` |
| `ios_recording_pause` / `ios_recording_resume` | – | `()` |
| `ios_recording_stop` | – | `{ relPath: string, manifest: RecordingManifest }` — after finalize-into-library |
| `ios_recording_state` | – | `{ status, elapsedSecs, level, interrupted }` |
| `ios_recording_recover` | `{ action: "keep" \| "discard" }` | `{ relPath?: string }` — orphan handling at launch |
| `ios_audio_play` / `_pause` / `_seek` / `_stop` / `_state` / `_set_rate` | `{ relPath }` / – / `{ position }` / – / – / `{ rate }` | Phase 3 |

Desktop (macOS, `commands/sync.rs` or a sibling): `icloud_ensure_downloaded(path) -> "ready" | "downloading" | "failed"`, and `file_size(path) -> u64` for the size gate (verified: the desktop surface has only `path_exists` today; `sync.rs` has no download trigger).

### Events (Swift → JS `CustomEvent`)

`notesage:recording` — `tick {elapsedSecs, level}` · `paused` · `resumed` · `interrupted {reason}` · `route {reason}` · `finished {relPath, durationSecs, bytes}` · `error {message}`.
`notesage:audio` (Phase 3) — `progress {position, duration}` · `playing {playing}` · `finished`.

## Dependencies

- **Nothing new on the Mac's audio path.** #803's decoder (`symphonia` `aac`/`isomp4`, CoreAudio fallback) is the dependency, already shipped. Phase 0 adds a regression fixture so an `AVAudioRecorder`-shaped `.m4a` is locked in on the Mac.
- **AVFoundation + MediaPlayer** already link through the plugin's Swift package (`SpeechPlayer`).
- **`UIBackgroundModes: audio`** is already declared (`project.yml:63`, and appended by `integrate-share-extension.py:177-190`). It covers recording as well as playback; this PRD makes that explicit in the script's comment and in the App Review notes.
- **`NSMicrophoneUsageDescription`** reaches the built plist today only by accident (merged from the macOS-oriented `src-tauri/Info.plist`; not declared in `project.yml`). It becomes a deliberate declaration with copy written for the phone.
- **The parallel iCloud-container PRD** (`docs/prds/2026-09-05-icloud-container-library.md`). If the library becomes the app's ubiquity container, the only thing that changes here is the destination URL of the local-then-move; the staging design, the manifest and the Mac side are unaffected. Until then, recording into a security-scoped iCloud Drive folder works with the App Group grant alone — the reference entitlements' iCloud keys are not on the built target, and Phase 0 confirms coordinated writes into the granted folder are sufficient.
- **A running desktop app.** Discovery lives in the frontend (like every other transcription trigger); a Mac that is asleep or has Notesage closed catches up on launch. Stated plainly in the UI.

## Quality Gates

Outcome-shaped. Each is a scenario to run, not a file to inspect.

**Capture**

- [ ] Start a recording from the `Recordings/` folder in two taps; lock the phone; talk for 30 minutes; receive a phone call in the middle and decline it; unlock; stop. **One** bundle exists under `Recordings/` with `audio.m4a` and `recording.json`; the duration excludes the call; the audio is continuous either side of it; the file is ~15 MB.
- [ ] Same, but answer the call and hang up after two minutes. The island shows *Paused — call ended · Resume*; nothing resumed on its own; resuming continues into the same file.
- [ ] Record with AirPods, take one out, continue. The recording does not stop and the tail is audible from the built-in mic.
- [ ] Force-quit the app mid-recording. On next launch the app offers to recover or discard the orphan; it never silently produces a zero-length bundle in the library, and never silently loses a recoverable one.
- [ ] Record under 5 s and stop → asked to discard; discard leaves nothing in the library.
- [ ] Deny the microphone permission → clear explanation with *Open Settings*; grant it there → recording works without restarting the app.
- [ ] No microphone access is requested before the first *New Recording* tap (fresh install: the prompt never appears during onboarding, browsing, reading or listening).
- [ ] Listening to an article while recording is refused with a reason; starting a recording while listening stops the article cleanly.

**Handoff**

- [ ] With Notesage open on the Mac and iCloud in sync, a bundle recorded on the phone is transcribed **without any action on the Mac**; `transcript.md` appears beside the audio; the phone's row flips to *Transcribed* and the transcript renders on the recording screen.
- [ ] With the Mac asleep during three phone recordings, waking it transcribes all three, one after another, in the order they were recorded; the Activity panel shows three cards, each captioned *from Peter's iPhone*.
- [ ] Kill iCloud sync half-way through a large upload (airplane mode on the phone right after stop). The Mac does not start transcribing a partial file; it starts once the size matches.
- [ ] A bundle with a corrupt `audio.m4a` fails once, is marked `failed` in the manifest with the error, shows *Transcription failed on Peter's Mac* on the phone, and is **not** retried on the next Mac launch; Re-run on the card retries it.
- [ ] A Mac-recorded bundle (WAV, no manifest) is untouched by the scanner and behaves exactly as before.
- [ ] "Move to project" on the Mac moves audio, manifest and transcript together; the phone shows the recording inside the project.
- [ ] Two devices recording at the same second produce two bundles (`-1` suffix), both transcribed.

**Playback**

- [ ] Play a recording, lock the phone: the lock screen shows the title, elapsed and total time, and play/pause and ±15 s work from there. Unplugging headphones pauses.
- [ ] Playback position survives leaving and re-opening the recording screen within the session.

**Platform / store**

- [ ] `NSMicrophoneUsageDescription` is declared in `project.yml` with the phone copy; regenerating the Xcode project keeps it. `UIBackgroundModes` still contains `audio`.
- [ ] The App Store privacy label is unchanged (*Data Not Collected*): no audio, transcript or manifest ever leaves the device except through the user's own iCloud Drive; the `telemetry_crates_are_gated_off_the_ios_target` lock still holds.
- [ ] `docs/features/mobile.md` § Permissions no longer claims no microphone key is declared; § Architecture no longer claims there is no write command.

**Engineering**

- [ ] `pnpm typecheck`, `pnpm test`, `cargo test` green; the iOS Simulator Build job green.
- [ ] A 2-second `AVAudioRecorder`-produced `.m4a` fixture decodes in `cargo test` on macOS (symphonia or CoreAudio — the test asserts *decodable*, and records which, so the #803 telemetry question stays answerable).
- [ ] Vitest covers: manifest parse/validate/round-trip; `isPendingTranscription`; the scanner's skip rules (transcript exists · running elsewhere · already tracked · size mismatch); FIFO one-at-a-time dispatch; failure write-back. Swift unit tests cover the manifest `Codable` against the shared fixture and the stamp formatter.
- [ ] Verified on a device (not only the simulator) for every capture gate above, per the "verify in the simulator, then the device, before the build" rule; a *What to Test* history entry accompanies the TestFlight build.

## Out of Scope

- **Moving the Mac's own recorder into the synced library.** Today it writes `~/Notesage/Recordings` (`dirs::home_dir()`), which equals `<library root>/Recordings` only when iCloud sync is off. Making Mac recordings reach the phone means recording WAV into iCloud Drive — the same thrash problem the phone avoids with local-then-move — so it needs the same design applied to `transcription.rs`, plus the desktop's `start_recording` learning the library root. A follow-up PRD; the manifest this PRD introduces is written on the Mac side already so that follow-up is small.
- **On-device transcription** — Phase 4 in the tasks file, explicitly optional and gated on the measurement described above.
- **Live Activity / Dynamic Island** for the running recording.
- **Per-recording language picker on the phone**, speaker naming, editing the transcript on the phone beyond what the note editor already does.
- **Transcribing shared audio files that are not recordings** (a Voice Memo shared into `Inbox/`). The scanner is deliberately scoped to `Recording *` bundles with a manifest; extending it to loose audio in the Inbox is a separate, smaller change once this contract exists.
- **Android.** No Android app.
