# CONTRACT-NOTE: agent `control` (frontend: start / watch / stop a recording, Settings → Transcription)

Status: written early (design); "As implemented" at the bottom is updated before I finish.

## What `library` can call

### `src/hooks/useMeetingRecording.ts` (plain functions, no hook needed, safe from anywhere)
- `toggleMeetingRecording(): Promise<void>`: start when idle, stop-and-save when recording or paused. Ignored (no toast, no second item) while `starting` or `stopping`.
- `startMeetingRecording(opts?: { source?: RecordingSource }): Promise<boolean>`: `true` when capture began. Source defaults to `useRecordingStore.getState().lastUsedSource`.
- `stopMeetingRecording(): Promise<void>`: stop → manifest → finalize into the library → queue transcription.
- `togglePauseMeetingRecording(): Promise<void>`
- `discardMeetingRecording(): Promise<void>`: NO confirmation inside; `requestDiscardMeetingRecording()` opens my confirm dialog (AlertDialog, mounted with the indicator).
- `useMeetingRecording()` hook (unchanged shape plus `phase`, `source`): `{ toggleRecording, pauseRecording, resumeRecording, isRecording, isPaused, elapsedTime, phase, source }`.

### `src/stores/recording-store.ts` (`useRecordingStore`), selectors
- `s.phase`: `"idle" | "starting" | "recording" | "paused" | "stopping"`
- `s.isRecording` (true for recording AND paused, as before), `s.isPaused`
- `s.recordingSource`: `"microphone" | "system" | "both"` (the live recording's source)
- `s.lastUsedSource` (persisted): the source the NEXT recording uses; the orb-panel picker and Settings → Transcription both edit it via `setLastUsedSource(source)`.
- `s.recordedSeconds`: integer seconds of RECORDED time (from `get_recording_state`), for display.
- `s.speechLanguage` (persisted): now also updated to the language picked on the live recording card when that recording stops (last used = next default).
- REMOVED (dead): `transcriptionProgress`, `setTranscriptionProgress`.
- `activeDownloads[model]`: `{ progress: number /* integer percent */, downloadedBytes?, totalBytes?, bytesPerSec?, etaSecs? }`.

### `src/lib/recording-time.ts`
- `formatRecordedTime(seconds: number): string`: THE timer format: `mm:ss`, `h:mm:ss` from one hour. (`formatStopwatchMs(ms)` kept, now delegating to it.)

### Events I dispatch on `window`
- none new for `library`. I call `useRecordingsStore.getState().refresh?.()` (falls back to `load?.()`) after `finalize_recording_bundle`, and `openRecordings()` from the "Open Recordings" toast action.

### i18n keys `library` may reuse (all under `recording.*`)
`recording.start`, `recording.stop`, `recording.stopAndSave`, `recording.pause`, `recording.resume`, `recording.discard`,
`recording.source.microphone`, `recording.source.system`, `recording.source.both`, `recording.state.recording`, `recording.state.paused`, `recording.state.saving`.

## What I pass to `library` code
- `writeRecordingManifest(stagingBundleDir, manifest)` with the manifest built by `createMacRecordingManifest(...)` and then spread with `source`, `tracks: [{ role, file }]` (basenames), `audio.codec` (`aac` for `.m4a`, else `pcm`), `language`. Works with today's helper and with `library`'s extended one. NOTE: for `source` other than `"microphone"` the parser must accept it (library's note says it will).
- `startTranscription({ audioPath, recordingStartedAt, recordingStoppedAt, recordingDurationSecs, language, documentId, tracks })`:
  `tracks` only for source `both`, only roles `mic`/`system`, ABSOLUTE final paths (after finalize). `documentId` = the active markdown tab id when recording started (U12).
- If NO transcription model is downloaded at stop, I do NOT call `startTranscription`: I show "Recording saved … download a model to transcribe it" with a Download action (Settings → Transcription). The bundle is in the library with `transcription: null`, so the scanner / the Recordings row can transcribe it later.

## Backend shapes I code against (frontend arg names; camelCase args → snake_case in Rust)
- `recording_preflight({ source })` → `{ microphone, system_audio, input_device, output_device, free_bytes }` (snake_case).
- `start_recording({ source })`; `pause_recording()`; `resume_recording()`; `discard_recording()`.
- `stop_recording()` → `{ bundle_dir, audio_path, tracks: [{ role, path }], duration_secs, peak, sample_rate, dropped_frames, warnings }`. I also accept the pre-contract `{ path }` (then `audio_path = path`, `bundle_dir = dirname(path)`).
- `finalize_recording_bundle({ stagingDir, destRecordingsDir })` → `{ bundle_dir, audio_path, tracks: [{ role, path }] }`.
- `recover_orphan_recordings()` → `[{ bundle_dir, audio_path, tracks, duration_secs, started_at }]`. I call it once after startup, and NOT when `get_recording_state().recording` is true (a webview reload mid-recording): I assume it never returns the bundle of a capture that is live.
- `get_recording_state()` → `{ recording, paused, source, started_at_ms, elapsed_recorded_ms }`, polled every 500 ms while recording (falls back to a local pause-aware clock if the command rejects).
- Events: `recording-level` `{ mic, system }`; `recording-warning` `{ kind, message, fatal }`. OPTIONAL extra I use when present: `source: "microphone" | "system"` on a `silence` warning (to name the silent source for `both`; without it I look for "system"/"microphone" in `message`).

## REQUEST to `capture` (optional; not in the CONTRACT; the frontend works without it)
Window close / quit while recording (U11). The webview cannot veto a close without `core:window:allow-destroy`, and cannot see ⌘Q at all. If the Rust close/exit handler, while a capture is live, does `api.prevent_close()` / `api.prevent_exit()` and emits `recording-close-requested` (payload `{ quitting: boolean }`), I show "A recording is in progress" [Stop and save] [Keep recording]. After Stop and save completes I emit the Tauri event `recording-close-confirmed` (same payload); the backend should then close/quit. Without this hook: with close-to-tray ON the window just hides (as today); otherwise the app exits, the backend finalises (CONTRACT) and recovery runs at next launch.
