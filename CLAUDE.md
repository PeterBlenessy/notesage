# CLAUDE.md — Notesage Project Spec

## What is Notesage?

Notesage is a rich text markdown editor with AI collaboration capabilities, packaged as a lightweight desktop application using Tauri v2.

**Current version:** see the `version` field in `package.json` (ships on an alpha pre-release channel). Not duplicated here — a hardcoded version line drifts; `package.json` is the single source of truth.

## Autonomy

Default: act on anything reversible and cheap. Read, edit, run tests, research, draft, experiment locally. Do it, then report.

Ask first only for:
1. **Ships outward:** deploy, publish, send, post, **push a branch, open a PR, merge to main** — or anything users/collaborators will see.
2. **Real spend:** estimated cost over $10. Big batch jobs, new infra, paid runs at scale.
3. **Irreversible:** deleting or overwriting work you didn't create, force-push, dropping data.
4. **Commit / "done":** I tend to call work done before it is. Always show the diff + what's still open and wait for an explicit go before committing. This overrides "reversible → act" — the gate is about completeness, not safety.

Reversible + cheap → act, then report. Otherwise → ask first.

**"Done" means:** acceptance criteria met, tests + typecheck green, self-reviewed for obvious bugs, and no known gaps quietly deferred. If any of those is unmet, say what's left — don't say "done."

**Review/audit mode:** when asked to review, investigate, or audit, report findings only — don't act on them (even reversible edits) until told to proceed.

## Code Conventions

- **Language:** All code, comments, variables in English
- **Components:** Functional React with hooks. No classes.
- **Naming:** PascalCase (components), camelCase (functions/vars), UPPER_SNAKE (constants)
- **Files:** One component per file. Filename = component name.
- **Types:** Prefer interfaces. No `any` (use `unknown`).
- **Typecheck gate:** `vitest` / `pnpm test` do NOT run `tsc` — a green test run says nothing about types. After editing ANY `.ts`/`.tsx` (including `*.test.ts` and mocks), run `pnpm typecheck` before calling the work done. CI's frontend job runs `tsc --noEmit` over test files too, so a type error in a test (e.g. an untyped `vi.fn()` mock whose `.mock.calls` is an empty tuple) fails the whole job even when every test passes.
- **Errors:** Tauri returns `Result<T, String>`. Show toast for user errors.
- **Radix Tooltip:** Every `<Tooltip>` MUST be wrapped in `<TooltipProvider>`. Radix throws at render time without it (see `docs/design-system.md` §"Radix Tooltip — `<TooltipProvider>` is mandatory").

## Documentation

**Before building anything, read the relevant docs:**

| Need | Read |
| --- | --- |
| Core architecture, tech stack, project structure | docs/architecture.md |
| UI/UX requirements, typography, colors, component specs | docs/design-system.md |
| Overview, roadmap, quality gates | docs/product-description.md |
| Tauri command signatures, IPC patterns | docs/tauri-commands.md |
| All keyboard shortcuts | docs/keyboard-shortcuts.md |
| Implementation history | docs/history/ |
| Product requirements | docs/prds/ |
| AI dev-process pipeline (issue → triage → refine → slice → tdd → PR → retrospect), label state machine, skills + workflows | docs/agentic-workflow.md |

**Feature-specific docs (read when working on that area):**

| Feature area | Read |
| --- | --- |
| Editor, find, tags, formatting | docs/features/editor.md |
| Editor internals (ProseMirror, decorations, extensions) | docs/features/editor-architecture.md |
| AI providers, connections, routing, local AI, completions | docs/features/ai-providers.md |
| Chat, agents, skills, MCP, delegation, research, voice | docs/features/ai-workflows.md |
| EPUB, PDF export, DOCX, viewers | docs/features/document-formats.md |
| Projects, file tree, iCloud, git, external changes | docs/features/workspace.md |
| Automations (triggers, steps, agent-step provider & permissions, builder) | docs/features/automations.md |
| iOS mobile app (read-only reader + share capture) | docs/features/mobile.md |
| Inbox on the desktop (read-later list, filing, the shared reading-progress sidecar) | docs/features/inbox.md |

## Performance Tracking

After any work that touches startup, skills, tree loading, editor rendering, or Tauri IPC hot paths:

1. **Run `pnpm test:perf`** — synthetic benchmarks must pass within budget
2. **Check real-world startup** — open the app (dev mode), capture `[perf:*]` console logs, compare against the baseline in `docs/performance-baseline.md`
3. **Record new measurements** — append a dated entry to the "Startup Performance" section in `docs/performance-baseline.md` with the commit hash. Never overwrite previous entries — the history is the point.

Key metrics to capture: `phase1-ready` (tools visible), `startup ready`, `tree refresh`, `skills total`, and any metric that changed significantly.

## Backend (Rust/Tauri)

When modifying Rust files in `src-tauri/`, the running `pnpm tauri dev` process hot-reloads Rust changes automatically. However, if hot-reload fails or you see stale behavior after changing Tauri commands (adding/removing/renaming commands, changing signatures), run a clean rebuild:

```bash
cd src-tauri && cargo clean && cd .. && pnpm tauri dev
```

**When to clean rebuild:**
- Added or removed a `#[tauri::command]` function
- Changed command signatures or the `generate_handler![]` list in `lib.rs`
- Changed Cargo dependencies
- Unexplained "command not found" errors from the frontend

### Compiling Rust in a headless / Linux / CI environment (no GUI stack)

The app targets macOS, and a full `cargo build` / `cargo test` needs the system GTK/WebKit dev libraries (`libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`, `libasound2-dev`, …) that are usually absent in a Linux dev container or cloud session. **Do not burn time trying to `apt install` the whole GUI stack** — for verifying that Rust changes compile, use the committed pkg-config stubs instead:

```bash
src-tauri/scripts/generate-pkg-config-stubs.sh          # one-time per session; writes src-tauri/.pkg-config-stubs/ (gitignored)
cd src-tauri && PKG_CONFIG_PATH="$(pwd)/.pkg-config-stubs" cargo check
```

This makes `cargo check` (compile-only, no linking) succeed without the real libraries, which is enough to catch type/borrow/API errors — the actual risk when editing backend Rust. The dep tree (incl. heavy crates like `sentry`, `typst`, `whisper-rs`) compiles fine this way; the first run is slow (cold target dir), later runs are incremental.

**Limits:** stubs provide pkg-config metadata, not headers or libs — so a full `cargo build`/`cargo test` (which links) still needs the real `-dev` packages and is left to CI (`.github/workflows/test.yml` "Rust Backend Tests" runs `cargo test` on macOS). Locally, treat a green `cargo check` as the backend gate and let CI run `cargo test`.

## iOS: driving the Simulator from the command line

Screenshots alone do not verify a gesture. `xcrun simctl` has no touch input,
so use **`idb`** — it talks to the Simulator's HID layer, which means it also
works when the Mac's screen is **locked** (`cliclick` cannot: a locked screen
leaves the Simulator app with zero windows).

```bash
# once per machine — idb_companion comes from brew, the CLI does not
brew install idb-companion
python3 -m venv /tmp/idbenv && /tmp/idbenv/bin/pip install fb-idb

export PATH="/opt/homebrew/bin:$PATH"          # idb must find idb_companion
/tmp/idbenv/bin/idb connect <SIM-UDID>

/tmp/idbenv/bin/idb ui tap   --udid $U X Y
/tmp/idbenv/bin/idb ui swipe --udid $U --delta 4 --duration 0.5 X1 Y1 X2 Y2
/tmp/idbenv/bin/idb ui text  --udid $U "typed text"
```

- **Coordinates are device POINTS, not screenshot pixels.** A screenshot from
  `simctl io booted screenshot` is 3× on a 3x device (1206×2622 px = 402×874
  pt) — divide by three. No window-rect calibration is needed.
- **`--duration` is effectively required for swipes.** Without it the gesture
  is delivered instantaneously, UIKit reads it as a TAP, and a swipe across a
  list row opens the document instead of swiping it. ~0.4–0.5s with
  `--delta 4` behaves like a finger.
- **Works:** taps, in-view pans (scrolling), text entry, hardware buttons.
- **Does NOT work:** the system screen-edge pan. A swipe from `x=2` does not
  drive `interactivePopGestureRecognizer` — verified against the reader, whose
  swipe-back is known-good on device. The interactive back gesture cannot be
  verified here; say so rather than claiming it.
- Screenshot BEFORE each step to establish state: the app restores its last
  open document on launch, so "tap the first row" can land somewhere else.
- **Always pass the explicit UDID, never `booted`.** More than one simulator
  can be booted at once (a build or `idb connect` can boot a second), and then
  `xcrun simctl io booted screenshot` silently picks the wrong device — the
  giveaway is a screenshot at an unexpected resolution. Use
  `xcrun simctl io $UDID screenshot`, and `xcrun simctl list devices booted`
  to check.

**Before trusting any simulator screenshot, check the build actually landed.**
`tauri ios build --target aarch64-sim` can print `** BUILD SUCCEEDED **` and
still leave the PREVIOUS `.app` in place, because the export cannot overwrite a
non-empty archive directory:

```bash
rm -rf src-tauri/gen/apple/build/notesage_iOS.xcarchive \
       src-tauri/gen/apple/build/arm64-sim          # before every sim build
stat -f "%Sm" -t "%H:%M:%S" \
  src-tauri/gen/apple/build/arm64-sim/Notesage.app/Notesage   # after
```

If that timestamp is not from the last few minutes, the build did not land —
whatever the log said. A stale binary imitates every bug you might go looking
for.

## Versioning

The app version is defined in `package.json`. The Tauri config (`src-tauri/tauri.conf.json`) references it via `"version": "../package.json"` — only bump `package.json` when releasing.

`src-tauri/Cargo.toml` maintains its own independent crate version.

## AW pipeline & accumulated feedback

The Agentic Workflow (AW) pipeline orchestrates triage → refine → slice → tdd → review → iterate on GitHub issues. Skills live in `.claude/skills/aw-*/`; workflows in `.github/workflows/aw-*.yml`. The pipeline is documented in `docs/agentic-workflow.md`.

Every AW skill begins with **Step 0: Load accumulated rules** — it reads `.claude/feedback/INDEX.md` then loads the `feedback_*.md` rules whose `aw_applies_to` frontmatter targets this skill. These rules are behavioural corrections accumulated from interactive sessions, kept in the repo so the corpus travels with the project. New corrections land in `.claude/feedback/` via the `save-feedback` skill (write rule + run `scripts/gen-feedback-index.py` + stage for review). Each skill also carries an auto-generated "Most-relevant feedback rules for this skill" section at the bottom of its `SKILL.md` for quick lookup under context pressure.

The full integration plan and rationale: issue #336.

## Key Decisions

1. **ProseMirror:** Enables AI decorations, collaborative editing
2. **Tauri commands:** Security boundary for all I/O
3. **Zustand stores:** Persist middleware, clear boundaries
4. **shadcn/ui:** Compose, don't rebuild
5. **CSS variables:** Light/dark themes, future customization

## Resources

- Tauri v2 docs: https://v2.tauri.app
- Tiptap docs: https://tiptap.dev
- shadcn/ui: https://ui.shadcn.com
- Tailwind v4: https://tailwindcss.com
- ProseMirror: https://prosemirror.net
