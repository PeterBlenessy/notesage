# Relation snippets: backlinks show surrounding context, forward links show target description

The Relations panel uses an asymmetric snippet model, matching where each
direction's question is best answered:

- **Linked from (backlinks)** follow the **wiki convention** (Obsidian, Roam,
  Logseq all do this): show the **surrounding line/paragraph** of each mention,
  grouped by source document, with an Obsidian-style "show more context" expand.
  The source-document group header is enriched with the source's OKF `type` badge
  and `description` when present. Answers *"where / why is this mentioned?"* and
  works for every document, typed or not.
- **Links to (forward links)** follow the **data-catalog convention** (DataHub,
  Atlan, Google Data Catalog): show the target's title + `type` badge + the
  target's `description`. Answers *"what am I pointing at?"*

OKF enriches both directions (type badges, descriptions in headers) rather than
replacing the wiki context — Notesage straddles the PKM-wiki and data-catalog
worlds, and each direction borrows the convention that fits it.

## Considered Options

- **Description for both directions** — rejected: a per-document `description`
  is per-document not per-link, absent on plain notes, and discards the
  surrounding-context that is the entire point of wiki backlinks.
- **Surrounding context for both** — rejected: forward links read better as
  "what is the target" (its curated description) than as a sentence from the
  current doc.

## Consequences

- The link-graph store (ADR 0003) keeps a **per-edge context window** as the
  stored **surrounding block text** (not offsets) — self-contained, so backlink
  context renders even when the source doc is closed or in a non-open project,
  with no offset drift between reindexes. This is the price of real backlinks and
  is accepted. The text is stored only for in-scope docs (projects + `~/Notesage`;
  explorer folders excluded, per ADR 0003).
- Backlinks are grouped and deduplicated per source document; multiple mentions
  in one source list as occurrences under that source's header.
