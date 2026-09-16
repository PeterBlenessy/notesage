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
Saved pages keep the article, and search can explain itself.

CHANGED
• Sharing saves as HTML by default. A saved page arrives as a proper article
— site, reading time, cover — instead of a plain note. Markdown is still in
the share sheet, and your choice is remembered.

FIXED
• A search that matched nothing showed a blank screen. It says so now.
• A result matched on its opening line showed no reason for being there. The
line shifts so you can see the word you typed.

TRY
• Share a page from Safari without touching the format, then look at the row.
• Search for a word that sits mid-sentence, not in a title.
