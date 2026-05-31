# Meeting Recording — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-05-30 |
| **Status** | Complete — all 16 tasks landed on `feat/meeting-recording` (code review + design review findings fixed) |
| **PRD** | [meeting-recording](../prds/2026-05-30-meeting-recording.md) |
| **Total** | 16 tasks: 5S, 9M, 2L |
| **Suggested order** | Backend (#1–#4) → Types/wrappers (#5) → State (#6–#7) → Pipeline (#8–#10) → UI (#11–#14) → Settings/Docs (#15–#16) |

## Risks & notes

- **#1 is the highest-blast-radius task** — it rewrites the `cpal` capture path that is the root of #264. Treat teardown synchronization as the load-bearing invariant: `stop` must await stream-drop + thread-join before returning. Do this task first and prove it with #4 before building anything on top.
- **#10 mounts a new lifecycle hook in `App.tsx`.** Per the auto-memory rule "Startup Hooks in App.tsx", a hook defined but not mounted never runs. The transcription-job orchestrator must be mounted alongside `useProjectMetadata()` / `useStartWatchers()`.
- The capture half partly exists today: `start_recording` / `stop_recording` (`commands/transcription.rs`) + `useRecording.ts` already do mic→buffer + elapsed timer + `recording-level` events. We are changing the destination (in-memory buffer → file) and the teardown discipline, not building from zero.
- The StatusTray mic (`MicButton`) currently drives **dictation** (`useSpeechRecognition`), not meeting recording. #11 repurposes it; #14 deletes the dictation machinery it used.
- Open questions from the PRD (mid-job resume, timestamp visibility, audio format) are resolved as v1 defaults inline below: **re-runnable (no resume), hidden timestamps, WAV**. Revisit only if a task surfaces a blocker.
- Keep model-management commands (`list_whisper_models`, `download_whisper_model`, `cancel_model_download`, `delete_whisper_model`) untouched.

---

## Backend

### #1 — Capture-to-file stream owner with awaited teardown
- **Description:** Replace the in-memory-buffer capture with a single mic-stream owner that streams samples to a WAV file in the `~/Notesage` recordings inbox. Rewrite `start_recording` to create the file + spawn exactly one `cpal` stream owner; rewrite `stop_recording` to signal stop and **await** stream-drop + thread-join before returning, then finalize/close the WAV and return its path. No detached threads, no `rx.recv()` blocking in the async command path. Keep emitting `recording-level` for the UI. Acceptance: a recording produces a valid finalized WAV on disk; `stop` does not return until the stream is fully released; no second stream can open while the previous owner is alive.
- **Complexity:** L
- **Category:** backend
- **Dependencies:** —
- **Files:** `src-tauri/src/commands/transcription.rs`

### #2 — Whole-file transcription command → segments + progress
- **Description:** Add a command that takes a finalized audio file path + model + optional language, runs Whisper once over the whole file, and returns `Vec<TranscriptSegment>` (`{ start, end, text, speaker_id: None, speaker_name: None }` — Whisper already yields per-segment timestamps). Emit `transcription-progress` events keyed by a job id so the orb job can show progress. Acceptance: returns ordered segments with timestamps for a sample WAV; progress events fire; runs off the capture thread so it never contends with a live recording.
- **Complexity:** M
- **Category:** backend
- **Dependencies:** #1
- **Files:** `src-tauri/src/commands/transcription.rs`, `src-tauri/src/lib.rs` (register in `generate_handler!`)

### #3 — Delete dictation backend
- **Description:** Remove `start_dictation`, `stop_dictation`, the chunked dictation loop, the `dictation_cancel` state, and the `dictation-result` event emission. Drop them from the `generate_handler!` list in `lib.rs`. Acceptance: `cargo build` clean; no `dictation` symbols remain in the backend; meeting recording + whole-file transcription paths unaffected.
- **Complexity:** S
- **Category:** backend
- **Dependencies:** —
- **Files:** `src-tauri/src/commands/transcription.rs`, `src-tauri/src/lib.rs`

### #4 — Regression test: rapid stop→start does not hang (#264)
- **Description:** Add a Rust test (or a test-only harness command) that drives `start_recording` → `stop_recording` → `start_recording` back-to-back and asserts it completes without deadlock/hang and that only one stream is ever live. This is the permanent lock on the #264 failure mode. Acceptance: test fails against the old detached-thread model and passes against #1's awaited-teardown owner.
- **Complexity:** M
- **Category:** backend
- **Dependencies:** #1, #3
- **Files:** `src-tauri/src/commands/transcription.rs` (`#[cfg(test)]`)

---

## Types & wrappers

### #5 — `TranscriptSegment` type + tauri.ts wrappers; remove dictation wrappers
- **Description:** Add the `TranscriptSegment` TS interface (`start`, `end`, `text`, `speakerId: string | null`, `speakerName: string | null`). Add `tauriApi` wrappers for the new whole-file transcription command and the (revised) start/stop recording commands that now return a file path. Remove `startDictation`/`stopDictation` wrappers and the `dictation-result` typing. Acceptance: `pnpm typecheck` clean; no dictation wrapper references remain.
- **Complexity:** S
- **Category:** frontend
- **Dependencies:** #1, #2, #3
- **Files:** `src/lib/tauri.ts`, `src/lib/ai/types.ts` (or a `src/lib/transcription/types.ts`)

---

## State

### #6 — Activity-store `kind` discriminator + transcription/recording lifecycle
- **Description:** Extend the activity model with a `kind: 'agent' | 'transcription' | 'recording'` discriminator (default `'agent'` for existing tasks via migration). Add fields/actions for a transcription job: source audio path, output transcript path, progress, status (`running | done | error`), and for a recording item: started-at/elapsed. Follow the existing `addTask` / `updateTaskStatus` patterns and the `onRehydrateStorage` interrupted-task handling. Add unit tests for the new kinds + migration. Acceptance: existing agent tasks unaffected and render unchanged; new kinds round-trip through persist; bump persist `version` with a migration.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #5
- **Files:** `src/stores/activity-store.ts`, `src/stores/__tests__/activity-store.test.ts`

### #7 — Recording-store → meeting-recording-only
- **Description:** Strip dictation from `recording-store` (`isDictating`, `startDictating`, `stopDictating`). Keep/repurpose `isRecording`, `recordingStartTime`, model + language persistence. Point start/stop at the file-capture flow (returns a path) rather than the in-memory buffer. Acceptance: no dictation fields remain; `pnpm typecheck` clean; persisted `defaultModel` / `speechLanguage` preserved.
- **Complexity:** S
- **Category:** frontend
- **Dependencies:** #5
- **Files:** `src/stores/recording-store.ts`, `src/hooks/useRecording.ts`

---

## Pipeline & artifact

### #8 — Segment → transcript note renderer
- **Description:** Pure function that renders `TranscriptSegment[]` into the transcript note: readable paragraphs for the body (v1 collapses segments; timestamps hidden), with the raw segment array persisted in YAML frontmatter so a future diarization/naming pass can reconstruct structure and re-render speaker-grouped (`**Alice:** …`). Unit tests for paragraph grouping + frontmatter round-trip. Acceptance: given segments, produces deterministic markdown; frontmatter parses back to the original segments.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #5
- **Files:** `src/lib/transcription/render-transcript.ts`, `src/lib/transcription/__tests__/render-transcript.test.ts`

### #9 — Artifact bundle (inbox folder) + move-to-project
- **Description:** Create the recording bundle as a folder under `~/Notesage/Recordings/<Meeting timestamp>/` holding `audio.wav` + `transcript.md`. Provide a "move bundle to project" operation that relocates the whole folder into a chosen project (reuse `rename_path`, fall back to `copy_directory` for cross-volume). Acceptance: bundle folder created on transcription completion; move relocates audio + transcript atomically and updates any references; no-pick leaves it in the inbox.
- **Complexity:** M
- **Category:** both
- **Dependencies:** #5
- **Files:** `src/lib/transcription/bundle.ts`, `src-tauri/src/commands/file.rs` (reuse existing move/copy commands)

### #10 — Transcription-job orchestration hook (`useTranscriptionJob`)
- **Description:** The glue tying it together: on capture stop, create a `transcription` activity item, run the whole-file transcription command, stream progress into the activity store, render the note (#8) into the bundle (#9), and mark the job done with a "Move to project" affordance. Handle failure → job `error`, re-runnable from the inbox (no resume). **Mount the hook in `App.tsx`** alongside the other lifecycle hooks. Acceptance: a full record→transcribe→ready cycle drives the orb states end-to-end; a failed transcription is re-runnable.
- **Complexity:** L
- **Category:** frontend
- **Dependencies:** #6, #8, #9
- **Files:** `src/hooks/useTranscriptionJob.ts`, `src/App.tsx`

---

## UI

### #11 — Rewire StatusTray mic to meeting recording
- **Description:** Repoint the StatusTray `MicButton` from dictation to meeting-recording start/stop (via `useRecording` / the orchestration trigger). Keep the accent-coloured pulse while recording and the elapsed-time affordance. Update labels ("Start recording" / "Stop recording") and the keyboard chord wiring. Acceptance: clicking the tray mic starts a capture and a second click stops it and kicks off the background job; tooltip/labels reflect recording, not dictation.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #7, #10
- **Files:** `src/components/editor/toolbar/MicButton.tsx`, `src/components/editor/StatusTray.tsx`

### #12 — AgentPanel + ActivityTaskCard render transcription/recording kinds
- **Description:** Render the new `kind`s distinctly in the orb panel: a transcription job gets its own icon/label + progress and a "Move to project" action on completion (wired to #9); a live recording shows elapsed time + a stop affordance. Keep `agent` tasks visually unchanged. Update the panel heading/empty-state copy to reflect that it now hosts transcriptions too. Acceptance: the three kinds are visually distinguishable; "Move to project" relocates the bundle and clears the action.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #6, #9
- **Files:** `src/components/activity/AgentPanel.tsx`, `src/components/activity/ActivityTaskCard.tsx`

### #13 — AgentOrb recording/elapsed indicator
- **Description:** Optional-but-recommended (PRD): when a recording is active, the orb represents it (e.g. a recording glyph + elapsed time) so the orb narrates the full `Recording → Transcribing → Ready` story. Respect `useReducedMotion()` (no pulse when reduce is set). Acceptance: orb shows a recording state with elapsed time during capture, transitions to the transcription job on stop; reduced-motion honoured.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #6, #7
- **Files:** `src/components/activity/AgentOrb.tsx`

### #14 — Delete dictation UI + voice remnants
- **Description:** Delete `useSpeechRecognition.ts` and remove its consumers (the old dictation path in `MicButton`, any TranscriptionOverlay logic that is dictation-only, the `⌘⇧R` dictation behaviour now reassigned to recording). Verify the FloatingCommandBar has no microphone affordance (the PRD asserts none should exist) and remove if found. Acceptance: no `useSpeechRecognition` / `dictation-result` references remain in `src/`; `pnpm typecheck` + `pnpm test` clean.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #11
- **Files:** `src/hooks/useSpeechRecognition.ts` (delete), `src/components/editor/TranscriptionOverlay.tsx`, `src/components/cmd/FloatingCommandBar.tsx`

---

## Settings & docs

### #15 — Settings → Transcription: drive whole-file model, remove dictation settings
- **Description:** Ensure the Settings > Transcription model selection is the configurable model used by the whole-file job (#2). Remove dictation-specific settings/UI. Keep model download/delete management. Acceptance: selecting a model changes which model the next transcription job uses; no dictation settings remain.
- **Complexity:** S
- **Category:** frontend
- **Dependencies:** #7
- **Files:** `src/components/settings/TranscriptionSettings.tsx`

### #16 — Docs update
- **Description:** Update living docs to describe meeting-recording-only: `docs/features/ai-workflows.md` (Voice Transcription & Dictation → meeting recording, capture/transcribe split, segment model, orb hosting), `docs/architecture.md` (transcription module + activity-store `kind`), `docs/keyboard-shortcuts.md` (`⌘⇧R` = toggle meeting recording; remove dictation refs). Per the "PRDs are historical" rule, update living docs only — leave the PRD as the snapshot. Acceptance: no doc still describes live dictation or command-bar voice input as shipping features.
- **Complexity:** S
- **Category:** frontend
- **Dependencies:** #1–#15
- **Files:** `docs/features/ai-workflows.md`, `docs/architecture.md`, `docs/keyboard-shortcuts.md`
