# Recognize OKF by generic frontmatter consumption — no OKF-specific parser

Notesage "recognizes" OKF by consuming `type` / `title` / `description`
frontmatter **generically on any document**, not via an OKF-specific parser and
not behind a required marker/manifest file. Any document carrying a `type:` field
gets the typed treatment (badge, grouping) wherever it appears — which also
benefits native Notesage docs that already use frontmatter types (e.g.
`type: goal`). The index simply generalizes its existing frontmatter capture to
record arbitrary `type`/`title`/`description`.

Bundle recognition, if used at all, is a **cosmetic, convention-based hint**
(a folder with `index.md` whose descendants are mostly typed) — never a hard gate
on functionality. If the OKF spec later adds a version/manifest file, it is
honored as a stronger signal, not a requirement.

## Considered Options

- **Gated recognition** (typed treatment only inside a detected OKF bundle) —
  rejected: more code, and it withholds value from any individually-typed doc.
- **Explicit marker/manifest requirement** — rejected: OKF v0.1 only mandates
  `type:`; requiring a manifest would reject conformant bundles.
- **A dedicated OKF parser** — rejected as over-engineering coupled to a v0.1
  spec. OKF is just consistently-typed Markdown; the frontmatter we already read
  is the entire integration surface.

## Consequences

- Zero coupling to the evolving OKF spec — there is no format-specific code path
  to maintain.
- The value scales with how consistently documents are typed, OKF bundle or not.
