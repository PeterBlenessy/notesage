# Tasks: Single binary with feature flags

PRD: `docs/prds/2026-08-15-single-binary-feature-flags.md`.

Legend: ✅ done · 🚧 in progress · (blank) pending.

Order matters between features: **Alpha migration ships before Deletion**, or
users on `0.48.0-alpha.N` are stranded on a dead endpoint.

## Feature: Flag registry

### #1 — `FLAGS` registry + `useFlag`
`src/lib/flags.ts`: a `const` registry keyed by flag id, each entry carrying
`stage` (`experimental | beta`), `summary`, `introducedIn`, `default`. Types
derived from the registry so `useFlag("typo")` is a compile error. Reader hook
`useFlag(id)` plus a non-React `isFlagEnabled(id)` for stores and lib code.

### #2 — Flag state store
Where the on/off state lives, persisted. Own store rather than
`settings-store` (PRD open question — resolved here: a corrupted settings blob
must not be able to enable a flag, and flags need their own migration story as
ids come and go). Unknown ids in persisted state are dropped on rehydrate, so
a removed flag cannot resurrect.

### #3 — Defaults-off regression lock
Test asserting **every** registry entry has `default: false`, and that a fresh
store enables nothing. This is what replaces the channel-isolation guarantee
(`.claude/feedback/feedback_channel_isolation_hard_guarantee.md`); the
feedback rule is updated to point at it.

## Feature: Labs panel

### #4 — Settings → Labs
Panel listing each flag: name, summary, stage badge, toggle. Empty state when
the registry is empty. "Reset all Labs features" action — one obvious way back
for a user who has broken something.

### #5 — Telemetry disclosure at the point of action
The first enable in a session explains, in the panel, that enabling Labs turns
on usage + crash reporting and how to turn it off. Wording mirrors
`docs/telemetry.md`. Not a modal — inline, and it must appear before the
toggle takes effect on first use.

## Feature: Graduation signal

### #6 — Labs telemetry events
`labs_flag_changed { flag, value }` and `labs_feature_used { flag }` added to
the fixed taxonomy in `src/lib/telemetry.ts`. Flag ids are low-cardinality by
construction (they come from the registry), so the taxonomy guarantee holds.

### #7 — Effective telemetry default follows Labs
`selectEffectiveTelemetryUsage` / `…Crash` treat "any flag enabled" as the
default-on condition, replacing `buildIsAlpha()`. An explicit user choice
still wins in both directions.

### #8 — Crash reports carry enabled flags
`labs_flags` tag on Sentry events (scrubber untouched — flag ids are not PII).
Lets a crash be attributed to, or cleared of, a flag.

## Feature: Alpha migration

### #9 — Final alpha resets `releaseChannel`
Store rehydration forces `releaseChannel: "stable"`. Ships as an alpha so it
reaches exactly the users who need it. One-way and idempotent.

### #10 — Confirm the alpha endpoint is quiet
Manual gate before #11–#15: no further requests / no users left on the alpha
manifest. Recorded in the PRD, not code.

## Feature: Deletion

### #11 — Remove the alpha update path
`alpha_check`, `AlphaUpdateMetadata` (Rust), `ALPHA_UPDATE_ENDPOINT`,
`checkAlphaChannel`. `useAutoUpdate` keeps one path.

### #12 — Remove `releaseChannel`
Setting, its Settings UI, and every consumer (`useChangelog`,
`SystemSettings`, tests). Persisted values are dropped on rehydrate.

### #13 — One changelog
Delete `public/changelog-alpha.json` and the dual-changelog branch in
`release.yml`. `useChangelog` reads one file.

### #14 — Remove `buildIsAlpha()`
Dead once #7 lands. `app_launched.channel` prop dropped from the taxonomy.

### #15 — Release cutter
`aw-alpha-cut` becomes the release cutter (plain semver, no prerelease
suffix, `prerelease: false`); `aw-alpha-prep` folds into it. Tag format and
the release-notes path updated.

## Feature: Prove the loop

### #16 — Port one real feature onto a flag
Pick an in-flight feature, ship it flagged, and confirm the whole loop:
enable → events arrive → crash tag present → graduation decision recorded.

### #17 — Docs
`docs/features/` references to the alpha channel removed; `docs/telemetry.md`
gains the Labs coupling; release runbook updated for the single stream.
