# CONTRACT-NOTE: agent `capture` (Rust capture side)

Status: FINAL (kept in step with the code; see "Deviations" at the end).

Code lives in `src-tauri/src/commands/recording/` (new). Managed state is `RecordingState`
(separate from `TranscriptionState`, which no longer has anything to do with capture).
On iOS the same command names are stubbed in `transcription_stub.rs` and return
`"Recording and transcription are not available on this platform"`.

## Serde / IPC conventions

- Every struct crossing IPC is **snake_case** (no `rename_all`), the same as the existing
  `RecordingResult` (`duration_secs`, `sample_rate`). Event payloads too.
- Command ARGUMENTS follow Tauri's default: JS passes camelCase (`stagingDir`,
  `destRecordingsDir`, `bundleDir`), Rust receives snake_case.
- All commands are `async` and return `Result<T, String>`.

## Commands

### `recording_preflight(source: string)`
```
{ microphone: "granted" | "denied" | "undetermined" | "unknown",
  system_audio: "available" | "unsupported" | "unknown",
  input_device: string | null,      // default input device name
  output_device: string | null,     // default output device name
  free_bytes: number }              // free bytes on the staging volume (0 if it cannot be read)
```
- Never prompts. `microphone`: `AVCaptureDevice.authorizationStatus(for: .audio)` on macOS
  ("restricted" is reported as `"denied"`); `"unknown"` elsewhere or if the class cannot be reached.
- `system_audio` is NEVER `"denied"` from preflight: macOS has no public API to read the
  "System Audio Recording" permission. `"available"` = macOS 14.2+, `"unsupported"` = older macOS
  or not macOS, `"unknown"` = OS version unreadable. A denied permission shows up only as SILENCE
  on the system track (see `recording-warning` `silence`, and `track_peaks.system` in the stop result).
- `source` is accepted for symmetry; an unknown value is an error (`Unknown recording source: <x>`).

### `start_recording(source: "microphone" | "system" | "both") -> null`
Unchanged result shape (`Ok(())`). Records into `~/.notesage/recordings-staging/Recording YYYY-MM-DD HH-MM-SS/`.
Error strings (exact, or exact prefix where noted):
| string | when |
| --- | --- |
| `Recording already in progress` | a recording is active, starting, or a stop is still tearing down |
| `Unknown recording source: <x>` | (prefix) |
| `No microphone available` | no default input device |
| `Microphone access is denied` | (prefix) preflight says denied/restricted |
| `System audio recording requires macOS 14.2 or later` | macOS < 14.2 |
| `System audio recording is not available on this platform` | non-macOS |
| `No audio output device available` | no default output device |
| `System audio cannot be captured from this output device` | (prefix) the default output device also has inputs, so cpal would record its input instead of tapping its output |
| `Not enough free disk space to record` | (prefix) < 200 MB free on the staging volume |
| `The previous recording is still shutting down` | (prefix) a previous capture thread never released the audio device (needs an app restart) |
| `Failed to …` | (prefix) anything else from the audio stack / file system |
Never records less than asked: for `"both"`, if either stream cannot be opened the start fails and
the staging bundle is removed.

### `pause_recording() -> null`, `resume_recording() -> null`
Unchanged. Error: `No recording in progress`.

### `stop_recording()`
```
{ bundle_dir: string,          // staging bundle (absolute)
  audio_path: string,          // audio.m4a (macOS, verified) or audio.wav: the mix / primary audio
  tracks: [{ role: "mic" | "system", path: string }],   // ONLY for source "both"; [] otherwise
  duration_secs: number,       // from samples written (longest track)
  peak: number,                // 0..1, max over tracks
  sample_rate: number,         // of audio_path's PCM source
  dropped_frames: number,
  warnings: string[],          // machine-readable codes, see below
  // extras (not in the contract, safe to ignore):
  path: string,                // == audio_path (old field name, kept so old callers keep working)
  source: string,              // "microphone" | "system" | "both"
  rms: number,                 // of the primary/mic track
  track_peaks: { mic: number | null, system: number | null } }
```
- `tracks` deliberately does NOT contain a `"mix"` entry: it is exactly what should be passed to
  `transcribe_file({ tracks })`. For the manifest's `tracks` add `{ role: "mix", file: basename(audio_path) }` yourself.
- For a single source the one track is written directly as `audio.*` and `tracks` is `[]`.
- All files are MONO 16-bit PCM at the device's native rate before encoding (the mic and system
  tracks may have different rates; the mix uses the mic's rate).
- **May take seconds to tens of seconds** for an hour of audio (mix + up to three AAC encodes, run
  in parallel, off the async workers). Show "Saving…". It is bounded: each encode has a 20 min timeout.
- Errors: `No recording in progress`; `Recording could not be finalised: <detail>` (prefix) when the
  primary WAV could not be finalised or repaired. In that case the staging bundle is LEFT on disk and
  `recover_orphan_recordings` will offer it on the next call.
- `warnings` codes (a code, optionally followed by `: detail`):
  `mic-silent`, `system-silent` (track peak < 0.0002 over the whole recording; `system-silent` is the
  usual sign of a denied System Audio Recording permission), `dropped-frames: <n>`,
  `drift: mic=<±ms>ms system=<±ms>ms` (only when the tracks disagree with the clock by > 100 ms),
  `device-changed`, `write-error: <msg>`, `encode-failed: <file>: <msg>` (that WAV is kept and is
  the path returned), `stop-timeout` (audio thread stuck; file repaired from its length),
  `stopped-early: <reason>` (backend fatal stop), `track-lost: <role>` (one source of "both" could
  not be reopened; the other kept recording), `track-unreadable: <role>` (one file of "both" was not
  a readable WAV; the other became `audio.*` and `tracks` is `[]`), `mix-failed: <msg>` (the mix
  could not be written; `audio.*` is then a copy of the mic track and `tracks` still has both).

### `discard_recording(bundle_dir?: string) -> null`
- Without `bundle_dir`: stops the live recording (if any) and deletes its staging bundle. No live
  recording is NOT an error (idempotent).
- With `bundle_dir` (extra, optional): deletes that staging bundle (e.g. one already stopped, or an
  orphan the user declines). Must be a direct child of the staging root, else
  `Not a staging recording: <path>` (prefix).

### `finalize_recording_bundle(staging_dir: string, dest_recordings_dir: string)`
```
{ bundle_dir: string, audio_path: string, tracks: [{ role: "mic" | "system", path: string }] }
```
- Creates `dest_recordings_dir`, picks `<name>`, `<name> (2)`, … ; `rename` when possible, otherwise
  copy to `.<name>.partial-<pid>` inside the destination, verify every file's size, rename into place,
  then delete the staging copy. A failed copy leaves the staging bundle untouched and nothing visible
  in the destination.
- Removes the backend's private marker (`.capture.json`) first; everything else in the folder
  (`recording.json`, anything the frontend wrote) moves with it.
- Errors: `Not a staging recording: <path>` (prefix), `Recording has no audio: <path>` (prefix),
  `Failed to move recording: <detail>` (prefix).
- Runs on a blocking thread (a cross-volume copy of an hour of WAV can take seconds).

### `recover_orphan_recordings()`
```
[{ bundle_dir: string, audio_path: string, tracks: [{ role, path }], duration_secs: number,
   started_at: string | null,        // RFC 3339 with offset, from the marker or the folder name
   // extras:
   source: string | null,            // from the marker
   has_manifest: boolean }]          // recording.json already present (stop succeeded, finalize did not)
```
- Skips the live recording and every bundle this app session created that was not yet finalised or
  discarded, so it is safe to call at any time (intended: once at startup).
- Repairs WAV headers from the file length; deletes zero-data files and empty bundles; if a `.wav`
  and a same-named `.m4a` coexist the `.m4a` is an unverified leftover and is deleted; if `mic.wav`
  and `system.wav` exist without `audio.*`, it writes the mix `audio.wav`. Does not encode or move.

### `get_recording_state()`
```
{ recording: boolean, paused: boolean, source: string | null, started_at_ms: number | null,
  elapsed_recorded_ms: number,
  // extra:
  fatal: boolean }   // the backend stopped capturing by itself; call stop_recording
```
`recording` stays `true` after a fatal stop until `stop_recording` / `discard_recording` is called.

## Events

- `recording-level`: `{ mic: number | null, system: number | null }`: peak 0..1 since the previous
  event; `null` for a source that was not requested. At most 10/s, never while paused, never after stop.
- `recording-warning`: `{ kind, message, fatal, source? }`, `kind` ∈ `"silence" | "device-lost" |
  "device-changed" | "write-error" | "low-disk" | "dropped-frames"`.
  **`source`: `"microphone"` or `"system"`, present (on every kind) when the warning is about one
  source; the key is ABSENT otherwise** (as `control` asked). `message` is English, for logs; it
  also starts with `mic: …` / `system: …` in that case. Do not search `message` for the word
  "system": the microphone's silence message mentions "System Settings". `fatal: true` → the backend
  has already stopped and finalised; run the normal stop path.
  - `silence`: per source, after the first 5 s with nothing above 0.0002, and again after any 30 s
    silent stretch that follows signal. For `system` this also fires when simply nothing is playing.
  - `device-lost` (after 2 s without audio callbacks; 6 s for a stream that has not delivered its
    first audio yet) then `device-changed` (first audio from the reopened device). Reopen attempts:
    at once, then every 4 s, then every 10 s after the 30 s mark. A change of the default OUTPUT
    device re-opens the system tap and emits only `device-changed`. The gap is padded with silence
    so timestamps stay true. The microphone does NOT follow a change of the default input device
    while its current device keeps delivering.
  - `write-error` (always fatal), `low-disk` (< 500 MB: warning; < 50 MB: fatal),
    `dropped-frames` (first occurrence, then at most once a minute).
  - Also fatal with kind `write-error`: the 4 GiB WAV limit (about 12 h 25 min of mono 48 kHz).
  - Also fatal with kind `device-lost`: no source could be reopened for 30 s.

## Notes for the other agents

- **transcribe (track merging):** with source "both" and the user on SPEAKERS, the microphone also
  hears the system audio (no echo cancellation is attempted), so the same words can appear in both
  tracks: once as "others" (system, clean) and once, quieter and ~10-50 ms later, as "me". De-duplicate
  near-simultaneous near-identical segments in favour of the system track. With headphones this does
  not happen. The two tracks start at the same instant (the later one is padded with silence); drift
  between the two device clocks is not corrected and is reported in `warnings` when > 100 ms.
- **transcribe:** after stop the audio is `audio.m4a` (AAC-LC mono, 64 kbit/s at ≥ 44.1 kHz) on macOS,
  `audio.wav` when encoding failed or off macOS. Orphans are always `.wav`.
- **control:** flow is preflight → start → … → stop → write `recording.json` into `bundle_dir` →
  `finalize_recording_bundle(bundle_dir, <library>/Recordings)` → use the RETURNED paths.
  On app start: `recover_orphan_recordings()`, then for each: write a manifest (unless
  `has_manifest`) and finalize, or `discard_recording(bundle_dir)`.
- **App exit:** `RunEvent::Exit` stops the capture and patches the WAV header (bounded wait, 3 s);
  it does not encode. The bundle is then an orphan for the next launch.
- `collect_diagnostics().whisper.is_recording` still works (reads the recorder's state).

## Answer to `control`'s request (close / quit veto while recording)

NOT implemented: no `recording-close-requested` / `recording-close-confirmed`. The app menu's ⌘Q is
macOS's predefined quit, and whether Tauri delivers a vetoable `ExitRequested` for it could not be
verified without a Mac; a wrong guess there makes the app impossible to quit. What exists instead:
`RunEvent::Exit` stops the capture and leaves a valid WAV (bounded, 3 s), the header is patched every
10 s anyway, and the next launch returns the bundle from `recover_orphan_recordings` (with
`started_at`, `source`, `duration_secs`). So a quit mid-recording loses nothing, but the recording is
saved on the next launch rather than before quitting. `get_recording_state()` is cheap if the
frontend wants to warn in its own close path.

## Deviations from the CONTRACT

1. `system_audio: "denied"` is never returned by preflight and `start_recording` cannot fail on a
   denied System Audio permission (no public API; cpal ignores the tap-creation status). Denial =
   silence → `recording-warning` `silence` with `system: …` after 5 s, and `system-silent` at stop.
2. `stop_recording.tracks` omits the mix and is empty for single-source recordings (see above).
3. In "both" mode a source that cannot be reopened for 30 s does not end the recording while the
   other source is still delivering audio (never lose audio); it is fatal only when no source is left.
4. Extra fields/args: `path`, `source`, `rms`, `track_peaks` (stop); `bundle_dir` arg (discard);
   `source`, `has_manifest` (orphans); `fatal` (state); `source` (warning event).
5. Tracks are written mono (downmixed in the capture thread), not at the device's channel count.
6. No crate was added (`rtrb` was not needed: the ring is ~100 lines of safe Rust in `ring.rs`);
   `Cargo.toml` / `Cargo.lock` are unchanged.
7. `recording-level` values are PEAKS (per the contract); the old recorder emitted RMS, and emitted
   zeros while paused. Nothing is emitted while paused now.

## Where things are (for reviewers)

`src-tauri/src/commands/recording/`: `mod.rs` (commands), `state.rs`, `owner.rs`, `session.rs` (the
capture loop, tested with simulated devices), `capture.rs` (cpal only), `track.rs`, `ring.rs`,
`wav.rs`, `mix.rs`, `monitor.rs`, `staging.rs`, `finish.rs`, `encode.rs`, `preflight.rs`, `types.rs`.
`transcription.rs` lost its capture code (block removals only) and `TranscriptionState` lost
`capture`, `stopping`, `recordings_dir`; `collect_diagnostics().is_recording` now reads
`recording::is_capture_active()`.
