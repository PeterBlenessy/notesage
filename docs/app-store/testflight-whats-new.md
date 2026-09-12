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

Home is native now, and the view switch no longer crashes.

FIXED
• Switching between list and gallery crashed the app in build 69. Mine, and
sorry — it is fixed and the crash is covered by a test now.

NEW
• Home is drawn by the app itself rather than the web layer: the Inbox and
Recordings cards, your chosen folders, and All Folders. It should look the
same and feel faster.

TRY
• Switch list and gallery a few times, both ways, in a folder and on Home.
• On Home: open both cards, tap All Folders, and hold a folder there to choose
Show on Home — it should appear on Home straight away.
