# Release v0.55.0

**Date:** 2026-08-28
**Previous version:** 0.54.4

Notesage can now transcribe the recordings you already have, not just the ones
it made itself. Agent updates tell you what version you are on, attachments
reach agents as real files, and the status strip no longer covers the Settings
button.

## Changes

### Features

- **Transcribe the recordings you already have.** Transcription only ever
  accepted one specific kind of audio file — the exact format Notesage produced
  when it recorded something itself. Anything else was turned away, including
  an iPhone voice memo, an MP3, or a recording someone sent you. Those all work
  now, along with the audio inside a video. If a file still cannot be read, you
  get a message saying so instead of one claiming it is not a valid recording.

### Improvements

- **Agent updates show you what you have and what you are getting.** The
  "Check for agent updates" button reported nothing at all unless an update
  happened to be waiting, so there was no way to see which version you were
  running. Every installed agent is now listed with its version, the version
  available, and a progress bar while it downloads.
- **Attachments reach agents as files.** Files attached in the command bar were
  pasted into the message as text. They are now handed over as actual
  attachments, so an agent can open them, and a large file no longer fills the
  conversation.
- **The Settings button is always reachable.** A small activity dot could sit
  on top of the Settings gear in the corner of the sidebar and block it. The
  dot is gone; the word count and the focus-mode hint stay.
- **Signing in to GitHub Copilot stays signed in.** The Copilot connection had
  a "Sign out" button that logged you out of Copilot everywhere, including in
  other apps using the same account. It has been removed — disconnecting the
  connection in Notesage no longer touches your Copilot session anywhere else.

### Fixes

- **Sharing a link to a document saves the document.** Sharing a link that
  points at a PDF, a Word file, a presentation, an image, a video or a
  recording saved a short note containing the link instead of the file itself.
  The file is now downloaded and saved under its own name.
- **Every shared file gets a preview and opens properly.** Documents saved from
  a shared link showed a blank grey icon, no preview, and refused to open.
  Presentations, spreadsheets, images, video and audio now all show a proper
  preview and open in the right viewer. Audio files get their own icon.
- **A site logo no longer fills the screen in a saved article.** Some saved
  articles opened with a logo blown up to the size of the whole page, pushing
  the text out of sight.
- **Links inside a saved article work.** Tapping a link that jumps to another
  part of the same document — a contents entry, a footnote — did nothing at
  all. It now scrolls where it should.
- **Text in a saved article is the size the page intended**, rather than
  occasionally being enlarged unevenly.
- **A share that fails says so.** A shared document could be dropped silently
  while the share window closed as though it had been saved.

## Under the hood

- `#803` — audio decoding moved from a hand-rolled RIFF parser to symphonia,
  with a CoreAudio fallback on macOS for its two known gaps (no Opus; an AAC
  decoder less proven than Apple's). Which decoder ran is reported as the
  `audio_decoded` telemetry event (opt-in, eight containers × three outcomes,
  no filename or path) so the fallback's value is measured rather than assumed.
  16 new crates, 14 of them symphonia's own modules.
- `#799` `#800` `#801` `#793` `#796` — ACP resource-link attachments, agent
  update visibility, a pi permission-gate smoke test, Copilot sign-out removal,
  status-dot removal.
- `#791` — CI now watches pi's extension surface and files an issue when it
  moves.
- `#802` `#804` `#806` `#809` — capture and mobile reader fixes, also shipped
  as iOS 0.53.0 builds 21–24.
- Test suite passes on Node 26 as well as the pinned 22; Node's own inert
  `localStorage` global was shadowing jsdom's and breaking 42 tests locally
  while CI stayed green.

## Files Changed

- 17 commits since v0.54.4.
