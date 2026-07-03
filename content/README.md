# Content atoms (single-source, multi-channel)

**Spike / proposal.** One markdown file per feature (or feature group) is the single
source of truth. Each atom carries the feature's **facts** (frontmatter) plus one
section per **audience**. Generators pull the right section per channel; a test
validates the facts against the app's own sources so copy can't silently drift.

See the worked example: [`content/features/voice.md`](features/voice.md).

## Anatomy of an atom

```md
---
feature: voice
title: Voice & Transcription
status: shipped
shortcuts:                 # facts — validated against the app (see below)
  - id: toggle-recording
    keys: "⌘⇧R"
    label: Toggle meeting recording
capabilities:
  liveDictation: false
  languages: 99
screenshots:               # must exist in content/screenshots/
  - voice-transcription.png
forbidden:                 # phrases that must never appear in any section
  - live dictation
  - as you speak
---

## [web]        ← marketing website: benefit-first, non-technical
...
## [in-app]     ← in-app guidance: task/procedure, a bit more detail
...
## [social]     ← social snippet: hook + short, per-network trimming later
...
```

- Bodies may use `{{shortcut:id}}` tokens — the generator substitutes the `keys`
  from the facts block, so the shortcut is written in exactly one place.
- **There is no `[developer]` section.** Developer-facing docs live in
  `docs/features/*.md`, change on the code's cadence, and are reviewed with code.
  Atoms **link** to them; they never duplicate them.

## Generating a channel

```bash
node scripts/gen-content.mjs content/features/voice.md --target=in-app
node scripts/gen-content.mjs content/features/voice.md --target=web
node scripts/gen-content.mjs content/features/voice.md --target=social
```

The **web** target will most likely be handled by the site framework's own content
layer once the notesage.io stack is chosen (Astro/Next content collections give
schema + query for free). This script is mainly for the non-web targets.

## Facts check

`src/lib/__tests__/content-facts.test.ts` runs in the normal test suite and asserts:

- every declared shortcut matches an authoritative source
  (`src/shared/appCommandManifest.json` displays ∪ `docs/keyboard-shortcuts.md`);
- no `forbidden` phrase appears in any section (the drift guard);
- every referenced screenshot exists;
- every `{{shortcut:id}}` token resolves;
- all audience sections are present and there is no `[developer]` section.

## Status

Spike proven on one feature (`voice`). If adopted, convert 2–3 more features to
prove the shape before converting everything, then wire the generator into the
in-app help build and let the site framework consume the atoms for the web.
