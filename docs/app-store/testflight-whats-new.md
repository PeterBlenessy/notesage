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

The blink is gone, the mystery pill is readable, and thumbnails keep up.

FIXED
• Closing an article no longer makes the screen blink before the list returns.
• The status that flashed behind the search pill now sits above it, readable.
• Settings is Swedish throughout, explanations included.
• "1 server", not "1 servers".

IMPROVED
• Thumbnails are fetched a screen ahead of where you are.

TRY
• Open an article, go back, watch the list return. Any blink left?
• Scroll a big folder fast, list and gallery. Do pictures keep up?
