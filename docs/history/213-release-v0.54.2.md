# Release v0.54.2

**Date:** 2026-08-25
**Previous version:** 0.54.1

The Share menu works every time now, not just the first time.

## Changes

### Fixes

- **Sharing to Notesage from another app works on every share.** Until now
  only the first one did: the Save button stayed greyed out on the second and
  every one after it, with nothing on screen to say why. The first share
  worked because it was the one that asked you to pick your library folder —
  answering that happened to wake the button up. Once the folder was
  remembered there was nothing left to wake it, so Save never became
  available again. Both the Safari share menu and a site's own share button
  were affected.

## Under the hood

- Save is gated on having both a library grant and a URL. The URL arrives
  asynchronously from the item provider, and the enablement check ran before
  it landed — so the sink that receives the URL has to re-run the check.
  It didn't. The only other caller was the grant flow's success path, which
  is precisely why the bug presented as "works once, then never again".
- **iOS was already correct**, enabling at its URL sink. So this was a parity
  gap as much as a bug — the same shape as the X-capture and HTML-naming
  fixes in v0.54.1, where the phone had something the Mac did not.
- The regression test is a source scan, since the extension is AppKit and
  cannot be driven from CI. It was verified to fail when the fix is reverted,
  so it catches the shipped defect rather than merely restating the fix.
- Worth recording why this survived: v0.54.1's artifact verification proved
  the new capture code was **present** — four checks, including grepping the
  shipped binary. None could show it was **reachable**. That is the same
  distinction the capture pipeline contract exists for, one layer up, and a
  second share is a ten-second manual check nobody ran.

## Known

- X capture on the desktop is now reachable but still unconfirmed end to end.
  The first share in v0.54.1 was an X article and it saved; what that did not
  prove is the enrichment (real title, cover image), because the failure above
  stopped any follow-up attempt.
- The performance gate remains red on benchmarks already red in v0.53.1 — see
  the 2026-08-25 entry in `docs/performance-baseline.md`. Not a regression;
  cause still undetermined.

## Files Changed

- One line in the macOS Share Extension's view controller, plus its
  regression test.
