# Relations panel docks to the document column, not the window edge

The Relations panel is a floating popover anchored to the **right edge of the
document/editor column** — rounded top-left and bottom-left corners, flat right
side flush against the column edge. It is partial height (~40–60% of the page,
draggable taller), collapsed by default, rolls out on click, and closes again.
It is explicitly **not** a full-height right sidebar.

Anchoring to the document column (rather than the window's right edge) is what
lets it coexist with the existing right-edge tenants — the pinned command bar
(full-height right panel) and the AgentOrb (bottom-right) — without shift math or
mutual-exclusion rules. It also reinforces the semantics that the panel belongs
to the *open document*, not the window chrome.

## Considered Options

- **New "Linked" left-sidebar section (F1)** — rejected: clutters the spare
  QuietSidebar and doesn't read as "about the open doc."
- **Bottom-of-document backlinks, Obsidian-style (F3)** — rejected: fights the
  clean 720px editor surface and the fade-on-type aesthetic.
- **Window-edge anchor + shift rule (G2) / mutually exclusive with pinned bar
  (G3)** — rejected: special-case coexistence logic, or forces a choice between
  live agent output and seeing links.

## Consequences

- On a narrow window an open panel overlays the right of the text; acceptable
  because it is user-triggered and closable.
- The anchor tracks a moving column (left sidebar resize, pinned cmd bar), so it
  positions against the editor column's box, not a fixed viewport offset.
- Build on a Radix primitive per the design system (no hand-rolled floating div);
  the attention animation must be CSS-only and reduced-motion gated.
