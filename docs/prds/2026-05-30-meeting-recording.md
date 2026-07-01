# PRD: Meeting Recording — Capture-then-Transcribe as a Background Job

|  |  |
| --- | --- |
| **Date** | 2026-05-30 |
| **Status** | Implemented — PR open (in review) |
| **Priority** | High — replaces the hang-prone voice subsystem (issue #264, blocks stable) with a robust, focused feature |
| **Impact** | Removes live dictation + command-bar voice input. Introduces a new "meeting recording" workflow surfaced through the existing StatusTray mic and the AgentOrb. Adds a transcript artifact type to the workspace. |
| **Motivating bug** | [#264](https://github.com/PeterBlenessy/note-sage/issues/264) — "Voice dictation hangs the app" (labeled `hitl`). Root cause: overlapping `cpal` streams on rapid stop→start + a cross-instance `dictation-result` listener leak. This PRD removes the failure mode by construction rather than patching it. |
| **Tasks** | [meeting-recording-tasks](../tasks/2026-05-30-meeting-recording-tasks.md) (16 tasks) |

## Problem

Notesage's voice subsystem tries to do three things at once — **live dictation** (real-time speech→cursor), **command-bar voice input**, and **meeting recording + transcription** — all routed through one fragile real-time pipeline in `transcription.rs`. That pipeline:

1. Spawns a `cpal` mic stream on a detached thread that is never joined, with no teardown synchronization. Rapid stop→start (the exact thing an impatient user does) overlaps two CoreAudio streams and hangs the app (#264, suspect #4 — the strongest).
2. Chunks audio into ~3-second windows and runs Whisper on each chunk inline, trading transcription quality for the *appearance* of real-time. The result is a "messy bunching text floating together" with no structure.
3. Registers `dictation-result` listeners per React hook instance while sharing `isDictating` globally, so starting on one mic button and stopping on another leaks listeners and double-inserts text (#264, suspect #2 — confirmed).

Two observations reframe the whole thing:

- **The user only wants meeting recording.** Live dictation and command-bar voice input are unused ("I never use voice input in the command bar"). Two-thirds of the surface area — and the part that forces the real-time architecture — is dead weight.
- **Quality beats latency for meetings.** A meeting transcript is read *after* the meeting. There is no reason to transcribe in 3-second chunks with a tiny model while the meeting is still happening. Record cleanly, then transcribe the whole file once with the best model the machine can run.

Drop real-time, drop the two unused modes, and the architecture collapses into something robust by construction: **a dumb capture phase and a background transcription job** — the same shape as Notesage's AI-delegation pattern, where work runs in the background and surfaces ambiently through the AgentOrb.

## Goals

1. **One robust recording surface.** A single owner of the mic stream, started/stopped from the existing StatusTray microphone icon. No overlapping streams, no detached threads, no listener leaks — the #264 failure modes are impossible in the new design, not merely fixed.
2. **Capture and transcription are separate phases.** Capture writes audio to disk and does nothing else. Transcription is a separate background job that reads the finished file. The two never contend.
3. **Transcribe for quality, not latency.** Whole-file transcription with a user-configurable model. No 3-second chunking. No real-time pressure.
4. **Surface the work through the AgentOrb.** A transcription is an AI job; it belongs in the orb's activity list alongside agent tasks, visually distinguished as a transcription. Optionally the orb also represents the live recording with elapsed time, giving one continuous indicator: recording → transcribing → ready.
5. **Future-proof for speaker identification.** Store the transcript as timestamped **segments**, not a text blob, so a later diarization + naming pass can attribute speakers without re-recording or re-transcribing.
6. **Land the artifact where the user wants it.** A recording defaults to the global `~/Notesage` inbox and moves to a user-selected project only after transcription completes.

## Non-Goals

- **Live dictation.** Removed entirely. The `start_dictation` / `stop_dictation` commands, `useSpeechRecognition`, the Web Speech API fallback, and the `⌘⇧R` toggle's dictation behavior are deleted, not refactored.
- **Command-bar voice input.** Removed. The FloatingCommandBar gains no microphone affordance.
- **Real-time / streaming transcription.** Explicitly rejected. Transcription is post-processing.
- **Speaker diarization in v1.** The data model reserves `speakerId` / `speakerName` and the pipeline reserves a diarization stage, but v1 ships `speakerId: null` for every segment. Diarization is a follow-up PRD.
- **Audio editing, trimming, or playback scrubbing UI.** v1 stores and re-transcribes the file; it does not build a waveform editor.
- **System-audio / loopback capture.** v1 is microphone-only (matching today's single supported source). Capturing the far end of a call is a future concern.
- **Windows/Linux audio parity.** macOS-first, consistent with the rest of the app.

## User Stories

1. **As someone in a meeting**, I click the microphone in the status tray and start talking. A pill/orb shows the elapsed recording time so I know it's capturing. When the meeting ends I click stop. I don't wait for anything — the app immediately starts transcribing in the background and I get on with my day.

2. **As the same user, five minutes later**, I glance at the pulsing orb. It shows a transcription job running, clearly marked as a transcription (not a regular agent task). When it finishes, the orb pulses once and offers "Move to project". I pick "Client Acme"; the audio and the transcript note move there together.

3. **As a careful reader**, I open the transcript note. It's clean prose split into readable paragraphs, not a wall of chunk-spliced text. (In a future release the same note will read `**Alice:** … **Bob:** …` once speaker naming ships — and because the audio is kept, that upgrade needs no new recording.)

4. **As a privacy-conscious user**, everything happens on-device. The recording lives in my `~/Notesage` folder; the configurable Whisper model runs locally with Metal acceleration. Nothing leaves the machine.

5. **As an impatient user who fat-fingers the button**, I hit stop then immediately start again. Nothing hangs — capture has a single stream owner with proper teardown, so a new recording simply waits for the previous stream to close. The bug that used to freeze the app is gone.

## Vision — the lifecycle, one artifact, four states

A recording is a single artifact that moves through four states, narrated end-to-end by the AgentOrb:

```
⏺ Recording (02:14)  →  ⟳ Transcribing…  →  ✓ Ready to file  →  📁 Moved to project
```

1. **Record.** The StatusTray mic starts capture. A single stream owner appends samples to an audio file in the `~/Notesage` global inbox. The orb enters a *recording* state showing elapsed time (and optionally level). Capture is deliberately dumb: samples → file, nothing else. No Whisper, no chunking, no contention.

2. **Stop.** The mic stream owner is told to stop and its teardown is awaited before the command returns — the audio file is finalized. The orb transitions straight into the transcription state. A rapid restart is safe because the new stream can only open after the previous owner has fully released CoreAudio.

3. **Transcribe.** A background **transcription job** (tracked in the activity store, surfaced in the orb / `AgentPanel`) runs whole-file Whisper with the user-configured model and produces **timestamped segments**. This is the slow, quality-first step — and because it's decoupled from capture, it can take as long as it needs.

4. **File it.** On completion the panel offers "Move to project." The user picks one; the **whole bundle (audio + transcript note) moves** from the global inbox into that project. No pick → it stays in the inbox, re-openable and re-runnable.

### Data model — segments, not a blob

The transcript is stored as an ordered list of segments. This is the single most important future-proofing decision in the PRD:

```ts
interface TranscriptSegment {
  start: number;          // seconds from recording start
  end: number;            // seconds from recording start
  text: string;
  speakerId: string | null;   // reserved for diarization; null in v1
  speakerName: string | null; // reserved for naming pass; null in v1
}
```

The pipeline is staged so diarization slots in without disturbing the rest:

```
capture → transcribe → [future] diarize → [future] name-prep → render note
```

In v1, `diarize` and `name-prep` are no-ops; the renderer collapses segments into readable paragraphs. When diarization ships, it fills `speakerId`, the naming pass fills `speakerName`, and the same renderer groups by speaker (`**Alice:** …`). The audio file is retained precisely so this upgrade can re-process an existing recording.

### The artifact bundle

Each recording is a **folder** under the inbox (and later under the chosen project), holding the audio file plus the transcript note:

```
~/Notesage/Recordings/Meeting 2026-05-30 14-02/
  ├── audio.wav          # finalized capture; retained for re-transcription / future diarization
  └── transcript.md      # markdown note rendered from segments (frontmatter holds segment metadata)
```

A folder keeps audio and transcript paired and lets the "move to project" step be a single atomic move. The transcript note is a normal editable, searchable workspace document; the raw segments live in its YAML frontmatter so the renderer (and a future diarization pass) can reconstruct structure.

### The orb / activity model

The activity store gains a `kind` discriminator so the `AgentPanel` can render and group distinctly:

| `kind` | Meaning | Rendering |
| --- | --- | --- |
| `agent` | Regular AI delegation task (today) | Existing treatment |
| `transcription` | Whole-file meeting transcription job | Distinct icon + label, progress, "Move to project" action on completion |
| `recording` | Live capture in progress | Elapsed time, stop affordance; transitions to a `transcription` item on stop |

The orb pulses for any in-flight item. The panel is the one place to see "what's happening" — recordings, transcriptions, and agent tasks side by side, visually separated. This satisfies the "distinguish AI jobs from transcriptions" requirement while unifying capture, transcription, and delegation under a single ambient surface.

## Detailed changes

### Backend (`src-tauri`)

- **New capture owner.** Replace the detached-thread mic model with a single stream owner that (a) opens exactly one `cpal` stream, (b) streams samples to an audio file on disk rather than an in-memory ring buffer fed to Whisper, and (c) has a `stop` that awaits teardown (stream dropped + thread joined) before returning. This is the structural fix for #264 suspects #1, #3, and #4.
- **New whole-file transcription command.** Reads a finalized audio file, runs Whisper once with the configured model, returns `TranscriptSegment[]` (Whisper already provides per-segment timestamps). Emits progress events consumable by the orb job item.
- **Delete** `start_dictation`, `stop_dictation`, and the chunked dictation loop. Keep/adapt the meeting-oriented `transcribe` path toward the whole-file command. Keep model management commands (`list_whisper_models`, `download_whisper_model`, etc.) unchanged.
- **Artifact move.** Reuse existing file commands (`rename_path` / `copy_directory`) to move the recording folder from the inbox into the selected project.

### Frontend (`src`)

- **Delete** `useSpeechRecognition.ts` and the cross-instance listener leak it carries. Remove command-bar voice affordances (none should remain).
- **StatusTray mic** becomes start/stop for meeting recording (not dictation). Recording state and elapsed time come from a recording store.
- **Activity store** gains the `kind` discriminator (`agent | transcription | recording`) and the transcription-job lifecycle (queued → running → done/failed, with the source audio path and output transcript path).
- **AgentPanel** renders the three kinds distinctly and exposes the "Move to project" action on a completed transcription.
- **Transcript renderer** turns `TranscriptSegment[]` into the note body (paragraphs in v1; speaker-grouped later). Segment data persisted in note frontmatter.
- **Settings → Transcription** keeps model selection; this is the "configurable model" used by the whole-file job. Remove dictation-specific settings.

### Docs

- Update `docs/features/ai-workflows.md` (Voice Transcription & Dictation section) and `docs/architecture.md` (transcription module description) to describe meeting-recording-only, capture/transcribe split, segment model, and orb hosting.
- Update `docs/keyboard-shortcuts.md`: `⌘⇧R` now toggles meeting recording (not dictation); remove dictation references.

## Open questions (small, for the planning step)

1. **Mid-job resilience.** If the app closes while transcribing, does the job resume on next launch (the audio is on disk, so it can) or just mark itself re-runnable from the inbox? v1 leans **re-runnable**; resume is a nice-to-have.
2. **Timestamps in the note.** Hidden metadata in v1, surfaced visibly only once speakers are named? (Leaning **hidden in v1**.)
3. **Audio format.** WAV (simple, large) vs. a compressed format (smaller, needs an encoder). v1 leans **WAV** for simplicity; revisit if file size bites.

## Success criteria

- Rapid stop→start of a recording never hangs the app (the #264 repro is dead). A regression test drives the stop→start sequence.
- A meeting is captured to the inbox, transcribed whole-file in the background via the orb, and moved to a chosen project on completion.
- The transcript note renders as readable segmented prose, with segment data preserved in frontmatter for a future diarization pass.
- Live dictation and command-bar voice input no longer exist anywhere in the codebase.
- The configured transcription model is the one actually used by the whole-file job.
