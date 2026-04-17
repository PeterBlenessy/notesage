# PRD: ACP Rich Tool Call Content

|  |  |
| --- | --- |
| **Date** | 2026-04-17 |
| **Status** | Implemented ✅ |
| **Priority** | Medium |
| **Impact** | File diffs and terminal output rendered inline in chat messages, replacing opaque tool labels with actionable content |
| **Tasks** | [acp-rich-tool-content-tasks](../tasks/2026-04-17-acp-rich-tool-content-tasks.md) |
| **Audit** | [acp-audit](../audits/2026-04-14-acp-audit.md) — Batch B |

## Problem

When ACP agents (Claude Code, Codex, Copilot, Gemini) edit files or run commands, the chat panel shows minimal information:

- **File edits:** "Edited config.ts" with a checkmark — no indication of what changed
- **Terminal commands:** "Ran bash command" — no output visible

The ACP protocol sends rich structured content alongside tool call updates: `Diff` blocks with old/new text for file edits, and `Terminal` blocks referencing command output. Notesage currently **ignores the** `content` **array** in `tool_call_update` events — only `kind`, `title`, `status`, and `locations` are extracted.

Users must open the file and inspect changes manually, or expand the raw output to see unformatted text. This is a significant UX gap compared to Claude Code's terminal UI, which shows diffs and command output inline.

## Goals

1. **Render file diffs inline in chat** — when an agent edits a file, show a collapsible unified diff with syntax-highlighted additions/deletions below the tool call label
2. **Render terminal output inline in chat** — when an agent runs a command, show the command and its output in a collapsible terminal-styled block
3. **Support both chat panel and delegation panel** — both use ACP session listeners and should benefit equally
4. **Preserve the compact default** — diffs and terminal blocks should be collapsed by default, keeping the message stream scannable

## Non-Goals

- **Accept/reject diffs from chat** — the editor's inline diff review handles this; chat diffs are read-only for visibility
- **Interactive terminal** — terminal blocks are output-only; we don't implement `terminal/create` client capabilities (that's a separate batch)
- **Direct API tool content** — this is ACP-only; direct API tool results remain as plain text
- **Diff syntax highlighting** — basic +/- coloring is sufficient; full language-aware highlighting is out of scope

## User Stories

1. **As a user chatting with Claude Code**, when the agent edits a file, I want to see a collapsible diff showing exactly what changed, so I can review without leaving the chat.

2. **As a user watching an agent run tests**, when the agent executes a command, I want to see the terminal output inline, so I can spot failures immediately.

3. **As a user delegating a comment to an agent**, when the agent makes changes, I want the activity panel to show what was changed, not just "Edited file.ts".

## Technical Approach

### ACP Protocol Context

The `tool_call_update` event carries an optional `content` array of `ToolCallContent` items:

```rust
// From agent-client-protocol-schema 0.11.4
pub enum ToolCallContent {
    Content(Content),        // Standard text/image content block
    Diff(Diff),              // File modification as old_text → new_text
    Terminal(Terminal),       // Reference to a terminal created via terminal/create
}

pub struct Diff {
    pub path: PathBuf,
    pub old_text: Option<String>,  // None for new files
    pub new_text: String,
}

pub struct Terminal {
    pub terminal_id: TerminalId,
}
```

Per ACP spec, `content` is a **complete array replacement** (not extension) on each update.

### Data Flow

1. **Backend** (`acp_client.rs`) already forwards the full `tool_call_update` as JSON — no backend changes needed
2. **Frontend type** (`acp-utils.ts`) — fix `AcpSessionUpdate.content` to be an array, not a single object
3. **Listener** (`useAcpSessionListeners.ts`) — extract `content` from `tool_call_update`, store on segment
4. **Segment type** (`types.ts`) — add `content` array to `ToolCallSegment`
5. **Rendering** (`ToolCallSegmentView.tsx`) — render content items below the tool label

### Diff Rendering

A collapsible unified diff view:

- Collapsed by default, showing "N lines changed in filename.ext"
- Expanded: unified diff format with red/green line coloring
- Computed client-side from `old_text` / `new_text` using a lightweight diff algorithm
- File path shown as header, clickable to open the file
- New files (no `old_text`): show full content with all-green styling

### Terminal Rendering

Since we don't implement `terminal/create` client capabilities, the `Terminal` content type references a terminal ID we don't own. Two options:

1. **Show terminal ID as placeholder** — "Terminal output (terminal-abc123)" with a note that terminal integration is not yet available
2. **Skip terminal content blocks** — only render `Diff` and `Content` types; ignore `Terminal` since we can't resolve the output

Option 2 is simpler and honest. Terminal output that agents send as plain text in `rawOutput` is already displayed in `ToolResultSegmentView`. The structured `Terminal` content type only adds value when the client manages terminals.

**However:** agents may also send terminal/command output as `Content` blocks (standard text content) within the `content` array. These should be rendered as collapsible monospace text blocks.

### Visual Design

```
┌─────────────────────────────────────────┐
│ ✏️ Edited src/App.tsx                ✓  │  ← existing tool call label
│   📄 src/App.tsx:42                      │  ← existing location link
│   ▸ 3 lines changed                     │  ← NEW: collapsed diff summary
│                                          │
│   ▾ 3 lines changed                     │  ← expanded state:
│   ┌──────────────────────────────────┐   │
│   │ src/App.tsx                      │   │
│   │ - import { old } from './old';   │   │  red background
│   │ + import { new } from './new';   │   │  green background
│   │   unchanged line                 │   │  no background
│   │ - removed();                     │   │  red background
│   │ + added();                       │   │  green background
│   └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

Styling follows the existing design system:

- Diff container: `bg-muted/50 border border-border/50 rounded-md` (matching `ToolResultSegmentView`)
- Deletions: `bg-[var(--color-diff-delete-bg)]` with `text-[var(--color-diff-delete-fg)]`
- Insertions: `bg-[var(--color-diff-insert-bg)]` with `text-[var(--color-diff-insert-fg)]`
- Font: `font-mono text-[10px]` (matching existing result view)
- Collapsed summary: same chevron pattern as `ToolResultSegmentView`

### Affected Paths

| Path | Change |
| --- | --- |
| Chat panel (ACP sessions) | Primary target — diffs and content rendered in assistant messages |
| Delegation panel (agent tasks) | Same listener infrastructure — gets rich content automatically |
| Chat panel (direct API) | No change — direct API doesn't send structured tool content |
| Chat panel (Copilot LSP) | No change — different protocol |
| Bubble menu actions | No change — uses direct API |

## Quality Gates

- [x] File diffs render correctly for: additions only (new file), deletions only, mixed changes, large diffs (100+ lines)

- [x] Diff collapsed by default, expands on click, re-collapses on click

- [x] Content blocks (text) render as collapsible monospace output

- [x] Terminal content type gracefully rendered as muted placeholder (no crash, no empty block)

- [x] Works in both chat panel and delegation activity panel

- [x] No visual regression for tool calls without content (majority of cases)

- [x] Looks correct in both light and dark mode

- [x] Diff colors use existing CSS variables (`--color-diff-*`)

- [x] TypeScript type check passes

- [x] Existing chat segment tests pass