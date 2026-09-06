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

The Inbox is there from the first launch, and articles close with a swipe.

FIXED
• The Inbox is on Home from a clean install, before anything has been shared into it — and opening it works.
• Swipe in from the left edge to leave a saved article. It worked in notes, never in articles.
• "Try again" on a folder the app owns now makes the folder.

NEW
• Listen to a note, not only a saved article.

TRY
• Open the Inbox from Home, then from the menu at the top.
• Swipe in from the left edge of a saved article, then of a note.
