# CONTRACT-NOTE: agent `transcribe` (Rust: transcription, models, media import)

Status: FINAL. Everything below matches the code; see "Final state and deviations" at the end.

Serde convention: all Rust structs crossing IPC use **snake_case** field names (same as the existing
`TranscriptionResult` / `RecordingResult`). Command ARGUMENTS follow Tauri's default: the frontend passes
camelCase (`jobId`, `audioPath`, `sourcePath`, `destRecordingsDir`), Rust receives snake_case.
EVENT payloads are snake_case too (this CHANGES `transcription-progress`, which used `jobId`).

## transcribe_file
Args (frontend names): `{ jobId?: string | null, path: string, model: string, language?: string | null, tracks?: [{ role: "mic" | "system", path: string }] | null }`
- `jobId` was required, is now optional.
- `language`: empty / null / "auto" = auto-detect; anything else is pinned (unchanged semantics).
- `tracks` absent / null / empty: `path` is transcribed (as before). With `tracks`: each track is transcribed
  separately with the same model/language; `path` is then used only as the `audio_path` in events and for cancel.
  Unknown role = error `Unknown track role: <role>`.

Result (snake_case):
```
{ segments: [{ start: number, end: number, text: string,
               speaker?: "me" | "others",            // key OMITTED when there are no tracks
               speaker_id: null, speaker_name: null  // legacy keys kept, always null
            }],
  duration_secs: number, language: string, decoder: "symphonia" | "coreaudio" }
```
- `language`: the language actually used: the pinned one, or the one Whisper detected (e.g. "sv"); "auto" only when nothing was detected (silent file).
- With auto-detect the language is detected ONCE (first part of the first track that has speech) and pinned for the rest of the job.
- Segments are sorted by `start`; seconds relative to the start of the audio, mapped back to ORIGINAL time (silence that was skipped internally does not shift timestamps).
- Echo de-dup (tracks only): a "me" segment (>= 3 words) whose words are >= 80 % contained, in order, in the "others" text within +-2 s of it is dropped.

Errors (exact strings the frontend may match):
- `Transcription cancelled`  (exactly; for running AND queued jobs)
- `Audio file not found: <path>`
- `Model '<name>' not downloaded. Download it from Settings > Transcription.`  (unchanged)
- `The audio file is still in iCloud and could not be downloaded: <detail>`
- `Audio file contains no samples`
- decode errors unchanged (`Unrecognised audio format: …`, `File contains no audio track`, `Unsupported audio codec: …`)

## transcription-progress (event)
`{ job_id: string | null, audio_path: string, stage: "loading" | "decoding" | "transcribing" | "finishing", percent: number }`
- `percent` integer 0..100, overall for the whole job (all tracks), monotonic, emitted only when percent or stage changes. No text.
- `audio_path` = the `path` argument of `transcribe_file`, verbatim.
- A queued job emits nothing until it gets its turn. First event: `stage: "loading", percent: 0`. Last: `stage: "finishing", percent: 100` (success only).

## cancel_transcription
Args: `{ jobId?: string | null, audioPath?: string | null }` -> `boolean` (true when at least one running or queued job matched; both null = false).
A job matches when `jobId` equals its job id OR `audioPath` equals its `path` argument (or, for import_media, its `source_path`).

## import_media
Args: `{ sourcePath: string, destRecordingsDir: string }`
Result: `{ bundle_dir: string, audio_path: string, duration_secs: number, original_name: string }` (`original_name` = file name with extension).
- Bundle folder: `Import <sanitised stem> <YYYY-MM-DD HHMMSS>` inside `destRecordingsDir` (created if missing; ` 2`, ` 3`… appended on collision). Folder 0700, audio 0600.
- Audio: `audio.m4a` (macOS, AAC mono 64 kbit/s via `/usr/bin/afconvert`, verified) else `audio.wav` (16 kHz mono 16-bit PCM, 115 MB/h).
- Extraction happens in a LOCAL temp folder (`~/.notesage/import-staging/`); the bundle folder appears in the library only when the audio is complete. On failure or cancel nothing is left behind.
- The frontend writes `recording.json` afterwards (source "import", originalFile { name, path }).
- Supported input: whatever symphonia (wav, mp3, m4a/mp4/mov with AAC or ALAC, flac, ogg/vorbis, aiff, caf) or, on macOS, CoreAudio/afconvert can read. `.webm`/Opus and `.mkv`: NOT supported by symphonia as built -> error on non-macOS; on macOS only if CoreAudio reads it.
- Event `import-progress`: `{ source_path: string, percent: number }` (integer 0..100, on change only).
- Cancel: `cancel_transcription(null, sourcePath)` -> `import_media` rejects with `Import cancelled`.

Errors:
- `Import cancelled`
- `Source file not found: <path>`
- `The file is still in iCloud and could not be downloaded: <detail>`
- `No audio track found in <name>`
- `Unsupported media format: <name> (<detail>)`
- `Cannot write to <dest>: <detail>`

## audio_file_status (new; file.rs, all platforms)
Args: `{ path: string }` -> `{ exists: boolean, size: number, local: boolean }`
- `local: false` for an evicted iCloud file: dataless (macOS, file exists with full size) or a `.name.icloud` placeholder beside a missing file (then `exists: false`, `size: 0`, `local: false`).
- Missing file with no placeholder: `{ exists: false, size: 0, local: false }` (never an error for a missing file).

`file_size` now FAILS for a dataless file with `File is not downloaded from iCloud: <path>` (so the existing "size gate fails -> icloud_ensure_downloaded" flow covers dataless files).
`icloud_ensure_downloaded` now returns `downloading` (and requests the download) for a dataless file as well.

## Model commands
Names unchanged. `model-download-progress`: `{ model: string, downloaded: number, total: number }` (`total` may be 0), throttled (~10/s).
`download_whisper_model` resumes a partial `.downloading` file (HTTP Range); explicit cancel deletes the partial file; a failure/quit keeps it.

New error strings:
- `Download cancelled` (unchanged)
- `Download stalled: no data received for 30 seconds`
- `Not enough free disk space: need <n> MB, <m> MB available`
- `Downloaded file failed verification (<detail>). It was removed; try again.`
- `delete_whisper_model`: `Model '<name>' is in use by a running transcription. Try again when it finishes.`

## Final state and deviations

Code: `src-tauri/src/commands/transcribe/` (new: resample, preprocess, engine, pipeline, multitrack, progress, jobs,
job, local_file, media_import, model_download, whisper_engine); the Tauri commands stay in `transcription.rs`
(`transcribe_file`, `cancel_transcription`, `import_media`, model commands); `audio_file_status` is in `file.rs`.
The mobile stub (`transcription_stub.rs`) has the same command set and argument shapes.

Everything above is implemented as written. Points worth knowing:

1. **`transcription-progress` keys are snake_case** (`job_id`, `audio_path`), as the CONTRACT says; the old `jobId`
   and `segment` keys are gone. A stage change is emitted even when the percent did not change.
2. **No "queued" stage.** A job waiting for its turn emits nothing; the frontend should show its own "waiting" state
   until the first event (`loading`, 0). Cancelling it makes `transcribe_file` reject with `Transcription cancelled`.
3. **Stage order within a job** is `loading` 0 → `decoding` → `loading` (the model, only if it is not in memory) →
   `transcribing` → (`decoding` / `transcribing` alternate for each ten-minute part and for each track) → `finishing` 100.
   Percent is monotonic across all of it.
4. **`language` in the result** is the pinned language or the detected one; `"auto"` only when nothing was said.
   Detection happens once per job (also across tracks).
5. **`speaker`** is absent (key omitted) without `tracks`; `speaker_id` / `speaker_name` are still present and `null`.
6. **`tracks` roles**: only `mic` and `system`; `mix` is rejected (`Unknown track role: mix`). Pass exactly what
   `stop_recording` / `finalize_recording_bundle` return in `tracks` (an empty list means "use `path`").
7. **`import_media` output**: `audio.m4a` only on macOS and only when `afconvert` succeeded and the result was
   verified; otherwise `audio.wav` (16 kHz mono). Use the returned `audio_path`, do not assume the extension.
   The Recordings folder itself is created if missing. WebM/Opus is not supported (clear error off macOS).
8. **`file_size` on a dataless file is now an error** (it used to return the full length).
9. **Model download**: revision is still `main` and no SHA-256 is pinned (Hugging Face was not reachable from the
   build environment, so no hash could be verified; the verification path exists and is tested). Enforced today:
   the server-announced length and the ggml magic number.
10. **Deviation (T5):** the resampler is my own polyphase windowed-sinc (Kaiser), not `rubato`; no crate was added
    and `Cargo.toml` / `Cargo.lock` are unchanged.
