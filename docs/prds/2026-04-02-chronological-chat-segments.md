# PRD: Chronological Chat Message Segments

|  |  |
| --- | --- |
| **Date** | 2026-04-02 |
| **Status** | Implemented |
| **Priority** | High |
| **Impact** | Chat responses display as a natural chronological flow of text, thinking, and tool actions — matching the UX standard set by Claude Code, Zed, Cursor, and Cline |
| **Research** | [docs/research/ai-chat-ux-patterns.md](../research/ai-chat-ux-patterns.md) |

## Problem

Currently, assistant messages accumulate all text into a single `content` string and all tool actions into separate `activities[]` and `toolCallActivities[]` arrays. The UI renders these as two distinct areas: the full text response, then a collapsed "N steps completed" section at the bottom.

This creates a disconnected experience:

- The user can't see **when** during the response a tool was called
- A long response with many tool calls shows a wall of text with a collapsed activity dump at the end
- The flow of "I'll search for that... \[search\] ...found this, let me check more... \[read file\] ...here's the answer" is lost
- Every competing product (Claude Code, Zed, Cursor, Cline, Codex, Windsurf) renders tool calls and text **interleaved chronologically**

## Goals

1. **Chronological rendering** — text, thinking, and tool actions display in the order they occurred during the agent's turn
2. **Visually distinct block types** — text, thinking, and tool calls each have their own visual treatment (not all plain text)
3. **Collapsible thinking and tool results** — thinking blocks and tool call details collapse after completion; expanded while running
4. **Backward compatible** — existing conversations with the old `content` + `activities[]` format render correctly (migration path)
5. **Works for all AI paths** — ACP agents, direct API with tool calling, and inline actions

## Non-Goals

- Changing the branching model (one message per turn is preserved)
- Per-step approval UX changes (permission cards remain as-is)
- Activity panel changes (the side panel for background tasks is unrelated)
- Streaming architecture changes (event handlers just write to a different structure)
- Checkpoint/revert functionality (future enhancement)

## Design

### Data Model: Message Segments

Replace the flat `content` string + separate arrays with an ordered `segments` array on assistant messages:

```typescript
interface MessageSegment {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result';
  timestamp: number;
}

interface TextSegment extends MessageSegment {
  type: 'text';
  content: string;
}

interface ThinkingSegment extends MessageSegment {
  type: 'thinking';
  content: string;
  collapsed: boolean; // true after turn completes
}

interface ToolCallSegment extends MessageSegment {
  type: 'tool_call';
  kind: string;          // e.g. "Read", "web_search", "Bash"
  label: string;         // Descriptive label (see "Descriptive Tool Labels" below)
  detail?: string;       // Full input/arguments for expand view
  status: 'running' | 'done' | 'error';
}

interface ToolResultSegment extends MessageSegment {
  type: 'tool_result';
  toolCallId?: string;   // Links to the tool_call segment
  result?: string;       // Output text (truncated for display)
  error?: string;
  collapsed: boolean;    // true by default, expandable
}

type Segment = TextSegment | ThinkingSegment | ToolCallSegment | ToolResultSegment;
```

On `ChatMessage`:

```typescript
interface ChatMessage {
  // ... existing fields ...
  
  /** Ordered segments for chronological rendering. When present, takes
   *  precedence over `content` and `activities[]` for display. */
  segments?: Segment[];
  
  // Keep `content` as the full concatenated text for:
  // - Search/filter across conversations
  // - Export (markdown, JSON)
  // - Backward compatibility with old messages
  content: string;
  
  // Deprecated — retained for backward compat with persisted conversations.
  // New messages write to `segments` instead.
  activities?: AgentActivity[];
  toolCallActivities?: ToolCallActivity[];
}
```

### Segment Accumulation During Streaming

The streaming handlers (ACP session listeners and direct API chat hook) build segments as events arrive:

**ACP path** (`useAcpSessionListeners.ts`):

1. `agent_message_chunk` with text → append to current `TextSegment` (or create new one if last segment isn't text)
2. `tool_call` → push `ToolCallSegment` with status `running`
3. `tool_result` → push `ToolResultSegment`, update matching `ToolCallSegment` to `done`
4. Thinking events → push or append to `ThinkingSegment`
5. `agent_turn_complete` → mark all `ThinkingSegment` as collapsed, finalize

**Direct API path** (`useDirectApiChat.ts`):

1. `ai-stream-chunk` → append to current `TextSegment`
2. `ai-stream-thinking-chunk` → append to `ThinkingSegment`
3. `ai-tool-call` → push `ToolCallSegment` with status `running`
4. Tool execution completes → push `ToolResultSegment`, update `ToolCallSegment` to `done`
5. Stream done → mark thinking as collapsed, finalize

**Key rule:** When the segment type changes (text → tool_call, or tool_result → text), a new segment is started. Text chunks within the same segment are concatenated.

### Descriptive Tool Labels

**Problem:** The current implementation uses generic labels like "Editing file", "Running command", "Reading file" — stripping the most useful information (which file? what command?). The raw data is available in both AI paths but is either discarded or hidden behind collapsed sections.

**Current state:**

| Path | What we have | What we show |
|---|---|---|
| ACP | `update.rawInput` (full arguments JSON), `update.title`, `update.kind` | `formatAcpToolName()` maps kind → generic verb ("Reading file") |
| Direct API | `call.arguments` object (e.g. `{ path: "/src/foo.ts" }`) | `call.name` as label, literal `"running"` / `"completed"` as detail |

**Fix:** `ToolCallSegment.label` must include the key argument — the single most informative piece of context for that tool kind. `detail` stores the full arguments for the expandable view.

**Label format by tool kind:**

| Kind | Label format | Example |
|---|---|---|
| `read` / `read_file` | `Reading {basename}` | `Reading config.ts` |
| `write` / `write_file` / `edit` | `Editing {basename}` | `Editing package.json` |
| `bash` / `terminal` | `Running: {command (truncated)}` | `Running: npm test --watch` |
| `glob` / `list` / `list_directory` | `Searching {pattern or dir basename}` | `Searching src/components/` |
| `grep` | `Searching for "{query (truncated)}"` | `Searching for "useState"` |
| `web_search` | `Searching web: "{query (truncated)}"` | `Searching web: "React 19 changes"` |
| `fetch` | `Fetching {domain}` | `Fetching github.com` |
| `execute_skill_script` | `Running skill: {skill name}` | `Running skill: download-webpage` |
| `read_skill_content` | `Loading skill: {skill name}` | `Loading skill: create-skill` |
| Other / unknown | `{title}` or `{kind}` | `mcp_tool_name` |

**For file paths:** Show `basename` in the label (e.g., `config.ts`), full path in `detail`. For commands: truncate to ~60 chars with ellipsis. For search queries: quote and truncate to ~40 chars.

**Implementation:**

- New utility: `formatToolLabel(kind: string, args: Record<string, unknown>): string` in `src/lib/ai/acp-utils.ts`
- ACP path: call with `(update.kind, parseRawInput(update.rawInput))`
- Direct API path: call with `(call.name, call.arguments)`
- Replace `formatAcpToolName` usage in segment creation (keep it for the legacy `activeTool` spinner label)

### Chat Store Changes

New store actions:

```typescript
/** Append content to the last text segment, or create a new text segment. */
appendTextSegment(messageId: number, text: string): void;

/** Push a new segment to the message. */
pushSegment(messageId: number, segment: Segment): void;

/** Update a segment by index (e.g., mark tool_call as done). */
updateSegment(messageId: number, index: number, patch: Partial<Segment>): void;

/** Finalize all segments (collapse thinking, mark running tools as done). */
finalizeSegments(messageId: number): void;
```

The existing `updateMessage(id, content)` continues to update the flat `content` field for search/export. Both are updated in parallel during streaming.

### Rendering

`ChatMessage.tsx` checks for `message.segments`:

- **If segments exist:** render each segment in order using dedicated components
- **If no segments (old messages):** fall back to current rendering (text + collapsed activities)

Segment components:

| Segment Type | Component | Visual Treatment |
| --- | --- | --- |
| `text` | `TextSegmentView` | Markdown-rendered text, same as current assistant message |
| `thinking` | `ThinkingSegmentView` | Muted text, italic, collapsible. Expand chevron. Border-left accent. Collapsed by default after turn completes. |
| `tool_call` | `ToolCallSegmentView` | Compact card: icon (by kind) + descriptive label (e.g. "Reading config.ts") + status indicator (spinner while running, check when done). Muted background. |
| `tool_result` | `ToolResultSegmentView` | Collapsible block under the tool_call. Monospace text for output. Collapsed by default. Expand to see full output. Error state in red. |

Visual flow example:

```
┌─ Assistant ──────────────────────────────────────┐
│                                                  │
│  I'll search for information about that.         │  ← TextSegment
│                                                  │
│  ┌─ 🔍 Searching web: "React 19 changes" ── ✓ ┐ │  ← ToolCallSegment (descriptive label)
│  └──────────────────────────────────────────────┘│
│  ▸ Search results (3 items)                      │  ← ToolResultSegment (collapsed)
│                                                  │
│  Based on the results, here's what I found.      │  ← TextSegment
│  Let me also check the local file.               │
│                                                  │
│  ┌─ 📄 Reading config.ts ──────────────── ✓ ┐   │  ← ToolCallSegment (basename, not "Reading file")
│  └──────────────────────────────────────────┘    │
│  ▸ File contents (42 lines)                      │  ← ToolResultSegment (collapsed)
│                                                  │
│  ┌─ ▶ Running: npm test -- config ─────── ✓ ┐   │  ← ToolCallSegment (actual command)
│  └──────────────────────────────────────────┘    │
│  ▸ Output (12 lines)                             │  ← ToolResultSegment (collapsed)
│                                                  │
│  The configuration shows that...                 │  ← TextSegment
│                                                  │
└──────────────────────────────────────────────────┘
```

### Migration & Backward Compatibility

**Old messages (no** `segments` **field):**

- Render using current logic: `content` as markdown + collapsed `activities[]`
- No migration needed — old data stays as-is

**New messages:**

- Always write `segments[]` for rendering
- Also write `content` (concatenated text) for search/export
- Do not write to `activities[]` or `toolCallActivities[]`

**Export:**

- Markdown export: iterate segments, render text as-is, tool calls as `> [tool] label` blocks
- JSON export: include full `segments` array

### Thinking Display

For models that support extended thinking (Anthropic, Ollama thinking models, local AI):

- During streaming: thinking segment is expanded, shows content accumulating with a subtle animation
- After turn completes: automatically collapses to a single line "Thought for Xs" with expand toggle
- Collapsed state: `▸ Thought for 12s` (click to expand)
- Expanded state: full thinking text in muted italic style

## Implementation Plan

### Phase 1: Data Model & Store (no UI changes yet)

- [x] Add `Segment` types to `src/lib/ai/types.ts`

- [x] Add segment store actions to `chat-store.ts` (`appendTextSegment`, `pushSegment`, `updateSegment`, `finalizeSegments`)

- [x] Add `formatToolLabel(kind, args)` utility that produces descriptive labels from tool arguments

- [x] Update ACP session listeners to write segments alongside existing `content`/`activities`

- [x] Update direct API chat hook to write segments alongside existing `content`/`toolCallActivities`

- [x] Verify: existing UI still works (segments are written but not rendered yet)

### Phase 2: Segment Rendering

- [x] Create `TextSegmentView` component

- [x] Create `ThinkingSegmentView` component (collapsible, muted style)

- [x] Create `ToolCallSegmentView` component (compact card with icon + descriptive label + status)

- [x] Create `ToolResultSegmentView` component (collapsible monospace block)

- [x] Update `ChatMessage.tsx` to render segments when present, fall back to old rendering otherwise

- [x] Style all segment components for light and dark mode

### Phase 3: Streaming UX Polish

- [x] Thinking segments auto-expand while streaming, collapse on turn complete

- [x] Tool call segments show spinner while running, checkmark when done

- [x] Smooth transitions between segment types (no layout jumps)

- [x] Auto-scroll follows the latest segment during streaming

- [x] Tool result collapse/expand is persisted per message (not globally)

### Phase 4: Export & Search Compatibility

- [x] Markdown export renders segments chronologically (text as-is, tools as blockquotes)

- [x] JSON export includes full segments array

- [x] Conversation search still works via `content` field

- [x] Chat history tab displays correctly

## Quality Gates

- [x] Old conversations (no segments) render identically to current behavior

- [x] New ACP conversations show interleaved text + tool calls chronologically

- [x] New direct API conversations with tool calling show interleaved flow

- [x] Tool call labels are descriptive: show file basenames, command text, search queries — not generic verbs

- [x] Thinking segments collapse after turn completes

- [x] Tool results are collapsible and collapsed by default

- [x] Branching still works correctly (one message per turn)

- [x] Export (markdown + JSON) produces correct output

- [x] Light and dark mode look polished

- [x] No performance regression on conversations with many segments

- [x] Existing tests pass; new tests cover segment accumulation logic