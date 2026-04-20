# PRD: Project & Data Isolation

|  |  |
| --- | --- |
| **Date** | 2026-04-18 |
| **Status** | Shipped in v0.38.0 (2026-04-20) — all 24 leaks closed, red-team pass complete |
| **Red-team** | [2026-04-20-red-team](../audits/2026-04-20-red-team.md) |
| **Priority** | Critical — blocks commercial launch |
| **Impact** | Enables Notesage to back a public data-separation promise: the agent only sees and writes within the project(s) the user has explicitly selected; provider locks are enforceable; approval persistence is scoped. Required for legal/compliance workloads. |
| **Audit** | [project-isolation](../audits/2026-04-18-project-isolation.md) |
| **Tasks** | [project-data-isolation-tasks](../tasks/2026-04-18-project-data-isolation-tasks.md) |

## Problem

Two security audits on 2026-04-18 found **22 distinct leaks** in Notesage's project/provider/data isolation. The main chat path — the primary user surface — deliberately unions every workspace project and explorer folder into the OS sandbox's writable set and disables the path filter for regular (non-comment-delegation) chats. Approval persistence is keyed globally by tool name, so "Always allow write_file" applies forever across every project and provider. Skills, agent instructions, and MCP servers are unioned across projects. Copilot LSP is hard-coded to the first project in the workspace rather than the selected one. Per-project provider overrides exist in data (`ProjectMetadata.ai.provider`) but are advisory only and silently ignored in the multi-select case.

Only **comment delegation** is correctly isolated today — it uses `taskMeta.projectRoot` as both `cwd` and the sole sandbox path, with the path filter unconditionally active. This proves the approach works; the remaining surfaces need to adopt the same pattern.

A commercial app promise of "your data stays in the project you selected" cannot be honoured as the code currently stands. This PRD specifies what must change.

## Goals

1. **Per-chat project scope** — the OS sandbox, filesystem tool filters, LSP document access, and inline completion context all respect the user's explicit selection (via the chat footer project selector), not the full workspace.
2. **Provider locks** — projects can be marked as locked to a specific provider/connection, and this lock is enforced at every send path (new message, resend, edit, delegation, inline action).
3. **Scoped approvals** — persisted "always allow" approvals are keyed by `(tool, connection, project)` tuples; they cannot leak across providers or projects.
4. **Visible context** — every path, tool call, and context injection affecting the next AI request is visible to the user before send and auditable after.
5. **Defense in depth** — OS-level (Seatbelt), path-filter-level (soft), and permission-UI-level enforcement all agree on the same scope. No layer may silently rubber-stamp what another rejects.
6. **Backward compatibility** — existing conversations, skills, MCP configs, and connections must continue to work. Migration where needed must be transparent.

## Non-Goals

- **Terminal auth type** (parked with Batch F).
- **MCP server passthrough to agents** (separate PRD pending — different problem).
- **Multi-root ACP** `additionalDirectories` — an explicit non-goal. Exposing multiple roots to a single agent session is the opposite of what this PRD establishes. If a power-user workflow needs it later, it will be gated behind an opt-in "cross-project mode" setting and require a separate decision.
- **Per-user authentication inside Notesage** (single-user local app by design).
- **Rewriting the ACP protocol** — we work within `agent-client-protocol` as it ships.

## User Stories

1. **As a user with a legal workload on Project A**, I want to mark it as "locked to Claude Code" so that no matter what I select in the chat footer, no message from this project ever reaches a different provider — and if I try, I get a clear block with an explanation.
2. **As a user with six open projects**, I want to know that when I chat under Project A, the agent process has no filesystem access to Projects B–F. If I ask the agent to read a file in Project B, it must be denied at the OS level, not merely "the model will probably be good about it".
3. **As a user reviewing approvals**, I want a single settings panel listing every persisted "always allow" approval, scoped by tool + connection + project, so I can audit and revoke. I do NOT want a flat list of "always-allowed tool names" that applies globally.
4. **As a user resending a message from an older provider**, I want to be warned before it goes to a different provider than originally used — especially if that provider is not allowed for the current project.
5. **As a user opening a sensitive file in an explorer folder outside any project**, I want it to stay out of AI context unless I explicitly attach it. Right now it's auto-attached to every chat message.
6. **As a user branching a conversation from a pre-switch message**, I want the branch to use the provider of that message's segment, not the current footer selection — or at least be warned before the switch happens.

## Technical Approach

The 22 leaks fall into three tracks with explicit ship gates:

- **Track 1 — Blockers for the commercial data-separation promise.** 5 Critical + 6 High + 1 revised Medium = 12 leaks. MUST land before any public data-isolation messaging.
- **Track 2 — Hardening (silent context/metadata injection).** 6 Medium leaks. Should land before public launch, not a hard blocker.
- **Track 3 — Correctness fixes.** 4 Low leaks. Can follow public launch.

### Execution discipline — red-team TDD

Every Track 1 fix is driven by a **security-invariant test** that codifies the attack. The per-leak loop:

1. **Red (attack).** Write a test that reproduces the leak and asserts the *current* insecure behavior — i.e., the attack succeeds today. Test passes; proves the leak is real and reproducible.
2. **Flip.** Change the assertion to require the attack *must fail*. Test now fails.
3. **Green (fix).** Implement the scope narrowing. Test passes.
4. **Regression lock.** Test stays in the suite forever.

The prerequisite is task #0 in the tasks file: a kernel-level sandbox verification harness that spawns a real ACP agent under a real Seatbelt profile and observes denial entries in the macOS unified log. Mock-level assertions are acceptable for wire-shape claims ("Rust received these paths") but never for isolation guarantees ("the OS actually blocks the write").

A post-Track-1 cold-read re-audit (tasks #32, #33) produces a dated follow-up document re-running the investigation process against the fixed code. Every original leak must be confirmed closed with a commit hash.

### Track 1 — Blockers (must-ship)

#### 1.1 Per-chat sandbox scope selector (leak #1)

Replace `getAllWorkspacePaths()` at `useAcpLifecycle.ts:257,546,789,798` with a `getChatSandboxScope(conv, connection)` selector that returns `conv.projectPaths` (the selected projects in the chat footer) plus `connection.extraWritablePaths`. Respawn the ACP agent when this selector's result changes, keyed by the same stringified scope already used at `acp-agent-state.ts:250-261`.

Preserve the current behaviour behind an opt-in "Cross-project mode" setting in Settings &gt; Advanced, default off. When on, falls back to `getAllWorkspacePaths()` with a UI warning.

#### 1.2 Unconditional ACP path filter (leak #2)

Set `pathFilterRoot` at `useAcpLifecycle.ts:509` from `selectedProjectPaths[0]` unconditionally for single-project chats. For multi-select chats, build a multi-root path filter that accepts any of the selected paths. Apply `isToolCallAllowed` in `useAcpSessionListeners.ts:299-312` before any auto-approval decision.

#### 1.3 Direct-API tool-executor scope check (leak #3)

In `src/lib/tool-executor.ts:213-239`, before dispatching any of `read_file`, `list_directory`, `write_file`, run `isToolCallAllowed(name, JSON.stringify(args), selectedProjectPaths, homeDir)`. Deny returns a `Denied: path outside project scope` tool result. Thread the current scope through via a parameter on `executeToolCall`; the direct-API chat path at `useDirectApiChat.ts` populates it from chat-store state.

#### 1.4 Resend/edit provider enforcement (leak #7)

At `ChatPanel.tsx:handleResend` and the edit flow, read `ChatMessage.connectionId`. If the current `effectiveConnection.id` differs, show a confirmation dialog: "This message was originally sent to X. Resend with X or Y?" Offer both options; default to the original provider. For locked projects (see 1.5), the "resend with current" option is blocked entirely.

#### 1.5 Project provider lock (leak #8)

Add `aiLock?: { connectionId: string }` to `ProjectMetadata` in `project-metadata-store.ts`. Enforce at:

- **Chat footer multi-select** — including a locked project forces the selection to just that project and locks the provider. Mixing locked projects with different locks is refused.
- **Provider switch** — disabled when a locked project is in the current selection.
- **Resend/edit** — blocked if it would route to a non-matching provider.
- **Comment delegation** — uses the locked provider instead of the global `agent_tasks` routing.
- **Inline actions (bubble menu)** — same lock enforcement as chat.

UI: a small "lock" badge on locked projects in the sidebar and chat footer. Settings &gt; Project shows a "Lock to provider" dropdown.

Migration: existing `ProjectMetadata.ai.provider` becomes a soft *default*; `aiLock` is the new hard enforcement. Empty `aiLock` means no lock (current behaviour). No existing conversations break.

#### 1.6 Scoped approval persistence (leak #13)

Replace `permission-store.ts:{toolCallAlways, alwaysAllowed, skillScriptAlways}` flat `string[]` arrays with a structured store:

```typescript
interface ScopedApproval {
  toolName: string;
  connectionId: string | null;   // null = any connection (legacy migration)
  projectRoot: string | null;    // null = any project (legacy migration)
  grantedAt: number;
}

interface ApprovalStore {
  alwaysAllowed: ScopedApproval[];
  toolCallAlways: ScopedApproval[];
  skillScriptAlways: ScopedApproval[];
}
```

Lookup at permission-check time: match by exact `(toolName, connectionId, projectRoot)` triple. Show the scope on the PermissionCard so the user sees what they're granting ("Always allow `write_file` for this project under Claude Code").

One-time migration: existing flat approvals are moved to the legacy bucket (`connectionId: null, projectRoot: null`) with a one-time toast informing the user and offering a "Review and scope" action opening Settings &gt; Privacy &gt; Approvals.

Settings &gt; Privacy &gt; Approvals lists all scoped approvals with revoke buttons.

#### 1.7 Copilot LSP scope (leak #14)

At `src/hooks/useCopilotChat.ts:73` and `useCopilotCompletion.ts:37`, replace `workingDir = projects[0]?.path` with `selectedProjectPaths[0]` (respecting the chat footer). In the LSP document-sync handlers, gate `textDocument/didOpen` and `didChange` on the URI being inside `selectedProjectPaths` or the active notes root. Out-of-scope URIs return a silent deny (no document sent).

`copilot/context-request` at `useCopilotChat.ts:524-545` returns the active tab's content ONLY if that tab's path is in scope; otherwise returns an empty context with a tool-call-denied message.

#### 1.8 Inline completion scope (leak #15)

`useCopilotCompletion.ts` and `useLocalCompletion.ts` must gate completion requests on the active tab's path being in `selectedProjectPaths` or inside the notes root. Out-of-scope tabs receive no completion request (or a user-visible "completions disabled for this file — outside project scope" indicator). Opt-in toggle in Settings &gt; Completions for users who want legacy behaviour.

#### 1.9 Per-project skill / agent / agent-instruction registries (leak #16)

`useSkillOperations.ts:78-80,218` currently scans all project `.notesage/skills/`, `.claude/skills/`, etc. into a unioned registry. Rework to produce a per-project registry keyed by project path, plus a global registry from `~/.notesage/`, `~/.claude/`, etc.

At chat system-prompt build time (`useAIContext.ts:118-127`), the skill descriptions and agent instructions injected must be the union of (global ∪ selected-projects-only), never other projects'. Same for `read_agent_instructions` — the caller at `useSkillOperations.ts:218` (currently passing `projects[0]`) passes `selectedProjectPaths[0]` instead. Multi-select unions the selected projects' instructions only.

#### 1.10 Per-project MCP server registries (leak #17)

`mcp-store.ts` currently merges all `.notesage/mcp.json` files. Rework to maintain a per-project MCP registry. At chat-send time, only MCP servers from global (`~/.notesage/mcp.json`) plus the selected projects' (`<proj>/.notesage/mcp.json`) are active in the current tool registry.

#### 1.11 Narrowed Tauri capabilities (leak #18)

In `src-tauri/tauri.conf.json`:

- `assetProtocol.scope.allow` narrowed from `["**"]` to a curated list: `$HOME/Notesage/**`, `$APPDATA/**`, workspace folders resolved at runtime. The current `["**"]` allows the renderer to load any file as an asset, which is a silent exfil path.
- Drop unused `fs:allow-*` plugin capabilities. The renderer should touch the filesystem only via our vetted Rust commands.

Removing these does not break any feature we ship today (verified by the audit).

#### 1.12 Activity panel visibility for auto-approved tools (leak #4) ✅

The audit's revalidation confirmed `addActivity` IS called for auto-approved calls at `useDirectApiChat.ts:281` and `useAcpSessionListeners.ts:151`. But the activity panel doesn't visually distinguish auto-approved from user-approved calls, and the path argument is often truncated.

Changes:

- Add an "auto-approved" vs "user-approved" badge on each activity entry.
- Show the resolved full path (not just basename) as a tooltip on hover.
- Add a settings toggle: "Require confirmation for all tool calls" (disables auto-approve globally).

### Track 2 — Hardening (should ship)

Addresses leaks #5, #6, #11, #19, #20, #21. These are silent context/metadata injection leaks — not kernel-level breaches, but violate the separation promise on sensitive metadata (file paths, project names, open-tab lists).

#### 2.1 Scope-aware active-tab auto-attach (leaks #5, #6)

`useChatContext.ts:24-49` auto-attaches the active tab's path to every send. Change: only auto-attach when the tab's path is inside `selectedProjectPaths`. For non-project tabs, the "attach to chat" pill is hidden and requires explicit user action to add.

Same fix in `useAIContext.ts:150-160` (`Currently editing: ${activeTab.filePath}` hardcoded fallback for local models) — remove the fallback; honour `attachedFilePaths` dismissal state universally.

#### 2.2 Per-agent writable config subpath (leak #11)

`src-tauri/src/commands/sandbox.rs:101-111` grants every agent writable access to `~/.claude`, `~/.codex`, `~/.copilot`, `~/.gemini`, `~/.notesage`. Change: pass `agent_binary` into the profile generator, emit only the relevant config subpath for that specific agent.

#### 2.3 Per-project command palette / autocomplete (leak #19) ✅

`@` mentions, `#` tags, and research (`?`) search in the command palette currently query all projects' SQLite indexes. Change: filter to `selectedProjectPaths` by default; add a "Search all projects" toggle for explicit cross-project search.

#### 2.4 History tab project scope (leak #20) ✅

The History tab surfaces all past conversations regardless of which project they were in. Change: filter to conversations whose `projectPaths` intersect `selectedProjectPaths`. Add an "All projects" toggle.

#### 2.5 File-tree system-prompt injection (leak #21)

Today the system prompt injects a list of project files for AI context. Change: injected file tree is restricted to `selectedProjectPaths` (not all projects), and capped at a configurable depth/count to avoid token bloat.

### Track 3 — Correctness fixes (follow-up OK)

Addresses leaks #9, #10, #12, #22.

#### 3.1 Segment boundary as message ID (leak #9)

`ConversationSegment.startMessageIndex` is a numeric index into `conv.messages`, which breaks with branching. Change to `startMessageId: string` — a stable UUID that survives tree restructuring. Slicing walks the active-leaf thread and stops at the ID.

#### 3.2 Clean ACP turn cancellation on workspace respawn (leak #10)

Before `stopAcpAgent()` fires at `useAcpLifecycle.ts:181-192`, call `acp_session_cancel` on the active session and deny any pending permission requests. Surface a "workspace changed — context reset" notice in chat.

#### 3.3 Attachment path activity log (leak #12)

At every send, log the attached paths as an activity entry visible before the agent responds.

#### 3.4 Tray recent files scope (leak #22)

Filter the tray's "recent files" menu to `selectedProjectPaths` (plus notes root). Keep an "All recent" submenu as opt-in.

## UI/UX

### Scope preview panel (new)

A non-dismissible (for new users) panel above the chat input shows before every send:

- Selected projects (chips)
- Current provider + connection
- Locked-project badge if any selected project has `aiLock`
- Count of attached files + current tab attachment status
- Count of active skills + MCP tools + agent instruction sources

Collapsible once the user has seen it a few times; expandable on click.

### Project lock badge

- Sidebar: small padlock icon on locked projects
- Chat footer: the provider name has a "locked" ribbon when a selected project has `aiLock`
- Settings &gt; Project: "Lock to provider" dropdown, with a confirmation dialog explaining what "locked" means

### Approvals review panel (new)

Settings &gt; Privacy &gt; Approvals lists every scoped approval:

| Tool | Connection | Project | Granted | Revoke |
| --- | --- | --- | --- | --- |
| `write_file` | Claude Code | Project A | 2026-04-18 | \[Revoke\] |
| `bash` | — (any) | — (any) | 2026-04-15 | \[Revoke\] — labelled "legacy, broad" |

Bulk actions: "Revoke all legacy (broad) approvals", "Revoke all for connection", "Revoke all for project".

### Activity panel badges

- 🔵 Auto-approved (scope verified)
- 🟢 User-approved
- 🔴 Denied (scope violation or user rejection)
- Path argument visible on hover

### Permission card updates

Every permission card (tool call + domain) shows the scope of the "Always allow" option explicitly:

> Always allow `write_file` for **Project A** under **Claude Code** connection

## Data Model

### New fields

```typescript
// project-metadata-store.ts
interface ProjectMetadata {
  // ... existing fields
  aiLock?: {
    connectionId: string;          // the locked connection ID
    lockedAt: number;              // timestamp for audit
    reason?: string;               // optional free-text ("legal", "sensitive data", etc.)
  };
}

// permission-store.ts
interface ScopedApproval {
  toolName: string;
  connectionId: string | null;     // null = legacy unbounded approval
  projectRoot: string | null;      // null = legacy unbounded approval
  grantedAt: number;
}

interface PermissionStore {
  // ... existing fields
  alwaysAllowed: ScopedApproval[];        // replaces string[]
  toolCallAlways: ScopedApproval[];       // replaces string[]
  skillScriptAlways: ScopedApproval[];    // replaces string[]
  // `domainAlwaysAllowed` already per-connection — extend to per-project too
  domainAlwaysAllowed: Record<string, Record<string, string[]>>; // conn → project → domains
}

// settings-store.ts
interface SettingsStore {
  // ... existing fields
  crossProjectMode: boolean;               // default: false
  requireAllToolConfirmations: boolean;    // default: false
  completionsOnOutOfScope: boolean;        // default: false
}
```

### New Tauri commands

None — isolation enforcement happens in Rust at the sandbox level (`sandbox.rs` already handles the writable paths list) and in TypeScript at the tool-executor level.

### Modified Tauri config

`src-tauri/tauri.conf.json`:

- `assetProtocol.scope.allow` narrowed
- Drop unused `fs:allow-*` plugin capabilities

## Dependencies

- No new libraries.
- No new Tauri plugins.
- No new ACP / LSP features.

## Quality Gates

### Track 1 (all must pass for commercial launch)

- [x] `acp_agent_spawn` is invoked with sandbox paths exactly matching `selectedProjectPaths + extraWritablePaths` — #4 + #7 integration test (`useAcpLifecycle.sandbox.test.ts`)

- [x] An ACP chat scoped to project A cannot read/write files in project B at the kernel level (writes covered since launch via Seatbelt writable_paths; reads closed by #6c + #6d — see `tests/sandbox_isolation.rs::leak_6c_kernel_denies_reads_outside_writable_paths` and `::leak_6d_sibling_path_at_neutral_home_location_is_denied`. #6d switched to deny-by-default in `$HOME` with an explicit allow-list for agent runtime paths — closes the sibling-path leak `~/Code/A` vs `~/Code/B` that #6c's enumeration left open. Open risk: future agent updates may introduce new path dependencies we haven't enumerated, tracked in the agent-sandbox-observability PRD.)

- [x] `isToolCallAllowed` fires for every ACP tool call in regular chat, not only comment delegation (#6 wired the permission-request path; #6c closes the read leak at the kernel via Seatbelt deny on user-data areas. Verified manually 2026-04-19: with Project A selected, agent reads in Project B return EACCES; adding Project B to the footer respawns the sandbox and reads succeed. #6d tracks future tightening to a full allow-list model)

- [x] Direct-API `read_file`/`list_directory`/`write_file` deny paths outside `selectedProjectPaths` — #8, 18 red-team tests in `src/lib/__tests__/tool-executor.test.ts` covering the three primitive tools + four implicit-FS tools (`add_comments`, `list_comments`, `resolve_comments`, `generate_pptx`); IPC never reached on deny

- [x] Resending a message originally sent to Claude while the chat is set to OpenAI triggers a confirmation dialog — #10 + #11 + fix `253470a` stamping `connectionId` on user messages; 10 red-team tests in `ChatPanel.test.tsx`

- [x] A locked project (`aiLock.connectionId = X`) cannot send a chat message to any other connection — #1 + #12 + #14 matrix; `useAIOperations.test.ts` covers 5 send paths × match/mismatch + comment delegation routes to the locked connection in `useAgentTaskOperations.ts`

- [x] Persisted "always allow" approvals are stored as scoped triples, and a UI exists to review and revoke — #2 `ScopedApproval` + #3 `ApprovalsSettings.tsx`

- [x] Existing flat approvals migrate to the legacy bucket with a user-visible toast — `permission-store.ts` v→v migration + one-time review toast

- [x] Copilot LSP rejects `didOpen` / `didChange` / `context-request` for URIs outside `selectedProjectPaths` — #16, 4 red-team tests each in `useCopilotCompletion.test.ts` / `useCopilotChat.test.ts`

- [x] Inline completions skip the LSP request for out-of-scope active tabs — #17; Copilot LSP + Ollama FIM + local bundled + OpenAI-compatible all gated; StatusBar "Completions: off (outside project)" indicator + `completionsOnOutOfScope` opt-out

- [x] Skills, agents, agent instructions, and MCP servers loaded into the chat system prompt match exactly `global ∪ selectedProjectPaths` (no union with other projects) — #18 + #19 (skill / agent / agent-instructions) + #20 (MCP `getActiveServers` / `getActiveTools`)

- [x] Tauri `assetProtocol.scope.allow` is narrowed; `fs:allow-*` dropped; app still launches and all features work — #21; regression lock in `tauri-capability-surface.test.ts`

- [x] Activity panel shows an "auto-approved" badge on silent tool calls; path visible on hover — #22 (`AgentActivity.approvalMode` + `ActivityStrip` / `ActivityTaskCard` rendering + `requireAllToolConfirmations` toggle)

### Track 2

- [x] Opening a non-project file does not auto-attach it to chats — #23; explicit-attach chip surfaces for opt-in

- [x] Each agent binary only has writable access to its own config subpath under `$HOME/.<agent>` — #24 + basename-extraction fix (`081f535`)

- [x] Command palette / History tab / autocomplete filter to selected projects by default — #25 + #26

- [x] File-tree system-prompt injection is scoped to selected projects — #27 (with 200-file / 4-level caps)

### Track 3

- [x] Branching from a pre-switch message produces the correct segment slice — #28 (`sliceThreadBySegment` with LCA walk; red-team branching test in `chat-store.test.ts`)

- [x] Workspace changes cancel any in-flight ACP turn cleanly before respawn — #29 (cancel → deny pending permissions → drain store → context-reset toast → stopAcpAgent)

- [x] Attachment paths are logged in the activity panel — #30 (`kind: 'attachment'` activities + `AttachmentFileStrip` renderer)

- [x] Tray recent-files menu filters to selected projects by default — #31 (+ opt-in "All Recent" submenu)

## Out of Scope

- Multi-root ACP `additionalDirectories` — explicit non-goal (would contradict this PRD)
- Per-user authentication
- Migration of existing conversations to `selectedProjectPaths`-aware defaults
- Rewriting how Tiptap surfaces image/drawing paths in exports (pre-existing leak, not part of AI context)
- The ACP "Cross-project mode" opt-in UI polish (reserved for a future enhancement)

## Success Criteria

Commercial-launch readiness: all Track 1 gates pass, plus a red-team pass where a second engineer attempts the documented leak repros and fails to reproduce any Critical or High finding.