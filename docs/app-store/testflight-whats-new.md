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
The reading voice should now be the one you configured in Settings › Spoken Content: the app asks iOS for your region's default voice first and uses it whenever it is an enhanced or premium one. Your phone had been picking premium Australian Karen over your selection. If it still reads with the wrong voice, tell me — the app logs which path it took and I can read that over WiFi. There is also a Voice… entry in the … menu while listening, as an override; you should not need it.

Also: the player's buttons are bigger and further apart, and the "6" over "…" was the position wrapping onto two lines — it now reads "6 / 178".

Still worth checking: lock the screen mid-article and confirm it keeps reading.
