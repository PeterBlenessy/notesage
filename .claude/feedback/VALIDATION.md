# Validation against past AW failures

Phase 6 of the AW feedback integration plan (#336). Walks through real `aw-review` rejections that landed before the integration to test whether the loaded rules + Phase 3 structural reinforcements would have caught them. Treats each as a counterfactual: "if Phases 1-5 had been in place, would this PR have been opened?"

This file is a living record. Append a new section any time an AW PR is rejected by `aw-review`, closed by the operator with a "should have been caught" comment, or merged but reverted shortly after. If a failure category appears more than once, that's a signal that Phase 3 wording needs another pass.

## Method

For each case:

1. Identify the rejected PR + the originating issue.
2. Read the `aw-review` gap list (or operator close comment).
3. Map each gap to the rule(s) that should have prevented it.
4. Check whether the rule is in `.claude/feedback/` (Phase 1) AND in the relevant skill's `aw_applies_to` list (Phase 4).
5. Check whether the rule is structurally reinforced at the firing point in the skill (Phase 3).
6. Verdict: would Phases 1-5 have caught this? If not, what's missing?

## Case 1 — PR #91: missed parallel renderer in Quiet Composer shell

**Issue:** #87 — standardize selection checkmarks in chat-footer + settings pickers.
**Outcome:** PR closed by operator with comment: *"Superseded by #95. ... when I tried to live-test #91 against the actual failing surface, I discovered the Quiet Composer renders its pickers from `cmd/CommandBarContext.tsx`, not from `ChatFooter.tsx` — so #91's strokeWidth/size bumps were invisible to anyone on the new shell."*

**Failure mode:** `aw-tdd` fixed the files the issue body listed (`ChatFooter.tsx`, `connection-utils.tsx`, `ModelSelectionForm.tsx`) but missed `cmd/CommandBarContext.tsx`, the parallel renderer in the Quiet Composer shell. `aw-review` happily approved because every literal criterion passed. Operator caught it during live-test.

**Relevant rule:** `feedback_search_all_renderers` — "When a visual bug appears in a UI element, grep the whole codebase for every renderer of that element before assuming one file is 'the' implementation. Especially in apps with multiple layout shells."

**Counterfactual with Phases 1-5:**

- Step 0 (Phase 2) loads `feedback_search_all_renderers` in `aw-tdd`.
- Phase 3 addition to `aw-tdd` Pre-flight step 4 explicitly says: *"Before opening any single file, grep for parallel implementations. ... Projects often carry parallel implementations transiently — two layout shells during a migration, two settings dialogs while one is being deprecated. If the grep returns more than one renderer of the same concern, list every match in the PR body's Decisions made and either fix all of them or explicitly defer the others with a rationale."*
- `aw-review` Phase 3 "Outcome reread" subsection would have asked: *"if the operator opens this PR, do they get the experience they described?"* The answer for a user on Quiet Composer was no.

**Verdict:** ✅ Caught. Both `aw-tdd` (grep step) and `aw-review` (outcome reread) would have flagged this. `aw-tdd` would have either fixed `cmd/CommandBarContext.tsx` too or surfaced it in `Decisions made` for the operator to decide.

## Case 2 — PR #102: missing files in diff (sync-store + sidecar migration + Rust test)

**Issue:** #97 — sync open tabs and projects on external file/folder renames.
**Outcome:** `aw-review` found 3 `✗ Missing` gaps + multiple files listed in issue's "Files in scope" that weren't in the diff. PR closed; issue reset to `tdd + afk`.

**Failure mode:** The issue body explicitly listed `src/stores/sync-store.ts`, `.notesage/comments/path-{hash}.json` migration, and a Rust unit test for the `Modify(Name(Both))` branch as scope. The diff touched none of them. `aw-tdd` apparently picked the subset of acceptance criteria it could implement quickly and shipped, leaving the rest as implicit "follow-ups".

**Relevant rules:**

- `feedback_full_coverage` — "When implementing a feature, cover ALL touch points completely. Never leave known gaps as 'follow-ups' unless the user explicitly says so."
- `feedback_outcome_shaped_criteria` — "Verify the outcome before declaring done."

**Counterfactual with Phases 1-5:**

- Step 0 loads both rules in `aw-tdd`.
- Phase 3 addition to `aw-tdd` Hard Gates → gate 6 (Outcome check) explicitly says: *"List every behaviour the diff changes. Ask: if the operator opens this PR right now, do they get the outcome the issue described?"* For criterion 5 (iCloud-synced project rename), the answer is no — `sync-store.syncedProjects` is never touched.
- Phase 3 addition to `aw-tdd` Hard Gates → gate 7 (No unrelated changes, renumbered) implicitly inverts: every file the issue lists in scope SHOULD be touched (or deferred with rationale).
- `aw-review` Phase 3 per-comment enumeration would have caught the "Files in scope" → "diff" mismatch loudly.

**Verdict:** ✅ Caught at both `aw-tdd` (outcome check gate fails before PR opens) and `aw-review` (out-of-scope files modified inverse — in-scope files NOT modified — surfaced as ✗ Missing). `aw-tdd` would have either implemented the missing pieces, escalated via the tangled-issue circuit breaker (Phase 3 step 4.5), or flipped to `refine` with a comment explaining the gap.

**Edge case:** If the agent legitimately couldn't implement all of it in one pass (e.g., sidecar migration required understanding hashing infrastructure the agent didn't have context for), the tangled-issue circuit breaker would catch this and escalate to `hitl`. Either way: no PR with silent gaps.

## Case 3 — PR #109: literal pass, outcome miss (wrong code path)

**Issue:** #107 — suppress spurious 'renamed externally' toast on in-app renames.
**Outcome:** `aw-review` found that the `markSelfWrite` call from the frontend has no effect because the Rust watcher's `Modify(Name(Both))` branch (lines 163-193) uses `continue` to skip the `is_self_write` check that only applies at line 239 in the `file-changed-batch` path. Criterion "call markSelfWrite for both paths" passed literally; the actual outcome (no spurious toast) did not.

**Failure mode:** `aw-tdd` implemented the criterion exactly as written ("call markSelfWrite for both paths before in-app rename"). It satisfied the literal task. It did NOT verify the outcome (toast suppression) end-to-end. The criterion was wrong — the fix needed to be in the Rust watcher's rename-both branch, not in the frontend call site.

**Relevant rule:** `feedback_outcome_shaped_criteria` — *"When a task's acceptance criteria name a file, line, function, or hook to modify, treat that as a suggested implementation — not the goal. The goal is the user-observable outcome. Verify the outcome before declaring done, even when the literal criteria are satisfied."*

**Counterfactual with Phases 1-5:**

- Step 0 loads `feedback_outcome_shaped_criteria` in both `aw-tdd` and `aw-review`.
- `aw-tdd` Phase 3 hard gate 6 (Outcome check) says: *"if the operator opens this PR right now, do they get the outcome the issue described — not 'do the listed red tests pass', but 'does the user experience match'? If the criteria pass literally but the outcome misses, flip back to refine with a comment surfacing the mismatch."* For #109 the outcome is "no spurious toast on in-app rename" — running the actual scenario would show the toast still fires.
- `aw-review` Phase 3 "Outcome reread" subsection reads the issue body's first paragraph and asks the same question. Would catch the mismatch and mark ✗ Outcome miss.

**Verdict:** ✅ Caught. Both surfaces (`aw-tdd` gate 6 + `aw-review` outcome reread) explicitly target this exact failure shape. `aw-tdd` would have flipped back to `refine` with a comment naming the wrong code path, OR posted the tangled-issue circuit breaker if the operator's criterion was structurally incompatible with the actual fix.

**Caveat:** This depends on `aw-tdd` ACTUALLY RUNNING the scenario (or a test that proxies for it) rather than just running unit tests on the implementation. The Phase 3 wording says "list every behaviour the diff changes" — for a watcher event flow, that includes "the toast logic" even when the diff doesn't touch the toast file. If the agent treats the gate as paperwork rather than running it, the gate fails. The wording could be sharpened to require the gate to be run, not just read.

## Summary

| Case | Failure mode | Caught by Phase 1-5? | Surface |
|---|---|---|---|
| #91 | Missed parallel renderer | ✅ Yes | `aw-tdd` grep step (Phase 3) + `aw-review` outcome reread (Phase 3) |
| #102 | Missing files / silent partial scope | ✅ Yes | `aw-tdd` outcome-check gate (Phase 3) + tangled-issue circuit breaker (Phase 3) |
| #109 | Literal pass, outcome miss | ✅ Yes (with caveat) | `aw-tdd` outcome-check gate + `aw-review` outcome reread |

**3/3 caught — none silent.** The Phase 3 additions targeting these failure modes ARE the right ones; the surface area is covered.

**One refinement identified:** Case 3's caveat. The Phase 3 wording for `aw-tdd` gate 6 (Outcome check) could be sharpened to explicitly require RUNNING the scenario, not just reading the issue and asking the question. If the gate degenerates into agent-reads-paragraph-shrugs-passes, it stops catching this category. Concrete patch:

> Current: *"List every behaviour the diff changes. Ask: if the operator opens this PR right now, do they get the outcome the issue described?"*
>
> Proposed: *"List every behaviour the diff changes. For each, identify the user-observable scenario it should affect and either (a) run a test that exercises that scenario end-to-end and confirms the outcome, or (b) describe in the PR body's Decisions made why no scenario can be run automatically and what manual verification was performed. Asking the question is not the same as running it — agent reading the issue and shrugging passes the gate. Running the scenario does."*

Defer this patch to a follow-up commit; the wording change is small but worth a separate review.

## What this doesn't validate

- Rules whose primary surface isn't a recent rejected PR (e.g., `feedback_release_notes_match_shipped`, `feedback_promote_alpha_from_alpha_not_main`). Those apply to release workflows that AW doesn't touch today.
- Whether the agent actually FOLLOWS Step 0 reliably. The corpus is loaded; whether each agent reads it under context pressure is an empirical question Phases 1-5 don't directly test. Watch for new failures and add cases here when they happen.
- Cross-skill interactions (e.g., `aw-slice` deciding a sliced issue is too small for `aw-tdd`'s tangled-issue circuit breaker). Need real cases.

## Adding a new case

Append a new `## Case N — PR #X: ...` section using the structure above. If the case maps to an existing rule, cite it. If the case maps to a rule that doesn't exist yet, that's a feedback gap — open a new `feedback_*.md` via the `save-feedback` skill and link it here.
