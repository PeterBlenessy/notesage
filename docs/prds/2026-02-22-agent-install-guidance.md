# Agent Install & Auth Guidance (MVP)

**Date:** 2026-02-22
**Status:** Draft
**Parent:** AI Provider Architecture v2
**Supersedes:** Partial scope of `2026-02-21-agent-install-wizard.md` (guidance portion only)

## Problem

When users add a subscription-based AI connection (Claude Code, Codex, Copilot CLI, Copilot LSP, Gemini CLI), the app checks if the binary is installed. If not found, it shows a terse one-liner like `"Run: npm install -g @zed-industries/claude-agent-acp"` or the even less helpful `"Install "gemini" to continue."` — no context on what the tool is, why it's needed, or where to learn more. Auth hints are similarly sparse. The guidance is inconsistent across providers.

## Goals

- Clear, numbered step-by-step install and auth guides for every agent provider
- Copyable terminal commands (click-to-copy with visual feedback)
- Relevant URLs visible and selectable (prerequisites, subscriptions, docs)
- Consistent presentation across all providers
- Foundation for future auto-install wizard (same steps become executable with status indicators)

## Non-Goals

- Automated installation (future — see `2026-02-21-agent-install-wizard.md`)
- Clickable/openable URLs (just selectable text for now)
- Backend changes

## User Stories

- As a user adding Claude Code, I want to see exactly what npm command to run and what subscription I need, so I can get set up without searching online.
- As a user adding Gemini CLI, I want the same quality of guidance as Claude Code, not a generic "install gemini to continue" message.
- As a user, I want to copy terminal commands with one click, so I can paste them directly into my terminal.

## Technical Approach

### Data Model

Structured guide data replaces plain-text hints:

```typescript
interface GuideStep {
  label: string;       // e.g. "Install via npm"
  command?: string;    // copyable terminal command
  note?: string;       // muted helper text
  url?: string;        // selectable URL reference
}

interface SetupGuide {
  title: string;
  steps: GuideStep[];
}
```

This model is designed to extend naturally to the auto-install wizard: each step gains a `status` field (`pending` | `running` | `done` | `failed`) and the guide view shows spinners/checkmarks per step.

### Install Guides Per Agent

| Binary | Steps |
|---|---|
| `claude-agent-acp` | 1. Install Node.js (url: nodejs.org) 2. cmd: `npm install -g @zed-industries/claude-agent-acp` 3. note: Requires Claude Pro or Max (url: anthropic.com/claude) |
| `codex-acp` | 1. Install Node.js (url: nodejs.org) 2. cmd: `npm install -g @zed-industries/codex-acp` 3. note: Requires ChatGPT Plus or Pro |
| `copilot` | 1. Install Node.js (url: nodejs.org) 2. cmd: `npm install -g @github/copilot` 3. note: Requires GitHub Copilot subscription (url: github.com/features/copilot) |
| `gemini` | 1. Install Node.js (url: nodejs.org) 2. cmd: `npm install -g @google/gemini-cli` 3. note: Free with Google account (url: github.com/google-gemini/gemini-cli) |
| `copilot-language-server` | 1. Install Node.js (url: nodejs.org) 2. cmd: `npm install -g @github/copilot-language-server` 3. note: Requires GitHub Copilot subscription (url: github.com/features/copilot) |

### Auth Guides Per Agent

| Binary | Steps |
|---|---|
| `claude-agent-acp` | 1. cmd: `claude auth login` 2. note: Opens browser — requires Claude Pro or Max |
| `codex-acp` | 1. cmd: `codex login --device-auth` 2. note: Requires ChatGPT Plus or Pro |
| `copilot` | 1. cmd: `copilot auth login` 2. note: Requires GitHub Copilot subscription |
| `gemini` | 1. cmd: `gemini auth login` 2. note: Free with Google account |

### UI Components (file-local in ConnectionsSettings.tsx)

**`CopyableCommand`** — mono-font code block with copy button:
- `bg-muted/50`, rounded, horizontal padding
- Clipboard icon on right edge, swaps to Check for 2s after copy
- `navigator.clipboard.writeText()`

**`SetupGuideView`** — renders a `SetupGuide` as a numbered step list:
- Title as `text-sm font-medium`
- Numbered steps with labels, optional command/url/note
- Commands rendered via `CopyableCommand`
- URLs as `text-xs text-muted-foreground` plain selectable text
- Notes as `text-xs text-muted-foreground`

### Changes to Existing Code

1. Replace `not_installed` phase in `ConnectAgent` — swap alert box + `getInstallHint()` for `<SetupGuideView>`
2. Replace `not_authenticated` phase in `ConnectAgent` — swap alert box + `getAuthHint()` for `<SetupGuideView>`
3. Replace `not_installed` phase in `ConnectCopilotLsp` — swap hardcoded text for `<SetupGuideView>`
4. Delete `getInstallHint()` and `getAuthHint()` functions

### Files Modified

- `src/components/settings/ConnectionsSettings.tsx` — sole file

## Future Extension: Auto-Install Wizard

The `SetupGuide` / `GuideStep` model is designed to become the auto-install wizard with minimal changes:

1. Add `status?: 'pending' | 'running' | 'done' | 'failed'` to `GuideStep`
2. `SetupGuideView` renders status icons per step (spinner, checkmark, X)
3. An "Install" button triggers sequential step execution via a new `acp_agent_install` Tauri command
4. npm output streams into a collapsible log area below the running step
5. On failure, the failed step shows context-sensitive error hints

The static MVP is the read-only view of this same flow.

## Verification

1. `npx tsc --noEmit` — type check passes
2. `pnpm tauri dev` → Settings → Connections → Add each agent type
3. Verify: numbered steps with correct commands for all 5 agents
4. Verify: copy button works with visual feedback
5. Verify: URLs visible and selectable
6. Verify: auth guide shows correct commands
7. Verify: Back/Retry buttons still work
8. Check both light and dark mode
