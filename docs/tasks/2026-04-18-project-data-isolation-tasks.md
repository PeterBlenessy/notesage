# Project & Data Isolation — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-18 |
| **Status** | Not started |
| **PRD** | [project-data-isolation](../prds/2026-04-18-project-data-isolation.md) |
| **Audit** | [project-isolation](../audits/2026-04-18-project-isolation.md) |
| **Total** | 33 tasks: 15S, 15M, 3L |
| **Suggested order** | Foundations (#1–#3) → Track 1 Critical (#4–#9) → Track 1 High (#10–#22) → Track 2 hardening (#23–#27) → Track 3 correctness (#28–#31) → Verification & docs (#32–#33) |

**Risks / open questions:**

- **Approval migration UX.** Silently re-scoping persisted approvals is wrong; showing a one-time review dialog on next launch may be intrusive. Chose: migration toast with "Review and scope" action. Needs user testing.
- **Multi-select path filter.** Single-root `isToolCallAllowed` extended to multi-root may miss edges (symlinks, relative paths). Stay strict (any configured root can match); add tests for common cases.
- **Cross-project mode opt-in.** Relaxes the primary security guarantee. Requires a clear settings description and a warning banner when enabled.
- `ai.provider` **vs** `aiLock`**.** Existing field is a soft default; the new `aiLock` is hard enforcement. Document the distinction in migration notes to avoid confusion.
- **Copilot LSP rejection semantics.** Silent deny on out-of-scope URIs could confuse users who expect completions everywhere. Surface the reason ("Outside project scope — completions disabled for this file") as a toast/indicator.
- **Integration test environment.** Track 1 gates require real OS sandbox verification (kernel denies writes). Depends on a test harness that can spawn a real ACP agent and observe Seatbelt log stream — not currently in CI. May require a `@slow` test tag run locally only.
- **Red-team pass scheduling.** Needs a second engineer (or a disciplined solo run with the leak repro doc open). Plan for this before any public launch messaging.

---

## Phase 1 — Data Model Foundations

### #1 — Add `aiLock` field to `ProjectMetadata`

**Description:** Introduce the hard-lock data structure that every enforcement point will read. Pure data-model work — no UI, no enforcement yet.

**Acceptance criteria:**

- `src/stores/project-metadata-store.ts`: `ProjectMetadata` gains optional `aiLock?: { connectionId: string; lockedAt: number; reason?: string }`
- Serialization round-trips via `.notesage/project.json` (no migration needed — new field, optional)
- Existing `ai.provider` field left untouched (soft default), with a code comment noting its relationship to `aiLock`
- Unit test: a project with `aiLock` persists and rehydrates correctly

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/stores/project-metadata-store.ts`
- `src/stores/__tests__/project-metadata-store.test.ts`

---

### #2 — Migrate `permission-store` approvals to `ScopedApproval[]`

**Description:** Replace flat `string[]` approval lists with structured `(toolName, connectionId, projectRoot)` triples. Includes a one-time migration that moves existing approvals into a legacy bucket (`connectionId: null, projectRoot: null`) preserving current behaviour, and a migration toast inviting the user to review.

**Acceptance criteria:**

- `ScopedApproval` interface added: `{ toolName: string; connectionId: string | null; projectRoot: string | null; grantedAt: number }`
- `alwaysAllowed`, `toolCallAlways`, `skillScriptAlways` become `ScopedApproval[]`
- `domainAlwaysAllowed` extended from `Record<connId, string[]>` to `Record<connId, Record<projectRoot | 'global', string[]>>`
- `isAutoAllowed(tool, connId, projectRoot)` signature change; callers updated
- Zustand `persist` middleware migration: existing `string[]` → `ScopedApproval[]` with `connectionId: null, projectRoot: null`, and fire a one-time toast on next launch: "You have N broad approvals — review and scope them"
- Unit tests: migration path, lookup by exact triple, fall-through to legacy bucket, domain migration

**Complexity:** L **Category:** frontend **Dependencies:** None (runs parallel to #1) **Files:**

- `src/stores/permission-store.ts`
- `src/stores/__tests__/permission-store.test.ts`
- Callers: `src/hooks/useAcpSessionListeners.ts`, `src/lib/tool-executor.ts`, `src/components/chat/ToolCallPermissionCard.tsx`, `src/components/chat/PermissionCard.tsx`, `src/components/chat/DomainApprovalCard.tsx`

---

### #3 — Settings &gt; Privacy &gt; Approvals review UI

**Description:** New settings panel listing every persisted approval with its scope, allowing revoke and bulk actions. Replaces the silent flat-list behaviour; gives users a way to audit what they've granted.

**Acceptance criteria:**

- New component `ApprovalsSettings.tsx` renders a table with columns: Tool, Connection, Project, Granted, Actions (Revoke)
- Legacy bucket approvals rendered with a "legacy, broad" warning label
- Bulk actions: "Revoke all legacy approvals", "Revoke all for connection X", "Revoke all for project Y"
- Component tests: render, revoke, bulk revoke
- Added to `SettingsDialog` under Privacy tab

**Complexity:** M **Category:** frontend **Dependencies:** #2 **Files:**

- `src/components/settings/ApprovalsSettings.tsx` (new)
- `src/components/settings/SettingsDialog.tsx`
- `src/components/settings/__tests__/ApprovalsSettings.test.tsx`

---

## Phase 2 — Track 1 Critical: Sandbox & Scope

### #4 — `getChatSandboxScope()` selector + respawn on change

**Description:** Replace `getAllWorkspacePaths()` at the four call sites in `useAcpLifecycle.ts` with a selector that returns `conv.projectPaths + connection.extraWritablePaths`. Existing `sandboxScopeKey` keying in `acp-agent-state.ts:250-261` already triggers respawn; verify the new selector flows through it correctly.

**Acceptance criteria:**

- New function `getChatSandboxScope(conv: Conversation, connection: Connection, crossProjectMode: boolean): string[]` in `src/lib/ai/acp-utils.ts`
- Returns `conv.projectPaths ∪ connection.extraWritablePaths` when `crossProjectMode` is false; `getAllWorkspacePaths() ∪ extraWritablePaths` when true
- Replaces `getAllWorkspacePaths()` at `useAcpLifecycle.ts:257,546,789,798`
- Inline actions (`acpGenerateText`) and comment delegation keep their existing one-project scope — no change
- Unit test: scope matches selected projects for normal mode; unions all for cross-project mode
- Integration test: changing `conv.projectPaths` triggers ACP respawn (covered by #7)

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/ai/acp-utils.ts`
- `src/hooks/useAcpLifecycle.ts`
- `src/lib/ai/__tests__/acp-utils.test.ts`

---

### #5 — Cross-project mode opt-in setting

**Description:** Add `crossProjectMode: boolean` to `settings-store` (default false) and surface it in Settings &gt; Advanced with a clear warning ("Exposes all workspace folders to the agent — disables project isolation").

**Acceptance criteria:**

- `settings-store.ts` gains `crossProjectMode: boolean` default false
- Toggle in Settings &gt; Advanced with warning copy
- When enabled, a persistent banner appears above the chat input: "⚠️ Cross-project mode: agent has access to all workspace folders"
- `getChatSandboxScope` reads this flag (see #4)

**Complexity:** S **Category:** frontend **Dependencies:** #4 **Files:**

- `src/stores/settings-store.ts`
- `src/components/settings/AdvancedSettings.tsx`
- `src/components/chat/ChatPanel.tsx` (banner)

---

### #6 — Unconditional ACP path filter with multi-root support

**Description:** Remove the `opts.sandboxPaths` gate in `useAcpLifecycle.ts:509`. Set `pathFilterRoot` unconditionally for single-project chats. For multi-select, extend `isToolCallAllowed` to accept `projectRoots: string[]` and allow paths inside any of them.

**Acceptance criteria:**

- `pathFilterRoot = selectedProjectPaths[0] || null` unconditionally in `useAcpLifecycle.ts:509` for single-project
- `isToolCallAllowed(toolKind, input, roots: string | string[], homeDir)` — signature change; extend existing path-contained logic to OR across roots
- `useAcpSessionListeners.ts:299-312` evaluates the filter for ALL ACP chats (not only those with `opts.sandboxPaths`)
- Auto-approval checks scope BEFORE auto-approving: if the path filter denies, the call is denied even for auto-allowed tools
- Unit tests: path-filter single-root (existing), path-filter multi-root (new), deny wins over auto-allow

**Complexity:** M **Category:** frontend **Dependencies:** #4 **Files:**

- `src/lib/ai/path-filter.ts`
- `src/hooks/useAcpLifecycle.ts`
- `src/hooks/useAcpSessionListeners.ts`
- `src/lib/ai/__tests__/path-filter.test.ts`

---

### #7 — Integration test: ACP sandbox paths match selected scope

**Description:** Assert that `acp_agent_spawn` is invoked with sandbox paths exactly equal to `selectedProjectPaths + extraWritablePaths` for regular chat, and exactly equal to `[cwd]` for comment delegation and inline actions.

**Acceptance criteria:**

- Test in `src/hooks/__tests__/useAcpLifecycle.test.ts` (or new file): spy on `acp_agent_spawn`, seed chat-store with 2 projects, assert spawn args include both paths
- Test: switching `selectedProjectPaths` triggers a new spawn with the updated scope
- Cross-project mode: spawn includes all workspace paths

**Complexity:** S **Category:** frontend **Dependencies:** #4, #5 **Files:**

- `src/hooks/__tests__/useAcpLifecycle.test.ts`

---

### #8 — Direct-API tool-executor scope enforcement

**Description:** Apply `isToolCallAllowed` inside `src/lib/tool-executor.ts:213-239` before any filesystem-touching tool call. Thread `selectedProjectPaths` through `executeToolCall`; direct-API chat populates it from chat-store state.

**Acceptance criteria:**

- `executeToolCall(id, name, args, scope?: { projectRoots: string[]; homeDir: string })` signature change
- `read_file`, `list_directory`, `write_file` gated on `isToolCallAllowed(name, JSON.stringify(args), scope.projectRoots, scope.homeDir)`
- Deny returns a `{ isError: true, error: 'Denied: path outside project scope' }` tool result — model sees the denial
- `useDirectApiChat.ts` passes scope built from `selectedProjectPaths` at invoke time
- `useAgentTaskOperations.ts` direct-API path (if it calls executeToolCall) passes scope from `taskMeta.projectRoot`
- Unit tests: denial, allowance, missing scope (defaults to deny)

**Complexity:** M **Category:** frontend **Dependencies:** #6 **Files:**

- `src/lib/tool-executor.ts`
- `src/hooks/useDirectApiChat.ts`
- `src/hooks/useAgentTaskOperations.ts`
- `src/lib/__tests__/tool-executor.test.ts`

---

### #9 — Integration test: direct-API cross-project denial

**Description:** Assert that a direct-API chat scoped to project A cannot read a file in project B or outside any project.

**Acceptance criteria:**

- Test in `src/hooks/__tests__/useDirectApiChat.test.ts` (or extension): mock `ai_chat_stream`, emit `ai-tool-call` for `read_file` with an out-of-scope path, assert the tool result is a denial
- Test: `read_file` with an in-scope path succeeds
- Test: `write_file` without approval is prompted AND path-filtered

**Complexity:** S **Category:** frontend **Dependencies:** #8 **Files:**

- `src/hooks/__tests__/useDirectApiChat.test.ts`

---

## Phase 3 — Track 1 High: Resend / Provider Lock

### #10 — Resend/edit reads `ChatMessage.connectionId`

**Description:** At resend/edit time, compare the message's original `connectionId` to the current `effectiveConnection.id`. If they differ, show a confirmation dialog offering to resend with the original or current provider.

**Acceptance criteria:**

- `ChatPanel.tsx:handleResend` reads `message.connectionId` and opens `<ResendProviderDialog>` on mismatch
- Dialog offers "Resend with original (X)" and "Resend with current (Y)"; defaults to original
- Edit path: same behaviour on edit-then-send
- If `aiLock` is set on the current project (see #12), only the matching provider option is enabled
- Unit tests: confirmation shown on mismatch, not shown on match, blocked by lock

**Complexity:** M **Category:** frontend **Dependencies:** #12 (for lock interaction) **Files:**

- `src/components/chat/ChatPanel.tsx`
- `src/components/chat/ResendProviderDialog.tsx` (new)
- `src/hooks/useAIOperations.ts`
- `src/components/chat/__tests__/ChatPanel.test.tsx`

---

### #11 — Integration test: cross-provider resend confirmation

**Description:** Assert that resending a message originally sent to provider X while the chat is set to provider Y triggers a confirmation dialog, and that the dialog's actions route correctly.

**Acceptance criteria:**

- Test in `src/components/chat/__tests__/ChatPanel.test.tsx`: seed a message with `connectionId: 'conn-X'`, set `effectiveConnection` to `conn-Y`, click resend, assert dialog appears
- Clicking "Resend with original" routes to `conn-X`; "Resend with current" routes to `conn-Y`
- Test: matching connections skip the dialog entirely

**Complexity:** S **Category:** frontend **Dependencies:** #10 **Files:**

- `src/components/chat/__tests__/ChatPanel.test.tsx`

---

### #12 — `aiLock` enforcement at every send path

**Description:** Honour `ProjectMetadata.aiLock` at every user action that sends to a provider: new message, resend, edit, comment delegation, inline action (bubble menu). Block with a clear error when the target provider doesn't match the lock.

**Acceptance criteria:**

- `useAIOperations.ts:effectiveConnection` resolution checks `aiLock` on every selected project; if any lock mismatches, returns `null` and raises a `ProjectLockViolation` error surfaced via toast
- Chat footer multi-select: adding a locked project to a multi-selection with a different-locked or non-matching project is refused with a toast "These projects are locked to different providers"
- Chat footer: selecting a locked project disables provider switching (connection picker shows a lock icon on the locked option)
- Comment delegation: `useAgentTaskOperations.ts` checks source project's lock; if set, uses locked connection instead of `agent_tasks` routing
- Inline actions: `acpGenerateText` / `generateTextFromConnection` (direct API) both check lock; surface a toast on violation
- Unit tests: violation at each send path; valid cases continue to work

**Complexity:** L **Category:** frontend **Dependencies:** #1 **Files:**

- `src/hooks/useAIOperations.ts`
- `src/hooks/useAcpLifecycle.ts`
- `src/hooks/useAgentTaskOperations.ts`
- `src/components/chat/ChatFooter.tsx`
- `src/components/editor/BubbleMenu.tsx`
- Tests across each of the above

---

### #13 — Lock badge UI (sidebar + chat footer + Settings)

**Description:** Visual affordances for locked projects. Padlock icon in sidebar, ribbon on the chat footer provider label, and a "Lock to provider" dropdown in Settings &gt; Project.

**Acceptance criteria:**

- Sidebar: small padlock overlay on project folder icon when `aiLock` is set; tooltip "Locked to Claude Code — only this provider can access"
- Chat footer: when the active selection includes a locked project, the provider label shows a lock ribbon; clicking opens a modal explaining the lock
- Settings &gt; Project: new "AI Provider Lock" section with a connection dropdown and an optional reason text field; "Lock project" confirmation dialog explains the consequences
- Component tests: render with / without lock

**Complexity:** M **Category:** frontend **Dependencies:** #1 **Files:**

- `src/components/sidebar/FileTreeItem.tsx`
- `src/components/chat/ChatFooter.tsx`
- `src/components/settings/ProjectSettings.tsx`
- Icon from `lucide-react` (Lock)

---

### #14 — Integration test: aiLock violations are blocked

**Description:** For each send path, assert that `aiLock` violations result in an error (not a silent misroute).

**Acceptance criteria:**

- Test matrix: chat message / resend / edit / delegation / inline action × matching-lock / mismatching-lock
- Every mismatch path surfaces a toast and does not call the wrong provider's API
- Matching-lock path succeeds

**Complexity:** S **Category:** frontend **Dependencies:** #12 **Files:**

- `src/hooks/__tests__/useAIOperations.test.ts`

---

## Phase 4 — Track 1 Critical: Copilot LSP

### #15 — Copilot LSP `workingDir` = `selectedProjectPaths[0]`

**Description:** Replace hard-coded `projects[0]?.path` with the chat footer selection at LSP initialization and per-conversation workingDir.

**Acceptance criteria:**

- `src/hooks/useCopilotChat.ts:73`: `workingDir = selectedProjectPaths[0] ?? null`
- `src/hooks/useCopilotCompletion.ts:37`: same
- When `selectedProjectPaths` changes, the LSP is notified (workspace folder change) or re-initialized
- Unit test: workingDir reflects footer selection, not workspace order

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/hooks/useCopilotChat.ts`
- `src/hooks/useCopilotCompletion.ts`

---

### #16 — LSP document sync + context-request scope gate

**Description:** Reject `textDocument/didOpen`, `didChange`, and `copilot/context-request` for URIs outside `selectedProjectPaths`. Out-of-scope URIs produce no LSP traffic (silent deny).

**Acceptance criteria:**

- `useCopilotCompletion.ts:126-131` `didOpen`/`didChange` guarded on URI-in-scope check
- `useCopilotChat.ts:524-545` `context-request` returns empty content when active tab is out of scope
- When completions/context are denied, a toast (rate-limited to once per tab) tells the user: "Completions disabled for this file — outside selected project scope"
- Unit tests: in-scope URI → LSP traffic, out-of-scope → no traffic + indicator

**Complexity:** M **Category:** frontend **Dependencies:** #15 **Files:**

- `src/hooks/useCopilotChat.ts`
- `src/hooks/useCopilotCompletion.ts`
- `src/hooks/__tests__/useCopilotCompletion.test.ts`

---

## Phase 5 — Track 1 High: Inline Completions

### #17 — Inline completion scope gate (Copilot LSP + local)

**Description:** Skip completion requests when the active tab's path is outside `selectedProjectPaths` (plus the notes root). Add a settings toggle for users who want the legacy behaviour.

**Acceptance criteria:**

- `useLocalCompletion.ts` and `useCopilotCompletion.ts` skip requests when active tab URI is not in scope
- `settings-store` gains `completionsOnOutOfScope: boolean` (default false) — when true, legacy behaviour restored
- Status bar indicator when completions are disabled for the current file: "Completions: off (outside project)"
- Unit tests for each hook

**Complexity:** M **Category:** frontend **Dependencies:** #15 (for Copilot path) **Files:**

- `src/hooks/useCopilotCompletion.ts`
- `src/hooks/useLocalCompletion.ts`
- `src/stores/settings-store.ts`
- `src/components/editor/StatusBar.tsx`

---

## Phase 6 — Track 1 High: Per-Project Registries

### #18 — Per-project skill + agent registry

**Description:** `useSkillOperations.ts` today unions all projects' `.notesage/skills/` + `.claude/skills/` etc. into a single global registry. Rework to produce per-project registries keyed by project path, plus a global registry from `~/.notesage/` etc. System-prompt composition pulls only from `global ∪ selectedProjects`.

**Acceptance criteria:**

- `skill-store.ts`: `skills` becomes `{ global: Skill[]; byProject: Record<path, Skill[]> }` (or equivalent)
- Same for `agents` and `agentInstructions`
- `useSkillOperations.ts` discovery scans per project, not unioned
- `useAIContext.ts:118-127` `getSkillDescriptionsForPrompt()` takes a `selectedProjectPaths` arg and returns only matching scoped skills
- `getMergedAgentInstructions()` similarly scoped
- Migration: existing flat registry users continue to work (no persist schema change — registries are derived at runtime)
- Unit tests: registry matches scope, switching projects changes prompt contents

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:**

- `src/stores/skill-store.ts`
- `src/hooks/useSkillOperations.ts`
- `src/hooks/useAIContext.ts`
- `src/stores/__tests__/skill-store.test.ts`

---

### #19 — Fix `read_agent_instructions` caller to use `selectedProjectPaths[0]`

**Description:** Small but high-impact: `useSkillOperations.ts:218` currently calls `read_agent_instructions` with `projects[0]`. This silently ships project A's `CLAUDE.md` into project B's chat.

**Acceptance criteria:**

- Change caller to `selectedProjectPaths[0]` (or iterate over `selectedProjectPaths` for multi-select)
- Unit test asserting the path passed to Rust matches the footer selection

**Complexity:** S **Category:** frontend **Dependencies:** None (can run in parallel with #18) **Files:**

- `src/hooks/useSkillOperations.ts`

---

### #20 — Per-project MCP server registry

**Description:** `mcp-store.ts` currently merges all `.notesage/mcp.json` files. Rework to maintain a per-project registry. At chat-send, only `global ∪ selectedProjects` MCP servers are active in the current tool registry.

**Acceptance criteria:**

- `mcp-store.ts` reworked along the same lines as #18 — `{ global, byProject }`
- Tool-registration path at chat-send filters by selected projects
- `useSkillOperations.ts` or wherever MCP tools are composed into the tool list respects scope
- Unit test: different project selection changes available MCP tools

**Complexity:** M **Category:** frontend **Dependencies:** #18 (pattern) **Files:**

- `src/stores/mcp-store.ts`
- `src/hooks/useSkillOperations.ts` (tool composition)
- `src/stores/__tests__/mcp-store.test.ts`

---

## Phase 7 — Track 1 High: Tauri Capabilities

### #21 — Narrow `assetProtocol.scope` + drop unused `fs:allow-*`

**Description:** `tauri.conf.json`'s `assetProtocol.scope.allow = ["**"]` lets the renderer load any file as an asset — a silent exfil path. Narrow to a curated list and drop unused `fs:allow-*` plugin capabilities.

**Acceptance criteria:**

- `src-tauri/tauri.conf.json`: `assetProtocol.scope.allow` set to `["$HOME/Notesage/**", "$APPDATA/**"]` plus any runtime-added workspace folders
- Any `fs:allow-*` capability in `src-tauri/capabilities/default.json` that isn't actively used is removed
- Full manual regression pass: image attachments, drawing SVG rendering, PDF/EPUB viewers, PPTX, research search — all still work
- Audit v2 noted no feature breaks; verify with E2E
- Update `docs/architecture.md` to document the reduced capability surface

**Complexity:** M **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `docs/architecture.md`

---

## Phase 8 — Track 1 Medium: Activity Panel Visibility

### #22 — Auto-approved badge + path tooltip + require-confirm toggle

**Description:** Make auto-approved tool calls visible in the activity panel so the user always has a trail. Add a global "require confirmation for all tool calls" toggle.

**Acceptance criteria:**

- `AgentActivity` gains a `approvalMode: 'auto' | 'user' | 'denied'` field
- Activity strip / panel renders a small badge differentiating auto-approved (muted) vs user-approved (solid) vs denied (destructive)
- Full path argument visible on hover/tooltip (not just basename)
- `settings-store` gains `requireAllToolConfirmations: boolean` default false; when true, auto-allow is disabled globally
- Unit tests: approvalMode set correctly per path, tooltip shows full path

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/ai/types.ts` (AgentActivity)
- `src/stores/activity-store.ts`
- `src/components/activity/ActivityStrip.tsx`
- `src/components/activity/ActivityTaskCard.tsx`
- `src/stores/settings-store.ts`
- `src/components/settings/AdvancedSettings.tsx`

---

## Phase 9 — Track 2: Hardening

### #23 — Scope-aware active-tab auto-attach

**Description:** `useChatContext.ts:24-49` auto-attaches the active tab's path regardless of scope. Change: only auto-attach when the tab lives under `selectedProjectPaths`. Non-project tabs require explicit "attach to chat".

**Acceptance criteria:**

- `useChatContext.ts`: auto-attach only for tabs under selected projects
- Non-project tab: attach pill is hidden; "Add this file to chat" explicit button appears
- `useAIContext.ts:150-160` `Currently editing` fallback for local models honours the same scope check (remove the hardcoded fallback; unify with `attachedFilePaths`)
- Unit tests

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/hooks/useChatContext.ts`
- `src/hooks/useAIContext.ts`

---

### #24 — Per-agent writable config subpath

**Description:** `sandbox.rs:101-111` grants every agent writable access to all agent config dirs (`~/.claude`, `~/.codex`, etc.). Narrow to just the relevant agent's subpath.

**Acceptance criteria:**

- `generate_profile(agent_binary: &str, ...)` signature change in `sandbox.rs`
- Only emits `$HOME/.<agent>` subpath that matches the current `agent_binary`
- Caller in `acp.rs:acp_agent_spawn` threads the agent binary into profile generation
- Rust test: Seatbelt profile for claude-agent-acp does NOT contain `/.codex/`
- No user-visible regression (agents still work with their own configs)

**Complexity:** S **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/commands/sandbox.rs`
- `src-tauri/src/commands/acp.rs`

---

### #25 — Per-project command palette / autocomplete

**Description:** `@` mentions, `#` tags, and research (`?`) searches currently query all project indexes. Filter to `selectedProjectPaths` by default; add an "All projects" toggle.

**Acceptance criteria:**

- Command palette search functions accept a `scope: string[] | 'all'` argument
- Default scope = `selectedProjectPaths` if any selected; otherwise `'all'`
- Toggle in the palette: "Search all projects" switches to `'all'` for the current session
- Unit tests for each search mode

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/components/CommandPalette.tsx`
- `src/lib/palette-search.ts` (or wherever the search fans out)

---

### #26 — History tab project scope

**Description:** The History tab surfaces all past conversations regardless of project. Filter to conversations whose `projectPaths` intersect `selectedProjectPaths`.

**Acceptance criteria:**

- `HistoryTab.tsx`: filters conversations by `projectPaths` intersection with `selectedProjectPaths`
- "All projects" toggle shows everything (default: scoped)
- Empty state copy when no matching conversations in current scope
- Component test

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/components/chat/HistoryTab.tsx` (exact filename to verify)

---

### #27 — File-tree system-prompt injection scope

**Description:** The injected file tree in AI system prompts today covers all projects. Restrict to `selectedProjectPaths`, with a configurable depth/count cap.

**Acceptance criteria:**

- `useAIContext.ts` file tree injection respects scope
- Cap: max 200 files, max 4 directory levels (configurable in `settings-store` if useful)
- Unit tests

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/hooks/useAIContext.ts`
- `src/stores/settings-store.ts` (if caps become configurable)

---

## Phase 10 — Track 3: Correctness

### #28 — Segment boundary as message ID (not index)

**Description:** `ConversationSegment.startMessageIndex` is a numeric index into `conv.messages` that breaks with branching. Change to `startMessageId: string`. Slicing walks the active-leaf thread and stops at the ID.

**Acceptance criteria:**

- `ConversationSegment.startMessageId?: string` added; `startMessageIndex` deprecated (kept during migration)
- All slicing sites (`useAcpLifecycle.ts:626-633`, `ChatPanel.tsx:246-251`) walk ancestors using the message-id stop
- Zustand persist migration: existing conversations get `startMessageId` derived from `startMessageIndex` lookup at migration time
- Unit tests: branch from pre-switch message, slice correctness

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/stores/chat-store.ts`
- `src/hooks/useAcpLifecycle.ts`
- `src/components/chat/ChatPanel.tsx`

---

### #29 — Clean ACP turn cancellation on workspace respawn

**Description:** `useAcpLifecycle.ts:181-192` stops the old agent on workspace change but doesn't cancel the in-flight turn or drain pending permissions. Causes stale permission prompts post-respawn.

**Acceptance criteria:**

- Before `stopAcpAgent()` in the workspace-change effect, if a turn is active: `acp_session_cancel` + deny all pending permission requests + show a "context reset" chat banner
- Unit test: simulated workspace change during active turn leaves no pending permissions

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/hooks/useAcpLifecycle.ts`

---

### #30 — Attachment path activity log

**Description:** `attachedFilePaths` goes into every send with no visible trace. Log them as activity entries so the user sees what was attached.

**Acceptance criteria:**

- New `AgentActivity` with `kind: 'attachment'` entries for each attached file at send time
- Path rendered in the activity strip with a file icon
- Unit test

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/hooks/useDirectApiChat.ts`
- `src/hooks/useAcpLifecycle.ts`

---

### #31 — Tray recent files scope

**Description:** The tray menu's "recent files" currently includes files from any project. Filter to `selectedProjectPaths` plus notes root; add "All recent" submenu as opt-in.

**Acceptance criteria:**

- Tray menu construction reads `selectedProjectPaths` to filter recents
- "All recent" submenu always available as opt-in
- Unit test (or manual verification — tray code is Rust + limited test harness)

**Complexity:** S **Category:** both **Dependencies:** None **Files:**

- `src-tauri/src/tray.rs`
- `src/hooks/useTrayEvents.ts` (if frontend computes the list)

---

## Phase 11 — Verification & Documentation

### #32 — Red-team pass on all leak repros

**Description:** A disciplined walkthrough of every leak's repro steps from the two audits. Must be performed by a second engineer OR a solo run with the audits open and each repro confirmed not to reproduce.

**Acceptance criteria:**

- For each of the 22 leaks: document "attempted repro" result — "no longer reproducible" or "still reproducible (regression)"
- No Critical or High finding may remain reproducible
- Results logged in a new `docs/audits/2026-04-XX-red-team.md` file
- Any still-reproducible finding gets a follow-up task

**Complexity:** M **Category:** both (manual) **Dependencies:** All Track 1 + Track 2 tasks **Files:**

- `docs/audits/2026-04-XX-red-team.md` (new)

---

### #33 — Documentation updates

**Description:** Reflect the new isolation model in feature docs, architecture doc, and Tauri commands doc.

**Acceptance criteria:**

- `docs/features/workspace.md` — document project locks (`aiLock`), lock badge, enforcement points
- `docs/features/ai-workflows.md` — scoped approvals, activity panel auto-approved badge, cross-project mode
- `docs/features/ai-providers.md` — Copilot LSP scope, inline completion scope
- `docs/architecture.md` — per-project registries for skills/agents/MCP; narrowed Tauri capabilities; new `settings-store` flags
- `docs/tauri-commands.md` — if any command signature changed (e.g., `acp_agent_spawn` sandbox arg semantics)
- Mark this tasks file complete and tick PRD quality gates after all tasks shipped

**Complexity:** M **Category:** docs **Dependencies:** #32 (to capture final state) **Files:**

- `docs/features/workspace.md`
- `docs/features/ai-workflows.md`
- `docs/features/ai-providers.md`
- `docs/architecture.md`
- `docs/tauri-commands.md`
- `docs/prds/2026-04-18-project-data-isolation.md`
- `docs/tasks/2026-04-18-project-data-isolation-tasks.md`