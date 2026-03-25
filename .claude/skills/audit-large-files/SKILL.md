---
name: audit-large-files
description: Audit for oversized components, hooks, and modules that need decomposition
user-invocable: true
---

# Audit: Large Files & Decomposition

Identify oversized files that hurt maintainability and suggest decomposition. This is a research-only audit — do not modify any code.

## What to Search For

### File Size Inventory

1. Find all `.tsx`, `.ts`, and `.rs` files. Count lines for each using `wc -l` via Bash.
2. Flag files over these thresholds:
   - `.tsx` components: **400 lines**
   - `.ts` hooks/stores: **500 lines**
   - `.rs` modules: **1,000 lines**

### For Each Flagged File, Assess

- **Responsibility count:** How many distinct concerns does it handle? List them.
- **Nested sub-components:** Are there components defined inside other component files that should be separate files? Note their line counts.
- **Code duplication:** Is the same pattern repeated (e.g., similar form fields, similar API call setups)?
- **Decomposition plan:** What would you extract, and what would remain?

### Specific Patterns

- **Components with 10+ hooks:** A component calling 10+ custom hooks is likely an orchestrator that could delegate to sub-components.
- **Hooks mixing concerns:** A hook that handles both UI state and backend communication should be split.
- **Rust modules with shared code:** Two modules implementing the same protocol (e.g., JSON-RPC) should share a common module.
- **Settings panels with nested dialogs:** Dialog components defined inline in a settings file should be separate files.

## Output Format

Report findings as a table for overview, then detailed entries for the largest files:

```markdown
### Files Over Threshold

| File | Lines | Threshold | Responsibilities |
| --- | --- | --- | --- |
| `Editor.tsx` | 1,822 | 400 | 15+ (editor, viewers, comments, AI, shortcuts...) |

### HIGH: Editor.tsx — 1,822 lines, 15+ responsibilities

**File:** `src/components/editor/Editor.tsx`

**Current responsibilities:**
1. Tiptap editor lifecycle
2. Tab management
3. File viewer routing
...

**Recommended extraction:**

| Extract to | Responsibility | Est. lines |
| --- | --- | --- |
| `EditorViewerContainer.tsx` | File type routing | 200-300 |
| `useEditorKeyBindings.ts` | Keyboard shortcuts | 100-150 |
| `Editor.tsx` (remaining) | Thin orchestrator | ~600 |
```

End with a section listing files that are large but **acceptable** (specialized viewers, type definition files, declarative toolbar configs) to avoid flagging them in future audits.

## Example Finding

### HIGH: ConnectionsSettings — 1,685 lines with 468-line nested component

**File:** `src/components/settings/ConnectionsSettings.tsx`

Contains `ConnectAgent` (468 lines) and `ConnectCopilotLsp` (384 lines) defined inline. Each manages a complete auth flow that could be tested independently.

**Recommended extraction:**

| Extract to | Lines | Responsibility |
| --- | --- | --- |
| `ConnectAgent.tsx` | 468 | Agent install guides + auth flow |
| `ConnectCopilotLsp.tsx` | 384 | Device code flow + browser integration |
| `SetupGuideView.tsx` | 156 | Shared setup guide UI |
| `ConnectionsSettings.tsx` (remaining) | ~400 | Connection list + add flow orchestration |
