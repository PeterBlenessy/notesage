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

Native navigation, behind a switch — try it and tell me how it feels.

NEW
• The whole shell can run in a real iOS navigation stack: Home, folders and documents, with the system's own push, back gesture and parallax at every level.
• Turn it on at Home: "…" → Native navigation. Turn it off the same way.

TRY
• With it on, open a folder, then a document, then swipe in from the left edge — stop halfway and let go, twice.
• Then turn it off and do the same, so you can feel the difference.
• Everything else should behave exactly as before, both ways. Anything that does not is the bug I want.
