# PRD: Skill Feedback Loop

|  |  |
| --- | --- |
| **Date** | 2026-04-20 |
| **Status** | Draft |
| **Priority** | Medium — compounding quality improvement |
| **Impact** | Every skill gets continuously improved from real-world friction signals, with zero per-skill boilerplate. `retrospect-skills` turns from a manual review of whatever the reviewer remembers into a structured read-through of deterministic capture. |
| **Related** | `.claude/skills/retrospect-skills/SKILL.md` (existing synthesis side) |

## Problem

Skills — both bundled and user-authored — drift over time. Instructions become unclear, outcomes miss the user's intent, new edge cases appear. Today:

- Friction during a skill run is only captured if the user or I remember to write a feedback entry afterwards. In practice, this is almost never.
- The `retrospect-skills` skill exists but has no reliable stream of input. It's reviewing whatever the reviewer happens to remember.
- Any convention of "append a feedback-logging step to every skill" decays the moment someone adds a new skill or imports one without the step.

We want an **automatic, general** feedback loop: every time any skill runs, a concise observation about it gets logged. Nothing per-skill. New or imported skills are covered without touching them.

## Goals

1. Every skill invocation produces a concise feedback entry (≤3 lines) with zero per-skill boilerplate.
2. The capture is deterministic — driven by the Claude Code harness, not by my or the user's memory.
3. `retrospect-skills` reads the accumulated entries and proposes improvements with per-change approval.
4. The mechanism stays thin: one log file, one hook-backed capture path, one synthesis skill. No scaffolding that will bloat over time.

## Non-Goals

- A general engineering retrospective on "what did we learn this sprint" — scope is explicitly skill improvement. Project, PRD, and audit retrospectives are separate practices.
- Replacing human judgement with automation — the synthesis skill proposes, the user approves.
- Real-time dashboards, metrics, or UI surfaces. Plain markdown log is enough.
- Cross-project skill feedback aggregation. The feedback log is per-project memory.

## User Stories

- **As a Notesage developer**, when I run `/release minor` and notice I'm re-reading three prior history files to get the tone right, that friction is captured automatically. Next week when I run `/retrospect-skills`, it proposes updating the release skill to embed the tone guidance.
- **As a Notesage developer**, when I run a simple skill that works perfectly, the feedback log gets a three-line "nothing notable" entry. No prompt to fill in detail when there isn't any.
- **As a Notesage developer**, when I run `/retrospect-skills`, it summarises the last N entries per skill, proposes SKILL.md edits where a pattern appears, and asks me clarifying questions when my self-reflections were thin.

## Technical Approach

Two halves: deterministic capture (hook-driven) and synthesis (existing skill, extended).

### Capture

**Trigger: `PostToolUse` hook with `"matcher": "Skill"`** in `~/.claude/settings.json` (or project-local `.claude/settings.json`). Fires every time any skill is invoked, for every current and future skill. A shell script writes a marker file `.claude/pending-reflection.json` containing `{ skill, args, startedAt, finishedAt }`.

**Trigger: `UserPromptSubmit` hook** runs before I see the next user prompt. If `pending-reflection.json` exists, it injects a short `additionalContext` that reminds me to append a 3-line entry to the feedback log and delete the marker before responding to the user's message. If the marker is missing, the hook is a no-op.

This is "background-ish": no extra turn, no waiting for the user. I write the reflection plus the user's real response in the same turn. The user sees a small extra output block; the log gets written deterministically.

**Fallback — marker not cleared:** If I forget (interrupted, crashed, user bailed), the marker survives. The next `UserPromptSubmit` re-injects the reminder. Self-healing. Worst case, a stale marker re-prompts me until resolved.

**Skip condition — sub-agent invocations:** Skills invoked inside a spawned `Agent` tool (sub-task) have their own tool budget and the user isn't in that loop. The hook checks `$CLAUDE_AGENT_ID` (or equivalent) and no-ops when present. Only main-conversation skills trigger reflection.

### Feedback log

Location: `~/.claude/projects/<project-slug>/memory/skill-feedback.md`. Per-project, append-only.

Format — three lines per entry, strict:

```markdown
## 2026-04-20 17:58 — /release minor (v0.38.1)
- F: changelog tone too technical; didn't cross-reference prior releases
- O: shipped OK, style flagged by user later
- I: release skill should cite 1-2 prior entries as tone reference
```

- `F:` friction observed during the run (or `none`)
- `O:` outcome relative to expectations (or `as expected`)
- `I:` improvement idea for the skill (or `none`)

Ruthlessly concise — three bullets, one line each. If the entry wants to be longer, it belongs in a PRD or an ad-hoc note, not here.

### Synthesis

Extend `.claude/skills/retrospect-skills/SKILL.md` to:

1. Read `memory/skill-feedback.md` in addition to whatever it currently reads.
2. Group entries by skill; flag patterns (same friction mentioned 3+ times, outcomes missing expectations repeatedly).
3. Propose SKILL.md edits per pattern with per-change approval (current behaviour).
4. Ask clarifying questions when reflections are thin ("entry says `F: none` five times but you flagged an issue in conversation — what happened?").
5. Optionally archive reviewed entries into a dated `skill-feedback-archive/<date>.md` to keep the live log short.

## Data Model

- `.claude/pending-reflection.json` — transient marker. Deleted after reflection.
- `~/.claude/projects/<slug>/memory/skill-feedback.md` — append-only log.
- `~/.claude/projects/<slug>/memory/skill-feedback-archive/*.md` — post-synthesis archives (optional).

No Zustand, no Tauri command changes, no new storage.

## UI/UX

Minimal. The only user-visible surface is my brief "Reflected: …" note at the top of my response on turns that follow a skill invocation. Users can treat it as a one-line preamble; power users can watch it to see which skills are producing friction.

## Dependencies

- `~/.claude/scripts/skill-ran.sh` — new (~10 lines). Writes the marker.
- `~/.claude/settings.json` — two new hook entries.
- `CLAUDE.md` — one new discipline clause ("If a pending-reflection marker exists, append a 3-line F/O/I entry to skill-feedback.md before responding").
- `.claude/skills/retrospect-skills/SKILL.md` — extended to read the new log.

No changes to any individual skill. No changes to the app.

## Quality Gates

- [ ] A `/release minor` dry-run produces a 3-line entry in `skill-feedback.md` with the correct skill name, args, and timestamp.
- [ ] A skill invoked inside a spawned agent does NOT produce an entry (sub-agent suppression works).
- [ ] A skill invoked in the main conversation while an agent is running in the background DOES produce an entry.
- [ ] If I forget to clear the marker, the next user prompt re-injects the reminder and I complete the reflection.
- [ ] The entry never exceeds 3 lines. The discipline clause + the hook's context injection enforce this.
- [ ] `retrospect-skills` reads the new log, groups by skill, proposes at least one edit per observed pattern, and applies approved edits without regression.
- [ ] The hook is cross-platform compatible (macOS at minimum; Linux / Windows tracked as follow-up if needed).
- [ ] Hook script failure does NOT block the user's next turn. Errors go to a log, not the user-facing response.

## Out of Scope

- Cross-project feedback aggregation (user may have multiple projects; each keeps its own log).
- Automatic scheduling of `retrospect-skills` (user invokes on a cadence of their choosing).
- Friction capture for non-skill tools (Bash, Read, Edit, etc.) — too noisy.
- Authoring feedback entries from a separate Notesage UI surface.
- Migration of any existing ad-hoc feedback notes into the new format.

## Success Criteria

1. After a week of use, `memory/skill-feedback.md` has ≥1 entry per substantive skill invocation, zero per-skill boilerplate added.
2. `/retrospect-skills` proposes at least one concrete SKILL.md improvement from real-world observations that wouldn't have been noticed otherwise.
3. The user's subjective experience is "the skill improves itself" rather than "I have to remember to write feedback".
4. Entries remain concise across time — no drift toward long stories. If they start drifting, the discipline clause or the hook's injected reminder tightens.

## Open Questions

1. **Archiving cadence.** Should `retrospect-skills` auto-archive on each run, or leave the log alone until it exceeds a threshold (e.g. 200 entries / 1000 lines)?
2. **Per-skill opt-out.** Some skills (`/fetch`, simple utility skills) may generate only noise. Do we maintain an allowlist, or tolerate "nothing notable" entries and filter during synthesis?
3. **Hook script location.** `~/.claude/scripts/` is a natural spot but requires user setup. Could alternatively live in `.claude/scripts/` per-project. User preference.
4. **What to inject on the next-turn reminder.** A short one-liner, or the full 3-bullet template? Shorter is less context-bloat; fuller is less judgement on my side.
5. **Does this become a general pattern?** If the skill-feedback loop works, do we build sibling loops for tasks / PRDs / audits as separate PRDs? User prefers keeping them separate rather than a unified framework.

## Risks

- **Context bloat** from injected reminders. Mitigated by keeping the reminder short and one-shot (marker deleted after reflection).
- **Noise in the log** from trivial skills. Mitigated by the `none / as expected / none` shape — three short lines skip-readable during synthesis.
- **Hook failures** silently break the loop. Mitigated by making the hook a soft-fail (write to a separate error log, don't block). `retrospect-skills` can sanity-check coverage ("I see 50 skill invocations in the conversation log but only 30 entries — something's missing").
- **Adoption drift** — over time, my reflections could get shallow. Mitigated by `retrospect-skills` periodically asking the user clarifying questions when patterns look thin.
