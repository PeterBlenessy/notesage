# Agent Binary Management & Runtime Sandboxing

**Date:** 2026-02-21 (revised 2026-03-17) **Status:** ✅ Complete **Parent:** AI Provider Architecture v2

## Problem

When users add a subscription-based AI connection (Claude Code, Codex, Copilot, Gemini), the app checks if the agent binary is installed. If not found, it shows step-by-step guidance to install via npm in a terminal. This has several problems:

1. **Requires Node.js/npm** — non-developer users don't have these installed and shouldn't need them
2. **Global system pollution** — `npm install -g` modifies the user's global environment
3. **ACP wrappers are niche** — `claude-agent-acp` and `codex-acp` are Zed-maintained packages that regular Claude Code or Codex users won't have installed. Notesage must take ownership of these.
4. **No runtime isolation** — agent subprocesses run with full system access. ACP permissions are advisory (the agent *chooses* to ask), not enforced. A compromised or prompt-injected agent could read `~/.ssh/id_rsa` or exfiltrate data without any tool call.
5. **No update mechanism** — users must manually check for and install updates

## Goals

- Zero-dependency agent installation from within the app (no Node.js/npm required for 4 of 5 agents)
- Prefer user-installed system binaries when available — only offer managed install when binary is not found
- Isolated installation to `~/.notesage/agents/` — never modify the user's global system
- OS-level runtime sandboxing for managed installs (filesystem + network restrictions)
- Automatic update checking with user-initiated updates
- Manual install path always available as fallback

## Non-Goals

- Sandboxing user-installed system binaries by default (opt-in only)
- Running commands with sudo/elevated privileges from the app
- Bundling agent binaries inside the app package (download on demand)
- Building our own ACP adapters (we use Zed's packages)

## User Stories

- As a user with no developer tools installed, I want to click "Install" and have the agent ready to use without leaving the app or installing Node.js.
- As a user who already has Copilot CLI installed, I want Notesage to find and use my existing installation without offering to re-install.
- As a user, I want managed agent installs to be sandboxed so agents can only access my project files, not my SSH keys or AWS credentials.
- As a user, I want to know when agent updates are available and update with one click.
- As a user, I want to choose whether to use my system-installed agent or a Notesage-managed sandboxed copy, if both are available.

## Background: Agent Binary Landscape

### ACP Protocol

The Agent Client Protocol (ACP) is an open standard by Zed Industries for editor-agent communication over JSON-RPC/stdio. Some CLIs implement ACP natively; others need a separate ACP adapter.

### Binary Relationships

| Agent | Main CLI | ACP binary | Relationship | User likely has it? |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | `claude-agent-acp` | **Separate** — Zed-maintained adapter wrapping Claude Agent SDK | Has `claude`, not `claude-agent-acp` |
| Codex | `codex` | `codex-acp` | **Separate** — Zed-maintained adapter | Has `codex`, not `codex-acp` |
| Copilot | `copilot` | `copilot --acp` | **Same binary** — ACP is native | Possibly |
| Gemini | `gemini` | `gemini --acp` | **Same binary** — ACP is native (may require `--experimental-acp`) | Possibly |
| Copilot LSP | `copilot-language-server` | N/A | LSP protocol, not ACP | Unlikely |

### Dependency Analysis

| Binary | What npm installs | Runtime needs Node.js? | Native deps? | Install size |
| --- | --- | --- | --- | --- |
| `claude-agent-acp` | JS wrapper + Claude Agent SDK | Yes (&gt;= 18) | No | \~80-90 MB |
| `codex-acp` | JS wrapper → pre-built Rust binary | No | No | \~76-80 MB |
| `copilot` | JS wrapper → pre-built native binary | No | No | \~230-240 MB |
| `gemini` | Full JS application with 40+ deps | **Yes (&gt;= 20)** | Optional (keytar, node-pty) | \~80-150 MB |
| `copilot-language-server` | JS dist + pre-built native binary | No | No | \~155-160 MB |

**Key insight:** 4 of 5 agents distribute pre-built native binaries via npm — npm is just the delivery mechanism. These binaries are also available directly from GitHub Releases without needing Node.js. Only Gemini CLI genuinely requires a Node.js runtime.

## Technical Approach

### Phase 1: Managed Installation & Filesystem Sandboxing

#### Binary Resolution (updated)

The resolution order when connecting an agent:

1. Check `~/.notesage/agents/bin/` (managed install)
2. Check system PATH (user install)
3. Check common paths: `/opt/homebrew/bin/`, `/usr/local/bin/`, `~/.nvm/versions/node/*/bin/`

Result includes both the path and the **source** (`managed` | `system`), which determines default sandbox policy.

**Decision logic:**

```
Binary found on system?
  YES → Use system binary (no sandbox by default, proceed to auth)
  NO  → Offer managed install (sandbox by default)
```

If both managed and system binaries exist, prefer the system binary. The user can switch in connection settings.

#### Installation Strategy

**For native-binary agents** (claude-agent-acp, codex-acp, copilot, copilot-language-server):

1. Query GitHub Releases API for latest version + platform-specific asset URL
2. Download binary archive with progress events
3. Verify checksum (SHA-256 from release manifest)
4. Extract to `~/.notesage/agents/bin/`
5. Set executable permissions (`chmod +x`)
6. Record version in `~/.notesage/agents/versions.json`

**For Gemini CLI** (requires Node.js runtime):

1. Check if portable Node.js already exists at `~/.notesage/runtime/node/`
2. If not, download Node.js standalone binary for the user's platform to `~/.notesage/runtime/node/`
3. Run `~/.notesage/runtime/node/bin/npm install --prefix ~/.notesage/agents/lib/ @google/gemini-cli`
4. Symlink `~/.notesage/agents/bin/gemini` → `../lib/node_modules/.bin/gemini`
5. Record version in `~/.notesage/agents/versions.json`

#### GitHub Release Resolution

Each agent maps to a GitHub repository for binary downloads:

| Agent | GitHub repo | Asset naming pattern | Archive format |
| --- | --- | --- | --- |
| `claude-agent-acp` | `zed-industries/claude-agent-acp` | `claude-agent-acp-{os}-{arch}` | `.zip` (macOS/Win), `.tar.gz` (Linux) |
| `codex-acp` | `zed-industries/codex-acp` | `codex-acp-{version}-{rust-triple}` (e.g., `aarch64-apple-darwin`) | `.tar.gz` (macOS/Linux), `.zip` (Win) |
| `copilot` | `github/copilot-cli` | `copilot-{os}-{arch}` (uses `win32` not `windows`) | `.tar.gz` (macOS/Linux), `.zip` (Win) |
| `copilot-language-server` | `github/copilot-language-server-release` | `copilot-language-server-{os}-{arch}-{version}` (no `v` prefix on tag) | `.zip` |

Platform detection maps to: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.

**Fallback:** If GitHub Releases are unavailable or the asset naming doesn't match, fall back to npm-based install using the portable Node.js runtime.

#### Filesystem Sandboxing

Managed agent binaries run inside an OS-level filesystem sandbox by default. System-installed binaries run unsandboxed by default, with opt-in sandboxing available.

**macOS — Seatbelt (**`sandbox-exec`**):**

Agents are spawned via `sandbox-exec -f <profile.sb> <agent_binary> <args>`. A dynamically generated `.sb` profile enforces:

```scheme
(version 1)
(deny default)

;; Allow reading system files (agents need system binaries, libs)
(allow file-read*)

;; Allow writing only to project directory and temp
(allow file-write*
  (subpath "<PROJECT_DIR>")
  (subpath "/tmp")
  (subpath "/private/tmp"))

;; ALWAYS deny reading sensitive files (non-configurable)
(deny file-read*
  (subpath "<HOME>/.ssh")
  (subpath "<HOME>/.aws")
  (subpath "<HOME>/.gnupg")
  (subpath "<HOME>/.config/gcloud")
  (regex #"\.env$")
  (regex #"\.env\..*$"))

;; Protect .git internals from writes (read-only access)
(deny file-write*
  (regex #".*\/\.git($|\/.*)"))

;; Allow network (Phase 1 — unrestricted; Phase 2 adds proxy filtering)
(allow network*)

;; Allow process execution (agents spawn git, grep, etc.)
(allow process-exec*)
(allow process-fork)

;; Allow standard IPC and system info
(allow sysctl-read)
(allow mach-lookup)
```

Seatbelt is officially deprecated by Apple but remains fully functional. Chrome, Firefox, Nix, Claude Code, Codex, and Cursor all use it. Restrictions inherit to all child processes. No admin privileges required. Near-zero performance overhead.

**Linux — Bubblewrap + Landlock:**

Agents are spawned via `bwrap` with restricted mount namespace:

```bash
bwrap \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --ro-bind /lib64 /lib64 \
  --ro-bind /bin /bin \
  --ro-bind /etc/resolv.conf /etc/resolv.conf \
  --bind <PROJECT_DIR> <PROJECT_DIR> \
  --bind /tmp /tmp \
  --dev /dev \
  --proc /proc \
  -- <agent_binary> <agent_args>
```

Additionally, the `landlock` Rust crate can restrict filesystem access at the kernel level (Linux 5.13+) without requiring `bwrap` to be installed.

**Spawn code change in** `acp.rs`**:**

The existing spawn code wraps with the platform-appropriate sandbox:

```rust
// Current: direct spawn
let mut cmd = tokio::process::Command::new(&agent_binary);

// New: conditional sandbox wrapping
let mut cmd = if sandbox_enabled {
    #[cfg(target_os = "macos")]
    {
        let profile_path = generate_seatbelt_profile(&working_directory, &sandbox_config)?;
        let mut c = tokio::process::Command::new("sandbox-exec");
        c.arg("-f").arg(&profile_path).arg(&agent_binary);
        c
    }
    #[cfg(target_os = "linux")]
    {
        let mut c = tokio::process::Command::new("bwrap");
        c.args(build_bwrap_args(&working_directory, &sandbox_config));
        c.arg("--").arg(&agent_binary);
        c
    }
} else {
    tokio::process::Command::new(&agent_binary)
};
cmd.args(&agent_args)
    .current_dir(&working_directory)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .kill_on_drop(true);
```

#### Update Checking

**Automatic check (background, non-intrusive):**

1. On app launch, and every 24 hours while running, check for updates to managed agents
2. For GitHub Release agents: query the Releases API, compare latest tag against `versions.json`
3. For Gemini CLI (npm): query npm registry for latest version, compare against installed
4. Store last check timestamp in `versions.json` to avoid excessive API calls
5. If update available: set a flag in `agent-store` — UI shows an update badge

**User-initiated check:**

- Settings → Connections → per-connection "Check for updates" action
- Settings → Connections → "Check all for updates" header action

**Update indicator:**

- Connection card shows an update badge (e.g., "v1.2.3 → v1.3.0 available") when an update is found
- Status bar or title bar indicator when any managed agent has an update available
- Non-intrusive — never auto-updates, never blocks agent usage

**Update flow:**

1. User clicks "Update" on the connection card
2. Same download flow as initial install (progress bar, checksum verification)
3. If agent is currently running: prompt to restart ("Update requires restarting the agent. Restart now?")
4. On confirmation: stop agent process, replace binary, restart agent
5. Update `versions.json` with new version
6. Toast: "Claude Code ACP updated to v1.3.0"

**Version tracking file** (`~/.notesage/agents/versions.json`):

```json
{
  "lastChecked": "2026-03-01T12:00:00Z",
  "agents": {
    "claude-agent-acp": {
      "version": "1.2.3",
      "installedAt": "2026-03-01T10:00:00Z",
      "source": "github-release",
      "repo": "zed-industries/claude-agent-acp"
    },
    "codex-acp": {
      "version": "0.5.1",
      "installedAt": "2026-03-01T10:05:00Z",
      "source": "github-release",
      "repo": "zed-industries/codex-acp"
    },
    "gemini": {
      "version": "1.0.0",
      "installedAt": "2026-03-01T10:10:00Z",
      "source": "npm",
      "package": "@google/gemini-cli"
    }
  }
}
```

### Phase 2: Network Sandboxing (Proxy-based)

This phase adds per-domain network filtering, following the architecture used by Claude Code, Codex, and Cursor.

#### Architecture

1. Sandbox profile blocks all direct network access: `(deny network*)` on macOS, `--unshare-net` on Linux
2. A lightweight HTTP+SOCKS5 proxy runs **outside** the sandbox, inside the Notesage Tauri process
3. The proxy is exposed to the sandbox via a **Unix domain socket** (the only allowed IPC channel)
4. The proxy enforces a per-agent domain allowlist

```
Agent process (sandboxed)
  → cannot reach network directly
  → connects to Unix socket at /tmp/notesage-proxy-<id>.sock
  → proxy runs outside sandbox with full network access
  → proxy checks domain against allowlist
  → allowed: forward traffic
  → unknown: emit prompt to Notesage UI, wait for user decision
```

#### Per-Agent Domain Allowlists

| Agent | Required domains |
| --- | --- |
| `claude-agent-acp` | `api.anthropic.com`, `sentry.io` |
| `codex-acp` | `api.openai.com` |
| `copilot` | `api.github.com`, `copilot-proxy.githubusercontent.com` |
| `gemini` | `generativelanguage.googleapis.com` |
| Common (all agents) | `github.com` (git operations) |

Unknown domain requests trigger a user confirmation prompt, following the same tiered pattern as ACP tool permissions (allow once / allow for session / allow always).

#### Reference Implementation

Anthropic open-sourced their sandbox as `@anthropic-ai/sandbox-runtime`. This can serve as a reference for Seatbelt profile generation and proxy architecture.

### Phase 3: User-Configurable Policies

Settings UI for customizing sandbox behavior per connection:

- Sandbox toggle (default: on for managed, off for system)
- Additional writable paths (e.g., allow agent to write to a shared resources directory)
- Additional denied paths
- Custom allowed domains (for agents that need to reach internal services)

## Data Model

### Frontend Types

```typescript
// Updated ProviderOption — replaces installInfo with richer metadata
interface AgentInstallMeta {
  /** GitHub repo for binary downloads (owner/repo) */
  githubRepo?: string;
  /** npm package name (for Gemini CLI fallback and npm-based agents) */
  npmPackage?: string;
  /** Manual install command for guidance fallback */
  manualCommand: string;
  /** Documentation URL */
  docsUrl?: string;
  /** Whether this agent requires a Node.js runtime */
  requiresNodeRuntime?: boolean;
  /** Required network domains when sandboxed */
  allowedDomains: string[];
}

interface ProviderOption {
  // ... existing fields ...
  installMeta?: AgentInstallMeta;  // For agent_managed providers
}

// Binary resolution result
interface BinaryResolution {
  path: string;
  source: 'managed' | 'system';
  version?: string;
}

// Connection extended with source tracking
interface Connection {
  // ... existing fields ...
  binarySource?: 'managed' | 'system';
  sandboxEnabled?: boolean;
}
```

### Rust Types

```rust
/// Result of binary resolution
#[derive(Serialize, Deserialize)]
pub struct BinaryResolution {
    pub path: String,
    pub source: BinarySource,
    pub version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BinarySource {
    Managed,
    System,
}

/// Sandbox configuration for an agent spawn
pub struct SandboxConfig {
    pub enabled: bool,
    pub writable_paths: Vec<PathBuf>,
    pub denied_read_paths: Vec<PathBuf>,
    pub allowed_domains: Vec<String>,  // Phase 2
}
```

### Tauri Event Payloads

```typescript
// agent-install-progress — download/extraction progress
{ agent_id: string; phase: 'downloading' | 'verifying' | 'extracting' | 'configuring';
  progress: number; total: number; message: string }

// agent-install-done — installation complete or failed
{ agent_id: string; success: boolean; version?: string; error?: string }

// agent-update-available — background update check result
{ agent_id: string; current_version: string; latest_version: string }
```

### Tauri Commands (new)

```rust
/// Resolve an agent binary — checks managed dir, then system PATH
#[tauri::command]
async fn agent_resolve_binary(agent_id: String) -> Result<BinaryResolution, String>

/// Install an agent binary to ~/.notesage/agents/
#[tauri::command]
async fn agent_install(app: AppHandle, agent_id: String) -> Result<(), String>

/// Uninstall a managed agent binary
#[tauri::command]
async fn agent_uninstall(agent_id: String) -> Result<(), String>

/// Check for updates to managed agents
#[tauri::command]
async fn agent_check_updates(app: AppHandle) -> Result<Vec<AgentUpdateInfo>, String>

/// Update a managed agent to latest version
#[tauri::command]
async fn agent_update(app: AppHandle, agent_id: String) -> Result<(), String>

/// Download portable Node.js runtime (for Gemini CLI)
#[tauri::command]
async fn agent_install_node_runtime(app: AppHandle) -> Result<(), String>
```

### Filesystem Layout

```
~/.notesage/
├── agents/
│   ├── bin/                        # Managed agent binaries
│   │   ├── claude-agent-acp        # Downloaded from GitHub Releases
│   │   ├── codex-acp               # Downloaded from GitHub Releases
│   │   ├── copilot                 # Downloaded from GitHub Releases
│   │   ├── copilot-language-server # Downloaded from GitHub Releases
│   │   └── gemini                  # Symlink → ../lib/node_modules/.bin/gemini
│   ├── lib/                        # npm prefix for Gemini CLI
│   │   └── node_modules/           # Gemini CLI + deps
│   └── versions.json               # Installed versions + update tracking
├── runtime/
│   └── node/                       # Portable Node.js (only if Gemini needed)
│       ├── bin/node
│       └── bin/npm
└── sandbox/
    └── profiles/                   # Generated Seatbelt profiles (macOS)
        └── *.sb
```

## Architecture

### Installation Flow

```
User clicks "Add Connection" → pick provider
     │
     ▼
┌─────────────────────────────────────────┐
│ Binary resolution                        │
│  1. ~/.notesage/agents/bin/ (managed)   │
│  2. System PATH (user-installed)         │
│  3. Common paths (/opt/homebrew/bin/...) │
└──────────┬──────────────┬───────────────┘
           │              │
    ┌──────▼──────┐  ┌───▼──────────────┐
    │ FOUND on    │  │ NOT FOUND         │
    │ system      │  │                   │
    └──────┬──────┘  └───┬──────────────┘
           │              │
           ▼              ▼
    Use system        ┌─────────────────────────────────────────┐
    binary as-is      │ Offer managed install                    │
    (no sandbox       │                                          │
     by default)      │ For native-binary agents:                │
           │          │   Download pre-built binary from          │
           │          │   GitHub Releases → ~/.notesage/agents/   │
           │          │                                          │
           │          │ For Gemini CLI (needs Node.js):           │
           │          │   1. Download portable Node.js →           │
           │          │      ~/.notesage/runtime/node/             │
           │          │   2. npm install --prefix                  │
           │          │      ~/.notesage/agents/lib/               │
           │          │                                          │
           │          │ Result: binary in ~/.notesage/agents/bin/ │
           │          │         (sandboxed by default)            │
           │          └──────────────────────┬──────────────────┘
           │                                 │
           ▼                                 ▼
    ┌──────────────────────────────────────────────┐
    │              Proceed to AUTH phase             │
    │  (ACP authenticate / OAuth device flow)       │
    └──────────────────────────────────────────────┘
```

### Runtime Communication & Sandboxing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              NOTESAGE APP                                   │
│                                                                             │
│  ┌───────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ Chat Panel │  │ Bubble Menu│  │ Comment    │  │ Editor (Ghost Text)    │ │
│  │(interactive│  │(interactive│  │ Delegation │  │ (inline_completion)    │ │
│  │ slot)      │  │ slot)      │  │(agent_tasks│  │                        │ │
│  └─────┬──────┘  └─────┬──────┘  │ slot)      │  └──────────┬─────────────┘ │
│        └────────┬──────┘         └─────┬──────┘             │               │
│                 ▼                      ▼                     ▼               │
│  ┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │   Routing Store       │  │  Routing Store    │  │  Routing Store       │   │
│  │ interactive → conn    │  │ agent_tasks→conn  │  │ inline_completion    │   │
│  └──────────┬────────────┘  └────────┬─────────┘  └──────────┬───────────┘   │
│             │                        │                        │               │
│   ┌─────────▼─────────┐   ┌─────────▼─────────┐   ┌─────────▼───────────┐   │
│   │ api_key?           │   │ agent_managed      │   │ lspBinary            │   │
│   │ → Direct API call  │   │ → ACP spawn        │   │ → LSP spawn          │   │
│   └────────────────────┘   └─────────┬──────────┘   └─────────┬──────────┘   │
│                                      │                         │              │
│  ════════════════════════════════════════════════════════════════════════════  │
│                         TAURI IPC BOUNDARY (Rust)                             │
│  ════════════════════════════════════════════════════════════════════════════  │
│                                      │                         │              │
│                             ┌────────▼──────────┐    ┌─────────▼──────────┐  │
│                             │    acp.rs           │    │  copilot_lsp.rs    │  │
│                             │  resolve_binary()  │    │  resolve_binary()  │  │
│                             └────────┬───────────┘    └─────────┬──────────┘  │
│                                      │                          │             │
│                        ┌─────────────▼──────────────────────────▼──────┐      │
│                        │         BINARY RESOLUTION                     │      │
│                        │                                               │      │
│                        │  1. ~/.notesage/agents/bin/  → managed       │      │
│                        │  2. System PATH               → system       │      │
│                        │  3. Common paths               → system       │      │
│                        │                                               │      │
│                        │  Returns: { path, source: managed | system } │      │
│                        └──────────┬─────────────────┬─────────────────┘      │
│                                   │                 │                         │
│                      ┌────────────▼──────┐  ┌──────▼──────────────────┐      │
│                      │ SOURCE: managed    │  │ SOURCE: system          │      │
│                      └────────────┬──────┘  └──────┬──────────────────┘      │
│                                   │                 │                         │
│                                   ▼                 ▼                         │
│               ┌──────────────────────────┐  ┌──────────────────────────┐     │
│               │  SANDBOXED SPAWN         │  │  DIRECT SPAWN            │     │
│               │  (default for managed)   │  │  (default for system)    │     │
│               │                          │  │                          │     │
│               │  macOS:                  │  │  tokio::process::Command  │     │
│               │   sandbox-exec           │  │    ::new(agent_binary)   │     │
│               │   -f <profile.sb>        │  │    .args(agent_args)     │     │
│               │   <agent_binary>         │  │    .stdin/stdout(piped)  │     │
│               │   <agent_args>           │  │    .kill_on_drop(true)   │     │
│               │                          │  │                          │     │
│               │  Linux:                  │  │  (current behavior,      │     │
│               │   bwrap                  │  │   unchanged)             │     │
│               │   --ro-bind /usr /usr    │  │                          │     │
│               │   --bind <project> ...   │  │  User can opt-in to     │     │
│               │   -- <agent_binary>      │  │  sandbox in settings    │     │
│               └────────────┬─────────────┘  └──────────────────────────┘     │
│                            │                                                  │
│               ┌────────────▼─────────────┐                                   │
│               │  SEATBELT PROFILE        │                                   │
│               │                          │                                   │
│               │  ALLOW read: system      │                                   │
│               │  ALLOW write: <project>  │                                   │
│               │  ALLOW write: /tmp       │                                   │
│               │  DENY read: ~/.ssh       │                                   │
│               │  DENY read: ~/.aws       │                                   │
│               │  DENY read: ~/.gnupg     │                                   │
│               │  DENY write: .git/       │                                   │
│               │                          │                                   │
│               │  Phase 1: ALLOW network* │                                   │
│               │  Phase 2: DENY network*  │──────────┐                        │
│               │           ALLOW unix sock│           │                        │
│               └──────────────────────────┘           │                        │
│                                                      │ Unix socket            │
│               ┌──────────────────────────────────────▼─────────────────┐     │
│               │  NETWORK PROXY (Phase 2)                               │     │
│               │  Runs outside sandbox, inside Notesage process         │     │
│               │                                                        │     │
│               │  HTTP/SOCKS5 proxy with per-agent domain allowlist     │     │
│               │                                                        │     │
│               │  claude-agent-acp → api.anthropic.com                 │     │
│               │  codex-acp        → api.openai.com                    │     │
│               │  copilot          → api.github.com, copilot-proxy.*   │     │
│               │  gemini           → generativelanguage.*              │     │
│               │  common           → github.com (git operations)       │     │
│               │                                                        │     │
│               │  Unknown domain → prompt user for approval             │     │
│               └────────────────────────────────────────────────────────┘     │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Update Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                         UPDATE LIFECYCLE                            │
│                                                                    │
│  App launch / every 24h                                            │
│       │                                                            │
│       ▼                                                            │
│  ┌──────────────────────────┐                                     │
│  │ Read versions.json        │                                     │
│  │ For each managed agent:   │                                     │
│  │   Query GitHub Releases   │                                     │
│  │   (or npm registry)       │                                     │
│  └──────────┬────────────────┘                                     │
│             │                                                      │
│      ┌──────▼──────┐                                              │
│      │ Update       │  YES   ┌──────────────────────────────┐     │
│      │ available?   ├───────→│ Set flag in agent-store       │     │
│      └──────┬───────┘        │ Show badge on connection card │     │
│             │ NO             │ "v1.2 → v1.3 available"       │     │
│             ▼                └──────────┬───────────────────┘     │
│        (no action)                      │                          │
│                                         ▼                          │
│                              User clicks "Update"                  │
│                                         │                          │
│                              ┌──────────▼───────────────────┐     │
│                              │ Agent currently running?      │     │
│                              └──────────┬───────────────────┘     │
│                                    YES  │  NO                      │
│                                         ▼                          │
│                              ┌──────────────────────────┐         │
│                              │ "Restart agent to update?"│         │
│                              └──────────┬───────────────┘         │
│                                         ▼                          │
│                              Stop agent → Download → Replace       │
│                              → Update versions.json → Restart      │
│                              → Toast: "Updated to v1.3"            │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Settings UI — Per Connection

```
┌──────────────────────────────────────────────────────────────────────┐
│ Claude Code (ACP)                                    [Connected ●]  │
│                                                                      │
│ Source:  ● Managed by Notesage                    [Update: v1.3 ↑]  │
│            ~/.notesage/agents/bin/claude-agent-acp                   │
│          ○ System install                                            │
│            /usr/local/bin/claude-agent-acp                            │
│                                                                      │
│ Sandbox: [■ Enabled]  (default: on for managed, off for system)     │
│                                                                      │
│ Routed to: Interactive, Agent Tasks                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Dependency Chains

```
claude-agent-acp:
  Pre-built binary (GitHub Releases) ──── no dependencies
  Fallback: portable Node.js + npm install @zed-industries/claude-agent-acp

codex-acp:
  Pre-built Rust binary (GitHub Releases) ── no dependencies
  Fallback: portable Node.js + npm install @zed-industries/codex-acp

copilot (--acp):
  Pre-built native binary (GitHub Releases) ── no dependencies
  User may already have from: npm install -g @github/copilot
                               brew install github/gh/copilot

gemini (--acp):
  Full Node.js app ── REQUIRES Node.js runtime
  → Download portable Node.js to ~/.notesage/runtime/node/
  → npm install --prefix ~/.notesage/agents/lib/ @google/gemini-cli
  → Optional native deps (keytar, node-pty) — prebuilds usually work

copilot-language-server:
  Pre-built native binary (GitHub Releases) ── no dependencies
  User may already have from: npm install -g @github/copilot-language-server
```

## Defense in Depth

The architecture provides three layers of protection:

| Layer | What it does | Enforced by |
| --- | --- | --- |
| **Installation isolation** | Binaries installed to `~/.notesage/agents/`, not global system | Filesystem layout |
| **Runtime sandbox** | Restricts filesystem read/write + network access | OS kernel (Seatbelt / bwrap / Landlock) |
| **ACP permissions** | User approves individual tool calls (file edits, shell commands) | ACP protocol + Notesage UI |

ACP permissions alone are advisory — the agent *chooses* to ask. The OS-level sandbox enforces the boundary regardless of agent behavior.

## Implementation Phases

### Phase 1 — Managed Installation + Filesystem Sandbox ✅

- Binary download from GitHub Releases
- Portable Node.js for Gemini CLI
- Seatbelt sandbox on macOS
- Bubblewrap/Landlock sandbox on Linux
- Version tracking and update checking
- Settings UI for source selection and sandbox toggle

### Phase 2 — Network Sandboxing ✅

- HTTP proxy on localhost (not SOCKS5 — HTTP CONNECT covers all agents)
- Per-agent domain allowlists
- Unknown domain confirmation prompts (DomainApprovalCard)
- TCP localhost proxy (not Unix socket — simpler, all agents support it)
- Telemetry toggle per connection

### Phase 3 — User-Configurable Policies ✅

- Custom writable paths per connection
- Custom allowed domains per connection
- Per-connection policy persistence (connections-store + permission-store)

## Dependencies

- `reqwest` (already in Cargo.toml) — for HTTP downloads and GitHub API
- `sha2` — for checksum verification
- `flate2` + `tar` — for archive extraction
- `landlock` crate — for Linux filesystem sandboxing (Phase 1)
- No new frontend dependencies

## Quality Gates

- [x] `cargo check` passes

- [x] `npx tsc --noEmit` passes

- [x] Managed install works for claude-agent-acp on macOS (download + extract + permissions)

- [ ] Managed install works for Gemini CLI (portable Node.js + npm install) — code written, untested (user has system gemini)

- [x] System binary detected and used when available (no install offered)

- [x] Sandbox blocks write to `~/.ssh/` from sandboxed agent (manual test)

- [x] Sandbox allows write to project directory from sandboxed agent

- [x] Unsandboxed spawn still works for system binaries (no regression)

- [x] Update check detects newer version on GitHub

- [x] Update flow: stop agent → replace binary → restart agent

- [x] Connection settings show source (managed/system) and sandbox toggle

- [x] Looks correct in both light and dark mode

## Open Questions

- [x] Verify Gemini CLI flag: `--experimental-acp` confirmed (not `--acp`). Fixed in `connections.ts`.

- [x] Confirm GitHub Release asset naming patterns: claude-agent-acp uses `{name}-{os}-{arch}`, codex-acp uses `{name}-{version}-{rust-triple}`, copilot uses `copilot-{os}-{arch}`, copilot-language-server uses `{name}-{os}-{arch}-{version}` (no `v` prefix on tag).

- [x] `claude-agent-acp` bundles Claude Agent SDK — does NOT need `claude` CLI for auth. Authenticates via `ANTHROPIC_API_KEY` env or `/login` OAuth.

- [ ] Windows strategy: WSL2-based sandboxing or Windows Job Objects? — deferred (Windows/Linux removed from builds)

- [x] macOS Gatekeeper: YES, quarantines downloaded binaries. Must run `xattr -d com.apple.quarantine` after download.

- [ ] **Gemini CLI ACP authentication**: The `authenticate` ACP method triggers an OAuth browser flow, but Gemini writes an interactive "Do you want to continue? \[Y/n\]:" prompt to stdout (corrupting JSON-RPC) and the browser may not open reliably from a subprocess. Current workaround: detect unauthenticated state and show manual auth guide. **Need to research**: How does Zed editor handle Gemini ACP auth? Does Gemini support device code flow (like Copilot)? Can we use `GEMINI_API_KEY` as an alternative? Is there a headless OAuth flag?

## Out of Scope

- Bundling agent binaries inside the Notesage app package
- Building custom ACP adapters (we use Zed's packages)
- Privilege escalation (sudo) from within the app
- Mobile platform support
- Agent binary auto-updates without user confirmation