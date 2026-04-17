# AI Workflows

Chat, agents, skills, comment delegation, research, and voice transcription — the user-facing AI features built on top of the [AI Providers](ai-providers.md) infrastructure.

## Chat Panel

Collapsible right sidebar (Cmd+Shift+C) with streaming AI responses.

**Direct API path:**

1. User types message in ChatInput
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

- Message resend: one-click resend of any user message, creates a new branch from the message's parent with the same content
- Message edit: click edit on a user message to pre-fill the input, modify and send as a new branch. "Editing message" banner with cancel (X or Escape)
- Quick reply chips: AI responses can include `<quick-replies>` tags with suggested follow-ups
- Custom prompts/templates for AI actions
- Project-scoped AI context (provider, agent, and context overrides per project)
- Multi-select project selector in chat footer
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
- **ACP session modes**: Permission-level mode picker (Shield icon) in chat footer. Agent-specific mode IDs mapped to common levels: Read Only, Agent, Full Access, Plan. Hidden by default — enable in Settings > Advanced. Full Access triggers a conflict dialog when sandbox restrictions are active.
- **ACP config options**: Dynamic config dropdowns (e.g., thinking effort with Brain icon) populated from agent session response. Values set via `session/set_config_option`.
- **ACP usage tracking**: Live token count displayed in chat footer during ACP sessions (e.g., "4.2K / 200K"). Cost shown on hover tooltip when agent provides it.
- **ACP plan display**: Agent execution plans rendered as collapsible `PlanSegment` cards with step status icons (pending/in_progress/completed) and priority indicators.
- **ACP agent slash commands**: Agent-specific commands (e.g., `/compact`, `/clear`) appear in the `/` command menu alongside Notesage skills, distinguished by Terminal icon.
- **ACP thinking segments**: Agent reasoning output (`agent_thought_chunk`) displayed as collapsible thinking blocks in chat messages.
- **ACP session titles**: Agent-generated conversation titles (`session_info_update`) automatically applied to chat history.

**Provider context isolation:**

- When switching AI provider mid-conversation, an `AgentSwitchCard` prompts the user to start fresh or include previous history
- Starting fresh creates a segment boundary — messages before the boundary are excluded from API calls to the new provider
- Including history carries all messages forward to the new provider
- Segment filtering applied at send time in `ChatPanel.tsx` using `ConversationSegment.startMessageIndex` and `historyIncluded`

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
- Agent picker dropdown in chat footer; `@agent-name` addressing in chat input for per-message scoping
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

- MCP (Model Context Protocol) client in Rust backend using stdio transport with JSON-RPC 2.0
- Spawn and manage MCP servers as child processes with cleanup on app exit
- Tool discovery from connected servers, displayed in Tools popover
- Import existing MCP configs from Claude Desktop, Cursor, VS Code
- `.notesage/mcp.json` (project) and `~/.notesage/mcp.json` (global) for Notesage-specific servers

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

**Multi-turn threads & apply-to-document:**

- User can reply to the agent, agent responds again — full conversation history in each prompt
- "Apply" button on agent replies — shows inline diff on anchor text via `AISuggestion` decoration
- Same review UX as Improve/Summarize/Expand: accept via `Cmd+Enter`, reject via `Cmd+Backspace`
- Preamble stripping removes introductory phrases before applying
- Multi-turn task reuse: `existingTaskId` keeps conversations as a single task in activity panel

**Agent activity strip & panel:**

- Activity strip: narrow 40px rail showing per-task status icons
- Activity panel: resizable sidebar with full task details, toggled via Cmd+Shift+A or title bar button
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

**Research file format:** Standard markdown with YAML frontmatter (`source_url`, `title`, `author`, `date_saved`, `tags`, `word_count`). Stored in `.notesage/research/` (project) or `~/Notesage/.notesage/research/` (global).

**Searching:** `Cmd+4` (or type `?` in command palette) opens research search mode. Real-time filtering via native Rust `search_research` command.

**Citing:** Three citation formats (inline links, footnotes, academic). Citation format persisted per-project.

## Voice Transcription & Dictation

On-device speech-to-text powered by whisper-rs with Metal GPU acceleration — fully offline.

**Dictation (live):**

- Real-time speech-to-text inserted at cursor position
- Web Speech API tried first; auto-falls back to whisper-rs in WKWebView
- Language selection from 99 supported languages
- Hallucination filtering removes Whisper artifacts
- RMS silence detection skips empty audio chunks
- Keyboard shortcut: Cmd+Shift+R to toggle recording

**Meeting recording & transcription:**

- Record audio from microphone with visual recording indicator
- Stop recording opens transcription dialog with model selection
- Full transcription with timestamped segments and progress tracking

**Whisper model management:**

- 5 model sizes: Tiny (39M), Base (74M), Small (244M), Medium (769M), Large v3 (1550M)
- Models downloaded from Hugging Face in GGML format
- Concurrent downloads with per-model progress bars and cancel buttons
- Model management in Settings > Transcription tab
- Auto-download: Whisper base model downloaded automatically on first dictation if no model is available

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
| `src/components/chat/ChatPanel.tsx` | AI chat sidebar |
| `src/components/chat/ChatInput.tsx` | Message input (/ for skills, @ for agents) |
| `src/components/chat/PermissionCard.tsx` | ACP tool call approval |
| `src/components/chat/ToolCallPermissionCard.tsx` | Direct API tool call approval |
| `src/components/editor/CommentPopover.tsx` | Comment create/view/delegate |
| `src/components/activity/ActivityStrip.tsx` | Agent activity strip + panel |
| `src/hooks/useCommentDelegation.ts` | Comment → agent delegation flow |
| `src/hooks/useAgentTaskOperations.ts` | Background agent task management |
| `src/hooks/useSkillOperations.ts` | Skill/agent discovery |
| `src/hooks/useRecording.ts` | Audio recording lifecycle |
| `src/hooks/useTranscription.ts` | Whisper transcription with progress |
| `src/hooks/useSpeechRecognition.ts` | Live dictation |
| `src/stores/chat-store.ts` | Chat conversation state (branching actions, tree selectors) |
| `src/lib/chat-tree.ts` | Tree traversal utilities (getThread, getChildren, getBranches, getLeaves) |
| `src/components/chat/BranchSwitcher.tsx` | Branch switcher popover at branch points |
| `src/components/chat/AttachmentStrip.tsx` | Image attachment thumbnails with remove buttons |
| `src/lib/ai/vision.ts` | Vision capability detection + editor→chat image event bus |
| `src/lib/image-compress.ts` | Client-side image compression pipeline |
| `src/stores/skill-store.ts` | Skills registry, agents, instructions |
| `src/stores/comment-store.ts` | Comments, replies, delegation |
| `src/stores/activity-store.ts` | Agent task registry |
| `src/stores/recording-store.ts` | Voice recording state |
| `src-tauri/src/commands/transcription.rs` | Voice recording, Whisper, model management |
| `src-tauri/src/commands/skills.rs` | Skill/agent discovery, script execution |
| `src-tauri/src/commands/mcp.rs` | MCP client |

## Future Enhancements

- Comment assignment to specific agents (currently always uses `agent_tasks` slot)
- Workflows & Automation: user-defined YAML workflows as skills
