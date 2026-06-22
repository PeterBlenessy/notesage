# Testing handover — OKF wiki-navigation (PR #487)

**PR:** https://github.com/PeterBlenessy/notesage/pull/487 — CI green, label `tier:C`
(awaiting human test + review). **The PR diff + the ADRs are the spec; this doc is only
the testing orientation** — don't re-derive scope from scratch, read those.
**Branch:** `claude/okf-notesage-integration-s6x1rf` (merged with `main`).
**Target platform:** macOS. Everything to date was built/verified **headless on Linux** —
no part of this feature has run in the real app, so live behaviour is exactly what this
pass is for. CI is green (`cargo test`, Playwright, frontend, real Tauri E2E), but green
unit/integration tests are not "it works."

## Suggested skills (invoke these)

- **`run`** — launch and drive the real app; this is the primary tool for the pass
  (open a project, exercise the panel / hover / `[[` flows, screenshot).
- **`test-e2e-real`** — real E2E against a live Tauri app (WebDriverIO). Closest thing to
  automated coverage of the backend↔frontend seam that the headless build couldn't run.
- **`verify`** — check the implementation against the PRD quality gates
  (`docs/prds/2026-06-19-okf-wiki-navigation.md`).
- **`review-ui`** + **`audit-accessibility`** — cover the one open `aw-review` ⚠: visual
  polish in light/dark/soft-contrast, plus the reduced-motion pulse, focus states, and
  contrast of the new panel/badges.
- **`test-markdown-roundtrip`** — back the `[[`-serialization check (no `[[ ]]` on disk).
- **`test-frontend`** — quick typecheck + vitest sanity if you touch any frontend code.

---

## ⚠️ The #1 false-bug trap — test data must be in scope

The link graph indexes **projects + `~/Notesage` only**. **Explorer folders are
deliberately excluded** (a data-security decision — see ADR 0003 / `docs/architecture.md`).
If you open your test folder as an *Explorer folder*, the Relations panel will correctly
show **nothing** — that is not a bug.

➡️ **Open your test files as a Project, or place them under `~/Notesage`.**

## Set up meaningful test data

A project with several `.md` files that:

- link to each other with **relative markdown links** — `[Todo](./todo.md)`,
  `[Spec](../specs/spec.md)`;
- a few carrying `type` / `title` / `description` YAML frontmatter (to see OKF `type`
  badges + descriptions enrich the panel);
- at least one **dangling** link to a non-existent file (for broken / create-on-click).

## Where bugs are most likely — focus here

1. **Parser path resolution vs the editor's.** The Rust parser (`resolve_internal_target`
   in `index/parser.rs`) must resolve relative targets the same way the frontend
   `link-click.ts` does. **Test `../` parent-dir links and subfolder links** — if they
   diverge, a link opens in the editor but doesn't show in the graph (or vice-versa).
2. **The backend↔frontend seam** (never run end-to-end): edit a doc → watcher reindexes →
   `links.db` updates → panel reflects it. Edit a link, save, and confirm the panel
   updates (allow a moment to reindex).
3. **Panel geometry** (pure CSS reasoning, never seen on screen): narrow window, sidebar
   resized, and especially the **command bar pinned** — confirm the Relations panel
   **offsets inward and stays visible** (it must NOT hide). This coexistence was a
   deliberate fix against ADR 0004.
4. **Hover preview** — DOM event delegation on `.ProseMirror`; verify it fires on internal
   links and shows title / type / description; unresolved target → "Not yet created —
   click to create."
5. **`[[` round-trip** — type `[[`, pick a target → inserts `[Title](./rel/path.md)`;
   **save + reopen → the markdown on disk must be clean, with no `[[` surviving.**
6. **okf-enrich** (least-verified — only its deterministic scripts ran, never the AI
   structured-output round-trip): run it on an untyped note; confirm the **`write_file`
   approval prompt** fires and it is **additive-only** (never overwrites existing
   `type` / `title` / `description`).
7. **Reduced-motion** → the handle attention pulse must be suppressed.

## Expected behaviours that are NOT bugs (please don't file these)

- The panel **self-hides entirely** (no handle at all) when a doc has zero relations, and
  briefly while loading.
- **Renaming a link target** leaves backlinks pending/broken until the linking docs are
  re-saved — `reconcile_rename` is intentionally unwired (mirrors on-disk link reality).
- A **dangling `[[Thing]]`** serializes to `[Thing](./thing.md)` pointing at a
  non-existent file — intended (create-on-click), not a broken-link defect.
- Wikilink resolution is **workspace-global** (matches across projects) — by design
  (ADR 0002).
- **Cross-project backlinks show for humans** but never reach AI context — by design
  (ADR 0002; regression-locked).

## Debugging aids

- Inspect the graph directly:
  ```
  sqlite3 ~/.notesage/links.db \
    'SELECT source_path,target_path,is_internal,target_file_id FROM link_edges;
     SELECT * FROM link_files;'
  ```
  If the panel is empty, check, in order: (a) opened as a **project**, not an explorer
  folder; (b) `links.db` actually has rows; (c) the document really contains
  relative-markdown links.
- Console: `[perf:index]` logs show indexing activity.
- Tauri commands to poke: `get_backlinks`, `get_outlinks`, `get_broken_links`,
  `resolve_wikilink`.

## Key files if you need to dig

- **Backend:** `src-tauri/src/index/links.rs`, `index/parser.rs` (`parse_links`),
  `index/mod.rs` (`index_links_for_file` scope gate).
- **Frontend:** `src/components/editor/RelationsPanel.tsx`,
  `src/hooks/useDocumentRelations.ts`,
  `src/components/editor/extensions/wiki-link.tsx`,
  `src/components/editor/EditorLinkHoverPreview.tsx`, `src/lib/link-utils.ts`.
- **Skill:** `bundled-skills/okf-enrich/`.
- **Design rationale:** `docs/adr/0001`–`0008`, `CONTEXT.md`,
  `docs/prds/2026-06-19-okf-wiki-navigation.md`.

## Known caveats / deferred (already documented in the PR)

- `reconcile_rename` implemented + tested but unwired (follow-up).
- ADR 0002's per-link cross-project AI permission UI deferred — no consumer follows a
  link edge into AI context yet; the isolation invariant + regression-lock shipped instead.
- The two `aw-review` ⚠ items are non-code: visual polish in light/dark/soft-contrast
  (a human eyeball), and perf (M3-calibrated; CI ran it green).
