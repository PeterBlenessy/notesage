# Agent Data Safety — Sandboxing & Context Isolation

**Date:** 2026-03-15 **Status:** Complete (read isolation gate moved to [delegation-sandbox-enforcement](2026-03-22-delegation-sandbox-enforcement.md)) **Parent:** Agent Binary Management & Runtime Sandboxing

## Problem

When users work with AI agents through Notesage, they have no control over what data the agent can access. An agent spawned for a chat about Project A can read files from Project B, and switching project selection in the chat footer sends the full message history (including Project A content) to the agent when working on Project B.

This creates two data safety gaps:

1. **Filesystem access** — ACP agents run with full system access. ACP tool permissions are advisory (the agent *chooses* to ask). A compromised or prompt-injected agent could read `~/.ssh/id_rsa`, exfiltrate code from unrelated projects, or modify files outside the intended scope.

2. **Context leakage** — Switching project selection in chat sends all prior messages as history. Content from one project leaks into another project's AI context, potentially influencing generated content or exposing proprietary information across project boundaries.

These are two sides of the same coin. Solving only one creates a false sense of security.

## Goals

- **Filesystem boundary**: OS-level sandbox restricts agent file access to explicitly allowed directories
- **Context boundary**: Project selection in chat is a data boundary — agents only see messages from the current project context
- **User control**: Users decide which projects an agent can access, with safe defaults
- **Instant project switching**: Changing project selection must be instant (no multi-second respawn)
- **Zero regression**: Existing chat, delegation, and inline action workflows continue working

## Non-Goals

- Network-level sandboxing (proxy-based domain filtering) — deferred to Phase 2
- Sandboxing user-installed system binaries by default (opt-in only)
- Encrypting chat history at rest
- Per-file granularity (sandbox operates at directory level)

## User Stories

- As a user working on a client project, I want the AI agent to only access that project's files, so that code from other projects doesn't leak into the client's work.
- As a user delegating a comment to an agent, I want the agent scoped to that document's project, so it can't read or modify files in unrelated projects.
- As a user switching between projects in a chat, I want a clear boundary where the agent starts fresh, so that previous project context doesn't influence responses.
- As a user, I want the option to carry history across project switches when I explicitly choose to, so I'm not forced into rigid isolation when I don't need it.
- As a user, I want to see that my agent is sandboxed, so I have confidence in the data boundary.

## Technical Approach

### Layer 1: OS-Level Filesystem Sandbox

**Already implemented** in `sandbox.rs` and `acp.rs` (Slice 3). Needs updates:

**Current**: Single `working_directory` string generates a sandbox profile with one writable subpath.

**Required**: Accept `Vec<String>` of writable paths. Different spawn contexts pass different path sets:

| Spawn context | Writable paths |
| --- | --- |
| **Chat panel** | All workspace folders (projects + explorer folders) |
| **Comment delegation** | Document's parent project/explorer folder only |
| **Inline actions** (Improve, Summarize, etc.) | Document's parent project/explorer folder only |
| **Health check** (test connection) | `/tmp` only |

**Rationale for chat panel = all workspace folders**: The agent process persists across project selection changes (for instant switching). The OS sandbox is set at spawn time and cannot be narrowed after. Context isolation (Layer 2) handles the per-project data boundary. The sandbox still blocks `~/.ssh`, `~/.aws`, `~/.gnupg`, `.env`, and `.git` writes.

**Rationale for delegation = single folder**: Each delegation spawns on the `agent_tasks` slot with a dedicated agent. The task is scoped to one document in one project. No reason to grant broader access.

**Respawn triggers** (new sandbox profile needed):

- Workspace change: project or explorer folder added/removed from sidebar
- Provider change: different agent binary
- NOT on project selection change in chat footer (handled by Layer 2)

### Layer 2: Chat Context Isolation

Project selection in the chat footer becomes a **data boundary**, not just a hint for the system message.

**When the user changes project selection in an active chat:**

1. Show an inline prompt in the chat:

   > **Project changed to "Svenska Investmentbolag**"Previous messages won't be shared with the agent. \[Include history\] \[Start fresh\]

2. **Start fresh** (default, safe):

   - Create a new ACP session on the existing agent (`acp_session_new`)
   - Do NOT send prior message history to the new session
   - Prior messages remain visible in the UI for user reference
   - Insert a visual divider in the chat: "--- Context: Svenska Investmentbolag ---"
   - System message updated with new project's metadata, file tree, goals

3. **Include history** (explicit opt-in):

   - Create a new ACP session
   - Prepend prior messages as history in the first prompt
   - Insert a visual divider with note: "--- Context: Svenska Investmentbolag (history included) ---"

4. **No respawn**: Same agent process, new session. Instant.

**Session tracking per conversation:**

Each conversation tracks which session segments belong to which project context:

```typescript
interface ConversationSegment {
  projectPaths: string[];
  sessionId: string;
  startMessageIndex: number;
  historyIncluded: boolean;
}
```

When sending a message, only include messages from the current segment (unless `historyIncluded` is true for the current segment).

### Layer 1 + 2 Interaction

|  | Agent can access files | Agent sees in context | Additional access |
| --- | --- | --- | --- |
| **Chat (Project A selected)** | All workspace folders (sandbox) | Only Project A messages + system prompt | N/A |
| **Chat (switch to Project B)** | All workspace folders (sandbox) | Only Project B messages (unless user opts in) | N/A |
| **Delegation from Project A doc** | Only Project A folder (sandbox) | Only the comment + anchor text | Must request permission for other folders |
| **Inline action on Project A doc** | Only Project A folder (sandbox) | Only the selected text + prompt | Must request permission for other folders |

The sandbox is the hard boundary (OS-enforced, non-bypassable). Context isolation is the soft boundary (app-enforced, user can override with "Include history").

### Comment Delegation & Inline Actions

**Current behavior**: Each delegation creates a separate task entry in the activity panel. All delegations share one `taskAgent` process.

**Required behavior**:

- Delegation sandbox: **only** the document's parent project or explorer folder. No read or write access to other folders.
- If the agent needs access to additional folders (e.g., cross-referencing another project), it must request permission via the ACP tool permission flow. The user can grant or deny per-request.
- Single `taskAgent` per connection, sessions per delegation (already works this way)
- Batch delegation from status bar: individual sessions on one agent (current behavior). Grouping in activity panel is a UX improvement deferred to a later task.

## UI/UX

### Project Switch Prompt (Chat Panel)

Inline card between messages, similar style to the permission card:

```
┌──────────────────────────────────────────────────────┐
│  📁  Project changed to "Svenska Investmentbolag"    │
│                                                      │
│  Previous messages won't be shared with the agent.   │
│                                                      │
│            [Include history]  [Start fresh]          │
└──────────────────────────────────────────────────────┘
```

- Appears on **any** change to the project selection set — adding a project, removing a project, or replacing. This includes going from \[A\] → \[A, B\] or \[A, B\] → \[A, B, C\]. Every change is treated as a scope change because the user may have forgotten to deselect the previous project.
- "Start fresh" is the primary/default action (right-side, filled button)
- "Include history" is secondary (outline button)
- Card is persistent in the chat — shows the decision that was made
- After the user chooses, a divider line appears marking the new context

### Context Divider

Collapsible divider that marks the scope change. Collapsed by default — shows a one-line summary. Expanding reveals the details of the scope change.

**Collapsed (default):**

```
▸ Context: Svenska Investmentbolag ──────────────────
```

**Expanded:**

```
▾ Context: Svenska Investmentbolag ──────────────────
  Switched from: My Open Source Project
  History: Not included
  Session: New
```

Or if history was included:

```
▾ Context: Svenska Investmentbolag ──────────────────
  Switched from: My Open Source Project
  History: Included (user opted in)
  Session: New
```

The expand/collapse reveals the scope change details without cluttering the chat by default.

### Sandbox Indicator

Show sandbox status on connection cards (already partially implemented):

- Shield icon or "Sandboxed" badge when sandbox is active
- Visible in the connection card and optionally in the chat footer

## Data Model

### Updated Sandbox Types

```rust
/// Generate sandbox profile with multiple writable paths
pub fn generate_seatbelt_profile(
    writable_paths: &[String],
) -> Result<PathBuf, String>
```

### Conversation Segment Tracking

```typescript
interface ConversationSegment {
  projectPaths: string[];       // Project context for this segment
  sessionId: string | null;     // ACP session (null if not yet created)
  startMessageIndex: number;    // First message in this segment
  historyIncluded: boolean;     // Whether prior segment history was sent
}

// Updated Conversation interface
interface Conversation {
  // ... existing fields ...
  segments: ConversationSegment[];
  activeSegmentIndex: number;
}
```

### ACP Spawn Updates

```typescript
// Chat panel spawn — all workspace folders
await invoke('acp_agent_spawn', {
  agentBinary: '...',
  workingDirectory: primaryProjectPath,
  sandboxPaths: allWorkspaceFolders,  // NEW
});

// Delegation spawn — single project folder
await invoke('acp_agent_spawn', {
  agentBinary: '...',
  workingDirectory: projectPath,
  sandboxPaths: [projectPath],  // NEW — restricted
});
```

```rust
#[tauri::command]
pub async fn acp_agent_spawn(
    // ... existing params ...
    sandbox_paths: Option<Vec<String>>,  // NEW — writable paths for sandbox
    sandbox_enabled: Option<bool>,
) -> Result<SpawnResult, String>
```

## Dependencies

- `sandbox.rs` — already created, needs multi-path update
- `acp.rs` — already has sandbox integration, needs `sandbox_paths` parameter
- `chat-store.ts` — needs segment tracking
- `useAcpLifecycle.ts` — needs session management per segment
- `ChatPanel.tsx` / `ChatMessage.tsx` — needs project switch prompt and divider UI
- No new external dependencies

## Quality Gates

### Functional

- [x] Managed agent spawns in sandbox with correct writable paths

- [x] Chat: changing project shows inline prompt (Include history / Start fresh)

- [x] Chat: "Start fresh" creates new session, prior messages NOT sent to agent

- [x] Chat: "Include history" creates new session, prior messages included

- [x] Chat: context divider visible in message list

- [x] Delegation: agent can only write to document's parent project folder

- [ ] Delegation: agent cannot read files in other project folders — Seatbelt read restrictions abandoned (breaks agents). Enforcement moved to tool call path filtering, see [delegation-sandbox-enforcement](2026-03-22-delegation-sandbox-enforcement.md) tasks #6–#8.

- [x] Sensitive dirs always blocked: `~/.ssh`, `~/.aws`, `~/.gnupg`, `.env`

- [x] `.git` directories are read-only (no writes)

- [x] System-installed agents: sandbox off by default, opt-in available

- [x] Provider change in chat: agent respawned (no data leak)

- [x] Workspace change (add/remove folder): agent respawned with updated sandbox

- [x] `cargo check` passes

- [x] `npx tsc --noEmit` passes

### Design

- [x] Project switch prompt matches existing card styling (PermissionCard reference)

- [x] Context divider is subtle and readable in both light and dark mode

- [x] No jarring transitions on project switch

## Out of Scope

- ~~Network-level sandboxing (proxy-based domain filtering)~~ — completed in [network-sandboxing](2026-03-16-network-sandboxing.md)
- Per-file access control (sandbox is per-directory)
- Sandboxing system-installed binaries by default
- Batch delegation grouping in activity panel (noted for future UX improvement)
- Encrypting chat history at rest
- Windows sandboxing (WSL2 / Job Objects)