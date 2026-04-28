# Cmd Bar Verb Prefixes + Quick Capture Removal — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-28 |
| **Status** | Not started |
| **PRD** | [cmd-bar-verb-prefixes](../prds/2026-04-28-cmd-bar-verb-prefixes.md) |
| **Total** | 14 tasks: 10S, 4M |
| **Suggested order** | Backend (#1) → Quick Capture removal (#2 + #3, parallel-safe) → Verb infra (#4 → #5 → #6 → #7) → `:file` mode (#8 → #9 → #10 → #11) → Tests + docs (#12 → #13 → #14) |

## Risks + open questions

- **Verb registry shape** — keep separate from `prefix-modes.ts` (single-char detector logic doesn't generalize cleanly). Tracked in PRD "Open questions"; #4 locks the answer.
- **`Tab` event interception inside the cmd bar** — the bar's input is portal-mounted; need to make sure `event.preventDefault()` actually short-circuits the browser's native focus traversal. Verify in #6.
- **`⌘⇧F` chord conflict with editor's "open file" muscle memory** — there's no current binding so reassignment is technically free, but doc the change loudly in keyboard-shortcuts.md (#14).
- **`:file` filename search at scale** — `WHERE name LIKE` over an unindexed column is fine for the typical N=1k–10k workspace files but degrades at N=100k+. Out of scope; flagged for the FTS-on-name follow-up if the result list ever feels slow.

---

## Tasks

### #1 — Add `index_search_filenames` Tauri command ✅

| Field | Value |
| --- | --- |
| Description | New backend query: case-insensitive substring match against `files.name`, scoped to the passed `project_paths`, capped at 50 hits. Result shape: `{ path, file_name, parent_dir, project_root: Option<String> }` (project_root null for `~/Notesage` library files). Mirror the lifecycle of `index_search_content` (`src-tauri/src/index/mod.rs:835`). Also add the `tauriApi.indexSearchFilenames(projectPaths, query, limit?)` wrapper in `src/lib/tauri.ts` to match the existing `indexSearchContent` signature. Rust unit tests cover: in-scope match, out-of-scope file excluded, hidden filename returned (the filter is in JS, not Rust — Rust always returns hits), limit enforced, empty query returns empty list (don't return everything). |
| Complexity | M |
| Category | backend |
| Depends on | — |
| Files | `src-tauri/src/index/mod.rs`, `src-tauri/src/index/queries.rs`, `src-tauri/src/lib.rs` (add to `generate_handler!`), `src/lib/tauri.ts` |

### #2 — Delete Quick Capture from PaletteMode + App.tsx router

| Field | Value |
| --- | --- |
| Description | Remove the `quick-capture` palette entry at `src/components/cmd/modes/PaletteMode.tsx:198-202` and the matching `case "quick-capture":` branch in `src/App.tsx` (around line 666). Sweep for any other in-code references with `grep -rn "quick-capture\|quickCapture\|QuickCapture" src/ src-tauri/src/` before committing — current sweep shows only those two live sites plus the doc claims handled in #3. No backwards-compat shim, no commented-out scaffolding. |
| Complexity | S |
| Category | frontend |
| Depends on | — |
| Files | `src/components/cmd/modes/PaletteMode.tsx`, `src/App.tsx` |

### #3 — Quick Capture removal — doc updates

| Field | Value |
| --- | --- |
| Description | Three doc surfaces: (a) `docs/keyboard-shortcuts.md` — drop the "Quick capture (`⌘⇧Space`) is NOT shipped" warning block AND the matching "Future shortcuts" entry; (b) `docs/product-description.md` — strike the `~~Quick Capture window (Cmd+Shift+Space)~~` line in the System Tray phase summary (don't add a new "deferred" note — the decision is removal, not deferral); (c) `docs/audits/2026-04-27-quiet-composer-migration.md` — flip finding #2 to "Resolved (removed, not built)" with a backref to this PRD. Bundle into the same commit as #2 so the surface is internally consistent at every checkout. |
| Complexity | S |
| Category | docs |
| Depends on | #2 |
| Files | `docs/keyboard-shortcuts.md`, `docs/product-description.md`, `docs/audits/2026-04-27-quiet-composer-migration.md` |

### #4 — Verb registry module

| Field | Value |
| --- | --- |
| Description | New `src/components/cmd/verb-modes.ts` (sibling to `prefix-modes.ts`). Exports `VerbId` type, `VerbMode` interface (`{ id, name, label, icon, description }`), `VERBS` registry keyed by id. Initial entry: `file` (icon `FileText`, label `File`, description `Find a file by name`). No detector logic in this file — pure data + types, mirroring the logic-only contract of `prefix-modes.ts`. Acceptance: a future verb (e.g., `find-in-files`) lands by appending one entry; nothing in the bar's orchestrator needs to change. |
| Complexity | S |
| Category | frontend |
| Depends on | — |
| Files | `src/components/cmd/verb-modes.ts` |

### #5 — `detectActiveVerb` detector + tests

| Field | Value |
| --- | --- |
| Description | Add `detectActiveVerb(input, cursorPosition): ActiveVerb \| null` to `verb-modes.ts`. Activation rules mirror `detectActivePrefix` in `prefix-modes.ts`: `:` must be at start-of-input or preceded by whitespace; the verb-name token runs from `:` to the next whitespace; everything after that whitespace and up to the next is the verb's filter input; cursor must sit anywhere inside the active region. Result shape: `{ verb: VerbMode \| null, verbStart, verbEnd, filterStart, filterEnd, filter, source: 'typed' \| 'chord' }` — `verb: null` represents bare `:` or unmatched-name input (drives the discovery menu). Unit tests: bare `:`, `:fil` (no match), `:file` (full match, cursor in name), `:file foo` (cursor in filter), `:file foo bar` (filter only includes `foo`), `: file` (whitespace after `:` → null), `text :file` (mid-word → null unless preceded by space), Esc-source default `'typed'`. |
| Complexity | S |
| Category | frontend |
| Depends on | #4 |
| Files | `src/components/cmd/verb-modes.ts`, `src/components/cmd/__tests__/verb-modes.test.ts` |

### #6 — `computeTabCompletion` pure function + tests

| Field | Value |
| --- | --- |
| Description | Pure helper in `verb-modes.ts`: `computeTabCompletion(input, cursor, verbs): { newInput, newCursor, jumpToFilter: boolean } \| null`. Returns null when there's nothing to do (`Tab` falls through). Otherwise returns the next state per the PRD's autocomplete table — longest unambiguous prefix; full match adds a trailing space and signals `jumpToFilter: true`. Unit tests cover all 7 rows of the PRD's autocomplete table verbatim, plus: cursor outside the verb-name token (`:file foo<cursor>` → null, Tab is the verb's filter to handle); empty registry (always null); a future-verb fixture array (don't hardcode against the live `VERBS`). |
| Complexity | S |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/cmd/verb-modes.ts`, `src/components/cmd/__tests__/verb-modes.test.ts` |

### #7 — Wire verb detection into FloatingCommandBar

| Field | Value |
| --- | --- |
| Description | In `src/components/cmd/FloatingCommandBar.tsx`, run `detectActiveVerb` alongside `detectActivePrefix` on each input/selection change. When a verb is active, render the verb's mode picker (`#8`) in the same area noun pickers render today; when verb is bare-`:` (no match yet), render a discovery list of every entry in `VERBS` filtered by the partial name (`:f` narrows to verbs starting with `f`). Discovery list: arrow keys navigate; `Enter` autocompletes to `:name ` and jumps focus to the filter slot. `Tab` keydown handler at the input level calls `computeTabCompletion`, applies the result via `setInputValue` + `setSelectionRange`, and `event.preventDefault()`s so browser focus traversal never fires. Mode badge: when a verb is active, show the verb's icon (mirrors single-char modes showing the noun's icon). Esc-source semantics: typed `:foo` first Esc clears just the verb (collapses back to chat mode, bar stays expanded); chord-seeded `:file ` first Esc collapses the bar (mirror of the existing typed-vs-chord rule in `ActivePrefix.source`). Verbs and prefixes are mutually exclusive — if `detectActivePrefix` returns non-null, ignore `detectActiveVerb` (single-char prefixes win to preserve every existing chord). |
| Complexity | M |
| Category | frontend |
| Depends on | #4, #5, #6 |
| Files | `src/components/cmd/FloatingCommandBar.tsx`, `src/components/cmd/CommandBarContext.tsx` (mode badge if it lives there) |

### #8 — `FileMode` picker component

| Field | Value |
| --- | --- |
| Description | New `src/components/cmd/modes/FileMode.tsx`. Shape mirrors `ReferenceMode.tsx` and `ResearchMode.tsx`: takes `{ filter, onSelect, onDismiss }` props, debounces the filter against `tauriApi.indexSearchFilenames` (300 ms), renders a vertical list of results — file icon (resolved from `getFileType`/`FileIcon` like the sidebar), basename in bold, parent directory in muted text. Arrow keys navigate; `Enter` invokes `onSelect(path)` which opens the file in a new editor tab via `useFileOperations.openFile`; `Esc` dispatches the standard dismiss event. Empty filter and MRU empty-state are handled in #10 — for #8 just render "Type to search" when filter is empty. |
| Complexity | M |
| Category | frontend |
| Depends on | #1, #4 |
| Files | `src/components/cmd/modes/FileMode.tsx`, `src/components/cmd/__tests__/FileMode.test.tsx` |

### #9 — `FileMode` scope + hidden-files gating

| Field | Value |
| --- | --- |
| Description | `FileMode` reads scope from the same source `@reference` and `?research` use: `selectProjectPaths(chat-store)` for the active conversation, plus `~/Notesage` library root, plus all workspace paths when `settings.crossProjectMode` is true. Pass that scope to `tauriApi.indexSearchFilenames(projectPaths, ...)`. After results return, drop entries whose basename starts with `.` unless `settings.showHiddenFiles` is true (`.DS_Store` is always dropped). The Rust query in #1 doesn't filter — keep the toggle pure-frontend so the user can flip it without re-querying. Add tests for: in-scope hit, out-of-scope file excluded by scope, dotfile excluded with toggle off, dotfile included with toggle on, `.DS_Store` always excluded. |
| Complexity | S |
| Category | frontend |
| Depends on | #8 |
| Files | `src/components/cmd/modes/FileMode.tsx`, `src/components/cmd/__tests__/FileMode.test.tsx` |

### #10 — `FileMode` MRU empty-state

| Field | Value |
| --- | --- |
| Description | When `filter` is empty, render `editor-store.recentFiles` instead of "Type to search". Apply the same scope filter from #9 — only show MRU entries inside the active scope (an out-of-scope MRU entry is silently hidden). Same row layout as the search-result rows so the visual transition is seamless when the user starts typing. No backend call when filter is empty. Test: empty filter renders MRU; out-of-scope MRU entry is excluded; toggling `showHiddenFiles` updates the MRU list. |
| Complexity | S |
| Category | frontend |
| Depends on | #9 |
| Files | `src/components/cmd/modes/FileMode.tsx`, `src/components/cmd/__tests__/FileMode.test.tsx` |

### #11 — Wire `⌘⇧F` to seed `:file `

| Field | Value |
| --- | --- |
| Description | In `src/hooks/useCommandBarShortcuts.ts`, add a `⌘⇧F` chord branch (mirror the `⌘⇧P` block at line 100). `event.preventDefault()`, then `emitCmdBarEvent({ type: 'focus', prefix: ':file ' })` — the trailing space is intentional so the cursor lands in the filter slot, not in the verb name. The bar's existing `focus` subscriber already handles the `prefix` field (`src/components/cmd/FloatingCommandBar.tsx`) — verify it inserts the literal value as-is and sets selection to end. Set `source: 'chord'` on the resulting `ActiveVerb` so first-Esc collapses the bar (matches the typed-vs-chord rule). Test: chord seeds the bar, cursor lands in the filter slot, mode badge shows the FileMode icon. |
| Complexity | S |
| Category | frontend |
| Depends on | #7 |
| Files | `src/hooks/useCommandBarShortcuts.ts`, `src/components/cmd/FloatingCommandBar.tsx` (only if the focus subscriber needs a tweak) |

### #12 — `FileMode` integration test

| Field | Value |
| --- | --- |
| Description | End-to-end test under `src/components/cmd/__tests__/FileMode.integration.test.tsx`: mount `<QuietLayout />` (or the cmd bar in its harness), simulate `⌘⇧F`, assert the bar focuses with `:file ` prefilled, type a query, assert results render, press `Enter`, assert the file opens in a new tab via `editor-store.openDocuments`. Cover the scope path: with one project selected vs. all projects (`crossProjectMode`). Cover the empty path: empty filter shows MRU; no-match shows the documented empty state. Use the existing tauri-mock infrastructure (`src/test/tauri-mock.ts`) to stub `index_search_filenames`. |
| Complexity | M |
| Category | test |
| Depends on | #11 |
| Files | `src/components/cmd/__tests__/FileMode.integration.test.tsx` |

### #13 — Quick Capture removal regression test

| Field | Value |
| --- | --- |
| Description | Smoke test under `src/components/cmd/__tests__/no-quick-capture.test.ts` that greps the runtime source for any reintroduction of `quick-capture` / `quickCapture` / `QuickCapture` literals (mirrors the `no-tree-overlay.test.ts` pattern landed in sidebar #21). Excludes test files, the audit doc, and the PRD itself from the sweep. Locks the removal in so a future palette refactor can't silently re-add the entry. |
| Complexity | S |
| Category | test |
| Depends on | #2, #3 |
| Files | `src/components/cmd/__tests__/no-quick-capture.test.ts` |

### #14 — Final docs sweep — keyboard-shortcuts + architecture

| Field | Value |
| --- | --- |
| Description | (a) `docs/keyboard-shortcuts.md` — under "App Navigation", change `⌘⇧F Find files` to "Focus the command bar with `:file ` prefix → FileMode (verb command)" with a sub-bullet explaining the prefix grammar (single-char = noun pickers, `:` = verb commands). Add a new "Command Bar Verb Prefixes" section listing registered verbs (`:file` for now), the autocomplete + discovery rules from the PRD, and the `Tab` behavior. Remove the "Future shortcuts" entry about file-search since it ships now. (b) `docs/architecture.md` — under "Project Structure", add `cmd/verb-modes.ts` to the lib utilities row and `cmd/modes/FileMode.tsx` to the cmd modes row. (c) Under "State stores": no change (no new store). Bundle this with the #11 commit so the binding and its docs land together. |
| Complexity | S |
| Category | docs |
| Depends on | #11 |
| Files | `docs/keyboard-shortcuts.md`, `docs/architecture.md` |

---

## Bundling guidance

Per Notesage convention, doc updates ride with the code change that earns them. Concrete bundles:

| Bundle | Tasks | Commit message shape |
| --- | --- | --- |
| Backend foundation | #1 | `feat(index): index_search_filenames Tauri command for cmd-bar :file mode` |
| Quick Capture removal | #2, #3, #13 | `refactor(cmd-bar): DELETE Quick Capture — palette entry, App router branch, doc claims` |
| Verb infrastructure | #4, #5, #6, #7 | `feat(cmd-bar): :-verb prefix grammar — registry + detector + Tab autocomplete + discovery menu` |
| `:file` mode | #8, #9, #10, #11, #12, #14 | `feat(cmd-bar): :file verb — filename search with scope, MRU, hidden-files toggle, ⌘⇧F chord` |

The bundles are independent except for the `:file` bundle depending on both prior bundles. Quick Capture removal can land first and ship in a patch release on its own if needed.

## Ship gate

- [ ] All 14 tasks merged
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm test:perf` all pass
- [ ] No `quick-capture` / `quickCapture` / `QuickCapture` strings remain in `src/` (#13 enforces)
- [ ] Manual smoke: `⌘⇧F` opens the bar with `:file ` and cursor in the filter slot; typing narrows results; `Enter` opens the file in a new tab; `:` alone shows the verb discovery list; `:f<Tab>` autocompletes per the PRD table; Esc semantics match the typed-vs-chord rule; PaletteMode no longer lists Quick Capture
- [ ] Audit `2026-04-27-quiet-composer-migration.md` findings #2 + #3 marked resolved
