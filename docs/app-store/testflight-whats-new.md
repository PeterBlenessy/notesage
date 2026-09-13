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

Reading progress shows up on its own now, and your folders keep their colours.

NEW
• Top-level folders wear the icon and colour you gave them on the Mac, in
lists and on the gallery cards.

FIXED
• The progress bar under an article used to appear only after restarting the
app. Closing the reader writes your place immediately, so the row updates
while you watch.
• Progress is read per folder, so an article filed out of the Inbox keeps its
bar instead of losing it.
• Renaming or deleting a file no longer leaves the old row behind for a
moment.
• Scrolling a large folder no longer stutters on the first pass.

TRY
• Open an article, read part of it, come straight back. The bar should already
be there.
• Give a folder an icon and colour on the Mac, then pull to refresh here.
