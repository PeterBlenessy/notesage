# Release v0.59.0

**Date:** 2026-09-13
**Previous version:** 0.58.0

Settings reads in Swedish now — all of it, not just the parts a translation
check could see. Word export was carrying a security advisory it no longer
needs to.

## Changes

### Improvements

- **Settings is fully translated.** Every panel, including the help text under
  the controls — the sentences explaining what a model size does, what blocking
  external resources means, what each automation step expects. Roughly a
  hundred of those had never been translated, and were invisible to the check
  that was supposed to catch them, so Settings had been reported as finished
  while a Swedish user still read most of its explanations in English.

### Fixes

- **Word export no longer carries a known vulnerability in its XML reader.**
  The component that writes `.docx` files depended on an older XML parser with
  two published advisories, both of which could make it work very hard on a
  malformed file. Nothing about your documents changes; the parser underneath
  is simply the fixed version now.

## Under the hood

Nearly everything else in this release is iOS, and it is substantial — the
browsing surface went fully native across builds 68 to 74 (issue #1000, now
closed). Those notes ship separately, in `docs/app-store/ios-release-notes.md`
and the iOS changelog, because a changelog is read in the context of one app.

- The i18n detector was fixed twice in this window. It could not see a text
  node Prettier had wrapped onto its own line (232 strings), and then could not
  see `{saving ? 'Saving…' : 'Save'}` or any sentence over 120 characters (114
  more). Neither time had the code regressed — the instrument had been looking
  the other way while a hard-zero assertion reported success. The app-wide
  ceiling moved 376 → 857 → 1038 across those fixes; a rising number there has
  meant a better instrument, not worse code. Issues #989, #991.
- `docx-rs` 0.4.20 → 0.4.22, which requires `quick-xml ^0.41` and so retires
  RUSTSEC-2026-0194 and -0195 on the export path. The remaining ignores in
  `src-tauri/.cargo/audit.toml` are still genuinely blocked upstream:
  `citationberg` pins `^0.38.1` at its own latest release, and `syntect` is
  still on `bincode` 1.x. Issue #602.
- The third-party notice list is regenerated for the dependency change, so what
  ships with the binary matches what the About screen shows.
- Documentation stopped importing ~90k tokens into every session (#982).

## Files Changed

45 commits since v0.58.0, of which 38 are iOS. The desktop-visible work is the
Settings translations (45 files under `src/components/settings`) and the
dependency bump.
