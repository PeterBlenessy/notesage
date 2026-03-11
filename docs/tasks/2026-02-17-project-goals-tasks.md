# Task Breakdown: Project Goals

**Status:** ✅ Complete

**PRD:** `docs/prds/2026-02-17-project-goals.md`**Date:** 2026-02-17

---

## Summary

**14 tasks: 3S, 7M, 4L — All complete**

Three distinct layers of work:

1. **Prerequisites** (#1–#5): Rename `.note-sage` → `.notesage`, add frontmatter support in the editor
2. **Templates & scaffolding** (#6–#10): Goal/project templates, New Project dialog, "Add Goal" context menu
3. **AI integration** (#11–#14): Goals discovery, context injection, chat placeholder, verification

Tasks are ordered so each builds on the previous. The frontmatter work (#2–#5) is the most complex — it touches the editor's core read/write pipeline.

### Risks

- **Frontmatter round-trip** — Must not corrupt existing files. Needs careful testing with files that have no frontmatter, valid frontmatter, and edge cases (e.g., `---` in document content).
- **Rename migration** — Existing projects with `.note-sage` must be migrated silently. If migration fails (permissions, etc.), the app should still function.

---

## Tasks

### #1 ✅ — Rename `.note-sage` to `.notesage` across codebase

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | None |
| **Files** | `src/hooks/useProjectMetadata.ts`, `src/App.tsx`, `src/components/sidebar/FileTreeItem.tsx`, `docs/architecture.md`, `docs/future-phases.md`, `docs/phase-1-spec.md`, `CLAUDE.md`, `docs/prds/*.md`, `docs/history/002-phase1-complete.md` |

**Description:**

Rename all references from `.note-sage` to `.notesage`:

- Change the `METADATA_DIR` constant in `useProjectMetadata.ts` from `'.note-sage'` to `'.notesage'`
- Update 3 locations in `App.tsx` that bootstrap or detect `.note-sage/`
- Update `FileTreeItem.tsx` project detection logic (checks for `.note-sage/` child)
- Update all documentation files (architecture.md, future-phases.md, phase-1-spec.md, CLAUDE.md, history, PRDs)

Add migration logic in `useProjectMetadata.ts`: when loading a project, if `.note-sage` exists but `.notesage` does not, call `tauriApi.renamePath('.note-sage', '.notesage')` before proceeding. If both exist, prefer `.notesage`. Log a warning on migration failure but don't block.

**Acceptance criteria:**

- No references to `.note-sage` remain in code (docs may mention it historically)
- Existing projects with `.note-sage` are auto-migrated on load
- New projects create `.notesage/`

---

### #2 ✅ — Install YAML parser and create frontmatter utility

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `package.json`, `src/lib/frontmatter.ts` |

**Description:**

Install the `yaml` npm package. Create `src/lib/frontmatter.ts` with:

```typescript
interface Frontmatter { [key: string]: unknown }

function parseFrontmatter(raw: string): { frontmatter: Frontmatter | null; content: string }
function serializeFrontmatter(frontmatter: Frontmatter | null, content: string): string
```

- `parseFrontmatter`: Splits content at the first `---\n...\n---` block. Parses YAML between delimiters. Returns `{ frontmatter, content }` where content is everything after the closing `---`. Returns `{ frontmatter: null, content: raw }` if no frontmatter found.
- `serializeFrontmatter`: If frontmatter is non-null, serializes to `---\n{yaml}\n---\n\n{content}`. If null, returns content unchanged.

Handle edge cases: no frontmatter, empty frontmatter (`---\n---`), `---` appearing in document body (only the first occurrence at the start of the file counts).

Export `Frontmatter`, `GoalFrontmatter`, `NoteFrontmatter` types.

**Acceptance criteria:**

- Round-trip: `serializeFrontmatter(parseFrontmatter(input))` produces identical output for files with and without frontmatter
- YAML parsing handles strings, numbers, booleans, arrays, objects

---

### #3 ✅ — Add frontmatter to editor store and file operations pipeline

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Depends on #2 |
| **Files** | `src/stores/editor-store.ts`, `src/hooks/useFileOperations.ts`, `src/lib/markdown.ts` |

**Description:**

Extend the `Tab` interface in `editor-store.ts` with `frontmatter: Frontmatter | null`. Default to `null` for new tabs.

Add `setFrontmatter(tabId: string, frontmatter: Frontmatter | null)` and `updateFrontmatter(tabId: string, updates: Partial<Frontmatter>)` actions to the editor store.

Modify the file open/save pipeline:

**On open** (in `useFileOperations.openFile`):

1. Read file content via `tauriApi.readFile()`
2. Call `parseFrontmatter(content)` to split frontmatter from markdown
3. Pass only the markdown content to `openTab()`
4. Store the frontmatter via `setFrontmatter()`

**On save** (in `useFileOperations.saveFile` and auto-save):

1. Serialize editor content to markdown
2. Get frontmatter from tab state
3. Call `serializeFrontmatter(frontmatter, markdown)` to combine
4. Write combined string via `tauriApi.writeFile()`

**Acceptance criteria:**

- Open a file with frontmatter → frontmatter is preserved on save
- Open a file without frontmatter → no frontmatter added on save
- Edit content of a file with frontmatter → frontmatter untouched, content updated
- Frontmatter stored per-tab, not globally

---

### #4 ✅ — Build frontmatter indicator and editor UI

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Depends on #3 |
| **Files** | `src/components/editor/FrontmatterBlock.tsx` (new), `src/components/editor/Editor.tsx` or `src/components/editor/EditorContent.tsx` |

**Description:**

Create `FrontmatterBlock.tsx` — a component that renders above the editor content area:

**Collapsed state (default):**

- Small pill/badge (e.g., `{ }` or `Frontmatter` text) in `text-xs text-muted-foreground`
- Positioned at the top of the editor area, left-aligned
- `transition-all duration-150` on hover
- Click expands to the full block
- Hidden entirely when `frontmatter` is `null`

**Expanded state:**

- Styled container with subtle background (`bg-muted/50`), rounded corners, border
- Key-value fields rendered as rows: label (`text-xs text-muted-foreground`) + editable input
- Fields are derived from the frontmatter object keys
- Editing a field calls `updateFrontmatter()` on the editor store (marks tab dirty)
- Collapse button (chevron or `X`)
- Smooth height transition on expand/collapse

Follow the design system: no chromatic colors, `transition-all duration-150`, proper spacing.

Mount this component above the Tiptap editor content in `Editor.tsx` or `EditorContent.tsx`.

**Acceptance criteria:**

- Pill visible when file has frontmatter, hidden when not
- Click expands to show all fields
- Editing a field updates the store and marks the tab dirty
- Saving writes the updated frontmatter
- Smooth expand/collapse animation
- Looks polished in both light and dark mode

---

### #5 ✅ — Frontmatter round-trip tests

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Depends on #2 |
| **Files** | `src/lib/__tests__/frontmatter.test.ts` (new) |

**Description:**

Write unit tests for `parseFrontmatter` and `serializeFrontmatter`:

- File with valid frontmatter: parse extracts YAML, content is remainder
- File without frontmatter: parse returns null, content is full file
- Empty frontmatter (`---\n---`): parse returns empty object
- Frontmatter with all types: strings, numbers, booleans, arrays
- `---` in document body (not at start): not treated as frontmatter
- Round-trip: parse then serialize produces identical output
- Serialize with null frontmatter: returns content unchanged
- Goal-specific frontmatter: `type: goal` with template, created, title

**Acceptance criteria:**

- All tests pass
- Edge cases covered

---

### #6 ✅ — Create goal template definitions

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #2 |
| **Files** | `src/lib/goal-templates.ts` (new) |

**Description:**

Create `src/lib/goal-templates.ts` with the `GoalTemplate` interface and 4 bundled templates:

1. **OKR** (`id: "okr"`) — Markdown with H1 title, 2-3 objective sections, each with key results as task list items, placeholder text
2. **Simple Checklist** (`id: "checklist"`) — H1 title, flat task list with placeholder items
3. **SMART Goals** (`id: "smart"`) — H1 title, sections for Specific/Measurable/Achievable/Relevant/Time-bound with prompts
4. **Milestone Tracker** (`id: "milestones"`) — H1 title, phase sections with status markers and task lists

Each template's `content` string includes frontmatter with `type: goal`, `template: {id}`, `created: {date}` (placeholder to be filled at creation time), and `title: {template name}`.

Export `GOAL_TEMPLATES` array and `GoalTemplate` interface.

**Acceptance criteria:**

- 4 templates with meaningful, well-formatted markdown content
- Each template includes frontmatter header
- Placeholder text is clear and helpful

---

### #7 ✅ — Create project template definitions

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Depends on #6 |
| **Files** | `src/lib/project-templates.ts` (new) |

**Description:**

Create `src/lib/project-templates.ts` with the `ProjectTemplate` interface and 4 bundled templates:

1. **Default** (`id: "default"`) — `folders: []`, `goalTemplate: "checklist"`, `goalFilename: "project-goals.md"`
2. **Research** (`id: "research"`) — `folders: ["goals", "notes", "research", "documents"]`, `goalTemplate: "okr"`, `goalFilename: "goals/project-goals.md"`
3. **Writing** (`id: "writing"`) — `folders: ["notes", "drafts"]`, `goalTemplate: "milestones"`, `goalFilename: "project-goals.md"`
4. **Blank** (`id: "blank"`) — `folders: []`, `goalTemplate: null`, `goalFilename: ""`

Export `PROJECT_TEMPLATES` array and `ProjectTemplate` interface.

**Acceptance criteria:**

- 4 templates with correct folder/goal configuration
- Blank template creates nothing extra

---

### #8 ✅ — Update New Project dialog with template picker

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Depends on #1, #6, #7 |
| **Files** | `src/components/NewProjectDialog.tsx` |

**Description:**

Extend `NewProjectDialog` with a project template selector:

**UI changes:**

- Below the location picker, add a template selector
- Show templates as selectable cards/radio items: name, description, folder preview
- "Default" pre-selected
- Each card shows a brief preview of what gets created (e.g., "Creates: project-goals.md" or "Creates: goals/, notes/, research/, documents/ + goals/project-goals.md")

**Creation logic changes**:After creating the project directory and `.notesage/`:

1. Create folders from the selected template's `folders` array
2. If `goalTemplate` is non-null:
   - Get the goal template content from `GOAL_TEMPLATES`
   - Replace the `created` frontmatter placeholder with today's date
   - Create the goals file at `goalFilename` path
3. Refresh the file tree

Follow existing patterns in the dialog (shadcn/ui `Dialog`, `Input`, `Button`). Use `RadioGroup` or custom card selection for templates.

**Acceptance criteria:**

- Template selector visible in New Project dialog
- Creating with "Research" template scaffolds 4 folders + goals file
- Creating with "Blank" template creates only the project directory + `.notesage/`
- Goals file has correct frontmatter
- File tree refreshes to show new files/folders

---

### #9 ✅ — Build goal template picker dialog

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #6 |
| **Files** | `src/components/goals/GoalTemplateDialog.tsx` (new) |

**Description:**

Create a dialog for adding goal files to existing projects:

**UI:**

- shadcn/ui `Dialog`, max-width 480px
- Template cards in a vertical list (name, description, radio selection)
- Filename input pre-filled from template (e.g., "project-goals")
- Location toggle: "Project root" or "goals/ folder" (creates `goals/` if needed)
- "Create" button, disabled until template selected and filename non-empty

**Logic:**

- On create: build the goal template content with today's date in frontmatter
- Determine full path based on location toggle
- Create the file via `tauriApi.createFile()` then `tauriApi.writeFile()`
- Open the file in the editor via `useFileOperations.openFile()`
- Refresh file tree
- Close dialog

**Acceptance criteria:**

- Dialog shows all 4 templates
- File created with correct frontmatter and template content
- File opens in editor after creation
- "goals/" folder auto-created if needed

---

### #10 ✅ — Add "New Goals File..." to project context menu

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Depends on #9 |
| **Files** | `src/components/sidebar/ProjectItem.tsx` |

**Description:**

Add a "New Goals File..." item to the project root context menu in `ProjectItem.tsx`:

- Position it after "Project Settings" and before git items
- Uses `Target` icon from lucide-react
- Click opens the `GoalTemplateDialog` with the project path
- Add state for dialog open/close

Wire up the `GoalTemplateDialog` with the project path and file tree refresh callback.

**Acceptance criteria:**

- "New Goals File..." appears in project context menu
- Clicking opens the goal template picker
- Creating a goal from the picker works end-to-end

---

### #11 ✅ — Goals discovery hook

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #2, #3 |
| **Files** | `src/hooks/useGoalsDiscovery.ts` (new) |

**Description:**

Create a hook that scans a project for goals files (files with `type: goal` frontmatter):

```typescript
function useGoalsDiscovery(projectPath: string): {
  goalFiles: { path: string; name: string; content: string }[];
  isLoading: boolean;
  refresh: () => void;
}
```

**Logic:**

1. Use `tauriApi.listDirectory(projectPath)` to get files
2. For each `.md` file in root and first-level subdirectories: read the first \~200 bytes to check for frontmatter (optimization — don't read entire large files just for detection)
3. Parse frontmatter, filter for `type: goal`
4. Cache results in a ref or lightweight store
5. Re-scan on `refresh()` call
6. Debounce to avoid excessive scanning

The hook should be called from the project context where AI operations happen.

**Acceptance criteria:**

- Discovers goals files in project root and first-level subdirectories
- Caches results, doesn't re-scan on every render
- `refresh()` forces re-scan
- Returns empty array for projects with no goals

---

### #12 ✅ — Inject goals into AI chat context

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #11 |
| **Files** | `src/hooks/useAIOperations.ts` |

**Description:**

Modify `useAIOperations.ts` to include goals content in the AI system prompt:

1. Use `useGoalsDiscovery` (or call it from the component that uses `useAIOperations`) to get goals files for the active project
2. When composing `composedSystemMessage`, append goals content after `projectContext`:

```
{projectContext}

Project goals:
--- project-goals.md ---
{content}
--- q1-okrs.md ---
{content}
```

3. Only append if goals files exist (no empty "Project goals:" section)
4. Refresh goals cache after file save operations

Follow the existing pattern where `projectContext` is read from `project-metadata-store`.

**Acceptance criteria:**

- AI chat receives goals content in system prompt
- Works with 0, 1, or multiple goals files
- No errors when no goals exist
- Goals content updates when goals file is saved

---

### #13 ✅ — Update chat placeholder when goals exist

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Depends on #11 |
| **Files** | `src/components/chat/ChatInput.tsx` |

**Description:**

Make the chat input placeholder dynamic:

- If the active project has goals files (from `useGoalsDiscovery` or a simple check on the goals cache), show: "Ask about your goals, or type a message..."
- Otherwise, keep the current "Ask anything..." placeholder

This requires either passing the goals state down as a prop or accessing it from a store.

**Acceptance criteria:**

- Placeholder changes when project has goals
- Placeholder is default when no goals exist
- No flickering on initial load

---

### #14 ✅ — End-to-end verification

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | Depends on all previous tasks |
| **Files** | None (testing/verification) |

**Description:**

Verify the full flow against the PRD quality gates:

 1. Create a new project with "Research" template → verify folders + goals file created with correct frontmatter
 2. Open the goals file → verify frontmatter indicator visible, content renders in editor
 3. Edit and save → verify frontmatter preserved
 4. Expand frontmatter → verify fields editable
 5. Add a second goals file via context menu → verify creation works
 6. Open AI chat → verify placeholder mentions goals
 7. Send a message → verify AI response is aware of goals (check system prompt includes goals content)
 8. Create a "Blank" project → verify no goals or extra folders
 9. Open an existing project with `.note-sage` → verify migration to `.notesage`
10. Open a regular `.md` file without frontmatter → verify no indicator, no frontmatter added on save
11. Light and dark mode check on all new UI

**Acceptance criteria:**

- All PRD quality gates pass
- No console errors during normal operation
- TypeScript compiles cleanly (`tsc --noEmit`)