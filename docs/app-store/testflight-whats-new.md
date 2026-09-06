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

Swipe back works again, and you can choose where the sound comes out.

NEW
• A button in the player picks the output: phone, headphones, car.

FIXED
• Swiping in from the left edge to leave a document had stopped working.
• Unread items are marked in gallery view too, not only in the list.
• The recording trace shows a voice rising and falling, not a solid block.

TRY
• Play an article, tap the output button, move it to headphones and back.
• Swipe in from the left edge of an article, and of a saved web page.
