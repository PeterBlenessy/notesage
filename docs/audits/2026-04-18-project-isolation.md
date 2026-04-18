# Project & Data Isolation Audit — 2026-04-18

**Scope:** Security-grade audit of project/provider/data isolation across all user actions that affect AI context. Performed against `main` at commit `ad0a997`. Research only — no code modified.

**Method:** Two sequential audit passes on the same day. The first pass covered 10 core user-action scenarios (A–J). A follow-up conversation surfaced additional concerns (approval scope, activity-panel visibility), prompting a second pass that re-validated the first pass and extended coverage to 10 additional surfaces (Copilot LSP, inline completions, skill/agent/MCP context injection, chat history, Tauri capabilities, command palette, local AI, quick capture/tray, exports). This document consolidates both passes.

**Audience:** Engineering leadership preparing a commercial release with a data-separation promise.

**Commits referenced throughout:** line numbers are as of `ad0a997`. All findings re-validated against current code; no code modified during the audit.

---

## TL;DR Verdict

**Notesage's current isolation posture is NOT adequate to back a public commercial "data separation" promise.** The architecture has strong defense-in-depth for *comment delegation* — OS-level sandbox scoped to the source project, path filter unconditionally active — but the *regular chat path*, the main user surface, unions every workspace project and explorer folder into the Seatbelt writable set via `getAllWorkspacePaths()` and disables the path filter (`pathFilterRoot = null`) whenever the caller is not comment delegation.

For direct-API connections (Anthropic/OpenAI/Ollama/local-bundled), there is **no path filtering at all** in the tool executor; the built-in `read_file` / `list_directory` tools are auto-allowed with no scope check and no pre-execution confirmation. **Copilot LSP** is hard-wired to `workspace.projects[0]` rather than `selectedProjectPaths`, and accepts `didOpen` for any file URI — the full content of any open tab is served to the LSP regardless of the chat's scope. **Skills, agents, agent-instructions, and MCP servers** are discovered into a single global registry unioning every project; their descriptions and bodies are injected into every system prompt regardless of which project is selected.

**Approval persistence is not scoped.** `toolCallAlways`, `alwaysAllowed`, and `skillScriptAlways` are stored as flat `string[]` arrays keyed only by tool name. "Always allow `write_file`" once applies forever across every project and every provider. `domainAlwaysAllowed` is keyed by `connectionId` (per-connection — good) but not by project, so a domain approved for project A flows to every future chat under that connection.

Per-project provider overrides exist in data (`ProjectMetadata.ai.provider`) but are advisory only, silently ignored in the multi-select case, and not consulted by resend/edit or comment delegation. `handleResend` always uses the *current* effective connection regardless of the original message's `connectionId`.

The data-separation story is not salvageable with cosmetic fixes; the project-scope concept needs to thread through every AI-adjacent surface: sandbox, path filter, tool executor, skill registry, permission store, command palette, tray, completions hooks. A dedicated PRD is required before any public commercial data-separation messaging.

---

## 1. Per-Scenario Findings

### Scenario A — Agent switch mid-chat (provider A → provider B) — **Partial**

When `effectiveConnection?.id` changes while messages exist, `ChatPanel.tsx:139-156` calls `setPendingAgentSwitch(newLabel, prevLabel)`; `ChatInput` is disabled until the user clicks "Start fresh" or "Include history" in `AgentSwitchCard.tsx:44-59`. `resolveAgentSwitch` in `chat-store.ts:749-764` pushes a new `ConversationSegment` with `startMessageIndex = c.messages.length` and `historyIncluded = <user choice>`. At send time, `ChatPanel.tsx:244-251` and `useAcpLifecycle.ts:626-633` slice the message history by `segment.startMessageIndex` when `historyIncluded === false`, so the wire-level prompt to provider B does NOT include pre-switch messages.

**Partial because:**
- ACP agent processes are not stopped on connection change — `stopAcpAgent` is only invoked on workspace-scope change (`useAcpLifecycle.ts:187-191`) or hard errors. When the user switches *within* the same authMethod='agent_managed' connection group, `ensureAcpAgent` at `acp-agent-state.ts:250` detects the connection-ID change and calls `acp_agent_stop` — good. When switching between *direct API* providers, no cleanup is triggered; the old listeners are torn down naturally when the next `sendChatMessage` starts. Acceptable.
- The `conversation-history` block that ACP prepends to the first prompt of a new session (`useAcpLifecycle.ts:638-649`) re-reads `conv?.messages` (full tree, not thread). Segment slicing is applied, so "Start fresh" is respected — but if a user clicked "Start fresh" and then *branched from a pre-switch message*, the new segment's `startMessageIndex` still equals the conversation-length at switch time, not the thread index; the slice may drop the wrong messages. Low severity in practice, still a correctness gap.
- `ChatMessage.connectionId / connectionProvider` is snapshotted on the assistant message (`useDirectApiChat.ts:125-128`, `useAcpLifecycle.ts:503-505`), but it's a display-only field. Nothing reads it at send time.

Cites: `src/components/chat/ChatPanel.tsx:137-156,244-251`; `src/stores/chat-store.ts:719-764`; `src/hooks/useAcpLifecycle.ts:626-649`; `src/components/chat/AgentSwitchCard.tsx`.

### Scenario B — Selecting / adding an Explorer folder — **Leak (Critical)**

`workspace-store.ts:90-104` adds the new path to `explorerFolders`. `useAcpLifecycle.ts:181-192` observes `workspaceProjects` and `workspaceExplorerFolders`, computes a sorted join key, and when it changes calls `stopAcpAgent()`. The next `acpSendChatMessage` (or eager-session effect) calls `ensureAcpAgent(connection, cwd, getAllWorkspacePaths())`.

That is the leak: `getAllWorkspacePaths()` in `src/lib/ai/acp-utils.ts:516-522` unions *every* project in `workspaceStore.projects` and *every* folder in `workspaceStore.explorerFolders`. The result is passed as the `sandboxPaths` arg to `ensureAcpAgent` (line 257 eager, line 546 in `acpSendChatMessage`, lines 789 & 798 in `retryWithRestore`), which forwards it to the Rust `acp_agent_spawn` command as `sandboxPaths`. `sandbox.rs:35-43` renders every path as a `(subpath "...")` writable entry in the Seatbelt profile. **The OS kernel therefore grants the agent subprocess read/write access to every project and explorer folder you have open, regardless of which one is selected in the chat footer.** Adding a sensitive folder to Explorer gives a running agent immediate write access after the respawn.

For direct-API chats, sandbox paths are moot (no OS sandbox), but the tool-executor (`src/lib/tool-executor.ts:213-239`) still allows `list_directory` / `read_file` / `write_file` to touch any absolute path — and with `read_file` / `list_directory` auto-allowed (`permission-store.ts:277-278`) there is *no* prompt and *no* log event the user can see.

Cites: `src/lib/ai/acp-utils.ts:516-522`; `src/hooks/useAcpLifecycle.ts:257,546,789,798`; `src/lib/ai/acp-agent-state.ts:312-326`; `src-tauri/src/commands/sandbox.rs:35-43,101`; `src/lib/tool-executor.ts:213-239`; `src/stores/permission-store.ts:277-278`.

### Scenario C — Selecting a project folder in the chat footer — **Leak (High)**

Selecting a project in `ChatFooter.tsx:109-147` only updates `conv.projectPaths` via `toggleProjectPath` / `setSelectedProjectPaths`. Because `ChatPanel.tsx:113-135` watches `selectedProjectPaths` length changes, a new pending project switch fires after the first message — but *the sandbox scope is never re-narrowed.* At prompt-send time, `useAcpLifecycle.ts:546`:

```typescript
const sandboxScope = opts?.sandboxPaths ?? getAllWorkspacePaths();
```

The agent's sandbox is the union of everything in the workspace. Selecting "only project A" in the footer does not restrict filesystem scope — project B, C, the entire Explorer tree — still writable. The footer's project list affects only:
- The `cwd` (`selectedProjectPaths[0] || '/tmp'`) passed to the ACP session,
- The project header injected into the system prompt (`useAIContext.ts:79-103`),
- The provider override lookup (`useAIOperations.ts:46-53`) which only activates when exactly ONE project is selected.

The `pathFilterRoot` that would apply `isToolCallAllowed` is wired in `useAcpLifecycle.ts:509`:

```typescript
const pathFilterRoot = opts?.sandboxPaths ? (selectedProjectPaths[0] || null) : null;
```

Regular chat calls don't pass `opts.sandboxPaths` (see `ChatPanel.tsx:228-230` — `sandboxPaths` is set *only* for `sourceCommentId` conversations). So for normal chat, `pathFilterRoot = null` and the soft path filter in `useAcpSessionListeners.ts:300-312` is never evaluated. The agent can call `read` / `write` / `bash` against any workspace path and the permission listener auto-approves.

Cites: `src/hooks/useAcpLifecycle.ts:509,544-547`; `src/components/chat/ChatPanel.tsx:224-232`; `src/hooks/useAcpSessionListeners.ts:299-312`; `src/components/chat/ChatFooter.tsx:109-147`; `src/hooks/useAIOperations.ts:46-53`.

### Scenario D — Opening new notes / documents — **Leak (Medium)**

`useChatContext.ts:24-39` *always* publishes the currently-active editor tab's file path as an attachment item in `attachedFilePaths`. Every send plumbs that list into the system prompt builder (`useAIContext.ts:105-112`: `File in context: ${filePath}`). This is a data exposure, not a sandbox break, but the user is never told that opening *any* file anywhere on disk — including outside all projects — injects the absolute path into the next prompt they send to the AI. For a user who opens a confidential non-project file (e.g. `~/Documents/legal/nda.md`) and happens to send any chat message, the file path (not content, just the path) is exfiltrated to the provider.

For local models, `useAIContext.ts:150-160` hard-codes `Currently editing: ${activeTab.filePath}` into `localSystemMessage` with *no way to dismiss it*. The dismiss button only lives on the pill UI feeding `attachedFilePaths`; the local path goes direct from the editor-store.

Comment delegation (`useAgentTaskOperations.ts:289`) correctly uses `taskMeta?.projectRoot` — not the open tab — so the delegated agent sees only the source-comment's project. This scenario is chat-only.

Cites: `src/hooks/useChatContext.ts:24-49`; `src/hooks/useAIContext.ts:105-112,150-160`; `src/components/chat/ChatPanel.tsx:101,232`.

### Scenario E — Attaching files/images to a chat message — **Partial**

Image attachments live on `ChatMessage.attachments` (`types.ts:170`) and are serialized as base64 by `useDirectApiChat.ts:54-56` / `useAcpLifecycle.ts:656-658`. They travel with the message forever; there is no "forget attachment after segment boundary" logic.

**Partial because:**
- Segment filtering (`useAcpLifecycle.ts:630-633`, `ChatPanel.tsx:246-251`) slices `conversationMessages` by `startMessageIndex` when `historyIncluded === false`, so attachments from previous segments ARE dropped from the next API call. Good.
- But the Rust serialization in `useDirectApiChat.ts:49-58` (`mapMessagesForRust`) ships the full `ChatMessage.attachments` array for every message it forwards. If a user switches provider, chooses "Include history", the embedded base64 image payload is re-sent to the new provider verbatim. That's expected behaviour when the user opts in — no hidden leak.
- The attachment pipeline has no awareness of vision capability at reserialization time; `useAcpLifecycle.ts:656-658` sends images on every retry even if the agent has changed to a non-vision one. Display bug, not a leak.

Cites: `src/lib/ai/types.ts:170`; `src/hooks/useDirectApiChat.ts:49-58`; `src/hooks/useAcpLifecycle.ts:656-658`; `src/components/chat/ChatPanel.tsx:244-253`.

### Scenario F — Branching a chat — **Partial**

Leaf-branch with `session.fork` capability calls `tauriApi.acpSessionFork` (`ChatMessageList.tsx:195-207`) and stores the new `session_id` on `Conversation.branchSessions` keyed by the branch's first message id. `getSessionIdForLeaf` in `chat-store.ts:964-980` walks ancestors to resolve the active branch's session. Historical-branch (non-leaf) branches share `conv.acpSessionId` — acknowledged by design in CLAUDE.md.

**Partial because:**
- Branching does NOT respawn the agent. The running agent's sandbox scope (still `getAllWorkspacePaths()`) is inherited. A user who branches from "project A" to "project B" does not get a new sandbox profile scoped to B.
- Branching does NOT swap providers. If the branch point is in a provider-A segment but the current effective connection is provider-B, the `sendChatMessage` call (which fires after the user types their first branch message) routes through the *current* `effectiveConnection`, not the segment's original provider. No warning.
- `getSessionIdForLeaf` walks ancestors but doesn't cross segment boundaries — a forked session from segment N + a subsequent agent-switch (new segment M) would send to the fork session of a provider the agent process may no longer be running. The "stale session" error handler at `useAcpLifecycle.ts:701-710` catches most of these with a user-friendly "session expired" message.

Cites: `src/components/chat/ChatMessageList.tsx:185-219`; `src/stores/chat-store.ts:660-673,964-980`; `src/hooks/useAcpLifecycle.ts:701-710`.

### Scenario G — Resending / editing a previous user message — **Leak (Medium)**

`ChatPanel.tsx:256-263`:
```typescript
const handleResend = useCallback((message: { id?: string; parentId?: string | null; content: string }) => {
  if (!hasAIProvider) return;
  if (message.id) {
    useChatStore.getState().deleteMessageAndDescendants(message.id);
  }
  handleSend(message.content);
}, [hasAIProvider, handleSend]);
```

`handleSend` reads `effectiveConnection` from the current store state — never from the message's `connectionId`. The message's `connectionId` / `connectionProvider` fields (snapshot at generation time, `types.ts:145-150`) are display-only. So resending an assistant message originally produced by provider A, while the chat is currently set to provider B, sends the prompt to B with no warning.

Edit flow (`ChatPanel.tsx:265-268` → `sendOpts.parentId`) has the same behaviour: the user message is re-submitted to whatever provider is currently selected. For a legal workload where project X *must* use Claude, nothing prevents the user from editing an older message while routed to a non-Claude connection, and the rewrite goes to that connection. No "this project is locked to X" enforcement (see Scenario J).

Cites: `src/components/chat/ChatPanel.tsx:256-268,175-254`; `src/hooks/useAIOperations.ts:134-146`; `src/lib/ai/types.ts:145-150`.

### Scenario H — Tool call path filtering — **Leak (High)**

`src/lib/ai/path-filter.ts:171-215` is a reasonable "well-behaved agent" soft filter: it parses common path fields from structured tool input, scans bash commands with a regex, and checks against a `projectRoot` + safe-dir allowlist. The checker is correct. The problem is *where it runs*.

- **ACP chat path** (`useAcpSessionListeners.ts:299-312`): only runs when `deps.pathFilterRoot` is truthy. `pathFilterRoot` is set in `useAcpLifecycle.ts:509` as `opts?.sandboxPaths ? (selectedProjectPaths[0] || null) : null`. `opts.sandboxPaths` is ONLY populated for comment-sourced conversations (`ChatPanel.tsx:228-230`). **For regular chat, the path filter is completely disabled.**
- **Comment delegation ACP path** (`useAgentTaskOperations.ts:450-466`): runs when `cwd` is set and not `/tmp`. This is the only place the filter actually fires for real users. Correct.
- **Direct API path** (`src/lib/tool-executor.ts:213-239`): *no path filter at all*. `read_file`, `list_directory`, `write_file` dispatch directly to Tauri `read_file`/`write_file`/`list_files_shallow` with whatever absolute path the model sends. Because `read_file` and `list_directory` are hard-coded as auto-allowed (`permission-store.ts:277-278`), the user is never even shown a permission card. Silent disk read of arbitrary absolute paths.

Cites: `src/lib/ai/path-filter.ts`; `src/hooks/useAcpSessionListeners.ts:299-312`; `src/hooks/useAcpLifecycle.ts:509`; `src/hooks/useAgentTaskOperations.ts:450-466`; `src/lib/tool-executor.ts:213-239`; `src/stores/permission-store.ts:277-278`.

### Scenario I — OS-level sandbox (Seatbelt) paths — **Leak (Critical)**

The kernel-level sandbox profile is generated in `src-tauri/src/commands/sandbox.rs:19-157`. The `writable_block` (line 35-43) is built directly from the `writable_paths: &[String]` arg, each as `(subpath "...")`. The Rust side is implementation-faithful. The leak is upstream:

`acp_agent_spawn` in `acp.rs:1110-1112`:
```rust
let writable_paths = sandbox_paths
    .unwrap_or_else(|| vec![working_directory.clone()]);
```

So the writable paths are whatever the *frontend* passes. The frontend passes:
- Eager session spawn — `sandboxScope = getAllWorkspacePaths()` — **every project + every explorer folder**
- First user-prompt send — same
- Retry with restore — same
- Inline actions (`acpGenerateText`) — `[cwd]` only (correct)
- Comment delegation (`ensureTaskAgent`) — `[cwd]` only (correct)

The consequence: **a fresh spawn of the chat agent has kernel-level write access to every open project and explorer folder.** With six projects + three explorer folders open, the agent physically can `echo hacked > /Users/peter/other-project/secrets.md` — Seatbelt will permit it because that subpath is in the allow-list. The fact that the path filter (scenario H) is disabled for regular chat means there's no second layer catching it either.

Additionally, the sandbox *also* writes to `$HOME/.notesage`, `$HOME/.claude`, `$HOME/.codex`, `$HOME/.copilot`, `$HOME/.gemini`, `$HOME/.config` by blanket `(subpath ...)` (`sandbox.rs:106-111`). That's independent of user scope and fine for agent configs, but it means every agent can write to every other agent's config dir too.

Cites: `src-tauri/src/commands/sandbox.rs:19-157`; `src-tauri/src/commands/acp.rs:1090-1112`; `src/hooks/useAcpLifecycle.ts:257,546,789,798`; `src/lib/ai/acp-utils.ts:516-522`; `src/lib/ai/acp-agent-state.ts:312-326`.

### Scenario J — Per-project provider overrides — **Leak (High)**

`ProjectMetadata.ai.provider` holds a connection ID (or legacy provider name). The enforcement story:

- `useAIOperations.ts:46-53`: `effectiveConnection` consults `singleMetadata?.ai.provider` ONLY when exactly one project is selected. Multi-select projects with different overrides triggers a toast and forces selection to the single project (`ChatFooter.tsx:116-126,141-144`) — good. But multi-select where one project has an override and others have none silently ignores the override and uses global `interactiveConnection`.
- Global routing (`useRoutingStore`) is the fallback. Nothing enforces "this project MUST use X" at send time. A user who deselects the project, chats with a different provider, then reselects the project, is not warned.
- Inline actions (bubble menu), resend, edit, comment delegation all flow through different code paths that read `effectiveConnection` at call time — which respects the override only under the single-project condition. Comment delegation uses a different `taskConnection` from `useRoutingStore.routing.agent_tasks` (`useAgentTaskOperations.ts:700+`); no per-project override lookup in the task path.
- There is no "provider lock" bit on the metadata — `ai.provider` is described as a default/override in code. No UI affordance makes it a hard lock.

So: **per-project provider override is advisory only, and only activates in the single-project-selected case. It cannot back a legal commitment.**

Cites: `src/hooks/useAIOperations.ts:46-53,56-92`; `src/components/chat/ChatFooter.tsx:106-147`; `src/stores/project-metadata-store.ts:9-15`; `src/hooks/useAgentTaskOperations.ts` (taskConnection resolution via routing).

### Scenario K — Copilot LSP chat path — **Leak (Critical)**

`src/hooks/useCopilotCompletion.ts:37` and `src/hooks/useCopilotChat.ts:73` both hard-code:

```typescript
const workingDir = projects[0]?.path ?? null;
```

`projects[0]` is the **first** project in `workspace-store.projects` — completely disconnected from `selectedProjectPaths` (the chat-footer project selector). When the LSP is initialised via `copilot_lsp_start(workingDir)`, the Rust side sends an `initialize` request with that path as the sole `workspaceFolders[0]` (`copilot_lsp.rs:323-330`). So:

- If user has projects `[A, B, C]` open, Copilot LSP is always scoped to A regardless of which project the user selects in the footer.
- When the user opens a tab in project C and types, `textDocument/didOpen` (`useCopilotCompletion.ts:126-131`) fires with the full tab content — the LSP accepts any file URI and the server sees project C's document with project A's workspace context.
- The LSP conversation sees even more — `useCopilotChat.ts:580-583` calls `copilot_lsp_did_open` with the active tab's content on every chat send, and `useCopilotChat.ts:524-545` responds to `copilot/context-request` by handing over the active tab's full content and languageId. None of this checks `selectedProjectPaths`.
- Tool calls registered for Copilot conversations use the same `getToolDefinitions()` as direct-API (`useCopilotChat.ts:384`) → inherits Scenario H and the auto-allow issue verbatim.

**Repro:** Connect Copilot LSP. Open projects A and B. Active tab is `A/notes.md`. Open `B/confidential.md` as an additional tab, focus it, type. Ghost text completion request sent; entire content of `B/confidential.md` is in the LSP's in-memory doc store, served as `didChange` payload.

Cites: `src/hooks/useCopilotChat.ts:73,580-583,524-545`; `src/hooks/useCopilotCompletion.ts:37,112,126-131`; `src-tauri/src/commands/copilot_lsp.rs:323-330,875-912`.

### Scenario L — Inline completions (all providers) — **Leak (High)**

`src/hooks/useLocalCompletion.ts:80-101` extracts `fullPrefix` and `fullSuffix` (bounded by `fimContextChars`, default 500 chars) from the *active tab* and ships them to whichever provider is in the `inline_completion` slot. No check that `activeTab?.filePath` lives under any selected project or even under any workspace project:

- `useLocalCompletion` activates for `local` (Ollama), `local_bundled`, or `openai_compatible` — all of which send file content to external endpoints (Ollama to whatever URL the user configured, OpenAI-compatible to arbitrary `baseUrl`).
- `useCopilotCompletion.ts:126-131` sends the FULL document via `didOpen`, not just the FIM window. Confidentiality exposure is total.
- No per-project opt-in / opt-out for inline completions.
- `inlineCompletionsDisabled` is a per-tab flag stored in `settings-store` — the user must remember to disable completions on every sensitive tab manually.

**Repro:** Set `inline_completion` slot to Ollama. Open `~/Personal/diary.md` (not in any project). Ghost-text requests go to Ollama, shipping ~1000 characters of context per keystroke.

Cites: `src/hooks/useLocalCompletion.ts:80-101,122-130`; `src/hooks/useCopilotCompletion.ts:122-131,218-222`.

### Scenario M — Skills / Agents / Agent-instructions / MCP context injection — **Leak (High)**

Multi-part leak, all centred on the "union everything across the whole workspace into a single registry that gets injected into every system prompt" pattern.

**M.1 Skills discovery** (`src/hooks/useSkillOperations.ts:69-141` `buildDiscoveryDirs`):

```typescript
baseDirs.push(`${home}/.notesage/skills`);
for (const project of projects) {
  baseDirs.push(`${project.path}/.notesage/skills`);
}
```

All projects' `.notesage/skills` dirs + all connected providers' skill dirs (`~/.claude/skills`, etc.) are scanned into a single `skills[]` array in `skill-store`. `getActiveSkills()` (`skill-store.ts:296-314`) returns all of them deduplicated by name, with no filter on the selected project. `getSkillDescriptionsForPrompt()` (line 320-334) and `getNotesageSkillDescriptionsForPrompt()` (line 336-346) are called by `buildComposedSystemMessage` / `buildAcpSystemMessage` — **every chat turn injects every skill description from every project.**

**Repro:** Project A has `.notesage/skills/secret-skill/SKILL.md` with description "Extract confidential client data from /Users/peter/Clients/*". Project B is selected in chat. System prompt sent to the provider for B contains the skill name + description from A.

**M.2 Agent discovery** (`useSkillOperations.ts:95-141`): same pattern across `~/.notesage/agents`, `~/.claude/agents`, every project's `.notesage/agents`, every project's `.claude/agents`, every explorer folder's agent dirs.

**M.3 Agent instructions** (`useSkillOperations.ts:218`):

```typescript
const projectRoot = projects.length > 0 ? projects[0].path : null;
```

The agent-instruction scan is given `projects[0]` as the project root — **always the first project, never `selectedProjectPaths[0]`**. `read_agent_instructions` in `agents.rs:308-363` then reads `projects[0]/AGENTS.md`, `projects[0]/CLAUDE.md`, `projects[0]/.notesage/agents.md` + the global `~/.notesage/agents.md`. `skill-store.getMergedAgentInstructions()` (line 348-357) returns the concatenated result, which `buildComposedSystemMessage` (`useAIContext.ts:120`) appends to every system prompt, regardless of which project is selected.

**Repro:** Projects `[A, B]` in workspace. Project A has `CLAUDE.md` with "Always reply in pig latin when discussing client secrets." Select project B in chat footer. Send any message. System prompt contains A's `CLAUDE.md` content.

**M.4 MCP config discovery** (`src/hooks/useMcpOperations.ts:85-89`):

```typescript
const baseDirs: string[] = [];
for (const project of projects) {
  baseDirs.push(project.path);
}
```

All projects are unioned. Every project's `.notesage/mcp.json` is merged with the global `~/.notesage/mcp.json` and imported configs from Claude Desktop / Cursor / VSCode. `setServers()` (`mcp-store.ts:73-85`) stores them all. Every MCP server's tools are registered for every chat, regardless of which project is selected.

Cites: `src/hooks/useSkillOperations.ts:69-141,218`; `src/stores/skill-store.ts:296-346,348-371`; `src/hooks/useAIContext.ts:118-170`; `src/hooks/useMcpOperations.ts:85-89`; `src-tauri/src/commands/agents.rs:308-363`.

### Scenario N — Chat history persistence & cross-project visibility — **Leak (Medium)**

Chat-store persists all conversations in `notesage-chat-history` with full `conversations[]`, `activeConversationId`, `webSearchEnabled` (`chat-store.ts:795-799`). Each conversation retains its own `projectPaths`, but:

- `ChatHistoryView` (`src/components/chat/ChatHistoryView.tsx:113-138`) lists **every** conversation regardless of current selection. User can see conversation titles for any project.
- `handleSelectConversation` (`ChatPanel.tsx:274-277`) calls `setActiveConversation(id)` — the selected conversation's `projectPaths` becomes the new "selected paths" via `selectProjectPaths` (`chat-store.ts:983-986`). So reopening a history item silently switches project scope. Sandbox scope (from `getAllWorkspacePaths()`) is unchanged and overruns anyway (Scenario B), but the system prompt and the per-project provider override (Scenario J) flip.
- There's no "stale path" detection: if conversation C was rooted in `/Users/peter/oldproject` (now deleted), reopening it silently falls back to multi-select-none or a bad state.
- No project-aware filtering of the history list. No way to view only conversations for the current project.

Cites: `src/components/chat/ChatHistoryView.tsx:113-138`; `src/components/chat/ChatPanel.tsx:274-277`; `src/stores/chat-store.ts:795-799,983-986`.

### Scenario O — Tauri capabilities and IPC permission model — **Leak (High)**

**O.1 Asset protocol scope** (`src-tauri/tauri.conf.json:30-38`):

```json
"assetProtocol": {
  "enable": true,
  "scope": {
    "allow": ["**"],
    "requireLiteralLeadingDot": false
  }
}
```

`**` means the Tauri asset protocol serves any file on disk. `convertFileSrc` (`src/lib/image-utils.ts:1`) wraps arbitrary paths into `http://asset.localhost/...` URIs. Intended for displaying local images in the editor, but there's no scope restriction: a rogue link in a .md file like `![a](../../../.ssh/id_rsa)` would happily serve the key content via the webview (if the renderer could be coerced into constructing the URI). Risk is mitigated by requiring user action to view, but the surface is unbounded.

**O.2 Tauri FS plugin grants** (`src-tauri/capabilities/default.json:11-18`):

```json
"fs:allow-read-text-file", "fs:allow-write-text-file", "fs:allow-read-dir",
"fs:allow-exists", "fs:allow-create", "fs:allow-mkdir",
"fs:allow-rename", "fs:allow-remove"
```

No `fs:scope` restriction. The frontend currently doesn't import `@tauri-apps/plugin-fs` (verified via grep), but the capability is granted. If ANY code path in the webview (including a compromised third-party dependency) were to load `@tauri-apps/plugin-fs`, it would have unrestricted read/write access to the filesystem — without going through our Rust `read_file` / `write_file` / `list_directory` command layer. Defence-in-depth failure: our custom commands can be bypassed.

**O.3 HTTP scope is narrow, but asset protocol + fs plugin undoes it.** `http:default` only allows `github.com/PeterBlenessy/notesage/**` — good. But a renderer-side HTTP request is not the attack surface here; the fs plugin is.

Cites: `src-tauri/tauri.conf.json:30-38`; `src-tauri/capabilities/default.json:11-18`.

### Scenario P — Active tab / editor context extended injection — **Partial (extends Scenario D)**

`buildProjectContext` in `useAIContext.ts:76-115` injects into every system prompt:

- When exactly one project is selected:
  - Project header via `buildProjectHeader` (name + path + description)
  - Goals context from `useGoalsDiscovery(singleProjectPath)` — correctly scoped
  - File tree from `singleProject?.fileTree` — also correctly scoped, but reveals every file name in the project (including things like `.private/notes.md`)
- When multi-select:
  - Summary of every selected project with name + root + description (`useAIContext.ts:91-102`)
  - Goals discovery disabled (only runs on single-project)
  - No file tree injection
- Always:
  - `File in context: <filePath>` from `attachedFilePaths` (Scenario D — active tab auto-attached)
  - Fallback: `Currently editing: <activeTab.filePath>` when no explicit attachments

**New finding:** The file-tree injection (`buildFileTreeContext` called at line 88) exposes the complete recursive filename listing of the selected project to the model. This is acceptable when the user knows one project is selected, but surprising (no UI indicator of what's being sent). For a project with hundreds of files, this is a massive system-prompt bloat that few users would anticipate.

Project metadata header at `useAIContext.ts:81-84` pulls `singleMetadata` — whose `description` field is user-editable but WILL be sent on every turn.

Goals discovery (`useGoalsDiscovery`) scans the selected project for files with `type: goal` frontmatter. When multi-project is selected, this scan is skipped — so goals from the pre-multi-select single-project state do not leak, but the user is also not shown that goals are disabled in multi-select.

Cites: `src/hooks/useAIContext.ts:76-115,118-127,164-169`; `src/lib/ai/context.ts`.

### Scenario Q — SQLite document index scope (callers don't enforce) — **Partial**

Backend (`src-tauri/src/index/mod.rs:626-849`) correctly accepts `project_paths: Vec<String>` for every query command — the Rust side IS scope-aware.

**But** the frontend callers union everything:

- `CommandPalette.tsx:149,199` — calls `getSearchPaths()` which (`command-palette.ts:102-110`) returns `[...explorerFolders, ...projects, notesRoot]`. Tag/mention/content/research queries all union everything.
- `mention-suggestion.tsx:192`, `tag-suggestion.tsx:201` — same pattern; autocomplete across all projects.

**Consequence:** When user is chatting in project A and types `#` in the command palette, they see tags from project B. Typing `@` suggests mentions from project B. Research search returns articles from project B. FTS5 content search surfaces project B content snippets.

This is arguably a feature for knowledge-worker use cases, but it completely ignores the "selected project" concept. A user who has compartmentalised work by project would be shocked that the palette exposes everything.

For AI delegation specifically: if a model calls `search-research` skill (bundled), the skill's `search.mjs` accepts dirs as arguments. Whatever the model passes is searched. No scope filter. The model has (via the system prompt via agent-instructions leak M.3) visibility into every project path. Combined with Scenario H (tool-executor has no path scope), the model can drive this into a full cross-project read.

Cites: `src/components/CommandPalette.tsx:149,199`; `src/lib/command-palette.ts:102-110`; `bundled-skills/search-research/scripts/search.mjs:34-42`.

### Scenario R — Local AI (bundled llama-server) chat — **Leak (inherits Scenario H)**

`local_bundled` connections route through `useDirectApiChat` → same tool-executor → same unchecked `read_file` / `write_file`. "Privacy-focused offline inference" in marketing, but on the server inside the Notesage process the tool can read any file. The privacy claim is about the NETWORK surface (nothing leaves localhost) — the LOCAL filesystem surface is as porous as any provider. Worth flagging in marketing language.

FIM endpoint `/infill` at `local_inference.rs` receives prefix/suffix from `useLocalCompletion` — same no-scope issue from Scenario L.

No additional new leaks vs direct API. Severity matches Scenarios H, L.

### Scenario S — Quick capture / system tray — **Leak (Low)**

`src-tauri/src/tray.rs:113-128` builds a "Recent" submenu from whatever file paths the frontend pushes via `update_tray_recent`. `src/hooks/useTraySync.ts:21-32` pulls the last 5 tabs:

```typescript
const recentFiles = tabs.filter((t) => t.filePath).slice(-5).reverse().map(...)
```

Zero project scope. Every file path that was ever open in the app is a candidate. If the user had a tab open in project B (now closed but still in the tabs array if pinned) or an ad-hoc tab in `~/Desktop`, it shows up in the tray menu — visible to anyone looking at the user's menu bar. Minor privacy leak, not a data-exfiltration vector.

Tray menu events (`useTrayEvents.ts`) simply forward `tray-open-file` to `onOpenFile(path)` — the file opens as a new tab, not a new chat, so no AI implications.

Cites: `src-tauri/src/tray.rs:113-128`; `src/hooks/useTraySync.ts:21-32`.

### Scenario T — Export operations — **Partial (acknowledged pre-existing)**

`export_pdf` / `export_docx` / `export_pptx` / `render_html` accept `project_root: Option<String>` from the caller. `resolve_drawing_svgs` (`export.rs:490-513`) reads arbitrary paths under `project_root`. Image references in markdown (e.g., `![](/Users/peter/Desktop/secret.png)`) are embedded via comrak / typst / docx-rs pipelines. No scope filter on image paths — whatever the markdown says gets read and embedded.

Low concern for data SEPARATION (the export is user-initiated and the resulting file is local). But it IS worth flagging: a malicious markdown file shared by a collaborator could embed `![](../../../.aws/credentials)` — export the document and the bytes of the credential file are silently embedded in the PDF/DOCX. No scope check, no user warning.

**Severity: Medium.** Not strictly a project-isolation issue, but it's a cross-scope file read.

Cites: `src-tauri/src/commands/export.rs:15-143,490-513`.

### Scenario U — Approval persistence scope (from follow-up conversation) — **Leak (Critical)**

`permission-store.ts:310-315` persists approvals as flat arrays of tool names:

```typescript
alwaysAllowed: string[]
toolCallAlways: string[]
skillScriptAlways: string[]
```

None are keyed by `(toolName, connectionId, projectRoot)`. "Always allow `write_file`" once → applies forever in every project, under every provider, for every chat. The `isAutoAllowed(tool)` check at `permission-store.ts:277-278` is a single-parameter lookup — no scope awareness.

Only `domainAlwaysAllowed` is keyed by `connectionId` (a `Record<string, string[]>` at line 36-39). That's per-connection, not per-project — a domain approved for project A under Claude Code flows to every future chat under that connection, regardless of which project is selected.

**Repro:** In project A with Claude Code, approve "Always allow write_file for this action" on a tool-call permission card. The persisted `toolCallAlways` now contains `"write_file"`. Switch to project B (no lock) and chat with Ollama. Model requests `write_file` — auto-approved silently, no prompt.

### Scenario V — Auto-approval surface (from follow-up conversation) — **Revised Medium**

Initial v1 finding claimed auto-approved tool calls leave no activity panel trace. Re-validation: the direct-API path at `useDirectApiChat.ts:281` DOES call `addActivity`, and the ACP path at `useAcpSessionListeners.ts:314-320` does too via the `tool_call` session update at line 151. So auto-allowed tool calls DO appear in the activity panel.

**Still a leak, just narrower:**
- No user-visible distinction between auto-approved and user-approved entries
- No pre-execution notification (user sees the call only after it completes)
- All five auto-allowed names (`read_file`, `read_skill_content`, `list_directory`, `web_search`, `list_comments`) are hard-coded in `permission-store.ts:277-278` and cannot be scoped by project or connection

**Severity revised High → Medium.** Track 1 still owns this because the permission-scope issue (Scenario U) swallows it.

---

## 2. Consolidated Leak Inventory

| # | Where | What | Severity | Repro | Fix |
|---|---|---|---|---|---|
| 1 | `src/lib/ai/acp-utils.ts:516-522` used at `useAcpLifecycle.ts:257,546,789,798` | `getAllWorkspacePaths()` unions all projects + explorer folders into the Seatbelt writable set passed to `acp_agent_spawn`. Kernel sandbox for chat agents is the entire workspace, not the selected project. | **Critical** | Open projects A and B. Select only A in chat footer. Ask the ACP agent to `echo test > /path/to/B/file`. Succeeds. | Compute sandbox scope from `selectedProjectPaths` (plus optionally `extraWritablePaths`). Respawn on selection change. Opt-in "cross-project mode" for power users. |
| 2 | `src/hooks/useAcpLifecycle.ts:509` (`pathFilterRoot` gate) | Soft path filter in `useAcpSessionListeners.ts:299-312` is disabled for all non-comment-sourced chats. | **Critical** | Regular ACP chat; request `read_file` with a path outside the selected project. No filter fires; permission listener auto-approves. | Set `pathFilterRoot = selectedProjectPaths[0]` unconditionally. Multi-root filter for multi-select. Apply `isToolCallAllowed` before auto-approval. |
| 3 | `src/lib/tool-executor.ts:213-239` | Direct-API tool calls (`read_file`, `list_directory`, `write_file`) issue raw Tauri commands with no path scoping. | **Critical** | Configure any direct-API connection. Ask assistant to read `/Users/peter/.ssh/id_rsa`. Auto-allowed, returned verbatim. | Run `isToolCallAllowed` before dispatching. Refuse on deny. Thread scope via parameter. Extend multi-project. |
| 4 | `src/stores/permission-store.ts:277-278,310-315` (Scenario U) | `toolCallAlways` + `alwaysAllowed` + `skillScriptAlways` persisted as flat `string[]`; not keyed by `(toolName, connectionId, projectRoot)`. | **Critical** | "Always allow write_file" in project A under Claude applies in project B under Ollama. | Change persisted shape to scoped triples. Migrate existing string[] on first launch into a "global fallback" bucket the user can review. Surface scope on permission card. |
| 5 | `src/hooks/useCopilotChat.ts:73`, `useCopilotCompletion.ts:37` (Scenario K) | Copilot LSP working directory hard-coded to `projects[0]` — not `selectedProjectPaths`. Accepts `didOpen` for ANY file URI. | **Critical** | Connect Copilot LSP. Open projects A and B. Focus tab in B. LSP sees B's full content with A as the workspace. | Gate LSP document sync on `selectedProjectPaths`. Reject `didOpen` for out-of-scope paths. Respawn LSP on selection change. |
| 6 | `src-tauri/src/commands/sandbox.rs:101-111` via `useAcpLifecycle.ts` (Scenario I) | Kernel-level sandbox writable paths include all workspace projects + explorer folders. (Same root cause as #1; called out as a separate kernel-level consequence.) | **Critical** (duplicate of #1) | Same as #1. | Fixed via #1. Listed for audit completeness — no separate fix. |
| 7 | `src/components/chat/ChatPanel.tsx:256-263` + `src/hooks/useAIOperations.ts:134-146` (Scenario G) | Resend / edit always use the current `effectiveConnection`, ignoring the original message's `connectionId`. | **High** | Produce message with provider A. Switch to B with "Start fresh". Edit or resend the A-era message. Goes to B. | Read message's `connectionId` at resend/edit. Confirm on mismatch. Block if aiLock. |
| 8 | `src/hooks/useAIOperations.ts:46-53` + `src/components/chat/ChatFooter.tsx:109-147` (Scenario J) | Per-project provider override only applies when exactly one project is selected. No "lock" semantics — advisory. | **High** | Project A has `ai.provider = claude-conn`. User multi-selects A + B. `effectiveConnection` silently falls back to global routing. | Add `aiLock: boolean` to `ProjectMetadata`. Enforce at every send path. |
| 9 | `src/hooks/useLocalCompletion.ts:80-101`, `useCopilotCompletion.ts:122-131` (Scenario L) | Inline completions send active-tab content to configured provider regardless of project scope. | **High** | Open `~/Personal/diary.md` (not in any project). Ghost-text requests go to Ollama/Copilot, shipping content. | Default completion hooks to no-op for tabs outside scope. Opt-in required for other paths. |
| 10 | `src/hooks/useSkillOperations.ts:78-80,218`; `src/stores/skill-store.ts:296-346` (Scenario M) | Skills / agents / agent-instructions discovery UNIONS all projects. `read_agent_instructions` called with `projects[0]`. | **High** | Project A's `CLAUDE.md` appears in project B's system prompt. Project A's skill descriptions visible in project B. | Thread `selectedProjectPaths` through discovery. Per-project registries. Fix caller to use `selectedProjectPaths[0]`. |
| 11 | `src/hooks/useMcpOperations.ts:85-89` (Scenario M.4) | MCP configs from every project are unioned. Every MCP server's tools available in every chat. | **High** | Project A has an MCP server with a `delete_all` tool. Project B's chat sees it and can call it. | Per-project MCP registry. Scope server auto-start to selected projects. |
| 12 | `src-tauri/tauri.conf.json:30-38` + `src-tauri/capabilities/default.json:11-18` (Scenario O) | `assetProtocol.scope.allow = ["**"]` + unscoped `fs:allow-*` plugin grants. | **High** | N/A (surface exists even though not currently reachable from the webview). | Narrow `assetProtocol.scope.allow`. Drop `fs:allow-*` — unused. |
| 13 | `src/hooks/useAcpSessionListeners.ts:299-312` tool path filter (inherited from #2) | For direct-API auto-allowed tools (`read_file`, `list_directory`, `web_search`, `read_skill_content`, `list_comments`), the permission card is bypassed entirely even when the user would have wanted to confirm. | **High** (sub-issue) | Direct API chat. Any read-only tool call executes without prompt. | Gate auto-allow on scope check (per #3). Add "Require confirmation for all tool calls" settings toggle. |
| 14 | `src/hooks/useAIContext.ts:150-153` (Scenario D for local path) | `localSystemMessage` hard-codes `Currently editing: ${activeTab.filePath}` with no dismiss path. | **Medium** | Open any non-project file. Chat with a local model. The absolute path is in the system prompt. | Honour `attachedFilePaths` dismissed-item state universally; drop fallback. |
| 15 | `src/hooks/useChatContext.ts:30-38` (Scenario D) | The currently-open editor tab is *always* added to `attachedFilePaths` unless explicitly dismissed per tab. | **Medium** | Open `~/Documents/secret/notes.md`. Select unrelated project. Send any message. Path leaked in system prompt. | Only auto-attach when tab lives under `selectedProjectPaths`. Non-project tabs require explicit opt-in. |
| 16 | `src-tauri/src/commands/sandbox.rs:101-111` (Scenario I additional) | Writable paths always include `$HOME/.claude`, `.codex`, `.copilot`, `.gemini`, `.notesage`, `.config` — agents can cross-pollute each other's config. | **Medium** | Misbehaving Claude agent writes to `~/.codex/config.toml`. Seatbelt allows it. | Narrow per-binary: pass `agent_binary` into profile generator. |
| 17 | `src/components/CommandPalette.tsx:149,199`; `src/lib/command-palette.ts:102-110` (Scenario Q) | Command palette + tag/mention autocomplete queries SQLite index across all projects regardless of chat selection. | **Medium** | Chat in project A, type `#` in palette — see tags from B. `@` mentions across all projects. | Default to `selectedProjectPaths`. Explicit "search all" toggle. |
| 18 | `src/components/chat/ChatHistoryView.tsx:113-138` + `ChatPanel.tsx:274-277` (Scenario N) | History tab lists every conversation; `handleSelectConversation` silently switches `projectPaths`. | **Medium** | Open history for a conversation rooted in project B. Footer silently switches. | Filter history by project overlap. Warn on stale paths. |
| 19 | `src/hooks/useAIContext.ts:88` (`buildFileTreeContext`, Scenario P) | Full recursive project file tree injected into every system prompt for single-project chats. No UI indicator. | **Medium** | Project with 500 files. Every chat turn injects the full tree. | Scope to selected projects. Cap depth/count. Scope-preview UI. |
| 20 | `src/stores/permission-store.ts:277-278,310-315` (Scenario V) | Auto-approved tool calls are indistinguishable from user-approved in the activity panel. No pre-execution heads-up. | **Medium** | Any chat triggering `read_file` — activity entry appears but user sees it only post-hoc. | Add "auto-approved" vs "user-approved" badge. Path tooltip. Optional "require confirmation for all" toggle. |
| 21 | `src/hooks/useAcpLifecycle.ts:626-633` (Scenario A) | Segment history slicing uses `conv.messages.length` index, not thread index — breaks with branching. | **Low** | Branch from a pre-switch message after a "Start fresh" segment boundary. | Store boundary as message-id marker. |
| 22 | `src/hooks/useAcpLifecycle.ts:181-192` (Scenario A/B) | Agent respawn on workspace change doesn't cancel in-flight turn or drain pending permissions. | **Low** | Add explorer folder while agent mid-turn. Stale permission prompts. | Cancel in-flight session before respawn. |
| 23 | `src/hooks/useChatContext.ts:47` + `ChatPanel.tsx:232` (Scenario E) | `attachedFilePaths` is passed by position into `sendOpts` with no log/indicator at send time. | **Low** | Any chat. | Render attached-file pills in prompt preview; log in activity panel. |
| 24 | `src/hooks/useTraySync.ts:21-32` + `src-tauri/src/tray.rs:113-128` (Scenario S) | Tray "Recent" submenu shows any open tab path regardless of project scope. | **Low** | Check tray menu — shows paths from any tab. | Filter to selected project paths. Keep "All recent" as opt-in submenu. |

**Severity tallies:**
- Critical: 5 (#1 + #6 same root cause; effectively 5 distinct root causes: sandbox union, disabled filter, tool-executor bypass, approval persistence, Copilot LSP)
- High: 7 (#7, #8, #9, #10, #11, #12, #13)
- Medium: 7 (#14, #15, #16, #17, #18, #19, #20)
- Low: 4 (#21, #22, #23, #24)
- **Total: 23 distinct issues** (listed as 22 leaks — #6 is a duplicate of #1 retained for kernel-level clarity)

---

## 3. Current Strengths

Don't undersell the defense-in-depth that is working today — it's what keeps the severity from being worse.

1. **Comment delegation is correctly isolated.** `useAgentTaskOperations.ts:289` uses `taskMeta?.projectRoot` (the source comment's project) as both `cwd` and the sole sandbox path. Path filter fires at `:450-466` with that scoped root. OS sandbox + soft filter both active. This is the one scenario Notesage *can* promise isolation for today.
2. **Connection-change + sandbox-scope-change both trigger respawn.** `ensureAcpAgent` in `acp-agent-state.ts:250-261` keys on `sandboxScopeKey` and `connectionId` — agents are never silently reused across connections, and scope changes tear down the old process.
3. **Provider context-isolation prompt works.** `AgentSwitchCard` + `ConversationSegment.historyIncluded` + segment-indexed history slicing in ACP and direct API paths means "Start fresh" reliably drops pre-switch messages from the wire payload.
4. **Per-branch session routing via `getSessionIdForLeaf`.** `chat-store.ts:964-980` walks ancestors; `session/fork` gives leaf branches fresh agent-side state.
5. **API keys in OS keychain, never in localStorage or IPC.** `credentials.rs` resolves keys per-call from the keychain; the frontend only holds `connection_id`. Migration is transparent.
6. **Kernel-enforced network deny with proxy-only localhost allow.** For connections with `kernelNetworkDeny`, `sandbox.rs:55-92` applies `(deny default)` with only the proxy port reachable. Agents cannot bypass the domain allowlist.
7. **Domain allowlists are per-connection.** `permission-store.ts:205-226` keys `domainSessionAllowed` / `domainAlwaysAllowed` by `connectionId` — provider A's approved domains don't leak into provider B's sandbox. (Note: still not per-project — see leak #17 for the adjacent command-palette concern.)
8. **`ChatMessage.connectionId/Label/Provider` snapshot.** Even though it's not used for enforcement (leak #7), the data is there — the fix is mechanical.
9. **Multi-project override conflict handler.** `ChatFooter.tsx:116-126,141-144` actively detects when a user tries to select projects with conflicting overrides and forces the selection down to one or refuses. The scaffolding for stronger enforcement is in place.
10. **Sandbox profile is per-instance and ephemeral.** `sandbox.rs:32` writes each profile to a temp file keyed by instance ID, cleaned up on agent exit. No cross-agent profile reuse.
11. **Backend SQLite index commands accept `project_paths`.** Rust-side scope awareness exists (`src-tauri/src/index/mod.rs:626-849`); only the frontend callers union everything.
12. **Activity panel DOES log auto-approved tool calls.** Revised from initial finding — the entries exist, they just lack a visual distinction from user-approved calls.

---

## 4. Remediation Roadmap

The 23 issues fall into three tracks with explicit ship gates.

### Track 1 — Must-fix before shipping a data-separation promise (Critical + High + one Medium)

Addresses leaks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 20.

1. **(#1)** Replace `getAllWorkspacePaths()` with per-chat sandbox-scope selector from `selectedProjectPaths + extraWritablePaths`. Respawn ACP on selection change. Optional "Cross-project mode" setting for power users.
2. **(#2)** Re-enable ACP path filter unconditionally. Set `pathFilterRoot` from `selectedProjectPaths` with multi-root support.
3. **(#3)** Apply `isToolCallAllowed` inside `tool-executor.ts` before every filesystem-touching tool call. Return a deny tool-result.
4. **(#4)** Scope persisted approvals by `(toolName, connectionId, projectRoot)` in `permission-store`. Migrate existing flat arrays into a global-fallback bucket; show scope on the permission card.
5. **(#5)** Scope Copilot LSP working directory and `didOpen` / `didChange` / `context-request` to selected project paths.
6. **(#7)** Read `ChatMessage.connectionId` at resend/edit time. Block or confirm on mismatch.
7. **(#8)** Add `aiLock: boolean` to `ProjectMetadata`. Enforce at multi-select, provider switch, resend, edit, comment delegation.
8. **(#9)** Scope inline completions (local + Copilot) to selected paths + notes root; opt-in otherwise.
9. **(#10, #11)** Per-project skill / agent / agent-instruction / MCP registries. Fix `read_agent_instructions` caller.
10. **(#12)** Narrow Tauri `assetProtocol.scope.allow` to a curated list. Drop unused `fs:allow-*` plugin capability.
11. **(#13)** Gate auto-allow on scope check (folds into #3). Add "Require confirmation for all tool calls" settings toggle.
12. **(#20)** Pre-execution heads-up + visual "auto-approved vs user-approved" badge in activity panel.

### Track 2 — Hardening (should ship)

Addresses leaks 14, 15, 16, 17, 18, 19.

- **(#14, #15)** Drop `Currently editing:` fallback in `localSystemMessage`. Only auto-attach active tab when under `selectedProjectPaths`. Non-project tabs require explicit opt-in.
- **(#16)** Narrow per-agent writable config subpaths in `sandbox.rs` — pass `agent_binary` into profile generator.
- **(#17)** Default command palette / autocomplete / research search to selected projects. Explicit "search all" toggle.
- **(#18)** Default-filter chat history by project overlap. Stale path handling.
- **(#19)** Scope file-tree system-prompt injection to selected projects. Cap depth/count.

### Track 3 — Nice-to-have correctness (follow-up OK)

Addresses leaks 21, 22, 23, 24.

- **(#21)** Store segment boundaries as message IDs, not indices.
- **(#22)** Cancel in-flight ACP turn cleanly before respawn on workspace change.
- **(#23)** Log attachment paths in the activity panel.
- **(#24)** Scope tray Recent submenu. Keep "All recent" as opt-in.

### Cross-cutting recommendations

- Integration tests: `acp_agent_spawn` called with exactly `selectedProjectPaths`; tool-executor rejects out-of-scope paths; Copilot LSP `didOpen` rejects out-of-scope URIs; persisted permissions are keyed by the correct triple.
- A **"scope preview" dialog** non-dismissible for new users showing selected projects, sandbox paths, provider, locked-project status, agent-instruction source files.
- **"Project locked" badge** in the chat footer when `aiLock` is set.
- Provider-specific data-separation contract documented in the connection card ("Anthropic connection — files accessible: selected project roots only").
- **Red-team pass** by a second engineer (or disciplined solo run) attempting each leak's documented repro. Any reproducible Critical/High is a commercial-launch blocker.

---

## Appendix — Call Graph

```
user types message in chat footer
   │
   ├─ ChatPanel.handleSend  ─────────────────────────── src/components/chat/ChatPanel.tsx:175
   │     │
   │     ├─ attachedFilePaths (useChatContext)         src/hooks/useChatContext.ts:30-38   ← #15
   │     │
   │     ├─ buildComposedSystemMessage()
   │     │    └─ useAIContext.ts:118-127
   │     │          ├─ projectContext (single | multi)  useAIContext.ts:76-115
   │     │          ├─ agentInstructions (UNION!)      skill-store.ts:348-357          ← #10
   │     │          ├─ agentSystemMessage
   │     │          └─ skillDescriptions (UNION!)      skill-store.ts:320-334          ← #10
   │     │
   │     ├─ sandboxPaths = opts.sourceCommentId ? conv.projectPaths : undefined    ← #2
   │     │
   │     └─ sendChatMessage  ─────────────────────────  useAIOperations.ts:135-146
   │           │
   │           ├─ ACP:
   │           │    ├─ pathFilterRoot = opts.sandboxPaths ? [0] : null             ← #2
   │           │    ├─ sandboxScope = getAllWorkspacePaths()                       ← #1
   │           │    └─ ensureAcpAgent → acp_agent_spawn → sandbox.rs               ← #1 kernel writable set
   │           │
   │           ├─ Copilot LSP:
   │           │    ├─ workingDir = projects[0]                                    ← #5
   │           │    ├─ didOpen(activeTab.filePath)  (NO SCOPE CHECK)               ← #5
   │           │    ├─ getToolDefinitions()                                        ← #3, #13 inherited
   │           │    └─ context-request → activeTab content                         ← #5
   │           │
   │           └─ Direct API (incl. local_bundled):
   │                 ├─ ai_chat_stream (messages + system + tools)
   │                 └─ on ai-tool-call → executeToolCall                src/lib/tool-executor.ts:187
   │                       │
   │                       ├─ read_file   → Tauri read_file (NO SCOPE)            ← #3
   │                       ├─ list_directory                                      ← #3
   │                       ├─ write_file                                          ← #3
   │                       ├─ add_comments (file_path: any path)                  ← #3 inherited
   │                       ├─ skill__ prefix → execute_skill_script               ← #3 inherited
   │                       └─ permission check (if NOT in auto-allow)             ← #4, #20
   │
   ├─ ChatPanel.handleResend                                                      ← #7
   ├─ useCopilotCompletion.ts (ghost text on typing)                              ← #5, #9
   ├─ useLocalCompletion.ts    (ghost text on typing)                             ← #9
   └─ CommandPalette → index_search_* (union all projects)                        ← #17
```
