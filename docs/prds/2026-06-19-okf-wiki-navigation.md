# PRD: OKF Wiki-Navigation Layer

|  |  |
| --- | --- |
| **Date** | 2026-06-19 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Surfaces the links between documents — backlinks, relations, and link preview — turning a folder of notes (or an OKF bundle) into a navigable wiki without leaving the document you're reading |
| **Tasks** | — (not yet planned) |
| **Phase** | Knowledge base |

> **Source of truth:** this PRD synthesizes the decisions reached in the
> `grill-with-docs` session, recorded as ADRs `docs/adr/0001`–`0008` and the
> `CONTEXT.md` glossary. Where a requirement traces to an ADR, it is cited
> inline (e.g. *(ADR 0003)*). The ADRs are the rationale; this PRD is the spec.

## Problem

Notesage already lets documents link to one another via relative Markdown links,
and the SQLite index already parses tags, mentions, tasks, goals, and full-text
content. But it has **no model of the links between documents**: the comrak
index parser never walks `NodeValue::Link`, there is no `links`/`relations`
table (the schema only carries a `-- future backlink support` breadcrumb next to
`headings`), and following a link works only at runtime (`link-click.ts`). As a
result there is **no "what links here," no relations view, and no link preview** —
the wiki-reading behaviour users expect from Obsidian/Roam/Logseq is absent, and
a skill cannot add it because a reading/navigation surface is core product work,
not an AI-invoked transformation.

Separately, the **Open Knowledge Format (OKF)** — a vendor-neutral spec that is
just "Markdown files with `type`/`title`/`description` frontmatter, linked into a
graph" — is almost exactly what Notesage already stores. Notesage inherits ~90%
of OKF support for free; the missing piece is the navigation layer that makes a
typed, linked corpus *valuable to read*. Building the wiki layer and recognizing
OKF are the same project: the links are the graph, and `type`/`description`
frontmatter is what makes each node worth previewing.

**Why now:** the index already anticipated backlinks, the roadmap lists
"Backlinks" and "note connections" under Knowledge base, and OKF gives the work a
concrete content standard to align with at near-zero marginal cost.

## Goals / Non-Goals

**Goals**

1. Index the document **link graph** (every internal link as a directed edge,
   with surrounding context) in a dedicated, auditable store.
2. Ship a **Relations panel** — a document-scoped floating surface showing
   *Links to* and *Linked from* with one-click navigation.
3. Provide **in-editor hover preview** of internal links so a neighbour can be
   read without navigating away (critical in the single-document shell).
4. Add **`[[wikilink]]` authoring** that normalizes to standard relative links on
   save, with global resolution and create-on-click for danglers.
5. **Recognize OKF generically** (consume `type`/`title`/`description` wherever
   it appears) and ship a **bundled enrich skill** that populates that frontmatter
   — so the reader is rich on ordinary Markdown, not just on already-OKF data.

**Non-Goals**

- **OKF export** — no "export project as OKF bundle" feature *(ADR 0008)*.
- **A force-directed graph view** — explicitly out of scope; the value is
  list/panel/preview navigation, not visualization.
- **A dedicated OKF parser or required manifest/marker file** *(ADR 0005)*.
- **Obsidian-vault interop** via literal `[[ ]]` persistence *(ADR 0001)*.
- **Persisting any explorer-folder content** — the link store inherits the
  index's projects + `~/Notesage` scope *(ADR 0003)*.

## User Stories

- As a writer, I want to see which documents link **to** the one I'm reading, and
  the sentence each used, so that I can discover related work I'd forgotten.
- As a reader, I want to **hover a link** and read the target's gist inline, so
  that I don't lose my place by opening it (the shell shows one doc at a time).
- As a note-taker, I want to type `[[Title]]` and pick a target by name, so that
  I can link without typing relative paths — and create the doc later if it
  doesn't exist yet.
- As someone who opened a data team's **OKF bundle**, I want each linked concept
  shown with its `type` and `description`, so that the bundle reads as a typed,
  navigable wiki immediately.
- As a privacy-conscious user, I want a cross-project link to **never** silently
  feed another project's content to an agent, so that project isolation holds —
  while still being able to *navigate* that link myself.

## Technical Approach

### 1. Link-graph index (Rust)

- **Parser:** extend `src-tauri/src/index/parser.rs` to walk `NodeValue::Link`,
  resolving each relative target the same way `link-click.ts` does at runtime.
  Capture link text and a **surrounding-block context window** (stored text, not
  offsets) *(ADR 0006)*. Generalize frontmatter capture beyond `type: goal` to
  record arbitrary `type` / `title` / `description` per file *(ADR 0005)*.
- **Store:** a **standalone `~/.notesage/links.db`** — deliberately *not* a table
  in the global `index.db` (which feeds AI context), so the cross-project graph is
  physically isolated and trivially auditable against the no-auto-widen rule
  *(ADR 0002, 0003)*. Scope follows the content index: **projects + `~/Notesage`
  only; explorer folders excluded** *(ADR 0003)*. Derived, iCloud-excluded,
  rebuildable, maintained by the existing watcher/reindex pipeline; reconciled on
  rename/delete via the existing rename-sync.
- **Queries:** `backlinks(target)`, `outlinks(source)`, `broken_links` —
  unresolved targets are retained so danglers and pending references are queryable
  *(ADR 0007)*.

### 2. Recognition (no OKF code path)

OKF is recognized purely by generic frontmatter consumption — any doc with a
`type:` gets the typed treatment; no parser, no marker required *(ADR 0005)*.
Optional cosmetic bundle hinting (a folder with `index.md` whose descendants are
mostly typed) may follow later, never as a functional gate.

### 3. Relations panel (frontend)

A floating popover **docked to the right edge of the document/editor column**
(rounded left corners, flat right), partial height ~40–60% (draggable taller),
collapsed by default behind a slim right-edge handle with a relation count,
pulsing on any relation *(ADR 0004; collapsed=handle+count, pulse=any-relation)*.
Built on a Radix primitive (no hand-rolled floating div), CSS-only animation,
`prefers-reduced-motion` gated. Anchoring to the column (not the window edge) lets
it coexist with the pinned command bar and AgentOrb without shift math.

**Content** *(ADR 0006)* — asymmetric by direction:
- **Linked from (backlinks):** grouped by source document; group header = source
  title + `type` badge + `description`; each occurrence shows the **surrounding
  context** with an Obsidian-style "show more context" expand.
- **Links to (forward):** target title + `type` badge + target `description`.

### 4. Hover preview (frontend)

Reuse the existing **Peek pattern** (`FolderPeek` / `FilePreview`, 220 ms-open /
150 ms-grace, reduced-motion handled). Hovering an internal link resolves the same
title/type/description/snippet the panel rows use; an unresolved link previews as
"Not yet created — click to create."

### 5. Wikilink authoring (Tiptap)

A new `[[` suggestion extension (modelled on the existing `MentionSuggestion` /
`TagSuggestion`) with a **workspace-global** autocomplete matching filename +
title *(ADR 0002)*. On save, `[[ ]]` is **normalized to a standard relative
link** — the only on-disk form *(ADR 0001)* — with ambiguity resolved at author
time (explicit path stored). A dangling `[[Thing]]` serializes to a would-be path
(slug in the current directory), renders unresolved, and is **create-on-click**
*(ADR 0007)*. The markdown round-trip suite must stay green.

### 6. Isolation (load-bearing)

Links are **global for humans**; the AI-context builder keeps its existing
per-selected-project gate — a link edge **never** auto-widens AI context *(ADR
0002)*. An agent crosses a project boundary to read a linked concept only via the
existing **tiered permission card** (allow once / session / always). The global
`crossProjectMode` toggle **blanket-approves** link crossings; when off (default),
each cross-project context request prompts — there is no third independent gate
*(ADR 0002, as amended)*.

### 7. Enrich skill (bundled)

A **bundled** skill in `bundled-skills/` (extracted to `~/.notesage/skills/`) that
walks documents and fills missing `type` / `title` / `description` frontmatter via
the existing `generateStructured()` structured-output infra (the Google
enrichment-agent pattern). Bundled from the start because it feeds the reader's
badges/headers/previews, making the reader valuable on plain Markdown *(ADR
0008)*. Writes go through the `write_file` permission path.

## UI/UX

- **Relations panel — collapsed:** slim vertical handle on the document column's
  right edge with a count badge; pulses (CSS keyframe, reduced-motion gated) when
  the open doc has any relations. Hidden entirely when the doc has none.
- **Relations panel — open:** rolls out leftward from the edge, ~40–60% height,
  draggable taller; two sections (*Links to*, *Linked from*); rows carry a `type`
  badge, title, and snippet; backlinks grouped by source with "show more context";
  Esc / click-away / handle closes. Active-doc semantics — it always reflects the
  open document.
- **Hover preview:** Peek card on internal-link hover — title, `type` badge,
  `description`/snippet; unresolved links show a create affordance.
- **Wikilink autocomplete:** `[[` opens a suggestion list (filename + title,
  source/project hint), keyboard-navigable, mirroring mention/tag suggestion UX.
- **Unresolved link styling:** distinct (e.g. dashed) treatment for broken /
  not-yet-created targets.
- **States:** empty (no relations → no handle), loading (index warming →
  skeleton rows), error (query failure → muted inline message). Light/dark + soft
  contrast; all colour via tokens; accent only via `--color-accent-primary`.

## Data Model

**Rust — link store (`links.db`)** (illustrative):

```rust
struct LinkEdge {
    source_path: String,
    source_file_id: i64,
    target_path: String,           // raw resolved relative target (kept even if unresolved)
    target_file_id: Option<i64>,   // None => unresolved / dangling
    link_text: String,
    context: String,               // surrounding block text (in-scope docs only)
    is_internal: bool,
}

struct ConceptMeta {               // generalized frontmatter capture on `files`
    file_id: i64,
    doc_type: Option<String>,      // frontmatter `type`
    title: Option<String>,
    description: Option<String>,
}
```

**Tauri commands** (per `docs/tauri-commands.md` conventions, `Result<T, String>`):

```rust
#[tauri::command] async fn get_backlinks(path: String) -> Result<Vec<BacklinkGroup>, String>;
#[tauri::command] async fn get_outlinks(path: String)  -> Result<Vec<LinkRow>, String>;
#[tauri::command] async fn get_broken_links(scope: Vec<String>) -> Result<Vec<LinkRow>, String>;
#[tauri::command] async fn resolve_wikilink(query: String) -> Result<Vec<WikiTarget>, String>;
```

**Frontend:** a `relations`-oriented hook/store feeding the panel + hover preview
from the commands above; a `WikiLink` Tiptap suggestion extension; a
`RelationsPanel` component (Radix popover); reuse of `FilePreview` for hover.

## Dependencies

- No new crates expected — `comrak` (parsing), `rusqlite` (store), and the Tiptap
  `@tiptap/suggestion` machinery are all already present.
- `generateStructured()` / `ai_chat_stream` `response_format` for the enrich skill
  (already shipped).
- Prerequisite: the parser + `links.db` schema land before any UI consumes them.

## Quality Gates

**Functional**
- [ ] Parser extracts internal-link edges + context; round-trip suite stays green.
- [ ] `links.db` is standalone, projects + `~/Notesage` scoped; **no
  explorer-folder content is ever persisted** (regression-locked).
- [ ] Backlinks/outlinks/broken-links queries return correct edges; rename/delete
  reconcile the graph.
- [ ] Relations panel shows correct *Links to* / *Linked from*, grouped/snippeted
  per ADR 0006; navigates on click; self-hides when empty.
- [ ] Hover preview shows target gist; unresolved → create-on-click.
- [ ] `[[ ]]` authoring normalizes to a relative link on save; danglers
  create-on-click in the current dir; global resolution matches filename + title.
- [ ] A link edge never auto-widens AI context; cross-project read requires the
  permission card; `crossProjectMode` on = blanket-approve (regression-locked).
- [ ] Bundled enrich skill fills `type`/`title`/`description` via structured
  output; writes gated by `write_file` approval.

**Design**
- [ ] Panel docks to the document column, coexists with pinned cmd bar + orb.
- [ ] CSS-only pulse; `prefers-reduced-motion` honored; built on a Radix primitive.
- [ ] Looks polished in light/dark + soft contrast; tokens only; accent via
  `--color-accent-primary`.

**Testing/Perf**
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `cargo test`, and the
  markdown round-trip tests pass.
- [ ] Index changes stay within `[perf:index]` budget; no editor-typing regression
  from the wikilink extension (`pnpm test:perf`).

## Out of Scope

- OKF export; force-directed graph view; Obsidian literal-`[[ ]]` persistence;
  dedicated OKF parser / manifest requirement *(ADRs 0001, 0005, 0008)*.
- Type-aware placement of created docs (e.g. `[[Orders]]`→`tables/orders.md`) —
  deferred; v1 creates in the current directory *(ADR 0007)*.
- Per-link (vs per-source-document) backlink anchor context as a distinct view —
  the stored context already covers the need; revisit only on demand.
- Cosmetic OKF-bundle detection/badging — optional follow-up *(ADR 0005)*.
