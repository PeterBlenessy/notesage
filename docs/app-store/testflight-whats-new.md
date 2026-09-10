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

Two recording fixes. One question for you.

FIXED
• A recording that fails to start no longer ends the article being read aloud.
Verified: forced a failure, the reading carried on and kept its place.
• The level trace no longer squeezes the timer and buttons on a narrow screen.

TRY
• Record a minute and watch the moving trace. Should the bars slide along, or
stay in place and change height? Both are defensible; say which reads better.
• Otherwise just use it as usual — anything different from build 59 is a
regression worth reporting.
