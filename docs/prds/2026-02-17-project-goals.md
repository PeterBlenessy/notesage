# PRD: Project Goals

**Date:** 2026-02-17 **Phase:** 3 (Project Workspace) **Status:** Draft

---

## Problem

Notesage projects have names, descriptions, and AI context, but no way to capture what the user is actually trying to accomplish. Users track objectives in their heads or in ad-hoc notes with no structure. Without explicit goals, the AI chat has no awareness of what matters to the user — it can only react to what's in front of it, not proactively help the user make progress.

## Prerequisites

### Rename `.note-sage` to `.notesage`

The hidden metadata directory must be renamed from `.note-sage` to `.notesage` across the entire codebase before goals work begins. The `.notesage` folder is for application-internal config only — user-facing content (goals, notes, documents) lives in the project root or user-chosen folders.

**Scope of rename:**

- All references in Rust backend (`src-tauri/src/commands/`)
- All references in frontend (`src/hooks/useProjectMetadata.ts`, `src/components/`, `src/stores/`)
- `NewProjectDialog` scaffolding logic
- `docs/` references (architecture.md, future-phases.md, CLAUDE.md, PRDs)
- Migration: on project load, if `.note-sage` exists but `.notesage` does not, rename automatically

### Frontmatter support in the editor

All markdown files must support YAML frontmatter. This is a general capability, not specific to goals — any `.md` file can have frontmatter and the editor must preserve it on round-trip.

**Scope:**

- Parse frontmatter on file open (extract YAML between `---` delimiters)
- Preserve frontmatter on save (serialize back to `---` block before document content)
- Editor UI: frontmatter is hidden by default, but a small indicator (e.g., a `{ }` badge or pill) at the top of the editor signals its presence. Clicking the indicator expands/collapses a styled frontmatter block showing the key-value fields.
- Frontmatter fields are editable inline when the block is expanded
- Files without frontmatter show no indicator

**Implementation approach:**

- Store frontmatter separately from the ProseMirror document (frontmatter is not a ProseMirror node — it's metadata alongside the document)
- On file open: split content at the first `---...---` block, parse YAML, pass remaining content to Tiptap
- On save: serialize YAML frontmatter + `\n---\n\n` + serialized ProseMirror content
- Use a lightweight YAML parser (e.g., `yaml` npm package or `js-yaml`)
- Frontmatter state lives in the editor store per-tab (each open file has its own frontmatter object)

**Standard frontmatter fields for goals files:**

```yaml
---
type: goal
template: okr
created: 2026-02-17
title: Q1 OKRs
---
```

**Standard frontmatter fields for notes:**

```yaml
---
type: note
created: 2026-02-17
title: Meeting Notes
tags: []
---
```

The `type` field is what the application uses to identify goals files (instead of tracking paths in `project.json`). This is more robust — if a user renames or moves a file, the frontmatter travels with it.

## Goals / Non-Goals

### Goals

1. **Goals as user-visible markdown** — Goals live as `.md` files in the project root or a `goals/` folder, visible alongside other project files — not hidden in `.notesage`
2. **Template-based creation** — Users pick from bundled templates (OKR, simple checklist, SMART goals, etc.) when creating a project or adding goals later
3. **Auto-scaffold on project creation** — The New Project dialog includes an optional goal template picker; the selected template creates a `project-goals.md` in the project root
4. **AI context injection** — Goals file contents are automatically included as context when chatting with the AI about the project
5. **AI suggestions** — AI can suggest next steps, surface relevant notes, or highlight progress based on goals
6. **Project folder conventions** — Templates can define initial folder structure (e.g., `goals/`, `notes/`, `research/`, `documents/`), laying groundwork for the future workflows feature

### Non-Goals

- Custom template editor UI (users can manually edit template files, but no UI for creating templates from scratch)
- Due date reminders or notifications
- Progress percentage calculations (the markdown content is the source of truth — users check boxes and update text themselves)
- Cross-project goal aggregation or dashboard
- Goal history or versioning beyond what git provides
- Full workflow engine (Phase 5 — but folder conventions established here)

## User Stories

1. **As a user**, I want to pick a goal template when creating a new project, so that my project starts with a structured goals file.
2. **As a user**, I want my goals file to be visible in the project file tree like any other file, so that I can find and edit it easily.
3. **As a user**, I want to add more goals files later from the sidebar, so that I can organize objectives by category (e.g., Q1 OKRs, research plan).
4. **As a user**, I want the AI to know about my goals when I ask it questions, so that its suggestions are aligned with what I'm working toward.
5. **As a user**, I want to ask the AI "what should I work on next?" and get suggestions based on my goals, so that I stay focused.
6. **As a user**, I want to edit my goals in the same WYSIWYG editor as my notes, so that I don't have to learn a separate interface.

## Technical Approach

### Goals storage

Goals are regular markdown files that live in the project root or in subfolders. They are not hidden inside `.notesage`. A simple goals setup is a single `project-goals.md` in the root. More complex setups can have a `goals/` folder with multiple files.

```
my-project/
├── .notesage/              # App-internal config only
│   └── project.json
├── project-goals.md        # Simple: single goals file in root
├── goals/                  # Or: dedicated goals folder
│   ├── q1-okrs.md
│   └── research-plan.md
├── notes/
├── research/
├── documents/
└── ...
```

Goals files are identified by their frontmatter `type: goal` field, not by their location or a list in `project.json`. This means:

- A user can rename or move a goals file and it stays a goals file
- The AI context loader scans project files for `type: goal` frontmatter
- No need to maintain a separate registry of goals paths

**Discovery strategy for AI context:**

On project load, scan `.md` files in the project for frontmatter with `type: goal`. Cache the results. Re-scan when files are created, renamed, or deleted. For performance, limit the scan to the project root and first-level subdirectories (not deep recursive).

No new Tauri commands needed — goals files are read/written using the existing `read_file`, `write_file`, `create_file`, `list_directory`, and `delete_path` commands.

### Project templates

Bundled project templates define the initial structure for new projects. Each template specifies which folders to create and which goal template to use.

```typescript
interface ProjectTemplate {
  id: string;              // e.g., "default", "research", "writing"
  name: string;            // e.g., "Default Project"
  description: string;     // Short explanation
  folders: string[];       // Folders to create, e.g., ["notes", "research"]
  goalTemplate: string | null;  // Goal template ID to use, or null for no goals
}
```

**Bundled project templates:**

- **Default** — No extra folders, creates `project-goals.md` from Simple Checklist template
- **Research** — Creates `goals/`, `notes/`, `research/`, `documents/` folders with OKR goals
- **Writing** — Creates `notes/`, `drafts/` folders with Milestone Tracker goals
- **Blank** — No folders, no goals file

### Goal templates

Bundled goal templates are static markdown strings defined in `src/lib/goal-templates.ts`:

```typescript
interface GoalTemplate {
  id: string;          // e.g., "okr"
  name: string;        // e.g., "OKR (Objectives & Key Results)"
  description: string; // Short explanation of the format
  content: string;     // Markdown template content with placeholders
}
```

**Bundled goal templates:**

- **OKR** — Objectives with measurable key results and task checkboxes
- **Simple Checklist** — Flat list of goals with checkboxes
- **SMART Goals** — Specific, Measurable, Achievable, Relevant, Time-bound format
- **Milestone Tracker** — Phase-based goals with status markers

Templates use light placeholder text (e.g., `[Describe your objective]`) that the user replaces. The file is created pre-filled and opened immediately in the editor.

### New Project dialog changes

The existing `NewProjectDialog` is extended with an optional step:

1. User enters project name and location (existing flow)
2. **New:** User selects a project template (Default, Research, Writing, Blank)
3. The template preview shows which folders and goal file will be created
4. On create: scaffold folders, create goals file from template, write `project.json` with goals paths

### Sidebar integration — adding goals later

Users can add goals files to existing projects from the sidebar:

- Right-click on a project root → "New Goals File..." opens the goal template picker
- The picker lets the user choose a template and a filename/location (root or `goals/` folder)
- File is created with `type: goal` frontmatter
- File opens immediately in the editor

Goals files appear in the normal file tree like any other file. No separate "Goals" sidebar section needed — they're just files. The frontmatter `type: goal` field is what the app uses internally to identify them for AI context injection.

### AI context injection

When the user chats with the AI in a project context, goals file contents are included in the system message. This extends the existing project context mechanism in `useAIOperations.ts`.

**Logic:**

1. On project load, scan project files for frontmatter with `type: goal`
2. Load each goals file's content and cache it in the project metadata store
3. Refresh the cache when files are created, saved, renamed, or deleted
4. When building the AI chat system prompt, append goals after the existing project context:

```
Project: {name}
Description: {description}
Project context: {projectContext}

Project goals:
--- project-goals.md ---
{goals file content}
```

5. This gives the AI full awareness of what the user is working toward

### AI suggestions

The AI can suggest next steps based on goals through two mechanisms:

1. **Chat-based** — The user can ask "What should I work on next?" or "How am I progressing on my goals?" and the AI uses the injected goals context to provide relevant suggestions.

2. **Proactive nudge** — When the user opens the chat panel for a project, if goals exist, include a subtle hint in the chat placeholder text: e.g., "Ask about your goals, or type a message..." This is a lightweight prompt, not an automatic AI call.

No new AI commands needed — the existing `ai_chat` command handles this through the enriched system prompt.

### Goal template picker dialog

A small dialog for adding goals to existing projects:

1. User right-clicks project → "New Goals File..."
2. Dialog shows available goal templates as selectable cards
3. User picks a template and optionally edits the filename and location
4. File is created with `type: goal` frontmatter and template content
5. File opens immediately in the editor

## UI/UX

### New Project dialog (updated)

- Existing fields: project name, location
- **New:** Project template selector below location picker
  - Horizontal cards or radio list showing template options (Default, Research, Writing, Blank)
  - Each shows name, short description, and folder/file preview
  - Default template is pre-selected
- No additional complexity — one click to select, then "Create"

### Goal template picker dialog

- Uses shadcn/ui `Dialog`, max-width 480px
- Template cards in a vertical list, each with:
  - Template name (text-sm font-medium)
  - Short description (text-xs text-muted-foreground)
  - Radio-style selection (highlight border on selected)
- Filename input (pre-filled from template, e.g., "project-goals")
- Location toggle: "Project root" or "goals/ folder"
- "Create" button, disabled until a template is selected
- Smooth open/close animation per design system

### File tree

Goals files appear in the normal file tree. No special icons or sections — they're regular `.md` files. The only distinction is in `project.json` metadata (for AI context).

### Chat panel hints

- When a project has goals files, the chat input placeholder changes to: "Ask about your goals, or type a message..."
- No other visible changes to the chat UI

## Data Model

### Goal templates (`src/lib/goal-templates.ts`)

```typescript
interface GoalTemplate {
  id: string;
  name: string;
  description: string;
  content: string;  // Markdown with placeholders
}
```

### Project templates (`src/lib/project-templates.ts`)

```typescript
interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  folders: string[];
  goalTemplate: string | null;  // References GoalTemplate.id
  goalFilename: string;         // e.g., "project-goals.md"
}
```

### Frontmatter types (`src/lib/frontmatter.ts`)

```typescript
interface Frontmatter {
  [key: string]: unknown;
}

interface GoalFrontmatter extends Frontmatter {
  type: 'goal';
  template: string;      // Template ID used to create this file
  created: string;       // ISO date string
  title: string;
}

interface NoteFrontmatter extends Frontmatter {
  type: 'note';
  created: string;
  title: string;
  tags: string[];
}
```

### Editor store extension

Each open tab tracks its own frontmatter:

```typescript
// In editor-store.ts, extend the tab state
interface TabState {
  // ...existing fields
  frontmatter: Frontmatter | null;  // Parsed YAML frontmatter, null if none
}
```

### Goals cache (runtime only, not persisted)

```typescript
// In project-metadata-store.ts or a dedicated hook
interface GoalsCache {
  files: { path: string; name: string; content: string }[];
  lastScanned: number;
}
```

### No new Tauri commands

All file operations use existing commands (`read_file`, `write_file`, `create_file`, `create_directory`, `list_directory`, `delete_path`).

### New dependency

```bash
pnpm add yaml  # Lightweight YAML parser for frontmatter
```

## Dependencies

- `yaml` npm package — lightweight YAML parser/serializer for frontmatter
- shadcn/ui `Dialog`, `Button`, `Input`, `RadioGroup` for template pickers
- Existing file operation hooks and Tauri commands
- Existing AI chat context mechanism

## Quality Gates

### Functional

- [ ] `.note-sage` renamed to `.notesage` across entire codebase

- [ ] Migration: existing projects with `.note-sage` are auto-renamed on load

- [ ] Frontmatter parsed on file open and preserved on save (round-trip)

- [ ] Frontmatter indicator visible at top of editor when frontmatter exists

- [ ] Frontmatter block expandable/collapsible with inline editing

- [ ] Files without frontmatter show no indicator and work unchanged

- [ ] New Project dialog shows project template picker

- [ ] Creating a project with a template scaffolds correct folders and goals file with frontmatter

- [ ] Goals file has `type: goal` frontmatter with template, created date, and title

- [ ] Goals file opens in the WYSIWYG editor and round-trips correctly (including frontmatter)

- [ ] Can add goals files to existing projects via context menu

- [ ] AI context loader discovers goals files by scanning for `type: goal` frontmatter

- [ ] AI chat includes goals content in system prompt when goals exist

- [ ] AI chat works normally when no goals files exist (no errors)

- [ ] Goal template picker shows all templates with descriptions

- [ ] Multiple goals files per project are supported

- [ ] "Blank" project template creates no goals or extra folders

### Design

- [ ] Frontmatter indicator is subtle and fits the editor aesthetic (not jarring)

- [ ] Frontmatter block expand/collapse has smooth transition

- [ ] Project template selector in New Project dialog is clean and intuitive

- [ ] Goal template picker dialog is polished (proper spacing, selection states)

- [ ] All interactive elements have hover/active/focus states

- [ ] Works in both light and dark mode

- [ ] No chromatic accent colors

- [ ] Transitions on dialog open/close

## Out of Scope

- **Custom template creation UI** — Users can manually edit template files, but no UI for authoring new templates.
- **Goal progress tracking** — No computed progress bars or percentages. The markdown content (checkboxes, status markers) is the user-facing progress indicator.
- **Due date integration** — No calendar, reminders, or deadline tracking.
- **Goal linking** — No automatic linking between goals and notes. Users can manually add links in markdown.
- **Cross-project goals** — Goals are scoped to individual projects.
- **Goal archiving** — Users can delete or move files manually.
- **Workflow engine** — Folder conventions are established here (goals/, notes/, research/, documents/) but automated workflows are Phase 5.
- **Special goal rendering** — Goals files render identically to any other markdown file. No custom editor decorations.