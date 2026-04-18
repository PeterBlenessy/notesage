# PRD: ACP Terminal Client Capability (Batch F)

|  |  |
| --- | --- |
| **Date** | 2026-04-18 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Agents' shell commands run inside Notesage's existing sandbox (Seatbelt + proxy), with live streaming output and a per-command permission card. Turns the current `ToolCallContent::Terminal` placeholder into a real feature. |
| **Audit** | [acp-audit](../audits/2026-04-14-acp-audit.md) — Batch F |

## Problem

Today when ACP agents (Claude Code, Codex, Copilot, Gemini) run shell commands, they execute the command **inside their own subprocess**. This creates three problems:

1. **Inconsistent sandbox.** The ACP agent itself runs under a Seatbelt profile + HTTP proxy that Notesage controls. But when the agent shells out to `npm test`, that child process inherits the *agent's* permissions. If the agent decides to widen its permissions or misbehaves, we have no handle on what the spawned commands can do.
2. **No streaming output.** Agent-run commands return a wall of stdout/stderr to the user at the end. Long-running commands (`cargo build`, integration test suites) show nothing until they exit. Users can't tell if anything is happening.
3. **Fragmented permission surface.** Notesage shows a permission card when an agent writes a file or runs a skill script. But when the agent runs `rm -rf ~/Documents` internally, we never see it — it's just another agent-side tool call that shows up as "running Bash" with no visibility into the actual command.

ACP's Terminal capability exists to solve this. It inverts command execution: the **client** (Notesage) hosts the subprocess; the **agent** is just a consumer of the output stream. This means commands inherit Notesage's sandbox, stream live, and surface as first-class permission requests.

Batch B (v0.36.0) shipped the *rendering* half — we recognize `ToolCallContent::Terminal` blocks and show a "not yet supported" placeholder. This PRD builds out the rest: advertise the capability, implement the five RPCs, render a live xterm.js widget in the placeholder's place.

## Goals

1. **Advertise `terminal` client capability** in the ACP `initialize` handshake so agents know they can delegate command execution to Notesage.
2. **Implement the five client-side RPCs** — `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release` — with correct spec semantics (output byte limit with truncate-from-start, char-boundary-safe).
3. **Inherit the spawning agent's sandbox profile** — commands run under the same Seatbelt writable paths, network deny, and HTTP proxy as their parent agent. No new sandbox surface.
4. **Per-command permission card** — every `terminal/create` surfaces a card with the full command + args + cwd. Tiered approval: Allow once / Allow for session / Allow always / Deny. Reuses the existing ACP tool-call permission infrastructure.
5. **Live-streaming xterm.js widget** — in the tool-call segment, replace the current "Terminal output (not yet supported)" placeholder with a real terminal emulator that streams output in real time.
6. **Clean up correctly** — terminals die on `terminal/release`, on session close, on agent exit, on app quit; users can cancel a running terminal from the UI.

## Non-Goals

- **Interactive terminals (stdin).** The ACP spec includes `terminal/create` only with an output channel. We don't accept user input mid-run. If the command needs input it should be handled via `expect`-style scripting inside the command itself.
- **Advertising `fs.readTextFile` / `fs.writeTextFile`.** Explicit won't-fix per the audit's SKIPPED decision. This PRD is terminal-only.
- **Always-on allowlist of "safe" commands.** We could let users pre-approve command patterns (e.g., `npm *`) to avoid prompting on every run — but that's a UX polish to defer until we see real friction. v1 is per-command prompting.
- **User-typed commands in the widget.** Users can read output and kill the process, not issue new commands to a running shell.
- **Reuse across sessions.** Each `terminal/create` spawns a fresh subprocess; terminals don't persist across sessions, app restarts, or agent respawns.
- **Windows/Linux parity in this batch.** macOS Seatbelt integration is the primary focus. The subprocess manager itself is cross-platform (`tokio::process::Command`), but the sandbox layer is macOS-specific today; Linux bubblewrap support can follow.

## User Stories

1. **As a user delegating a build to an agent**, I want to see `cargo build` output stream live in the chat so I know the command hasn't hung and can spot compile errors as they appear.
2. **As a user approving a terminal command**, I want to see the full command + args + working directory on the permission card so I can decide whether to run it — not just "Bash" as a label.
3. **As a user running untrusted agents**, I want commands the agent spawns to be subject to the same filesystem and network restrictions I've already configured for the agent itself, not some wider environment.
4. **As a user watching a stuck command**, I want to stop the command from the chat UI without waiting for the agent or restarting the app.

## Technical Approach

### ACP Wire-level recap

The Terminal capability lives in `ClientCapabilities.terminal: bool` advertised in the `initialize` response. When the agent sees this, it's allowed to call five RPCs **at any time during a session** (not just inside a tool call):

| RPC (agent → client) | Request fields | Response fields |
| --- | --- | --- |
| `terminal/create` | `sessionId`, `command`, `args[]`, `env[]`, `cwd?`, `outputByteLimit?` | `terminalId` |
| `terminal/output` | `sessionId`, `terminalId` | `{ output: string, exitStatus?: { exitCode, signal? }, truncated: bool }` |
| `terminal/wait_for_exit` | `sessionId`, `terminalId` | `{ exitCode, signal? }` |
| `terminal/kill` | `sessionId`, `terminalId` | `{}` |
| `terminal/release` | `sessionId`, `terminalId` | `{}` |

Agents can either (a) use the terminal inline inside a tool call and embed a `ToolCallContent::Terminal { terminalId }` block pointing to the live terminal, or (b) run terminals out-of-band as part of their own reasoning without surfacing them to the user. We render (a); (b) is agent-internal and the user doesn't see it unless the agent chooses to reference it.

### Subprocess manager (Rust backend)

A new module `src-tauri/src/commands/terminal_manager.rs` holds `TerminalManagerState`:

```rust
pub struct TerminalManagerState {
    terminals: Mutex<HashMap<String, TerminalHandle>>,
}

struct TerminalHandle {
    terminal_id: String,
    session_id: String,
    agent_instance_id: String,  // for cleanup-by-session
    child: Mutex<Option<tokio::process::Child>>,
    /// Ring buffer capped at output_byte_limit (truncate from start, char-boundary safe)
    output_buffer: Mutex<Vec<u8>>,
    output_byte_limit: usize,
    truncated: AtomicBool,
    exit_status: Mutex<Option<ExitStatus>>,
    /// Completed `wait_for_exit` notifier — channel for async waiters
    exit_notifier: Arc<Notify>,
    /// Readers polling `terminal/output` — channel for streaming to UI
    output_tx: broadcast::Sender<OutputChunk>,
}
```

Each terminal spawned via `terminal/create`:

1. Build `tokio::process::Command` with the agent's sandbox profile applied (see "Sandbox Integration" below).
2. Spawn the child. Track its PID.
3. Spawn two async tasks: one reading stdout → ring buffer + broadcast, one reading stderr → ring buffer + broadcast (merged).
4. Spawn a third async task that `child.wait().await` and populates `exit_status`, notifies `exit_notifier`.
5. Return the generated `terminalId` (UUID-based).

### Sandbox integration

**Key decision: inherit the spawning agent's Seatbelt profile.** The `sessionId` on the incoming `terminal/create` maps to the agent instance that owns it (via `AcpState`). We look up the agent's stored sandbox config (`sandbox_enabled`, `sandbox_writable_paths`, `network_proxy_config`, `kernel_network_deny`) and apply the same profile to the new subprocess:

- **Filesystem:** same writable paths (Seatbelt profile).
- **Network:** same HTTP proxy env vars (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`); same kernel-level network deny if enabled.
- **`cwd`:** the `CreateTerminalRequest.cwd` must be within the agent's writable paths. If not, return an error instead of spawning.
- **`env`:** the agent-supplied `env[]` is layered on top of the proxy env (proxy wins for network addresses).

This means a terminal command from a network-sandboxed agent can't make outbound connections to arbitrary hosts, a filesystem-sandboxed agent's command can't write outside its writable paths, etc. **No new sandbox surface — we reuse the existing infrastructure.**

### Permission flow

Every `terminal/create` fires through the existing ACP permission machinery:

1. Agent calls `terminal/create { command, args, cwd, env }`.
2. Backend pauses the request, emits a new Tauri event `terminal-create-permission-request` with the command, args, cwd, session ID.
3. Frontend's `permission-store` adds a new request type (`TerminalPermissionRequest`) to its queue. The existing `PermissionCard` shell renders a new card variant showing:

   ```
   ┌────────────────────────────────────────────────┐
   │ 🖥  Agent wants to run a command               │
   │                                                 │
   │ $ npm test -- --coverage                       │
   │ cwd: /Users/me/project                         │
   │                                                 │
   │ env: NODE_ENV=test (+2 more)                   │
   │ sandbox: inherits Claude Code profile           │
   │                                                 │
   │ [Allow once] [Allow for session] [Always] [Deny]│
   └────────────────────────────────────────────────┘
   ```

4. User picks an option. Permission store notifies backend, which either spawns the child (success returned to agent) or returns an error to the agent.
5. Approvals: "session" matches by command prefix (e.g., `npm *`); "always" is persisted per-connection with the same command-prefix rule. Denies are not remembered — next time the agent asks, the user sees the card again.

30-second auto-deny timeout matches the existing domain approval flow.

### Live-streaming UI

The current `ToolCallSegmentView` "Terminal output (not yet supported)" placeholder is replaced with a `TerminalSegmentView` component keyed by the `terminalId`:

- On mount, the view opens a Tauri event listener for `terminal-output:<terminalId>` (broadcast from the backend task reading stdout/stderr).
- Renders an **xterm.js** instance (new dependency). Each incoming chunk is written via `terminal.write()` — preserves ANSI colors, cursor moves, carriage returns.
- Header bar shows the command + live/exited status + a Stop button (only while running).
- Stop button calls `terminal_kill(sessionId, terminalId)`. On exit, the status label flips to `exited (code 0)` / `killed (SIGTERM)`.
- Container has a max height (e.g. 300px) with vertical scroll; output stays in place once the command exits.
- Scrollback is limited to whatever the backend buffer holds (default 1 MB, consistent with `outputByteLimit`).

### Cleanup lifecycle

Per the answers locked in before drafting:

| Trigger | What happens |
| --- | --- |
| Agent calls `terminal/release` | Required by spec. Kill if still running, drop buffer, remove from map. |
| Session closes (`session/close`, conversation delete, agent exit) | Backend kills all terminals with matching `session_id`. |
| App quit (`RunEvent::Exit`) | `TerminalManagerState::stop_all_sync()` — same pattern as `AcpState`. Kill all children, wait briefly, then SIGKILL. |
| User clicks Stop in the UI | `terminal_kill` command. SIGTERM first, SIGKILL after a short grace period if the process doesn't exit. |

Cleanup is idempotent — calling release/kill on a terminated terminal is a no-op.

### Affected paths

| Path | Change |
| --- | --- |
| `initialize` handshake | Advertise `terminal: true` in `ClientCapabilities`. |
| ACP client trait impl (`acp_client.rs`) | New handlers for the five RPCs, routed to `TerminalManagerState`. |
| New module `terminal_manager.rs` | Subprocess lifecycle + output buffering + broadcast channels. |
| `network_proxy.rs` / `sandbox.rs` | Reuse as-is — no changes, just new callers. |
| `permission-store.ts` | New request variant `terminal-create`. |
| `PermissionCard.tsx` | New render branch for terminal commands. |
| `ToolCallSegmentView.tsx` + `ActivityTaskCard.tsx` | Replace placeholder with `TerminalSegmentView` for `type: 'terminal'` content items. |
| New component `TerminalSegmentView.tsx` | xterm.js widget, live stream, Stop button. |
| `package.json` | Add `xterm` + `xterm-addon-fit` (or similar). |

## UI/UX

### Permission card variants

Two distinct card variants already exist (tool call, domain). Add a third for terminal:

```
Icon: Terminal (lucide Square icon)
Title: "Agent wants to run a command"
Body:
  <monospace block showing: $ command args>
  cwd: <path>
  env overrides: 3 variables (click to expand)
  sandbox: inherits <agent-name> profile

Buttons (4-tier):
  [Allow once] [Allow for session] [Allow always] [Deny]
```

"Allow for session" and "Allow always" store a command-prefix rule (first token, e.g. `npm` or `cargo`). Later commands matching the prefix skip the card.

### Terminal widget (`TerminalSegmentView`)

```
┌─────────────────────────────────────────────┐
│ $ cargo test                    ● running   │  <- header bar, kill button on the right
│ ─────────────────────────────────────────── │
│ test cargo_test_1 ... ok                    │
│ test cargo_test_2 ... FAILED                │  <- xterm.js content area, scrollable
│                                             │
│     (scrolling output...)                   │
│                                             │
└─────────────────────────────────────────────┘

After exit:
┌─────────────────────────────────────────────┐
│ $ cargo test              exited (code 1)   │
│ ...                                         │
└─────────────────────────────────────────────┘
```

- Header row: command + status badge + Stop button (while running).
- Output area: xterm.js, with scrollback. Auto-scrolls to bottom while streaming unless the user has scrolled up.
- Collapsible: clicking the header collapses/expands the output area, same pattern as `ToolResultSegmentView`.

### Settings

No new settings in v1. The permission flow replaces the need for toggles. Command-prefix allowlists live in the existing `permission-store` (same shape as the current tool-call permissions).

## Data Model

```typescript
// src/lib/ai/acp-utils.ts
export interface AcpTerminalOutputEvent {
  terminal_id: string;
  session_id: string;
  chunk: string;      // raw bytes as UTF-8 (best-effort; invalid seqs replaced)
  /** True if the ring buffer has wrapped and early output was dropped. */
  truncated: boolean;
}

// src/stores/permission-store.ts
export interface TerminalPermissionRequest {
  id: string;
  kind: 'terminal-create';
  instanceId: string;
  sessionId: string;
  requestId: string;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  /** Name/label of the spawning agent for display. */
  agentLabel: string;
  /** Summary of the inherited sandbox profile. */
  sandboxDescription: string;
  timestamp: number;
}
```

```rust
// src-tauri/src/commands/terminal_manager.rs
pub struct CreateTerminalRequest {
    pub session_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
    pub output_byte_limit: Option<usize>,
}

pub struct CreateTerminalResponse {
    pub terminal_id: String,
}

pub struct TerminalOutputResponse {
    pub output: String,
    pub exit_status: Option<TerminalExitStatus>,
    pub truncated: bool,
}

pub struct TerminalExitStatus {
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
}
```

Tauri commands exposed to the frontend (for the UI's own polling/cancellation):

- `terminal_output(session_id, terminal_id) -> TerminalOutputResponse`
- `terminal_kill(session_id, terminal_id) -> ()`

The ACP-side handlers (`terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/release`, `terminal/kill`) are inbound RPC handlers on the ACP client trait, not Tauri commands — they run in response to agent requests.

## Dependencies

- **New npm package:** `xterm` (core) + `xterm-addon-fit` (auto-resize). No other frontend deps expected.
- **No new Rust crates** — `tokio::process::Command` + existing `network_proxy` + `sandbox` modules cover the backend.
- **No new Tauri plugins.**

## Quality Gates

- [ ] `ClientCapabilities.terminal: true` is advertised in the `initialize` handshake.
- [ ] All five RPCs implemented with spec-compliant semantics (byte limit truncation is char-boundary-safe; `truncated` flag set correctly).
- [ ] Commands run under the same Seatbelt profile as the spawning agent (filesystem + network + proxy).
- [ ] `cwd` validation — `terminal/create` rejects a cwd outside the agent's writable paths.
- [ ] Permission card renders before any subprocess spawn; Deny prevents the spawn.
- [ ] Session/session-always approval tiers work with command-prefix matching.
- [ ] Denied / timed-out / cancelled terminals return the correct error to the agent.
- [ ] xterm.js widget streams output in real time; ANSI colors and cursor moves render.
- [ ] Stop button sends SIGTERM then SIGKILL after a grace period.
- [ ] Terminals die on: `terminal/release` (spec), session close, agent exit, app quit.
- [ ] Rust unit tests for the subprocess manager (spawn, truncate, wait, kill, release).
- [ ] Frontend unit tests for `TerminalSegmentView` (mounts, streams mock output, Stop button).
- [ ] Integration test (manual): run a long command (`sleep 10 && echo done`) via Claude Code with sandbox enabled; verify it respects the sandbox, shows streaming output, and can be killed.
- [ ] Security review before merging.

## Security Considerations

This is the most security-sensitive batch in the ACP work so far. Key threats and mitigations:

| Threat | Mitigation |
| --- | --- |
| Agent runs a command outside the sandbox | Sandbox profile is inherited from the agent's ACP spawn config; `cwd` validated against writable paths. |
| Command bypasses network restrictions | Proxy env vars (`HTTP_PROXY`, etc.) and kernel-level network deny both inherited. |
| User misses a dangerous command in the prompt | Permission card shows the full command + args + cwd (no truncation). Only the env block is collapsible (can be long). |
| Runaway process outlives its agent | Session-close cleanup kills all its terminals; app-quit cleanup is a hard backstop. |
| Output buffer fills memory | `output_byte_limit` enforced with truncate-from-start; default 1 MB, agent can request lower. |
| Signal-induced state corruption on kill | SIGTERM first with grace period; SIGKILL only if SIGTERM doesn't take. Release is idempotent. |
| Command exfiltrates sensitive env vars | Agent-supplied `env[]` is layered on top of the proxy env — proxy wins. Notesage doesn't forward its own process env (API keys, credentials) to the subprocess. |

**Explicit gate:** Merging this PRD requires a security review pass. The attack surface is wide enough that a checklist isn't enough — a pair of eyes looking at how the Seatbelt profile is applied, how the permission flow protects against TOCTOU, and how the env merge works is warranted.

## Out of Scope

- Interactive stdin (user types into the terminal)
- Command-pattern pre-approval UI ("allow all `npm *` without prompting")
- Cross-session terminal reuse or persistence
- Windows / Linux sandbox integration (subprocess itself works everywhere; sandbox is macOS-only in v1)
- `fs.readTextFile` / `fs.writeTextFile` client capabilities (won't fix per audit SKIPPED decision)
- Terminal emulator features beyond xterm.js defaults (custom themes, keybindings, etc.)
