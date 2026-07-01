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
   - `.tsx` components: **400 lines** — but the decisive metric is the
     LARGEST single component/function in the file, not the file total.
     A file may be long because it holds N small co-located components
     (flag for one-component-per-file, §"Component-count split") or because
     one function is enormous (flag for in-function decomposition).
   - `.ts` hooks/stores: **500 lines**
   - `.rs` modules: **1,000 lines**

   Record BOTH numbers per flagged file: `total_lines` and
   `largest_unit_lines`. Sort findings by `largest_unit_lines` — a 2,832-line
   file whose biggest function is 1,430 lines is a worse offender than a
   2,279-line file that is one cohesive parser.

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
- **N components in one file (one-component-per-file violation):** Count
  top-level component declarations per `.tsx` file (`function PascalCase`,
  `const PascalCase = (` returning JSX). A file holding ≥3 independently-
  renderable components is a split candidate REGARDLESS of total line count —
  each component subscribes to different stores and is independently testable,
  so co-location defeats isolated re-render reasoning and unit testing. Report
  each sub-component with its start line and estimated size. The target shape
  is a layout shell that composes one-file-each children (e.g. an 1,148-line
  `StatusBar.tsx` packing 11 components, or a command-bar file holding 9).
- **Module-scope mutable state in a hook file:** Grep flagged hook modules for
  top-level `let` bindings and module-scope mutators/getters (e.g. exported
  free functions that read/write those `let`s). State that a React hook mutates
  but stores at MODULE scope is a hidden global — it works only because the app
  mounts the hook exactly once, and it breaks under StrictMode double-invoke and
  any future multi-window. Flag it as a boundary leak: the state belongs in the
  store that owns the corresponding UI (per the Zustand store inventory in
  architecture.md), not in a hook module. Recommend moving it into that store
  and reducing the hook to a thin orchestrator (e.g. a lifecycle hook holding
  `let _homeDir` / eager-session promises / timer ids that belong in a status store).
- **A core contract surface buried under a converter/helper bank:** When a
  module mixes a documented, contract-bearing API (e.g. the markdown↔ProseMirror
  round-trip in `src/lib/markdown.ts`) with a large bank of same-shaped helper
  functions (15× `convert*ToHtml`), the helpers should move to a sibling module
  with a re-export for compatibility, leaving the contract surface readable in
  isolation. Detection heuristic: ≥8 functions sharing a naming prefix
  (`convertXToY`, `parseX`, `handleX`) inside a file that ALSO exports a small
  set of architecturally-load-bearing functions.
- **Rust command module mixing `#[tauri::command]` handlers with lifecycle/
  catalog/transport logic:** A `commands/*.rs` file that holds both the IPC
  command surface AND substantial non-command machinery (process lifecycle,
  embedded catalogs, FIM/transport plumbing) is a split candidate. Separate the
  thin command layer from the implementation module it delegates to (e.g. an
  `acp.rs` mixing commands with session-lifecycle, or a `local_inference.rs`
  mixing lifecycle + catalog + FIM).

## Output Format

Report findings as a table for overview, then detailed entries for the largest files:

```markdown
### Files Over Threshold

| File | Lines | Threshold | Responsibilities |
| --- | --- | --- | --- |
| `FloatingCommandBar.tsx` | 2,832 | 400 | 5+ (chat surface, prefix modes, resize, attachments, a11y) |

### HIGH: FloatingCommandBar.tsx — 2,832 lines, 5+ responsibilities, main fn ~1,430 lines

**File:** `src/components/cmd/FloatingCommandBar.tsx`

**Current responsibilities:**
1. Chat surface (the documented "chat panel")
2. Prefix-mode picker dispatch (`/`, `@`, `#`, `!`, `?`, `>`)
3. Pinned-panel resize + width/height state machine
4. Attachment chips
5. Combobox/listbox accessibility wiring

Holds 9 top-level components in one file: the main `FloatingCommandBar`,
`PinnedResizeHandle`, `ExpandedResizeHandle`, `TopResizeHandle`,
`CompactContent`, `ExpandedContent`, `PrefixModeBadge`,
`ModePickerDispatch`, `VerbDiscoveryMenu`. ~80 hook/effect call sites.

**Recommended extraction:**

| Extract to | Lines | Responsibility |
| --- | --- | --- |
| `cmd/resize/{Pinned,Expanded,Top}ResizeHandle.tsx` | ~130 each | Drag-resize handles |
| `cmd/CompactContent.tsx`, `cmd/ExpandedContent.tsx` | ~130 / ~510 | Bar body states |
| `cmd/ModePickerDispatch.tsx`, `cmd/VerbDiscoveryMenu.tsx` | ~95 / ~40 | Prefix/verb pickers |
| `useCommandBarGeometry.ts` | ~150 | `PINNED_*`/`EXPANDED_*` constants + resize state machine |
| `FloatingCommandBar.tsx` (remaining) | <500 | Thin orchestrator |
```

## Decomposition Heuristics (rank, don't just count)

Line count is a trigger, not a verdict. Before recommending a split, score each
flagged file on:

1. **Largest-unit size** — the single biggest function/component (see threshold
   note). This is the primary rank key.
2. **Responsibility count** — distinct concerns in the main unit. ≥3 → split.
3. **Cohesion** — would the extracted pieces share state/imports, or are they
   independent? A 2,000-line file that is ONE responsibility with high internal
   cohesion (a binary parser, a single-format converter) is ACCEPTABLE; record
   it in the acceptable list, do not recommend a split.
4. **Churn** — is this a high-traffic file (the chat surface, the main editor)?
   High churn × high size = highest priority because merge conflicts and review
   load concentrate there.

Worked contrast: a 2,279-line cohesive parser and a 2,168-line single-format
converter are left ACCEPTABLE (one responsibility, high internal cohesion), while
a 1,148-line status bar is flagged HIGH despite being smaller — because it is 11
responsibilities, not one.

End with a section listing files that are large but **acceptable** (specialized viewers, type definition files, declarative toolbar configs) to avoid flagging them in future audits.

Confirmed cohesive in a recent pass — do NOT re-flag for size alone:

- `src/lib/pptx-parser.ts` (~2,279) — single-responsibility PPTX parser
- `src-tauri/src/export/markdown_to_docx.rs` (~2,168) — single-format converter
- `src-tauri/src/export/markdown_to_pptx.rs` (~1,776) — single-format converter
- `src-tauri/src/commands/copilot_lsp.rs` (~1,409) — cohesive LSP orchestrator

Test files are expected to be large and are out of scope (e.g.
`settings-store.test.ts`, `useAgentTaskOperations.test.ts`). Always exclude
`*.test.*` from the size inventory ranking.

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
