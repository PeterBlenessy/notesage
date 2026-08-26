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
Cancel now actually cancels. Share an article, tap Save, then tap Cancel
before it finishes — nothing should appear in your library. Try it on a slow
page, where there is time to catch it. Saving a plain link or a video should
also feel instant now, with no frozen sheet.
