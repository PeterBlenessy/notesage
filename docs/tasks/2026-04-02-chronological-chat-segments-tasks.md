# Chronological Chat Message Segments — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-02 |
| **Status** | Complete |
| **PRD** | [chronological-chat-segments](../prds/2026-04-02-chronological-chat-segments.md) |
| **Total** | 15 tasks: 5S, 7M, 3L |
| **Suggested order** | Types (#1) → Label utility (#2) → Store (#3) → Streaming (#4-#6) → UI (#7-#11) → Polish (#12-#13) → Export (#14) → Tests (#15) |

**Risks:**

- Chat store persistence: Adding `segments[]` to messages increases localStorage size. Existing conversations with hundreds of messages could hit limits — but `segments` only applies to new messages, so growth is gradual.
- Streaming flush timing: The 50ms flush interval must write to both `content` (for search/export) and `segments[]` (for rendering). Two concurrent writes per flush adds minimal overhead but must be atomic within the store action.
- ACP event ordering: ACP events may arrive out of order in edge cases (e.g., `tool_result` before final text chunk). The segment model handles this naturally since each event creates/appends to the appropriate segment type.

---

### #1 — Add Segment type definitions ✅

**Description:** Define the `Segment` union type and its variants (`TextSegment`, `ThinkingSegment`, `ToolCallSegment`, `ToolResultSegment`) in the AI types file. Add the optional `segments` field to `ChatMessage`.

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:**
- `src/lib/ai/types.ts` — add segment interfaces, update `ChatMessage`

**Acceptance criteria:**
- All four segment types defined with discriminated union on `type` field
- `ChatMessage.segments` is optional (`Segment[] | undefined`)
- Existing `content`, `activities`, `toolCallActivities` fields unchanged
- TypeScript compiles cleanly

---

### #2 — Add `formatToolLabel` utility for descriptive tool labels ✅

**Description:** Create a `formatToolLabel(kind, args)` function that produces descriptive labels from tool call arguments. This replaces the generic labels like "Reading file" with specific ones like "Reading config.ts". Also update `formatAcpToolName` to accept an optional arguments parameter for the same purpose.

**Complexity:** M
**Category:** frontend
**Dependencies:** None
**Files:**
- `src/lib/ai/acp-utils.ts` — add `formatToolLabel`, update or wrap `formatAcpToolName`

**Acceptance criteria:**
- `formatToolLabel('read_file', { path: '/src/lib/config.ts' })` → `"Reading config.ts"`
- `formatToolLabel('write_file', { path: '/src/App.tsx' })` → `"Editing App.tsx"`
- `formatToolLabel('bash', { command: 'npm test --watch src/' })` → `"Running: npm test --watch src/"`
- `formatToolLabel('web_search', { query: 'React 19 changes' })` → `"Searching web: \"React 19 changes\""`
- `formatToolLabel('glob', { pattern: 'src/components/' })` → `"Searching src/components/"`
- `formatToolLabel('grep', { pattern: 'useState' })` → `"Searching for \"useState\""`
- `formatToolLabel('fetch', { url: 'https://github.com/foo/bar' })` → `"Fetching github.com"`
- `formatToolLabel('execute_skill_script', { skill: 'download-webpage' })` → `"Running skill: download-webpage"`
- Commands truncated at ~60 chars, search queries at ~40 chars, with ellipsis
- File paths show `basename` only in label (full path goes to `detail` field)
- Unknown kinds fall back to `title` or `kind` (same as current `formatAcpToolName`)
- ACP path: parses `rawInput` (JSON string or object) to extract arguments
- Unit tests for all tool kinds and edge cases (missing args, empty strings, very long values)

---

### #3 — Add segment store actions to chat-store ✅

**Description:** Implement `appendTextSegment`, `pushSegment`, `updateSegment`, and `finalizeSegments` actions on the chat store. These operate on the `segments[]` array of a message identified by its timestamp.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- `src/stores/chat-store.ts` — add 4 new actions to the store

**Acceptance criteria:**
- `appendTextSegment(timestamp, text)`: if last segment is `text`, concatenates; otherwise pushes new `TextSegment`
- `pushSegment(timestamp, segment)`: appends segment to array, initializes array if needed
- `updateSegment(timestamp, index, patch)`: shallow-merges patch into segment at index
- `finalizeSegments(timestamp)`: sets `collapsed: true` on all thinking segments, marks running tool_calls as `done`
- All actions produce new array references (immutable updates) for Zustand reactivity
- Existing actions (`updateMessage`, `addActivity`, etc.) remain unchanged

---

### #4 — Wire segments into direct API streaming ✅

**Description:** Update `useDirectApiChat.ts` to build segments alongside the existing `content`/`activities` writes. Text chunks create/append `TextSegment`, thinking chunks create/append `ThinkingSegment`, tool calls push `ToolCallSegment` + `ToolResultSegment` with descriptive labels via `formatToolLabel`, and stream completion calls `finalizeSegments`.

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #2, #3
**Files:**
- `src/hooks/useDirectApiChat.ts` — add segment writes in streaming handlers

**Acceptance criteria:**
- Each `ai-stream-chunk` flush also calls `appendTextSegment`
- Each `ai-stream-thinking-chunk` flush pushes/appends to `ThinkingSegment`
- Each tool call creates a `ToolCallSegment` with descriptive label from `formatToolLabel(call.name, call.arguments)` (e.g. `"Reading config.ts"` not `"read_file"`), status: running
- `ToolCallSegment.detail` contains the full arguments summary (e.g. full file path, full command) for the expandable view
- Each result creates a `ToolResultSegment` and updates the call segment to done
- When text resumes after a tool result, a new `TextSegment` is started (not concatenated to the pre-tool one)
- `finalizeSegments` called on `ai-stream-done`
- Existing `content`/`activities`/`toolCallActivities` writes are untouched (dual-write)
- No UI changes yet — segments are written but not rendered

---

### #5 — Wire segments into ACP streaming ✅

**Description:** Update `useAcpSessionListeners.ts` to build segments alongside existing writes. Same segment accumulation rules as direct API. Use `formatToolLabel` with parsed `rawInput` for descriptive labels.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #2, #3
**Files:**
- `src/hooks/useAcpSessionListeners.ts` — add segment writes in event handlers

**Acceptance criteria:**
- `agent_message_chunk` → `appendTextSegment`
- `tool_call` → `pushSegment(ToolCallSegment)` with descriptive label from `formatToolLabel(update.kind, parsedRawInput)`, full `rawInput` as `detail`, status: running
- `tool_result` → `pushSegment(ToolResultSegment)`, update matching `ToolCallSegment` to done
- Thinking events → push/append `ThinkingSegment`
- `agent_turn_complete` → `finalizeSegments`
- Existing `content`/`activities` writes untouched (dual-write)

---

### #6 — Wire segments into inline AI actions ✅

**Description:** Update the bubble menu AI actions (Improve, Summarize, Expand) in `useAIOperations.ts` to write segments. These don't use tool calls but do produce text and possibly thinking segments.

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #3
**Files:**
- `src/hooks/useAIOperations.ts` — add segment writes for inline actions

**Acceptance criteria:**
- Inline actions create a `TextSegment` for the response content
- If thinking is present, creates a `ThinkingSegment` before the text
- `finalizeSegments` called on completion

---

### #7 — Create TextSegmentView component ✅

**Description:** Extract the current markdown rendering logic from `ChatMessage.tsx` into a standalone `TextSegmentView` that renders a single text segment with the same styling.

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- `src/components/chat/segments/TextSegmentView.tsx` — new component
- `src/components/chat/segments/index.ts` — barrel export

**Acceptance criteria:**
- Renders markdown content via the same `MarkdownContent` component used today
- Supports streaming cursor animation when segment is the last one and message is actively streaming
- Light/dark mode correct

---

### #8 — Create ThinkingSegmentView component ✅

**Description:** Build a collapsible thinking block with muted styling, expand/collapse toggle, and "Thought for Xs" collapsed summary.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- `src/components/chat/segments/ThinkingSegmentView.tsx` — new component

**Acceptance criteria:**
- Collapsed state: `"Thought for Xs"` with expand chevron, muted text, left border accent
- Expanded state: full thinking text in muted italic style with monospace-ish feel
- Duration computed from segment timestamp vs next segment's timestamp (or turn end)
- Auto-expanded while streaming (segment.collapsed === false), auto-collapsed after finalize
- User toggle overrides auto-collapse (local state)
- Smooth expand/collapse transition
- Light/dark mode correct

---

### #9 — Create ToolCallSegmentView component ✅

**Description:** Build a compact card showing tool kind icon, descriptive label, and status indicator. The label should be immediately informative — "Reading config.ts" not "Reading file", "Running: npm test" not "Running command". Full arguments available via expand or tooltip.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- `src/components/chat/segments/ToolCallSegmentView.tsx` — new component

**Acceptance criteria:**
- Icon mapped from `kind` (reuse existing tool icon mapping or create consistent mapping: file icon for read/write, terminal icon for bash, search icon for grep/web_search, etc.)
- Descriptive `label` displayed prominently (e.g. "Reading config.ts", "Running: npm test --watch")
- `detail` shown in muted text below or as expandable section (full file path, full command, full search query)
- Status: spinner for `running`, check icon for `done`, X icon for `error`
- Muted background card, rounded corners, compact (single line when possible for short labels)
- Light/dark mode correct

---

### #10 — Create ToolResultSegmentView component ✅

**Description:** Build a collapsible block for tool output. Collapsed by default showing a one-line summary. Expandable to show full monospace output. Error state shown in red.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- `src/components/chat/segments/ToolResultSegmentView.tsx` — new component

**Acceptance criteria:**
- Collapsed: single line like `"Search results (3 items)"` or `"File contents (42 lines)"` with expand chevron
- Expanded: monospace text block with max-height and scroll, similar to current ToolCallLog result display
- Error state: red text with error icon
- Collapse/expand is per-instance (local state), collapsed by default
- Light/dark mode correct

---

### #11 — Render segments in ChatMessage.tsx ✅

**Description:** Update `ChatMessage.tsx` to check for `message.segments`. When present, render each segment in order using the segment components. When absent (old messages), fall back to existing rendering logic.

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #7, #8, #9, #10
**Files:**
- `src/components/chat/ChatMessage.tsx` — add segment rendering branch

**Acceptance criteria:**
- If `message.segments` exists and has length > 0: render segments in order, skip old thinking/activity/toolCallLog sections
- If no segments: render exactly as today (backward compatible, zero visual change for old messages)
- Provider badge and citations still render below segments (from the message-level fields)
- Copy button copies `message.content` (the concatenated text, not segments)
- Action buttons (edit, resend, branch, delete) work as before
- Streaming cursor appears on the last text segment while actively streaming
- Permission cards and domain approval cards still render in their current position

---

### #12 — Streaming UX: auto-scroll and transitions ✅

**Description:** Ensure auto-scroll follows the latest segment during streaming, and segment type transitions don't cause layout jumps.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #11
**Files:**
- `src/components/chat/ChatPanel.tsx` — scroll behavior adjustments
- `src/components/chat/segments/*.tsx` — transition CSS

**Acceptance criteria:**
- As new segments are added during streaming, chat auto-scrolls to keep the latest visible
- Transition from text → tool_call → tool_result → text is smooth (no jarring height changes)
- Thinking expand/collapse animates smoothly (height transition)
- Tool call status changes (spinner → check) don't shift layout

---

### #13 — Wire ToolCallSegment to PermissionCard and DomainApprovalCard ✅

**Description:** Ensure tool calls that require permission still show `ToolCallPermissionCard` and `DomainApprovalCard` inline. These should appear at the correct chronological position (after the `ToolCallSegment` that triggered them).

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #11
**Files:**
- `src/components/chat/ChatMessage.tsx` — integrate permission cards with segment rendering

**Acceptance criteria:**
- Permission cards render immediately after the relevant `ToolCallSegment`
- Domain approval cards render at the correct position in the segment flow
- Approval/denial updates the corresponding `ToolCallSegment` status
- No duplicate rendering of permission UI between old and new code paths

---

### #14 — Update conversation export for segments ✅

**Description:** Update markdown and JSON export to use segments when available. Markdown export renders text as-is and tool calls as styled blockquotes with descriptive labels. JSON export includes the full segments array.

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #11
**Files:**
- `src/components/chat/ChatHistoryView.tsx` — update export functions

**Acceptance criteria:**
- Markdown export: when segments exist, iterate them — text segments as paragraphs, thinking as `> *Thinking:* ...`, tool calls as `> **[tool_label]** detail` (using the descriptive label, not generic name), tool results as nested blockquotes
- JSON export: include `segments` array in message objects when present
- Old messages without segments export identically to current behavior
- All-branches export handles segments correctly

---

### #15 — Unit tests for segment accumulation, store actions, and label formatting ✅

**Description:** Write tests covering the new store actions, segment accumulation logic, `formatToolLabel`, and backward compatibility with old messages.

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #2, #3, #4, #5
**Files:**
- `src/stores/__tests__/chat-store-segments.test.ts` — new test file
- `src/lib/ai/__tests__/acp-utils.test.ts` — add or extend tests for `formatToolLabel`

**Acceptance criteria:**
- `appendTextSegment`: test concatenation to existing text segment vs creating new one
- `pushSegment`: test all segment types, test array initialization on first push
- `updateSegment`: test partial update, test out-of-bounds index
- `finalizeSegments`: test thinking collapse, test running tool_call → done
- `formatToolLabel`: test all tool kinds (read, write, bash, grep, web_search, fetch, glob, execute_skill_script, unknown), edge cases (missing args, empty strings, very long paths/commands, JSON rawInput parsing)
- Backward compat: messages without segments render via old path (integration test with ChatMessage)
- Segment accumulation: simulate a streaming sequence (text → thinking → tool_call → tool_result → text) and verify final segments array
- Test that `content` field is still updated alongside segments (dual-write)

---

### #16 — Group consecutive tool calls into collapsible sections ✅

**Description:** When multiple tool_call/tool_result segments appear consecutively (no text or thinking between them), render them as a collapsible group with a summary line. Single tool calls render inline as before.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #11
**Files:**
- `src/components/chat/segments/ToolCallGroup.tsx` — new component
- `src/components/chat/segments/index.ts` — add export
- `src/components/chat/ChatMessage.tsx` — update SegmentRenderer to detect groups

**Acceptance criteria:**
- 2+ consecutive tool_call/tool_result segments are grouped
- Collapsed shows summary: "N actions" with smart detail (e.g. "Read 2 files, fetched 3 pages")
- Expanded shows all individual tool calls and results
- Groups with running calls auto-expand; completed groups auto-collapse
- User toggle overrides auto-collapse
- Single tool calls render inline (no group wrapper)
- Light/dark mode correct
