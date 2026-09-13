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

Menu actions that did nothing now do what they say.

FIXED
• Deleting a folder did nothing at all — no folder removed, no error. It
works now, and takes what is inside it, as the confirmation says.
• Anything that failed on a folder screen failed silently. Failures say so
now, and a completed move says where it went.
• Edit Home opened an empty screen.
• Listen was missing from a note's long-press menu, though the row itself
offered it.

TRY
• Hold a folder, choose Delete, confirm. It should go.
• The … menu → Edit Home: the list of folders should be there.
• Hold a note: Listen should be in the menu, and should play.
