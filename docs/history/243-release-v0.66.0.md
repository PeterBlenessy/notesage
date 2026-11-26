# Release v0.66.0

**Date:** 2026-11-26
**Previous version:** 0.65.0

Notesage can now tell the voices in a recording apart and help you put names
on them. Everything happens on your Mac: no audio and no voice data leaves it.

The voice analysis could only be tested with synthetic audio and in simulation.
How well it separates and recognises real voices on your Mac is not yet known;
nothing is ever named without you confirming it.

## Changes

### Features

- **Identify speakers.** From a recording's menu, "Identify speakers…" finds
  the different voices, shows how long each one spoke and lets you play a short
  sample of each, so you can name them. The transcript then shows who said
  what. You can say how many people were in the meeting if you know.
- **Name suggestions.** Each voice gets suggestions to pick from: people who
  introduce themselves in the recording ("this is Anna", "jag heter Erik"), the
  participant list you type in, and voices the app remembers. A suggestion is
  never applied until you choose it.
- **Remember voices on this Mac** (off by default). When on, a voice you name
  can be remembered and suggested in later recordings. Voiceprints are stored
  only in a private folder on this Mac, never in your library or iCloud, and
  you can rename, merge or delete each one, or delete them all, at any time,
  also after turning the setting off.
- **My voice.** Teach the app your own voice from a 15-second sample or an
  audio file, so "Me" is recognised.
- **Learn voices from a Teams transcript** (off by default). After you attach a
  Teams transcript, the app can offer to remember the voices of the people
  named in it.
- **Identify speakers automatically after transcription** (off by default).
  The suggestions wait for you on the recording.
- Recordings with your microphone and system audio on separate tracks keep
  "Me" apart and separate everyone else; a setting covers several people
  sharing one microphone.

### Improvements

- A voice nobody has named is shown as "Speaker 1", "Speaker 2" and so on.
- Naming speakers on a transcript you have edited offers to replace it, keep
  both, or only update the names in your text.
- The voice model (27 MB) is downloaded from Settings → Transcription →
  Speakers, with progress, resume and a verified checksum.

## Known limits

- Identifying speakers is not offered for a recording that already has a Teams
  transcript, since that transcript carries the names.
- Suggestions that were prepared but not saved are gone when the app quits.
- While the 15-second voice sample is being recorded, the recording indicator
  does not show, and starting a normal recording gives an error.
- After "Transcribe again", the speakers have to be identified again.
