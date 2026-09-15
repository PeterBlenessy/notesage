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
Read aloud, the lock screen, and articles that look like themselves.

NEW
• Saved articles show their own picture in the list and the gallery.

FIXED
• The lock screen could sit showing Pause for an article the app had already
stopped, with nothing left that could dismiss it.
• Its clock counted paragraphs: a 14 minute article read as 1:11. Minutes
now, and it follows the speed you picked.
• A row could claim "2 of 2 min left" a third of the way in.

TRY
• Read one aloud, lock the phone, check the clock — then change the speed.
• Open the Inbox, switch to the gallery: every article should show a cover.
