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

Folders are drawn natively now. This is the real fix, not another patch.

NEW
• A folder is a native screen. It is not taken down when you open a document,
so coming back cannot blink, jump or go black — those were all the same fault,
and it is gone rather than patched.
• Swipe a row for Share and Delete.
• Saved articles show their title and "publisher · N min" again.

KNOWN, NOT DONE
• No Listen button on a row yet. Home is unchanged.

TRY
• Open and close documents from inside a folder, many times, fast. Anything
that blinks, jumps or goes black is what I most want to hear about.
• Swipe rows, long-press rows, scroll a big folder.
