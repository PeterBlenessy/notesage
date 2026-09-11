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

Build 61 made the blink worse. This undoes that.

FIXED
• Coming back from an article no longer shows the list with empty tiles that
fill in afterwards. Build 61 moved thumbnail loading to a point that arrived
too late; what is already known is now drawn straight away.

TRY
• Open an article and go back, several times, in a folder with pictures. The
list should come back exactly as you left it — no empty squares, no second
list appearing over the first.
• Scroll a big folder fast, list and gallery, to check pictures still keep up.
