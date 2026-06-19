# Knowledge & Linking

The domain vocabulary for Notesage's wiki-navigation layer — indexing the
links between documents, surfacing backlinks/relations, and recognizing the
Open Knowledge Format (OKF) as a typed content model on top.

## Language

**Internal link**:
A Markdown link from one workspace document to another, authored as a relative
path: `[text](./doc.md)`. The on-disk canonical form of every document-to-document link.
_Avoid_: cross-reference, hyperlink (reserve "hyperlink" for external URLs)

**Wikilink**:
A `[[Target]]` editor affordance for creating an internal link by title/filename
instead of typing an explicit relative path. An input convenience, not a distinct
on-disk format.
_Avoid_: backlink (unrelated), wiki-reference

**Link edge**:
A directed source → target relationship between two documents — the unit stored
in the index link graph. Carries the raw target plus the resolved target document
when one exists (unresolved targets are kept, so broken links stay queryable).
_Avoid_: relation (overloaded), connection

**Backlink**:
The inverse view of link edges — the set of documents that link *to* the current
document ("linked from").
_Avoid_: inbound link, reference

**Concept**:
An OKF document: a typed unit of knowledge (table, metric, runbook, dataset…)
carrying `type` / `title` / `description` frontmatter. A bundle of concepts linked
to each other is an OKF bundle.
_Avoid_: entity, node, card

**Relations panel**:
The floating, document-scoped surface that presents the open document's links
(Links to / Linked from). Anchored to the right edge of the document column,
partial height (~40–60% of the page, draggable taller), collapsed by default
with an attention cue when the
document has relations, rolls out on click and closes again. Not a full-height
sidebar.
_Avoid_: backlinks pane, right sidebar (it is not full-height), drawer
