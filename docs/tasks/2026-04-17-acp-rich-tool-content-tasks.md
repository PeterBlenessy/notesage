# ACP Rich Tool Call Content — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-17 |
| **Status** | Complete ✅ |
| **PRD** | [acp-rich-tool-content](../prds/2026-04-17-acp-rich-tool-content.md) |
| **Audit** | [acp-audit](../audits/2026-04-14-acp-audit.md) — Batch B (features #44, #45) |
| **Total** | 8 tasks: 4S, 3M, 1L |
| **Suggested order** | Types (#1) → Listener (#2) → Diff lib (#3) → Diff view (#4) → Content view (#5) → Task listener (#6) → Tests (#7) → Docs (#8) |

**Risks:**

- Agent behavior varies — some agents may send diffs as `rawOutput` JSON instead of structured `Diff` content blocks. Need to verify with Claude Code.
- The `content` array on `tool_call_update` is a complete replacement per ACP spec, not append. Must overwrite, not merge.
- Large diffs (1000+ lines) could bloat the chat store. Consider truncation with "Show full diff" expansion.

---

## Phase 1 — Types & Data Plumbing

### #1 — Extend segment types and ACP event interface ✅

**Description:** Add a `content` array to `ToolCallSegment` and fix the `AcpSessionUpdate` interface to correctly represent `tool_call_update` content as an array of tagged union objects.

**Acceptance criteria:**
- `ToolCallSegment` has `content?: ToolCallContentItem[]`
- `ToolCallContentItem` is a discriminated union: `{ type: 'text'; text: string }`, `{ type: 'diff'; path: string; oldText?: string; newText: string }`, `{ type: 'terminal'; terminalId: string }`
- `AcpSessionUpdate` in `acp-utils.ts` has `content` typed as array (not single object)
- TypeScript type check passes

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:**
- `src/lib/ai/types.ts` — add `ToolCallContentItem` union, add `content` to `ToolCallSegment`
- `src/lib/ai/acp-utils.ts` — fix `AcpSessionUpdate.content` type

---

### #2 — Extract content from tool_call_update in chat listener ✅

**Description:** Update the `tool_call_update` handler in `useAcpSessionListeners.ts` to extract the `content` array from the event payload and store it on the `ToolCallSegment` via `updateSegment`.

**Acceptance criteria:**
- When `tool_call_update` has a `content` array, it is parsed into `ToolCallContentItem[]`
- Content items are mapped from ACP JSON format (`type: "Diff"` with `path`, `old_text`, `new_text`) to frontend format
- `Diff` and `Content` (text) types are stored; `Terminal` type is stored as-is (rendered as placeholder)
- Content array overwrites previous content (per ACP spec — not extended)
- Tool calls without `content` behave identically to today (no regression)

**Complexity:** M
**Category:** frontend
**Dependencies:** #1
**Files:**
- `src/hooks/useAcpSessionListeners.ts` — expand `tool_call_update` handler

---

## Phase 2 — Diff Rendering

### #3 — Unified diff computation utility ✅

**Description:** Create a lightweight utility that takes `oldText` (optional) and `newText` and produces a unified diff line array suitable for rendering. Each line has a type (`add`, `remove`, `context`) and text content. Include context lines around changes (3 lines) and section separators for large files.

**Acceptance criteria:**
- `computeUnifiedDiff(oldText: string | undefined, newText: string): DiffLine[]`
- `DiffLine = { type: 'add' | 'remove' | 'context' | 'separator'; text: string }`
- New files (no `oldText`): all lines are `add` type
- Deleted files (empty `newText`): all lines are `remove` type
- Context window: 3 lines above/below each change, separator between distant hunks
- Handles empty strings, single-line files, and large files (truncate at 200 lines with "... N more lines" separator)
- Unit tests covering: new file, deletion, mixed changes, large file truncation, empty inputs

**Complexity:** M
**Category:** frontend
**Dependencies:** None (can parallel with #1-#2)
**Files:**
- `src/lib/ai/diff-utils.ts` — new file
- `src/lib/ai/diff-utils.test.ts` — new test file

---

### #4 — DiffContentView component ✅

**Description:** Create a collapsible diff view component for rendering inside tool call segments. Shows a summary line when collapsed ("N lines changed in filename") and a styled unified diff when expanded.

**Acceptance criteria:**
- Collapsed by default, toggles on click (same chevron pattern as `ToolResultSegmentView`)
- Summary shows change count: "N additions, M deletions in filename.ext"
- Expanded view: monospace lines with red/green backgrounds using `--color-diff-*` CSS variables
- File path in header, clickable to open file in editor (reuse pattern from `ToolCallSegmentView` location links)
- New files show "(new file)" badge; deleted content shows "(deleted)" badge
- Looks correct in light and dark mode
- Consistent with existing segment styling (`text-[10px]`, `bg-muted/50`, `border-border/50`)

**Complexity:** L
**Category:** frontend
**Dependencies:** #3
**Files:**
- `src/components/chat/segments/DiffContentView.tsx` — new component

---

### #5 — TextContentView component and ToolCallSegmentView integration ✅

**Description:** Create a simple collapsible text content view for `Content` (text) blocks in the content array. Then integrate both `DiffContentView` and `TextContentView` into `ToolCallSegmentView` so content items render below the tool label and locations.

**Acceptance criteria:**
- `TextContentView`: collapsible monospace text (same pattern as `ToolResultSegmentView` but used for content-array text blocks)
- `Terminal` content type: rendered as muted placeholder text ("Terminal output — not yet supported") or silently skipped
- `ToolCallSegmentView` renders content items below locations in order
- Tool calls without content render identically to today (no visual change)
- Multiple content items (e.g., diff + text) render in sequence

**Complexity:** M
**Category:** frontend
**Dependencies:** #4
**Files:**
- `src/components/chat/segments/TextContentView.tsx` — new component
- `src/components/chat/segments/ToolCallSegmentView.tsx` — integrate content rendering

---

## Phase 3 — Task Listener & Polish

### #6 — Extract content in task agent listener ✅

**Description:** Update the `tool_call_update` handler in `useAgentTaskOperations.ts` to extract and store content, matching the chat listener behavior from #2. This ensures delegated agent tasks (comment delegation) also show rich tool content in the activity panel.

**Acceptance criteria:**
- Same content extraction logic as #2 applied to task agent listener
- Activity panel shows diffs and text content for agent task tool calls
- No regression in existing task activity display

**Complexity:** S
**Category:** frontend
**Dependencies:** #2
**Files:**
- `src/hooks/useAgentTaskOperations.ts` — expand `tool_call_update` handler

---

### #7 — Tests ✅

**Description:** Add unit tests for the new components and integration tests for the content extraction pipeline.

**Acceptance criteria:**
- `diff-utils.test.ts`: new file, mixed changes, deletions, large file truncation, empty inputs
- `DiffContentView` render test: collapsed state, expanded state, new file badge, click-to-toggle
- `ToolCallSegmentView` render test: with content array (diff + text), without content (regression)
- All existing chat segment tests still pass

**Complexity:** S
**Category:** testing
**Dependencies:** #5
**Files:**
- `src/lib/ai/diff-utils.test.ts` — diff utility tests
- `src/components/chat/segments/__tests__/` — component tests (if test pattern exists here; otherwise colocate)

---

### #8 — Update documentation ✅

**Description:** Update audit file, feature docs, and architecture docs to reflect the new capability.

**Acceptance criteria:**
- `docs/audits/2026-04-14-acp-audit.md`: features #44 and #45 updated from ❌ to ✅
- `docs/features/ai-workflows.md`: mention rich tool content in Chronological Segments section
- `docs/features/ai-providers.md`: update Tool Calling section to note content rendering

**Complexity:** S
**Category:** docs
**Dependencies:** #7
**Files:**
- `docs/audits/2026-04-14-acp-audit.md`
- `docs/features/ai-workflows.md`
- `docs/features/ai-providers.md`
