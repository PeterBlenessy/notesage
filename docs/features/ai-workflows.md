# AI Workflows

Chat, agents, skills, comment delegation, research, and voice transcription — the user-facing AI features built on top of the [AI Providers](ai-providers.md) infrastructure.

## Chat Surface

Chat is reached through the `FloatingCommandBar` (`src/components/cmd/FloatingCommandBar.tsx`) inside `QuietLayout` — a compact bottom-centre pill that expands on focus (or `Cmd+K`) into a portal-mounted overlay with the input, attachment chips, context row, and conversation stream. A pin affordance (persisted as `settings.cmdBarPinned`) converts the floating overlay into a fixed-position right-edge side panel; the document column reserves matching `padding-right` via the `--cmd-bar-pinned-width` CSS variable. Prefix characters (`/`, `@`, `#`, `!`, `?`, `>`) morph the bar into mode-specific pickers (skills, references, tags, tasks, research, palette).

The bar shells the same `useAIOperations.sendChatMessage` pipeline, `chat-store`, segment renderer, branching/resend/edit flows, and scoped-approvals layer that the rest of this document references when it says "the chat panel" — the cmd bar IS the chat panel.

## Chat Pipeline

Streaming AI responses.

**Direct API path:**

1. User types message in the `FloatingCommandBar` composer
2. Frontend calls `useChatStore.addMessage(userMessage)`
3. Hook calls Tauri command `ai_chat_stream(messages, provider, apiKey, tools)`
4. Rust makes streaming HTTP request (SSE)
5. If model requests tool calls: permission check → execute → feed result back → model continues (see [Tool Calling](ai-providers.md#tool-calling))
6. Frontend accumulates tokens (50ms throttled flush) and updates assistant message
7. Citations attached on stream completion

**ACP path:**

1-3. Same as above
4. Hook calls `acp_session_prompt` on the interactive agent's session
5. Agent streams text chunks, tool calls, permission requests
6. Tool calls tracked as `AgentActivity` entries; permissions handled via tiered approval
7. Chat history persisted to localStorage

**Features:**

- **Message queueing during agent work:** sending while the watched conversation's run is in flight no longer interrupts the ongoing work (both streaming paths used to tear down the previous same-conversation stream on send). The message parks in `message-queue-store` (enqueued inside `useAIOperations.sendChatMessage`, so composer sends, quick replies, and resends all queue uniformly) and renders as a "Queued" strip above the composer input with a per-row × to withdraw it. `useMessageQueueDrain` (mounted from the always-mounted `FloatingCommandBar`) dispatches queued messages FIFO — one per run completion, with a freshly recomputed thread so the finished run's messages are included as history — only for the foreground conversation (a backgrounded queue waits until the user switches back), and never while a provider/project switch prompt is pending. Pressing Stop halts everything: the queue is cleared BEFORE the run is cancelled (so the drain can't fire it) and the queued text is restored into the composer input so nothing typed is lost. Queues are transient (not persisted) and are dropped when their conversation is deleted.
- Message resend: one-click resend of any user message. If the message's original `connectionId` differs from the current command bar provider, a `ResendProviderDialog` asks "Resend with original" vs "Resend with current" before sending. `aiLock` on the selected project disables the non-matching option.
- Message edit: click edit on a user message to pre-fill the input, modify and send as a new branch. "Editing message" banner with cancel (X or Escape). Same provider-mismatch dialog as resend fires at send time when the original `connectionId` differs.
- Quick reply chips: AI responses can include `<quick-replies>` tags with suggested follow-ups
- Custom prompts/templates for AI actions
- Project-scoped AI context (provider, agent, and context overrides per project)
- Multi-select project selector in command bar
- Chat/History tab view: Chat tab for active conversation, History tab for past conversations sorted by date with metadata (time, message count, branch count)
- Conversation branching: branch from any message to explore alternative responses. Branch indicator pills show at branch points with a popover to switch between branches. "Branch from here" action on all messages via GitBranch icon.
- Conversation export: export active thread as Markdown, all branches as Markdown (separated by horizontal rules with "Branch N" headers), or full tree as JSON with `id`/`parentId` fields. Native save dialog with Reveal in Finder option.
- Tool calling: models can autonomously call tools (web search, read/write files, execute skills) with results shown as collapsible activity blocks in assistant messages
- **Chronological message segments:** Assistant messages render text, thinking, tool calls, and tool results as an interleaved chronological stream. Each segment type has a dedicated visual treatment (see Chronological Segments section below). Old messages without segments fall back to the legacy flat rendering.
- Tool call permission cards appear inline when write/execute tools need approval
- Tool call deny messages: when a tool call is denied, a chat message is shown ("Tool call X was denied")
- Domain deny/timeout messages: blocked or timed-out domain requests shown as chat messages
- Chat panel resizable up to 50% of the content area
- Image attachments: paste, drag-drop, or file picker to attach up to 5 images per message. Images compressed client-side (1568px max, PNG→JPEG, 5MB cap). Vision capability auto-detected per provider. Right-click "Add to chat" on editor images/drawings or sidebar image files. See [Image Attachments & Vision](ai-providers.md#image-attachments--vision) for full details.
- **ACP session modes**: Permission-level mode picker (Shield icon) in command bar. Agent-specific mode IDs mapped to common levels: Read Only, Agent, Full Access, Plan. Hidden by default — enable in Settings > AI Providers. Full Access triggers a conflict dialog when sandbox restrictions are active.
- **ACP config options**: Dynamic config dropdowns (e.g., thinking effort with Brain icon) populated from agent session response. Values set via `session/set_config_option`.
- **ACP usage tracking**: Live token count displayed in command bar during ACP sessions (e.g., "4.2K / 200K"). Cost shown on hover tooltip when agent provides it.
- **ACP plan display**: Agent execution plans rendered as collapsible `PlanSegment` cards with step status icons (pending/in_progress/completed) and priority indicators.
- **ACP agent slash commands**: Agent-specific commands (e.g., `/compact`, `/clear`) appear in the `/` command menu alongside Notesage skills, distinguished by Terminal icon.
- **ACP thinking segments**: Agent reasoning output (`agent_thought_chunk`) displayed as collapsible thinking blocks in chat messages.
- **ACP session titles**: Agent-generated conversation titles (`session_info_update`) automatically applied to chat history.

**Provider context isolation:**

- When switching AI provider mid-conversation, an `AgentSwitchCard` prompts the user to start fresh or include previous history
- Starting fresh creates a segment boundary — messages before the boundary are excluded from API calls to the new provider
- Including history carries all messages forward to the new provider
- Segment filtering applied at send time via `sliceThreadBySegment(baseThread, segment, conv.messages)` in `chat-store.ts`. The anchor is `ConversationSegment.startMessageId` (stable id); `startMessageIndex` is retained as a deprecated fallback until the v5 migration has settled on all users.
- Branching-aware slicing: when the active leaf's thread doesn't contain the boundary message directly, `sliceThreadBySegment` finds the LCA of the thread and the boundary's lineage and drops everything up to and including the LCA (those messages were written post-switch on this branch). If no common ancestor exists, the thread is preserved unchanged.

**Scoped persisted approvals:**

- `alwaysAllowed`, `toolCallAlways`, and `skillScriptAlways` are persisted as `ScopedApproval[]` triples: `{ toolName, connectionId, projectRoot, grantedAt }`. Lookup is keyed by the active send context, so an "always allow write_file" granted in Project A under Claude does NOT auto-approve in Project B under Ollama.
- `domainAlwaysAllowed` is scoped similarly: `Record<connectionId, Record<projectRoot | 'global', string[]>>`.
- Legacy flat approvals (from pre-v38 persisted state) migrate into a `(connectionId: null, projectRoot: null)` bucket with a one-time toast inviting the user to review.
- Settings > AI Providers > Approvals panel lists every persisted approval with per-row revoke and bulk-revoke (all legacy, all for a connection, all for a project).
- "Require confirmation for all tool calls" global toggle in Settings > AI Providers (default off) disables auto-allow entirely; every tool call gets a permission card.
- **MCP tool approvals.** An MCP tool call goes through the same card and the same store (`toolCallSession` / `toolCallAlways`), under its own key: `mcp:<serverId>:<original tool name>` (`mcpPermissionKey` in `src/lib/mcp/chat-tools.ts`; a project server's key also carries its project root). The key is built from the server id and the tool's original name, never from the model-facing `mcp__…` name, so an approval is per server + tool and cannot move to another tool when names are re-derived. "Always allow" is stored with the connection id and, for a project server, that server's project root; a global server's approval applies in every project. MCP tools are never on the built-in read-only auto-allow list, and the annotations a server attaches to its tools (`readOnlyHint`, `destructiveHint`, …) are not consulted: they are third-party claims. The card names the server and the original tool and lists the arguments. "Require confirmation for all tool calls" applies to them on both the direct-API and the Copilot path. Background tasks on the Copilot path run an MCP tool only when such an approval already exists (`isToolPreApproved` in `src/hooks/agent-task/copilot-lsp.ts`).

**Activity panel visibility:**

- `AgentActivity` carries an `approvalMode: 'auto' | 'user' | 'denied'` field. The activity strip / panel renders a badge — muted for auto-approved, solid for user-approved, destructive for denied.
- Full path arguments surface in the tooltip (not just the basename).
- File-path attachments are logged as `kind: 'attachment'` activities on the user message at send time and render as a `AttachmentFileStrip` above the user-typed text with a `Paperclip` icon. Image byte attachments remain displayed as thumbnails (unchanged).

## Addressable Agents

File-based agent system for user-created and provider-native agents.

- Discover agent files from multiple directory sources (scanned in priority order):
  - `<project>/.notesage/agents/` (project-level Notesage agents)
  - `~/.notesage/agents/` (global Notesage agents)
  - `<project>/.claude/agents/` and `~/.claude/agents/` (Claude Code agents)
  - `<project>/.gemini/agents/` (Gemini CLI agents)
  - `<project>/.github/agents/` (GitHub Copilot agents)
  - `~/.codex/agents/` and other provider directories
- Agent files: markdown with YAML frontmatter (`name`, `description`, `model`, `icon`, `allowed-tools`)
- Source badges in `@` autocomplete menu showing agent origin (claude, github, gemini, project, global)
- No bundled agents — users create their own or use provider-native agents from connected providers
- **`@` behavior depends on connection type:**
  - **ACP connections** (`agent_managed`): `@agent-name message` is passed through verbatim to the provider, which manages its own subagent system
  - **Direct API connections** (`api_key`, `local`): `@agent-name` strips the prefix and swaps the system prompt to the agent's body content
- Agent picker dropdown in command bar; `@agent-name` addressing in chat input for per-message scoping
- Agent-to-skill connection: `allowed-tools` frontmatter filters which skills an agent can access
- Agents section in Settings > Skills & Agents for viewing, enabling/disabling
- Skill & agent management: delete and move (global ↔ project) for custom items, gated behind a Settings > Skills & Agents toggle
- 5 bundled custom prompts (Academic Tone, Creative Rewrite, Proofread, Marketing Copy, Technical Edit) seeded on first launch for quick AI actions via the bubble menu

## Skills & Agents Platform

Extensible AI capability system based on open standards.

**Agent Skills & Script Execution:**

- Discover skills from connected providers' filesystem paths (`~/.claude/skills/`, `~/.codex/skills/`, etc.)
- Notesage skill hierarchy: project `.notesage/skills/` overrides global `~/.notesage/skills/`, which overrides external provider skills
- Agent instruction files: `.notesage/agents.md` (project/global) injected into AI context
- Script execution runtime: Tauri command for running skill scripts (bash, python, node)
- Built-in meta-skills: `create-skill` and `create-agent` ship with the app
- Auto-rescan: filesystem watcher triggers skill/agent re-discovery; manual rescan button
- Permission model: per-execution, per-session, or always-allow for script execution

**MCP Client Integration:**

- MCP (Model Context Protocol) client in the Rust backend (`commands/mcp/`) with two transports behind the `McpConn` enum:
  - **stdio** — JSON-RPC 2.0 over a spawned child process's stdin/stdout (cleanup on app exit)
  - **http (Streamable HTTP)** — JSON-RPC POSTed to a single endpoint; responses parsed from `application/json` or `text/event-stream` (SSE), with `Mcp-Session-Id` persisted across requests. No child process; the protocol helpers (`mcp_initialize`, `mcp_list_tools_from_server`, `mcp_call_tool_on_server`) are transport-agnostic.
- **Curated catalog** (`mcp-catalog.json`, `mcp_catalog_list`) — a "Browse catalog" picker of opt-in server templates, seeded with the official MCP reference servers (Filesystem, Fetch, Memory, Git, Sequential Thinking, Time, Everything), badged "Official" with provenance links. Selecting one pre-fills the Add dialog; nothing runs until the user confirms.
- **Validate-on-add** (`mcp_validate_server`) — a dry run (spawn/connect → `initialize` → `tools/list` → stop) that previews a server's tools on success or shows a mapped error (`binary_not_found` / `spawn_failed` / `init_failed` / `timeout`) on failure. The dry run is a check, not a gate: it can take up to two minutes on a first run (the package is still downloading, and the dialog says so while it waits), and **Save without testing** writes the entry as configured at any time; it becomes the main action after a failed or timed-out test.
- **Env secrets in the keychain** — env values flagged secret are stored in the OS keychain (`notesage:mcp:<server_id>:<KEY>`); `mcp.json` keeps only a `{ "secret": true }` reference (`McpEnvValue`). Secrets are resolved at spawn, never written to disk, never returned to the frontend.
- **OAuth 2.1 for protected remote servers** (`commands/mcp_oauth.rs`) — authorization-code + PKCE (S256), RFC 9728→8414 metadata discovery, RFC 7591 dynamic client registration, a transient loopback `127.0.0.1` callback, and refresh. Tokens live in the keychain (`notesage:mcp:<server_id>:oauth`); `HttpMcpClient` attaches `Authorization: Bearer` when a server is authorized. Commands: `mcp_oauth_authorize` / `mcp_oauth_status` / `mcp_oauth_logout`. Add dialog has an "Authorize" button; server cards offer Re-authenticate / Sign out.
- **Deep-link install** — `notesage://mcp/install?...` links (parsed by `src/lib/mcp/deeplink.ts`) open the validate-first Add dialog pre-filled, via the `notesage` scheme (`tauri-plugin-deep-link`) and `McpDeepLinkInstaller` mounted at the app root.
- Tool discovery from connected servers, displayed in Tools popover
- **Which chats can use MCP tools, and how:**
  - **Direct API, bundled local AI, Copilot language server** (the app runs the tool loop): the tools of every server that is *enabled, running, and global or attached to one of the conversation's projects* are added to the tool list next to the built-in and skill tools, when tool calling is on. Assembly is `skill-store.getToolDefinitions(undefined, { mcpProjectPaths })` → `getMcpToolDefinitions` (`src/lib/mcp/chat-tools.ts`); a caller that names no project scope gets no MCP tools. The Copilot LSP takes its tool list at `conversation/create`, so a server started mid-conversation is picked up by the next new conversation; the direct paths rebuild the list on every send.
  - **ACP agents** (Claude Code, Codex, Gemini CLI, Goose, …) are not given tool definitions. They receive the enabled, in-scope server *configs* at `session/new` / `session/load` and start their own copy of each server, inside the agent's sandbox (`buildAcpMcpServerInputs` in `src/lib/ai/acp-mcp.ts` → `build_acp_mcp_servers` in `src-tauri/src/commands/acp/helpers.rs`). Capability gating follows ACP schema v1, which is what the app negotiates: stdio servers go to every agent that completed `initialize`; `http` servers only when the agent advertises `mcpCapabilities.http`. The v2 shape (`mcp.stdio` / `mcp.http` objects) is accepted too. Env and header secrets and the OAuth bearer token are resolved from the keychain on the Rust side; the agent never receives a `{ "secret": true }` reference. A leading `~/` in a stdio command is expanded there as well, because the agent spawns the command without a shell.
  - Background agent tasks, automations' agent steps and comment delegation run through `useAgentTaskOperations`: on an ACP connection they get the servers as above; on a direct-API connection they send no tools at all (unchanged); on the Copilot LSP they run only MCP tools the user already allowed.
- **Tool names.** A model sees an MCP tool as `mcp__<server>__<tool>` (`src/lib/mcp/tool-naming.ts`): each part sanitised to `[a-zA-Z0-9_-]`, at most 64 characters. A short hash of the server id and tool name is appended when the name had to be shortened or when two tools would otherwise share it (two servers with the same display name, names that differ only in replaced characters). `resolveMcpTool` maps a name back to the server id and the tool's original name for `mcp_call_tool`.
- **Schemas.** A server's `inputSchema` is arbitrary JSON Schema; `sanitizeToolSchema` (`src/lib/mcp/tool-schema.ts`) reduces it to the subset every provider path accepts (object at the top level, local `$ref`s inlined, `oneOf` → `anyOf`, nullable unions collapsed, no `format` / `pattern` / `additionalProperties` / `$schema` / `default`, string-only enums, `items` on every array). A tool whose schema cannot be expressed that way (non-object top level, an argument name providers reject, larger than `MCP_TOOL_SCHEMA_MAX_CHARS`) is left out with a logged warning instead of failing the request.
- **Caps.** At most `MCP_MAX_TOOLS_OFFERED` (64) MCP tools and `MCP_MAX_TOOL_DEFINITION_CHARS` (60,000 characters of name + description + schema) per request; descriptions are cut at `MCP_TOOL_DESCRIPTION_MAX_CHARS` (1,024). What is dropped is logged (`[mcp] MCP tool list capped`). The bundled local model additionally applies its context-window tool budget (`tool-budget.ts`), which drops MCP tools before the essential built-ins.
- **Calls and results.** `executeToolCall` routes an `mcp__…` name to `mcp_call_tool` (`src/lib/mcp/tool-call.ts`). The result's text items are joined; images, audio and binary resources are replaced by a one-line note (the tool-result channel is text only); `structuredContent` is used when there is no text; `isError` becomes a tool error; text over `MCP_TOOL_RESULT_MAX_CHARS` (50,000) is cut with a marker saying how much was omitted. A server that stopped after the tool list was built, or an unknown `mcp__…` name, comes back as a tool error the model can read. The backend limit for one call is 300 s; Stop does not wait for it: the call cannot be cancelled in the backend, so the loop stops waiting and a late reply is discarded.
- **Prompt-injection hygiene.** Server names, tool descriptions and results are third-party text. They travel only in the tool-definition and tool-result channels, length-capped, and are never interpolated into the system prompt.
- Import existing MCP configs from Claude Desktop, Cursor, VS Code
- `.notesage/mcp.json` (project) and `~/.notesage/mcp.json` (global) for Notesage-specific servers; project-scoped servers default to disabled (security). PRD: `docs/prds/2026-06-03-mcp-registration-ux.md`
- **Add/Edit dialog** (`src/components/settings/mcp/AddEditServerDialog.tsx`):
  - The Command and Arguments fields are split like a command line, quotes respected (`command-line.ts`): the first word of Command is the program, the rest lead the arguments, so a whole line pasted from a README works and a path with spaces survives an edit (`joinCommandLine` quotes what `splitCommandLine` reads back unchanged). Nothing is expanded or run through a shell.
  - Optional **working directory** (`cwd`, stdio) and, for remote servers, **headers** (`headers`), edited like env vars including "store in keychain" (same keychain name as an env secret, with the header name as the key).
  - A server added in the dialog is switched on (an explicit enable override) and started by the rescan that follows. A server found in a file, or imported, stays off until the user switches it on; `disabled: true` in the file is likewise overruled only by an explicit override.
  - An edit is written back to the file the server is defined in (the project's `.notesage/mcp.json` for a project-scoped server) and keeps the entry's other keys. Renaming removes the old key and moves the enable override, the keychain secrets and the OAuth token to the new id, and stops the process running under the old one. The OAuth token is moved at save to the id the server ends up with, so authorizing before naming the server no longer orphans it.
  - Catalog entries can require arguments (`required_args`, or the built-in table in `catalog-requirements.ts`): Filesystem asks for the folder it may access, with a folder picker, instead of adding a server that exits with a usage error.
- **Server ids**: `global:<name>` for the global file, `project:<8-hex key of the project path>:<name>` for a project file (`mcpProjectServerId`), so two projects with a server of the same name do not share an id, an enable override or keychain entries. An override stored under the old shared `project:<name>` is carried over to each loaded project the first time it is seen. Tools carry the id their server was started with (`server_id`).
- **Lifecycle** (`src/hooks/useMcpOperations.ts`): discovery starts the servers the user has switched on (the override, not the backend's always-off `enabled`). A server that fails to start, or whose process exits (`mcp-server-status` with `error`), shows the full error on its card (expandable, copyable), raises one toast per server per launch, and is retried after 5 s, 30 s and 2 min; the retries stop while the server is switched off and start over on a config change or a manual start/stop/restart. Restart works for a failed or stopped server (it is started from its config), and Start or Restart on a switched-off server also switches it on. "Refresh status" takes the backend's word: a server it does not report as running has no tools.
- **Config problems** (`mcp_config_problems`): entries the backend could not load are listed at the top of the MCP settings with the file and the reason, and a button that shows the file; the other entries of the same file still load.
- **Where MCP tools work**: tools from servers that are switched on and running are offered in chats with API providers and Copilot (each call asks for permission like any other tool) and are passed to coding agents when a new agent session starts.

**Standards:**

- Agent Skills (SKILL.md) adopted by Claude Code, Codex CLI, Gemini CLI, VS Code Copilot, Cursor, and 30+ tools
- MCP adopted by all major AI tools with 5,800+ servers and 300+ clients

## Comments & Agent Delegation

Document comments with AI agent delegation — foundational infrastructure for human-AI collaboration.

**Comments:**

- Inline comments attached to text ranges via Tiptap ProseMirror decorations
- Comment popover for creating, editing, and deleting comments
- Keyboard shortcut: Cmd+Shift+M to create comment on selection
- Two storage strategies:
  - **Project files:** Comments keyed by UUID (frontmatter `id` field). Stored in `.notesage/comments/{uuid}.json`
  - **Non-project files:** Comments keyed by path hash. Stored in `~/Notesage/.notesage/comments/path-{hash}.json`

**Agent delegation:**

- Delegate any comment to an AI agent with one click — agent replies within the comment thread
- Comment lifecycle: open → delegated (spinner) → done (reply received) → resolved (highlight removed)
- Delegation from create mode, view mode, or comment list
- Agent replies displayed as threaded responses with author attribution and timestamps
- Per-comment activity log showing agent steps (tool calls, permissions, errors)
- Uses `agent_tasks` routing slot via `useAgentTaskOperations`
- Session continuity: comment-delegated tasks now restore agent-side context through the same capability-gated `restoreOrCreateAcpSession` chain used by main chat (`session/resume` → `session/load` → `session/list` → `session/new`). When a task reaches a terminal state (completed, failed, or cancelled) it fires a best-effort `session/close` so the agent can free resources — gated on `sessionCapabilities.close`.

**Multi-turn threads & apply-to-document:**

- User can reply to the agent, agent responds again — full conversation history in each prompt
- "Apply" button on agent replies — shows inline diff on anchor text via `AISuggestion` decoration
- Same review UX as Improve/Summarize/Expand: accept via `Cmd+Enter`, reject via `Cmd+Backspace`
- Preamble stripping removes introductory phrases before applying
- Multi-turn task reuse: `existingTaskId` keeps conversations as a single task in activity panel

**Agent activity surface:**

The agent activity list (running, completed, failed tasks) is exposed through `AgentOrb` (`src/components/activity/AgentOrb.tsx`) — backed by `activity-store`. A 46px ambient circle pinned to the bottom-right of the workspace. Pulses (CSS-only keyframe) and shows a count badge while running tasks are in flight; otherwise a static neutral surface with a subtle Bot glyph. Click (or Enter) opens an `AgentPanel` (`src/components/activity/AgentPanel.tsx`) inside a shadcn `Popover` with focus trap, Esc-to-close, and focus restoration. Hidden via `display: none` while the FloatingCommandBar is in pinned mode (the side panel covers the same screen real estate).

Task model:

- Task persistence: historical tasks survive app restart; interrupted tasks marked as error on rehydration
- Per-task details: thinking output, streaming response, activity log
- Click-to-navigate from completed tasks to source comments

## AI-Assisted Research (Skill Pack)

Research workflow built on the Skills & Agents Platform.

**Skills:**

| Skill | Purpose |
| --- | --- |
| `download-webpage` | Fetch URL → clean markdown with metadata |
| `save-research` | Organize research files with tags and metadata |
| `search-research` | Search research corpus by tag, keyword, or content |
| `synthesize-sources` | Read multiple sources, generate cross-source synthesis |
| `insert-citation` | Insert formatted citations into documents |

**Research file format:** Standard markdown with YAML frontmatter (`source_url`, `title`, `author`, `date_saved`, `tags`, `word_count`). Stored in `research/` (project) or `~/Notesage/research/` (global).

**Searching:** `Cmd+4` (or type `?` in command palette) opens research search mode. Real-time filtering via the SQLite-index-backed `index_search_research` Tauri command.

**Citing:** Three citation formats (inline links, footnotes, academic). Citation format persisted per-project.

## Meeting Recording & Transcription

On-device speech-to-text powered by whisper-rs with Metal GPU acceleration — fully offline. There is no live dictation and no command-bar voice input: the only voice feature is **record a meeting, then transcribe the whole file in the background**. Capture and transcription are two decoupled phases — capture writes audio to disk and does nothing else, transcription is a separate background job that reads the finished file (PRD `2026-05-30-meeting-recording.md`, motivated by #264).

**Lifecycle — one artifact, four states (narrated by the AgentOrb):**

```
⏺ Recording (02:14)  →  ⟳ Transcribing…  →  ✓ Ready to file  →  📁 Moved to project
```

1. **Record.** The microphone in the AgentOrb panel header (or `⌘⇧R`) starts capture. A single mic-stream owner appends samples to a WAV file in the `~/Notesage/Recordings/Recording <timestamp>/` inbox folder. The orb shows a `recording` item with a pause-aware elapsed time and inline pause/stop controls; while recording the orb draws a clock-style seconds-ray ring (distinct from the agent-activity pulse). Capture is deliberately dumb — samples → file, no Whisper, no chunking — so it can never contend with a transcription. Pause/resume discards samples without tearing down the stream.
2. **Stop.** A second click (or `⌘⇧R`) signals the stream owner to stop; teardown (stream drop + thread join) is awaited before the command returns and the WAV is finalized. A rapid stop→start is safe because the new stream can only open after the previous owner has fully released CoreAudio.
3. **Transcribe.** A background **transcription job** (tracked in `activity-store`, surfaced in the orb / `AgentPanel`) runs whole-file Whisper once with the configured model and produces timestamped segments. Progress streams into the activity item via `transcription-progress` events.
4. **File it.** On completion the panel offers "Move to project"; picking one relocates the whole bundle (audio + transcript note) into that project. No pick leaves it in the inbox, re-openable and re-runnable.

### Starting, watching and stopping a recording

One module owns the flow for every surface — `src/hooks/useMeetingRecording.ts`, plain functions that read the stores lazily (`startMeetingRecording`, `stopMeetingRecording`, `toggleMeetingRecording`, `togglePauseMeetingRecording`, `discardMeetingRecording`, `recoverOrphanRecordings`). Surfaces only call them.

**The phase** (`recording-store.phase`) is the re-entrancy guard: `idle → starting → recording ⇄ paused → stopping → idle`. It is moved synchronously, before the first `await`, so a double click, a held key or two surfaces acting at once cannot start two recordings, stop one twice, or start a new one while the last is still being saved (`stop_recording` compresses the audio and can take tens of seconds — the UI says "Saving…" for that stretch). `⌘⇧R` also ignores key auto-repeat.

**Start:** `recording_preflight` (is the chosen source available? never prompts) → `start_recording(source)`. The source is `recording-store.lastUsedSource` — **Microphone**, **System audio** or **Both** — one persisted choice edited by the segmented control in the orb panel (`RecordingSourcePicker`) and in Settings → Transcription. An option that cannot be recorded stays visible, cannot be chosen, and says why ("Needs macOS 14.2 or later", "Allow audio capture in System Settings → Privacy & Security"). A source that is unavailable when `⌘⇧R` is pressed is refused with that reason and an explicit "Record microphone only" action — the app never silently records less than was asked. If no transcription model is downloaded the recording still starts (the audio is what matters) and a toast offers **Download** (Settings → Transcription); after stop the recording is saved and the same offer is made instead of a job that is known to fail. If a markdown document is open when the recording starts, its path travels with the transcription job as `documentId`.

**Watch — the indicator (`RecordingIndicator`)** is on screen for the whole recording, in one of two placements chosen in CSS (`globals.css`, "Recording indicator"): a row above the sidebar footer, or — when the sidebar is hidden, in focus mode, or faded while typing — a chip fixed to the bottom-left of the document column, in the strip below the floating command bar. It is mounted outside the orb (`RecordingStatusHost`, rendered beside it), so it is there with the command bar pinned, when the orb is `display: none`. It is exempt from the focus-mode dim, fade-on-type and the inactive-window dim. It shows a red dot (the destructive colour, not the accent; hollow while paused), the state in words, the recorded time, a level meter per captured source, the source (device names on hover), and pause / stop-and-save / discard buttons (24px targets, `aria-pressed`, tooltips with the shortcuts). `e2e/tests/recording/recording-control.spec.ts` asks the browser, by `elementFromPoint`, that it covers neither the Settings button, the status strip nor the command bar at 200 / 252 / 340px sidebar widths.

- **Time** is *recorded* time, not wall-clock: one ticker polls `get_recording_state` (`elapsed_recorded_ms`, from samples written) and writes whole seconds to `recording-store.recordedSeconds`. Every surface renders it with `formatRecordedTime` (`mm:ss`, `h:mm:ss` from one hour).
- **Levels** never touch React state: `recording-level` events land in a plain object in `recording-store` (`readRecordingLevels`), and `RecordingLevelMeter` writes a CSS transform from a `requestAnimationFrame` loop. A test counts zero re-renders across a burst of events.
- **Warnings** (`recording-warning`): non-fatal ones stay on the indicator until dismissed — and `device-lost`, `write-error`, `low-disk` and `silence` ("No sound is reaching the recording", with the source named) also toast; a silence warning clears itself when sound arrives. A fatal one means the backend already stopped: the normal stop path runs and the toast says what was saved.
- **Announcements:** one visually hidden `role="status"` region announces start, pause, resume, saving, saved, discarded and warnings — never the timer.

**Stop** never asks: it saves. `stop_recording` → `recording.json` written into the LOCAL staging bundle → `finalize_recording_bundle` moves the bundle into `<library root>/Recordings` (the scanner's expression: `icloudNotesagePath ?? resolveNotesRoot(notesRootPath)`), so a bundle never appears in the library without a manifest → the transcription is queued (with `tracks` for a two-track recording) → toast "Recording saved (1:15:03)" with **Open Recordings**. If the move fails the audio stays in staging and is filed at the next start. The language picked on the live recording's card becomes the default for the next recording. **Discard** is the only path that deletes audio, has no shortcut, and always goes through a confirmation dialog.

**Crash and quit:** after startup `recoverOrphanRecordings` puts every bundle a crash or quit left in staging through the same manifest → library → transcription path and says "Recovered a recording from <date>" once each; if the backend is still capturing (a reloaded webview) it takes the controls back up instead. There is deliberately no "a recording is in progress" prompt on close or quit: the webview cannot veto a close or see `⌘Q` on its own, and a handler that held a quit back and then failed would leave an app that cannot be quit. Quitting mid-recording loses nothing — the backend stops the capture and leaves a valid file on exit — but the recording is filed at the next launch rather than before quitting.

**Data model — segments, not a blob:**

The transcript is an ordered list of timed segments, `{ start, end, text, speaker? }` (seconds from the start of the audio), kept BESIDE the note in `segments.json` (`{ version: 1, segments }`), not in the note. `speaker` is a label, not a name: `me` / `others` from a microphone + system-audio recording (the backend transcribes the two tracks separately), or a participant's name once a Teams transcript has been attached. `speakers.json` (`{ version: 1, names: { "<label>": "<display name>" } }`) maps labels to what is shown; `me` / `others` without an entry display as the translated "Me" / "Others". The pure code is `src/lib/transcription/segments.ts`: `renderTranscriptBody(segments, speakers, opts)` writes turns that begin `**Name** [hh:mm:ss]` when speakers are known, otherwise paragraphs with a `[hh:mm:ss]` marker about every minute (a marker only ever starts a paragraph, at a segment boundary), and `renderTranscriptNote` puts a small frontmatter in front (`type`, `title`, `date`, `duration`, `language`, `model`, `source`, `speakers`). Bundles from before the sidecar existed carry the segment array in the note's YAML frontmatter (about 246 KB per recorded hour); `readSegments` falls back to it read-only, and nothing rewrites an old transcript because it was opened or listed.

**The artifact bundle:** each recording is a folder in `<library>/Recordings` (and later in the chosen project): the audio (`audio.m4a`, or `audio.wav` when the encoder is unavailable; `mic.*` and `system.*` as well for a two-track recording), `recording.json` (the manifest, below), the transcript note, `segments.json`, optionally `speakers.json` and an attached `teams-transcript.vtt` / `.docx`. A NEW transcript is named after the recording (`<title>.md`, the title being the user's or the folder name) and the manifest records which file it is (`transcript: { file, hash, generatedAt }`); a bundle that already has the legacy `transcript.md` keeps that name when its transcript is replaced. The folder keeps everything together so "move to project" is a single atomic move (`src/lib/transcription/bundle.ts`, reusing `rename_path` / `copy_directory`).

**A transcript is never overwritten without being asked.** `writeTranscript` (`src/lib/transcription/transcript-files.ts`) is the only writer, and a caller that did not ask the user gets a second file beside the first (`<title> (2).md`). "Transcribe again" (card and Recordings row) and attaching a Teams transcript first show Replace / Keep both / Cancel (`ReplaceTranscriptDialog`), which also says when the existing note has been edited since it was generated: the manifest's `hash` is `hashTranscript` of the note's body, ignoring the frontmatter, whitespace and the bracket escapes the editor adds on save, so a note that was merely opened does not count as edited. Renaming a speaker regenerates the body from `segments.json` only while that hash still matches; for an edited note it offers "Update names in text", which replaces the old name where a turn begins (`**Old name** [`) and nothing else.

**The Recordings place:** `RecordingsView` (`src/components/recordings/`) is a mode of the document column like the Inbox, opened from the sidebar row. It is left by opening any document (`useFileOperations.openFile`, and an `editor-store` subscription in `recordings-store` that also catches `openTab` callers that bypass it), by creating a note, by Esc, and by clicking the row again. `recordings-store` lists the folder with ONE `list_directory` one level deep (bundle folders and the file names in each), then one manifest read per bundle, `audio_file_status` only for bundles without a transcript and `speakers.json` only where it exists; it reloads itself (debounced) on `file-changed-batch` under the folder and when a transcription job starts or ends, never on progress. A row shows the title, date, length (`h:mm:ss`), size, source (Microphone / System audio / both / Imported from *file*), language, speakers, and one status: Not transcribed, Queued, Transcribing N% (with Cancel), Transcribed, Transcription failed (with the reason and Try again), Downloading from iCloud… (no Transcribe until the audio is local), or Transcribing on *another device*. A job running on this Mac is read live from `activity-store` by a selector of primitives, so progress re-renders one row. Actions: Open transcript, Transcribe / Transcribe again (model and language menu, shared with the card: `RerunTranscriptionMenu`), Rename (sets `title`; the folder keeps its stamp), Speakers, Add Teams transcript, Move to project and Delete to the Trash (both refused while the recording is being transcribed), Reveal. A folder with audio and no `recording.json` is listed as Not transcribed, and Transcribe adopts it (`adoptOrphanBundle` writes the manifest). Above about sixty rows the list is windowed (`@tanstack/react-virtual`, as in the Inbox).

**Import:** "Import recording…" (and a file dropped on the view, when the shell supplies its path) calls `import_media(source, <library>/Recordings)`, which extracts the audio into a new `Import <name> <stamp>` bundle without copying the video; the frontend then writes the manifest (`source: "import"`, `originalFile { name, path }`, `title`) and starts a transcription. Offered: mp4, mov, m4a, mp3, wav, flac. WebM and Matroska cannot be decoded and are refused by name.

**Teams transcript:** `src/lib/transcription/teams-transcript.ts` is pure: `parseTeamsVtt` (a tolerant WebVTT reader: voice tags, cue ids, NOTE blocks, optional hours, `.` or `,` milliseconds, multi-line cues; `parseTeamsDocxText` for the Word export, read through `mammoth`), `estimateOffset` (every distinctive word or word pair both transcripts contain votes for the time difference between its occurrences; the peak of the histogram is the offset, refined to a tenth of a second, with a confidence from how many different tokens agree and how far the peak stands above the next; `ourTime = cueTime + offset`), and `assignSpeakers` (each of our segments takes the speaker of the cue it overlaps most; a segment spanning a hand-over is split at the nearest word boundary to the proportional position, or given whole to the majority speaker when there is none; our words are never changed or reordered). `TeamsTranscriptDialog` shows the speakers, the offset and the confidence, lets the offset be nudged with a live preview of aligned lines, and offers our text with Teams' names (default) or Teams' text. The original file is copied into the bundle.

**The manifest — `recording.json` (PRD `2026-09-05-ios-recordings.md`):** the contract between whoever recorded a bundle and the Mac that transcribes it, shared with the phone through one fixture (`tests/fixtures/recording-manifest.v1.json`, decoded by both the vitest and the Swift `Codable` test). `src/lib/transcription/manifest.ts` owns it: `RecordingManifest` (`version: 1`, `createdBy { device, app, appVersion }`, `startedAt` with offset, pause-aware `durationSecs`, `language?`, `audio { file, bytes, codec: aac | pcm, sampleRate, channels, bitrate? }`, `transcription`), `parseRecordingManifest` (strict on the fields it knows, tolerant of the ones it does not — unknown fields ride through a rewrite), `serializeRecordingManifest` (contract key order, two-space indent, trailing newline — byte-stable), `isPendingTranscription`, `withTranscriptionStatus`. The Mac writes the same manifest for its own bundles right after `stop_recording` (`useMeetingRecording.writeMacRecordingManifest`: `app: "notesage-macos"`, `codec: "pcm"`, `bytes` from `file_size`, `device` from `get_device_name`), so the format is bilateral and the scanner treats both kinds of bundle by one rule.

**Jobs:** there is one job per audio file: a second `startTranscription` for a file that has one queued or running starts nothing, and a new request for a file with a finished card reuses that card. Progress arrives on ONE `transcription-progress` listener as `{ job_id, audio_path, stage, percent }` with an integer percent; `setTranscriptionProgress` does nothing when neither percent nor stage changed, and `useTraySync` (mounted in `App`) selects the count of running tasks rather than the task array, so a progress stream re-renders neither the root nor the list. The card and the row show the stage, the time elapsed and, once there is enough progress, an estimate of what is left, measured from the first real progress (`src/lib/transcription/progress.ts`). A job waiting behind another emits nothing; "Queued" is the frontend's own bookkeeping. Cancel calls `cancel_transcription`; the rejection `Transcription cancelled` marks the task `cancelled` (not failed), and the scanner then clears the claim and sets `autoTranscribe: false` in the manifest so the recording is "Not transcribed" and is not restarted behind the user's back. A job that was running when the app quit rehydrates as *interrupted* (retryable at once), and the scanner rewrites this device's own stale `running` claim as `failed` with the reason `interrupted`. While a job runs its claim is re-stamped every five minutes, and the manifest is re-read a few seconds after claiming and at each re-stamp: if another device's fresh claim is there, this one cancels its job and leaves that claim alone. When a job longer than a minute finishes while the window is not focused, a system notification and a toast with "Open transcript" say so.

**The pending rule and discovery:** a bundle is *pending* when `recording.json` exists and its transcript (the file the manifest names, else `transcript.md`) does not. `useRecordingsInbox` (`src/hooks/useRecordingsInbox.ts`, mounted in `App.tsx` beside `useTranscriptionJob` — an unmounted hook never runs) lists `<library root>/Recordings` on `startupReady` (the Inbox's root rule: `settings.icloudNotesagePath` when sync is on, else `resolveNotesRoot`; `recordingsDir` in `notes-root.ts`) and re-evaluates any bundle a `file-changed-batch` `create` / `modify` touches (debounced 2 s per bundle). The pure `evaluateBundle` turns pending into eligible: not `done`, not `failed` (the card's Re-run is the retry — a bundle the Mac cannot decode must not burn a Whisper run every launch), not `running` on *another* device within the last hour, not already queued or running in `activity-store` by `audioPath` (a finished or failed card does not count), not cancelled by the user (`autoTranscribe: false`), and the audio on this disk with the manifest's byte count (`audio_file_status`: a truncated `.m4a` decodes silently to a truncated transcript; a file that is missing or an iCloud "dataless" file triggers `icloud_ensure_downloaded` and the scanner waits for the watcher event the arriving file produces — no polling). With no transcription model downloaded an eligible bundle waits instead of failing, and goes when one arrives. The startup scan is one `list_directory` one level deep, then one manifest read per bundle that has one. Eligible bundles enter a FIFO in stamp order and are dispatched to `startTranscription` **one at a time**. The claim — `transcription: { status: "running", device, updatedAt }` — is written into the manifest before the dispatch; `done` (with `model` and the detected `language`) and `failed` (with the `error`) are written from the activity-store transition, which also covers the Mac's own recordings and Re-runs, so the phone's recording row always shows the latest state. The `TranscriptionCard` captions a phone bundle's job *from Peter's iPhone* (`AgentTask.sourceDevice`). Mac bundles from before the manifest existed have no `recording.json` and are left alone.

**The orb / activity model:** `activity-store` carries a `kind: 'agent' | 'transcription' | 'recording'` discriminator so the `AgentPanel` renders the three distinctly — `agent` is the existing AI-delegation treatment, `recording` shows elapsed time + a stop affordance, `transcription` shows a distinct icon + progress and the "Move to project" action on completion. The orb pulses for any in-flight item, giving one continuous indicator across recording → transcribing → ready.

**Choosing a model — measure, do not guess (#698):**

`pnpm compare:whisper <audio.wav> [reference.txt]` runs one recording through
EVERY downloaded model and prints load time, transcribe time, peak RAM, the
language Whisper detected, and the transcripts side by side. With a reference
transcript it also reports word error rate, which is the only honest way to
separate the sizes — by ear, `small` and `medium` both sound plausible until
checked against what was actually said.

Use your OWN audio. The standard fixtures shipped with whisper.cpp and OpenAI's
Whisper are clean studio English; a meeting captured on a laptop microphone is
the case that matters here, and Swedish is a first-class case that
English-only fixtures say nothing about. For labelled multi-language audio,
Mozilla Common Voice (CC0), FLEURS and VoxPopuli all ship reference
transcripts and include Swedish.

Like `calibrate_model_fit`, this is a manual harness — it needs real models
and real hardware, so it never runs in CI.

**Whisper model management:**

- Two models, chosen by measurement rather than by size ladder
  (`docs/transcription-model-comparison.md`):
  **large-v3-turbo-q5_0** (809M, 0.6 GB) — "Best quality · all languages", the
  default; and **small** (244M, 0.7 GB) — "Fast · English only", five times
  faster but 25.6% word error outside English. The full `large-v3` was dropped:
  it measured no better than the quantized turbo while needing 3.5 GB. Models
  downloaded by older versions stay listed and deletable, marked as no longer
  offered
- Models downloaded from Hugging Face in GGML format
- Concurrent downloads with per-model progress bars and cancel buttons
- Model management in Settings → Transcription (`TranscriptionSettings`): each model says "Downloaded" or "Not downloaded"; a download shows MB done / total, speed and time left (integer-percent updates only), and a failed one says why with Retry. The model select never goes blank: a selected model that is not on disk is shown as such with a download button. The page also holds the recording source (Microphone / System audio / Both)
- The selected **transcription model** (`recording-store.defaultModel`) and **recording language** (`recording-store.speechLanguage`) drive the whole-file `transcribe_file` job

## Chronological Message Segments

Assistant messages render as an ordered stream of typed segments, matching the UX of Claude Code, Cursor, and Cline.

**Data model:** `ChatMessage.segments?: Segment[]` — an ordered array of discriminated union types:

| Segment Type | Fields | Visual Treatment |
| --- | --- | --- |
| `TextSegment` | `content` | Markdown-rendered text (same as legacy) |
| `ThinkingSegment` | `content`, `collapsed` | Muted italic text, collapsible. Auto-expanded while streaming, auto-collapsed on turn complete. |
| `ToolCallSegment` | `kind`, `label`, `detail`, `status`, `locations`, `content` | Compact inline: icon + descriptive label (e.g. "Reading config.ts") + status indicator. Hover shows full arguments. **Rich content** — when an ACP agent emits `tool_call_update.content`, embedded `Diff` blocks render as collapsible unified diffs (+/- coloring via `--color-diff-*`), `Content` text blocks as collapsible monospace output, and `Terminal` blocks as a muted placeholder. |
| `ToolResultSegment` | `result`, `error`, `collapsed` | Collapsible monospace output, collapsed by default. Error state in red. |
| `ImageSegment` | `data`, `mimeType`, `alt` | Base64 image rendered inline with click-to-preview overlay (centered, backdrop blur, Escape to close). |

**Descriptive tool labels:** `formatToolLabel(kind, args)` in `src/lib/ai/acp-utils.ts` extracts the most informative argument for each tool kind — file basenames for read/write, truncated commands for bash, quoted queries for search, hostnames for fetch. Falls back to generic labels when arguments are unavailable.

**Dual-write:** During streaming, both `segments[]` (for chronological rendering) and `content` (for search/export) are updated in parallel. The `activities[]` and `toolCallActivities[]` fields continue to be written for backward compatibility with old messages.

**Backward compatibility:** Messages without `segments` (or with an empty array) render using the legacy flat path — zero visual change. No migration needed.

**Store actions:** `appendTextSegment`, `pushSegment`, `updateSegment`, `finalizeSegments` on `chat-store`. All produce new array references and update `conv.updatedAt` for Zustand selector cache invalidation.

**Export:** Markdown export renders segments chronologically (text as paragraphs, thinking as blockquotes, tool calls as bold-label blockquotes, results as nested blockquotes). JSON export includes the full `segments` array.

**Key files:**

| File | Purpose |
| --- | --- |
| `src/lib/ai/types.ts` | `Segment` union type, segment interfaces, `ToolCallContentItem` discriminated union |
| `src/lib/ai/acp-utils.ts` | `formatToolLabel`, `parseRawInput`, `normalizeToolCallContent` (ACP content → frontend union) |
| `src/lib/ai/diff-utils.ts` | `computeUnifiedDiff` — line-level diff with context windows and truncation |
| `src/stores/chat-store.ts` | Segment store actions |
| `src/lib/conversationOps.ts` | Pure conversation utilities (autoTitle, prune, stale path cleanup) |
| `src/lib/segmentOps.ts` | Pure segment utilities (append, push, update, finalize, reset) |
| `src/hooks/useDirectApiChat.ts` | Segment dual-write (direct API streaming) |
| `src/hooks/useAcpSessionListeners.ts` | Segment dual-write (ACP streaming), tool-call content extraction |
| `src/components/chat/segments/` | `TextSegmentView`, `ThinkingSegmentView`, `ToolCallSegmentView`, `ToolResultSegmentView`, `ImageSegmentView`, `DiffContentView`, `TextContentView` |
| `src/components/chat/ChatMessage.tsx` | `SegmentRenderer` — renders segments or falls back to legacy |

## Key Files

| File | Purpose |
| --- | --- |
| `src/components/cmd/FloatingCommandBar.tsx` | Floating composer / pinned right-edge panel — the chat surface and message input (prefix-mode pickers — `/` skills, `@` references, etc. — live in `src/components/cmd/modes/`) |
| `src/components/chat/ChatMessageList.tsx` | Conversation stream (segments, branches, tool calls) |
| `src/components/chat/PermissionCard.tsx` | ACP tool call approval |
| `src/components/chat/ToolCallPermissionCard.tsx` | Direct API tool call approval |
| `src/components/editor/CommentPopover.tsx` | Comment create/view/delegate |
| `src/components/activity/AgentOrb.tsx` | Agent orb pulse + popover trigger |
| `src/components/activity/AgentPanel.tsx` | Agent task list inside the orb popover |
| `src/hooks/useCommentDelegation.ts` | Comment → agent delegation flow |
| `src/hooks/useAgentTaskOperations.ts` | Background agent task management |
| `src/hooks/useSkillOperations.ts` | Skill/agent discovery |
| `src/hooks/useRecording.ts` | Pause / resume, the recorded-time ticker (`get_recording_state`), source labels and error wording |
| `src/hooks/useMeetingRecording.ts` | The whole recording flow: preflight → start → stop → manifest → finalize → transcription; discard; warnings; startup recovery; the phase guard |
| `src/components/activity/RecordingIndicator.tsx` | The always-visible indicator (sidebar row / floating chip); `RecordingLevelMeter.tsx` is its non-rendering meter, `RecordingStatusHost.tsx` the single live region and the discard confirmation, `RecordingSourcePicker.tsx` the source choice |
| `src/components/activity/RecordingControl.tsx` | The labelled Record / Stop button in the AgentOrb panel header (#696) |
| `src/hooks/useRecordingShortcut.ts` | `⌘⇧R` / `⌘⇧U` wiring and the backend recording-event listeners, mounted at the app root so they survive with no editor open |
| `src/hooks/useTranscriptionJob.ts` | Background transcription-job orchestrator (mounted in `App.tsx`) — capture stop → whole-file transcribe → render note → bundle → "Move to project" |
| `src/hooks/useRecordingsInbox.ts` | Recordings scanner (mounted in `App.tsx`) — lists `<library root>/Recordings`, gates on the manifest's byte count, dispatches phone bundles one at a time, writes claim / done / failed back into `recording.json` |
| `src/lib/transcription/manifest.ts` | The `recording.json` contract — parse (tolerant), serialize (byte-stable key order), pending rule, status rewrite |
| `src/lib/transcription/render-transcript.ts` | The LEGACY transcript format (segments in frontmatter): kept to read old bundles |
| `src/lib/transcription/segments.ts` | `segments.json` / `speakers.json`, `renderTranscriptBody`, the transcript note, its content hash, file naming (pure) |
| `src/lib/transcription/transcript-files.ts` | Writing transcripts (never overwriting unasked), renaming speakers and recordings, adopting a manifest-less bundle, attaching a Teams transcript |
| `src/lib/transcription/teams-transcript.ts` | Teams WebVTT / Word parser, offset estimation, speaker assignment (pure) |
| `src/lib/transcription/bundle.ts` | Bundle paths, manifest read / write / serialised update, move-to-project |
| `src/stores/recordings-store.ts` | The Recordings list (shallow listing, self-refresh), open/close, transcribe / rename / delete / move / import |
| `src/components/recordings/RecordingsView.tsx` | The Recordings place: header (Record, Import), filter, rows, dialogs |
| `src/components/activity/cards/RerunTranscriptionMenu.tsx` | Model + language choice for "Transcribe (again)", shared by the card and the Recordings row |
| `src/stores/chat-store.ts` | Chat conversation state, branching, `sliceThreadBySegment`, scoped approvals migration |
| `src/stores/message-queue-store.ts` | Per-conversation FIFO of messages sent while the conversation's run was in flight (queue-during-agent-work) |
| `src/hooks/useMessageQueueDrain.ts` | Dispatches queued messages (fresh thread, FIFO, foreground-only) when the run finishes |
| `src/lib/chat-tree.ts` | Tree traversal utilities (getThread, getChildren, getBranches, getLeaves) |
| `src/lib/ai/project-lock.ts` | `ProjectLockViolation` + lock lookup utilities |
| `src/components/chat/ResendProviderDialog.tsx` | Provider-mismatch confirmation dialog for resend / edit |
| `src/components/chat/BranchSwitcher.tsx` | Branch switcher popover at branch points |
| `src/components/cmd/AttachmentChips.tsx` | Attachment chip strip above the command-bar input (file / person / comment / task / research chips; image attachments render as thumbnails in the same strip) |
| `src/components/settings/ApprovalsSettings.tsx` | Privacy > Approvals panel (revoke / bulk revoke) |
| `src/lib/ai/vision.ts` | Vision capability detection + editor→chat image event bus |
| `src/lib/image-compress.ts` | Client-side image compression pipeline |
| `src/stores/skill-store.ts` | Skills registry, agents, instructions |
| `src/stores/comment-store.ts` | Comments, replies, delegation |
| `src/stores/activity-store.ts` | Agent / transcription / recording task registry (`kind` discriminator) |
| `src/stores/recording-store.ts` | Recording phase, source, recorded seconds, warnings, the non-rendering level channel; transcription model + recording language defaults; Whisper model catalog and download progress |
| `src-tauri/src/commands/transcription.rs` | Mic capture-to-WAV (`start_recording`/`stop_recording`), whole-file `transcribe_file`, Whisper model management |
| `src-tauri/src/commands/skills.rs` | Skill/agent discovery, script execution |
| `src-tauri/src/commands/mcp/` | MCP client (`mod.rs` commands, `transport.rs`, `state.rs`, `validation.rs`, `config.rs`, `catalog.rs`, `stderr_drain.rs`) |

## Future Enhancements

- Comment assignment to specific agents (currently always uses `agent_tasks` slot)
- Workflows & Automation: user-defined YAML workflows as skills
