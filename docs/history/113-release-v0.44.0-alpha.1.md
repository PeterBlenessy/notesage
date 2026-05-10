# Release v0.44.0-alpha.1

**Date:** 2026-05-10
**Previous version:** 0.44.0-alpha.0
**Channel:** Alpha

Patch on top of `v0.44.0-alpha.0` to unblock the release pipeline. The
`alpha.0` tag landed but its CI run failed because a perf test still
referenced the old segmented StatusTray picker — the dropdown shipped in
`v0.44.0-alpha.0` made that test obsolete. No user-visible behaviour
change versus `v0.44.0-alpha.0`; the alpha.0 release was effectively
non-shipping.

## Changes

### Fixes

- **Release pipeline unblocked.** Removed the obsolete
  `status-tray segmented picker click` performance benchmark — it asserted
  on `role="radio"` elements that were replaced by a Radix `Select`
  dropdown in `v0.44.0-alpha.0`. Behavioural coverage for the picker is
  unchanged (lives in `StatusTray.test.tsx`).

## Under the hood

- `src/perf/status-tray.perf.test.ts` — segmented-picker benchmark deleted.
- `package.json` — bumped to `0.44.0-alpha.1`.
