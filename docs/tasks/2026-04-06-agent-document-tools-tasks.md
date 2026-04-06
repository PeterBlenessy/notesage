# Agent Document Tools — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-06 |
| **Status** | Complete |
| **PRD** | [agent-document-tools](../prds/2026-04-06-agent-document-tools.md) |
| **Total** | 14 tasks: 5S, 6M, 3L |
| **Suggested order** | Foundation (#1-#3) → Comment tools (#4-#6) → PPTX tool (#7) → Skills (#8-#11) → Integration (#12-#13) → Tests (#14) |

**Risks:**

- Anchor text matching in ProseMirror has edge cases: text spanning multiple nodes, whitespace normalization, inline formatting. Task #3 must handle these.
- Mermaid rendering via Node.js script needs either `mermaid` npm package (browser env required) or `@mermaid-js/mermaid-cli`. Evaluate during #10.
- Excalidraw drawings inserted by agents won't have SVG previews until the user opens the canvas. Exports (PDF/DOCX/HTML) will show a placeholder. Acceptable for v1.

---

### #1 — Create editor bridge module ✅

**Description:** Create `src/lib/editor-bridge.ts` with `setEditorRef()` / `getEditorRef()` module-level accessors. Wire up in `Editor.tsx` — call `setEditorRef(editor)` when the Tiptap editor instance is created, and `setEditorRef(null)` on unmount. This gives the tool executor access to ProseMirror state without prop drilling.

**Acceptance criteria:**

- `getEditorRef()` returns the active Tiptap editor instance when a document is open
- Returns `null` when no editor is mounted
- Updates correctly on tab switch (editor instance is shared, just state changes)

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- Create: `src/lib/editor-bridge.ts`
- Modify: `src/components/editor/Editor.tsx`

---

### #2 — Register new built-in tools in skill-store.ts ✅

**Description:** Add 4 new tool definitions to the `BUILT_IN_TOOLS` array in `src/stores/skill-store.ts`: `add_comments`, `list_comments`, `resolve_comments`, `generate_pptx`. Use the JSON Schema definitions from the PRD. Each tool needs a clear `description` that teaches the model when and how to use it.

**Acceptance criteria:**

- All 4 tools appear in `getToolDefinitions()` output
- Schemas match the PRD specifications
- Descriptions are clear enough for models to use correctly

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- Modify: `src/stores/skill-store.ts`

---

### #3 — ProseMirror anchor text search utility ✅

**Description:** Create `src/lib/pm-text-search.ts` with a function `findTextInDoc(doc: Node, text: string, occurrence: number): { from: number, to: number } | null`. Walks the ProseMirror document, finds exact substring matches across node boundaries, and returns positions for the Nth occurrence.

Must handle:

- Text spanning multiple inline nodes (bold + plain text)
- Whitespace normalization (collapse multiple spaces, trim)
- Case-sensitive matching (anchor text should be exact)
- Multiple occurrences via the `occurrence` parameter

**Acceptance criteria:**

- Finds exact substrings in plain paragraphs
- Finds text that spans formatted ranges (e.g., "hello **world**" matches "hello world")
- Returns `null` when text not found
- Correctly handles the `occurrence` parameter for repeated text

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- Create: `src/lib/pm-text-search.ts`

---

### #4 — Implement `add_comments` tool ✅

**Description:** Add the `add_comments` case to `executeToolCall()` in `tool-executor.ts`. For each comment in the input array:

1. Import `getEditorRef()` from editor bridge
2. Use `findTextInDoc()` to locate anchor text positions
3. Call `useCommentStore.getState().addComment()` with `{ documentId, anchorText, from, to, body, author: 'AI', status: 'open' }`
4. After all comments are added, call `setCommentDecorations()` to render decorations
5. Call `saveComments()` to persist
6. Return summary with count and any skipped comments

Get `documentId` from `useEditorStore.getState()` active tab's comment key. Get `projectRoot` from workspace store. Follow the pattern in `useCommentOperations.createComment()`.

**Acceptance criteria:**

- Comments appear as highlighted decorations in the editor
- Comments persist to `.notesage/comments/` on disk
- Skipped comments (anchor text not found) reported in result
- Works with the existing comment popover (click to view)

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1, #2, #3 **Files:**

- Modify: `src/lib/tool-executor.ts`

---

### #5 — Implement `list_comments` tool ✅

**Description:** Add the `list_comments` case to `executeToolCall()`. Reads all comments for the active document from `useCommentStore` and returns a formatted string with comment details.

Output format per comment:

```
[{id}] Status: {status} | Anchor: "{anchorText}"
{body}
Replies: {reply count}
```

Get `documentId` from the active tab's comment key in editor store.

**Acceptance criteria:**

- Returns all comments for the active document
- Includes comment ID, body, status, anchor text, and reply count
- Returns "No comments found" when document has no comments
- Auto-allowed (no permission prompt)

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- Modify: `src/lib/tool-executor.ts`

---

### #6 — Implement `resolve_comments` tool ✅

**Description:** Add the `resolve_comments` case to `executeToolCall()`. For each comment ID in the input array:

1. Call `useCommentStore.getState().setCommentStatus(documentId, commentId, 'resolved')`
2. After all updates, refresh decorations via `setCommentDecorations()`
3. Save to disk via `saveComments()`
4. Return summary: "Resolved N comments"

Report invalid/not-found IDs in the result.

**Acceptance criteria:**

- Comments transition to `'resolved'` status
- Resolved comment decorations update (highlight removed per existing behavior)
- Changes persist to disk
- Invalid comment IDs reported gracefully

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1, #2 **Files:**

- Modify: `src/lib/tool-executor.ts`

---

### #7 — Implement `generate_pptx` tool ✅

**Description:** Add the `generate_pptx` case to `executeToolCall()`. Flow:

1. If `markdown` arg provided, use it. Otherwise, read the active document via `read_file` using the active tab's file path.
2. If no `template` specified, return an error message: "Please ask the user which template they prefer. Available templates: simple, business, report" + any custom templates from `list_pptx_templates`.
3. Extract title from first heading or filename
4. Call `invoke('export_pptx', { markdown, title, template })` to generate PPTX bytes
5. Determine output path: use `output_path` arg, or derive from source file (`document.md` → `document.pptx`)
6. Call `invoke('save_binary_file', { path, data })` to write
7. Return: "Presentation saved to {path} ({template} template)"

**Acceptance criteria:**

- PPTX file generated and saved to disk
- Uses the correct template
- Returns informative error when template not specified
- Works with custom templates
- Output path defaults to next to the source document

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- Modify: `src/lib/tool-executor.ts`

---

### #8 — Bundled skill: review-document ✅

**Description:** Create `bundled-skills/review-document/` with a `SKILL.md` that teaches agents how to review documents and fix comments. This is a knowledge-only skill (no scripts).

Content should cover:

- **Document review workflow:** read_file → analyze → add_comments
- **Comment fixing workflow:** list_comments → read_file → write_file → resolve_comments
- **Tips:** comment style (concise, actionable), section-focused review, severity levels
- **Examples:** sample comment bodies for different review types (clarity, tone, grammar, structure)

**Acceptance criteria:**

- Skill appears in skill registry after extraction
- SKILL.md provides clear, complete workflow instructions
- Agent can follow the instructions to perform both review and fix workflows

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- Create: `bundled-skills/review-document/SKILL.md`

---

### #9 — Bundled skill: insert-drawing (insert-chart pattern) ✅

**Description:** Create `bundled-skills/insert-drawing/` following the exact `insert-chart` pattern — knowledge-only skill that teaches the agent to use existing `write_file` and `read_file` tools.

- `SKILL.md` — step-by-step workflow: generate ID, write `.excalidraw` JSON via `write_file`, insert markdown reference `<div data-drawing-id="{id}" data-type="drawing" class="drawing-block"></div>` into the document via `write_file`. Tips for layout, element positioning, when to use Excalidraw vs Mermaid.
- `references/EXCALIDRAW-SCHEMA.md` — element format (rectangle, ellipse, diamond, arrow, text, line, freedraw), required fields (`type`, `x`, `y`, `width`, `height`, `id`), coordinate system, binding/grouping
- `references/EXAMPLES.md` — complete working examples: simple flowchart, architecture diagram, process flow, entity relationship. Each example includes the full `.excalidraw` JSON and the markdown line to insert.

Follow the `insert-chart` skill structure precisely: same section headings (How It Works, Workflow, Tips, Troubleshooting, References).

**Acceptance criteria:**

- Schema reference covers all common element types with all required fields
- Examples are valid Excalidraw JSON that renders correctly when opened in the canvas
- Instructions are clear enough that an agent produces working drawings using only `write_file`

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:**

- Create: `bundled-skills/insert-drawing/SKILL.md`
- Create: `bundled-skills/insert-drawing/references/EXCALIDRAW-SCHEMA.md`
- Create: `bundled-skills/insert-drawing/references/EXAMPLES.md`

---

### #10 — Bundled skill: insert-diagram (with render script) ✅

**Description:** Create `bundled-skills/insert-diagram/` with instructions and a Mermaid render script.

- `SKILL.md` — instructions on Mermaid syntax, workflow (write `.mmd` → render via `execute_skill_script` → insert SVG reference), when to use Mermaid vs Excalidraw
- `references/MERMAID-SYNTAX.md` — syntax reference for flowchart, sequence, class, state, gantt, pie, ER, mindmap
- `references/EXAMPLES.md` — complete working examples for each diagram type
- `scripts/render-mermaid.mjs` — Node.js script: reads `.mmd` file, renders to SVG, writes output. Input: `node render-mermaid.mjs <input.mmd> <output.svg>`

**Mermaid rendering approach:** Evaluate `@mermaid-js/mermaid-cli` (mmdc subprocess) vs `mermaid` npm package with jsdom. Pick the lighter option that supports the core diagram types.

**Acceptance criteria:**

- Render script produces valid SVG from Mermaid source
- Supports flowchart, sequence, class, and state diagram types at minimum
- Examples produce valid SVG when rendered through the script
- Instructions clearly explain the three-step process (write .mmd → render → insert SVG reference)

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:**

- Create: `bundled-skills/insert-diagram/SKILL.md`
- Create: `bundled-skills/insert-diagram/references/MERMAID-SYNTAX.md`
- Create: `bundled-skills/insert-diagram/references/EXAMPLES.md`
- Create: `bundled-skills/insert-diagram/scripts/render-mermaid.mjs`
- Create: `bundled-skills/insert-diagram/scripts/package.json`

---

### #11 — Bundled skill: generate-presentation ✅

**Description:** Create `bundled-skills/generate-presentation/` with:

- `SKILL.md` — instructions on generating presentations via the `generate_pptx` tool, template selection, content structuring tips
- `references/TEMPLATES.md` — description of each built-in template (Simple, Business, Report) with visual characteristics and best-use-cases

Content should emphasize:

- Always ask for template preference if not specified
- How to structure markdown for good slides (H1 = new slide, H2 = subtitle, etc.)
- Content density guidelines (max 8 bullets, 300 words per slide)
- Speaker notes via `> [!notes]` callouts

**Acceptance criteria:**

- Skill instructions teach the agent to ask for template
- Template reference describes all built-in options clearly
- Content structuring tips produce well-balanced slides

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- Create: `bundled-skills/generate-presentation/SKILL.md`
- Create: `bundled-skills/generate-presentation/references/TEMPLATES.md`

---

### #12 — Update tool permissions and formatToolLabel ✅

**Description:** Two integration updates:

**Permissions:** Update the permission check in `useDirectApiChat.ts` (or `permission-store.ts`) to auto-allow `list_comments` (read-only) and require approval for `add_comments`, `resolve_comments`, `generate_pptx`. Follow the existing pattern where `read_file`, `list_directory`, `web_search`, and `read_skill_content` are auto-allowed.

**Tool labels:** Add cases to `formatToolLabel()` in `src/lib/ai/acp-utils.ts` for the new tools:

- `add_comments` → "Adding {N} comments"
- `list_comments` → "Reading comments"
- `resolve_comments` → "Resolving {N} comments"
- `generate_pptx` → "Generating presentation ({template})"

**Acceptance criteria:**

- `list_comments` executes without permission prompt
- Other 3 built-in tools show permission card
- Tool call segments show descriptive labels

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- Modify: `src/lib/ai/acp-utils.ts`
- Modify: `src/hooks/useDirectApiChat.ts` or `src/stores/permission-store.ts`

---

### #13 — Update bundled skill extraction and agent allowed-tools ✅

**Description:** Ensure the 4 new bundled skills are extracted to `~/.notesage/bundled-skills/` on startup, following the existing pattern. The `useSkillDiscovery` hook in `src/hooks/useSkillOperations.ts` already handles bundled skill extraction — verify the new skill directories are included.

Also update the `bundled-agents/general-assistant.md` (and other relevant agents) `allowed-tools` frontmatter to include the new built-in tools (`add_comments`, `list_comments`, `resolve_comments`, `generate_pptx`), so the default agent can use them. Add comment tools to `technical-editor` and `proofreader` agents too.

**Acceptance criteria:**

- All 4 new skills appear in the skill registry after app restart
- General assistant agent has access to all 4 new built-in tools
- Technical editor and proofreader agents have access to comment tools
- Skills with scripts (`insert-diagram`) have their `scripts/` directory extracted

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #8, #9, #10, #11 **Files:**

- Modify: `bundled-agents/general-assistant.md`
- Modify: `bundled-agents/technical-editor.md`
- Modify: `bundled-agents/proofreader.md`
- Verify: `src/hooks/useSkillOperations.ts`

---

### #14 — Unit tests for agent document tools ✅

**Description:** Write unit tests covering the core tool logic:

**ProseMirror text search (**`pm-text-search.ts`**):**

- Find text in plain paragraph
- Find text spanning bold + plain nodes
- Find Nth occurrence
- Return null for missing text
- Handle whitespace normalization

**Comment tools (mock editor + store):**

- `add_comments` creates comments with correct positions
- `add_comments` skips comments with unmatched anchor text
- `list_comments` returns formatted output
- `resolve_comments` updates status

**PPTX tool (mock Tauri invoke):**

- `generate_pptx` calls export_pptx with correct args
- Returns error when no template specified
- Derives output path from source filename

**Acceptance criteria:**

- All tests pass (`pnpm test`)
- Coverage for `pm-text-search.ts` &gt; 90%
- Coverage for new cases in `tool-executor.ts` &gt; 80%

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #3, #4, #5, #6, #7 **Files:**

- Create: `src/lib/__tests__/pm-text-search.test.ts`
- Create: `src/lib/__tests__/tool-executor-documents.test.ts`