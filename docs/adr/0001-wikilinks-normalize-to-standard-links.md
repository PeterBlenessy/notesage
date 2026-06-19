# Wikilinks normalize to standard relative Markdown links on save

Wikilink authoring (`[[Target]]`) is supported as an editor-only input
affordance: on save it is resolved to a standard relative Markdown link
`[Target](./path/target.md)`. There is exactly one canonical on-disk form for
every document-to-document link, so the Markdown round-trip stays clean, output
stays OKF- and GitHub-compatible, and the index parser only ever has to extract
one kind of link edge.

## Considered Options

- **Persist literal `[[Target]]`** (Obsidian-style). Rejected: non-standard
  Markdown breaks Notesage's round-trip guarantee and isn't resolved by OKF /
  GitHub tooling, and the parser would have to handle two link forms. The only
  thing it buys is faithful Obsidian-vault interop, which is not a current goal.

## Consequences

- A **dangling wikilink** (`[[Thing]]` with no matching document yet) needs a
  defined serialization — it cannot leak `[[ ]]` into the file. Resolution rule
  and dangling behaviour are decided separately.
- Because the target path is made explicit at save time, link ambiguity is
  resolved at author time (in the `[[` autocomplete), never at render time.
