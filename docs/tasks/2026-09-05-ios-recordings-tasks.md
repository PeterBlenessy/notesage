# Tasks: Recordings on iOS

|  |  |
| --- | --- |
| **Date** | 2026-09-05 |
| **Status** | Not started |
| **PRD** | [ios-recordings](../prds/2026-09-05-ios-recordings.md) |
| **Total** | 29 tasks: 8S, 13M, 8L |
| **Suggested order** | Phase 0 spike (#1–#2) → Phase 1 capture (#3–#11) → Phase 2 Mac handoff (#12–#19) → Phase 3 playback (#20–#25) → docs + build (#26–#27) → Phase 4 optional on-device (#28–#29) |

Legend: ✅ done · 🚧 in progress · (blank) pending.
Categories: `native` (Swift plugin) · `backend` (Rust) · `frontend` (React/TS) · `both` · `docs`.

Phases 1–3 each ship on their own TestFlight build — capture alone is already
useful (a bundle the Mac can transcribe by dropping it on the card's Re-run),
and each build gets its own *What to Test* entry. Phase 4 is optional and gated
on a measurement, not on a date.

## Risks and open questions

1. **Background survival under Tauri.** `SpeechPlayer` proves the process
   stays alive with `.playback` + the `audio` background mode. Recording uses
   the same mode, but the WKWebView and the JS timers are suspended while the
   screen is locked — everything that must keep running (the recorder, the
   tick, the interruption observers) has to be native. #1 confirms this before
   any UI exists.
2. **Coordinated copy into a security-scoped iCloud Drive folder** from the
   app's own container. `LibraryAccess` writes text this way today; a 30 MB
   copy is the same call. #1 verifies with a real 30-minute file.
3. **`AVAudioRecorder`'s `.m4a` on the Mac.** #803 decodes AAC via symphonia
   with CoreAudio as fallback. The phone's specific encoder output is not
   fixture-tested yet; #2 locks it.
4. **`UIDevice.name`** returns a generic "iPhone" on iOS 16+ without the
   user-assigned-device-name entitlement. Use the same device label the Inbox
   reading-progress sidecar already writes (`"device": "Peter's iPhone"`), and
   fall back to the model name — do not add the entitlement for a caption.
5. **Two Macs.** If two desktops watch the same library, both may claim a
   bundle. The `running` claim in the manifest plus the "skip if running
   elsewhere within the hour" rule reduces this to a race of seconds; the
   loser's `writeTranscriptToBundle` overwrites an identical transcript. Not
   worth a lock file; documented, not solved.
6. **The parallel iCloud-container PRD** may change the library root's URL on
   the phone. #5's destination is a single `URL` argument, so the change is
   local if it comes.

---

## Phase 0 — Resolve the load-bearing unknowns

### #1 — Spike: background recording + local-then-move on a device

**Complexity:** L · **Category:** native · **Depends on:** — · **Files:** throw-away branch; findings recorded at the top of this file

A minimal `AVAudioRecorder` in the plugin, started from a debug menu entry, with `.playAndRecord` / `[.allowBluetooth, .defaultToSpeaker]` and the existing `audio` background mode. Lock the phone for 30 minutes; decline a call; answer one; pull an AirPod. Then copy the resulting file into the granted library folder via `NSFileCoordinator` `.forReplacing` and confirm it appears on the Mac whole (size stable, decodable). Record: whether the process survived, what the interruption sequence looked like, copy time for ~15 MB, and the exact `AVAudioRecorder` settings that produced ~64 kbps mono. Acceptance: a written answer to risks 1 and 2 above, and a 2-second `.m4a` cut from the spike for #2.

### #2 — Regression fixture: an iPhone-recorded `.m4a` decodes on the Mac

**Complexity:** S · **Category:** backend · **Depends on:** #1 · **Files:** `src-tauri/src/commands/audio_decode.rs` (tests), `tests/fixtures/audio/iphone-aac-2s.m4a`

Add the fixture and a `cargo test` that calls `decode_audio_f32` on it, asserts sample count ≈ 2 s × rate, and asserts the `Decoder` that ran (either is acceptable; the assertion records which so the #803 question "does symphonia's AAC carry its weight" has an answer in CI). Follows the shape of `wav_round_trips_through_writer_and_reader` (`transcription.rs`).

---

## Phase 1 — Capture on the phone

### #3 — `Recorder.swift`: the native recorder

**Complexity:** L · **Category:** native · **Depends on:** #1 · **Files:** `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/Recorder.swift` (new)

Singleton modelled on `SpeechPlayer.swift`. `AVAudioRecorder` (AAC-LC, 48 kHz, mono, 64 kbps, metering on) writing to `<Application Support>/Recordings/<uuid>/audio.m4a`. `requestRecordPermission` on first start with a distinct `microphoneDenied` error. Observers: `interruptionNotification` (pause; resume only on `.shouldResume`, else mark `interrupted`), `routeChangeNotification` (`.oldDeviceUnavailable` → keep recording, emit `route`), `mediaServicesWereResetNotification` (stop + finalize what exists). 1 Hz tick with pause-aware `currentTime` and metered level. Free-space check (< 200 MB → refuse). Public surface: `start(language:)`, `pause()`, `resume()`, `stop() -> StagedRecording { url, durationSecs, startedAt, bytes }`, `state`, plus `onEvent` callbacks. Swift unit tests for the settings dictionary and the stamp formatter (`Recording yyyy-MM-dd HH-mm-ss`, local time, matching `transcription.rs:730`).

### #4 — Audio-session arbiter

**Complexity:** M · **Category:** native · **Depends on:** #3 · **Files:** `…/ios/Sources/AudioOwner.swift` (new), `SpeechPlayer.swift`, `Recorder.swift`

One `AudioOwner` (`none | speech | recording | player`) that owns `setCategory` / `setActive`. Starting an owner stops the previous one explicitly; `SpeechPlayer.stop()` stops calling `setActive(false)` itself (today it deactivates unconditionally, which would end a recording). `speechStart` while recording returns `Err("recording-in-progress")`; `recordingStart` while speaking stops speech first. Tests: the state machine is a pure enum transition table — unit-test it.

### #5 — `LibraryAccess.finalizeRecording` + manifest write

**Complexity:** M · **Category:** native · **Depends on:** #3 · **Files:** `…/ios/Sources/LibraryAccess.swift`, `…/ios/Sources/RecordingManifest.swift` (new), `tests/fixtures/recording-manifest.v1.json` (shared with #12)

Inside the security scope: `createDirectory("Recordings/Recording <stamp>")` with the existing `deduped(_:under:)`; coordinated `.forReplacing` copy of `audio.m4a` from the staging folder; write `recording.json` (`RecordingManifest: Codable`, `transcription: null`, `createdBy.device` = the label the reading-progress sidecar uses, `audio.bytes` from the file on disk *after* the copy); delete the staging folder only after both writes succeed. Returns the final rel path + manifest. Swift test decodes and re-encodes the shared fixture byte-for-byte (key order fixed) so #12's TS parser and this cannot drift.

### #6 — Rust bridge: `ios_recording_*` commands

**Complexity:** M · **Category:** backend · **Depends on:** #3, #5 · **Files:** `src-tauri/crates/tauri-plugin-notesage-ios/src/lib.rs`, `…/ios/Sources/NotesageIosPlugin.swift`, `src-tauri/src/commands/ios_library.rs`, `src-tauri/src/lib.rs` (both `generate_handler!` lists), `docs/tauri-commands.md`

`ios_recording_start { language? }`, `_pause`, `_resume`, `_stop -> { relPath, manifest }`, `_state`, `_recover { action }`. Same shape as the `ios_speech_*` set: Rust command → `self.call("recordingStart", …)` → Swift method. Desktop list registers the same names returning the platform error (the existing `transcription_stub.rs` idiom). Events pushed as `notesage:recording` `CustomEvent`s via `evaluateJavaScript`, the way `emitSpeech` does. Rust unit test: the non-iOS stubs return `Err`.

### #7 — `ios-api.ts` + `mobile-store.recording` + event subscriber

**Complexity:** M · **Category:** frontend · **Depends on:** #6 · **Files:** `src/lib/ios-api.ts`, `src/stores/mobile-store.ts`, `src/lib/recording-controller.ts` (new, sibling of `speech-controller.ts`), `src/MobileApp.tsx`

Wrappers for the six commands; the non-persisted `recording` slice (`status`, `startedAt`, `elapsedSecs`, `level`, `interrupted`, `micPermission`); `startRecordingEvents()` mounted beside `startSpeechEvents()`; `startRecording()` / `pauseRecording()` / `resumeRecording()` / `stopRecording()` that map the `microphone-denied` and `recording-in-progress` errors to the store. `stopRecording` under 5 s asks to discard (calls `ios_recording_recover { discard }` on the staged file — same primitive as #9). Vitest with the Tauri mock: state transitions for every event, the < 5 s discard path, the denied path.

### #8 — Chrome: the entry points and the recording island

**Complexity:** L · **Category:** both · **Depends on:** #7 · **Files:** `src/components/mobile/LibraryBrowser.tsx`, `src/components/mobile/Reader.tsx`, `src/components/mobile/Chrome.tsx`, `src/components/mobile/useNativeChrome.ts`, `…/ios/Sources/ChromeOverlay.swift`, `src/i18n/*`

"+" long-press menu gains `create-recording` (`waveform.badge.plus`) at root and in folders; inside `Recordings/` the primary "+" action becomes record and the menu offers New Note / New Folder. New `IosChromeRecorder` `bottomCenter` spec (`{ elapsedSecs, paused, level, interrupted }`, ids `rec-toggle`, `rec-stop`) rendered natively next to `IosChromePlayer`, with the `Chrome.tsx` web fallback; shown in browser *and* Reader while `recording.status !== "idle"`. Interrupted-and-not-resumed renders `Paused — call ended · Resume`. `ListenButton` disabled with a reason while recording. Reduced motion: no level animation. Component tests for the menu composition per folder and the island's four states; a design review against ADR 0009's island style.

### #9 — Orphan recovery at launch

**Complexity:** M · **Category:** both · **Depends on:** #5, #6, #7 · **Files:** `Recorder.swift`, `LibraryAccess.swift`, `src/MobileApp.tsx`, `src/components/mobile/RecoverRecordingSheet.tsx` (new)

On launch, the plugin reports any staging folder left behind (`ios_recording_state` returns `orphan: { durationSecs?, readable }` — readable = `AVAudioFile` opens it). The sheet offers *Recover* (→ #5 finalize, with the duration read from the file) or *Discard*. Never auto-decides. Test: a fabricated staging folder with a readable file recovers into the library; an unreadable one is discardable and the UI says why.

### #10 — Microphone permission: declare it on purpose

**Complexity:** S · **Category:** both · **Depends on:** — · **Files:** `src-tauri/gen/apple/project.yml`, `src-tauri/ios/integrate-share-extension.py`, `src-tauri/Info.plist`

`NSMicrophoneUsageDescription` declared in `project.yml` with phone copy ("Notesage records meetings and voice notes you start yourself. Recordings stay in your library."). Today the key arrives only by accident from the macOS-oriented `src-tauri/Info.plist`. Extend the integrate script's `UIBackgroundModes: audio` comment to say it covers recording. Acceptance: a regenerated Xcode project (`tauri ios init --ci`) still carries both keys — add the check to the existing iOS CI job's post-init assertions if it has them, else a `grep` step.

### #11 — Phase 1 verification on device + *What to Test*

**Complexity:** M · **Category:** docs · **Depends on:** #3–#10 · **Files:** `docs/history/<n>-ios-build-<m>.md`

Run every *Capture* gate in the PRD on a device (lock, decline, answer, AirPod, force-quit, < 5 s, deny → Settings → grant, listen-while-recording). Each result written down, including the ones that failed and were fixed. The TestFlight build ships from this task, not before it.

---

## Phase 2 — The Mac picks it up

### #12 — `manifest.ts`: the `recording.json` contract in TypeScript

**Complexity:** S · **Category:** frontend · **Depends on:** — (fixture shared with #5) · **Files:** `src/lib/transcription/manifest.ts` (new), `src/lib/transcription/__tests__/manifest.test.ts`, `tests/fixtures/recording-manifest.v1.json`

`RECORDING_MANIFEST`, `RecordingManifest`, `TranscriptionStatus`, `parseRecordingManifest` (tolerant: unknown fields preserved, wrong `version` → `null`), `serializeRecordingManifest` (stable key order), `isPendingTranscription(manifest, transcriptExists)`, `withTranscriptionStatus(manifest, status)`. Tests round-trip the shared fixture and cover every rejection.

### #13 — `recordingsDir(root)` + the Mac's own bundles get a manifest

**Complexity:** S · **Category:** frontend · **Depends on:** #12 · **Files:** `src/lib/notes-root.ts`, `src/lib/transcription/bundle.ts`, `src/hooks/useMeetingRecording.ts`

`recordingsDir(root)` beside `inboxDir`. After `stop_recording` on the Mac, `useMeetingRecording` writes a `recording.json` (`createdBy.app: "notesage-macos"`, `codec: "pcm"`, bytes from the `RecordingResult`) into the bundle before dispatching `startTranscription` — so the format is bilateral and the scanner treats Mac and phone bundles by one rule. Also fix the `Meeting <stamp>` comment drift in `bundle.ts:9`. Tests: the manifest is written with the expected fields.

### #14 — Desktop commands: `file_size` and `icloud_ensure_downloaded`

**Complexity:** M · **Category:** backend · **Depends on:** — · **Files:** `src-tauri/src/commands/file.rs`, `src-tauri/src/commands/sync.rs`, `src-tauri/src/lib.rs`, `src/lib/tauri.ts`, `docs/tauri-commands.md`

`file_size(path) -> u64` — verified: the desktop surface has only `path_exists`; there is no stat/size command to reuse. `icloud_ensure_downloaded(path) -> "ready" | "downloading" | "failed"` on macOS: detect the `.<name>.icloud` placeholder, call `NSFileManager.startDownloadingUbiquitousItem(at:)` via `objc2-foundation` (already a dependency), report state; non-macOS returns `"ready"` when the file exists. Rust tests for placeholder-name detection; the download call itself is verified in #19's device pass.

### #15 — `useRecordingsInbox`: scan, watch, gate, queue, claim

**Complexity:** L · **Category:** frontend · **Depends on:** #12, #13, #14 · **Files:** `src/hooks/useRecordingsInbox.ts` (new), `src/App.tsx` (mount it — a hook that is not mounted never runs), `src/hooks/useFileWatcher.ts` (no change expected; verify the events reach the new hook)

On `startupReady`: list `recordingsDir(root)` (`icloudNotesagePath ?? resolveNotesRoot(...)`), evaluate every `Recording *` directory. Subscribe to `file-changed-batch`; re-evaluate any bundle a `create`/`modify` under `Recordings/` touches (debounced per bundle, 2 s). Eligibility: manifest parses · no `transcript.md` · `transcription.status` not `running` on another device within 60 min · not `done` · not `failed` · not already tracked in `activity-store` by `audioPath` · `file_size(audio) === manifest.audio.bytes` (placeholder → `icloud_ensure_downloaded`, then wait for the next event). Eligible bundles enter a FIFO; one `startTranscription({ audioPath, recordingStartedAt: Date.parse(startedAt), recordingDurationSecs, language })` at a time, the next dispatched when the activity item leaves `running`. Claim = write `running` (with the Mac's device name) before dispatch; `done` / `failed` written from the activity transition. Pure helpers (`evaluateBundle`, `nextEligible`) exported for tests.

### #16 — Scanner tests

**Complexity:** M · **Category:** frontend · **Depends on:** #15 · **Files:** `src/hooks/__tests__/useRecordingsInbox.test.ts`

With the Tauri mock: startup scan finds two pending, one done, one Mac WAV bundle without a manifest (ignored — until #13 writes one; assert both before/after) → exactly two jobs, in stamp order, never concurrently; size mismatch defers and a later `modify` event with a matching size dispatches; `running` elsewhere < 60 min skips, > 60 min reclaims; `failed` is skipped on rescan; the manifest's `transcription` field is written at claim, done and failure with the device name; hook unmount clears listeners.

### #17 — `TranscriptionCard`: provenance caption + container-agnostic paths

**Complexity:** S · **Category:** frontend · **Depends on:** #15 · **Files:** `src/components/activity/cards/TranscriptionCard.tsx`, `src/stores/activity-store.ts`, `src/lib/transcription/bundle.ts`

`AgentTask` gains optional `sourceDevice`; the card shows `from Peter's iPhone`. Audit `transcriptPathForAudio` / `moveBundleToProject` / the card's `movedAudio` reconstruction for `audio.m4a` (they take `dirname` / `basename`, so they should already work — the test proves it). "Move to project" moves `recording.json` along with the rest (it does, being folder-level — assert it).

### #18 — Docs for the desktop side

**Complexity:** S · **Category:** docs · **Depends on:** #15 · **Files:** `docs/features/ai-workflows.md` (Meeting Recording section: the manifest, the pending rule, discovery), `docs/features/inbox.md` (a sentence: `Recordings/` follows the same root rule), `docs/architecture.md` (hook + store field), `docs/tauri-commands.md`

### #19 — Phase 2 verification: phone → Mac end to end

**Complexity:** M · **Category:** docs · **Depends on:** #11, #15–#17 · **Files:** `docs/history/<n>-ios-build-<m>.md`

Run the *Handoff* gates: Mac open and synced; Mac asleep through three recordings; airplane mode right after stop (partial upload); a deliberately corrupt `audio.m4a`; a pre-existing Mac WAV bundle; Move to project; same-second collision from two devices. Results in the history entry.

---

## Phase 3 — Playback and the recording screen on the phone

### #20 — `AudioPlayer.swift`

**Complexity:** L · **Category:** native · **Depends on:** #4 · **Files:** `…/ios/Sources/AudioPlayer.swift` (new), `AudioOwner.swift`

`AVAudioPlayer` over a coordinated temp copy of the library file (the `copyForSharing` pattern `quickLook` uses). Through the arbiter: `.playback` / `.spokenAudio`. `MPNowPlayingInfoCenter` with real elapsed / duration; remote commands play, pause, `skipForward(15)`, `skipBackward(15)`, `changePlaybackPosition`; rate 0.8–2.0 via `enableRate`. Interruption auto-pause; `routeChangeNotification` `.oldDeviceUnavailable` → pause. Events `notesage:audio` (`progress`, `playing`, `finished`). Temp copy removed on stop.

### #21 — Rust bridge: `ios_audio_*` commands + `ios-api.ts` + store

**Complexity:** M · **Category:** both · **Depends on:** #20 · **Files:** plugin `lib.rs`, `NotesageIosPlugin.swift`, `ios_library.rs`, `src-tauri/src/lib.rs`, `src/lib/ios-api.ts`, `src/stores/mobile-store.ts` (`audio` slice), `src/lib/audio-controller.ts` (new)

`ios_audio_play { relPath }`, `_pause`, `_seek { position }`, `_stop`, `_state`, `_set_rate { rate }`; desktop stubs; store slice + `startAudioEvents()`. Playback position kept per rel path in memory for the session. Tests mirror #7.

### #22 — Recording bundles as items in the browser

**Complexity:** M · **Category:** frontend · **Depends on:** #12, #21 · **Files:** `src/components/mobile/LibraryBrowser.tsx`, `src/components/mobile/FileRow.tsx`, `src/components/mobile/RecordingRow.tsx` (new), `src/components/mobile/ListenButton.tsx`, `src/components/mobile/GalleryCard.tsx`

A directory named `Recording *` renders as `RecordingRow`: `waveform` glyph, title, `31 min · <status>` from a lazily read `recording.json` (cached per path, refreshed on foreground and on folder re-entry), `ListenButton` ring bound to the `audio` slice. Status text: `Waiting for your Mac` · `Transcribing on <device>…` · `Transcribed` · `Transcription failed on <device>`. If the manifest cannot be read, fall back to the plain folder row. `onActivate` opens the Recording screen instead of pushing the folder. Gallery card variant. Tests: every status string, the fallback, and that `Recordings/` sorts by stamp descending under the date grouping.

### #23 — The Recording screen in the Reader

**Complexity:** L · **Category:** frontend · **Depends on:** #21, #22 · **Files:** `src/components/mobile/Reader.tsx` (`kind: "recording"` branch), `src/components/mobile/RecordingScreen.tsx` (new), `src/components/mobile/useNativeChrome.ts`

Title / date / duration; transport bound to `IosChromePlayer` (reuse — same ids, position/duration in seconds instead of paragraphs) with scrubber, ±15 s, rate; below, `transcript.md` rendered through the existing markdown path when present, else the status with the one-line explanation. Re-reads manifest + transcript on appear and `visibilitychange`. Tests: the three states, the re-read on foreground, and that a `type: meeting-transcript` note renders with its heading and paragraphs (segments in frontmatter stay hidden, as on the Mac).

### #24 — Mutual exclusion in the UI

**Complexity:** S · **Category:** frontend · **Depends on:** #8, #23 · **Files:** `src/lib/speech-controller.ts`, `src/lib/audio-controller.ts`, `src/lib/recording-controller.ts`

Starting playback stops speech and vice versa (the arbiter enforces it natively; the JS state must follow the events, not assume). Recording disables both with a reason. Tests: the event sequences leave exactly one owner in the store.

### #25 — Phase 3 verification on device + *What to Test*

**Complexity:** M · **Category:** docs · **Depends on:** #20–#24 · **Files:** `docs/history/<n>-ios-build-<m>.md`

Lock-screen controls with correct title/elapsed/total; ±15 s from the lock screen; headphone unplug pauses; position survives leaving and reopening; the transcript appears on the screen after the Mac finishes without restarting the app. Every view × state screenshotted on a seeded `Recordings/` folder.

---

## Docs and store readiness

### #26 — `docs/features/mobile.md` + App Review notes

**Complexity:** M · **Category:** docs · **Depends on:** #11 · **Files:** `docs/features/mobile.md`, `docs/history/…`, App Store Connect review notes (text kept in the history entry)

New "Recordings" section: the flow, the audio session, the manifest, the pending rule, playback, the mutual exclusion, and the known limits (Mac must be running; no Live Activity). Correct § Permissions (a microphone key *is* declared, and why) and § Architecture (write commands exist since #586). App Review notes: recording is user-initiated only, never starts in the background, the `audio` background mode covers playback and an in-progress recording, audio never leaves the device except via the user's own iCloud Drive; privacy label unchanged.

### #27 — Cross-doc sync

**Complexity:** S · **Category:** docs · **Depends on:** #18, #26 · **Files:** `docs/product-description.md` (Mobile row + roadmap entry), `docs/keyboard-shortcuts.md` (no change — verify), `docs/prds/README.md` (no change)

---

## Phase 4 — On-device transcription (optional; gated on #28's measurement)

### #28 — Measure before building: Apple speech engines vs Whisper on real recordings

**Complexity:** L · **Category:** native · **Depends on:** #25 · **Files:** `docs/research/2026-xx-xx-ios-on-device-transcription.md` (new), a throw-away harness in the plugin

Three real recordings (one Swedish, one far-field meeting, one clean voice note) with reference transcripts. Run `SFSpeechRecognizer` (`requiresOnDeviceRecognition`, `addsPunctuation`, chunked) on the oldest supported iOS, and `SpeechAnalyzer` / `SpeechTranscriber` on iOS 26, against the Mac's `large-v3-turbo-q5_0` (`pnpm compare:whisper` already reports WER). Record WER, wall time, battery/thermal state, and **whether Swedish is available on-device** per iOS version — on a device, not from a desk. The write-up ends with a go / no-go and, if go, the minimum iOS version it is worth shipping for. This is the same discipline `docs/transcription-model-comparison.md` applied to the Mac.

### #29 — Opt-in on-device transcription

**Complexity:** L · **Category:** both · **Depends on:** #28 (go) · **Files:** `…/ios/Sources/OnDeviceTranscriber.swift` (new), `ios_library.rs`, `src/lib/transcription/render-transcript.ts` (share, do not fork), `src/stores/mobile-store.ts`, `src-tauri/gen/apple/project.yml` (`NSSpeechRecognitionUsageDescription`), `docs/features/mobile.md`

Setting "Transcribe on this iPhone" (default off). After finalize, run the chosen engine in the background (`.utility` QoS, same scheduling discipline as the image sweep), write `transcript.md` with `render-transcript.ts`'s format and `transcription: { status: "done", device, engine: "apple-speech" }`. The Mac then skips the bundle; its Re-run still produces Whisper's version on request. Progress on the recording row. Tests: the manifest status, the transcript format parity with the Mac's renderer over the same segments, the setting default.
