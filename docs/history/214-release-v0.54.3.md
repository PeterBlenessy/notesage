# Release v0.54.3

**Date:** 2026-08-25
**Previous version:** 0.54.2

Sharing to Notesage on the Mac now does what it does on the phone.

## Changes

### Fixes

- **"Could not remember that folder" when setting up sharing.** Picking your
  Notesage library from the share panel could fail the moment the panel
  closed, leaving Save greyed out with no way forward — the folder was chosen
  but never remembered, so every later share was stuck at the same step. It
  depended on timing, which is why it could work once and then stop, and why
  it behaved differently on one Mac than another.
- **Articles on JavaScript-heavy sites save as articles again.** Many news
  sites build the page after it loads. On the Mac those were saving as a bare
  link, because Notesage only looked at the page as first delivered — the
  phone has always waited for the page to finish assembling itself, and now
  the Mac does too.
- **You can share a PDF, EPUB or image to the Mac.** Notesage did not appear
  in the share sheet for any of them, so a document you could file from your
  phone could not be filed from your Mac. They now save into `Inbox/` under
  their own names.
- **The Mac share window speaks your language.** Every word in it was English
  regardless of the language you picked — the buttons, the folder picker, and
  the messages it shows when something goes wrong.

## Under the hood

All three are the same defect wearing different clothes: the Mac extension was
written as a sibling of the iOS one rather than a port, so each shared
behaviour was reimplemented and each reimplementation dropped something. Four
found in one day — X capture, HTML file naming, the save button, the bookmark
scope — plus the three above. None was a decision; all were omissions.

The Mac extension now uses the SAME strings files as the phone rather than a
copy of its own, since a second copy is a second thing to forget.

The contract test now checks **both** platforms for each behaviour, so the
class is at least visible. Before today it checked only iOS.

Four review rounds went into this, and each one found defects introduced by
the previous round's fixes. Three of the bugs they caught were on **iOS**, not
macOS — the same freeze, the same filename race, the same unreachable retry —
found only because the reviews compared the two platforms rather than reading
one. Those are fixed here too.

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
  needs one successful share to confirm, and the bugs above stood in the way
  of getting one.
- **Video and audio shares are accepted in code but unverified on hardware.**
  macOS's activation rules have no Audio key, so an audio file should activate
  through the generic File rule — should, by reading the documentation, not by
  having been tried. Video declares its own key. Both need one real share from
  Finder before either is claimed to work, which is why neither is in the
  fixes above.
- The rendered-DOM fallback's settle constants (500 ms quiet period, 5 s
  ceiling) are inherited from iOS, where they are starting points rather than
  measured truths. A page that mutates forever hits the ceiling; one that
  lazy-loads past 5 s yields a partial DOM — still better than a link note.
- The performance gate remains red on benchmarks already red in v0.53.1 — see
  the 2026-08-25 entry in `docs/performance-baseline.md`. Not a regression;
  cause still undetermined.

## Files Changed

- The macOS Share Extension: the grant path, a new `PageRenderer`, the
  document-storing path, its activation rule and its localization — plus a
  contract guard for each.
