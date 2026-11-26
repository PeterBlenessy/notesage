# CONTRACT-NOTE: agent `speakers-backend` (Rust: speaker identification)

Status: FINAL. Everything below matches the code in `src-tauri/src/commands/speakers/`.

Serde convention (same as `CONTRACT-NOTE-transcribe.md`): structs crossing IPC use **snake_case** field
names. Command ARGUMENTS follow Tauri's default: the frontend passes camelCase (`audioPath`, `jobId`,
`expectedSpeakers`, `profileId`, `isMe`, `intoId`, `fromId`, `sharedMicrophone`), Rust receives snake_case.
Fields INSIDE an argument object are snake_case as written here (`{ kind, recording }`, `{ label, embedding }`,
`{ role, path }`, `{ start, end, speaker }`). Event payloads are snake_case.

All commands are desktop only. On iOS every one exists as a stub (`transcription_stub.rs`).

## Labels

- `me`: the user, only in a two-track (`both`) recording analysed without `sharedMicrophone`.
- `speaker-1`, `speaker-2`, …: everyone else, numbered in order of first appearance (per track; the system
  track's numbering continues after the microphone track's when both are diarised).
- Labels are stable for one analysis result. Re-analysing may renumber. The bundle stores labels and display
  names only (`speakers.json` `names: { "speaker-1": "Anna" }`); **never write an `embedding` into a bundle,
  the library, a note, a log or anything synced.** Embeddings are voiceprints; keep them in memory only and
  pass them back to `voice_profile_save` / `voice_profiles_match`.

## Models

### speaker_models_status
Args: none. Result:
```
{ installed: boolean,                       // true when every model is installed
  models: [{ id: string, name: string, size_bytes: number, installed: boolean,
             licence: string, source: string, download_url: string }] }
```
One model today: `id: "wespeaker-voxceleb-resnet34-lm"`, 26 530 550 bytes, licence `CC-BY-4.0 (WeSpeaker, trained on VoxCeleb)`.

### download_speaker_models
Args: none. Result: `null`. Resumes a partial download; the file is verified (size + SHA-256) before use.
Event `speaker-model-download-progress`: `{ model: string, downloaded: number, total: number }` (`total` may be 0; ~10/s).
Errors: `Voice models are already being downloaded`, `Download cancelled`, and the downloader's strings from
CONTRACT-NOTE-transcribe (`Download stalled: …`, `Not enough free disk space: …`,
`Downloaded file failed verification (<detail>). It was removed; try again.`, `Download failed…`).

### cancel_speaker_models_download
Args: none. Result: `boolean` (true when a download was running; it then rejects with `Download cancelled` and its partial file is deleted).

### delete_speaker_models
Args: none. Result: `null`. Voice profiles are kept (they work again once the model is downloaded again).
Errors: `The voice models are in use by a running analysis. Try again when it finishes.`, `Voice models are already being downloaded`.

## Analysis

### analyze_speakers
Args: `{ jobId?: string | null, audioPath: string, tracks?: [{ role: "mic" | "system", path: string }] | null,
expectedSpeakers?: number | null, segments?: [{ start, end, text, speaker? }] | null, sharedMicrophone?: boolean | null }`
- no `tracks` (or empty): `audioPath` is diarised; all speakers are `speaker-N`.
- `tracks` with `mic` and `system`: the mic track is `me` (speech is found, not diarised), the system track is
  diarised into `speaker-N`. `audioPath` is then only the id of the job (events, cancel).
- `sharedMicrophone: true`: the mic track is diarised too (no `me`; mic speakers are numbered first).
- a single track in `tracks`, whatever its role: diarised like a plain file.
- `expectedSpeakers`: 1..30, the number of `speaker-N` speakers (NOT counting `me`); cuts to exactly that many.
  `0`/null = find out. With two diarised tracks it applies to the first (the microphone).
- `segments`: pass the transcript segments to get them back labelled. In a two-track recording a segment with
  `speaker: "me"` only ever gets `me` (or a mic speaker with `sharedMicrophone`), one with `speaker: "others"`
  only a system-track speaker. Extra keys (`speaker_id`, `speaker_name`) are ignored and NOT returned.

Result:
```
{ turns: [{ start: number, end: number, speaker: string }],          // sorted by start; me and others may overlap
  speakers: [{ label: string, total_secs: number,
               sample: { track_path: string, start: number, end: number },   // 5–8 s when there is a turn that long
               embedding: number[] }],                                // 256 floats, unit length; [] when none could be computed
  segments?: [{ start, end, text, speaker? }],                        // key ABSENT when no segments were passed
  duration_secs: number,
  model: string }                                                     // pass back as `model` to save / match
```
- `speakers` order: `me` first (if present), then `speaker-1`, `speaker-2`, …
- `sample.track_path` is the path of the file the sample is in (the `audioPath`, or the track's `path`);
  play it with `extract_audio_clip({ audioPath: sample.track_path, start: sample.start, end: sample.end })`.
- `segments` may come back LONGER than they went in: a segment is split in two when two speakers each hold
  >= 30 % and >= 1 s of it AND the text has a sentence end (`. ` `? ` `! `) within 20 % of the change. Otherwise the
  speaker with the most time in it wins. A segment with no turn within 2 s keeps the `speaker` it came with
  (`"others"`, `"me"` or absent).
- No speech at all: `turns: []`, `speakers: []` (not an error).

Event `speaker-analysis-progress`: `{ job_id: string | null, audio_path: string, stage: "loading" | "analyzing" | "finishing", percent: number }`
- integer 0..100, monotonic, only on change; first `loading` 0, last `finishing` 100 (success only). A queued job emits nothing.
- `audio_path` = the `audioPath` argument, verbatim.

Queue and cancel: the analysis takes turns with transcriptions (one job at a time, same queue).
`cancel_transcription({ jobId, audioPath })` cancels it too (it matches by job id or by `audioPath`). NOTE: a
transcription and an analysis of the same `audioPath` are BOTH cancelled by a path-only cancel; pass `jobId`.

Errors (exact):
- `Speaker analysis cancelled`
- `Voice models are not downloaded. Download them from Settings > Transcription.`
- `Audio file not found: <path>`
- `The audio file is still in iCloud and could not be downloaded: <detail>`
- `Unknown track role: <role>`
- `expected_speakers must be at most 30`
- `Could not load the voice model <path>: <detail>` (a damaged model file: delete and download again)
- decode errors as for `transcribe_file`.

### embed_speaker_turns  (learning voices from a Teams transcript)
Args: `{ audioPath: string, turns: [{ start: number, end: number, speaker: string }] }` (`speaker` = the real name).
For a two-track recording pass the track the named people are on (the SYSTEM track for remote participants; the mic track for the user).
Result (DEVIATION from the brief, which had a bare array: the skipped speakers need to be reported):
```
{ speakers: [{ speaker: string, embedding: number[], total_secs: number }],
  skipped:  [{ speaker: string, reason: string, total_secs: number }],
  model: string }
```
- Only speech where nobody else has a turn is used; 0.25 s is cut off both ends of every turn; stretches under 1 s are ignored;
  at most 60 s per speaker; the fifth of the windows that fit worst is dropped.
- A speaker with under 6 s of such speech is in `skipped`, `reason` starting with `Too little clean speech`.
- Errors: `Voice models are not downloaded…`, `Audio file not found: <path>`, `Speaker analysis cancelled`, iCloud/decode errors as above.
- Takes a turn in the job queue; cancel with `cancel_transcription({ audioPath })`.

## Voice profiles (biometric data: opt-in)

Stored ONLY in `~/.notesage/voice-profiles/` (folder 0700, one `<id>.json` 0600 per person). Never in the
library, iCloud or a bundle. The backend refuses to create or compare voiceprints unless `consent: true` is
passed: `voice_profile_save`, `voice_profiles_match`, `enrol_own_voice` reject with exactly
**`Voice recognition is not enabled`**. Pass the value of the user's opt-in setting, never a literal `true`.
Listing, renaming, merging and deleting work without consent (so data can be removed after opting out).

`ProfileSummary` (no embeddings ever cross IPC from the store):
```
{ id: string, name: string, is_me: boolean, created_at: string, updated_at: string,     // RFC 3339 UTC
  sources: [{ kind: "manual" | "teams" | "enrolment", recording: string | null, at: string }],
  model: string, exemplar_count: number,
  usable: boolean }      // false = made with another voice model: shown, never matched; saving the voice again repairs it
```

### voice_profiles_list
Args: none. Result: `{ profiles: ProfileSummary[], quarantined: number, directory: string }`.
`quarantined` = unreadable profile files that were moved aside (`<name>.corrupt-<time>`, kept until "delete all").

### voice_profile_save
Args: `{ consent: boolean, name: string, embedding: number[], source: { kind: "manual" | "teams" | "enrolment", recording?: string | null },
profileId?: string | null, isMe?: boolean | null, model?: string | null }`
Result: `{ profile: ProfileSummary, created: boolean }`.
- `profileId` given: that profile gets the example; `name`, if not blank, replaces its name.
- no `profileId`: an existing profile with the same name (case and spacing ignored) gets it, unless the voice is
  clearly someone else's (cosine < 0.30), in which case a new profile is created. Pass `profileId` whenever the user confirmed a suggestion.
- `isMe: true`: the example goes to the one profile marked as the user (created if missing; `name` renames it).
- `model`: pass `model` from the analysis result. Rejected if it is not the model in use.
- A profile keeps the newest 20 examples and their mean.
Errors: `Voice recognition is not enabled`, `A voice profile needs a name`, `The name is too long (at most 120 characters)`,
`The voice embedding has <n> values; the voice model in use gives 256`, `The voice embedding is empty or not a number`,
`The voice embedding is all zeros`, `Voice profile not found: <id>`,
`This voice embedding was made with another voice model (<id>). Analyse the recording again.`

### voice_profile_rename
Args: `{ profileId: string, name: string }` -> `ProfileSummary`. Errors: `Voice profile not found: <id>`, name errors as above.

### voice_profiles_merge
Args: `{ intoId: string, fromId: string }` -> `ProfileSummary` of `intoId` (keeps its name; `fromId` is deleted).
Errors: `Cannot merge a voice profile with itself`, `Voice profile not found: <id>`.

### voice_profile_delete
Args: `{ profileId: string }` -> `null`. Errors: `Voice profile not found: <id>`.

### voice_profiles_delete_all
Args: none -> `number` (files removed). Removes every profile, quarantined file, leftover temp file, the folder itself, and all sample clips.

### voice_profiles_match
Args: `{ consent: boolean, speakers: [{ label: string, embedding: number[] }], participants?: string[] | null, model?: string | null }`
Result:
```
[{ label: string,
   candidates: [{ profile_id: string, name: string, is_me: boolean, score: number,       // cosine, -1..1
                  confidence: "likely" | "possible", participant: boolean }] }]           // best first, at most 3, [] = nobody
```
- SUGGESTIONS ONLY. Never apply a candidate without the user confirming it.
- `likely`: score >= 0.55 and at least 0.08 above the next best other person. `possible`: score >= 0.42. Below: not listed.
- One profile is `likely` for at most one speaker per call (the one it fits best); for others it is `possible`.
- `participants` (non-empty): only profiles whose name is on the list are offered (same name, or first name alone:
  "Anna" matches "Anna Berg"), plus the `is_me` profile; for listed people both thresholds are 0.05 lower.
- Speakers with an empty `embedding` get `candidates: []`. Profiles with `usable: false` are never offered.
Errors: `Voice recognition is not enabled`, the `model` error above.

### enrol_own_voice
Args: `{ consent: boolean, audioPath: string, name?: string | null }` -> `{ profile: ProfileSummary, created: boolean }`.
`audioPath`: any audio file the app can decode in which only the user speaks (e.g. a recording made with the
existing recording commands). Needs at least 8 s of speech. Adds to the `is_me` profile (default name `Me`).
Errors: `Voice recognition is not enabled`, `Not enough speech to learn the voice: found <n> s of speech, need at least 8 s`,
`Voice models are not downloaded…`, `Audio file not found: <path>`, `Speaker analysis cancelled`.

## extract_audio_clip
Args: `{ audioPath: string, start: number, end: number }` -> `{ path: string }`.
Writes a 16 kHz mono WAV (0600) to `<system temp>/notesage-speaker-clips/` (0700). At most 30 s. Clips are deleted
after an hour, on "delete all", and when the app quits. `$TEMP/**` is already in the asset-protocol scope, so
`convertFileSrc(path)` plays it.
Errors: `Invalid clip range`, `A clip can be at most 30 seconds long`, `Audio file not found: <path>`,
`The recording has no audio in that range`, iCloud/decode errors.

## Constants (named in the code)
| What | Value | Where |
| --- | --- | --- |
| window / hop | 1.5 s / 0.75 s | `engine::WINDOW_SAMPLES`, `vad::HOP_SAMPLES` |
| cluster threshold (cosine distance, average linkage) | 0.70 | `cluster::CLUSTER_THRESHOLD` |
| centroid merge (cosine) | 0.60 | `cluster::CENTROID_MERGE` |
| max speakers without a hint / max hint | 12 / 30 | `cluster::MAX_SPEAKERS`, `MAX_EXPECTED_SPEAKERS` |
| match: likely / possible / margin / participant bonus | 0.55 / 0.42 / 0.08 / 0.05 | `matching::*` |
| sample length | 5–8 s | `turns::SAMPLE_*` |
| examples kept per profile | 20 | `profiles::MAX_EXEMPLARS` |
| enrolment minimum speech | 8 s | `analyze::MIN_ENROLMENT_SPEECH_SECS` |
| named-turn minimum clean speech | 6 s | `analyze::MIN_CLEAN_SPEECH_SECS` |

## Suggested frontend flow
1. Settings: opt-in switch "Recognise voices" (off by default) -> `consent`. Models: `speaker_models_status` / `download_speaker_models`.
2. After transcription: `analyze_speakers({ jobId, audioPath, tracks, segments })` -> write `segments` (with labels) to
   `segments.json`; show speakers with total time and a play button (`extract_audio_clip`).
3. If opted in: `voice_profiles_match({ consent, speakers: result.speakers.map(({label, embedding}) => ...), participants, model: result.model })`
   -> show suggestions for confirmation.
4. User names a speaker -> `speakers.json` names; if opted in also
   `voice_profile_save({ consent, name, embedding, source: { kind: "manual", recording: bundleDir }, profileId?, model })`.
5. Teams transcript merged, opted in to learning: `embed_speaker_turns` -> `voice_profile_save` with `kind: "teams"` per returned speaker.
6. Own voice: record a sample -> `enrol_own_voice`. In a `both` recording the `me` speaker's `embedding` can also be saved with `isMe: true`.
