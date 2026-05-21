# Release v0.45.0-alpha.1

**Date:** 2026-05-21
**Previous version:** 0.45.0-alpha.0
**Channel:** Alpha

A fix-focused alpha. Restores the agent mode picker for everyone whose AI provider connection was set up before the recent capability-probe change, fixes the `Cmd+Shift+E` / `Cmd+Shift+L` / `Cmd+Shift+R` keyboard shortcuts that an editor extension was silently capturing, and resolves the image hover toolbar styling inconsistency known issue from alpha.0.

## Changes

### Improvements

- **Agent mode picker reappears for existing AI connections.** If your Claude Code / Codex / Copilot / Gemini connection was set up before the recent capability-probe change, the mode picker (Shield icon) in the chat footer had silently disappeared. Opening the chat now restores it automatically — no need to re-add the connection or visit the connection config dialog.

- **Read Only mode tooltip describes what actually happens.** The previous wording suggested the agent would ask for permission before writes — but in Read Only mode the agent is told it has read-only access and silently doesn't try those operations, so no permission card ever surfaces. New tooltip: *"Read access only — agent is denied any write or execute tool calls."*

- **Image hover toolbar matches the chart / drawing / link-preview toolbars.** Visual consistency known issue from alpha.0 is resolved. The width and alignment popover now positions and styles the same as the other block-size toolbars.

### Fixes

- **`Cmd+Shift+E` (Export), `Cmd+Shift+L` (Sidebar), `Cmd+Shift+R` (Recording) work again.** An editor extension was silently capturing these chords for paragraph alignment. The export dialog opens, the sidebar pins / unpins, and recording starts / stops from the keyboard as documented.

## Under the hood

### Mode picker capability source — backfill from eager session

Commit `29013ce8` (alpha.0) changed the mode picker's data source from the live agent session to a persisted `connection.acpCapabilities` field set by a dedicated capability probe at connection registration. Existing connections from before that change have no `acpCapabilities` populated and the only auto-reprobe path runs when the user opens the Connection Config dialog — so until then, the picker is hidden even though the running agent reports its modes on every `session/new`.

The fix in #311 adds a `backfillAcpCapabilities(connectionId, session)` helper called from three places in `useAcpLifecycle` (eager-on-open, session restore, retry fallback). It copies `session.modes.availableModes` and `session.config_options` into `connection.acpCapabilities` whenever the user opens or switches a chat — no extra spawn, no extra IPC, no startup cost. No-op when caps are present and fresh (<24h).

### Cmd+Shift+E/L/R unblock — drop TextAlign default keymap

Tiptap's TextAlign extension ships with default keybindings for `Cmd+Shift+L/E/R/J` (left / center / right / justify). These shadowed Notesage's app-level chords (`Cmd+Shift+L` sidebar, `Cmd+Shift+E` export, `Cmd+Shift+R` recording). #265 sets `addKeyboardShortcuts() { return {}; }` on the TextAlign extension so paragraph alignment is reachable only through the toolbar / bubble menu — no keyboard regressions to user-visible features. (Alignment can be wired to non-conflicting chords later if there's demand.)

### Dependency surface

Five front-end / Rust dependencies advanced: `lucide-react` 1.8 → 1.16, `react-day-picker` v9 → v10, `comrak` 0.50 → 0.52, `rusqlite` 0.34 → 0.39, `scraper` 0.23 → 0.27. Frontend test suite (5201 unit + 37 Playwright) and Rust `cargo test` ran clean on the new versions; no functional regressions detected. Bundled local AI inference server (`llama.cpp`) bumped from `b8648` to `b9000`.

### Auto-release framework + Real Tauri E2E in CI

`.github/workflows/` gained `aw-alpha-prep.yml`, `aw-alpha-cut.yml`, `aw-merge.yml`, and `aw-rebase.yml` — an automation chain that classifies merged PRs by tier (A/B/C), enables GitHub native auto-merge on tier:A PRs once CI is green, rebases tier:A PRs that fall BEHIND, and cuts a new alpha tag automatically every 6h when at least one tier:A/B PR has merged and the Real Tauri E2E job on main is green within 24h. This release was cut manually (the local-control path) rather than via `aw-alpha-cut` because the two leading fixes were created in this session rather than via the labeled-PR pipeline.

The Real Tauri E2E job was also gated as a required check for alpha cuts (#260); a handful of small fixes landed to stabilize it on the macos-latest runner (`APP_READY_TIMEOUT` raised to 600s for cold-build, `openFile()` polls ProseMirror sentinel, `openProject` polls the store not the DOM, `state.tabs` → `state.openDocuments` field rename, etc.).

### Release-notes user-facing copy linter

`scripts/generate-changelog.ts` now emits a console warning for forbidden patterns in Features / Improvements / Fixes bullets (version triples like `1.0.0 → 1.1.0`, `Dependabot`, `transitive`, etc.). Warn-only — does not block releases.

## Files Changed

~30 PRs since v0.45.0-alpha.0. User-visible: #265 (TextAlign keymap), #305 (image hover toolbar), #310 (Read Only tooltip), #311 (caps backfill). Dependency / infra: #224, #250, #256, #257, #260, #270, #274, #275, #286, #290, #291, #293, #296, #297, #298, #299, #301, #303, #304, #306.
