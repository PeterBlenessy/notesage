# Speakers

Speaker identification answers "who said what" in a recording. It has two parts with very different privacy weight:

1. **Finding the voices** in one recording ("Speaker 1, 2, 3"), so the user can name them after the meeting. Nothing is remembered.
2. **Remembering voices** (opt-in): once a voice has a name it can be suggested in later recordings. This stores voiceprints, which are biometric data.

Everything runs on this Mac. No audio, no voiceprint and no name is sent anywhere; the only network request the feature makes is the one-time download of the voice model.

This document covers the backend (`src-tauri/src/commands/speakers/`). Command signatures are in `docs/tauri-commands.md` § Speakers.

## Pipeline

```
audio file(s) ──decode──▶ 16 kHz mono stream, 30 s blocks
   └─▶ speech regions (energy gate)                         vad.rs
        └─▶ 1.5 s windows every 0.75 s                       vad.rs
             └─▶ 80-bin log mel features                     fbank.rs
                  └─▶ voice model: one 256-number vector per window   tract_engine.rs
                       └─▶ group vectors into speakers       cluster.rs
                            └─▶ turns, per-speaker mean vector, sample   turns.rs
                                 └─▶ label transcript segments           assign.rs
```

- **Streaming.** Audio is decoded as a stream and analysed half a minute at a time. Per window only its vector and two timestamps are kept, so memory does not grow with the recording.
- **Speech regions** come from an energy gate: 22 dB below the loud level of the track, pauses up to 0.3 s closed, bursts under 0.2 s dropped. It is tighter than the gate transcription uses, which only skips silences of two seconds and more.
- **Clustering** is agglomerative (average linkage on cosine distance, cut at 0.70), so the number of speakers does not have to be known. `expected_speakers` overrides the cut; without it at most 12 speakers are reported. A group of a single window is not a speaker and joins the nearest one.
- **Turns.** Consecutive windows of one speaker form a turn (pauses up to a second are bridged); a single odd window inside a turn is smoothed away; turns under half a second join a neighbour. Speakers are labelled `speaker-1`, `speaker-2`, … in order of first appearance.
- **Sample.** For each speaker the longest clean turn is offered for playback, cut to at most eight seconds (five to eight when the speaker has a turn that long).
- **Transcript segments** get the speaker with the most time in them. A segment is split between two speakers only when both hold a substantial part of it and the text has a sentence end near the change. Whisper segments carry no word times, so text is never cut mid-sentence.

### Two tracks

A recording made with source `both` has a `mic` track (the user) and a `system` track (everyone else).

- The microphone track is `me`. It is not diarised; its speech becomes `me` turns, and a sparse sample of windows (at most 80) gives the user's voice vector.
- The system track is diarised into `speaker-1`, `speaker-2`, …
- A transcript segment that was transcribed from the microphone track only ever gets `me`; one from the system track only a remote speaker. Without headphones the microphone also hears the loudspeakers, so `me` *turns* can include echo; the transcript is already de-duplicated by the transcription step.
- When several people share the microphone, pass `shared_microphone`: the microphone track is diarised too and there is no `me`.

A single track (a room recording, an imported video) is diarised as a whole; the user is then one of the numbered speakers, and can be suggested by their enrolled voice.

## The voice model

| | |
| --- | --- |
| Model | WeSpeaker ResNet34-LM, trained on VoxCeleb2 (0.72 % equal error rate on VoxCeleb1-O) |
| Licence | **CC-BY-4.0**. WeSpeaker publishes its pretrained models under the licence of their training data; VoxCeleb is CC-BY-4.0. Attribution: WeSpeaker (https://github.com/wenet-e2e/wespeaker) and the VoxCeleb dataset (https://mm.kaist.ac.kr/datasets/voxceleb/). The model's licence and source are shown in the model list (`speaker_models_status`). |
| File | `wespeaker_en_voxceleb_resnet34_LM.onnx`, 26 530 550 bytes, SHA-256 `e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012` |
| Download | `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx` (the ONNX export republished by the sherpa-onnx project; the path really is spelled `recongition`) |
| Stored | `~/.notesage/speaker-models/` |

The model is downloaded on demand with the same resumable downloader as the Whisper models; size and hash are enforced before the file is used. The hash was computed from the file as downloaded from that URL on 2026-11-26, and that file produced every measurement below. It has not been compared with a hash from WeSpeaker itself, which publishes none.

### Runtime: `tract`, not ONNX Runtime

The model runs in [`tract`](https://github.com/sonos/tract) (`tract-onnx`, MIT OR Apache-2.0), a pure-Rust ONNX engine. The alternatives were tried when this was built:

- **ONNX Runtime via `ort`**: only release candidates of 2.x exist; its default build downloads a prebuilt native library from a third-party CDN at build time; otherwise the app has to ship, sign and load `libonnxruntime.dylib` (30 MB or more) itself.
- **sherpa-onnx via `sherpa-rs`**: the same native library plus a C++ layer, about 40 MB of shared libraries.
- **tract**: no native library, nothing downloaded at build time, the same code compiles for every target. Slower per inference than ONNX Runtime with CoreML, which the pipeline offsets by embedding windows on up to eight threads.

The price of tract: the pyannote segmentation model (overlap-aware speaker-change detection) does not load in it, so segmentation is the energy gate plus fixed windows. See the limits below.

`engine::fake::SpectralEngine` is a second engine that needs no model: the long-term spectrum of a window as its "voice". It exists for tests only (compiled under `cfg(test)`), tells apart synthetic voices, and would confuse real people; it is not a fallback.

## What is stored where

| Data | Where | Notes |
| --- | --- | --- |
| Speaker labels per segment (`speaker-1`, `me`) | the recording bundle, `segments.json` | synced with the library |
| Display names (`speaker-1` → "Anna") | the recording bundle, `speakers.json` | synced with the library |
| Voice vectors of an analysis | memory only | returned to the frontend so a speaker can be saved without analysing again; **never written to a bundle, a note or a log** |
| Remembered voices (voiceprints) | `~/.notesage/voice-profiles/<id>.json` | this Mac only; folder `0700`, files `0600` |
| Sample clips for playback | `<system temp>/notesage-speaker-clips/` | folder `0700`, files `0600`; removed after an hour and when the app quits |
| Voice model | `~/.notesage/speaker-models/` | not personal data |

A profile file holds: `id`, `name`, `is_me`, `created_at`, `updated_at`, `sources` (`manual`, `teams` or `enrolment`, with the recording it came from), the `model` it belongs to, up to 20 example vectors and their mean.

## Privacy properties

- **On device.** Analysis, matching and storage happen in the app's own process. The feature has no network code apart from the model download.
- **Opt-in, enforced twice.** The setting is the frontend's. Independently, the three commands that create or compare voiceprints (`voice_profile_save`, `voice_profiles_match`, `enrol_own_voice`) refuse with `Voice recognition is not enabled` unless the caller passes `consent: true`, so a UI bug cannot silently create voiceprints. Finding the voices of one recording needs no consent: it stores nothing.
- **Never synced, never exported.** `~/.notesage/voice-profiles/` is outside the library and outside iCloud. Sync (`sync.rs`) only handles the library root and the iCloud container; export writes documents the user chooses; neither walks `~/.notesage`.
- **Closed to AI agents.** Sandboxed agent processes are otherwise granted `~/.notesage` (their own binaries and state live there) and can reach the network. The Seatbelt profile therefore denies reading and writing `~/.notesage/voice-profiles` (`sandbox.rs`, `PRIVATE_DATA_SUBPATHS`). Sample clips and recordings are not covered by this: an agent that may read the library can read recordings.
- **Suggestions only.** A remembered voice is offered as a candidate with a confidence band; the user confirms. Nothing is named automatically.
- **Deletable.** One person: `voice_profile_delete`. Everything: `voice_profiles_delete_all`, which removes every profile, every file that was moved aside, the folder itself and all sample clips. Deleting the voice model does not delete profiles.
- **A damaged profile file is never deleted behind the user's back.** It is renamed to `<name>.corrupt-<time>` in the same folder and reported as `quarantined`; "delete all" removes it.
- **Tied to the model.** A profile made with another voice model is listed but never matched, and is replaced when the person's voice is saved again.

## Matching remembered voices

`voice_profiles_match` compares each speaker's mean vector with each profile's mean vector (cosine similarity):

| Band | Rule |
| --- | --- |
| `likely` | score ≥ 0.55 and at least 0.08 above the next best other person |
| `possible` | score ≥ 0.42 |
| not offered | below 0.42 |

One person is `likely` for at most one speaker of a recording. With a participant list only the listed people (and the user's own profile) are offered, and their thresholds are 0.05 lower.

## Measurements

Run on 2026-11-26 in a Linux container (4 virtual x86 cores) with the real model in tract 0.21.10 and the real pipeline code, on sample audio published with sherpa-onnx (four short conversations) and the `sr-data` speaker-verification clips (clean read speech, Mandarin and English, six people). A small, clean set: indicative only. **Nothing has been measured on a Mac or on real meeting recordings.**

Cosine similarity of whole-clip vectors: the same person in two clips 0.60 to 0.71 (5 pairs); different people −0.23 to 0.37 (61 pairs). Single 1.5 s windows: same person, other clip, median 0.45; different people, median 0.02, maximum 0.36. Two different people inside one conversation had mean vectors 0.49 alike (the shared room and microphone pull voices together).

Enrolling five people from one clip each and matching their other clip: all five `likely` (0.60 to 0.71); two strangers: no candidate.

Speakers found in the sample conversations (names say 4, 2, 2, 2): 5, 2, 4, 2. The extra speakers are contiguous stretches whose voice is unlike everyone else's (similarity 0.09 to 0.26); whether those samples contain more voices than their file names say could not be checked. A cut at 0.75 instead of 0.70 merged two real speakers; 0.60 split one.

Speed: ten minutes of dense conversation (565 windows) took 18.4 s on four cores, 33 times faster than real time; an hour of continuous talk would take about two minutes there. Peak memory of the test process was 148 MB including the ten minutes of test audio it held; the model itself takes about 60 MB loaded.

## Accuracy limits

- **People talking at once** are not separated. The stretch goes to one of them or, if long, may show up as an extra speaker.
- **Short turns.** Speech under half a second is not analysed; a one-word interjection inside someone else's turn usually stays with that turn. Turn boundaries are accurate to about half a second.
- **Quiet participants.** Someone who speaks for less than about two seconds in total does not become a speaker.
- **Similar voices** in the same room can be merged into one speaker. **One person can be split** when their voice or channel changes (moving away from the microphone, a second device). `expected_speakers` helps with both.
- **Telephone-quality or heavily compressed audio** lowers every similarity.
- **Language.** The model was trained mostly on English speech. It separated the Mandarin samples as well as the English ones; Swedish has not been measured.
- **The thresholds** come from a handful of clean clips and should be revisited with real meetings.

## Tests

Every pure piece has unit tests with synthetic data (`cargo test`, CI on macOS). The real model has a smoke test that runs only when the model file is present (`~/.notesage/speaker-models/`, or `NOTESAGE_SPEAKER_MODEL=<path>`) and is skipped otherwise.

## The user interface

Everything below is frontend. The commands it calls are described above; the exact shapes are in
`docs/tauri-commands.md`.

### What the user sees

**Settings → Transcription → Speakers** (`src/components/recordings/VoiceProfilesSettings.tsx`, mounted at the
end of `TranscriptionSettings.tsx`; section id `settings-speakers`):

- **Voice model**: size, the licence line the backend gives, download with progress, cancel, retry after a
  failure, delete. Deleting the model keeps the stored voices.
- **Remember voices on this Mac** (off by default). Turning it on opens an explanation that has to be
  confirmed; turning it off with voices stored asks whether to delete them too.
- **Learn voices from Teams transcripts** (only shown while the first is on; off by default).
- **Identify speakers automatically after transcription** (off by default).
- **My voice**: record about 15 seconds with the ordinary recorder, or choose an audio file; record again;
  remove. Disabled, with the reason, while voices are not remembered, the model is missing, or a meeting is being
  recorded. The recorded sample is deleted as soon as the voiceprint has been made.
- **Known voices**: name, when added, where it came from (named in a recording / Teams transcript / voice
  sample), number of samples; rename, merge into another, delete one, delete all. The list and every delete work
  while remembering is turned off.

**Recordings → a row's menu → "Identify speakers…"** (`IdentifySpeakersDialog.tsx`, `SpeakerRow.tsx`), offered
when the recording has a transcript and no Teams transcript. The dialog shows one of three screens, chosen by
what exists for the recording, so closing and reopening it lands where things are:

1. *Before*: who was in the meeting (optional; commas or new lines; remembered in the recording's
   `speakers.json`), number of speakers (optional), and for a microphone + system-audio recording "More than one
   person used my microphone". If the voice model is not downloaded the dialog says so and opens the settings
   section instead.
2. *Running*: "Waiting for transcription to finish" while another job is ahead in the queue, then the stage and
   percent, with Stop. The dialog can be closed; the row shows the same progress.
3. *Voices*: each voice found with a Play button for a short sample, how long it spoke, a name field, and
   suggestions as chips: "Likely Anna" / "Possibly Anna" (a remembered voice), a name "from the transcript" (the
   voice introduced itself), and participants nobody has been named as yet. With voices remembered, each voice
   has a "Remember this voice" box, ticked by default only once the voice has a name.

"Save names" writes `segments.json` (segments now labelled `me` / `speaker-N`), `speakers.json`
(`names`, the `labels` found, the `participants`) and regenerates the transcript. A transcript nobody has typed
in is regenerated in place. One that has been edited, or whose history is unknown, brings up the usual
Replace / Keep both / Cancel; for such a transcript there is also "Update names in text", which keeps the text
and its segments and only swaps names where turns begin, for voices that are the same speaker the transcript
already had.

An unnamed voice is stored as its label and shown as "Speaker 1" ("Talare 1") in the transcript, the row and
the rename dialog, following the app's language. The existing "Speakers" rename dialog keeps working.

**After a Teams merge**, with both opt-ins on and the model installed, a toast offers "Remember these N
voices". Nothing happens unless its action is clicked. People with too little clear speech are reported as
skipped. In a microphone + system-audio recording the user's own name is left out (their voice is on the other
track; it is enrolled under "My voice").

**Automatically**, when that setting is on: a finished transcription is followed by an analysis that only
prepares suggestions. The row says "Speaker names suggested"; nothing in the bundle changes until the user opens
the dialog and saves.

### The privacy model, in plain words

- A **voiceprint** is a list of numbers that describes how a person sounds. It is biometric data about that
  person.
- Telling the voices in one recording apart makes voiceprints, uses them, and throws them away. Nothing is kept
  unless **Remember voices on this Mac** is on.
- With it on, a voiceprint is kept for a voice only when the user ticks "Remember this voice" for it (or accepts
  the Teams offer, or enrols their own voice). It is stored on this Mac only, in `~/.notesage/voice-profiles/`:
  not in the library, not in iCloud, not in any recording's folder, never sent anywhere.
- A remembered voice is only ever a **suggestion**. No name is put on a voice unless the user clicks it or types
  it, and nothing is written until "Save names".
- The user should have the consent of the people they record before storing their voices. The app says so when
  the setting is turned on.

How the frontend holds to this:

- The setting itself is the consent. Every call that makes or compares a voiceprint (`voice_profile_save`,
  `voice_profiles_match`, `enrol_own_voice`) is passed the setting's value, never a literal `true`, and is not
  made at all while it is off; the backend refuses it besides.
- An analysis result (which carries voiceprints) lives in a plain in-memory map
  (`src/lib/speakers/analysis-cache.ts`), outside the persisted store, bounded to eight recordings, emptied when
  names are saved and when all voices are deleted, gone when the app quits. `speakers-store` persists three
  booleans and nothing else. Voiceprints are never written to a bundle, to a log, or into the page.

### Deleting everything

Settings → Transcription → Speakers:

- **Known voices → Delete all voices…** removes every stored voiceprint, including the user's own, any damaged
  profile files that were set aside, and the sample clips made for listening.
- One voice: its **⋯** menu → **Delete…**. The user's own: **My voice → Remove my voice**.
- Turning **Remember voices on this Mac** off offers the same deletion, and the list stays available for
  deleting afterwards.
- **Voice model → delete** removes the model file (stored voices are kept until deleted as above).

Names already written into transcripts are ordinary text and stay as they are.

### Where the code is

| Path | What |
| --- | --- |
| `src/stores/speakers-store.ts` | The three settings (persisted), model/download state, stored-voice summaries, running jobs |
| `src/lib/speakers/run-analysis.ts` | `analyze_speakers` as a job: progress, queue bookkeeping, cancel by job id |
| `src/lib/speakers/analysis-cache.ts` | In-memory analysis results |
| `src/lib/speakers/apply.ts` | What is written on "Save names"; saving ticked voices |
| `src/lib/speakers/introductions.ts` | `findIntroductions`: "this is Anna" / "jag heter Erik" (no language model) |
| `src/lib/speakers/match-labels.ts` | Carrying names across a second analysis by overlap of turns |
| `src/lib/speakers/suggestions.ts` | Participant parsing; the order of suggestion chips |
| `src/lib/speakers/display-names.ts` | `speaker-N` → "Speaker N"; which names are stored |
| `src/lib/speakers/teams-learn.ts` | The offer after a Teams merge |
| `src/lib/speakers/auto-identify.ts` | The automatic run after a transcription |
| `src/components/recordings/IdentifySpeakersDialog.tsx`, `SpeakerRow.tsx`, `VoiceProfilesSettings.tsx` | The UI |

`speakers.json` gained two optional keys, both omitted when empty: `labels` (every label the analysis found,
so the row can list a voice nobody has named) and `participants`.
