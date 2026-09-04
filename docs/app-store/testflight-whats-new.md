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
Two fixes for listening: starting another article while one is paused now plays the new one (the old one used to carry on, in its own language); and pressing Listen in the list lights up only the round button, not the whole row end. Try: pause an article, start a different one in another language from the list; press and hold a Listen button.
