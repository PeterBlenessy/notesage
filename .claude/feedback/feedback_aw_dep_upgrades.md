---
name: AW is the wrong tool for dep upgrades
description: Don't route dep bumps / lint sweeps / mechanical changes through the AW pipeline — do them locally, batch-merge them
type: feedback
originSessionId: e0a9c6e6-c7bb-4748-a54a-f7fbc33596a2
aw_applies: yes
aw_applies_to: [aw-triage]
---
For tasks where a competent human can do the work in <30 minutes locally, the AW pipeline is overhead, not leverage. `chore(deps):` upgrades are the canonical example.

**Why:** A weekend's worth of `pnpm up --latest` and `cargo upgrade` got stuck in triage → refine → slice → tdd → review → rebase → tier-classify cycles, with PRs going BEHIND every time main moved, requiring repeated update-branch CI reruns. The Tier C classifier correctly flagged `/index/`, `/watcher.rs`, `.github/workflows/` as load-bearing — but it routed the review to the human, who explicitly said their coding competence is ~10% of the agent's. The right reviewer for a 14-line `parser.rs` shim is the agent, not the human.

**How to apply:**
- **Triage rule:** `chore(deps):` and dependency-bump issues do NOT enter the AW pipeline. Handle them in a dedicated `aw-deps` flow that bumps + tests + PRs in one shot, OR do them locally and batch the lockfile commit.
- **Classifier rule:** `chore(deps):` PRs with <50 prod lines and green CI fast-path to Tier A regardless of load-bearing path. The upstream changelog is the spec; the test suite is the validation.
- **For ANY Tier C the agent flags:** the agent reads the diff against the upstream changelog FIRST and either approves-and-merges OR escalates with a specific one-sentence question. Never "here's a 14-line diff, what do you think?" to a non-coding user.
- **The 30-minute rule:** before opening an issue for AW, ask "could a competent human do this locally in <30 min?" If yes, do it locally. Reserve AW for features with acceptance criteria, cross-file refactors, and bugs.

**Anti-patterns:**
- ❌ Routing dep bumps through AW because "the pipeline exists"
- ❌ Bouncing a Tier C dep diff to the user when the user has stated they lack the code competence to review it
- ❌ Letting dep PRs sit BEHIND for days while main moves on (each rebase = full CI rerun = ~30-60min)
- ❌ Generating refine/slice/tdd LLM stages for `pnpm up @types/react`
