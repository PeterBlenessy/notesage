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

The two things missing from the last build.

NEW
• A saved article shows its own title, where it came from and how long it
takes to read — with the first line of the piece under it, instead of a
filename made of a date.
• Listen is back, on a row and on a gallery card: one tap plays the piece
without opening it, and a ring fills as it is read.

KNOWN, NOT DONE
• Home is still the old screen.

TRY
• Open the Inbox and look at anything you saved from the web — title, site
and minutes, in list and in gallery.
• Tap Listen, leave the folder, come back: still playing, still Pause.
