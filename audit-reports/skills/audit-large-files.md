# Proposal: Improvements to `audit-large-files` SKILL.md

Source evidence: `/home/user/notesage/audit-reports/04-architecture-deadcode.md` (2026-06-03 architecture/dead-code pass).
Scope: oversized-file detection + decomposition guidance only. Dead-code/unused-export items are split into the `audit-dead-code` proposal.

Every change below is traceable to a specific finding. No SKILL.md edits are applied here — this is a draft of proposed changes.

---

## 1. Stale / incorrect guidance to fix

### 1.1 The illustrative example uses a file that no longer matches reality

**Current text (SKILL.md lines 46–62, the `### HIGH: Editor.tsx — 1,822 lines` worked example):**

```markdown
### HIGH: Editor.tsx — 1,822 lines, 15+ responsibilities

**File:** `src/components/editor/Editor.tsx`

**Current responsibilities:**
1. Tiptap editor lifecycle
2. Tab management
3. File viewer routing
...
```

**Problem:** The audit's "Top 12 largest non-test source files" table does not contain `Editor.tsx` at all — it has already been decomposed (the audit confirms `useEditorKeyBindings.ts`, `useEditorTabSwitch.ts` etc. now exist as extracted hooks). The example teaches a decomposition target that has already shipped, so an auditor pattern-matching against it will look for the wrong god-object.

**Replacement:** Re-anchor the worked example on the current #1 offender:

```markdown
### HIGH: FloatingCommandBar.tsx — 2,832 lines, 5+ responsibilities, main fn ~1,430 lines

**File:** `src/components/cmd/FloatingCommandBar.tsx`

**Current responsibilities:**
1. Chat surface (the documented "chat panel")
2. Prefix-mode picker dispatch (`/`, `@`, `#`, `!`, `?`, `>`)
3. Pinned-panel resize + width/height state machine
4. Attachment chips
5. Combobox/listbox accessibility wiring

Holds 9 top-level components in one file: the main `FloatingCommandBar`
(L175–1608), `PinnedResizeHandle`, `ExpandedResizeHandle`, `TopResizeHandle`,
`CompactContent`, `ExpandedContent` (L2117–2626), `PrefixModeBadge`,
`ModePickerDispatch`, `VerbDiscoveryMenu`. 82 hook/effect call sites.

**Recommended extraction:**

| Extract to | Lines | Responsibility |
| --- | --- | --- |
| `cmd/resize/{Pinned,Expanded,Top}ResizeHandle.tsx` | ~130 each | Drag-resize handles |
| `cmd/CompactContent.tsx`, `cmd/ExpandedContent.tsx` | ~130 / ~510 | Bar body states |
| `cmd/ModePickerDispatch.tsx`, `cmd/VerbDiscoveryMenu.tsx` | ~95 / ~40 | Prefix/verb pickers |
| `useCommandBarGeometry.ts` | ~150 | `PINNED_*`/`EXPANDED_*` constants + resize state machine |
| `FloatingCommandBar.tsx` (remaining) | <500 | Thin orchestrator |
```

Cited to A1 (`FloatingCommandBar.tsx`, L175–1608 + sub-component line markers).

### 1.2 Thresholds and "10+ hooks" heuristic miss the real failure mode

**Current text (SKILL.md lines 16–19 + line 30):**

```markdown
   - `.tsx` components: **400 lines**
   - `.ts` hooks/stores: **500 lines**
   - `.rs` modules: **1,000 lines**
...
- **Components with 10+ hooks:** A component calling 10+ custom hooks is likely an orchestrator that could delegate to sub-components.
```

**Problem:** Raw whole-file line count over-flags cohesive single-responsibility files and under-explains why a file is bad. The audit explicitly cleared three files that bust the threshold as *acceptable* (`pptx-parser.ts` 2279, `markdown_to_docx.rs` 2168, `markdown_to_pptx.rs` 1776 — "Large but cohesive single-responsibility"), while a 1148-line file (`StatusBar.tsx`) was flagged HIGH not for total size but because it packs 11 components. The discriminator is **main-function size + component-count**, not file size.

**Replacement (revise the threshold block):**

```markdown
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
```

Cited to the audit's verdict column (`pptx-parser.ts` "cohesive… acceptable" vs `FloatingCommandBar.tsx` "main fn ~1430 lines").

---

## 2. New checks to add

### 2.1 Component-count split (one-component-per-file)

**Add as a new subsection under "Specific Patterns":**

```markdown
- **N components in one file (one-component-per-file violation):** Count
  top-level component declarations per `.tsx` file (`function PascalCase`,
  `const PascalCase = (` returning JSX). A file holding ≥3 independently-
  renderable components is a split candidate REGARDLESS of total line count —
  each component subscribes to different stores and is independently testable,
  so co-location defeats isolated re-render reasoning and unit testing. Report
  each sub-component with its start line and estimated size. The target shape
  is a layout shell that composes one-file-each children.
```

Cited to:
- A4 — `src/components/editor/StatusBar.tsx:15,56,77,98,126,161,221,293,338,465` (11 components: `InlineCompletionIcon`, `CopilotMaxCharsSlider`, `FimContextSlider`, `ActionsIndicator`, `IndexProgressIndicator`, `AgentInstructionsIndicator`, `ModelDownloadIndicator`, `OutOfScopeCompletionsIndicator`, `LocalAIIndicator`, then `StatusBar`). Sibling `StatusTray.tsx` (861) noted with same pattern.
- A1 — `FloatingCommandBar.tsx` (9 components) + sibling `CommandBarContext.tsx` (1000 lines, 8 components).
- A3 — `ProjectsSection.tsx:329,1253,1459` (`ProjectsSection`, `ProjectRow`, `ChildRow`).

### 2.2 Module-level mutable singletons in hook files

**Add as a new subsection under "Specific Patterns":**

```markdown
- **Module-scope mutable state in a hook file:** Grep flagged hook modules for
  top-level `let` bindings and module-scope mutators/getters (e.g. exported
  free functions that read/write those `let`s). State that a React hook mutates
  but stores at MODULE scope is a hidden global — it works only because the app
  mounts the hook exactly once, and it breaks under StrictMode double-invoke and
  any future multi-window. Flag it as a boundary leak: the state belongs in the
  store that owns the corresponding UI (per the Zustand store inventory in
  architecture.md), not in a hook module. Recommend moving it into that store
  and reducing the hook to a thin orchestrator.
```

Cited to A2 — `src/hooks/useAcpLifecycle.ts:44–82` (`let _homeDir`, `eagerSessionPromise`, `unresponsiveTimerId`, `onUnresponsiveCallback`, `retryCallback`, `keepWaitingCallback`) + module-scope getters at L77–105; recommended home is `agent-status-store`.

### 2.3 Two-responsibility module split (round-trip surface vs converter bank)

**Add as a new subsection under "Specific Patterns":**

```markdown
- **A core contract surface buried under a converter/helper bank:** When a
  module mixes a documented, contract-bearing API (e.g. the markdown↔ProseMirror
  round-trip in `src/lib/markdown.ts`) with a large bank of same-shaped helper
  functions (15× `convert*ToHtml`), the helpers should move to a sibling module
  with a re-export for compatibility, leaving the contract surface readable in
  isolation. Detection heuristic: ≥8 functions sharing a naming prefix
  (`convertXToY`, `parseX`, `handleX`) inside a file that ALSO exports a small
  set of architecturally-load-bearing functions.
```

Cited to A5 — `src/lib/markdown.ts:275–1054` (15 `convert*ToHtml`) alongside round-trip core `getMarkdownFromEditor` L1076 / `loadRawMarkdownIntoEditor` L1149 / `streamingHydrate` L1305.

---

## 3. Modern-judgment additions

### 3.1 Decomposition heuristics beyond raw line count

**Add as a new subsection "## Decomposition Heuristics (rank, don't just count)":**

```markdown
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

Worked contrast from the 2026-06-03 audit: `pptx-parser.ts` (2,279) and
`markdown_to_docx.rs` (2,168) were left ACCEPTABLE (single cohesive parser/
converter), while `StatusBar.tsx` (1,148) was flagged HIGH despite being smaller
— because it is 11 responsibilities, not one.
```

### 3.2 Rust command-module split heuristic

**Add to "Specific Patterns" (the skill already mentions shared protocol modules but not this split shape):**

```markdown
- **Rust command module mixing `#[tauri::command]` handlers with lifecycle/
  catalog/transport logic:** A `commands/*.rs` file that holds both the IPC
  command surface AND substantial non-command machinery (process lifecycle,
  embedded catalogs, FIM/transport plumbing) is a split candidate. Separate the
  thin command layer from the implementation module it delegates to.
```

Cited to the audit's "candidate split" rows: `acp.rs` 2007 ("Command + session-lifecycle mix"), `local_inference.rs` 1481 ("Lifecycle + catalog + FIM"), `transcription.rs` 1424 ("Capture + transcribe + model mgmt").

### 3.3 Expand the "acceptable" exclusion list with this repo's confirmed-cohesive files

**Append to the closing "files that are large but acceptable" section:**

```markdown
Confirmed cohesive in the 2026-06-03 pass — do NOT re-flag for size alone:

- `src/lib/pptx-parser.ts` (2,279) — single-responsibility PPTX parser
- `src-tauri/src/export/markdown_to_docx.rs` (2,168) — single-format converter
- `src-tauri/src/export/markdown_to_pptx.rs` (1,776) — single-format converter
- `src-tauri/src/commands/copilot_lsp.rs` (1,409) — cohesive LSP orchestrator

Test files are expected to be large and are out of scope (e.g.
`settings-store.test.ts` 2,463, `useAgentTaskOperations.test.ts` 2,062).
Always exclude `*.test.*` from the size inventory ranking.
```

Cited to the audit's verdict column + the parenthetical at lines 41–42 (largest files overall are tests).
