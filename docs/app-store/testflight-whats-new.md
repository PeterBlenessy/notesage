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

Two recording fixes, and one needs your ears.

FIXED
• Tapping record while an article is read aloud no longer ends the reading
when the recording fails to start. Your place is kept.
• The level trace no longer squeezes the timer and buttons on a narrow screen.

TRY
• Listen to a saved article, then tap record: it should start and the reading
should stop cleanly. A simulator cannot check that one.
• Watch the trace for a minute — should the bars slide along, or stay put and
change height? Say which reads better.
