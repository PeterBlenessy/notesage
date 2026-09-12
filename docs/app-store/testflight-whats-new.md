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

What you found in 65, plus what a code review turned up.

FIXED
• Swiping a row reveals Share and Delete. It never worked before — the swipe
opened the document instead.
• The row menu and the swipe buttons no longer open the document behind them.
• Typing in the search bar filters the folder you are in.
• Thumbnails are kept between visits, so a folder you have opened before draws
at once instead of redrawing everything.
• A saved article's row no longer twitches when you press Listen.

TRY
• Swipe rows left, use Share and Delete, and search inside a folder.
