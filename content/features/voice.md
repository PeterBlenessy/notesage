---
feature: voice
title: Voice & Transcription
status: shipped
category: voice
summary: "Record a meeting and get a transcript back automatically, entirely on your device."
order: 10

# ── Facts ─────────────────────────────────────────────────────────────────
# The single source of truth for this feature. Validated against the app's own
# authoritative sources by src/lib/__tests__/content-facts.test.ts — so these
# can't silently drift from the code the way the hand-written marketing copy did.
shortcuts:
  - id: toggle-recording
    keys: "⌘⇧R"
    label: Toggle meeting recording

capabilities:
  liveDictation: false      # There is NO live dictation — you record, then it transcribes.
  onDeviceTranscription: true
  languages: 99

screenshots:
  - voice-transcription.png

# Phrases that must never appear in ANY audience section below. Guards against the
# exact drift we hit: copy that called this "live dictation / words appear as you
# speak". The test fails if any of these show up.
forbidden:
  - live dictation
  - as you speak
  - words appear
---

## [web]

**Turn talking into notes.** Record a meeting or a quick spoken summary and Notesage transcribes the whole thing for you — automatically, on your own device. Nothing is uploaded, and it works across 99 languages.

## [deep]

### What it does

Voice in Notesage is about capture. You record a meeting or a spoken summary, and when you stop, the whole recording is transcribed for you in the background — turning a conversation into an editable note. Everything happens on your Mac.

### On-device, in any language

Transcription runs locally with on-device speech recognition, across dozens of languages. No audio is uploaded to a server, which makes it safe for confidential meetings and usable with no internet at all. The original recording is kept alongside the transcript, so you can always return to the source.

### From recording to note

When a transcription finishes, Notesage hands you a note you can edit, tag, and file into a project. Because it becomes an ordinary markdown note, everything else — search, tasks, AI — works on it immediately: ask the assistant to summarise the meeting or pull out action items.

### Example

After a client call, a consultant presses {{shortcut:toggle-recording}} to stop the recording they started earlier. A minute later the transcript appears; they ask the AI to extract decisions and follow-ups, tag it `#acme`, and file it — the whole meeting captured without typing during it.

### When to use it

Meetings, interviews, lectures, and moments when a thought is easier spoken than typed — especially when the content is sensitive and can't go to a cloud service.

### Tips

- Choose the transcription model and language in **Settings → Voice**; larger models are more accurate, smaller ones faster.
- The transcript keeps timestamps, so you can find the moment something was said.
- The recording is retained with the note, so you can re-transcribe later if you upgrade the model.

## [in-app]

Press {{shortcut:toggle-recording}} to start recording, and press it again to stop. Notesage then transcribes the recording in the background and hands you a note. Everything runs locally on your Mac — no audio is uploaded. Choose the language and transcription model in **Settings → Voice**.

## [social]

Your meetings, transcribed on-device — no cloud, no upload, 99 languages. Press {{shortcut:toggle-recording}}, talk, and Notesage hands you the notes. 🎙️
