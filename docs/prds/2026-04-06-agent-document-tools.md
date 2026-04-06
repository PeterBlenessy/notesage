# PRD: Agent Document Tools

|  |  |
| --- | --- |
| **Date** | 2026-04-06 |
| **Status** | Implemented |
| **Priority** | High |
| **Impact** | Agents can review documents, fix comments, generate illustrations, and create presentations — all from the chat panel |

## Problem

Today, agents in Notesage's chat panel can read and write files, search the web, and execute skill scripts — but they cannot interact with the document's rich content layer. Users must manually create comments, draw diagrams, and navigate the export dialog to produce presentations. This creates friction in workflows where the AI has the context and capability to do these things directly.

Four specific gaps:

1. **No agent commenting.** Users who want an AI review of their document must ask in chat, read the response, then manually create comments at the right locations. The review feedback lives in the chat, disconnected from the document.

2. **No agent comment resolution.** When a document has existing comments (from the user or a prior AI review), there's no way to tell the agent "go fix these." The agent can't read the comments or modify the document to address them.

3. **No agent illustration.** Users who want a process flow, architecture diagram, or illustration described in their text must manually create and populate a drawing. The AI can't insert visual content.

4. **No agent presentation generation.** Creating a PowerPoint from a document requires navigating the export dialog, selecting options, and saving. The agent can't do this autonomously, and it can't ask follow-up questions like "which template should I use?"

## Goals

- **G1:** An agent can read a document and leave inline comments at specific text ranges, visible as standard comment decorations in the editor.
- **G2:** An agent can read existing comments, understand their context, and modify the document to address them — marking comments as resolved when done.
- **G3:** An agent can generate diagrams (Excalidraw for editable drawings, Mermaid for complex flowcharts/sequences) and insert them into a document.
- **G4:** An agent can generate a PowerPoint presentation from document content, asking the user for template preferences if not specified.
- **G5:** All four capabilities are implemented as bundled skills with instructions and reference materials, following the `insert-chart` pattern. New built-in tools handle the operations that require editor integration.

## Non-Goals

- **Real-time collaborative commenting** (multiple users + AI commenting simultaneously with CRDT)
- **Agent-initiated edits** beyond comment resolution (e.g., rewriting sections without a comment anchor)
- **Mermaid editor UI** — Mermaid diagrams are rendered as static SVG images, not editable in a canvas like Excalidraw drawings
- **PPTX template creation** — agents use existing templates, they don't design new ones
- **Keynote or Google Slides export** — only PowerPoint format

## User Stories

### Commenting

- As a writer, I want to ask the agent "review this document for clarity and tone" so that I get inline comments at specific passages without leaving the editor.
- As a writer, I want to tell the agent "focus on the introduction" so that it only comments on specific sections.
- As a writer, I want the agent to go through my existing comments and fix the issues they describe, so that I can delegate editing to the AI.

### Illustration

- As a writer, I want to say "add a flowchart showing the user signup process" so that a diagram appears inline in my document.
- As a writer, I want to describe a concept and say "illustrate this" so that the agent creates an appropriate visual.
- As a writer, I want to paste a link to a web article and say "create a diagram of the architecture described here" so that the agent researches and illustrates it.

### Presentation

- As a writer, I want to say "create a PowerPoint from this document" so that a presentation is generated and saved without navigating dialogs.
- As a writer, I want the agent to ask me which template to use if I haven't specified one, so that I don't get a generic-looking presentation.
- As a writer, I want to say "use the Business template" so that the agent respects my preference.

## Technical Approach

### Architecture: Two Patterns

This feature uses two distinct patterns based on what each capability needs:

**Pattern 1 — Knowledge-only skills (insert-chart pattern):** For drawings and diagrams, the agent uses the existing `read_file` and `write_file` tools, guided by a bundled skill's `SKILL.md` with schema references and examples. The agent writes sidecar files and inserts markdown references; the file watcher and editor handle rendering. No new built-in tools needed. This is the same pattern used by `insert-chart`.

**Pattern 2 — New built-in tools:** For comments and PPTX generation, the agent needs capabilities that `write_file` alone cannot provide — comments require ProseMirror position resolution (not derivable from markdown offsets), and PPTX generation requires calling the `export_pptx` Tauri command (binary generation via ppt-rs).

### Built-in Tool 1: `add_comments` — Batch Comment Insertion

Adds one or more comments to the currently active document. The agent reads the document (via `read_file`), identifies passages to comment on, and calls this tool with an array of comments.

```typescript
{
  name: 'add_comments',
  description: 'Add inline comments to the currently active document. Each comment is anchored to a specific text passage. The comments appear as highlighted decorations in the editor, just like user-created comments.',
  input_schema: {
    type: 'object',
    properties: {
      comments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            anchor_text: { type: 'string', description: 'The exact text passage to attach the comment to. Must be a verbatim substring of the document.' },
            body: { type: 'string', description: 'The comment text.' },
            occurrence: { type: 'number', description: 'Which occurrence of the anchor text to use (1-based). Defaults to 1.' },
          },
          required: ['anchor_text', 'body'],
        },
        description: 'Array of comments to add.',
      },
    },
    required: ['comments'],
  },
}
```

**Execution flow:**

1. `executeToolCall('add_comments', args)` in `tool-executor.ts`
2. Get the active editor instance from the editor ref (new: expose via a module-level getter)
3. For each comment in the array: a. Search the ProseMirror document for `anchor_text` (text search, find the Nth occurrence) b. Compute `from`/`to` positions for the match c. Call `useCommentStore.getState().addComment(...)` with positions, body, and author `"AI"`
4. Trigger `setCommentDecorations()` to render all new comments
5. Save comments to disk
6. Return summary: "Added N comments to {filename}"

**Anchor text matching:** Uses `doc.textBetween()` traversal to find exact substring matches in the ProseMirror document. The `occurrence` parameter handles repeated phrases. If a match isn't found, the comment is skipped and reported in the result.

**Permission:** Requires user approval (modifies document state).

### Built-in Tool 2: `list_comments` — Read Existing Comments

Lists all comments on the currently active document with their text, status, and anchor context.

```typescript
{
  name: 'list_comments',
  description: 'List all comments on the currently active document. Returns comment text, status, anchor text, and replies.',
  input_schema: {
    type: 'object',
    properties: {},
  },
}
```

**Execution flow:**

1. Get the active document ID from the editor store
2. Read comments from `useCommentStore` for that document
3. Return formatted list with: comment ID, body, status, anchor text, replies

**Permission:** Auto-allowed (read-only).

### Built-in Tool 3: `resolve_comments` — Mark Comments as Resolved

Marks specified comments as resolved after the agent has addressed them.

```typescript
{
  name: 'resolve_comments',
  description: 'Mark one or more comments as resolved. Use after modifying the document to address the issues described in the comments.',
  input_schema: {
    type: 'object',
    properties: {
      comment_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of comment IDs to resolve. Use list_comments to get the IDs.',
      },
    },
    required: ['comment_ids'],
  },
}
```

**Execution flow:**

1. For each comment ID, call `useCommentStore.getState().setCommentStatus(docId, commentId, 'resolved')`
2. Update decorations
3. Save to disk
4. Return summary

**Permission:** Requires user approval.

### Built-in Tool 4: `generate_pptx` — Generate a PowerPoint Presentation

Generates a PPTX file from markdown content using the existing ppt-rs export pipeline.

```typescript
{
  name: 'generate_pptx',
  description: 'Generate a PowerPoint presentation from the currently active document or from provided markdown content. If no template is specified, ask the user which template they prefer before calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      template: {
        type: 'string',
        description: 'Template name: "simple", "business", "report", or a custom template name.',
      },
      output_path: {
        type: 'string',
        description: 'Absolute path for the output .pptx file. If omitted, saves next to the source document with .pptx extension.',
      },
      markdown: {
        type: 'string',
        description: 'Optional markdown content. If omitted, uses the currently active document.',
      },
    },
  },
}
```

**Execution flow:**

1. Read markdown from the active document (or use provided `markdown`)
2. Determine template: use specified template, or if none specified, return an error asking the agent to ask the user
3. Call `invoke('export_pptx', { markdown, title, template })` to generate PPTX bytes
4. Determine output path: use specified path, or derive from source filename (e.g., `document.md` → `document.pptx`)
5. Call `invoke('save_binary_file', { path, data })` to write to disk
6. Return: "Presentation saved to {path} using {template} template"

**Template discovery:** The tool can also list available templates via `invoke('list_pptx_templates', { projectRoot })` so the agent can present options to the user.

**Permission:** Requires user approval (writes file to disk).

### Skill 1: insert-drawing (knowledge-only, insert-chart pattern)

The agent uses existing `write_file` and `read_file` tools to create Excalidraw drawings. No new built-in tool needed.

**Agent workflow (taught by SKILL.md):**

1. Generate a unique ID (e.g., via `uuidgen` in a description, or a random string)
2. Create `.notesage/drawings/` directory via `write_file` if needed
3. Write Excalidraw scene JSON to `.notesage/drawings/{id}.excalidraw` via `write_file`
4. Insert `<div data-drawing-id="{id}" data-type="drawing" class="drawing-block"></div>` into the document markdown via `write_file`
5. The file watcher picks up the change, the editor renders the drawing block

**SVG preview:** Not generated at insertion time. The SVG preview (used for PDF/DOCX/HTML exports) is created when the user first opens the drawing in the Excalidraw canvas and closes it. This matches the existing user-created drawing flow. An optional `scripts/render-svg.mjs` script can be provided in the skill for agents that want to generate the SVG immediately.

**Bundled skill:** `bundled-skills/insert-drawing/` with:

- `SKILL.md` — step-by-step workflow, tips for layout, when to use Excalidraw vs Mermaid
- `references/EXCALIDRAW-SCHEMA.md` — element format (rectangle, ellipse, diamond, arrow, text, line), required fields, coordinate system
- `references/EXAMPLES.md` — complete working examples (flowchart, architecture diagram, process flow)

### Skill 2: insert-diagram (knowledge-only + render script)

The agent uses existing `write_file`, `read_file`, and `execute_skill_script` tools to create Mermaid diagrams.

**Agent workflow (taught by SKILL.md):**

1. Generate a unique ID
2. Create `.notesage/diagrams/` directory if needed
3. Write Mermaid source to `.notesage/diagrams/{id}.mmd` via `write_file`
4. Call `execute_skill_script` with the `render-mermaid.mjs` script to render `.mmd` → `.svg`
5. Insert `![diagram](/.notesage/diagrams/{id}.svg)` into the document markdown via `write_file`
6. File watcher picks up changes, editor renders the SVG image

**Mermaid rendering:** A bundled Node.js script (`scripts/render-mermaid.mjs`) handles Mermaid → SVG conversion. This keeps the Mermaid dependency out of the main app bundle.

**Storage:**

```
<projectRoot>/.notesage/diagrams/{id}.mmd   (Mermaid source — for future re-editing)
<projectRoot>/.notesage/diagrams/{id}.svg   (Rendered SVG — displayed in editor)
```

**Bundled skill:** `bundled-skills/insert-diagram/` with:

- `SKILL.md` — instructions on Mermaid syntax, diagram types, when to use Mermaid vs Excalidraw
- `references/MERMAID-SYNTAX.md` — syntax reference for supported diagram types
- `references/EXAMPLES.md` — complete working examples
- `scripts/render-mermaid.mjs` — Node.js script to render Mermaid → SVG

### Editor State Access

The comment tools need access to the active editor and document state. Currently, the tool executor has no reference to the editor. We need a lightweight bridge:

**New module:** `src/lib/editor-bridge.ts`

```typescript
let editorRef: Editor | null = null;

export function setEditorRef(editor: Editor | null) { editorRef = editor; }
export function getEditorRef(): Editor | null { return editorRef; }
```

Called from `Editor.tsx` when the editor mounts/unmounts. The tool executor imports `getEditorRef()` to access ProseMirror state for comment positioning.

### Comment Fixing Workflow (G2)

The "fix comments" workflow doesn't need its own tool — it's a composition of existing tools:

1. Agent calls `list_comments` to read all open comments
2. Agent calls `read_file` to read the document
3. Agent calls `write_file` to modify the document, addressing each comment
4. Agent calls `resolve_comments` to mark addressed comments as resolved

The bundled skill (`bundled-skills/review-document/`) teaches the agent this workflow pattern in its `SKILL.md`.

### Skill 3: generate-presentation (knowledge-only)

Teaches the agent how to use the `generate_pptx` built-in tool effectively.

**Bundled skill:** `bundled-skills/generate-presentation/` with:

- `SKILL.md` — instructions on how to structure content for slides, template descriptions, tips, the requirement to ask for template preference
- `references/TEMPLATES.md` — description of each built-in template and their visual characteristics

## UI/UX

### No New UI Components

All four capabilities operate through the existing chat panel. The agent uses existing tools and the results are visible in the existing editor (comment decorations, drawing blocks, images) or as files on disk (PPTX).

### Chat Interaction Patterns

**Document review:**

```
User: Review this document for clarity
Agent: I'll review the document and leave inline comments.
       [calls read_file to get content]
       [calls add_comments with findings]
       I've added 5 comments to your document highlighting areas for improvement.
```

**Comment fixing:**

```
User: Fix the comments in this document
Agent: Let me check the existing comments.
       [calls list_comments]
       [calls read_file]
       [calls write_file with fixes]
       [calls resolve_comments]
       I've addressed 3 comments and resolved them.
```

**Drawing insertion:**

```
User: Add a flowchart showing the user signup process
Agent: I'll create a flowchart for the signup flow.
       [calls insert_drawing or insert_mermaid]
       I've added a flowchart after the "User Signup" heading.
```

**Presentation generation:**

```
User: Create a PowerPoint from this document
Agent: Which template would you like? Available options:
       - Simple — clean, minimal
       - Business — professional with header lines
       - Report — title page, headers/footers
User: Business
Agent: [calls generate_pptx with template: "business"]
       Presentation saved to /path/to/document.pptx using the Business template.
```

### Tool Call Segments

All tool calls render in the chronological message segments as compact inline entries (matching existing tool call UX):

- "Adding 5 comments to document.md"
- "Reading 3 existing comments"
- "Inserting flowchart drawing"
- "Generating presentation (Business template)"

## Data Model

### New Built-in Tools

Added to `BUILT_IN_TOOLS` in `src/stores/skill-store.ts`:

| Tool | Permission | Category |
| --- | --- | --- |
| `add_comments` | Requires approval | Write |
| `list_comments` | Auto-allowed | Read |
| `resolve_comments` | Requires approval | Write |
| `generate_pptx` | Requires approval | Write |

Drawing and diagram insertion use the existing `write_file`, `read_file`, and `execute_skill_script` tools — no new built-in tools needed (same pattern as `insert-chart`).

### New Bundled Skills

| Skill | Directory | Type | Purpose |
| --- | --- | --- | --- |
| `review-document` | `bundled-skills/review-document/` | Knowledge-only | Document review + comment fixing workflow instructions |
| `insert-drawing` | `bundled-skills/insert-drawing/` | Knowledge-only | Excalidraw drawing generation (insert-chart pattern) |
| `insert-diagram` | `bundled-skills/insert-diagram/` | Knowledge + script | Mermaid diagram generation with render script |
| `generate-presentation` | `bundled-skills/generate-presentation/` | Knowledge-only | PPTX generation instructions + template reference |

### New Storage Paths

```
<projectRoot>/.notesage/diagrams/{id}.mmd   # Mermaid source
<projectRoot>/.notesage/diagrams/{id}.svg   # Rendered SVG
```

Drawings continue to use the existing `.notesage/drawings/` path. Charts continue to use `.notesage/charts/`.

### Editor Bridge

New file `src/lib/editor-bridge.ts` — module-level editor ref for tool executor access to ProseMirror state (needed by comment tools only).

## Dependencies

| Dependency | Purpose | Where |
| --- | --- | --- |
| `mermaid` | Mermaid → SVG rendering | Bundled skill script (Node.js), not in main `package.json` |

The Mermaid dependency is a **runtime dependency of the skill script only**. It is installed in the skill's `scripts/` directory or resolved via the system's Node.js.

Excalidraw drawings do not require a rendering dependency — SVG preview is generated when the user opens the drawing in the canvas (existing behavior). An optional `@excalidraw/utils` render script can be added later if SVG-at-insertion-time is needed.

## Quality Gates

### Functional

- [x] Agent can review a document and leave inline comments visible in the editor

- [x] Comments created by the agent have correct anchor positions matching the specified text

- [x] Agent can read existing comments via `list_comments` with accurate content and status

- [x] Agent can fix document issues described in comments and resolve them

- [x] Resolved comments show the correct decoration style (resolved state)

- [x] Agent can generate and insert an Excalidraw drawing into a document

- [x] Inserted drawings are editable in the Excalidraw canvas

- [ ] Agent can generate and insert a Mermaid diagram (flowchart, sequence, class, state)

- [x] Mermaid diagrams render as SVG images in the editor

- [ ] Agent can generate a PPTX from the active document

- [ ] Agent asks for template preference when not specified

- [ ] Generated PPTX matches the selected template style

- [ ] Built-in tools respect the permission model (list_comments auto-allowed, others require approval)

- [x] Drawing and diagram skills work via existing write_file/execute_skill_script tools (no new built-in tools)

- [ ] Tool calls appear correctly in chronological message segments

- [x] All tools work with both direct API and ACP agent paths

### Testing

- [x] Unit tests for anchor text matching in ProseMirror documents

- [x] Unit tests for comment batch insertion

- [x] Unit tests for comment listing and resolution

- [x] Unit tests for PPTX generation via tool

- [ ] Mermaid rendering script produces valid SVG

- [x] Excalidraw scene → SVG conversion works

- [x] Round-trip: inserted drawings survive save/reload

- [x] Round-trip: inserted Mermaid diagrams survive save/reload

### Design

- [ ] Agent-created comments are visually identical to user-created comments

- [ ] Drawing and diagram insertions look polished in both light and dark mode

- [ ] No new UI chrome — everything works through the existing chat panel

## Out of Scope

- **Mermaid editor/canvas** — Mermaid diagrams are static SVG images; no interactive editing canvas
- **Agent-initiated edits without comments** — The agent can only modify the document to fix existing comments, not rewrite arbitrary sections
- **Image generation** — The agent creates diagrams (shapes + arrows + text), not raster images or photos
- **PPTX template design** — The agent uses existing templates, it cannot create or modify template files
- **Real-time preview** — No live preview of diagrams before insertion; the agent inserts and the user can edit/delete
- **Collaborative review** — Single-agent review only, no multi-agent review coordination