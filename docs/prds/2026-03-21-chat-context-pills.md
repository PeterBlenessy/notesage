# Chat Context Pills

**Date:** 2026-03-21 **Status:** Draft

## Problem

The AI chat panel silently includes the active tab's file content in every request, but the user has no visibility into what context is being sent. This creates two issues:

1. **No transparency** — users can't see what files the AI "knows about," leading to confusion when the AI references (or fails to reference) file content.
2. **No control** — users can't exclude irrelevant files from context or add additional files beyond the active tab.

As the product evolves toward richer context (dragged files, pasted images), the chat input needs a visible, interactive context layer.

## Goals

1. Show attached context items as removable pills above the chat input textarea.
2. Auto-attach the active tab file (path only, no content) and allow the user to remove it.
3. Provide the foundation for future context attachment types (drag-and-drop files, pasted images).
4. Keep the implementation minimal — no new stores, no settings, no backend changes.

## Non-Goals

- **Project-level context indicators** — the project selector already communicates this.
- **Image paste support** — future work, but the pill UI should accommodate it.
- **Drag-and-drop file attachment** — future work, same accommodation.
- **File content injection** — pills attach the file *path* only. Direct API agents receive the path in the system message; ACP agents can read the file themselves via tool calls.
- **Multi-file auto-attachment** — only the active tab is auto-attached, not all open tabs.
- **Skill/instruction/goal context indicators** — out of scope; these are system-level, not user-managed.

## User Stories

1. **As a user, I want to see which files are included in my chat context**, so I know what the AI can reference.
2. **As a user, I want to remove a file from context** by clicking an X on its pill, so I can ask questions unrelated to my current file.
3. **As a user, I want the active file to auto-attach when I switch tabs**, so I don't have to manually add it each time.
4. **As a user, I want removed files to stay removed until I switch tabs**, so my context preference is respected within a tab session.

## Technical Approach

### State Management

No new Zustand store. Context pills are managed as local React state in `ChatPanel.tsx` (or a small `useChatContext` hook), derived from the active tab:

```typescript
interface ContextItem {
  id: string;            // Unique key (file path for files, generated ID for future images)
  type: 'file';          // Extensible: 'file' | 'image' | 'folder' in the future
  label: string;         // Display name (filename only, e.g., "README.md")
  path: string;          // Full file path
  dismissed: boolean;    // True when user has clicked X
}
```

**Auto-attachment logic:**

- When `activeTab` changes (new file path), add a `ContextItem` for the new file with `dismissed: false`.
- If the user clicks X on a pill, set `dismissed: true` — the pill disappears but the item stays in state.
- On tab switch, reset: clear all items and add the new active tab file.
- If no tab is open, the context items list is empty.

### Context Injection

Modify `buildProjectContext()` in `useAIOperations.ts`:

- **Current behavior**: Always appends `Currently editing: {path}\n\nFile content preview:\n{first 500 chars}`.
- **New behavior**: Only include files from the non-dismissed context items list. For each attached file, include only the path:

  ```
  Currently editing: /Users/peter/projects/note-sage/README.md
  ```

  No content preview. Agents that need file content can request it via tool calls or read commands.

The context items list is passed from `ChatPanel` to `useAIOperations` (or read from a shared ref/callback).

### Component Changes

`ChatInput.tsx` — Add a context pills row above the textarea:

```
┌──────────────────────────────────────────────┐
│  [📄 README.md ×]  [📄 utils.ts ×]          │  ← Context pills (above textarea)
│                                              │
│  Ask anything...                             │  ← Textarea
│                                              │
│──────────────────────────────────────────────│
│  Claude · General · project  🔍  🎯 2 goals │  ← Footer (unchanged)
└──────────────────────────────────────────────┘
```

`ChatPanel.tsx` — Manage context item state, pass items and callbacks to `ChatInput`.

`useAIOperations.ts` — Accept excluded file paths, gate active tab injection.

## UI/UX

### Pill Design

- **Shape**: Rounded pill (`rounded-md`), matching the existing goals badge aesthetic.
- **Size**: `text-xs` (12px), compact height (\~22px).
- **Colors**: `bg-accent text-accent-foreground` (neutral, matches design system).
- **Icon**: `File` icon from lucide-react (14px, `strokeWidth={1.5}`), left side.
- **Label**: Filename only (not full path). Truncated with ellipsis if longer than \~20 chars.
- **Close button**: `X` icon (12px), visible only on hover over the pill. Appears on the right side with a subtle fade-in (150ms).
- **Tooltip**: Full file path shown on hover (using shadcn Tooltip).
- **Transition**: Pills appear/disappear with a smooth opacity + scale transition (150ms).

### Interaction States

| State | Behavior |
| --- | --- |
| Tab open | Active file pill shown, non-dismissed |
| User clicks X | Pill fades out, file excluded from context |
| User switches tab | Previous pills cleared, new active file pill appears |
| No tab open | No pills shown |
| Multiple future items | Pills wrap to multiple lines (flex-wrap), max height capped |

### Layout

The pills row sits inside the `ChatInput` border, above the textarea, separated by a subtle bottom border or just spacing. It should feel like part of the input area — not a separate toolbar.

- `px-3 pt-2 pb-1` padding for the pills row.
- `gap-1.5` between pills.
- `flex flex-wrap` for future multi-pill layout.
- If no pills are visible (all dismissed or no tab), the row is hidden entirely (no empty space).

## Data Model

### New Interface

```typescript
// In ChatPanel.tsx or a useChatContext hook
interface ContextItem {
  id: string;
  type: 'file';          // Future: 'image' | 'folder'
  label: string;
  path: string;
  dismissed: boolean;
}
```

### Modified: `useAIOperations` Context Building

The `buildProjectContext` function currently unconditionally includes `activeTab`. It needs to accept a list of attached file paths (non-dismissed context items) and only include those:

```typescript
// Before:
if (activeTab) {
  let fileContext = `Currently editing: ${activeTab.filePath}`;
  // ... content preview ...
  parts.push(fileContext);
}

// After:
for (const filePath of attachedFilePaths) {
  parts.push(`File in context: ${filePath}`);
}
```

### No Rust/Backend Changes

All changes are frontend-only. The Tauri command `ai_chat_stream` receives `messages: Vec<ChatMessage>` — the system message content changes, but the interface does not.

## Dependencies

No new libraries. Uses existing:

- `lucide-react` (File, X icons)
- shadcn/ui `Tooltip` (full path on hover)
- Tailwind CSS for styling

## Quality Gates

### Functional

- [ ] Active tab file appears as a pill when a tab is open

- [ ] Pill shows filename only (not full path)

- [ ] Hovering the pill shows full path in a tooltip

- [ ] Hovering the pill shows an X close button on the right

- [ ] Clicking X removes the pill and excludes the file from AI context

- [ ] Switching tabs clears previous pills and shows the new active file

- [ ] Closing all tabs shows no pills (no empty row)

- [ ] Removing the pill actually excludes the file path from the system message sent to AI

- [ ] Pill row is inside the ChatInput border, above the textarea

- [ ] Works correctly for all provider types (direct API, ACP, local bundled)

### Design

- [ ] Pill style matches the existing goals badge (neutral, compact, `bg-accent`)

- [ ] X button only visible on hover, with smooth fade-in

- [ ] Pill appears/disappears with smooth transition

- [ ] Looks correct in both light and dark mode

- [ ] Looks correct with soft contrast mode

- [ ] Pills wrap gracefully if multiple items are present (future-proofing)

- [ ] No layout shift in the textarea when pills appear/disappear

## Out of Scope (Future Work)

- **Image paste**: Paste images from clipboard → show as image thumbnail pill → send as base64 or vision input to multimodal providers.
- **Drag-and-drop files**: Drag files from sidebar or OS → add as file context pills → include path (or content) in context.
- **Folder attachment**: Drag a folder → include file tree summary as context.
- **Re-add dismissed files**: A `+` button or drag-and-drop to re-attach a previously dismissed file within the same tab session.
- **Content depth toggle**: Per-pill option to include full content vs path only.
- **Multiple auto-attached files**: Auto-attach all open tabs, recently edited files, or files mentioned in conversation.