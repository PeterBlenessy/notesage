# Release v0.51.0

**Date:** 2026-08-18
**Previous version:** 0.50.0

Transcription got measured rather than guessed at. Notesage now offers two
Whisper models chosen on evidence instead of a ladder of five sizes, and it
stops asking Whisper to work out which language you were speaking — which it
was often getting wrong.

## Changes

### Features

- **Choose a display language.** Notesage can now run in Swedish as well as
  English, under Settings → Appearance → Language. Dates and numbers follow the
  same choice, so you no longer get Swedish labels beside American dates.
- **Two transcription models, described by what they are for.** "Best quality ·
  all languages" is the new default; "Fast · English only" is there when you
  want a long English recording turned around quickly. Settings → Voice.
- **See what each model is before downloading it.** Every model now has an
  "About this model" note giving its accuracy, size, licence, and the exact
  address the file is downloaded from.
- **Re-run a transcription in a different language.** If a recording came out
  in the wrong language, the transcription card can redo it — picking a model
  that can handle the language you chose.

### Improvements

- **Transcriptions no longer guess your language.** Notesage now starts from
  your device's language instead of trying to detect one per recording.
  Detection was reliable for English and unreliable for everything else: on
  Swedish it could produce fluent nonsense in an entirely different language.
  You can still change the language for any recording, and auto-detect is
  still available if you prefer it.
- **Every transcript says which language it was made in**, so a wrong one is
  something you can see and fix rather than something you discover halfway
  through reading.
- **The best model is now also the smallest.** The new default needs about a
  sixth of the memory of the old "large" model and transcribes just as
  accurately — and slightly less memory than the old "small" one while making
  less than half the errors outside English.
- Models downloaded by earlier versions keep working, stay listed, and can be
  deleted to reclaim the space.

### Fixes

- **Sending a message while several chats are working no longer moves you.**
  A queued message used to drag the view back to its own conversation when it
  started; you now stay where you were reading.
- **Dates in table columns behave.** Dates written with slashes no longer
  quietly jump to a different year, and date columns now sort and summarise
  correctly.
- Fixed a potential content-injection weakness in how pasted web content is
  cleaned up — no action needed.

## Under the hood

- Whisper model comparison harness and corpus measurements (#698, #699) —
  `docs/transcription-model-comparison.md`. The corpus runner passed
  repo-relative paths to a command that runs from `src-tauri/`, so every clip
  failed silently and the aggregate printed an empty table; fixed in #730.
- Catalogue reduced to `large-v3-turbo-q5_0` + `small`; retired models are
  still listed from disk so they stay deletable (#731). Persisted-state
  migration moves `speechLanguage: 'auto'` to the device language but
  deliberately does NOT move `defaultModel` — repointing at a model the user
  has not downloaded would fail their next recording.
- `RUSTSEC-2026-0258` (h2 unbounded empty DATA frames) — bumped to 0.4.16
  (#726). Published mid-session; it blocked every PR until fixed.
- `RUSTSEC-2026-0235` rkyv ignore is now enforced by
  `scripts/check-audit-ignore-claims.sh`: the "never compiled" justification
  fails CI if the crate ever enters the build graph (#589).
- `addMessage` and the three send paths take an explicit conversation id so a
  cap-deferred send routes without activating its conversation (#468). Five
  ACP helpers read the store live and needed the same treatment — one spliced
  the watched conversation's history into the deferred send's prompt.
- Frontend and Playwright CI jobs moved to Linux runners (#720).
- iOS work in this window (independent versioning, TestFlight release script,
  in-document link navigation, Inbox naming, Share Extension versioning) is
  routed to the iOS release notes.

## Files Changed

- 20 commits since `v0.50.0`, across transcription, chat, tables, i18n, CI and
  the iOS release tooling.
