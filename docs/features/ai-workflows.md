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
- **ACP session modes**: Permission-level mode picker (Shield icon) in command bar. Agent-specific mode IDs mapped to common levels: Read Only, Agent, Full Access, Plan. Hidden by default — enable in Settings > Advanced. Full Access triggers a conflict dialog when sandbox restrictions are active.
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
- Settings > Privacy > Approvals panel lists every persisted approval with per-row revoke and bulk-revoke (all legacy, all for a connection, all for a project).
- "Require confirmation for all tool calls" global toggle in Settings > Advanced (default off) disables auto-allow entirely; every tool call gets a permission card.

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
- Skill & agent management: delete and move (global ↔ project) for custom items, gated behind Settings > Advanced toggle
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

- MCP (Model Context Protocol) client in the Rust backend (`commands/mcp.rs`) with two transports behind the `McpConn` enum:
  - **stdio** — JSON-RPC 2.0 over a spawned child process's stdin/stdout (cleanup on app exit)
  - **http (Streamable HTTP)** — JSON-RPC POSTed to a single endpoint; responses parsed from `application/json` or `text/event-stream` (SSE), with `Mcp-Session-Id` persisted across requests. No child process; the protocol helpers (`mcp_initialize`, `mcp_list_tools_from_server`, `mcp_call_tool_on_server`) are transport-agnostic.
- **Curated catalog** (`mcp-catalog.json`, `mcp_catalog_list`) — a "Browse catalog" picker of opt-in server templates, seeded with the official MCP reference servers (Filesystem, Fetch, Memory, Git, Sequential Thinking, Time, Everything), badged "Official" with provenance links. Selecting one pre-fills the Add dialog; nothing runs until the user confirms.
- **Validate-on-add** (`mcp_validate_server`) — a dry run (spawn/connect → `initialize` → `tools/list` → stop) that previews a server's tools on success or shows a mapped error (`binary_not_found` / `spawn_failed` / `init_failed` / `timeout`) on failure. A config is written to `mcp.json` only after a successful dry run.
- **Env secrets in the keychain** — env values flagged secret are stored in the OS keychain (`notesage:mcp:<server_id>:<KEY>`); `mcp.json` keeps only a `{ "secret": true }` reference (`McpEnvValue`). Secrets are resolved at spawn, never written to disk, never returned to the frontend.
- **OAuth 2.1 for protected remote servers** (`commands/mcp_oauth.rs`) — authorization-code + PKCE (S256), RFC 9728→8414 metadata discovery, RFC 7591 dynamic client registration, a transient loopback `127.0.0.1` callback, and refresh. Tokens live in the keychain (`notesage:mcp:<server_id>:oauth`); `HttpMcpClient` attaches `Authorization: Bearer` when a server is authorized. Commands: `mcp_oauth_authorize` / `mcp_oauth_status` / `mcp_oauth_logout`. Add dialog has an "Authorize" button; server cards offer Re-authenticate / Sign out.
- **Deep-link install** — `notesage://mcp/install?...` links (parsed by `src/lib/mcp/deeplink.ts`) open the validate-first Add dialog pre-filled, via the `notesage` scheme (`tauri-plugin-deep-link`) and `McpDeepLinkInstaller` mounted at the app root.
- Tool discovery from connected servers, displayed in Tools popover
- Import existing MCP configs from Claude Desktop, Cursor, VS Code
- `.notesage/mcp.json` (project) and `~/.notesage/mcp.json` (global) for Notesage-specific servers; project-scoped servers default to disabled (security). PRD: `docs/prds/2026-06-03-mcp-registration-ux.md`

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

**Data model — segments, not a blob:**

The transcript is stored as an ordered list of `TranscriptSegment` (`start`, `end`, `text`, `speakerId: string | null`, `speakerName: string | null`). `speakerId` / `speakerName` are reserved for a future diarization + naming pass and are `null` in v1. The renderer (`src/lib/transcription/render-transcript.ts`) collapses segments into readable paragraphs for the note body and persists the raw segment array in the note's YAML frontmatter, so a later diarization pass can reconstruct structure and re-render speaker-grouped (`**Alice:** …`) without re-recording. The retained `audio.wav` makes that upgrade re-processable.

**The artifact bundle:** each recording is a folder under the inbox (and later the chosen project) holding `audio.wav` (finalized capture) + `transcript.md` (note rendered from segments). The folder keeps the pair together so "move to project" is a single atomic move (`src/lib/transcription/bundle.ts`, reusing `rename_path` / `copy_directory`).

**The orb / activity model:** `activity-store` carries a `kind: 'agent' | 'transcription' | 'recording'` discriminator so the `AgentPanel` renders the three distinctly — `agent` is the existing AI-delegation treatment, `recording` shows elapsed time + a stop affordance, `transcription` shows a distinct icon + progress and the "Move to project" action on completion. The orb pulses for any in-flight item, giving one continuous indicator across recording → transcribing → ready.

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
- Model management in Settings > Voice (the legacy `TranscriptionSettings` panel)
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
| `src/hooks/useRecording.ts` | Mic capture lifecycle (start/stop → WAV file, elapsed timer, `recording-level` events) |
| `src/hooks/useMeetingRecording.ts` | Start-stop trigger for a meeting recording |
| `src/components/activity/RecordingControl.tsx` | The mic / stop control in the AgentOrb panel header (#696) |
| `src/hooks/useRecordingShortcut.ts` | `⌘⇧R` wiring, mounted at the app root so it survives with no editor open |
| `src/hooks/useTranscriptionJob.ts` | Background transcription-job orchestrator (mounted in `App.tsx`) — capture stop → whole-file transcribe → render note → bundle → "Move to project" |
| `src/lib/transcription/render-transcript.ts` | `TranscriptSegment[]` → transcript note (paragraphs + segments in frontmatter) |
| `src/lib/transcription/bundle.ts` | Recording-bundle folder creation + move-to-project |
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
| `src/stores/recording-store.ts` | Meeting-recording state, transcription model + recording language defaults, Whisper model catalog |
| `src-tauri/src/commands/transcription.rs` | Mic capture-to-WAV (`start_recording`/`stop_recording`), whole-file `transcribe_file`, Whisper model management |
| `src-tauri/src/commands/skills.rs` | Skill/agent discovery, script execution |
| `src-tauri/src/commands/mcp.rs` | MCP client |

## Future Enhancements

- Comment assignment to specific agents (currently always uses `agent_tasks` slot)
- Workflows & Automation: user-defined YAML workflows as skills
