# Handoff: recording work, 2026-11-25

Written because the session ran out of context. Everything needed to continue is in this folder.

## State of the repository

- `main` is at v0.64.0 (released 2026-11-25): MCP end to end, Settings button fix, caret above the command bar, indexing indicator, mid-session indexing, faster saved pages.
- Branch `claude/busy-mendel-9xl1f0` = main + the two finished BACKEND lanes of the recording work + this folder. It compiles (`cargo check` and `cargo check --tests` exit 0 with the pkg-config stubs). It is NOT releasable alone: with the backend only, Mac recordings stay in `~/.notesage/recordings-staging/`, because the frontend that moves them into the library is not merged yet.
- No pull request is open for this branch.

## What the owner asked for

1. Fix ALL findings of the voice-recording review (performance, usability, issues).
2. Record system audio, not just the microphone.
3. Extract audio from a video recording (e.g. Teams), transcribe it, and combine it with the Teams transcript.
4. Suggestions for identifying speakers and mapping voices to people. Suggestions were given in chat; the owner has NOT chosen yet. Options: A name speakers after the meeting; B remembered voiceprints (opt-in, local only); C learn voices from Teams transcripts; D enrol own voice; E participant list; F detect introductions. Recommended order: tracks + Teams merge (in progress) → voice analysis with A + E → D and opt-in B → C only if wanted. Voice analysis needs a new on-device model/runtime (about 20 to 40 MB) and was NOT started.

## Files here

- `BRIEF.md`: every finding (C*, S*, T*, U*), the new capabilities (N1 system audio, N2 media import, N3 Teams transcript merge, speakers) and the binding CONTRACT between backend and frontend.
- `RULES.md`: working rules given to the four lanes.
- `CONTRACT-NOTE-<lane>.md`: what each lane implemented or planned (exact payload shapes, deviations).
- `control.partial.patch` + `control.partial-newfiles.tgz`, `library.partial.patch` + `library.partial-newfiles.tgz`: snapshots of the two FRONTEND lanes' uncommitted work at the moment of the handoff, relative to main `45f0b1a`. The patch holds changes to tracked files; the archive holds new files (extract at the repo root). They may be incomplete and are untested as a whole. Apply with `git apply --3way --index <patch>`.

## Lanes

| Lane | Status | Where |
|---|---|---|
| `capture` (Rust: device loss, write errors, crash recovery, system audio, staging + finalize, AAC, preflight) | DONE, on the branch | `src-tauri/src/commands/recording/` |
| `transcribe` (Rust: streaming decode, 10-minute parts, progress, cancel, queue, multi-track me/others, media import, model download resume, undownloaded iCloud audio) | DONE, on the branch | `src-tauri/src/commands/transcribe/`, `audio_decode.rs` |
| `control` (frontend: start/stop flow, always-visible indicator + level meter, source picker, recovery at startup, Transcription settings) | IN PROGRESS when the session stopped; snapshot here | see BRIEF |
| `library` (frontend: Recordings view trap, list management, jobs and cards, transcripts + `segments.json` + `speakers.json`, import UI, Teams transcript merge) | IN PROGRESS when the session stopped; snapshot here | see BRIEF |

## To continue

1. Finish `control` and `library`: re-run them from `BRIEF.md` and their scope, starting from the snapshots if they apply and look sound, otherwise redo. They must follow the CONTRACT and the backend notes.
2. Apply both, then check the frontend against `CONTRACT-NOTE-capture.md` and `CONTRACT-NOTE-transcribe.md`. Known points:
   - `transcription-progress` keys are `job_id` and `audio_path` (no `jobId`, no per-segment text).
   - `stop_recording.tracks` holds only `mic` and `system` for source "both" and is empty for a single source; `mix` is not a track role.
   - Preflight never returns `system_audio: "denied"`; denial shows up as a `silence` warning with `source: "system"`.
   - There is no close/quit veto (declined: a wrong guess could make the app unquittable); a quit mid-recording is recovered at next launch via `recover_orphan_recordings`.
   - `import_media` returns `audio.m4a` only when `afconvert` succeeded on macOS, else `audio.wav`: use the returned `audio_path`.
   - A waiting transcription job emits no events (no "queued" stage from the backend).
3. After merging: re-add a WAV writer → real decoder round-trip test (dropped by `capture` because `transcribe` was changing the decoder); set the i18n CEILING in `src/lib/__tests__/i18n-coverage.test.ts` to what its stale-ceiling check asks; update `docs/features/ai-workflows.md` (still describes the old recorder).
4. Gates: `pnpm typecheck`; `pnpm test` (check the exit code and the `Errors` line); Playwright with a local config pointing at the preinstalled Chromium (`playwright.local-chromium.config.ts`, not committed: extends `playwright.config.ts` with `launchOptions.executablePath: '/opt/pw-browsers/chromium'`; run with `--project=chromium --trace off`); `cargo check` and `cargo check --tests` with `PKG_CONFIG_PATH="$(pwd)/.pkg-config-stubs"` after `src-tauri/scripts/generate-pkg-config-stubs.sh`. `cargo test` only runs on macOS CI.
5. Then: commit, push, open a PR, watch CI, release as v0.65.0 (bump `package.json`, add `docs/history/242-release-v0.65.0.md` and a README row, `pnpm generate-changelog`). Tags cannot be pushed from the cloud session; the owner creates them:
   `gh api repos/PeterBlenessy/notesage/git/refs -f ref=refs/tags/v0.65.0 -f sha=$(gh api repos/PeterBlenessy/notesage/commits/main --jq .sha)`

## Never verified on a real Mac

- System audio capture (cpal loopback, macOS 14.2+), AAC encoding via `/usr/bin/afconvert`, the microphone permission preflight: compiled for the Mac target, never run.
- Transcription with a real Whisper model: 10-minute part boundaries, the silence gate, progress and abort callbacks, Swedish and English quality.
- Everything shipped in v0.62.0 to v0.64.0 was verified by tests and CI, not in the Mac app: library follow, MCP against a real server, provider and agent, the Settings button (cause found only for translucent chrome ON), the caret above the command bar, the indexing indicator, Inbox performance.
- Manual Mac test scripts: 16 steps for capture and 10 for transcription, in the lanes' final reports in the session transcript; the CONTRACT-NOTEs summarise the behaviour they check.

## Open items outside recording

- Model download checksums: the mechanism exists; `MODEL_REVISION` is still `main` and hashes are `None` (the model host is not reachable from the cloud session).
- Agent-started MCP servers cannot cold-start `npx -y` / `uvx` inside the agent sandbox (package caches read-only, npm registry not allowed): the owner decides whether to open the sandbox.
- Projects inside `~/Notesage` are counted twice in tags and mentions (the global index scans that folder too).
- The raw markdown view was not checked for the caret-behind-command-bar problem.
- Audit issues still open: #1090, #1091, #1092 (large files), #1094, #1095, #1096, #1105 and the per-area roll-ups (#1111 to #1122, #1124), each with a status comment.
- "Notesage i siffror": https://claude.ai/artifact/Q4wC5fwdE3b3ySZRwPaLt9 (built before v0.64.0 finished, so it shows that release as in progress).

## Working agreements with the owner

- The owner does not review code: test until it works, then report plainly, including what was not verified.
- Ask before pushing, opening a PR or merging; the owner merges and creates tags.
- Never say "tab": the app has one open document.
- Layout bugs and features that exist in code but are never wired up have repeatedly hidden behind passing unit tests: reproduce in a real browser, and look for code with no consumer.
