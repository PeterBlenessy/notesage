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

Native navigation is now how the app navigates — no switch, nothing to turn on.

NEW
• Home, folders and documents live in a real iOS navigation stack: the system's own back gesture, with the list moving behind the article as you swipe it away.
• The screen is taller. The list was reserving room for a title row that the navigation bar already provides, which cost it a row everywhere.

FIXED
• The read-aloud player stayed hidden when you started listening inside a document.
• Section headings ("Recent", "All notes") stuck under the title bar instead of below it while scrolling.

TRY
• Open a folder, then a document, then swipe in from the left edge — stop halfway and let go, twice.
• Start Listen from inside an article and check the player is there.
• Scroll a long list and watch where the section heading parks.
