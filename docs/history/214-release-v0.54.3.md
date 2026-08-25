# Release v0.54.3

**Date:** 2026-08-25
**Previous version:** 0.54.2

Choosing your library folder in the Share menu works again.

## Changes

### Fixes

- **"Could not remember that folder" when setting up sharing.** Picking your
  Notesage library from the share panel could fail the moment the panel
  closed, leaving Save greyed out with no way forward — the folder was chosen
  but never remembered, so every later share was stuck at the same step. It
  depended on timing, which is why it could work once and then stop, and why
  it behaved differently on one Mac than another.

## Under the hood

- macOS was creating the security-scoped bookmark on the bare picker URL. That
  call has to happen **inside** the URL's security scope: the panel grants
  access implicitly, but it returns asynchronously and that grant is not
  guaranteed to still be live when the completion runs. When it had lapsed the
  call threw a permission error, which the extension reported as being unable
  to remember the folder.
- **iOS has always wrapped this correctly** (`persistBookmark`). This is the
  fourth parity gap in a row where the phone had something the Mac did not,
  after X capture, HTML file naming, and the save button's enablement. A
  contract test now asserts both platforms enter the scope before minting,
  and was verified to fail when the fix is reverted.
- **The grant path had no logging at all.** `currentGrant()` used `try?`,
  which swallowed the error, so three unrelated failures — nothing stored, a
  bookmark that will not resolve, a scope the system refuses to reopen — all
  looked like one greyed-out button. Two bugs in a row were diagnosed only
  because the user could read an on-screen message. Each failure now logs, and
  granting verifies the bookmark reads back, because writing one and resolving
  one are separate permissions and only the second matters.

## Known

- X capture on the desktop is now reachable in principle but has still never
  been observed working end to end: the enrichment (real title, cover image)
  needs one successful share to confirm, and the three bugs above stood in the
  way of getting one.
- The performance gate remains red on benchmarks already red in v0.53.1 — see
  the 2026-08-25 entry in `docs/performance-baseline.md`. Not a regression;
  cause still undetermined.

## Files Changed

- The macOS Share Extension's grant path, plus its contract guard.
