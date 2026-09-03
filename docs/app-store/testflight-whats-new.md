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
Fixes the wrong voice you hit with Lee: the app only asked iOS for the default voice of your own regions (en-SE, en-US) and en-GB, so an Australian selection was invisible and it fell back to the first premium Australian voice alphabetically — Karen. It now asks every installed region. Play an article; it should read with Lee. If not, tell me — the log capture is running.

Also from code review: changing voice while paused no longer starts playback; Voice… only appears once the article's language is known; and the position label can no longer collapse to "…".
