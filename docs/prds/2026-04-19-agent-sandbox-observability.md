# Agent Sandbox Observability — PRD (Idea / Draft)

|  |  |
| --- | --- |
| **Date** | 2026-04-19 |
| **Status** | Idea — problem statement only, to be drafted fully later |
| **Related** | [project-data-isolation](2026-04-18-project-data-isolation.md), task #6d |

## Problem

Notesage's Seatbelt profile (see task #6d) locks down filesystem reads for ACP agent subprocesses to a curated allow-list. That list was determined empirically on 2026-04-19 against specific versions of Claude Code (`@agentclientprotocol/claude-agent-acp 0.24.2`), Codex, Copilot, and Gemini CLI.

**Those agents update outside our control.** A user's Homebrew updates Claude Code. npm updates `@anthropic-ai/claude-agent-sdk`. Package maintainers change node_modules layouts. Any upstream change that introduces a new path dependency we haven't enumerated will silently break agent init on our sandbox — the user sees "Lost connection to Claude Code. Please try again." and has no idea why.

We watched exactly this happen during #6d development: the agent crashed with `Error: EPERM: operation not permitted, watch '/Users/peter/.claude'` but the top-level error surfaced as `"Query closed before response received"`. Without binary-searching under sandbox-exec manually, we couldn't tell which path was missing.

**The fundamental asymmetry:** we can't pre-validate against every future agent version, and we can't predict what paths a future version will need. Maintaining the allow-list by chasing upstream changes is a losing game. What we *can* do is:

1. **Fail loud, not silent.** When the sandbox denies a path, the user (and we) need to know exactly what was denied and by which agent.
2. **Learn centrally.** Aggregate denial signals across users so we can update the default allow-list proactively instead of reactively fielding "agent broken" reports.
3. **Unblock individuals.** Give the user a way to add a path to their local allow-list without waiting for a Notesage release.

## Observations from #6d

- `sandbox_monitor.rs` already reads `log stream` for Seatbelt deny entries, correlates by agent PID, and surfaces them as Activity panel error entries. This infrastructure is the natural foundation for (1).
- But on current macOS (14/15), `sandbox-exec` children's denies don't always appear in `log stream` — at least not with the predicates we currently use. We spent meaningful time trying to extract denies during #6d manual testing and couldn't. The existing `sandbox_monitor` reads may work for agent processes that enter the sandbox via the Tauri IPC path but not for probes run via `sandbox-exec` directly. Needs verification.
- When the agent dies during init, PID unregistration happens fast (process exits within 1–2s of EPERM). The monitor's 5s dedup window may catch the deny before unregister, but timing is fragile.

## What we'd build

Not finalized — this section captures directions, not decisions.

**Local observability (user-facing):**

- When the agent fails to initialize and the monitor captured a deny entry for that PID in the preceding 5s, replace the generic "Lost connection" banner with a specific one:
  *"Agent Claude Code was denied access to `/Users/peter/<path>` during startup. This path is not in the sandbox allow list. [Allow for this agent] [Report to Notesage] [Dismiss]"*
- "Allow for this agent" persists a user-override in settings (per-agent or global). Merged into profile generation on next spawn.
- "Report to Notesage" opens a pre-filled GitHub issue (or emails a telemetry endpoint, depending on design) with the agent version + denied path + minimal OS metadata. No user data.
- Settings → Privacy → Sandbox Allow List: user can review / revoke their own overrides.

**Remote observability (ours):**

- Opt-in telemetry: on sandbox-denial-during-init, POST a small structured event to a Notesage-maintained endpoint. Payload: `{ agent_binary, agent_version, denied_path, os_version }`. No user data, no file content.
- Alternative: automatic GitHub issue creation against a dedicated repo (e.g., `notesage/sandbox-denials`). Easier to triage than a custom endpoint, but noisier.
- Either way, the signal lets us update the default allow-list in the next release before other users hit the same issue.

**CI regression harness (local to Notesage devs):**

- `sandbox_isolation.rs`-style test that spawns each supported agent with the production profile and asserts `session/new` returns a `sessionId`. Runs on CI with the latest pinned agent versions we support.
- Catches: upstream releases we've pinned and ship. Does NOT catch: user machines running newer versions, or users with unusual setups (custom Node install paths, etc.).

## Open questions

- **Does `sandbox_monitor.rs` actually capture denies for our production agent processes, or only for the scenarios it was originally designed for?** Testing needed. If not, we need a different mechanism — possibly parsing the spawned agent's stderr for EPERM messages (which we DID see in #6d manual tests when we looked directly at stderr).
- **Privacy model for remote telemetry.** Opt-in only, clearly. What minimum payload tells us enough to act without being creepy? Probably just `{agent, version, denied path relative to $HOME, OS version}` — no project paths, no conversation content.
- **How quickly can we iterate the default allow-list?** If a Claude SDK update rolls out and 1000 users hit it overnight, we need to turn that into a Notesage release fast. CI harness + fast-patch process? Or user-override self-heal without our intervention?
- **Scope creep risk.** The local "allow and retry" path is effectively "give the agent more access" — it needs design care so users don't grant broad access reflexively to get past an error. Prompt should make clear what they're enabling.

## Why now

Track 1 isolation (#6d) is landing. The sandbox is now strict enough that upstream agent changes will bite us. Without observability we'll blame the user's machine, they'll blame Notesage, and issues will sit open while the actual path denial goes un-diagnosed. This PRD is the plan for making those denials visible and actionable.

## Not in this PRD

- Changing the default allow-list. That happens in releases, driven by this PRD's signals.
- Windows or Linux equivalents of sandbox observability. macOS-only for v1.
- Agent-authored manifests declaring which paths they need. Nice-to-have but depends on upstream cooperation — we can't require it.
