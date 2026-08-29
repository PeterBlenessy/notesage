# Release v0.55.2

**Date:** 2026-08-29
**Previous version:** 0.55.1

Articles saved before the last release are repaired when you open them, so the
ones already in your library stop opening with the wrong formatting.

## Changes

### Fixes

- **Articles already in your library get their formatting fixed.** v0.55.1
  stopped new saves coming out wrong, but the articles saved before it stayed
  that way — wrong text size and spacing, most noticeably on iPhone. Opening one
  now repairs it, and the fix is written into the file itself rather than just
  applied on screen, so the article also looks right in a browser, in Quick
  Look, or if you send it to someone. It happens once per article, silently, and
  an article that is already fine is left untouched. Note that a repaired
  article's modification date changes to the day you opened it.

## Under the hood

- Follow-up to #805 / PR #820. `repair_missing_doctype` prepends the doctype the
  #805 sweep stripped, and nothing else: `<head>`/`<body>` were dropped too but
  are OPTIONAL in HTML5, so only the doctype affects rendering. A prepend rather
  than a reparse is deliberate — a reparse is what caused the damage.
- Returns `Option`, so a healthy document is never rewritten and its mtime never
  moves. The signature requires a terminated `<html` tag at the start, leaving
  fragments, notes and correct documents alone; repairing twice is a no-op.
- Both readers repair (mobile `Reader`, desktop `HtmlViewer`). Relying on iOS
  plus iCloud alone would have left an article only ever opened on desktop
  broken forever. Desktop skips a dirty tab, since `content` then carries
  unsaved edits; iOS does not await the write, so a coordinated iCloud write
  never delays opening a report.
- The function lives in the APP crate, not `notesage-capture`: the Share
  Extension never repairs (it only writes), and the capture crate is
  deliberately absent from desktop builds. One Rust decision shared by both call
  sites rather than a TypeScript reimplementation.
- Every new guard mutation-tested. A Rust test for the command wrapper was
  written and deleted — behind `#[cfg(target_os = "ios")]` it would never have
  run anywhere.

## Files Changed

- 6 files across 2 commits (PR #820)
