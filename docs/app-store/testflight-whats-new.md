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
Fixes the wrong-language reading you hit. Ten of the 36 articles in your Inbox were being detected as Danish or Norwegian — all of them English. One localised line was enough to swing it: your X captures are titled "… på X", and that alone made 14,000 characters of English come back as Danish. The language is now decided by a majority vote across paragraphs, so a foreign title gets outvoted by the body instead of deciding for it. Your Swedish articles still read in Swedish.

Still worth checking: lock the screen mid-article and confirm it keeps reading. And the voice will still sound flat — that is Apple's compact voice. Downloading an enhanced English voice under Settings > Accessibility > Spoken Content > Voices should improve it a lot; tell me whether it does, because that decides whether we need a different speech engine.
