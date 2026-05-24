# AW Design Choices and Rationale

The current shape of AW is the result of several pivots. This document captures *why* — read it when adding a new skill, debugging unusual workflow behavior, or questioning an architectural decision. For the operational reference (pipeline, labels, skills, how to run things), see [agentic-workflow.md](agentic-workflow.md).

### Choice: `aw-` prefix (not `wf-`, not `awf-`)

We started with `wf-` (workflow) and renamed to `aw-` (agentic workflow). `aw-` ties the namespace to the literature term and groups dev-process skills visually away from regular Claude Code audit/review/test skills. A glance at the skill list tells you "this skill is part of the AW pipeline."

### Choice: action labels + state markers (not single-state labels)

A naive design uses one label per state. We chose two coexisting categories: action labels (mutually exclusive — what's needed next) and state markers (accumulate — what's already happened). State markers let you query history (`gh issue list --label refined`) even after issues move forward. Action labels keep the immediate "what to do now" obvious. Cost: more labels. Worth it for the queryability.

### Choice: one PR = one shippable user value (not "one PR per layer")

**The pivot.** Originally aw-slice defaulted to slicing every refined issue into 3–6 sub-issues, each delivering one horizontal layer (settings store field, then CSS variable, then drag handle, then clamp logic, then docs). The failure mode was obvious: PR spam, no shippable features. Each PR was one layer; the user only got working software after 4–5 PRs stacked. PR #78 documented CSS variables that didn't exist yet because the implementation PRs hadn't merged.

**The new rule:** *one PR = one shippable unit of user value.* aw-slice asks "what can a user DO after this PR merges?" Each answer is a value. If 1 → don't slice (the common case). If N → split into peer issues.

**Test for groupings:** *if I stop here, has the user gained something concrete?* Yes → ship. No → bundle with the value it enables.

**Why this works for feature flags.** A PR that delivers one complete user value is the natural unit for a flag: gate the merge with `if (flag.featureName)`, ramp to opt-in users, evaluate, expand or roll back. A horizontal-layer PR can't be flag-gated meaningfully — the flag would point at machinery the user can't see.

### Choice: peer issues, not sub-issues, on multi-value split

Originally aw-slice created GitHub sub-issues (parent/child via the `addSubIssue` GraphQL mutation). After adopting the value-based rule, sub-issues became unused: 1-value (default) doesn't slice at all; N-value splits work better as peer issues that each independently ship.

When aw-slice splits an issue into N values, the original issue becomes the FIRST slice (body rewritten in place — keeps history, comments, the original number). N-1 new peer issues are created with `Split from #<original>` reference. No GraphQL parent/child link.

Consequence: dropped the `feature` (parent marker) and `sliced` (parent terminal state) labels. Without parent/child, both are redundant.

### Choice: research is a peer issue, not a separate skill

Originally we planned a `feature-research` skill. We collapsed it into aw-slice's research path: when under-specified, aw-slice creates ONE peer issue titled `Research: <question>` and marks the original `awaiting-research`. Human (or aw-tdd if `afk`) does the research, posts findings, closes the research issue. Human flips the original back to `slice` to re-trigger.

Fewer skills to maintain. Research becomes a regular peer issue, indistinguishable from any other in the queue.

### Choice: pipeline workflow + standalone backstops (not pure event-chain)

The naive design has each workflow event-trigger the next: aw-triage's label add fires aw-refine via `issues.labeled`, etc. Problems: \~30s runner spin-up per stage = \~120s wasted setup; each event is a separate billable runner minute; sequential events introduce latency; concurrency cancellations when triggers race.

We chose a hybrid: pipeline workflow for the happy path (one trigger, jobs chained via `needs:`); standalone workflows as `workflow_dispatch`-only manual entry points (used by `aw-feedback` to redirect after a label flip); the sweep workflow as the cron + label-edit backstop that picks up anything the pipeline missed. Pipeline pays the runner spin-up once per stage but stages run back-to-back. The sweep handles all label-edit auto-pickup via prechecks (so we don't need `issues.labeled` triggers on each standalone).

### Choice: one cron sweep workflow (not four parallel cron-triggered standalones)

**The pivot.** Originally each standalone (`aw-triage`, `aw-refine`, `aw-slice`, `aw-tdd`) carried its own `schedule: */15` trigger. Every cron tick fired four separate workflow runs that each ran a precheck against the issue queue and exited silently if there was no work. Cost per idle tick: 4 Actions tiles, \~3-4 minutes total runner time (the `aw-tdd` one paid the full `pnpm install` cost just to find no candidate).

**The fix.** A single `aw-sweep.yml` runs on cron with eight parallel jobs — four `find_<stage>` precheck jobs (just `gh + jq`, no checkout) and four `<stage>` skill jobs gated on `needs.find_<stage>.outputs.candidate != ''`. The find/skill split is required so each skill job's `aw-stage-{stage}-{candidate}` concurrency group can reference the candidate at job-evaluation time (GitHub evaluates `concurrency:` using `needs.*` outputs only — `steps.*` outputs from the same job aren't visible at that point). Idle ticks finish in \~20s with no checkouts.

**Why not chain through the pipeline workflow.** `aw-pipeline.yml` chains via `needs:` because each stage operates on the SAME issue (the one that fired `issues.opened`). On cron there is no specific issue — each stage independently sweeps for its own queue (untriaged issues, refine-labeled, slice-labeled, tdd-ready). Different issues at different stages. The eight parallel jobs in the sweep workflow share nothing beyond the workflow run id, which is exactly what we want.

**What standalones still exist for.** The four standalones lost their `schedule:` triggers and are now `workflow_dispatch`-only manual entry points (used by `aw-feedback` after a label flip — see the explicit-dispatch entry below). The auto-pickup on label edits moved INTO `aw-sweep.yml` via its `issues: types: [labeled, unlabeled]` trigger plus its prechecks: instead of four standalones each carrying their own `issues.labeled` trigger (which produced four skipped tiles per label edit), the sweep fires once on each label edit and only the matching stage's precheck finds a candidate. Net: one Actions tile per label edit instead of four.

### Choice: shared `aw-stage-{stage}-{issue}` concurrency group across all entry points (#98)

**The pivot.** Originally each workflow file keyed its `concurrency:` group on its OWN workflow name — `aw-pipeline-{issue}`, `aw-slice-{issue}`, `aw-sweep-{run_id}`, `aw-tdd-{issue}`. Concurrency groups only block runs WITHIN the same workflow file, so a pipeline-run and a sweep-run both doing slice work on the same issue landed in different groups and ran in parallel. Two real incidents traced to this gap: PRs #92/#93 from issue #88 (parallel `aw-tdd` runs on the same issue produced two duplicate PRs), and the duplicate slice comments on issue #97 (parallel `aw-slice` runs from pipeline + sweep both posted near-identical slice decisions 17 seconds apart).

**The fix.** Every stage workflow uses a single shared concurrency-group key pattern: `aw-stage-{stage}-{issue_or_run_id}`. Pipeline puts the group at the JOB level (workflow-level wouldn't apply per-stage, since the pipeline runs all four stages serially). Sweep splits each stage into a `find_<stage>` precheck job whose output is the candidate issue number, then a `<stage>` skill job that uses `needs.find_<stage>.outputs.candidate` in its concurrency expression. Standalones use the group at the workflow level since they're single-stage workflows. All groups use `cancel-in-progress: false` (queue, do not kill in-flight work).

**Why the find/skill split in the sweep.** GitHub evaluates the `concurrency:` expression at JOB level using `needs.*` outputs only — `steps.*.outputs.*` from the same job is NOT available at concurrency-evaluation time. So the candidate has to come from a UPSTREAM job, not from a step in the same job. Splitting each stage into find + skill jobs makes the candidate available via `needs.find_<stage>.outputs.candidate` for the skill job's group expression.

**Regression lock.** `src/lib/__tests__/aw-workflow-concurrency.test.ts` parses every aw-\*.yml file and asserts the convention (correct prefix per stage, presence/absence of workflow- vs job-level groups, find/skill split in the sweep, `cancel-in-progress: false` everywhere). Catches drift at PR-review time instead of production-incident time.

### Choice: GITHUB_TOKEN for surgical event triggers (not GitHub App token)

**The pivot.** Originally `claude-code-action` defaulted to its built-in GitHub App identity (`claude[bot]`) for every GitHub API call the agent made — label changes, comments, PR creation. Each label change therefore appeared as a real `issues.labeled` event and re-fired every workflow listening on that trigger. The standalones (`aw-refine`, `aw-slice`, `aw-tdd`, `aw-feedback`) all carried `if:` actor-guards and skipped immediately, but GitHub still creates a run record before evaluating the guard. Result: dozens of grey "skipped" tiles per pipeline run, polluting the Actions audit trail.

**The mechanism.** GitHub has a built-in anti-recursion guard: events caused by `GITHUB_TOKEN` do NOT create new workflow runs (except `workflow_dispatch` and `repository_dispatch`). GitHub App installation tokens are NOT subject to this guard.

**The fix.** Pass `github_token: ${{ secrets.GITHUB_TOKEN }}` to every label-and-comment-only `claude-code-action` step (triage / refine / slice / feedback / review and the non-tdd jobs in pipeline/sweep). The agent's `Bash(gh:*)` calls then run as `github-actions[bot]`, label changes don't fire downstream events, and the Actions tab becomes an honest log: every visible run represents work the system intended to do.

**Caveat — PR-creating workflows use** `WORKFLOW_PAT` **instead.** This recursion-guard suppression is correct for label/comment edits but breaks CI on bot PRs (the same suppression hides the `pull_request: opened` event from `test.yml`). Workflows that create PRs (aw-tdd / aw-iterate / aw-retrospect / pipeline-tdd / sweep-tdd) use `WORKFLOW_PAT` so their PRs DO fire CI. See *Choice: WORKFLOW_PAT for bot-PR CI gating* below.

**Knock-on changes.** Bot identity flips from `claude[bot]` to `github-actions[bot]`:

- `allowed_bots: "github-actions[bot]"` in every downstream workflow (still required because bot-chained pipeline runs need the action to allow bot-initiated invocation).
- `if: github.actor != 'github-actions[bot]'` ~~actor-guards on the standalones~~ — no longer needed: the standalones lost their `issues.labeled` trigger entirely (sweep handles label-edit auto-pickup now). Historical note kept for context.
- `aw-feedback` and `aw-retrospect` accept BOTH `github-actions[bot]` (current) and `claude[bot]` / `app/claude` (legacy PRs from before the switch) as bot-authored.
- `aw-iterate` configures git as `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>` so commits author cleanly.
- `claude-code-action`'s `use_sticky_comment` feature stops working with custom token. We don't use it.

**What we keep.** OAuth still authenticates the LLM call via `claude_code_oauth_token` — that's separate from the GitHub API token. We still get subscription quota, not pay-per-token.

**Side effect — explicit dispatch from** `aw-feedback`**.** A consequence of the recursion guard is that when one of our workflows flips a label on the human's behalf (`aw-feedback` resetting `hitl → afk`, `→ refine`, `→ slice`, etc.), the corresponding standalone does NOT auto-fire from the `issues.labeled` event. Without intervention, the next sweep cron tick (\~15 min later) would eventually pick it up, breaking the conversational tightness the feedback loop is built for. Fix: every label-flip action in `aw-feedback`'s skill is followed by an explicit `gh workflow run <next>.yml --field issue_number=N`. `workflow_dispatch` events ARE exempt from the recursion guard (along with `repository_dispatch`), so the dispatched workflow fires immediately.

### Choice: WORKFLOW_PAT for bot-PR CI gating (#118)

**The problem.** The GITHUB_TOKEN choice above is correct for label/comment edits — recursion guard suppression keeps the Actions tab honest. But it has a downside the original choice didn't address: **PRs created by** `gh pr create` **via** `GITHUB_TOKEN` **also don't fire** `pull_request` **events.** That means `test.yml` (which listens on `pull_request: opened/synchronize/reopened`) never runs on bot-authored PRs. We were merging bot PRs based only on the agent's local-runner test pass, with zero CI verification — the agent's container can't even compile some platform-specific code (`glib-2.0` for the Rust backend on Linux), so Rust regressions silently slipped through. Plus a separate gap: `GITHUB_TOKEN` lacks the `workflows:write` scope, so bot PRs that need to touch `.github/workflows/` couldn't be pushed at all (cost a manual-rerun on PR #105 yesterday).

**The fix.** A fine-grained Personal Access Token (`WORKFLOW_PAT`) scoped to this repo only, with `Contents:R&W + Pull requests:R&W + Workflows:R&W + Issues:R&W + Actions:R + Metadata:R`. Used by every workflow that creates PRs or pushes commits to PR branches:

- `aw-tdd.yml` (standalone), `aw-pipeline.yml` `tdd:` job, `aw-sweep.yml` `tdd:` job — open the implementation PR
- `aw-iterate.yml` — pushes follow-up commits, needs `pull_request: synchronize` to fire CI
- `aw-retrospect.yml` — opens skill-patch PRs, same CI gating need

The other workflows (`aw-triage`, `aw-refine`, `aw-slice`, `aw-feedback`, `aw-review`, and the non-tdd jobs in pipeline/sweep) keep `GITHUB_TOKEN` because they only flip labels and post comments — operations that benefit from recursion-guard suppression and don't need CI re-firing.

**Side effects.**

- Bot identity for PR-creating runs becomes the PAT owner (the human who minted the token), not `github-actions[bot]`. The `allowed_bots: "github-actions[bot]"` filter still works because `claude-code-action`'s internal git operations are still bot-attributed.
- `aw-tdd`'s SKILL.md "PR creation blocked" fallback paragraph (for the case where the repo setting "Allow GitHub Actions to create and approve pull requests" is off) is now unreachable — the PAT has the rights regardless of that repo setting. The fallback was removed when this choice landed.
- `aw-tdd`'s SKILL.md step "Dispatch `aw-review` on the new PR" was also marked optional — the PR's `pull_request: opened` event now fires automatically (the recursion guard does NOT suppress PAT-initiated events), so `aw-review.yml` triggers on its own. The explicit dispatch is kept as a defence-in-depth safety net.
- The repo-level "Allow GitHub Actions to create and approve pull requests" setting can be turned OFF (one less attack surface) — PR creation no longer routes through the `github-actions[bot]` identity.

**Token rotation cadence.** Fine-grained PATs expire at most every 365 days but typically configured for 90 days. Calendar reminder for the human owner of the token to regenerate before expiry; secret value updates without any workflow file changes.

**Why not GitHub App.** Strictly more secure but significantly more setup (app creation, private key management, install on repo, `actions/create-github-app-token` in every workflow). Overkill for solo-dev / one repo today; revisit if multi-repo expansion happens later.

**Why not** `pull_request_target`**.** Would solve the CI gap by running tests in the base-branch context with secrets available, but [GitHub Security Lab guidance](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/) treats this pattern as dangerous because it exposes secrets to potentially-untrusted PR code. Bot PRs are trusted today, but the precedent leaks to any future contributor PRs.

**Regression lock.** `src/lib/__tests__/aw-workflow-pat.test.ts` parses every `aw-*.yml` and asserts the PAT/GITHUB_TOKEN choice per workflow — catches drift if a future edit accidentally swaps the token in the wrong direction.

### Choice: author-association gate for external issues

**The risk.** This is a public repo with `issues.opened` triggers wired into a bot pipeline that opens PRs and (post-#118) can modify `.github/workflows/*.yml` via the `WORKFLOW_PAT`. A crafted issue from a random external account could ride the pipeline through triage → refine → slice → tdd, producing a malicious draft PR that touches workflow files. Even if the user catches it before merging, they've burned LLM tokens and the system has briefly trusted untrusted input. Spam issues are a smaller version of the same threat (token cost without the malicious payload).

**The fix.** Two-layer gate:

1. **Pipeline-level** `if:` **on the triage job** in `aw-pipeline.yml`. Cascades to all downstream stages via `needs:`. Lets through:

   - `OWNER` author-association (the repo owner)
   - `COLLABORATOR` (anyone with push access)
   - `MEMBER` (org members — n/a for personal repo, kept for portability)
   - OR any issue with the `aw-approved` label (manual owner opt-in)

2. **Sweep precheck filters** in each `find_<stage>` job. The JQ expression now requires `NOT external OR aw-approved`. External-but-not-approved issues never become candidates, even after the next cron tick or label edit.

3. **Auto-labelling helper** (`aw-mark-external.yml`). Tiny no-LLM workflow that fires on `issues.opened` for non-trusted authors and adds the `external` label + a comment explaining the gate. Cost: \~3s of runner time per external issue, zero LLM tokens.

**Owner workflow for an external issue:**

1. External issue arrives → `aw-mark-external` labels it `external` and posts a comment
2. Owner reviews the body — for spam / malicious / off-topic, just close it
3. For legitimate requests, owner adds `aw-approved` label (`gh issue edit N --add-label aw-approved`)
4. Next sweep tick (\~15 min) picks it up and runs the normal pipeline. The pipeline workflow itself doesn't re-fire (the `issues.opened` event is one-shot), but the sweep cron is the always-on safety net.

**Trusted-author flow is unchanged.** Owner-filed issues skip the gate entirely — `author_association == 'OWNER'` matches the pipeline `if:` clause and the sweep precheck (no `external` label means the precheck condition `NOT external OR aw-approved` is true).

**Why not GitHub branch-protection rules.** Branch protection gates merge, not workflow execution. By the time the bot PR exists, LLM tokens have been spent and the issue's intent has been "trusted" by the agent. The author-association gate stops that earlier.

**Why not just rely on aw-slice's hitl-vs-afk heuristic.** That decision is LLM-judged, not author-judged. A persuasive external issue could pass aw-slice as `afk` ("looks localized and well-tested") and reach aw-tdd before any human review. Author-based gating is structurally more reliable than content-based.

**Operational implication for the queue.** External issues sit in your queue with the `external` label, untouched by AW until you act. Treat the `external` label as "needs my eyes" — same role as `needs-human` but applied at the entry point instead of the escalation point.

### Choice: claude-code-action with OAuth (not gh-aw, not API key)

Started designing with `gh-aw` (GitHub Agentic Workflows). Discovered gh-aw's `engine: claude` hard-codes `ANTHROPIC_API_KEY` and doesn't expose claude-code-action's `claude_code_oauth_token` input. Switched to raw `claude-code-action@v1` so we could use OAuth (subscription quota, not pay-per-token).

What we lost from gh-aw: declarative `safe-outputs`, `skip-if-match` cron deduplication, container firewall sandboxing. We rebuilt these in raw YAML — guardrails into SKILL.md prompts, bash precheck for dedup, standard `concurrency:` blocks. Result: \~25-line workflow YAMLs, cleaner for our use case.

### Choice: TDD red-green-refactor at the issue level

aw-tdd verifies that red tests are RED *before* writing implementation. If a test passes from the start, the test is wrong or the bug isn't real — both signals to stop. Stricter than typical "write tests + code together" patterns: catches misunderstanding cheaply, forces bug confirmation, aligns with human TDD practice.

Exception (added by retrospective): tests that cover existing unchanged code paths (regression guards) ARE expected to be green from the start, when at least one new-behavior test is red. Common in additive changes (new flags, new methods).

### Choice: HITL/AFK gates on tdd-ready issues — narrow `hitl`, default `afk`

Every issue that reaches the `tdd` action label gets exactly one of `afk` (agent runs autonomously) or `hitl` (human approves first). The original heuristic defaulted to `hitl` whenever `aw-slice` was uncertain — a long list of triggers (design judgment, many-caller refactors, "looks risky") plus an explicit "default to `hitl` when uncertain" rule.

**The pivot.** That default trapped issues in queues waiting on human input for decisions that could have been a defensible default with a documented justification. PR review is the human checkpoint; pre-coding gates should be reserved for actions that are genuinely irreversible-on-user — not just "judgment calls". Real-world example: issue #139 (folder vocabulary refactor) got marked `hitl` for "design judgment on icons" — a question the implementing PR's diff would answer faster than a human staring at the issue body.

**The new rule.** Default is `afk`. `hitl` is reserved for four narrow, exhaustive criteria:

1. Destructive migration to existing user data the user can't undo from the UI
2. Security policy relaxation with no safe default
3. Breaking change to a documented external API (extension API, MCP contract, ACP protocol, public Rust types)
4. Explicit human request (`"ask me first"` in the issue body or a comment)

Everything else — design judgment, "many callers", "uncertain", visual regression risk — gets `afk` with a documented decision (see the next Choice). Research peers remain a special case: they ARE `hitl` because their output is a recommendation that needs human sign-off before becoming acceptance criteria.

Why the narrowing helps: a `hitl` issue is dead until a human types something. An `afk` issue with documented assumptions ships a draft PR that the human reviews — same human-checkpoint moment, but now they're reviewing concrete code instead of an abstract proposal.

### Choice: propose-don't-punt — every open question gets a suggested answer

The historical anti-pattern at every pre-implementation stage (refine, slice, tdd) was the same shape: when the agent hit a decision it wasn't confident about, it bounced the issue back and waited for human input. `aw-refine` left `refine` in place asking for clarification; `aw-slice` defaulted to `hitl`; `aw-tdd` had no rule and made silent ad-hoc choices.

**The fix.** Every stage MUST propose a defensible answer to every decision it surfaces, document the answer in a public location the user can override by commenting, and proceed. Specifically:

| Stage | Where the proposed answer is recorded | Override mechanism |
| --- | --- | --- |
| `aw-refine` | Issue body's `## Assumptions` section (visible in the rewritten body) | Human comments → `aw-feedback` routes back to refine |
| `aw-slice` | Slice rationale comment's `## Proposed answers` section + issue body's `## Open questions` updated inline | Human comments → `aw-feedback` routes back to slice |
| `aw-tdd` | PR body's `## Decisions made` section | Human comments → `aw-feedback` dispatches `aw-iterate` |

**Hard limit (when refine *can* still bounce).** Distinguish "vague but intelligible" (the common case → assumption-and-proceed) from "unintelligible" (empty body, single-character title, no recoverable signal → bounce back). Only the second case is allowed to leave `refine` in place. "I'm not sure what icon to pick" is vague-but-intelligible and gets a proposed answer.

**Prototype peers as the alternative to `hitl` for genuine N-way uncertainty.** When `aw-slice` identifies N≥2 defensibly-different approaches and can't pick one without empirical comparison, instead of marking `hitl`, it splits into N peer issues `Prototype A: ...` / `Prototype B: ...`, each marked `tdd + afk`. Each prototype lands as its own draft PR in parallel; the user picks by trying the live builds, merges the winner, closes the losing peers. The original issue carries `awaiting-prototypes` until the user closes it.

**Why this works.** Memory of what was decided lives in public, queryable, override-able commitments — not in the agent's head. A human comment overriding an assumption fires `aw-feedback`, which redispatches the relevant stage with the comment as context. The conversation loop closes; the agent never silently waits.

**Anti-patterns this rule eliminates:**

- ❌ Marking `hitl` because "this involves design judgment" — propose the design choice; PR review is the design-judgment checkpoint
- ❌ Leaving `refine` in place because "the issue is too vague" — make assumptions, document them, proceed
- ❌ Punting to the human via `tdd + afk` with unanswered open questions in the body — answer them inline, document the resolution
- ❌ Silent ad-hoc choices in implementation — every choice that wasn't already in the spec goes in the PR body's `## Decisions made` section

### Choice: human feedback as a first-class loop (aw-feedback + aw-iterate)

A `hitl` label without a feedback handler is a one-way pause signal — the human gets blocked but has no way to redirect the agent without manually editing labels. We made human feedback a real conversation gate.

`aw-feedback` runs on every comment/review on a hitl-labeled issue or claude\[bot\]-authored PR. It interprets the human's natural language and decides which pipeline stage to redirect to:

- "approve" / "lgtm" → `hitl → afk` (proceed) or `gh pr ready` (mark PR review-ready)
- "redo scope" / "acceptance criteria are wrong" → reset to `refine` (re-runs aw-refine with the comment as context)
- "wrong slicing" → reset to `slice`
- "wrong implementation" → close PR + reset to `tdd + afk`
- "rename X" / "extract Y" → dispatch `aw-iterate` to push a follow-up commit on the existing branch
- chat / unclear → reply asking for clarification

`aw-iterate` is the in-place PR iteration skill. When the requested change is small and specific (≤200 lines added, ≤5 files, bounded scope), it checks out the PR's branch, makes the change with the same hard gates as aw-tdd (red-green-refactor, full test suite, no unrelated files), and pushes a follow-up commit. For changes that exceed the budget, it deflects back to label-reset (close + reset to refine/tdd).

This closes the conversation loop. The agent can be redirected from ANY pause point to ANY earlier pipeline stage based on the human's natural-language comment — no slash commands, no manual label edits.

### Choice: every stage reads human comments since its trigger marker

**The pivot.** `aw-feedback`'s reset paths (refine → slice → tdd) all rely on the human's comment carrying the new intent. The original assumption was: "the comment is recorded on the issue, the next stage will see it." That assumption was false. Issue #162 (font-size shortcuts) was reset to `refine` twice with explicit override comments ("transient zoom, not persistent font-size change"); both times `aw-refine` faithfully re-refined the same body and produced the same wrong output, because the skill instructions didn't say "read the comments." Only `aw-review` read comments after the trigger marker — every other stage was working off the body alone.

**The fix.** Every stage skill (`aw-refine`, `aw-slice`, `aw-tdd`) now has an explicit "read human comments since the latest `refined` marker" step. The recipe:

1. `gh issue view` includes `comments` in the JSON fields.
2. Filter out bot comments (`github-actions[bot]`, `claude[bot]`, marker lines like `> *Refined automatically by`).
3. Of the remaining human comments, focus on those posted after the most recent `refined` event (or the most recent stage marker, depending on which stage is running).
4. Treat each such human comment as **authoritative** — it overrides the body when the two conflict.
5. Fold the corrections into the durable spec the next stage sees:
   - `aw-refine` rewrites the body so the override is impossible to re-derive wrong.
   - `aw-slice` folds the override into the slice rationale and (if applicable) into peer-issue bodies.
   - `aw-tdd` writes a red test for each override-comment requirement, alongside any aw-review gap-list.

**Why this works.** The previous loop only had one read-the-comments stage (`aw-review`), too late in the pipeline — by the time aw-review caught the gap, a wrong PR was already open and the user was already frustrated. Reading comments at every stage means the override propagates through the durable artifacts (refined body, slice rationale, peer-issue bodies, red tests) so each downstream stage sees the corrected intent in its primary input, not as a side note to remember.

**Anti-pattern this fixes.** "I refined the body, the comment is on the issue, surely the next agent will see it" — no, the next agent reads what its skill tells it to read. If the skill doesn't say "read comments," the agent doesn't, and the override is invisible.

### Choice: aw-review as an independent gate before "ready for review"

**The pivot.** Originally `aw-tdd` opened a draft PR and immediately flipped the issue to `review`, expecting the human to be the next gate. Two PRs (#85 and #86) merged through that gate looked clean on paper (tests green, code reads well) but **didn't actually fix the user's problem**. PR #86 changed 7 pickers in `cmd/modes/` while the user's issue actually pointed at chat-footer pickers — the agent took "command bar pickers" too literally. PR #85 implemented `criterion 4` of issue #62 verbatim while the user had commented THREE times asking for criterion 4 to be flipped — `aw-refine` re-ran but didn't fold the comments into the body, and `aw-tdd` faithfully implemented the stale criterion. Neither the implementer nor the post-merge audit caught it. The user was the reviewer, and the user was angry.

**The fix.** A separate workflow (`aw-review.yml`) fires on every bot-authored draft PR, runs in a fresh runner with a fresh `claude-code-action` invocation — meaning the reviewer agent has zero shared context with the implementer. It reads the issue body PLUS every comment posted after the latest `refined` marker, then reads the PR diff and tests, and judges per acceptance criterion: ✓ Covered, ⚠ Needs human visual review (qualitative property the tests don't verify), or ✗ Missing. For "all X" / "every Y" claims it greps the codebase and enumerates coverage. For comments since `refined` it checks both the body update AND the diff implementation.

**Outcomes.** Clean → posts a structured checklist comment, marks PR ready. Gaps → closes PR, resets the issue to `tdd + afk`, dispatches `aw-tdd` to retry with the gap list as context. After 2 reset cycles, escalates to human via the `needs-human` label rather than looping forever.

**Why a separate workflow (not a job in aw-pipeline).** The whole point is independence — the implementer's reasoning chain shouldn't pollute the reviewer's judgment. Same pattern as a two-pizza review where the implementer and the reviewer are different people. A separate workflow guarantees a separate agent session, separate runner, separate everything except the on-disk repo.

**What aw-review explicitly DOES NOT do.** It never modifies code (read-only on the repo), never auto-merges (humans still merge; aw-review just approves draft → ready). It also doesn't act on human-authored PRs — those are out of scope.

### Choice: aw-retrospect on every merge

Self-improvement loop. On claude\[bot\] PR merge, look for divergence between the originating skill's rules and what shipped (extra files touched, manual fixes after merge, review pushback, test changes, retries). Propose a SKILL.md patch as a draft PR. Always reviewed, never auto-merged. Inspired by rmstdope/my-copilot's `self-learning-skills` pattern.

### Choice: aw-alpha-cut splits cut + tag-after-merge (#317)

**The pivot.** Original `aw-alpha-cut` bumped `package.json`, generated the history file, regenerated the changelog, then committed + tagged + pushed directly to `main` in one job. First time we actually fired it (run 26247447578 on 2026-05-21), the push was rejected: `GH006: Protected branch update failed for refs/heads/main` — branch protection requires the 4 Tests status checks to have passed on the commit being pushed, and a runner's local commit doesn't satisfy that. Every prior alpha (e.g. `v0.45.0-alpha.1` = #312) had actually shipped as a PR; alpha-cut had been dead-code-against-branch-protection the whole time.

**The fix.** Split into two jobs in the same workflow file:

- `cut` (cron + workflow_dispatch) does the bump + history + changelog work, but pushes to a `release/v${NEXT_VERSION}` branch and opens an auto-merge PR with `tier:A` — going through the same branch-protection gate as every other PR.
- `tag-after-merge` (gates on `pull_request: closed` where merged=true AND head ref starts with `release/v`) tags the merge commit on main with `v${NEXT_VERSION}` and pushes the tag. `release.yml` fires on the tag push and builds the artifacts.

**Why two jobs, not one workflow that waits.** A single job that opens the PR then sleeps until merge would hold a runner for 10–15 minutes (CI duration). The `pull_request: closed` event hook is free — the cut job exits in seconds after pushing the PR, and tag-after-merge wakes up on the merge event when it actually has work to do.

**Why not tag-on-push-to-main instead.** A `push: main` trigger would fire on every commit to main, not just release-PR merges. Filtering by commit message ("starts with `chore: release v`") would work but ties the trigger to a stylistic convention. Branch-name filtering (`startsWith(head.ref, 'release/v')`) is unambiguous and matches what `cut` actually produces.

**Concurrency split.** `cut` uses group `aw-alpha-cut-cut`; `tag-after-merge` uses `aw-alpha-cut-${{ head_ref }}`. They don't queue on each other, and parallel release-branch merges (rare but possible) don't block.

### Choice: narrow-pattern CI repair instead of broad auto-fix (#195)

**The problem.** Bot-authored PRs from `aw-tdd` repeatedly failed CI because perf budget assertions used bare numeric literals (`toBeLessThan(500)`) that don't account for the CI macOS runner pacing ~3× slower than the dev machine. The fix is mechanical — wrap with `N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)` — but `aw-tdd` kept re-introducing the pattern on every retry because the skill instructions didn't explicitly prohibit it.

**The temptation.** One option is to have `aw-retrospect` patch `aw-tdd`'s SKILL.md to forbid bare literals. That's correct and was also done (see `aw-tdd` SKILL.md). But it doesn't help the dozens of existing bot PRs already in the queue with the wrong pattern, nor the edge case where a future bot PR slips through before the retro patch is applied.

**The fix.** A narrow CI repair skill (`aw-ci-repair`) that fires on `workflow_run.completed` with `conclusion == 'failure'` AND `head_branch` matching `claude/*`. It reads the CI failure log, applies a one-line mechanical fix when the failure is Pattern A (bare literal) or B (missing env var), and posts a comment for all other failure patterns. Hard constraints:

- **≤1 attempt per PR.** Checks for prior `fix(ci):` commits AND prior repair comments before doing anything.
- **≤2 files.** Refuses to repair if more than 2 files would be touched.
- **Patterns A + B only auto-fix.** Patterns C (snapshot drift), D (DOM-changed assertion), and E (catch-all) get a comment explaining what was found, with no code changes.
- **`WORKFLOW_PAT` throughout.** The push must fire `pull_request: synchronize` so CI re-runs on the repaired PR — same rationale as `aw-tdd` and `aw-iterate`.

**Why not just fix it in `aw-tdd`.** `aw-tdd` now explicitly prohibits bare literals (retro-patched). But CI auto-repair adds defense-in-depth: when a bot PR slips through anyway (race, regression, new bot PR format), the repair runs automatically rather than requiring a human to notice, diagnose, and re-trigger. The two mechanisms are complementary, not redundant.

**Scope discipline.** The skill is deliberately narrow. The `if:` guard (`conclusion == 'failure'` AND `startsWith(head_branch, 'claude/')`) prevents it from touching human PRs. The one-attempt cap prevents repair loops. The ≤2-file limit prevents it from accumulating scope over time.
