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

Search in a folder actually searches now.

FIXED
• Searching a folder matches what you can SEE on the row — a saved article's
title, its site and its summary line — not just the filename. Typing a word
from an article's title used to hide everything, because the file behind it is
named after a date.
• Searching also ignores accents, so "andring" finds "Ändringsdatum".

TRY
• Open a folder with saved articles, search a word from a title you can read
on screen, then a word from the site under it. Both should find it.
