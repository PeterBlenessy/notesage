# AI Chat UX Patterns: Tool Calls, Thinking, and Agent Actions

Research conducted 2026-04-02. Compares how major AI coding/chat applications handle interleaving of assistant text with tool calls, thinking, and agent actions.

## 1. Claude Desktop (claude.ai)

**Stream:** Single chronological chat stream. Artifacts render in a separate side panel.

**Thinking:** Collapsible block above the response. During processing, a "Thinking" indicator with timer is shown. After completion, collapsed by default — users opt-in to expand.

**Tool use:** Inline indicator blocks within the chat stream. Analysis tool shows "Ran code" as a collapsible block. Web search citations appear as numbered "Sources" section. MCP Apps render as inline cards or fullscreen interactive views.

**Streaming:** Text streams in real-time. Tool indicators appear when tools begin executing. Response text continues after tool completion.

**Sources:** [Extended Thinking](https://support.claude.com/en/articles/10574485-using-extended-thinking), [Interactive Tools](https://claude.com/blog/interactive-tools-in-claude), [Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

## 2. Claude Code (CLI)

**Stream:** Single chronological terminal stream built with Ink (React renderer for CLI).

**Thinking:** Collapsible blocks. Toggle with Tab key. Thinking budget indicator shown.

**Tool calls:** Inline in the chronological stream as distinct blocks. All tool outputs are fully expanded by default — this is an acknowledged UX gap (GitHub issue #36462). Colored left-margin dots distinguish message types.

**Streaming:** SSE-based incremental rendering. Tool calls execute sequentially, each visible to the user. Binary "Brief mode" (Ctrl+Shift+B) hides or shows all tool output — no per-section granularity.

**Sources:** [Architecture Deep Dive](https://dev.to/oldeucryptoboi/inside-claude-codes-architecture-the-agentic-loop-that-codes-for-you-cmk), [GitHub Issue #36462](https://github.com/anthropics/claude-code/issues/36462)

## 3. OpenAI Codex CLI

**Stream:** Full-screen terminal TUI with typed cell-based architecture. Three-layer structure: App, ChatWidget, BottomPane.

**Thinking:** Dedicated `ReasoningSummaryCell` component in the transcript stream.

**Tool calls:** Each action type has its own cell renderer: `ExecCell` (shell), `McpToolCallCell` (MCP tools), `AgentMessageCell` (text). Committed to transcript in chronological order. Approval requests pause execution as modal overlays.

**Streaming:** Adaptive chunking — buffers and commits in batches. Transcript overlay (Ctrl+T) provides scrollable view of committed cells.

**Sources:** [Codex CLI Features](https://developers.openai.com/codex/cli/features), [DeepWiki: TUI Architecture](https://deepwiki.com/halfprice06/codex/4.2-terminal-ui-(tui))

## 4. GitHub Copilot Chat (VS Code)

**Stream:** Chat panel in sidebar. Agent mode shows edits as inline diffs in the editor.

**Thinking:** Not prominently surfaced. "Planning" feature creates a dynamic markdown plan file.

**Tool calls:** Transparently displayed inline. Terminal commands require approval. File edits appear as proposed inline changes. Agent Logs debug view shows chronological event log.

**Streaming:** Code edits stream directly into editor as inline diffs. Text streams in chat while tools execute.

**Sources:** [Copilot Chat Docs](https://code.visualstudio.com/docs/copilot/chat/copilot-chat), [Agent Mode](https://code.visualstudio.com/blogs/2025/02/24/introducing-copilot-agent-mode)

## 5. Zed Editor (Agent Panel)

**Stream:** Single chronological stream via GPUI `list()` element. Four entry types: UserMessages, AssistantMessages, ThinkingBlocks, ToolCallChunks.

**Thinking:** `ThinkingChunk` component. Auto-expand while in progress, collapse after completion. Issue #52536 flagged a regression where thinking blocks rendered fully expanded.

**Tool calls:** `ToolCallChunk` components with status indicators. Expandable blocks tracked via `expanded_tool_calls` HashSet. Terminal output expansion configurable (`expand_terminal_card` setting). Permission dropdown selectors for approval granularity.

**Sources:** [Agent Panel Docs](https://zed.dev/docs/ai/agent-panel), [GitHub Issue #52536](https://github.com/zed-industries/zed/issues/52536)

## 6. Cursor

**Stream:** Chat sidebar. Agent mode (Cursor 2.0) redesigned around agent-centric layout.

**Thinking:** Before each tool call, the LLM explains what it is about to do in natural language text. No raw thinking block — the "think-then-act" pattern is the primary way reasoning is surfaced.

**Tool calls:** Inline steps in the chat stream. File references as context pills. "Review changes" button at end opens unified diff. Auto-checkpoints at each request. Up to 25 tool calls per session.

**Streaming:** Text streams while tools execute. Pre-tool-call explanation streams first, then tool executes.

**Sources:** [How Cursor Works](https://blog.sshh.io/p/how-cursor-ai-ide-works), [Agent Docs](https://docs.cursor.com/chat/agent), [Cursor 2.0](https://cursor.com/changelog/2-2)

## 7. Cline (VS Code Extension)

**Stream:** VS Code sidebar webview. Single chronological stream with React + Radix UI + Framer Motion.

**Thinking:** Dedicated `ThinkingRow` component, separate from assistant messages.

**Tool calls:** Colored timeline bars for execution states. Strict human-in-the-loop approval: `Task.ask()` suspends execution until user clicks "Approve." `parseAssistantMessageV2` separates streaming events into "text blocks" and "tool-use blocks" with distinct rendering. File changes shown via `DiffViewProvider`. Workspace checkpoints per step with Compare/Restore.

**Modes:** Plan mode (amber, read-only analysis) and Act mode (blue, execute with approval).

**Sources:** [Cline Marketplace](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev), [DeepWiki: Architecture](https://deepwiki.com/cline/cline)

## 8. Windsurf / Cascade

**Stream:** Sidebar chat panel with Code mode and Chat mode.

**Thinking:** Real-time thinking with variable depth based on task complexity. Loading indicators during thinking.

**Tool calls:** Up to 20 tool calls per prompt. Recent updates improved MCP tool call visibility (tool name + arguments). Step-by-step plan shown before changes. Table of contents of past messages for navigation. Checkpoints with "Revert this step." Parallel multi-agent sessions.

**Sources:** [Cascade Docs](https://docs.windsurf.com/windsurf/cascade/cascade), [Windsurf Changelog](https://windsurf.com/changelog)

## Comparison Matrix

| Aspect | Claude Desktop | Claude Code | Codex CLI | Copilot | Zed | Cursor | Cline | Windsurf |
|--------|---------------|-------------|-----------|---------|-----|--------|-------|----------|
| **Stream** | Chat + side panel | Terminal | TUI cells | Chat + editor | GPUI list | Chat + editor | Webview | Chat + editor |
| **Thinking** | Collapsible | Collapsible | Cell type | Planning doc | Collapsible chunk | Natural language | ThinkingRow | Real-time |
| **Tool calls** | Inline indicators | Inline expanded | Typed cells | Inline + debug | Expandable chunks | Inline steps | Timeline bars | Named steps |
| **Collapsed** | Yes (thinking) | No | N/A | N/A | Configurable | No | No (needs approval) | Partial |
| **Approval** | N/A | Prompts | Modal | Terminal only | Dropdowns | Auto/confirm | Every step | Step-by-step |
| **Checkpoints** | No | No | No | Undo Last | No | Auto | Per step | Per step |

## Pipeline

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [chronological-chat-segments](../prds/2026-04-02-chronological-chat-segments.md) | Complete |
| Tasks | [chronological-chat-segments-tasks](../tasks/2026-04-02-chronological-chat-segments-tasks.md) | Not started |

## Key Findings

1. **Chronological interleaving is universal.** Every application renders tool calls, thinking, and text in a single chronological stream. None use a separate panel for activities.

2. **Tool calls are visually distinct blocks** — cards, cells, chunks, or bars with icons and status. Never plain text.

3. **Thinking is collapsible** — expanded while running, collapsed after (Claude Desktop, Zed). Cursor takes a unique approach: the model explains intent in natural language instead of showing raw reasoning.

4. **Cline's parsing approach is directly relevant** — `parseAssistantMessageV2` splits events into text blocks and tool-use blocks rendered in order within one turn.

5. **Zed's architecture is the closest model** — four typed entry blocks (User, Assistant, Thinking, ToolCall) rendered chronologically within a single list, with configurable expand/collapse per block type.

6. **Tool call labels must be descriptive** — every app shows *what* is being done, not just the tool category. Claude Code shows the actual file path and command. Cursor shows file references as context pills. Cline shows file paths in its timeline. Notesage currently reduces `rawInput` and `call.arguments` to generic verbs ("Editing file", "Running command") — the data is available but discarded in `formatAcpToolName()` and `useDirectApiChat.ts`. The fix is to extract the key argument (file basename, command text, search query) into the tool call label.
