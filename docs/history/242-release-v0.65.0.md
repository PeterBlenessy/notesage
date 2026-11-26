# Release v0.65.0

**Date:** 2026-11-26
**Previous version:** 0.64.0

Recording has been rebuilt so that a meeting is not lost without you knowing,
and it can now capture the other side of a call. You can also bring in a video
from Teams and get its transcript with real speaker names.

Most of the audio work in this release could only be tested in simulation. If
recording system audio, or a recording from before this version, misbehaves on
your Mac, the original audio is kept whenever anything is in doubt.

## Changes

### Features

- **Record system audio.** Choose Microphone, System audio, or both. With both,
  your voice and everyone else's are kept apart, so the transcript shows "Me"
  and "Others". System audio needs macOS 14.2 or later.
- **Import a video or audio file.** Bring in a Teams or Zoom recording (MP4,
  MOV, M4A, MP3, WAV and more) from the Recordings view. Only the sound is
  copied into your library, not the video.
- **Add a Teams transcript.** Attach the transcript Teams made (`.vtt` or
  `.docx`) to a recording and its speaker names are matched onto the
  transcript, even if Teams started transcribing later than the recording.
- **Speakers.** Rename "Me", "Others" or any speaker and the whole transcript
  follows.
- **A recording indicator that is always on screen**, with the recorded time, a
  live sound level, and pause, stop and discard. Pause and resume with ⌘⇧U.
- **Recordings view.** Record and import from here, filter the list, rename,
  delete, and see each recording's length, size, source, language and status.

### Improvements

- Mac recordings now go into your library, so they appear in Recordings and on
  your phone. Before, they were saved to a folder the app did not show.
- Recordings take about a tenth of the space.
- Transcribing a long recording uses a fraction of the memory it did, shows
  real progress with time remaining, and can be cancelled.
- Transcripts are named after the recording and carry timestamps.
- Transcription copes better with quiet recordings and long silences.
- A model download continues where it stopped after a network drop or a
  restart, and shows size, speed and time left.
- You are told before recording if no transcription model is downloaded.
- The settings page is called Transcription, and the recording screens are
  available in Swedish.

### Fixes

- A recording could stop capturing sound without any sign when a headset
  disconnected. Recording now continues on the new device and tells you.
- A full disk or a write error went unnoticed while recording carried on.
- A recording interrupted by a crash or by quitting was lost. It is now
  recovered the next time the app opens.
- A silent recording, for example with microphone access denied, was only
  noticed after stopping. You are now warned within seconds.
- The Recordings view could not be left without going through the Inbox, and
  "Open transcript" appeared to do nothing.
- With the command bar pinned there was no way to see or stop a recording.
- "Transcribe again" replaced your transcript, including your corrections,
  without asking.
- After quitting during a transcription, one place said it had failed and
  another showed it as still running.
- Holding the record shortcut could start and immediately stop a recording.
- The Recordings list did not update until it was reopened.

## Known limits

- Dragging a file onto the Recordings view does not import it yet; use Import.
- When system audio access is denied, macOS gives no warning in advance: you
  see a "no sound" warning a few seconds into the recording.
- Quitting while recording does not ask first; the recording is recovered at
  the next launch.
- WebM and MKV videos cannot be imported.
