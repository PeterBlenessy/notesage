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

Pinned and reading progress work again.

FIXED
• Group by pinned now shows your pinned articles and folders. It found nothing
before, in a library full of pins, because the list read the shared pins file
with the wrong name for the list inside it.
• Reading progress shows again: the bar under a part-read article, and "Read"
on one you finished. Same cause — the file was read the wrong way, and an
empty result looks exactly like "you have not read anything".

TRY
• Pin an article or a folder on the Mac, then open that folder on the phone
and choose Group by pinned from the … menu. It should sit under PINNED.
• Read half an article on either device, go back to the list, and look for the
bar under it.
