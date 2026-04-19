# Chat Footer UX — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-19 |
| **Status** | Not started |
| **PRD** | None (scoped UX bugs, not a feature) |
| **Total** | 3 tasks: 2S, 1M |

Discovered during #6d manual testing on 2026-04-19 — the chat footer's dropdown/selector behavior doesn't match user expectations when switching agents. These are independent of the sandbox work but worth fixing together.

---

### #1 — Mode / permission-level labels must be consistent across agents

**Description:** The PRD (`docs/features/ai-workflows.md`) established a common internal vocabulary for permission levels — "Read Only", "Agent", "Full Access", "Plan" — with per-agent translation under the hood. Each agent reports its own mode IDs via ACP (Claude Code: `default` / `acceptEdits` / `plan` / `dontAsk` / `bypassPermissions`; Gemini: `default` / `autoEdit` / `yolo` / `plan`; etc.) and we map those to the common labels. User reports seeing agent-specific raw labels in the footer for at least one agent — the mapping layer isn't applying uniformly.

**Acceptance criteria:**

- For every supported ACP agent (Claude Code, Codex, Copilot, Gemini), the mode picker in the chat footer displays the common Notesage labels: "Read Only" / "Agent" / "Full Access" / "Plan" (or whichever four we settle on).
- Under the hood, the selected common-label maps to the agent-specific mode ID and calls `acpSessionSetMode` with the correct raw ID.
- Modes the agent doesn't support (e.g. an agent without a "Plan" equivalent) are hidden from the dropdown rather than shown as "not available" or "unknown".
- Component test: mount the mode picker with each agent's reported modes array; assert rendered labels match the common vocabulary.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/components/chat/ChatFooter.tsx` (exact filename TBD — mode picker dropdown)
- `src/lib/ai/acp-utils.ts` (or wherever the mode-ID-to-common-label map lives)
- Component tests

---

### #2 — Footer dropdowns refresh instantly on agent switch

**Description:** When the user switches to a different agent via the connection picker, the mode dropdown and config-option dropdowns in the footer should immediately reflect the new agent's reported options. Currently the dropdowns appear to lag — either showing the previous agent's options or requiring a page refresh / chat reopen to update.

This is likely a React-render dependency issue: the footer derives its options from the currently-active agent's session capabilities, and some effect or selector isn't re-running on connection change.

**Acceptance criteria:**

- Switching connections in the footer triggers a fresh derivation of mode options + config options from the newly-active agent's session response.
- No stale options from the prior agent.
- Test: mount footer, switch active connection prop, assert dropdown contents update within a single render.

**Complexity:** S **Category:** frontend **Dependencies:** #1 (same area of code) **Files:**

- `src/components/chat/ChatFooter.tsx`
- `src/stores/...` — the store that tracks current agent session state

---

### #3 — Config-option widgets render only for agents that support them

**Description:** Thinking effort (reasoning_effort) is a config option specific to Codex and some Claude modes. Today the footer appears to render the thinking-effort dropdown universally, which is noise for agents that don't report that config option. Each agent's session response advertises which `config_options` it supports — the footer should render only those.

Related: some agents report `configOptions` with `category: "mode"` and `category: "model"` — these are already handled by dedicated pickers, so the generic config-option renderer should skip them.

**Acceptance criteria:**

- Footer renders only the config options the active agent's session reported (excluding `category: "mode"` and `category: "model"` which have dedicated pickers).
- Gemini and Codex: verify thinking-effort only shows when Codex is active.
- Agent reporting no non-mode/non-model config options shows no generic config widget.
- Component tests per agent.

**Complexity:** M **Category:** frontend **Dependencies:** #2 **Files:**

- `src/components/chat/ChatFooter.tsx`
- Related config-option rendering components
