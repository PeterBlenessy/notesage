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
Home shows only the folders you chose; the icon counts your unread Inbox; recording starts on the phone.

NEW
• Home: the Inbox and the folders you put there. Hold a folder for Show on Home, or … › Edit Home.
• Each folder remembers its own view, order and grouping.
• The app icon shows your unread Inbox count (turn it on from the Inbox).
• New Recording (hold +): your Mac transcribes it when it syncs in.
• Saved articles now swipe to Share and Delete.

TRY
• Open the Inbox, tap Turn on, allow, then look at the icon.
• Hold +, New Recording, talk a minute, stop, open Recordings.
