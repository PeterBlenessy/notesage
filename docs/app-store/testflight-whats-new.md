<!--
"What to Test" for the next TestFlight build. `scripts/ios-testflight.sh`
sends this to App Store Connect after uploading, so it never has to be pasted
into the web form. HTML comments are stripped; only the prose is sent.

TestFlight shows plain text: no bold, no Markdown. Line breaks and characters
survive, so the structure is made of those — and testers read it in a
notification, standing up, so it is ONE SCREEN, structured, not a wall:

  One line saying what this build is about.

  NEW
  • One feature per bullet, the user's words, what it does for them.

  FIXED
  • One fix per bullet.

  TRY
  • What to poke at, as an instruction: "Open…, then…".

Headings are upper-case words on their own line; bullets start with "•".
Leave out a section that has nothing in it. Roughly 600 characters fit a
screen; the sender warns past that.

Rewrite it for each release. Stale notes are worse than none — they send
people testing something that already shipped.
-->
Two things you should stop seeing on a cold start.

FIXED
• The folder icons on Home repainted as plain grey folders for a moment after
launch, then snapped back. They no longer blank while the app re-reads them.
• "Saving for offline" ran through every item in your Inbox on every single
launch, even when all of them were already saved. It now only appears when
there is actually something to fetch.

TRY
• Force-quit, reopen, and watch the icon row on Home. Nothing should blank.
• Reopen again without sharing anything new. No "Saving for offline" at all.
• Share a link, then reopen: it should appear, count only the new one, and the
thumbnail should fill in.
