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
Home shows only the folders you chose, and every folder remembers its own view.

NEW
• Home: the Inbox and the folders you put there; everything else under All Folders. Hold a folder for Show on Home, or use … › Edit Home.
• Each folder remembers list or gallery, order, grouping and Condensed on its own.
• Folders show the icon and colour you gave them on the Mac, in the list and as gallery cards.
• The launch logo grows while the app starts.

FIXED
• Condensed is no longer offered where it changed nothing.

TRY
• Open All Folders, hold a folder, choose Show on Home, go back.
• Set one folder to gallery and another to list, then switch between them.
