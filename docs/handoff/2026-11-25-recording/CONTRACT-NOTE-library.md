# CONTRACT-NOTE: agent `library` (frontend: Recordings place, jobs, transcripts, import, Teams merge)

Status: written early; the "as implemented" section at the bottom is updated before I finish.

## What `control` can call (exact names)

### `src/lib/transcription/bundle.ts`
- `writeRecordingManifest(bundleDir: string, manifest: RecordingManifest): Promise<void>`: SAME name and argument order as today.
  `RecordingManifest` (in `src/lib/transcription/manifest.ts`) gains OPTIONAL fields, so a manifest object with them typechecks:
  - `source: "microphone" | "system" | "both" | "import"` (was the literal `"microphone"`; the parser accepts all four)
  - `tracks?: { role: "mic" | "system" | "mix"; file: string }[]` (`file` = basename inside the bundle)
  - `originalFile?: { name: string; path: string }`
  - `title?: string`
  - `language?: string` (already existed)
  - `transcript?: { file: string; hash?: string; generatedAt?: string }` (EXTENSION, written only by `library`: which file in the bundle is the transcript and its content hash at generation time)
  - `autoTranscribe?: boolean` (EXTENSION, written only by `library`: `false` after the user cancelled a job, so the scanner does not restart it)
- `createMacRecordingManifest(facts: MacRecordingFacts)`: same as today plus OPTIONAL facts `source`, `tracks`, `title`, `codec` (`"pcm" | "aac"`, default by the audio file's extension: `.m4a` → `aac`, else `pcm`), `channels` (default 1), `originalFile`. So `control` can do
  `writeRecordingManifest(stagingDir, createMacRecordingManifest({ ...facts, source, tracks }))`.
  If `control`'s worktree builds the object by hand/spread instead, that also works: unknown keys are preserved and serialised.
- `updateRecordingManifest(bundleDir, (m) => m2)`: serialised read-modify-write per bundle (used by the scanner and the store; `control` does not need it).

### `src/stores/recordings-store.ts` (`useRecordingsStore`)
- `openRecordings(): void`, `closeRecordings(): void`, `toggleRecordings(): void`
- `refresh(): void`: debounced reload of the list (call after `finalize_recording_bundle`); `load(): Promise<void>` is the immediate one.
- The store also refreshes itself on `file-changed-batch` under the Recordings folder and on transcription task transitions, so calling `refresh()` is belt and braces.
- The view closes itself when any document becomes active (editor-store `activeTabId` change), on `openFile`, on Esc, and when the sidebar row is clicked again.

### `src/hooks/useTranscriptionJob.ts`
- `startTranscription(detail: StartTranscriptionDetail): void`: unchanged, with new OPTIONAL fields:
  `tracks?: { role: "mic" | "system"; path: string }[]` (absolute paths, passed to `transcribe_file`), `title?: string`.
  One job per `audioPath`: a second call while one is queued/running does nothing but surface the existing one.
- `cancelTranscriptionJob(taskId: string): Promise<void>`.

### Recording button in the Recordings view
I call `toggleMeetingRecording()` from `src/hooks/useMeetingRecording.ts` (current name, not edited by me).

## Backend shapes I code against (assumptions; see my final report for the numbered list)

- `transcribe_file` invoked as `{ jobId, path, model, language, tracks }` (Tauri camelCase → snake_case args); result `{ segments: [{ start, end, text, speaker?: string | null, speaker_id?, speaker_name? }], language, duration_secs }`. I read `speaker ?? speaker_id`.
- `transcription-progress` payload: I accept `job_id` OR `jobId`, plus `audio_path`, `stage`, `percent`; a payload without a job id is matched by `audio_path`.
- `cancel_transcription` invoked as `{ jobId, audioPath }` → boolean. A rejection of `transcribe_file` whose message CONTAINS `Transcription cancelled` is a cancel, not a failure.
- `import_media` invoked as `{ sourcePath, destRecordingsDir }` → `{ bundle_dir, audio_path, duration_secs, original_name }`; `import-progress` `{ source_path, percent }`.
- `audio_file_status` invoked as `{ path }` → `{ exists, size, local }`. If that command does not exist (rejects), I fall back to `file_size` (resolve = local, reject = not local/missing).
- Import bundles are folders named `Import …`; I treat ANY folder in `Recordings/` that contains `recording.json` or an `audio.*` file as a recording (not only `Recording *`).

## Files in a bundle, as I write them

- `segments.json`: `{ "version": 1, "segments": [{ "start": s, "end": s, "text": "…", "speaker": "me" }] }` (`speaker` omitted when unknown), two-space JSON + trailing newline. Always describes the transcript named by `manifest.transcript.file`.
- `speakers.json`: `{ "version": 1, "names": { "me": "Peter" } }`. Labels without an entry display as the label itself, except `me` / `others` which display translated ("Me"/"Others", "Jag"/"Övriga").
- Transcript: `<sanitised title>.md` for NEW transcripts (title = `manifest.title` ?? bundle folder name); `manifest.transcript.file` names it. A bundle that already has `transcript.md` keeps that file name when the user picks "Replace". "Keep both" writes `<title>.md`, or `<title> (2).md`… if taken.
  Frontmatter: `type: meeting-transcript`, `title`, `date`, `duration`, `language`, `model`, `source`, `speakers` (list of display names). No segments in frontmatter.
  Body: `# <title>` then `renderTranscriptBody(...)`: with speakers, each turn starts `**<name>** [hh:mm:ss]` on its own line followed by the turn's text; without, paragraphs with a `[hh:mm:ss]` marker line roughly every 60 s.
- `teams-transcript.vtt` (or `.docx`): the attached original, copied byte for byte.
- Legacy bundles (segments in `transcript.md` frontmatter, no `segments.json`): read-only fallback; opening never rewrites.
