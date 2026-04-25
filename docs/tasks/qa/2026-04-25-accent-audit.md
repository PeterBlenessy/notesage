# Accent color audit — 2026-04-25

Follow-up ticket spawned from live-test 2026-04-25 #144 fix. The accent
class swap now lands on `<html>` (`useAccent` mounted in `App.tsx`), and
the AppearanceSettings swatches match the actual `--accent` values from
`globals.css`. But the user reported that several primary affordances
still don't pick up the accent — sliders are still black, button and item
highlights aren't tinted, etc.

This ticket covers:

1. **Inventory** — every UI surface that should be painted with the
   user-picked accent vs. the strict-neutral palette.
2. **Audit** — find every site that hardcodes a chromatic colour or uses
   `var(--color-primary)` where it should be reading
   `var(--color-accent-primary)` (which falls back to `--accent` then to
   `--color-primary`).
3. **Fix** — swap the offending sites to the accent token, with regression
   tests for any path that has visible state (e.g. switch on/off).

## Open follow-ups (split out of #144)

- [ ] **System swatch / dot reads orange instead of the actual macOS accent.**
      `--accent-system-value` is only fetched when the user has already
      picked `accent === 'system'`. The System swatch in the picker uses
      `var(--accent-system-value, oklch(68% 0.21 37))` which falls back
      to orange before the fetch runs. Fix: have `useAccent` always
      invoke `get_system_accent_color` on mount (regardless of the
      currently-selected accent) and write the result to
      `--accent-system-value`. Tests already cover the success / null
      cases — extend to assert the unconditional fetch.
- [ ] **Audit step 1 — list every UI type that should be accent-driven.**
      Candidates from the user report:
      - Primary buttons (filled CTAs)
      - Sliders (track fill + thumb when active)
      - Switch on-state
      - Tab dirty dot
      - Editor link colour
      - Focus rings on form inputs
      - Active item highlights in lists / sidebar / nav
      - Active row in segmented controls
      - Selected pill / chip backgrounds where chrome currently uses
        `bg-accent` (Tailwind utility) which maps to
        `--color-accent` (a NEUTRAL surface token), NOT the chromatic
        `--color-accent-primary`. This naming clash is the biggest
        single source of confusion in the codebase — see
        design-system.md "`--color-accent-primary` vs `--color-primary`".
- [ ] **Audit step 2 — grep & fix.** For each candidate above, find
      the sites and swap to `var(--color-accent-primary)` (or its
      Tailwind arbitrary equivalent). Search hints:
      - `bg-primary`, `text-primary`, `border-primary` — most are right
        (neutral default) but some primary CTAs need `bg-accent-primary`.
      - `bg-accent` in chrome that should reflect the user accent —
        currently maps to the neutral surface token; consider whether
        callers want the chromatic accent or the neutral surface.
      - Hardcoded `oklch(...)` values with non-zero chroma in components.
      - `text-blue-*`, `bg-blue-*`, `border-blue-*` and similar Tailwind
        chromatic utilities (should NOT exist per the design system but
        might have leaked back in).

## Suggested approach

1. Land the unconditional `get_system_accent_color` fetch first — it's a
   one-line change in `useAccent` and unblocks the System swatch.
2. Then do a one-pass grep for the candidate patterns above. Build a
   table of `{ site, current colour, expected colour, owner component }`
   in this file.
3. Convert sites in batches by component family (Slider, Switch, Button,
   etc.) so each PR is reviewable.
4. Add a contrast-audit entry for any new accent-driven token so
   `pnpm audit:contrast` keeps every accent × theme combination above
   the WCAG 3:1 UI threshold.

## Why this is its own ticket

The 2026-04-25 batch landed the **mounting** fix — the accent class swap
now actually happens. The audit / per-site swap is a much wider scope
(every primary affordance) and needs the user to decide which surfaces
they want chromatic vs. which stay neutral. Splitting prevents
scope-creep on the live-test resume file and gives the audit a stable
home for batched fixes.

---

Owner: unassigned. Pick up after the rest of the live-test P1 visual
queue (or as priority dictates).
