# Release v0.48.0

**Date:** 2026-08-15
**Previous version:** 0.47.3
**Channel:** Stable

The first stable release since 0.47, and the first under the single-build
scheme.

## Changes

### Features

- **One build for everyone.** Notesage no longer ships a separate alpha
  download. Experimental features arrive in every release, switched off, and
  you opt into them under Settings → Labs. The release-channel picker is gone
  — there is one update path, and one changelog.
- **Usage and crash reporting follow Labs.** They turn on if you enable an
  experimental feature — that is how a feature earns its way out of Labs —
  and stay off otherwise. Your own choice in Settings → Privacy always wins,
  in both directions.
- **Notesage on iPhone.** There is now a companion iOS app. It opens the same
  Notesage folder from iCloud, reads and edits your notes, and captures links,
  images and documents from the share sheet into an Inbox for you to file
  later. It is in internal testing at the moment; wider testing will follow.
- **A second engine for the Local Agent: pi (beta)**, alongside Goose.
- **Permission modes for local agents**, working as they do for the cloud ones.
- **Messages sent while an agent is working are queued** rather than
  interrupting it.
- **Automations** — scheduled and event-triggered tasks.
- **Relations** in the file hover preview, with a morphing handle and panel.
- Agent slash commands appear in the `/` menu.
- A discoverable **Settings button** in the sidebar, with the status strip
  moved to its footer.

### Fixes

- Updating an already-installed agent could leave it unable to start on Apple
  Silicon.
- You are now told when an agent stops before finishing, instead of it going
  quiet.
- Local agentic work has more room, and its failures surface instead of
  vanishing.
- Security: an SSRF in the MCP OAuth redirect, a path traversal in agent
  uninstall, a gated zero-click link-preview fetch, and a dependency advisory.

## Under the hood

The 0.48 line ran to 37 alpha builds; their individual entries remain in this
history and in the changelog feed. This release is the curated summary of what
a user coming from 0.47 would notice.

The single-binary work is PRD
`docs/prds/2026-08-15-single-binary-feature-flags.md`: a typed flag registry
with a defaults-off regression lock (which carries the old channel-isolation
guarantee now that there is no prerelease tag to enforce it), a Labs panel
that states the telemetry coupling above its toggles, per-flag telemetry and a
`labs_flags` crash tag so a feature graduates on evidence, a settings
migration that moved existing alpha users onto the single stream before the
alpha endpoint was removed, and the removal itself.

iOS changes are no longer listed here — they have their own feed
(`public/changelog-ios.json`) and their own notes
(`docs/app-store/ios-release-notes.md`). A changelog is read in the context of
one app.
