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

Reading progress, fixed twice over.

FIXED
• The bar and "Read" appear as soon as you come back from an article. The
list had the right number and never redrew the row.
• On a phone the list could not read the progress file at all once iCloud had
evicted it, so everything looked untouched. Same for your pins.
• A saved article is named by its title in the gallery and in the reader, not
by its filename.

TRY
• Open an Inbox article, scroll about HALFWAY, go back. The bar should be
there straight away — no relaunch.
• Scrolling moves it. Listening saves your place but does not fill the bar.
