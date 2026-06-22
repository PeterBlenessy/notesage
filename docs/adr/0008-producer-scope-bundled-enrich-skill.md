# Producer scope: no export; a bundled enrich skill serving the core reader

OKF support is a **core reader** plus exactly one OKF-specific producer piece —
**enrich** — and nothing else.

- **No export.** Turning a project into an OKF bundle is explicitly out of scope:
  there is no user need for it. (If it ever returns, it belongs as an
  `ExportDialog` format alongside PDF/DOCX/PPTX/HTML, not as a skill.)
- **Enrich is a bundled skill.** An AI skill that walks documents and fills
  missing `type` / `title` / `description` frontmatter via structured output
  (the Google enrichment-agent pattern, using the existing `generateStructured()`
  infra). It ships **bundled** (`bundled-skills/`, extracted to
  `~/.notesage/skills/`) from the start — not installable-only — because it
  directly feeds the core reader: typed, described concepts are what power the
  Relations panel's badges/headers and the hover previews. Bundling it makes the
  reader valuable on ordinary untyped markdown out of the box, not just on
  already-OKF corpora.
- **Reader/recognition stays core** (ADR 0005) — generic, OKF-spec-decoupled.

The enrich skill can be updated later as the OKF spec evolves; being a skill (not
core code) makes that cheap.

## Considered Options

- **Core OKF export format** — dropped: no user need.
- **Installable-only (non-bundled) enrich** — rejected: bundling it is what makes
  the core reader immediately useful on real-world markdown.

## Consequences

- The only OKF-version-coupled code is one bundled skill, trivially updatable
  without a release-coupled migration.
- "Is OKF a skill?" — only the enrich producer is; the durable value (the wiki
  reader) is core.
