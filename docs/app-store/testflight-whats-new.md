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

Everything you found on the phone, fixed — and a recording now shows on the lock screen.

FIXED
• Stop is no longer hidden behind the search pill.
• Errors appear instead of hiding under the toolbar.
• Unread Inbox items are the bolder ones; opened ones step back.
• The icon count moves again on a synced library.
• The launch logo stays sharp as it grows.

TRY
• Record, lock the phone, pause and resume from the lock screen, then unlock and stop.
• Read something in the Inbox and watch the icon count drop.
