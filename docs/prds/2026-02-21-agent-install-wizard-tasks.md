# Agent Install Wizard — Tasks

**PRD:** `docs/prds/2026-02-21-agent-install-wizard.md`
**Total:** 5 tasks (1S, 3M, 1L)

## Tasks

### #1 — Add `resolve_npm()` helper and package allowlist
- **Complexity:** S | **Category:** backend
- **Description:** Add `resolve_npm()` function to `acp.rs` that finds npm on macOS (tries `which npm`, `/opt/homebrew/bin/npm`, `/usr/local/bin/npm`, `~/.nvm/versions/node/*/bin/npm`). Add `get_install_package()` allowlist mapping agent IDs to npm packages. Add install lock field to `AcpState`.
- **Files:** `src-tauri/src/commands/acp.rs`

### #2 — Add `acp_agent_install` Tauri command
- **Complexity:** M | **Category:** backend | **Depends on:** #1
- **Description:** New async command that validates agent_id against allowlist, resolves npm, spawns `npm install -g <package>` with piped stdout/stderr, streams output as `agent-install-output` events, emits `agent-install-done` on completion. Uses install lock to prevent concurrent installs. Register in `lib.rs` `generate_handler![]`.
- **Files:** `src-tauri/src/commands/acp.rs`, `src-tauri/src/lib.rs`

### #3 — Add `AgentInstallInfo` to provider options
- **Complexity:** S | **Category:** frontend
- **Description:** Add `AgentInstallInfo` interface with `npmPackage`, `installCommand`, `manualUrl?`. Add optional `installInfo` field to `ProviderOption`. Populate for claude-agent-acp, codex-acp, and copilot entries in `PROVIDER_OPTIONS`.
- **Files:** `src/lib/ai/connections.ts`

### #4 — Redesign `ConnectAgent` with install wizard flow
- **Complexity:** L | **Category:** frontend | **Depends on:** #2, #3
- **Description:** Expand `AgentPhase` with `installing` and `install_failed`. Redesign `not_installed` phase with Install button + manual command + copy button. Add `installing` phase with spinner + scrollable log area listening to `agent-install-output` events. Add `install_failed` phase with error display and context-sensitive hints (EACCES -> sudo, npm not found -> nodejs.org). Auto-transition to `checking` after successful install. Refactor monolithic `useEffect` into separate focused effects. Remove `getInstallHint()`.
- **Files:** `src/components/settings/ConnectionsSettings.tsx`

### #5 — Test and verify end-to-end
- **Complexity:** M | **Category:** both | **Depends on:** #4
- **Description:** Run `cargo check` + `npx tsc --noEmit`. Manual test in `pnpm tauri dev`: pick agent, verify install UI, test success/failure/retry paths. Verify both light and dark mode.
- **Files:** —
