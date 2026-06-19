# Tasks: OKF Wiki-Navigation Layer

|  |  |
| --- | --- |
| **Date** | 2026-06-19 |
| **Status** | Not started |
| **PRD** | [okf-wiki-navigation](../prds/2026-06-19-okf-wiki-navigation.md) |
| **Total** | 16 tasks: 2S, 10M, 4L |
| **Suggested order** | Backend index (#1–#6) → State (#7) → UI panel + preview (#8–#10) → Wikilink authoring (#11–#13) → Isolation (#14) → Enrich skill + docs (#15–#16). #15 can run in parallel with the UI work. |

**Risks / open questions**

- **Blast radius — index pipeline (#1–#3):** touches `src-tauri/src/index/` and the
  watcher/reindex path; a regression here affects all indexing. Land behind tests.
- **Blast radius — markdown round-trip (#11–#13):** the `[[` extension must not
  alter serialization of anything but wikilinks; the round-trip suite is the gate.
- **Isolation (#14) is security-critical** — the regression-lock that a link edge
  never auto-widens AI context is mandatory, mirroring the 2026-04-20 red-team locks.
- Wikilink global resolution may match multiple docs by title; disambiguation is at
  author time in the autocomplete (ADR 0001) — confirm UX in #11.

---

## #1 — Create the `links.db` store: schema, migrations, connection
**Description:** New module under `src-tauri/src/index/` (e.g. `links.rs`) owning a
standalone `~/.notesage/links.db`. Schema: a `link_edges` table (`source_path`,
`source_file_id`, `target_path`, `target_file_id` nullable, `link_text`, `context`,
`is_internal`) with indexes on source and target; and generalized frontmatter
capture (`doc_type`/`title`/`description`) on the file rows. Standalone DB, **not** a
table in the global `index.db` (ADR 0002/0003). Follow the schema/migration pattern
in `index/db.rs`.
**Complexity:** M · **Category:** backend · **Dependencies:** none
**Files:** `src-tauri/src/index/links.rs` (new), `src-tauri/src/index/db.rs`, `src-tauri/src/index/mod.rs`

## #2 — Extend the comrak parser to emit link edges + frontmatter meta
**Description:** In `index/parser.rs`, walk `NodeValue::Link`: resolve the relative
target the way `link-click.ts` does, capture `link_text` and the **surrounding-block
context text** (ADR 0006), and emit a `LinkEdge`. Also capture arbitrary
`type`/`title`/`description` from frontmatter (generalize the existing `type: goal`
handling, ADR 0005). Unresolved targets are retained (ADR 0007).
**Complexity:** L · **Category:** backend · **Dependencies:** #1
**Files:** `src-tauri/src/index/parser.rs`

## #3 — Wire link indexing into the reindex pipeline with correct scope
**Description:** Feed `LinkEdge`s into `links.db` from the indexing pipeline
(`index/mod.rs`, `reindex_queue.rs`). Enforce scope = **projects + `~/Notesage`
only; explorer folders excluded** (no explorer content/context persisted, ADR 0003).
iCloud-exclude `links.db` (`index/icloud.rs`). Reconcile edges on rename/delete via
the existing rename-sync path.
**Complexity:** M · **Category:** backend · **Dependencies:** #1, #2
**Files:** `src-tauri/src/index/mod.rs`, `src-tauri/src/index/reindex_queue.rs`, `src-tauri/src/index/icloud.rs`

## #4 — Query layer: backlinks / outlinks / broken-links / wikilink resolve
**Description:** SQL builders in a `links` query module: `backlinks(target)` (grouped
by source), `outlinks(source)`, `broken_links(scope)`, and `resolve_wikilink(query)`
matching filename + title across the workspace (ADR 0002). Follow `index/queries.rs`.
**Complexity:** M · **Category:** backend · **Dependencies:** #1
**Files:** `src-tauri/src/index/queries.rs` (or `links.rs`)

## #5 — Tauri commands for the link graph
**Description:** `get_backlinks(path)`, `get_outlinks(path)`, `get_broken_links(scope)`,
`resolve_wikilink(query)` returning serializable rows (`Result<T, String>`). Register
in `lib.rs` `generate_handler!`. Follow the `/tauri-command` conventions and
`docs/tauri-commands.md`.
**Complexity:** M · **Category:** backend · **Dependencies:** #3, #4
**Files:** `src-tauri/src/index/mod.rs`, `src-tauri/src/lib.rs`

## #6 — Rust tests: parser, queries, scope exclusion
**Description:** Unit tests for link extraction (incl. context capture and unresolved
targets), backlink/outlink/broken-link queries, and a **regression-lock that
explorer-folder content is never written to `links.db`** (ADR 0003). `cargo test`.
**Complexity:** M · **Category:** backend · **Dependencies:** #2, #3, #4
**Files:** `src-tauri/src/index/parser.rs` (tests), `src-tauri/src/index/links.rs` (tests)

## #7 — Frontend bindings + relations hook
**Description:** Thin `tauriApi` wrappers for the #5 commands and a
`useDocumentRelations(path)` hook (and/or small store) that loads backlinks/outlinks
for the active document, with loading/error/empty states. Memoize per active doc.
**Complexity:** M · **Category:** frontend · **Dependencies:** #5
**Files:** `src/lib/tauri.ts`, `src/hooks/useDocumentRelations.ts` (new)

## #8 — RelationsPanel shell: docked, collapsible, pulsing
**Description:** `RelationsPanel` built on a Radix popover, **docked to the right edge
of the document/editor column** (rounded left, flat right), partial height ~40–60%
(draggable taller, persisted), collapsed behind a slim right-edge handle with a count
badge, **CSS-only pulse on any relation, `prefers-reduced-motion` gated** (ADR 0004).
Self-hides when the doc has no relations. Coexists with pinned cmd bar + orb.
**Complexity:** L · **Category:** frontend · **Dependencies:** #7
**Files:** `src/components/editor/RelationsPanel.tsx` (new), `src/components/QuietLayout.tsx`, `src/styles/globals.css`

## #9 — RelationsPanel content: grouped backlinks + forward links
**Description:** *Linked from* grouped by source doc (header = source title + `type`
badge + `description`; occurrences show surrounding **context** with "show more
context" expand); *Links to* = target title + `type` badge + `description` (ADR 0006).
Rows navigate on click. Type badges/styling via design-system tokens.
**Complexity:** M · **Category:** frontend · **Dependencies:** #8
**Files:** `src/components/editor/RelationsPanel.tsx`

## #10 — In-editor link hover preview
**Description:** Hover an internal link → Peek card (reuse `FolderPeek`/`FilePreview`,
220/150 timing, reduced-motion) showing target title + `type` badge +
`description`/snippet; an unresolved link previews "Not yet created — click to
create." Shares the #7 resolver data.
**Complexity:** M · **Category:** frontend · **Dependencies:** #7
**Files:** `src/components/sidebar/quiet/FilePreview.tsx`, `src/components/editor/extensions/link-click.ts` (or a new hover plugin)

## #11 — WikiLink Tiptap extension + normalize-on-save
**Description:** New `[[` suggestion extension (model on `MentionSuggestion`/
`TagSuggestion`) with a workspace-global autocomplete via `resolve_wikilink`
(filename + title). On save, `[[ ]]` **normalizes to a standard relative link** — the
only on-disk form (ADR 0001); ambiguity resolved at author time. No editor-typing
perf regression (`pnpm test:perf`).
**Complexity:** L · **Category:** both · **Dependencies:** #5
**Files:** `src/components/editor/extensions/wiki-link.tsx` (new), `src/lib/markdown.ts`, `src/hooks/useEditor.ts`

## #12 — Dangling wikilinks: create-on-click + unresolved styling
**Description:** A `[[Thing]]` with no match serializes to a would-be relative path
(slug in the **current directory**, ADR 0007), renders in a distinct **unresolved**
style, and clicking offers to create the document. Pending references appear in the
target's backlinks (unresolved edges from #2).
**Complexity:** M · **Category:** frontend · **Dependencies:** #11
**Files:** `src/components/editor/extensions/wiki-link.tsx`, `src/styles/editor.css`, `src/lib/link-utils.ts`

## #13 — Markdown round-trip tests for wikilink normalization
**Description:** Fixtures + round-trip tests proving `[[ ]]` authoring serializes to
standard relative links and that no other serialization changes; dangling case lands
as a current-dir relative link. Existing round-trip suite stays green.
**Complexity:** S · **Category:** frontend · **Dependencies:** #11
**Files:** `tests/fixtures/*.md`, `src/lib/__tests__/markdown.test.ts`

## #14 — Isolation: link edges never auto-widen AI context
**Description:** Ensure the AI-context builder keeps its per-selected-project gate so a
link edge never auto-pulls cross-project content (ADR 0002). Add the **per-link
cross-project permission** path (reuse the tiered permission card); `crossProjectMode`
ON blanket-approves, OFF prompts. **Regression-lock** that a link edge does not widen
context (mirroring the red-team locks). Security-critical.
**Complexity:** L · **Category:** both · **Dependencies:** #5, #7
**Files:** `src/hooks/useAIContext.ts`, `src/lib/ai/context.ts`, `src/stores/permission-store.ts`, `src/lib/__tests__/*`

## #15 — Bundled enrich skill
**Description:** A bundled skill in `bundled-skills/okf-enrich/` (SKILL.md + script)
that walks documents and fills missing `type`/`title`/`description` frontmatter via
`generateStructured()` (ADR 0008). Writes via the `write_file` approval path. Verify
it extracts/registers like other bundled skills. Can run in parallel with UI work.
**Complexity:** M · **Category:** both · **Dependencies:** none (uses shipped infra)
**Files:** `bundled-skills/okf-enrich/SKILL.md` (new), `bundled-skills/okf-enrich/scripts/*`

## #16 — Documentation updates
**Description:** Document the link graph + Relations panel: add `links.db`, the parser
extension, the new commands, the panel/hover surfaces, and the wikilink extension to
`docs/architecture.md` (index section, command inventory, extension inventory) and add
a Knowledge-base roadmap entry in `docs/product-description.md`. Cross-link the ADRs.
**Complexity:** S · **Category:** frontend (docs) · **Dependencies:** #5, #8, #11
**Files:** `docs/architecture.md`, `docs/product-description.md`, `docs/features/editor-architecture.md`
