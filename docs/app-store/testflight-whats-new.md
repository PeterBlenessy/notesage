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

Home's menu and long press work now.

FIXED
• List, gallery and compact now take effect on Home. The menu was there and
did nothing. Searching on Home was dead the same way.
• Holding a folder under All Folders opens its menu again, so you can choose
Show on Home. That is what the tip on Home tells you to do, and it was the one
thing you could not do.
• Inbox and Recordings have their gap back instead of reading as one block.

TRY
• On Home: switch list/gallery/compact, then search. The two cards and All
Folders stay rows whichever you pick.
• All Folders, hold a folder, Show on Home — it should appear on Home at once.
