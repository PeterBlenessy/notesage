<!--
"What to Test" for the next TestFlight build. `scripts/ios-testflight.sh`
sends this to App Store Connect after uploading, so it never has to be pasted
into the web form. HTML comments are stripped; only the prose is sent.

Keep it to ONE SCREEN on a phone — roughly 50 words. Testers read this in a
notification, standing up. Anything past the fold is not read, so a long note
is not a thorough note, it is a skipped one. Say what changed and what to
poke at; leave the rest to the changelog.

Rewrite it for each release. Stale notes are worse than none — they send
people testing something that already shipped.
-->
Saved web pages now keep their images. Share an article, give it a moment,
then turn on airplane mode and open it — the pictures should still be there,
and it should show a picture of the page in gallery view instead of a plain
icon. Pull down to refresh; you should see a spinner now.
