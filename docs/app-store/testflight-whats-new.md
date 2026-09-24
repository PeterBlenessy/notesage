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
Two fixes to the licence screen, and one to where it turns up.

FIXED
• Acknowledgements was offered from every folder, not just Home. Opening it
from inside a folder and pressing Back dropped you at the top of your library.
• 102 packages showed no licence text at all. They now show the standard text
for their licence, marked as standard. 65 more cannot be fixed and now say so
instead of showing nothing.

TRY
• Open any folder, then "…". Acknowledgements should NOT be there — only on Home.
• Home → "…" → Acknowledgements → Apache 2.0, then a package. The text should be
there, with a line saying where it came from.
