# Sandcastle Repository Analysis

**Date:** 2026-04-13
**Repository:** [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle) (`@ai-hero/sandcastle` v0.4.2, 581 stars)
**Purpose:** Evaluate relevance to Notesage's sandboxing, agent orchestration, and isolation features.

## What Is Sandcastle?

Sandcastle is a TypeScript CLI/library for **batch-orchestrating AI coding agents in isolated Docker containers**. Its core flow:

1. Creates a git worktree for the agent to work in
2. Spawns an isolated sandbox (Docker container, Podman container, Vercel microVM, or Daytona cloud VM)
3. Runs a coding agent (Claude Code, Codex, Pi, OpenCode) inside the sandbox with `--dangerously-skip-permissions`
4. Collects commits and merges them back to the host repository
5. Cleans up the sandbox

Primary use case: take a backlog of issues, spawn N agents in N containers on separate worktrees, merge commits back.

## Architecture

| Layer | Technology |
|---|---|
| Language | TypeScript (ES modules) + Effect library |
| Runtime | Node.js 22 |
| Container engine | Docker, Podman (local); Vercel Firecracker, Daytona (cloud) |
| Version control | Git worktrees for branch isolation |
| Agents | CLI wrappers for `claude --print`, `codex exec`, `pi -p`, `opencode run` |

### Sandbox Providers

**Two provider types:**

1. **Bind-mount** (Docker, Podman): Host git worktree mounted directly into container. Supports `head` (direct writes), `merge-to-head` (temp branch + auto-merge), and `named` branch strategies.
2. **Isolated** (Vercel, Daytona): Independent filesystem with `copyIn`/`copyOut` file transfer. Git state transferred via `git bundle create --all`. Only supports `merge-to-head` and `named` strategies.

### Key Components

- **SandboxProvider interface**: Pluggable abstraction for sandbox runtimes with `exec()`, optional `copyIn()`/`copyFileOut()`
- **AgentProvider interface**: CLI wrappers that build shell commands and parse streaming JSON output
- **WorktreeManager**: Git worktrees in `.sandcastle/worktrees/` with timestamped temp branches, stale pruning
- **Orchestrator**: Multi-iteration loops with idle timeouts (default 600s), completion signals (`<promise>COMPLETE</promise>`), streaming output parsing
- **SandboxLifecycle**: Captures git identity, marks repos as safe, runs `onSandboxReady` hooks, collects post-work commits

### Docker Implementation Details

- Container runs with `sleep infinity` entrypoint; commands executed via `docker exec`
- Non-root `agent` user with UID/GID mapping from host
- Signal handlers (SIGINT/SIGTERM) trigger `docker rm -f` cleanup
- `chownInContainer` fixes ownership for macOS VirtioFS read-only issues
- Volume mounts with read-only flag support
- No network isolation, no resource limits by default

### Podman Differences

- Rootless by default (no daemon)
- SELinux labeling support (`z`=shared, `Z`=private per container)

## Comparison with Notesage

### Where Notesage Is Already Ahead

| Dimension | Sandcastle | Notesage |
|---|---|---|
| **Network sandboxing** | None. Docker containers get full internet access. | Two-layer: kernel-enforced Seatbelt deny + HTTP proxy with per-domain allowlists + approval UI + 30s auto-deny |
| **Permission model** | None. `--dangerously-skip-permissions` flags everywhere. | Tiered per-tool-call approval: once / session / always |
| **Violation monitoring** | None | Seatbelt log stream to Activity panel, dedup, rate limiting |
| **Credential security** | `.sandcastle/.env` plaintext | OS keychain (macOS Keychain via `keyring` crate), keys never in IPC |
| **Error recovery** | Fail-fast, process exits | AgentStatusBanner with Wait/Retry/Cancel + ACP session restoration |
| **Agent integration** | CLI wrapper shelling out, parsing stdout | ACP protocol (native), Copilot LSP (JSON-RPC), direct API |
| **Interactive UX** | CLI output rendering | Real-time chat panel with segments, tool call cards, domain approval cards |

### What's Novel in Sandcastle

| Feature | Description | Relevance to Notesage |
|---|---|---|
| **Git worktree branching** | Each agent gets its own worktree + temp branch. Work is isolated; commits merged back atomically or discarded. | **High.** Could extend existing `diff-review-store` into a first-class agent workflow. No Docker needed — pure git operations in Rust. |
| **Completion signals** | `<promise>COMPLETE</promise>` pattern for early termination of multi-iteration loops. | **Medium.** Useful if Notesage adds autonomous multi-step agent workflows or skill script loops. |
| **Pluggable sandbox provider interface** | `BindMountSandboxProvider` vs `IsolatedSandboxProvider` abstraction. | **Medium.** Pattern for unifying macOS Seatbelt + Linux Bubblewrap behind a common Rust trait. |
| **Multi-agent parallelism** | N agents on N worktrees, auto-merge back. | **Low-Medium.** Relevant only if Notesage supports parallel agent tasks (e.g., delegate 5 comments simultaneously). |
| **Reusable sandboxes** | `createSandbox()` for multiple sequential runs without container restart overhead. | **Low.** Notesage already has ACP session persistence. |
| **Vercel Firecracker microVMs** | Hardware-level isolation via hypervisor, sub-second boot. | **Low.** Interesting but requires cloud infrastructure; contradicts local-first philosophy. |

### What Doesn't Fit Notesage

- **Docker as a dependency**: Contradicts "zero external dependency" and "lightweight Tauri app" philosophy. Note-taking users shouldn't need Docker Desktop.
- **Batch orchestration model**: Designed for CI pipelines and automation, not interactive desktop editing.
- **Permissionless execution**: Entire security model is "the container is the sandbox." Notesage needs granular, user-visible permission control.
- **TypeScript runtime**: Notesage's sandbox code is Rust. Nothing is directly portable at the code level.
- **No network filtering**: Docker provider has no `--network none` or domain filtering. A significant gap compared to Notesage's proxy + kernel enforcement.

## Actionable Ideas

### 1. Git Worktree Isolation for Agent Tasks (Recommended)

**Concept:** When an agent task modifies files in a git-tracked project, automatically:

1. Create a temporary git branch (`notesage/agent-task/<timestamp>`)
2. Agent operates on a worktree (no risk to working files)
3. User reviews changes via the existing diff review UI (`diff-review-store`)
4. Accept = merge to working branch; Reject = delete temp branch

**Benefits:**
- Atomic accept/reject of agent work (not per-file, per-branch)
- No risk to working files during agent operation
- Plays to existing strengths: git integration, diff review UI, agent task system
- No external dependencies (pure git operations in Rust)
- Natural extension of comment delegation workflow

**Implementation notes:**
- Use `git worktree add -b <branch> <path> HEAD` (already familiar Rust git operations in `git.rs`)
- Worktrees stored in `.notesage/worktrees/` (gitignored)
- Cleanup stale worktrees on startup
- Only applicable when project is a git repo; fallback to current behavior otherwise

### 2. Completion Signal Protocol (Low Priority)

Add support for skill scripts to emit a structured completion signal (e.g., `__NOTESAGE_COMPLETE__`) for early termination of multi-step loops. Currently not needed since skill scripts are single-execution, but could be useful if autonomous workflows are added later.

### 3. Sandbox Provider Trait (When Needed)

When Linux sandbox support is hardened (Bubblewrap/Landlock), consider a unified `SandboxProvider` Rust trait:

```rust
trait SandboxProvider {
    fn create_profile(&self, config: &SandboxConfig) -> Result<SandboxProfile>;
    fn apply(&self, child: &mut Command, profile: &SandboxProfile) -> Result<()>;
    fn monitor(&self, pid: u32) -> Option<ViolationStream>;
}
```

This would abstract the macOS Seatbelt vs Linux Bubblewrap differences behind a common interface.

## References

- [Sandcastle GitHub](https://github.com/mattpocock/sandcastle)
- [Docker Sandboxes blog post](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/)
- Notesage sandbox implementation: `src-tauri/src/commands/sandbox.rs`, `network_proxy.rs`, `sandbox_monitor.rs`
- Notesage sandbox research: `docs/research/sandbox-runtime-comparison.md`
- Notesage sandbox PRDs: `docs/prds/2026-02-25-network-sandboxing.md`, `docs/prds/2026-03-07-sandbox-hardening-macos.md`
