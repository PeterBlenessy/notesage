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

A fresh install now makes its own library — no folder to pick.

NEW
• Recordings has its own card under the Inbox, always there.
• Swipe in from the left edge of a document to go back.
• The recording bar matches the player and draws your voice.

FIXED
• Thumbnails are there when the list opens, not after.
• The unread count moves again.

TRY
• Swipe in from the left edge to leave an article, then a saved web page.
• For the new library setup, delete the app and install again: it must never ask for a folder.
