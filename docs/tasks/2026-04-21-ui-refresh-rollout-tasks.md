# UI Refresh — Phase 2 + 3 (Rollout) Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-22 |
| **Status** | Not started — gated on Phase 1 ship |
| **PRD** | [ui-refresh](../prds/2026-04-21-ui-refresh.md) |
| **Phase 1 tasks** | [ui-refresh-phase1-tasks](./2026-04-21-ui-refresh-phase1-tasks.md) |
| **Total** | 16 tasks: 6 S, 7 M, 3 L |
| **Phases covered** | 2 (default-on for new installs) + 3 (legacy deletion) |

## Scope

Work that can only start *after* Phase 1 has been live long enough to gather feedback. These tasks are time-gated, not blocked by code dependencies alone — the gates for each phase are in the PRD's Rollout strategy section.

Not every task below fires automatically once a phase gate passes. Phase 2 is a single release; Phase 3 is the cleanup release that follows another cycle of real-world use on the default-on path.

## Execution notes

- **Phase 2 is the smaller release.** Flipping the default is mostly a setting change + banner copy + release notes. No new components.
- **Phase 3 is the larger, higher-risk release.** Deleting legacy code paths removes the safety net. Sequence carefully; lots of tests to update.
- **Before Phase 2 gate check:** review usage signals, GitHub issues, and internal feedback. If sentiment is mixed, *do not proceed* — iterate inside Phase 1 instead. Phase 2 is a one-way door for new installs.
- **Before Phase 3 gate check:** confirm < 5 % of active users are still on the legacy UI. Measure via in-memory setting-state check at app start for a single release window. No persistent telemetry.

## Risks and open questions

- **Users actively disliking the new UI and reverting in bulk.** If Phase 1 data shows ≥ 20 % of preview-users flip back to legacy within 7 days, we stop and iterate. Gate the Phase 2 flip on sustained preview adoption.
- **Integration partners / third-party docs that reference legacy UI** (screenshots, tutorials, YouTube videos). Announce the legacy deletion at least one release cycle ahead.
- **Feedback quality is subjective** in a telemetry-avoidant product. The Phase 2 gate ("subjective sentiment net-positive") requires us to read GitHub issues thoughtfully and resist cherry-picking.
- **Rollback during Phase 2**: if serious regressions surface *after* default-on flips, users who never opted in might be worse off. Release note guidance: explicitly tell users how to return to legacy via Settings. Provide a prominent link in the release notes.

---

## Phase 2 — Default-on for new installs

### Entry gate (PRD section: Success criteria → Phase 2)

- Phase 1 has been live ≥ 4 weeks
- No P0/P1 issue reports from preview users outstanding for > 2 weeks
- Net-positive sentiment on GitHub issues / community channels
- Every surface rebuilt under the new UI is verified pixel-polished against `docs/design-system.md`

### #1 — Flip default to `quiet-composer` for new installs

| Field | Value |
| --- | --- |
| Description | Change settings-store default value for `uiPreview` from `"legacy"` to `"quiet-composer"`. Existing installs keep their current value (migration preserves it). New installs see Quiet Composer on first launch. Include upgrade-path test. |
| Complexity | S |
| Category | frontend |
| Depends on | Phase 1 ship |
| Files | `src/stores/settings-store.ts`, tests |

### #2 — Upgrade-release banner copy change

| Field | Value |
| --- | --- |
| Description | The preview invitation banner (Phase 1 task #97) still shown on legacy installs. Banner copy updates to: "The new UI is now our recommended default. [Try it] — or keep Classic." Two options, both tasteful. If dismissed, suppress for 30 days (unchanged). |
| Complexity | S |
| Category | frontend |
| Depends on | Phase 2 #1 |
| Files | `src/components/PreviewInvitation.tsx` |

### #3 — Promote Accent / UI-preview toggle placement

| Field | Value |
| --- | --- |
| Description | Move the `uiPreview` toggle out of Settings > Advanced and into a top-level entry in Settings > Appearance. Explicit label: "UI version — Quiet Composer (new) / Classic". Reduces feeling of "hidden preview" now that it's the default. |
| Complexity | S |
| Category | frontend |
| Depends on | Phase 2 #1 |
| Files | `src/components/settings/v2/AppearanceSettings.tsx`, `src/components/settings/v2/AdvancedSettings.tsx` |

### #4 — Release notes for Phase 2

| Field | Value |
| --- | --- |
| Description | Write release notes announcing the default flip. Call out: new installs start in Quiet Composer; existing installs unchanged (still in their chosen UI); one-click revert via Settings. Link to migration guide. |
| Complexity | M |
| Category | doc |
| Depends on | Phase 2 #1 |
| Files | `CHANGELOG.md`, release-notes post |

### #5 — Migration guide (public-facing)

| Field | Value |
| --- | --- |
| Description | A short how-to page covering: what changed visually, where each control moved to, common "wait, where did X go?" answers (tabs → Pinned + ⌘K; chat panel → composer; activity rail → orb). Links from the release notes. Aim for single scroll, lots of screenshots. |
| Complexity | M |
| Category | doc |
| Depends on | Phase 2 #4 |
| Files | `docs/guides/quiet-composer-migration.md` or external blog |

### #6 — Monitor feedback, iterate inside Phase 2

| Field | Value |
| --- | --- |
| Description | Ongoing task spanning 12 weeks of Phase 2. Read GitHub issues, note patterns, fix the ≤ P1 findings in point releases. Collect a short "what do users miss most?" list to inform Phase 3 deletion sequencing. |
| Complexity | L |
| Category | ongoing |
| Depends on | Phase 2 #1 |
| Files | issue tracker, internal notes |

---

## Phase 3 — Legacy removal

### Entry gate (PRD section: Success criteria → Phase 3)

- Phase 2 has been live ≥ 12 weeks
- < 5 % of active users still on legacy UI (in-memory sampled, single release window)
- One-release-cycle notice given in a prior release ("Classic UI will be removed in v0.X — you can keep it until then via Settings")
- Codebase delta reviewed and considered safe to merge

### #7 — Announcement release: legacy deprecation notice

| Field | Value |
| --- | --- |
| Description | One release before the actual deletion, publish a prominent notice in release notes and in the app's release announcement. Tell users: "Classic UI will be removed in v0.X+1. Switch to Quiet Composer before then to avoid disruption." Include reversion instructions if they want to try before the cutoff. |
| Complexity | S |
| Category | doc |
| Depends on | Phase 2 gate passed |
| Files | `CHANGELOG.md` of prior release |

### #8 — Delete `TabBar`, `Tab` components

| Field | Value |
| --- | --- |
| Description | Remove `src/components/tabs/*` entirely. Update `Layout.tsx` to remove tab-bar row. Delete all tab-related tests that referenced these components. |
| Complexity | S |
| Category | frontend |
| Depends on | Phase 3 gate |
| Files | `src/components/tabs/`, `src/components/Layout.tsx`, tests |

### #9 — Delete `ChatPanel`

| Field | Value |
| --- | --- |
| Description | Remove `src/components/chat/ChatPanel.tsx`. Remove its column from `Layout.tsx`. Any state or hook exclusively used by ChatPanel also removed. Chat-store unchanged. |
| Complexity | M |
| Category | frontend |
| Depends on | Phase 3 gate |
| Files | `src/components/chat/ChatPanel.tsx`, `src/components/Layout.tsx`, tests |

### #10 — Delete `ActivityStrip` + activity panel

| Field | Value |
| --- | --- |
| Description | Remove `src/components/activity/ActivityStrip.tsx` and its companion panel component. activity-store stays (feeds orb). Update Layout to remove the activity column. |
| Complexity | S |
| Category | frontend |
| Depends on | Phase 3 gate |
| Files | `src/components/activity/ActivityStrip.tsx`, Layout, tests |

### #11 — Delete `CommandPalette`

| Field | Value |
| --- | --- |
| Description | Remove `src/components/CommandPalette.tsx`. All its functionality is absorbed into the floating command bar's `>` and other prefix modes. Keyboard shortcuts hook cleanup. |
| Complexity | S |
| Category | frontend |
| Depends on | Phase 3 gate |
| Files | `src/components/CommandPalette.tsx`, `src/hooks/useKeyboardShortcuts.ts`, tests |

### #12 — Delete `ChatFooter`

| Field | Value |
| --- | --- |
| Description | Remove `src/components/chat/ChatFooter.tsx`. Multi-select, provider, mode selectors all live in the composer's context row. |
| Complexity | S |
| Category | frontend |
| Depends on | Phase 3 gate |
| Files | `src/components/chat/ChatFooter.tsx`, tests |

### #13 — Delete `NewNoteDialog`, `NewProjectDialog`

| Field | Value |
| --- | --- |
| Description | Remove the dialog components that have been preview-gated since Phase 1. Inline create (sidebar) is the only path. |
| Complexity | S |
| Category | frontend |
| Depends on | Phase 3 gate |
| Files | `src/components/NewNoteDialog.tsx`, `src/components/NewProjectDialog.tsx`, tests |

### #14 — Remove `uiPreview` flag + all branching

| Field | Value |
| --- | --- |
| Description | Delete `uiPreview` from settings-store. Remove every `if (uiPreview === "legacy")` branch in the codebase. Simplify `Layout` to a single render tree (the Quiet Composer version). Migration cleanup: if persisted state still has `uiPreview`, strip it during the next store migration. |
| Complexity | M |
| Category | frontend |
| Depends on | Phase 3 tasks #8–#13 |
| Files | `src/stores/settings-store.ts`, `src/components/Layout.tsx`, many call sites |

### #15 — Update all tests that referenced legacy paths

| Field | Value |
| --- | --- |
| Description | Many unit and E2E tests have both legacy and quiet-composer assertions. Remove the legacy-path assertions. Simplify mocks. Ensure `pnpm test`, `pnpm test:e2e`, and `pnpm test:e2e-real` all pass after deletion. |
| Complexity | L |
| Category | test |
| Depends on | Phase 3 #14 |
| Files | `src/**/__tests__/*`, `e2e/`, `e2e-real/` |

### #16 — Clean "preview" language from docs + update architecture

| Field | Value |
| --- | --- |
| Description | Scrub docs of "preview", "classic", "legacy" references. The Quiet Composer is now just "the UI". Update `docs/architecture.md`, `docs/product-description.md`, feature docs. Release notes for Phase 3 announce the cleanup. |
| Complexity | M |
| Category | doc |
| Depends on | Phase 3 #14, #15 |
| Files | `docs/architecture.md`, `docs/product-description.md`, feature docs, `CHANGELOG.md` |

---

## Final gate — close the PRD

After Phase 3 ships:

- [ ] Update PRD header: `Status` → `Shipped in vX.Y.Z`
- [ ] Update product-description.md roadmap: mark "UI Refresh — The Quiet Composer" as shipped
- [ ] Archive mockups: `docs/design/ui-exploration/` → `docs/design/shipped/2026-quiet-composer/` (optional, for cleanliness)
- [ ] Close this task file: `Status` → `Complete`
- [ ] Write a retrospective note in `docs/history/` — lessons learned from a three-phase UI refresh, useful for the next major redesign
