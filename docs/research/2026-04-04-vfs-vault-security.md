# VFS-Based Vault Security for AI Agent Sandboxing

**Date:** 2026-04-04  **Status:** Research complete

## Motivation

Notesage spawns AI agent subprocesses (Claude Code, Codex, Copilot, Gemini CLI) via ACP that have their own built-in filesystem tools (bash, cat, ls, grep, read_file, write_file). These agents access the OS filesystem directly through syscalls — they bypass Notesage's Tauri IPC layer entirely. Any application-layer file filtering in Rust or TypeScript is irrelevant to an ACP agent that can run `cat /path/to/secret.md` through its own bash tool.

This research explores how a virtual filesystem approach — inspired by [Mintlify's ChromaFs](https://www.mintlify.com/blog/how-we-built-a-virtual-filesystem-for-our-assistant) — could enable a "vault" feature where users control exactly which files AI agents can see, with enforcement at the OS kernel level.

## The Mintlify ChromaFs Approach

Mintlify replaced per-conversation sandboxed environments with ChromaFs — a virtual filesystem backed by their Chroma vector database.

**Architecture:**
- Built on [just-bash](https://github.com/nicolo-ribaudo/just-bash) (Vercel Labs) — a TypeScript bash reimplementation with a pluggable `IFileSystem` interface
- UNIX commands (`cat`, `ls`, `grep`, `find`) translated into Chroma vector DB queries
- `cat /auth/oauth.mdx` fetches chunks by page slug, sorts by `chunk_index`, joins into full page
- Read-only by design — all writes throw `EROFS` (Read-Only File System)
- Lazy file pointers for large OpenAPI specs — visible in `ls`, fetched only on `cat`
- `grep` uses Chroma as coarse filter, then just-bash does fine-grained matching in-memory via Redis-cached chunks
- RBAC inherited from the database layer — no separate access control system

**Results:**
- Session creation: ~46s (sandbox spin-up) → ~100ms
- Zero marginal per-conversation compute cost
- 30,000+ daily conversations across hundreds of thousands of users

**Key insight:** The filesystem interface is the natural control plane for AI access. Agents already think in terms of `ls`, `cat`, `grep`. Instead of teaching agents a new API, present a curated filesystem that only contains what they should see.

## Why ChromaFs Doesn't Directly Apply

Mintlify is a multi-tenant SaaS where sandbox-per-session costs are existential. Notesage is a single-user desktop app with local files. There is no multi-tenant isolation problem, and the agent speaks to the real OS, not a TypeScript bash reimplementation.

However, the underlying principle — **control the filesystem the agent sees** — applies directly. The question is how to enforce it at the OS level.

## Threat Model

### What we're protecting against

1. **Agent reading sensitive files** — legal docs, credentials, personal notes in the same project
2. **Agent discovering file existence** — even knowing `secrets.md` exists leaks information
3. **Agent modifying security policies** — editing config files to elevate its own permissions
4. **Agent escaping project scope** — reading `~/.ssh/`, `~/.env`, other projects

### Why application-layer filtering fails

| Approach | How the agent bypasses it |
|---|---|
| Filter in `tool-executor.ts` | ACP agent uses its own bash tool, never calls our executor |
| Filter in Rust `read_file` command | Agent calls `cat` via OS syscall, never calls our IPC |
| Policy in `.notesage/ai-policy.json` | Agent runs `cat .notesage/ai-policy.json`, then `echo '{}' > .notesage/ai-policy.json` |
| Policy in SQLite `index.db` | Agent reads raw SQLite file bytes, or overwrites it |
| Prompt-based restrictions | Suggestions, not enforcement. Model can ignore them. |

**Conclusion:** The enforcement point must be the OS kernel. Nothing in userspace application code can stop a subprocess that has direct syscall access.

## OS-Level Sandboxing Approaches

### Approach 1: Apple Sandbox (Seatbelt) — macOS

**How it works:** Launch agent via `sandbox-exec -f profile.sb <command>`. Kernel enforces at syscall level. All child processes inherit the sandbox.

```scheme
(version 1)
(deny default)
(allow file-read-data (subpath "/project/src"))
(allow file-read-data (subpath "/project/docs"))
(deny file-read-data (subpath "/project/.notesage"))
(deny file-read-data (subpath "/project/secrets"))
;; System libs needed for agent to function
(allow file-read-data (subpath "/usr/lib"))
(allow file-read-data (subpath "/System"))
```

**Properties:**
- No root required. Any process can sandbox its children.
- Kernel-enforced, inherits to all child processes.
- **Files are unreadable (EACCES), not invisible.** `ls` still shows filenames. `cat` returns "Operation denied". Agent knows the file exists but cannot read content.
- `sandbox-exec` CLI is deprecated by Apple, but the kernel infrastructure is not. Firefox, Chrome, Claude Code all use it. Still present in macOS 26.
- Notesage already generates Seatbelt profiles for network sandboxing (`sandbox_monitor.rs`). Extending to file-read rules is incremental.

**Limitation:** Metadata leak. Agent sees `secrets.md` in directory listings. Mitigated by combining with a staged working directory (see Hybrid approach below).

### Approach 2: Bubblewrap + Mount Namespaces — Linux

**How it works:** Creates a new mount namespace with an empty root tmpfs, then selectively bind-mounts only the files/directories we want visible.

```bash
bwrap \
  --ro-bind /project/src /project/src \
  --ro-bind /project/docs /project/docs \
  --bind /project/output /project/output \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --ro-bind /bin /bin \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /project \
  -- agent-binary
```

**Properties:**
- **True invisibility.** Files not bind-mounted simply do not exist. `ls` shows nothing. `stat` returns ENOENT. The agent cannot discover hidden files exist.
- No root required (unprivileged user namespaces, default on Ubuntu, Fedora, Arch, kernel 3.8+).
- Near-zero performance overhead — bind mounts are free kernel-level path redirections.
- Battle-tested: used by Flatpak, Claude Code's open-source `sandbox-runtime`, Podman.
- Bubblewrap is a single binary, available in all major distro repos.

**This is the gold standard** for file-level isolation on Linux.

### Approach 3: Landlock LSM — Linux (Defense-in-depth)

**How it works:** Linux Security Module (kernel 5.13+) that allows unprivileged processes to restrict their own filesystem and network access. Applied from within the process — cannot be removed once applied.

```rust
// Rust via `landlock` crate (v0.4.4)
use landlock::*;
Ruleset::default()
    .handle_access(AccessFs::from_all(ABI::V5))?
    .create()?
    .add_rule(path_beneath_rules(&["/project/src"], AccessFs::from_read(ABI::V5)))?
    .restrict_self()?;
```

**Properties:**
- No root required. Process sandboxes itself.
- Files are inaccessible (EACCES), not invisible — same limitation as Seatbelt.
- Stackable with other LSMs (AppArmor, SELinux).
- Irreversible — restrictions can only be tightened, never loosened.
- Mature Rust crate. See also `ai-sandbox-landlock` project (Rust launcher specifically for sandboxing AI tools).

**Best used as a second layer** alongside Bubblewrap namespaces.

### Approaches That Do NOT Work

| Approach | Fatal flaw |
|---|---|
| **Symlink staging directory** | Agent escapes via `../` traversal or `readlink`. CVE-2026-27976 (Zed editor) was exactly this pattern. |
| **FUSE virtual filesystem** | Best theoretical solution (true invisibility on both platforms), but `fuser` Rust crate is untested on macOS, FUSE-T has no Rust bindings, and implementing a full FUSE filesystem is very high effort. Not production-ready today. |
| **chroot** | Requires root on macOS. Escapable by root processes on Linux. Bubblewrap is strictly better. |
| **OverlayFS** | Linux-only, still requires namespace setup. Just use Bubblewrap. |
| **fakechroot (LD_PRELOAD)** | Trivially bypassed by statically linked binaries. |
| **PRoot (ptrace)** | Linux-only, 3-8% overhead, less battle-tested than Bubblewrap. |

## Recommended Architecture: Vault with OS-Level Enforcement

### User-Facing Concept

Users mark files/folders as `ai-visible` or `ai-hidden` via the sidebar context menu. By default, all files are visible (backward compatible). Policies are per-project and optionally per-agent.

### Where Policies Live

**In Rust process memory**, loaded from an encrypted blob on vault unlock:

```
.notesage/vault-policy.enc  ← AES-256-GCM, key from OS keychain or password
         │
         ▼  (decrypted on unlock, held in memory)
State<VaultPolicyState> {
    policies: HashMap<PathBuf, FilePolicy>,
    vault_key: [u8; 32],
}
```

- Agent can read the `.enc` file — gets ciphertext, useless.
- Agent can overwrite the `.enc` file — Rust operates from in-memory state; corruption detected on next restart via AEAD tag verification.
- Policy modifications only possible through frontend UI → dedicated Tauri command that the tool executor never exposes.
- Compiled Rust deny list blocks agent access to `.notesage/` entirely as additional hardening.

### Agent Spawn Flow

```
User marks files as ai-visible/ai-hidden
         │
         ▼
Notesage reads policies from memory
         │
         ▼
Platform-specific sandbox constructed:
         │
    ┌────┴────┐
    │         │
  macOS     Linux
    │         │
    ▼         ▼
Seatbelt   Bubblewrap
profile     namespace
generated   constructed
    │         │
    ▼         ▼
(allow      --ro-bind for
file-read   each visible
for visible  file/dir
paths)       (hidden files
(deny for    not mounted —
hidden —     truly invisible)
EACCES)      
    │         │
    └────┬────┘
         │
         ▼
Agent spawned inside sandbox
CWD = staged working directory
```

### Staged Working Directory (Both Platforms)

Create `/tmp/notesage-vault-XXXX/` with structure mirroring the project but containing only visible files:

- **Linux:** Bubblewrap bind-mounts create this automatically — the namespace root IS the staged view.
- **macOS:** Symlinks to visible files + Seatbelt profile denying reads outside the staged dir. Symlink escape via `readlink` reveals real paths, but Seatbelt blocks reading those paths. Metadata leak (path exists) is acceptable — content is protected.

### Two Command Surfaces

The editor and agents use different Tauri commands:

```rust
// Editor calls (unrestricted, not exposed as a tool)
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> { ... }

// Agent tool executor calls (policy-enforced)
#[tauri::command]
async fn agent_read_file(
    path: String,
    connection_id: String,
    state: State<'_, VaultPolicyState>,
) -> Result<String, String> {
    let canonical = canonicalize(&path)?;
    if DENIED_PREFIXES.iter().any(|p| canonical.contains(p)) {
        return Err("not found".into());
    }
    let policy = state.get_policy(&canonical, &connection_id);
    match policy {
        Visibility::Hidden => Err("not found".into()),
        Visibility::Redacted => Ok("[content restricted]".into()),
        Visibility::ReadOnly | Visibility::Visible => fs::read_to_string(&canonical).map_err(...)
    }
}
```

This handles direct API tool calling (Path 1 agents that go through our tool executor). ACP agents (Path 2) bypass this entirely — which is why OS-level enforcement is the primary mechanism, and this is defense-in-depth.

## Visibility Levels

| Level | `ls` (macOS) | `ls` (Linux) | `cat` | `write` | Use case |
|---|---|---|---|---|---|
| `visible` | Shows file | Shows file | Full content | Allowed | Default for all files |
| `read-only` | Shows file | Shows file | Full content | EACCES / EROFS | Source code agent shouldn't modify |
| `redacted` | Shows file | Shows file | `[restricted]` | Denied | Agent sees metadata only |
| `hidden` | Shows file (EACCES on read) | **File doesn't exist** | EACCES / ENOENT | Denied | Sensitive files |

The macOS visibility gap (hidden files still appear in `ls`) is a known limitation of Seatbelt. Full invisibility on macOS requires FUSE (future work).

## Integration with Existing Notesage Systems

| System | Integration point |
|---|---|
| Seatbelt profiles (`sandbox_monitor.rs`) | Extend with `file-read-data` / `file-write-data` rules per policy |
| Connection config (`Connection.sandboxEnabled`, `extraWritablePaths`) | Add `vaultEnabled`, `fileVisibilityPolicy` fields |
| Agent spawn (`acp.rs`) | Generate platform-specific sandbox with file rules before spawn |
| Tool executor (`tool-executor.ts`) | Route to `agent_read_file` / `agent_write_file` for defense-in-depth |
| Sidebar (`FileTree.tsx`) | Lock icon, context menu for visibility toggles |
| SQLite index (`index/`) | Only index visible files, or encrypt index with vault key |
| iCloud sync | Encrypted vault blobs sync as opaque data — no plaintext leakage |
| Settings UI | Per-project vault settings, per-agent policy overrides |

## Future: FUSE for True Cross-Platform Invisibility

FUSE would provide true file invisibility on both macOS and Linux — the ideal solution. Current state:

- **Linux:** Kernel FUSE works. `fuser` Rust crate is mature.
- **macOS:** Two options emerging:
  - **macFUSE 5.1.3** — now uses FSKit backend on macOS 26+ (no kext). `fuser` crate lists macOS as "untested".
  - **FUSE-T** — kext-free, supports NFS/SMB/FSKit backends. No Rust bindings exist yet.

**Recommendation:** Revisit when `fuser` gains tested macOS support or FUSE-T gets Rust bindings. FSKit on macOS 26+ makes this increasingly viable. For now, Seatbelt + Bubblewrap is the production-ready path.

## Phased Implementation

### Phase 1: AI File Visibility Policies (no encryption)

- Per-file/folder `ai-visible` / `ai-hidden` toggles in sidebar context menu
- Policies stored in Rust process memory, loaded from `.notesage/ai-policy.json` (protected by compiled deny list)
- Seatbelt profiles extended with file-read rules (macOS)
- Bubblewrap bind-mount filtering (Linux)
- `agent_read_file` / `agent_write_file` Tauri commands for defense-in-depth
- Audit trail in Activity panel

### Phase 2: Encrypted Vault

- AES-256-GCM encryption at rest, Argon2id key derivation from user password
- Vault key cached in Rust process memory while unlocked, auto-lock on idle
- OS keychain integration for optional "remember password"
- Policies encrypted with vault key (`vault-policy.enc`)
- Encrypted blobs survive iCloud sync without plaintext exposure
- SQLite index rebuilt in-memory on vault unlock (no plaintext in `index.db`)

### Phase 3: FUSE Virtual Filesystem

- True cross-platform file invisibility
- Requires FUSE-T Rust bindings or `fuser` macOS maturation
- Replaces the Seatbelt + staging directory approach on macOS
- Enables advanced features: virtual file transformations, content redaction at read time

## References

- [Mintlify: How we built a virtual filesystem for our Assistant](https://www.mintlify.com/blog/how-we-built-a-virtual-filesystem-for-our-assistant)
- [Anthropic sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) — Claude Code's open-source sandbox (Seatbelt + Bubblewrap)
- [Claude Code sandboxing docs](https://code.claude.com/docs/en/sandboxing)
- [Bubblewrap](https://github.com/containers/bubblewrap) — unprivileged sandboxing tool
- [Landlock LSM kernel docs](https://docs.kernel.org/userspace-api/landlock.html)
- [landlock Rust crate](https://github.com/landlock-lsm/rust-landlock) (v0.4.4)
- [ai-sandbox-landlock](https://github.com/classx/ai-sandbox-landlock) — Rust AI tool sandboxing
- [fuser Rust crate](https://github.com/cberner/fuser) — Rust FUSE library
- [FUSE-T](https://www.fuse-t.org/) — kext-free FUSE for macOS
- [macFUSE](https://macfuse.github.io/) — macOS FUSE with FSKit backend (5.1.3)
- [CVE-2026-27976](https://www.thehackerwire.com/zed-code-editor-sandbox-escape-via-symlink-traversal-cve-2026-27976/) — Zed editor symlink traversal escape
- [FUSE performance analysis (USENIX FAST'17)](https://www.usenix.org/system/files/conference/fast17/fast17-vangoor.pdf)
- [Notesage sandbox-runtime comparison](sandbox-runtime-comparison.md) — existing research on network sandboxing
