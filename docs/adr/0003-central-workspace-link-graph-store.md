# A dedicated workspace-level store holds the global link graph

The cross-project link graph lives in a single dedicated workspace-level store,
`~/.notesage/links.db` — a standalone database, deliberately **not** a table in
the global `index.db` (which itself feeds AI context), so the graph stays
physically isolated from anything that feeds AI context, per ADR 0002. It records
every document-to-document edge across all projects in one place, keyed by
source/target paths plus the resolved target file-id when known. The per-project
`<project>/.notesage/index.db` databases stay focused on within-project content
(tags, mentions, tasks, goals, FTS); the cross-cutting graph is centralized.

This makes backlinks a single indexed query instead of a fan-out union across
every open project database, and — because the link graph is the one index
structure that intentionally spans the isolation boundary (ADR 0002) — it puts
that structure in a single physically-separate place that is trivial to audit
against the "never feeds AI context" rule.

## Considered Options

- **Source-scoped edges + fan-out backlinks (E1)** — rejected: backlinks would
  require querying and unioning every open project db, scaling with project count.
- **Denormalized into both source and target dbs (E3)** — rejected: double writes
  and sync-drift risk between the two copies of each edge.

## Consequences

- The link store is a derived artifact: iCloud-excluded, rebuildable per device,
  maintained by the existing watcher/reindex pipeline.
- It references files in projects that may not currently be open, so it outlives
  any single project session and must be reconciled on rename/delete (update edge
  rows, or rebuild lazily).
- The link store follows the existing index scope — **projects + `~/Notesage`
  only; explorer folders are excluded** — so no arbitrary explorer-folder content
  (including the stored backlink context of ADR 0006) is ever persisted,
  consistent with the explorer-exclusion data-security rule.
