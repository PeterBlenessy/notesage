# PRD: Quick Capture Removal + Extendable `:` Verb Prefixes

|  |  |
| --- | --- |
| **Date** | 2026-04-28 |
| **Status** | Draft |
| **Priority** | Medium — closes two open audit findings, opens a designed extension point for future verb commands |
| **Parent audit** | [2026-04-27-quiet-composer-migration.md](../audits/2026-04-27-quiet-composer-migration.md) findings #2 (Quick Capture) and #3 (file-search) |
| **Tasks** | [cmd-bar-verb-prefixes-tasks](../tasks/2026-04-28-cmd-bar-verb-prefixes-tasks.md) |

## Problem

Two open follow-ups from the post-Phase-1 Quiet Composer audit need locked-in product decisions before they can be tasked:

1. **Quick Capture (`⌘⇧Space`) was advertised but never built.** No global-shortcut plugin, no separate quick-capture window, no destination picker. The in-app `quick-capture` palette entry just opens the regular New Note dialog. The audit (finding #2) marked this as a CRITICAL doc lie; the cleanup path is removal, not implementation.
2. **No file-search mode in the Quiet Composer command bar.** Today `⌘⇧F` focuses the bar with no prefix, so typing routes to chat input. Users have to either expand a project in the sidebar and arrow into it, or type a guess into the no-prefix bar (which sends to AI). Finding #3 flagged this as a HIGH-priority gap.

The decision direction (per a 2026-04-28 conversation):

- Quick Capture: **remove**. Don't keep a half-promise in the UI.
- File-search: **implement**, but as part of a designed extension namespace so future verb-style commands (`:find-in-files`, `:goto-line`, `:settings`, …) can land cleanly without re-litigating the prefix grammar each time.

## Goals

1. **Quick Capture is removed end-to-end.** No palette entry, no doc claim, no commented-out scaffolding, no dead route. The PaletteMode and tray menu look like Quick Capture never existed.
2. **The command bar prefix grammar is locked.** Single-character prefixes are reserved for noun pickers (the existing `/`, `@`, `#`, `!`, `?`, `>` set). The `:` character is reserved for verb commands (multi-char names like `:file`, `:find-in-files`).
3. **`:file <query>` ships as the first verb.** Filename-only search across the active chat scope (selected projects + `~/Notesage`), backed by the existing SQLite document index. Selecting a result opens the file in a new tab.
4. **`:` autocomplete + discovery is built in.** Typing bare `:` opens a discovery menu listing every registered verb with its description. `Tab` from a partial match (`:f`, `:fi`, `:fin`) autocompletes to the longest unambiguous prefix; `Tab` from a full-name match (`:file`) jumps focus into the verb's filter input. This pattern is the same ergonomics shell users already know.
5. **The verb registry is extendable from one place.** Adding a new verb means adding one entry to a registry and writing one mode picker — same shape as the existing single-char modes. No grammar plumbing to revisit.
6. **No regression for existing single-char prefixes.** `/skill`, `@ref`, `#tag`, `!task`, `?research`, `>palette` keep working exactly as today, including chord seeding (`⌘⇧P` → `>`, `⌘1` → `!`, etc.).

## Non-goals

- **`:find-in-files` content search.** Acknowledged as the obvious next verb — the SQLite FTS table (`index_search_content`) already supports it — but out of scope for this PRD. Keeps the launch surface small and proves the verb-namespace pattern with one verb first.
- **Reviving Quick Capture via a new mechanism.** The decision is removal. If Quick Capture comes back later (`tauri-plugin-global-shortcut` + a separate window) it lands as its own PRD, not as a smuggled `:capture` verb.
- **`:` collision with markdown emoji shortcodes (`:smile:`).** The cmd bar is not a markdown editor — it's a command surface. The Tiptap editor handles `:emoji` autocompletion; the cmd bar treats `:` as a verb-prefix only. No code path crosses these surfaces.
- **`:`-prefix in chat input mode.** When the cmd bar is in chat mode (no prefix active), typing `:foo` is literal text sent to the AI. The verb mode only activates when `:` is at start-of-input (or after whitespace, mirroring the noun-prefix rule).
- **Renaming or migrating any existing single-char prefix.** All six stay as-is.

## Prefix grammar (locked)

| Namespace | Prefix shape | Examples | Mode resolves on |
| --- | --- | --- | --- |
| Noun pickers | Single character | `/skill-name`, `@reference`, `#tag`, `!task`, `?research`, `>palette` | First char of the active token |
| Verb commands | `:` + multi-char name + space | `:file foo`, `:find-in-files bar` (future) | The `:name` token, with mode-specific filter starting after the first space |

**Activation rules** (mirror the existing single-char behaviour in `prefix-modes.ts`):

- The prefix character (single char OR `:`) must be at start-of-input or preceded by whitespace.
- A noun-prefix token runs from the prefix to the next whitespace.
- A verb-prefix token runs from `:` to the next whitespace; everything after the first space is the verb's filter input.
- The cursor must sit inside the active region (the noun token, OR anywhere in the verb's filter slot).
- Otherwise: the `:` is literal text and the bar stays in chat mode.

**Esc behaviour** (mirror existing — see `ActivePrefix.source`):

- Typed `:` → first Esc clears just the verb (back to chat mode, bar stays expanded), second Esc collapses.
- Chord-seeded (`⌘⇧F` → `:file `) → Esc collapses immediately.

## `:` discovery + Tab autocomplete

Designed for shell-style ergonomics so the surface is discoverable for new users and fast for muscle-memory users.

### Discovery: bare `:`

When the input is exactly `:` and the cursor sits right after it, render a discovery list — same visual shape as the noun-prefix pickers, vertically stacked rows in the bar's expanded area. Each row shows:

- Verb name (`file`, `find-in-files`, …)
- One-line description (mirrors the `description` field on the existing `PrefixMode` records)
- Lucide icon (resolved by the verb-specific mode picker, same as today)

Arrow keys navigate the list; `Enter` activates the highlighted verb (= autocompletes to `:name ` and jumps focus into its filter). The list filters live as the user types more characters (`:f` narrows to verbs starting with `f`, `:fi` further narrows, etc.).

### Tab autocomplete

`Tab` while typing a verb name completes to the longest unambiguous prefix:

| Input | Verbs registered | `Tab` result |
| --- | --- | --- |
| `:` | `file`, `find-in-files`, `goto-line`, `settings` | `:` (bare — no common prefix) |
| `:f` | `file`, `find-in-files` | `:fi` (longest common prefix) |
| `:fi` | `file`, `find-in-files` | `:fi` (no further completion; the discovery list shows the two candidates) |
| `:fil` | `file` | `:file ` (single match — completes name AND appends a space, jumping focus into the verb's filter) |
| `:file` | `file` | `:file ` (already a full match — `Tab` adds the space and jumps focus) |
| `:file ` | `file` | (no-op — `Tab` is consumed by the verb picker which decides what to do with it; default is to insert a literal `\t` into the filter) |
| `:zzz` | (no match) | (no-op — input unchanged; the discovery list shows "No matching verb") |

`Tab` is captured by the cmd bar at the input level, not the OS, so it never moves focus out of the bar. `Shift+Tab` is reserved for future "cycle backward through suggestions" but is a no-op in this PRD.

### Auto-completion ambiguity rule

When a `Tab` press has more than one candidate AND the typed prefix is already the longest common prefix (`:fi` for `file` / `find-in-files`), don't beep, don't toast, don't auto-pick — surface the discovery list with the candidates filtered to the matching set. Same surface, same keyboard model.

## `:file` mode (the first verb)

### Behaviour

- Activated by typing `:file ` (with trailing space) OR by autocompleting from `:fil<Tab>`.
- Reserved chord: `⌘⇧F` seeds the bar with `:file ` and focuses the filter input. Replaces today's "focus the bar with no prefix" no-op behaviour for `⌘⇧F`.
- The filter input below the verb name accepts a substring; results render as a vertical list, same shape as `@reference`.
- Each result row shows: file icon (resolved from extension), basename, parent directory in muted text.
- `Enter` opens the highlighted file in a new editor tab. `↑`/`↓` navigates. `Esc` clears (per the rule above).

### Backend

- New `index_search_filenames` Tauri command (or extend `index_search_content` with a `filenames_only: bool`). The SQLite document index already has the `files` table — a `WHERE name LIKE '%query%' COLLATE NOCASE` query against it (capped at ~50 hits) is fast and zero new indexing cost.
- Scope: the user's chat-footer-selected projects plus `~/Notesage`. Same scope rules as `@reference` and `?research`. Out-of-scope files are not returned; `crossProjectMode` opt-in surfaces everything as today.
- Result shape: `{ path, file_name, parent_dir, project_root | null }`.

### UX edge cases

- Empty filter (`:file ` with nothing after) → render an MRU list: the recent-documents entries from `editor-store.recentFiles`, scoped the same way. Lets the user start scanning before they've typed.
- No matches → render "No files matching '<query>'" empty-state with a hint that hidden files are excluded by default (link to the Settings > System toggle).
- Hidden files: respect `settings.showHiddenFiles` (the same toggle the sidebar uses post-#4). Off by default → dotfiles excluded; on → included.

## Quick Capture removal scope

Three call sites + three doc claims. Each lands as part of the same removal commit so the surface is internally consistent.

### Code

| File | Change |
| --- | --- |
| `src/components/cmd/modes/PaletteMode.tsx` (lines ~198–202) | Delete the `quick-capture` palette entry. The shortcut field (`⌘⇧Space`) was always misleading — there's no shortcut binding. |
| `src/App.tsx` (line ~666) | Delete the `case "quick-capture":` branch in the palette router. Unreachable after the entry is gone. |
| Tray menu | The previous tray-menu hint about Quick Capture (if any survives in `src-tauri/src/tray.rs`) is removed in the same commit. (Survey at task-breakdown time — current grep shows no live ref.) |

### Docs

| File | Change |
| --- | --- |
| `docs/keyboard-shortcuts.md` | Drop the "Quick capture (`⌘⇧Space`) is NOT shipped" warning block AND the matching "Future shortcuts" entry. After removal there's nothing to disclaim. |
| `docs/product-description.md` | Strike the `~~Quick Capture window (Cmd+Shift+Space)~~` line in the System Tray phase summary. Don't re-add a "deferred" note — the decision is removal, not deferral. |
| `docs/audits/2026-04-27-quiet-composer-migration.md` | Mark finding #2 as "Resolved (removed, not built)" with a backref to this PRD. |

## Out of scope (acknowledged for future)

- **`:find-in-files`** — the SQLite FTS5 table is already populated by the indexing pipeline (`files_fts`); `index_search_content` already returns ranked results. Wiring it as a `:` verb is a small follow-up PRD once `:file` is in users' hands and the discovery + autocomplete UX has been validated.
- **`:goto-line N`**, **`:settings <area>`**, **`:cmd <id>`** — natural future verbs. Each is a follow-up PRD or task; the registry shape designed here accommodates them with no grammar churn.
- **Verb arguments beyond a single filter string** — none of the proposed verbs need structured args. If a future verb does (`:goto file:42`?), that's the verb's PRD to design.

## Acceptance criteria

1. The PaletteMode `quick-capture` entry is gone, and `⌘⇧Space` (which was never bound) is not mentioned anywhere in the shipped UI or docs.
2. Typing `:` in the FloatingCommandBar opens a discovery list of every registered verb with name + description + icon.
3. Typing `:f`, `:fi`, `:fil` against the registered set autocompletes per the table above (longest unambiguous prefix; full-match adds a trailing space and jumps focus to filter).
4. `Tab` is captured by the bar and never moves focus to the next browser-focusable element.
5. `⌘⇧F` from anywhere in Quiet Composer focuses the bar with `:file ` pre-filled and the cursor in the filter input.
6. With one or more projects selected in the chat footer, typing `:file readme` returns READMEs from those projects and from `~/Notesage` (and nothing else when `crossProjectMode` is off).
7. Empty filter (`:file `) lists MRU files from the same scope; no results renders the documented empty state.
8. Esc-from-typed `:file foo` clears just the verb; Esc-from-chord-seeded `:file ` collapses the bar. Mirrors the existing typed-vs-chord behaviour.
9. Adding a new verb requires only adding one entry to the verb registry and writing one mode-picker file. No changes to `prefix-modes.ts` activation logic, no changes to the discovery menu code.
10. `pnpm test`, `pnpm typecheck`, and `pnpm test:perf` all pass. Unit tests cover: bare-`:` discovery render, Tab autocompletion across the four ambiguity cases above, `:file` filename search (in-scope hit, out-of-scope miss, hidden-files toggle, MRU empty-state), and Esc-source semantics.

## Open questions for tasking

- **Verb registry shape.** Mirror `MODES` in `prefix-modes.ts` (keyed by verb name, with `prefix: ':'` shared)? Or a separate `VERBS` registry alongside? Lean toward separate — verb activation is multi-char so the detector logic differs from the single-char `MODES_BY_PREFIX` lookup.
- **`:` icon in the mode badge.** When a verb is active, what does the badge show — the `:` glyph, the verb's icon, both? Probably the verb's icon (matches how single-char modes render the noun's icon).
- **Filename search index choice.** `WHERE name LIKE '%foo%'` is dead simple. FTS5 over `files.name` would be ranked but adds index complexity. Lean toward LIKE for v1; revisit if the result list feels unranked at scale.
- **`⌘⇧F` chord override.** Currently a no-op. Reassigning is safe (no user has muscle memory for the current behaviour) but should be confirmed in the keyboard-shortcuts doc update.
