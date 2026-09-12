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

All Folders behaves like a real screen now.

FIXED
• All Folders ignored the view menu and its long press did nothing. It shared
an identity with Home, so the app thought you were still on Home the whole
time and applied your choices there. Searching it was dead for the same
reason.
• Compact is offered on Home again, and on any list of folders — it does
change them.
• Folder icons are no longer specks: they scale with the row or card.

TRY
• All Folders: switch list/gallery/compact and search. Home should keep its
own separate view.
• Hold a folder there and choose Show on Home.
