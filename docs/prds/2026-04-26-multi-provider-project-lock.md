# PRD: Multi-Provider Project Lock

|  |  |
| --- | --- |
| **Date** | 2026-04-26 |
| **Status** | Draft |
| **Priority** | Medium — extends a shipped guarantee, no new attack surface |
| **Impact** | Per-project AI lock becomes practical for the realistic case where a workload has more than one approved provider (e.g., "two work providers + local AI"). Today's single-provider lock either over-restricts or pushes the user to leave the project unlocked. |
| **Parent PRD** | [2026-04-18-project-data-isolation](2026-04-18-project-data-isolation.md) (introduced single-provider `aiLock`) |
| **Tasks** | TBD — task breakdown to live at `docs/tasks/2026-04-26-multi-provider-project-lock-tasks.md` once written |

## Problem

The per-project AI Provider Lock landed in the project-data-isolation PRD as a single-connection guarantee: a project can be locked to exactly one connection, and every send path refuses to route to any other connection. That model is correct for the single-provider case but breaks down the moment the user's policy has more than one approved provider.

The motivating user quote, paraphrased from a 2026-04-26 conversation:

> "At work I have two providers that are OK to use, and local AI is always fine. Today I either lock the project to one of them and lose the others, or I leave it unlocked and lose the guarantee entirely."

This is not a hypothetical. It maps directly to common enterprise policy:

- Two contracted-and-vetted commercial providers approved by IT/legal (e.g., OpenAI Codex via the company's enterprise tenant, Claude Code via the company's Anthropic agreement).
- A local-only fallback that never leaves the machine, generally treated as always-acceptable for any project.

The current single-id lock forces a false trichotomy:

1. Lock to provider A → provider B is refused even though policy permits it.
2. Lock to provider B → mirror of (1).
3. Don't lock → the policy isn't enforced at all and the user has to remember it manually for every send.

The lock is also a *project* property today. Two projects with overlapping but non-identical allowed sets cannot be merged into the same chat scope — the chat-footer multi-select refuses any pair where the two single-id locks differ. Real workflows where a user routinely cross-references two locked projects under their shared approved provider are blocked.

The fix is to extend the lock from "this connection" to "any one of these connections," keeping every other invariant (hard enforcement at every send path, scope-aware UI, opt-out only via Settings) intact.

## Goals

1. **A project can declare a non-empty list of allowed connections.** Sending to any one of them is permitted; sending to anything else is refused with the same `ProjectLockViolation` semantics shipped in the parent PRD.
2. **Multi-project chat scopes resolve cleanly when the allowed sets overlap.** Two projects with allowed sets `A` and `B` can be merged into the same chat iff `A ∩ B` is non-empty. The active provider must be in the intersection.
3. **Backward compatibility.** Every existing single-id lock keeps working without user action. Existing UI copy and code paths that assume "the locked provider" continue to make sense when the allowed set has exactly one entry.
4. **No regression in defense in depth.** The kernel-level sandbox, path-filter, approvals, and provider-routing enforcement points all see the same allowed set. No layer silently rubber-stamps something another rejects.
5. **The user can see and audit the allowed set.** The Settings > Project lock panel, the chat footer's "explain lock" affordance, and the sidebar lock badge all surface the full list of approved connections, not just one.
6. **The single-provider case stays simple.** A user who only ever wants one approved provider sees identical UI to today (a one-element list looks indistinguishable from the v1 single-id lock).

## Non-Goals

- **Capability-based locks** (e.g., "any local-bundled connection," "any provider with `interactive` capability"). Possibly worthwhile in the future; out of scope for v1. See Open Questions.
- **Implicit "local AI is always allowed" rule.** Considered and rejected for v1 — see Open Questions for the tradeoff. The user can include their local connection in the explicit allowed list if they want it.
- **Rewriting the parent PRD's enforcement points.** Every send path that today calls `findLockConflict` / `getProjectLock` continues to do so. Only the lookup semantics change.
- **Lock inheritance / org-wide policy.** Each project carries its own list. A future org-policy file could populate these defaults — not in this PRD.
- **Lock-affecting UX changes outside the lock surface.** This PRD does not touch the wider chat-footer redesign, the cross-project mode toggle, or the scope preview panel; those are owned by the data-isolation and ui-refresh PRDs.
- **Provider locks on conversations or messages.** The lock is a project-level property, same as today. Per-conversation overrides remain out of scope.

## User Stories

1. **As a user with the work setup quoted above**, I open Settings > Project for my work folder and tick "OpenAI Codex (work)," "Claude Code (work)," and "Local-bundled." I save. From now on the chat footer for this project lets me pick freely among those three; trying to switch to my personal Anthropic key shows the same lock-violation toast that today's single-id lock does.

2. **As a user who only has one approved provider**, I open the lock dialog and pick the one connection. The dialog looks and feels identical to today's flow — one selection, one save. The fact that internally it's a one-element list is invisible to me.

3. **As a user merging two locked projects in one chat scope** (e.g., "research-A is locked to {X, Y}", "research-B is locked to {Y, Z}"), the chat footer accepts the merge because `Y` is in both sets. The provider pill auto-pins to `Y` and disables switching to anything outside `{Y}` — the only connection in the intersection.

4. **As a user whose two locked projects have no overlap** ("project-A locked to {X}", "project-B locked to {Y}"), the chat footer refuses the second project with the same toast it shows today. The error wording is updated to clarify why ("…have no provider in common").

5. **As a user resending an old message** that was originally sent to a connection that has since been removed from the project's allowed list, I get the same provider-mismatch dialog the parent PRD shipped. "Resend with original" is now disabled because the original is no longer allowed.

6. **As a user reviewing locks across all my projects**, the Settings > Projects list shows each project's allowed providers as a chip group; the count is visible without opening the dialog. A project locked to three connections renders as three small provider chips in its row.

## Detailed Design

### Data model migration

`ProjectMetadata.aiLock` changes shape. Today:

```typescript
aiLock?: {
  connectionId: string;       // single id
  lockedAt: number;
  reason?: string;
};
```

After:

```typescript
aiLock?: {
  connectionIds: string[];    // one or more allowed connection ids; never empty when set
  lockedAt: number;
  reason?: string;
};
```

**Invariant.** When `aiLock` is present, `connectionIds.length >= 1`. An empty array is treated as "no lock" and equivalent to `aiLock` being absent — but the writer side (Settings dialog, store action) refuses to persist an empty array; clearing the lock removes the field entirely. This preserves the parent PRD's "lock is set or not set" two-state contract.

**One-time migration.** On store rehydration, any persisted `aiLock` carrying a `connectionId` (string) field is rewritten to `connectionIds: [connectionId]`. Migration is idempotent and silent — no toast, no settings flip required. Persisted `lockedAt` and `reason` are preserved unchanged. The migration touches only `~/.notesage/project-metadata-store` and the on-disk `.notesage/project.json` files; both formats follow the same data shape.

**On-disk file format.** Project metadata is also written to each project's `.notesage/project.json` for portability across devices. The migration runs the same transform on read; new files are written in the multi-id form. A device running an older Notesage build that reads a multi-id file shipped from a newer build will see `connectionId: undefined` and treat the project as unlocked — this is the safer of the two failure modes (over-restrict vs under-restrict, picking under-restrict only because the older build cannot enforce something it doesn't understand). A migration warning in release notes covers this.

### Lock-utility API changes

`src/lib/ai/project-lock.ts` is the single source of truth for lock lookups. Rewrite its surface:

| Function (today) | Function (after) | Semantics |
| --- | --- | --- |
| `getProjectLock(path, map): { connectionId } \| null` | `getProjectLock(path, map): { connectionIds: string[] } \| null` | Returns the array; null when unset. |
| `findLockConflict(paths, map, currentConnectionId): { projectPath, lockedConnectionId }` | `findLockConflict(paths, map, currentConnectionId): { projectPath, allowedConnectionIds: string[] }` | "Conflict" means current id is not in the project's allowed set. |
| `getUniqueLockedConnectionIds(paths, map): string[]` | `getAllowedConnectionIntersection(paths, map): string[]` (renamed; returns intersection of all locked projects' allowed sets — the connections valid for the whole scope) | Empty array when no lock; intersection (not union) when multiple locked projects are selected. |
| `hasLockedProject(paths, map): boolean` | unchanged | Still answers "is anything in scope locked at all?". |
| `describeLockTarget(id, label?)` | unchanged | Still formats one connection's display name. |
| _new_ | `describeLockTargets(connectionIds, lookupLabel): string` | Comma-separated, oxford-comma-aware. Used by toasts and the explain dialog. |

`ProjectLockViolation` carries `allowedConnectionIds: string[]` instead of `lockedConnectionId: string`. The thrown error's message is regenerated from the array; existing call sites that pass it to a toast keep working with no change beyond the new wording.

### Scope merge algorithm

When the chat footer merges multiple projects into the same chat scope, the rule is:

```
for each project P in scope:
  if P has no lock: it contributes "all connections" to its slot
  else: it contributes P.aiLock.connectionIds

allowedSet = intersection of all slots
if allowedSet is empty: refuse the merge (toast)
else if allowedSet has one element: pin the provider to that element, disable switching
else: allow the user to choose any element in allowedSet; disable everything else
```

This generalizes today's behavior: the v1 single-id case is the special case where every locked project contributes a singleton. The intersection of singletons is non-empty iff they're all identical, which is exactly today's "must all carry the same connectionId" rule.

**`handleAddProject` rewrite.** Both `CommandBarContext.tsx` (Quiet Composer) and `ChatFooter.tsx` (Classic Layout) currently reject any locked-project add whose connectionId differs from existing locked-project ids. The new check:

1. Compute the existing scope's intersection set `existingAllowed` from already-selected projects.
2. Compute the new project's contribution `newAllowed` (its `connectionIds`, or "all" if unlocked).
3. If `existingAllowed ∩ newAllowed` is empty, refuse and toast: *"These projects have no AI provider in common. Unlock or remove a project to merge them."*
4. Otherwise add the project. If the active connection is now outside the new intersection, switch the active connection to any element of the intersection (preferring the previously active one if still valid; fall back to the first element).

### Send-path enforcement

`assertLockAllowsSend` in `useAIOperations.ts` and the parallel check in `useAgentTaskOperations.ts` (comment delegation) keep their shape: scan selected projects, raise `ProjectLockViolation` when the active connection is rejected. The check changes from string equality to set membership:

```
for each selected project P:
  if P has no lock: continue
  if active connection id ∈ P.aiLock.connectionIds: continue
  raise ProjectLockViolation(P.path, P.aiLock.connectionIds, active connection id)
```

The thrown violation surfaces a toast that lists all approved providers, not just one:

> "Project Notesage-work" is locked to OpenAI Codex (work), Claude Code (work), or Local-bundled. Switch provider to one of these connections to send.

**Provider-mismatch dialogs.** `ResendProviderDialog` (resend / edit) checks `originalConnectionId ∈ allowedConnectionIds` to decide whether the "Resend with original" option is offered. If the original connection is no longer in the project's allowed set, that option is disabled with a tooltip explaining why; only "Resend with current" remains, gated on the current connection itself being allowed.

### UI changes

#### `LockProjectDialog` — multi-select

Today's single-select `<Select>` becomes a multi-select. Concretely:

- A list of all `interactive`-capable connections, each rendered as a checkbox row with provider logo + label.
- A summary line above: *"Approved providers (N selected)"* updates live.
- Save is disabled when zero are selected; the dialog refuses to commit an empty list.
- The "This lock is hard enforcement" disclaimer beneath the form remains, with copy updated to "Every send path will be refused unless it targets one of the selected providers."

The dialog's title and description copy pluralizes:

- Title: *"Lock project to providers"* (was: *"…to provider"*).
- Description: *"Only the selected providers will be allowed to access "{name}". All other AI providers will be refused…"*

When the user opens the dialog on a project that already has a lock, the existing list is pre-checked. Re-saving an unchanged list is a no-op (no `lockedAt` bump).

#### `ExplainLockDialog` — list all allowed providers

Today this dialog shows one connection per locked project. After:

- Each locked project still gets one card.
- Inside the card, instead of one provider chip, render *all* allowed connections as small chips in a horizontal row.
- Reason text remains as-is.
- Footer copy pluralizes ("Unlock from Project Settings > AI Provider Lock").

#### `ProviderPill` (chat footer / cmd-bar context row)

Today the pill is locked to exactly one connection when any selected project has a lock; clicking the lock icon opens the explain dialog.

After:

- When the scope's intersection set has exactly one element, behavior is unchanged: pill is pinned, picker disabled, lock icon opens explain.
- When the intersection has more than one element, the pill remains a normal picker — but its dropdown only shows connections in the intersection. A small lock badge on the pill (different visual from "fully locked") signals "filtered to allowed set." Hovering surfaces a tooltip *"Filtered to providers approved by Project A and Project B."*
- The explain dialog is still reachable; each card lists its allowed set.

The two visual states ("pinned to one" vs "filtered to many") need to be visually distinguishable but both clearly different from the unlocked state. Mockup references TBD; the simplest first cut is the same lock glyph in two opacities (pinned = full opacity; filtered = 60%).

#### Settings > Projects > Project card

Today's project card shows a pill labelled *"Locked · ConnectionLabel"* when a single-provider lock is set. After:

- One approved provider: identical to today (`Locked · Claude Code`).
- Two: `Locked · Claude Code, Codex` (truncate label if needed).
- Three or more: `Locked · 3 providers` with full list in the tooltip / on hover.

The pill's onClick still routes to the unlock-confirm dialog when the project is locked, and to the lock dialog when unlocked.

#### Sidebar lock badge

The padlock overlay on locked project rows in `ProjectItem` / `FileTreeItem` / `SidebarRowIndicators` is unchanged (still "is this locked at all?"). The tooltip is the only thing that changes — it now lists every approved provider, not just one.

### Edge cases

- **Connection deletion while referenced by a lock.** A connection id in `aiLock.connectionIds` may refer to a connection that has been removed from `connections-store` (user deleted it from Settings > Connections). The lock survives — the array entry is preserved as a "stale" id. Rendering surfaces show such ids with a muted *"(deleted connection)"* label and a tooltip suggesting the user re-add it or unlock. Send-path enforcement treats the stale id as not matching the current active connection (because no active connection ever has a deleted id), so it cannot be used to send. If *every* entry in the allowed set is stale, the lock effectively bricks the project until the user unlocks or restores a connection — the lock dialog surfaces this clearly with a *"This lock has no available connections"* warning at the top of the explain dialog.

- **Empty intersection at scope build time.** A user who *manually* edited `.notesage/project.json` to introduce two non-overlapping locked projects, then opened a chat with both selected, would land here. The chat footer treats this the same as a fresh `handleAddProject` rejection: surface the conflict toast and force the user to deselect one of the projects to proceed. The provider pill renders in a degraded "no valid provider" state with the lock icon and a tooltip explaining the conflict.

- **All allowed providers lack a required capability.** A user who locks a chat-message project to only ACP connections and then tries to use inline completion (which the ACP path doesn't serve) sees the existing capability-mismatch path — same as if the project had a single-id lock to an ACP connection today. Out of scope for this PRD; the parent isolation PRD owns the broader capability story.

- **Branching from a pre-lock-change message.** When a conversation predates a recent lock-list edit (e.g., user removed a provider from the allowed set yesterday), branching from an old assistant turn that originated on the now-removed provider follows the same rules as the parent PRD: `ChatMessage.connectionId` is checked against the *current* allowed set; mismatch raises the resend dialog with the legacy option disabled.

## Migration

Single migration step on store rehydration:

1. For every entry in `metadataMap`, if `aiLock` exists and has the legacy `connectionId: string` field, rewrite to `connectionIds: [connectionId]` and drop the legacy field.
2. Project files on disk migrate lazily — next save of an updated project rewrites the JSON.
3. `lockedAt` and `reason` carry through unchanged.

No toast, no setting flag, no UI prompt. The user sees no behavioral difference until they choose to add a second connection.

**Forward compatibility for older installs.** A device running pre-multi-lock Notesage that reads a project file written by a multi-lock device sees `connectionId: undefined`. The legacy code path treats `aiLock` as absent and the project is unlocked on that device. This is documented in the release notes alongside the "upgrade all devices" recommendation.

## Open Questions

### Q1. Should "local AI" be implicitly always-allowed?

The user mused that *"local AI is always fine"* in any project. Two ways to honor that:

| Option | Pro | Con |
| --- | --- | --- |
| **A — Implicit rule** (recommended *not* to ship) | One less checkbox in the lock dialog. Matches the user's stated mental model. | Hidden enforcement is exactly what the parent isolation PRD argued *against*. A user who reads the lock dialog should be able to predict every send path's behavior from the visible UI alone. An invisible "but local-bundled is always allowed" rule violates that. Also breaks down on the day a user has *multiple* local connections and only some are approved. |
| **B — Explicit list** (recommended) | Single, predictable rule: "the lock list is exactly what's allowed." User who wants local-always picks it explicitly. UI matches data shape 1:1. | The user has to tick a box. |

Recommendation: ship Option B. If post-launch feedback shows users routinely forget to add local-bundled to every project's allowed set, revisit by adding a *visible* "Always allow local providers" project-level toggle that auto-augments `connectionIds` at render-time without changing the persisted data shape — that converts the implicit rule into a *visible* rule, addressing the audit concern.

**Decision needed before implementation.** Default assumption in this PRD is Option B.

### Q2. Capability-based locks

A future iteration could let users lock to capability sets ("any local-bundled connection," "any agent-managed connection") instead of specific connection ids. This handles the connection-deletion edge case more gracefully (no stale ids) and matches how some users think about provider trust (by deployment model, not by individual contract).

Out of scope for v1. Mention here so the data-model migration in this PRD doesn't paint us into a corner: `connectionIds: string[]` is forward-compatible with adding a sibling `capabilities: string[]` field later, and the lookup function can union both at check time.

### Q3. Lock list ordering

Does ordering of `connectionIds` carry meaning (e.g., "preferred"), or is it a set? Recommended: it's a set, and rendering uses connection-store ordering for stability. Saving the dialog with a different order than persisted is a no-op. If in v2 we want a preferred connection (auto-select on first send), we add a separate `preferredConnectionId?: string` field rather than overloading array position.

### Q4. Capacity / limits

Should there be a maximum number of allowed connections per lock? Currently no — but the UI starts to look noisy past ~5. Recommended: no hard limit; rely on the natural ceiling of "how many connections does the user even have configured" (typically 2–4). The chat-footer pill truncates display to "Locked · 3 providers" past two entries.

### Q5. "Locked but bricked" UX threshold

When all entries in `connectionIds` reference deleted connections, the project becomes effectively unsendable. Today's single-id lock has the same issue but it's binary; with multi-id locks it's still binary (all-or-nothing) but easier to land in by accident as connections come and go. Recommended: surface a banner in Settings > Project for any locked project whose allowed-set is fully stale, with a one-click "Unlock" or "Edit allowed providers" affordance. The explain dialog gets the same banner.

### Q6. Migration toast — really silent?

The single-id → multi-id migration is mechanically zero-risk and zero-decision. Recommended: silent, no toast. The audit trail is the rewrite of `lockedAt` (which is *not* bumped — the original timestamp is preserved). If a future migration needs user input, it's a different beast; this one doesn't.

## Acceptance Criteria

Outcome-shaped per the project's `feedback_outcome_shaped_criteria` convention. Each criterion describes what a user observes; the implementation can wire it however.

1. **Single-provider behavior unchanged.** A user who locks a project to exactly one connection and never edits the list sees no UI, copy, or behavior difference from the v0.38.0 release. Existing tests covering the single-provider lock flows pass without modification beyond renames.

2. **Multi-provider lock can be created.** A user with three interactive-capable connections can open `LockProjectDialog`, tick all three, save, and see the project marked as locked. The chat footer for that project lets them switch freely among those three; switching to a fourth connection raises the same `ProjectLockViolation` toast that today's single-id lock does.

3. **Multi-project scope merges respect intersections.** A user with project-A locked to `{X, Y}` and project-B locked to `{Y, Z}` can add both to one chat scope. The provider pill's picker shows only `{Y}` — the intersection — and the active connection auto-pins to `Y` if it wasn't already.

4. **Disjoint multi-project scopes refuse the merge.** A user with project-A locked to `{X}` and project-B locked to `{Y}` cannot add both to the same chat scope. The toast explaining why mentions both projects and clarifies they have no provider in common.

5. **Stale ids are visible and inert.** A user who deletes a connection that's referenced by an active lock sees the lock surface (Settings > Project, explain dialog) call the entry out as "(deleted)". They can still send to other entries in the allowed set; sending to nothing if every entry is stale produces a clear "this lock has no available providers" state, not a silent send-then-fail.

6. **Existing locks migrate transparently.** A user who upgrades from a build with single-id locks to a build with multi-id locks observes no UI prompt, no toast, and no change in behavior on first launch. Their existing single-id locks continue to enforce identically. Adding a second connection to the lock then becomes a normal Settings > Project action.

7. **Provider-mismatch resend respects the allowed set.** A user resending an old assistant message that originated on a connection no longer in the project's allowed set sees the resend dialog with "Resend with original" disabled. "Resend with current" is offered if and only if the current connection is in the allowed set; otherwise both options are disabled and the dialog explains why.

8. **Comment delegation respects the allowed set.** A user delegating a comment in a multi-locked project routes the agent task to *some* connection in the allowed set — whichever the chat footer would currently pick — never to a connection outside the set. The activity panel shows which connection was used.

9. **Audit trail.** Every project's `aiLock.lockedAt` is preserved across the migration. No silent bumps. If the user *does* edit the allowed set, `lockedAt` is updated to the new edit time (this matches today's single-id "re-lock" behavior).

10. **Defense in depth.** The Seatbelt sandbox writable-paths set, the direct-API tool-executor scope, the Copilot LSP `workingDir`, and the inline-completion gate continue to honor the chat-footer's selected projects exactly as they do today. None of these layers needs to learn about `connectionIds` directly — the lock is a routing-time concept, not a sandboxing concept.

## Risks and Mitigations

- **Risk: a future PRD introduces a third lock dimension** (e.g., per-conversation lock, per-message lock, capability lock). Mitigation: the migration in this PRD is structurally additive, not destructive. `connectionIds: string[]` is forward-compatible with a sibling `capabilities: string[]`, `preferredConnectionId: string`, etc.

- **Risk: multi-device drift on iCloud-synced projects.** A device reading a multi-id `project.json` written by a newer device sees the lock as absent (forward-compat is one-way). Mitigation: documented in release notes as "upgrade all devices when adopting multi-provider locks." The under-restrict failure mode is the safer of the two, but users with high-trust workflows must be told.

- **Risk: UI noise as allowed-set sizes grow.** Five+ connections in the lock dialog and pill tooltip start to feel busy. Mitigation: dialog uses a scrollable checkbox list (not a flat radio), and the pill summary collapses to "Locked · N providers" past two entries.

- **Risk: hidden "local AI is always allowed" rule slips in by accident.** Mitigation: this PRD explicitly documents Option B (explicit list only) and an OQ to revisit if needed. Reviewers should refuse any code change that special-cases connection ids in the lock check.

- **Risk: tests for the v1 single-id lock are written against `connectionId: string` and break en masse.** Mitigation: the rename is mechanical (connectionId → connectionIds[0] for single-id assertions). Tests get updated alongside the type change in one commit; no behavior changes for the single-id case.

## Out of Scope

- Capability-based locks (Q2)
- Lock inheritance / org policy
- Per-conversation or per-message locks
- Auto-augmenting "always allow local" rule (Q1, Option A)
- Banner for the all-stale-ids state (covered by the existing "lock has no available connections" inline message; explicit banner is a polish follow-up)
- A migration toast, prompt, or settings flip on upgrade (deliberately silent — see Q6)

## Success Criteria

Acceptance criteria 1–10 above all pass. The user from the motivating quote can complete their stated workflow ("two work providers + local AI, all approved for this project") in under 30 seconds from a fresh project, without reading documentation, and the lock survives connection edits, app restarts, and chat-footer multi-select scenarios. No existing user with a single-id lock notices anything has changed.
