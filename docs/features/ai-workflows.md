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
- Tool call permission cards appear inline when write/execute tools need approval
- Tool call deny messages: when a tool call is denied, a chat message is shown ("Tool call X was denied")
- Domain deny/timeout messages: blocked or timed-out domain requests shown as chat messages
- Chat panel resizable up to 50% of the content area

**Provider context isolation:**

- When switching AI provider mid-conversation, an `AgentSwitchCard` prompts the user to start fresh or include previous history
- Starting fresh clears conversation state; including history carries messages forward to the new provider

## Addressable Agents

File-based agent system replacing legacy personas, aligned with industry standards.

- Discover agent files from `agents/` directories: `.notesage/agents/`, `~/.notesage/agents/`, `~/.claude/agents/`, `.github/agents/`, etc.
- Agent files: markdown with YAML frontmatter (`name`, `description`, `model`, `icon`, `allowed-tools`)
- Agent picker dropdown in chat footer; `@agent-name` addressing in chat input for per-message scoping
- 7 bundled agents (General Assistant, Creative Writer, Technical Editor, Fact Checker, Academic Writer, Copywriter, Proofreader)
- Agent-to-skill connection: `allowed-tools` frontmatter filters which skills an agent can access
- Agents section in Settings > Skills & Agents for viewing, enabling/disabling
- Skill & agent management: delete and move (global ↔ project) for custom items, gated behind Settings > Advanced toggle
- One-time migration: custom personas auto-converted to agent `.md` files on first launch

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
