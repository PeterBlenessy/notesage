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
Read-aloud follows along in notes too, and the Mac's "mark as unread" reaches the phone.

NEW
• Listening highlights the paragraph and word in markdown and text notes, not only saved pages.

FIXED
• Marking an Inbox item unread on the Mac now shows on the phone.
• Exported reports and plain pages keep the small tile in a condensed list.

TRY
• Read a markdown note aloud and watch the paragraph and word marks.
• Mark an Inbox item unread on the Mac, then open the Inbox here.
