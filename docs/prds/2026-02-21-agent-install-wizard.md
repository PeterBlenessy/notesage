# Agent Binary Auto-Install Wizard

**Date:** 2026-02-21 **Status:** Partially implemented **Parent:** AI Provider Architecture v2

## Problem

When users add a subscription-based AI connection (Claude Code, Codex, Copilot), the app checks if the agent binary is installed. If not found, it shows a static text hint ("Run: npm install -g ...") with only Back/Retry buttons. The user must leave the app, open a terminal, run the command manually, then come back and retry. This breaks the setup flow and creates unnecessary friction.

## Goals

- One-click agent binary installation from within the app
- Clear progress feedback during installation
- Graceful error handling with actionable guidance (permissions, npm not found)
- Manual install path always available as fallback
- Auto-proceed through remaining setup steps after successful install

## Non-Goals

- Homebrew installation support (npm only for now)
- Running commands with sudo/elevated privileges from the app
- Auto-updating already-installed agent binaries
- Installing Node.js/npm itself

## User Stories

- As a user, I want to click "Install" when an agent binary is missing, so that I don't have to leave the app to set it up.
- As a user, I want to see installation progress, so that I know the install is working and not stuck.
- As a user, I want clear error messages when installation fails, so that I can fix the issue (e.g., run with sudo, install npm).
- As a user, I want to copy the manual install command, so that I can run it myself if auto-install doesn't work.

## Technical Approach

### Rust Backend

New `acp_agent_install` Tauri command in `src-tauri/src/commands/acp.rs`:

- **npm resolution**: `resolve_npm()` helper that finds npm on the system. Tauri GUI apps don't inherit shell PATH, so it tries `which npm`, then common paths (`/opt/homebrew/bin/npm`, `/usr/local/bin/npm`), then `~/.nvm/versions/node/*/bin/npm`.
- **Package allowlist**: `get_install_package()` maps agent IDs to npm packages. Only pre-approved packages can be installed:
  - `claude-agent-acp` -&gt; `@anthropic-ai/claude-code`
  - `codex-acp` -&gt; `@openai/codex`
  - `copilot` -&gt; `@githubnext/github-copilot-cli`
- **Streaming output**: Spawns `npm install -g <package>` with piped stdout/stderr. Lines emitted as `agent-install-output` Tauri events. Completion emitted as `agent-install-done` event.
- **Concurrency guard**: Install lock (`Mutex<bool>`) in `AcpState` prevents concurrent installs.

### Frontend Types

`src/lib/ai/connections.ts`:

- New `AgentInstallInfo` interface: `{ npmPackage, installCommand, manualUrl? }`
- Added as optional `installInfo` field on `ProviderOption`
- Populated for the three agent entries in `PROVIDER_OPTIONS`

### Frontend UI

`src/components/settings/ConnectionsSettings.tsx`:

Two new phases added to `AgentPhase`: `installing` and `install_failed`.

**Phase flow:**

```
checking -> not_installed -> installing -> (re-check) -> not_authenticated -> connecting -> connected
                                |
                          install_failed -> (retry) -> installing
```

`not_installed` **phase** (redesigned):

- Alert box: "{binary} not found"
- Primary "Install" button triggers auto-install
- Monospace block with npm command + copy button for manual install
- Back / "I've installed it" (retry) buttons

`installing` **phase** (new):

- Spinner + "Installing..."
- Small scrollable log area (\~100px) showing npm output
- Back button (install continues in background)

`install_failed` **phase** (new):

- Red error box with output
- Context-sensitive hints: suggests `sudo` for EACCES, nodejs.org for npm-not-found
- Back / Retry Install buttons

**After successful install**: auto-transitions to `checking` which re-runs availability check, then proceeds to auth/connect as normal.

**Effect refactor**: Split monolithic `useEffect` into focused effects for availability check, install listeners, and connection.

### Cleanup

Remove `getInstallHint()` — replaced by `installInfo.installCommand` on provider options.

## Data Model

```typescript
interface AgentInstallInfo {
  npmPackage: string;        // "@anthropic-ai/claude-code"
  installCommand: string;    // "npm install -g @anthropic-ai/claude-code"
  manualUrl?: string;        // "https://docs.anthropic.com/en/docs/claude-code"
}
```

Tauri event payloads:

```typescript
// agent-install-output
{ line: string; stream: "stdout" | "stderr" }

// agent-install-done
{ success: boolean; error: string | null }
```

## Dependencies

- Node.js/npm must be installed on the user's system (not bundled)
- Tauri event system (already in use for ACP session updates)

## Quality Gates

- [ ] `cargo check` passes

- [ ] `npx tsc --noEmit` passes

- [ ] Auto-install works when npm is available and binary is not installed

- [ ] Correct error shown when npm is not found

- [ ] Correct error shown for permission denied (EACCES)

- [ ] Manual install command is copyable

- [ ] After successful install, flow auto-proceeds to auth check

- [ ] Install log shows real-time npm output

- [ ] Concurrent install attempts are blocked

- [ ] Looks correct in both light and dark mode

## Out of Scope

- Homebrew/brew install support
- Privilege escalation (sudo) from within the app
- Auto-update existing binaries
- Installing Node.js/npm
- Uninstall flow