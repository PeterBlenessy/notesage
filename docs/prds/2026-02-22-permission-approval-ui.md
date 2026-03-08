# Interactive Permission Approval UI

**Date:** 2026-02-22
**Status:** Complete (v0.15.0)
**Parent:** Phase 6.5 — Chat UX & Agent Polish

## Problem

ACP agents (Claude Code, Codex, Copilot, Gemini CLI) request permission for every tool call — file writes, edits, terminal commands. Currently all tool calls are auto-approved silently. The permission store infrastructure exists and tracks write tool requests, but no UI is shown. Users have zero visibility or control over what agents do to their files during a chat session.

## Goals

- Show inline permission cards for write tool calls so users can approve or deny before the agent proceeds
- Continue auto-approving read-only tools (file reads, searches, glob) for a smooth experience
- Clean up pending permission requests when the chat is cancelled or cleared
- Match the existing chat panel visual patterns (compact, greyscale, inline)

## Non-Goals

- Permission approval for background task agents (`useAgentTaskOperations`) — separate concern, requires notification system outside chat
- Permission approval for inline actions (`generateText` — Improve/Summarize/Expand) — brief, non-conversational
- "Allow all" or "Trust this session" bulk approval mode — future enhancement
- Persisting permission decisions across sessions
- Per-tool-type remembered preferences (e.g., "always allow file edits")

## User Stories

- As a user chatting with an ACP agent, I want to see what write operations the agent wants to perform before they happen, so I can approve or deny them.
- As a user who denies a tool call, I want the agent to gracefully handle the denial and either try a different approach or explain what it needs.
- As a user who cancels a chat mid-stream, I want pending permission requests to be automatically denied and cleaned up.

## Technical Approach

### Permission flow change

The existing `acp-permission-request` event listener in `useAIOperations.ts` classifies tools via `isReadOnlyTool()`:
- **Read-only tools** (`read`, `read_file`, `glob`, `list`, `grep`, `fetch`, `web_search`): auto-approve immediately, no UI
- **Write tools** (everything else): currently added to `permission-store` AND auto-approved. Change: add to store but do NOT call `acp_permission_respond` — let the UI handle it.

The Rust backend already waits on a `oneshot::channel` for each permission request. No backend changes needed.

### PermissionCard component

New `src/components/chat/PermissionCard.tsx` — inline card rendered in the chat message area showing:
- Tool icon (lucide, based on `toolKind`)
- Tool label (via existing `formatAcpToolName`)
- Tool input preview (truncated, muted)
- "Allow" button (primary) and "Deny" button (ghost)

Allow calls `acp_permission_respond` with the first `optionId`. Deny calls with `null` (maps to `Cancelled` in Rust).

### Rendering in ChatPanel

Cards rendered after loading/tool status indicators, before `messagesEndRef`. Auto-scrolls when new cards appear. Multiple pending requests stack vertically.

### Cleanup paths

- **Cancel chat** (`cancelChat`): deny all pending requests for current agent, clear from store
- **Clear chat** (`handleClear`): deny all pending requests, clear all from store
- **Cleanup function** (agent stream ends/errors): deny pending requests for this `instanceId`, clear from store

## UI/UX

### Permission card layout

```
┌─────────────────────────────────────────────────┐
│ [icon]  Tool label                 [Allow] [Deny]│
│         tool input preview...                    │
└─────────────────────────────────────────────────┘
```

- Compact: `px-3 py-2.5`, `rounded-lg`, `border border-border bg-card`
- Icon: 14px lucide icon, `text-muted-foreground`
- Label: `text-xs font-medium text-foreground`
- Detail: `text-[10px] text-muted-foreground truncate`
- Allow: `Button variant="default" size="xs"`
- Deny: `Button variant="ghost" size="xs"`
- No chromatic colors — follows greyscale design system

### States

- **No pending requests**: nothing rendered (invisible)
- **One pending request**: single card at bottom of chat
- **Multiple pending requests**: stacked cards
- **After response**: card disappears, agent continues or stops

### Icon mapping

| Tool kind | Icon |
|-----------|------|
| `write` / `write_file` | `FileEdit` |
| `edit` | `Pencil` |
| `bash` / `terminal` | `Terminal` |
| default | `Shield` |

## Data Model

### Existing (no changes to interface)

```typescript
// src/stores/permission-store.ts
interface PermissionRequest {
  id: string;
  instanceId: string;
  sessionId: string;
  requestId: string;
  toolKind: string;
  toolTitle: string;
  toolInput: string;
  options: { optionId: string; kind: string; name: string }[];
  timestamp: number;
}
```

### Store addition

Add `clearAll(): void` method to `PermissionStore` interface for chat clear cleanup.

### Exported utilities

Export `formatAcpToolName` and `truncateDetail` from `useAIOperations.ts` for use by `PermissionCard`.

## Dependencies

None — all required components (Button, permission store, Tauri invoke, lucide icons) already exist.

## Files Modified

| File | Change |
|------|--------|
| `src/stores/permission-store.ts` | Add `clearAll` method |
| `src/hooks/useAIOperations.ts` | Export utils, stop auto-approving writes, add cleanup |
| `src/components/chat/PermissionCard.tsx` | New — inline permission card component |
| `src/components/chat/ChatPanel.tsx` | Render cards, cleanup on clear, scroll trigger |

## Quality Gates

- [x]`npx tsc --noEmit` passes
- [x]Read-only tool calls auto-approve silently (no UI change)
- [x]Write tool calls show a permission card with Allow/Deny buttons
- [x]Clicking Allow sends approval, card disappears, agent continues
- [x]Clicking Deny sends cancellation, card disappears, agent handles gracefully
- [x]Multiple pending requests stack as separate cards
- [x]Cancelling chat denies and clears all pending requests
- [x]Clearing chat denies and clears all pending requests
- [x]Agent stream error/completion cleans up pending requests
- [x]Permission cards render correctly in both light and dark mode
- [x]Card styling matches design system (greyscale, rounded-lg, proper spacing)

## Out of Scope

- Background task agent permissions (requires notification outside chat panel)
- "Allow all" / session trust mode
- Per-tool remembered preferences
- Permission request timeout/auto-deny
- Detailed tool input preview (expandable, syntax-highlighted)
