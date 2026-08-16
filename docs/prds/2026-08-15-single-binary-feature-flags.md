# Single binary with feature flags

**Status:** proposed
**Date:** 2026-08-15
**Supersedes:** the alpha release channel (`docs/features/` references to
`releaseChannel`, `alpha_check`, `changelog-alpha.json`)

## Problem

Notesage ships two artifact streams — stable tags and `-alpha.N` tags flagged
`prerelease: true` — and carries a surprising amount of machinery to keep them
apart:

| Piece | Where |
| --- | --- |
| Bespoke alpha update path | `alpha_check` + `AlphaUpdateMetadata` (Rust), `ALPHA_UPDATE_ENDPOINT` |
| Stock updater path | `useAutoUpdate.checkStableChannel` |
| Channel selector | `settings.releaseChannel`, consumed by `useAutoUpdate`, `useChangelog`, `SystemSettings` |
| Two changelogs | `public/changelog.json`, `public/changelog-alpha.json`, plus branching in `release.yml` |
| Build-channel inference | `buildIsAlpha()`, which silently drives the telemetry default |
| Cut automation | `aw-alpha-cut`, `aw-alpha-prep` |

The cost is not just the code. Every release decision becomes "which stream?",
every changelog entry has two homes, and a mistake in the `prerelease` flag has
already shipped alpha builds to stable users once
(`.claude/feedback/feedback_channel_isolation_hard_guarantee.md`).

**The conflation:** "alpha" currently means two unrelated things — *which
binary you receive* and *what is turned on inside it*. Feature flags keep the
second and delete the first.

## Goal

One artifact, one update endpoint, one changelog. Experimental behaviour ships
in every build, off by default, opt-in through a Labs panel, and graduates on
evidence that it is stable.

## Decisions (Peter, 2026-08-15)

1. **Telemetry defaults ON once any Labs flag is enabled.** Enabling Labs is
   the new "opting into alpha", and it is what produces the signal that
   decides graduation (decision 4). Off for everyone else.
2. **Labs is a visible Settings panel**, listing each flag with a description
   and a stage badge.
3. **Keep cutting often, from `main`.** Every cut is a real release;
   `aw-alpha-cut` becomes the release cutter.
4. **Flags graduate on evidence, not on a timer** — usage and telemetry must
   show a feature is stable before its flag is removed.

Decision 1 was chosen over "off by default" knowingly: see
[Consent](#consent-obligation) for the obligation it creates.

## Design

### Flag registry

A single typed registry — not booleans scattered through `settings-store`:

```ts
export const FLAGS = {
  "relations-panel": {
    stage: "experimental",          // experimental | beta
    summary: "Backlinks and relations panel",
    introducedIn: "0.49.0",
    default: false,
  },
} as const;
```

Read through `useFlag("relations-panel")`. The id is the join key for
everything below: the Settings row, the telemetry props, the crash tag, and
the graduation query.

Precedent: `uiPreview` was exactly this pattern, and was correctly deleted once
Quiet Composer graduated. The registry generalises it.

### Labs panel

Settings → Labs. Per row: name, one-line summary, stage badge, toggle. The
panel carries the telemetry disclosure (below) and a "reset all Labs features"
action, so a user who has broken something has one obvious way back.

### Telemetry coupling and graduation signal

Enabling any flag sets the effective telemetry default to on — the user can
still turn it off, and that is respected.

The existing taxonomy in `src/lib/telemetry.ts` is fixed and low-cardinality
by design; this adds to it in the same shape:

| Event | Props | Answers |
| --- | --- | --- |
| `labs_flag_changed` | `{ flag: FlagId, value: "on" \| "off" }` | Is anyone trying it? Are they turning it back off? |
| `labs_feature_used` | `{ flag: FlagId }` | Is it used, or merely enabled? |

Crash reports gain a `labs_flags` tag listing enabled flags, so a crash can be
attributed to (or cleared of) a flag. `app_launched.channel` loses its
`"alpha"` value and the prop is dropped.

**Turning-off-again is the most valuable signal here** and the easiest to
overlook: a flag that is enabled and then disabled within a session is a
stronger statement than one nobody touched.

### Graduation

A flag is removed — feature on for everyone, old branch deleted — when:

- it has been enabled on a meaningful number of installs, and used, not just
  enabled;
- no crash or error carries its tag over the most recent releases;
- no open issue is labelled with it;
- the disable-after-enable rate is not elevated.

**Insufficient data is not a pass.** Nor is it grounds for the flag living
forever: when a flag has been in place for three releases without enough
signal to judge, it comes up for an explicit decision — graduate it on
judgement, keep it with a stated reason, or remove the feature. That is a
*review trigger*, not the automatic failure rejected in decision 4.

The realistic caveat: today's install base is small, and mostly Peter. In
practice the first few graduations will be "used it daily for three releases,
nothing broke" — which is fine, as long as it is said out loud rather than
dressed up as statistics.

### What replaces channel isolation

Today's hard guarantee is *stable users never receive alpha builds*, enforced
in `release.yml` (the `prerelease` flag) and in the app. It becomes:

> Users never get unfinished behaviour unless they opt in.

The regression lock must move with it: a test asserting **every flag in the
registry defaults to `false`**, so a feature cannot reach users by a careless
default. Without that test moving across, the guarantee lapses silently — the
exact failure the original feedback rule was written about.

### Migrating existing alpha users

This is the step that strands people if skipped. Users on `0.48.0-alpha.N`
have `releaseChannel: "alpha"` pointing at the alpha endpoint. Deleting that
endpoint first leaves them silently unable to update.

Order:

1. Ship a final alpha whose store rehydration forces `releaseChannel` to
   `"stable"`.
2. Confirm the alpha endpoint has gone quiet.
3. Then delete the alpha path.

## Phases

**1 — Registry and Labs panel.** `FLAGS`, `useFlag`, the Settings panel, the
defaults-off regression lock. Nothing else changes; both channels still exist.

**2 — Telemetry.** The two new events, the crash tag, the Labs disclosure, and
the effective-default change. Ships before the channel deletion so signal
starts accumulating early.

**3 — Alpha migration.** The final alpha that resets `releaseChannel`.

**4 — Deletion.** `alpha_check`, `AlphaUpdateMetadata`, `ALPHA_UPDATE_ENDPOINT`,
`changelog-alpha.json` and the `release.yml` branch, `releaseChannel` and its
UI, `buildIsAlpha()`, `checkAlphaChannel`. `aw-alpha-cut` becomes the release
cutter; `aw-alpha-prep` folds into it. Version strings lose their suffix.

**5 — First flagged feature.** Port one real in-flight feature onto a flag to
prove the loop end to end, including graduation.

## Risks

**Flags do not cover infrastructure.** A SQLite migration, a Rust rewrite or a
dependency bump cannot hide behind a UI flag. The alpha channel absorbs that
risk today; afterwards `main` *is* what users run, so CI and the real-E2E
suite carry weight they do not carry now. This is the real cost of the change
and it is worth accepting deliberately rather than discovering later.

**Combinatorial surface.** N flags is 2^N configurations, and only the
all-default one is fully tested. Keeping flags few and short-lived is the only
mitigation that works; the graduation review is what enforces it.

**Consent obligation.** Because enabling a *feature* also enables *data
collection*, that must be stated where the user acts — plainly in the Labs
panel, at the moment of the first toggle, not only in the privacy policy.
Anything less is a dark pattern. `docs/telemetry.md`, `docs/app-store/`
privacy answers, and the privacy policy all need the same wording.

**iOS is unaffected.** The mobile app is telemetry-free by construction and
has no update channel; Labs is desktop-only unless deliberately extended.

## Open questions

- Do flags belong in `settings-store` (persisted, synced with other prefs) or
  in their own store, so a corrupted settings blob cannot silently enable one?
- Should the Labs panel expose per-flag "report a problem", pre-filling an
  issue with the flag id? Cheap, and it makes the graduation signal richer
  than telemetry alone.
