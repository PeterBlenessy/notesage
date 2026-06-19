# Dangling wikilinks become create-on-click unresolved links

Resolves the dangling-wikilink case left open by ADR 0001. When `[[Thing]]` has
no matching document, it serializes to a normal relative link to the would-be
path — `[Thing](./Thing.md)`, a slugified filename in the **current document's
directory** for v1 — renders in a distinct **unresolved** style, and clicking it
offers to create the document (the Obsidian/Roam "create-on-click red link"
convention). The index keeps it as an unresolved edge (ADR 0003), so pending
references can even surface in a target's backlinks before it exists.

## Considered Options

- **Never dangle (J2)** — autocomplete only offers existing docs; no match creates
  the doc immediately. Rejected: forces document creation mid-thought, exactly
  when the user wants to reference something they'll write later.
- **Serialize as plain text (J3)** — rejected: discards the link intent.

## Consequences

- The on-disk form stays canonical (`[text](path)`) even for not-yet-created
  targets; no `[[ ]]` ever leaks to disk (consistent with ADR 0001).
- Type-aware placement of the new doc (e.g. an OKF `[[Orders]]` of type Table →
  `tables/orders.md`) is deferred — v1 always uses the current directory.
