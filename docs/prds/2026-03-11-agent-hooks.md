# PRD: Agent Hooks & Deterministic Workflows

**Date:** 2026-03-11 **Phase:** 12 **Status:** Draft

---

## Problem

AI models are non-deterministic. When a user wants a specific, repeatable behavior — "always summarize a document when I save it", "always format citations before export", "always run a spell check before committing" — they can't guarantee the model will do it the same way each time, or at all.

Today, Notesage skills and agents provide *capabilities* (what the AI can do) but no *automation* (when it should do it). Users must manually invoke skills or prompt the AI each time. There's no way to say "when X happens, do Y" without writing a custom Tiptap extension or modifying the app's source code.

The concept of "hooks" — deterministic pre/post processing triggered by specific events — bridges the gap between AI flexibility and predictable behavior. Hooks run reliably every time, while the AI handles the creative/adaptive parts within them.

**Why now:** Tool calling (PRD: Local AI Tool Calling) enables local models to execute skills. Hooks extend this by *triggering* skill execution at the right moments, creating end-to-end workflows without user intervention.

---

## Goals

1. **Event-driven hooks** — Define hooks triggered by document lifecycle events (save, open, close, create, export)
2. **Pre/post semantics** — Hooks run before or after the triggering event, with the ability to modify content or cancel the event
3. **Three hook types** — Script hooks (deterministic), AI hooks (model-powered), and composite hooks (script → AI → script)
4. **Project and global scope** — Hooks in `.notesage/hooks/` (project) override `~/.notesage/hooks/` (global)
5. **YAML configuration** — Simple, readable hook definitions that non-programmers can understand
6. **Built-in hook templates** — Ship with useful defaults (auto-summarize, auto-tag, format-on-save)
7. **Conditional execution** — Hooks can filter by file extension, path pattern, or frontmatter fields

## Non-Goals

- **Real-time hooks** (on every keystroke) — too performance-sensitive; hooks run on discrete events
- **Inter-hook dependencies** — hooks run independently; no hook orchestration or DAGs
- **Remote/webhook hooks** — local execution only; no HTTP callbacks
- **Hook marketplace** — users share hooks manually (git repos, file sharing)
- **Undo/rollback for hooks** — hooks that modify content are saved normally; undo via editor history
- **Hooks for non-document events** — no hooks for git operations, chat, or app lifecycle (deferred)

---

## User Stories

**Auto-summarizer:**
> As a user who writes meeting notes, I want a summary automatically generated in the frontmatter every time I save, so my notes always have an up-to-date summary without me having to ask the AI.

**Tag maintainer:**
> As a researcher with hundreds of notes, I want tags automatically suggested when I save a new document, so I don't forget to categorize my work.

**Format enforcer:**
> As a team lead sharing a project with colleagues, I want all markdown files to follow a consistent format (heading structure, citation style) when saved, so the project stays organized.

**Export preparer:**
> As someone who exports to PDF regularly, I want a hook that checks for broken links and missing images before export, so I catch problems early.

**Writing coach:**
> As a non-native English speaker, I want the AI to check my grammar and suggest improvements after I save, presented as inline comments I can accept or dismiss.

---

## Technical Approach

### Hook Definition Format

Hooks are defined in YAML files in `.notesage/hooks/` or `~/.notesage/hooks/`:

```yaml
# .notesage/hooks/auto-summarize.yaml
name: auto-summarize
description: Generate a summary in frontmatter on save
trigger: after-save
enabled: true

# Filter — only run for matching files
filter:
  extensions: [md]
  paths: ["notes/**", "meetings/**"]  # glob patterns relative to project root
  frontmatter:
    type: [meeting-notes, daily-note]  # only files with these frontmatter values

# What to do
action:
  type: ai                    # "script" | "ai" | "composite"
  prompt: |
    Summarize this document in 1-2 sentences. Update the 'summary' field
    in the YAML frontmatter. If no frontmatter exists, create it.
    Keep the summary factual and concise.
  model: default              # "default" uses active connection; or specific model ID
  max_tokens: 200
  write_back: true            # AI output replaces document content (for frontmatter updates)
```

```yaml
# .notesage/hooks/format-check.yaml
name: format-check
description: Check document formatting before export
trigger: before-export
enabled: true

action:
  type: script
  skill: format-checker           # Reference a skill by name
  script: scripts/check.sh       # Script within the skill
  args: ["--strict"]
  fail_on_error: true             # Cancel the export if script returns non-zero
```

```yaml
# .notesage/hooks/research-pipeline.yaml
name: research-pipeline
description: Download, tag, and summarize when saving a URL note
trigger: after-save
enabled: true

filter:
  frontmatter:
    type: [research-url]

action:
  type: composite
  steps:
    - type: script
      skill: download-webpage
      script: scripts/download.sh
      args: ["{{frontmatter.source_url}}"]
    - type: ai
      prompt: |
        Read the downloaded content and:
        1. Suggest 3-5 tags based on the content
        2. Write a 2-sentence summary
        Update the frontmatter with these values.
      write_back: true
```

### Event Types

| Event | When | Can Cancel | Content Available |
|---|---|---|---|
| `before-save` | Before file is written to disk | Yes (cancel save) | Current editor content |
| `after-save` | After file is successfully written | No | Saved content |
| `before-open` | Before file content is loaded into editor | Yes (cancel open) | File path only |
| `after-open` | After file is loaded and rendered | No | Document content |
| `before-export` | Before PDF/DOCX export begins | Yes (cancel export) | Markdown content |
| `after-export` | After export completes | No | Export path + metadata |
| `on-create` | When a new file is created | No | Initial content (may be empty) |
| `on-close` | When a tab is closed | No | Last saved content |

### Template Variables

Hooks can reference document context via template variables:

| Variable | Description |
|---|---|
| `{{file.path}}` | Absolute file path |
| `{{file.name}}` | File name without path |
| `{{file.extension}}` | File extension |
| `{{file.content}}` | Full document content |
| `{{project.root}}` | Project root directory |
| `{{project.name}}` | Project name |
| `{{frontmatter.*}}` | Any frontmatter field value |
| `{{timestamp}}` | ISO 8601 timestamp |
| `{{date}}` | YYYY-MM-DD date |

### Hook Discovery & Registry

Same pattern as skills:

```
Discovery paths:
1. .notesage/hooks/*.yaml  (project — highest priority)
2. ~/.notesage/hooks/*.yaml (global)
3. bundled-hooks/           (shipped with app — lowest priority)
```

**Rust backend:** New `discover_hooks` Tauri command scans directories for `.yaml` files, parses them, and returns `HookEntry[]`. Frontend stores in a new `hook-store`.

**Execution orchestration** lives in the frontend hooks (`useHookRunner`) since it needs access to editor state, AI operations, and skill execution.

### Execution Flow

```
Event occurs (e.g., save)
  → useHookRunner checks hook-store for matching hooks
  → Filter evaluation (extension, path, frontmatter)
  → For each matching hook (sorted by priority):
      → If "before-*": run hook, check result
          → If fail_on_error and error → cancel event, show toast
          → If write_back → update editor content
      → If "after-*": run hook asynchronously
          → If write_back → update editor content, re-save
  → Continue with original event
```

### Hook Action Execution

**Script hooks:**
```typescript
async function executeScriptHook(hook: HookDefinition, context: HookContext): Promise<HookResult> {
  const skill = skillStore.getSkillByName(hook.action.skill);
  if (!skill) return { success: false, error: `Skill not found: ${hook.action.skill}` };

  // Interpolate template variables in args
  const args = hook.action.args.map(arg => interpolate(arg, context));

  // Execute via existing skill script runtime
  const result = await tauriApi.executeSkillScript(
    skill.path, hook.action.script, args, context.project?.root
  );

  return {
    success: result.exit_code === 0,
    output: result.stdout,
    error: result.stderr || undefined
  };
}
```

**AI hooks:**
```typescript
async function executeAIHook(hook: HookDefinition, context: HookContext): Promise<HookResult> {
  // Build prompt with context
  const prompt = interpolate(hook.action.prompt, context);

  // Use the active AI connection (or specified model)
  const messages = [
    { role: 'system', content: 'You are processing a document hook. Follow the instructions precisely.' },
    { role: 'user', content: `Document:\n\n${context.content}\n\n---\n\nInstructions:\n${prompt}` }
  ];

  const response = await aiChat(messages, { maxTokens: hook.action.max_tokens || 500 });

  return {
    success: true,
    output: response,
    updatedContent: hook.action.write_back ? response : undefined
  };
}
```

**Composite hooks:**
```typescript
async function executeCompositeHook(hook: HookDefinition, context: HookContext): Promise<HookResult> {
  let currentContext = { ...context };

  for (const step of hook.action.steps) {
    const result = step.type === 'script'
      ? await executeScriptHook({ ...hook, action: step }, currentContext)
      : await executeAIHook({ ...hook, action: step }, currentContext);

    if (!result.success && step.fail_on_error) {
      return result;
    }

    // Pass output as context to next step
    if (result.updatedContent) {
      currentContext.content = result.updatedContent;
    }
    currentContext.previousStepOutput = result.output;
  }

  return { success: true, output: currentContext.content };
}
```

### Rust Backend

**New file:** `src-tauri/src/commands/hooks.rs`

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HookEntry {
    pub name: String,
    pub description: String,
    pub trigger: String,          // "before-save" | "after-save" | etc.
    pub enabled: bool,
    pub path: String,             // absolute path to YAML file
    pub source: String,           // "project" | "global" | "bundled"
    pub filter: Option<HookFilter>,
    pub action: HookAction,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HookFilter {
    pub extensions: Option<Vec<String>>,
    pub paths: Option<Vec<String>>,
    pub frontmatter: Option<HashMap<String, Vec<String>>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HookAction {
    pub action_type: String,      // "script" | "ai" | "composite"
    pub skill: Option<String>,
    pub script: Option<String>,
    pub args: Option<Vec<String>>,
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
    pub write_back: Option<bool>,
    pub fail_on_error: Option<bool>,
    pub steps: Option<Vec<HookAction>>,
}

#[tauri::command]
pub async fn discover_hooks(
    base_dirs: Vec<String>,
) -> Result<Vec<HookEntry>, String>

#[tauri::command]
pub async fn read_hook(
    path: String,
) -> Result<HookEntry, String>
```

---

## UI/UX

### Settings → Hooks Tab

```
┌─────────────────────────────────────────────────────┐
│  Hooks                                    [Rescan]  │
│─────────────────────────────────────────────────────│
│                                                     │
│  Project (.notesage/hooks/)         [+ New Hook]    │
│  ┌─────────────────────────────────────────────┐    │
│  │  [■] auto-summarize           after-save    │    │
│  │      Generate summary in frontmatter        │    │
│  │  [■] format-check            before-export  │    │
│  │      Check formatting before PDF export     │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Global (~/.notesage/hooks/)        [+ New Hook]    │
│  ┌─────────────────────────────────────────────┐    │
│  │  [■] auto-tag                  after-save   │    │
│  │      Suggest tags for new documents         │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Click hook name to edit in editor                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Hook Execution Indicator

When a hook runs, show a subtle toast:

```
┌──────────────────────────────────────┐
│  ⚡ Running hook: auto-summarize     │
│  ████████████████░░░░  80%           │
└──────────────────────────────────────┘
```

For `before-*` hooks that cancel, show an informative message:
```
┌──────────────────────────────────────┐
│  ✕ Export cancelled by format-check  │
│  3 formatting issues found.          │
│  [View Details]                      │
└──────────────────────────────────────┘
```

### New Hook Wizard

Accessible from Settings or command palette ("Create Hook"):

```
┌─────────────────────────────────────────────────────┐
│  Create New Hook                               [×]  │
│─────────────────────────────────────────────────────│
│                                                     │
│  When should it run?                                │
│  [▾ After save                               ]      │
│                                                     │
│  What should it do?                                 │
│  ( ) Run a script from a skill                      │
│  (•) Ask AI to process the document                 │
│  ( ) Both (script + AI pipeline)                    │
│                                                     │
│  AI prompt:                                         │
│  ┌─────────────────────────────────────────────┐    │
│  │ Suggest 3-5 tags for this document and      │    │
│  │ add them to the frontmatter tags field.     │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  File filter (optional):                            │
│  Extensions: [ md                            ]      │
│  Paths:      [ notes/**, meetings/**         ]      │
│                                                     │
│  Scope:                                             │
│  (•) This project    ( ) Global                     │
│                                                     │
│                       [Cancel]  [Create Hook]       │
└─────────────────────────────────────────────────────┘
```

### Bundled Hook Templates

Ship 3 templates that users can enable:

| Template | Trigger | Type | What it does |
|---|---|---|---|
| `auto-summarize` | after-save | ai | Generates/updates `summary` in frontmatter |
| `auto-tag` | after-save | ai | Suggests tags based on content |
| `word-count` | after-save | script | Updates `word_count` in frontmatter |

Templates are extracted to `~/.notesage/hooks/` but disabled by default. Users enable in Settings.

---

## Data Model

### Frontend Store: `hook-store.ts`

```typescript
interface HookStore {
  hooks: HookEntry[];
  enabledOverrides: Record<string, boolean>;  // hook name → enabled override
  lastScanTimestamp: number;

  getActiveHooks(trigger: string): HookEntry[];
  getMatchingHooks(trigger: string, context: HookContext): HookEntry[];
  scanHooks(baseDirs: string[]): Promise<void>;
  toggleHook(name: string, enabled: boolean): void;
}
```

Persisted: `enabledOverrides` only. Hooks rebuilt from scan.

### HookContext (passed to execution)

```typescript
interface HookContext {
  file: {
    path: string;
    name: string;
    extension: string;
    content: string;
  };
  project?: {
    root: string;
    name: string;
  };
  frontmatter?: Record<string, unknown>;
  timestamp: string;
  date: string;
  previousStepOutput?: string;
}
```

---

## Quality Gates

### Functional

- [ ] Script hooks execute correctly via skill script runtime
- [ ] AI hooks call the active AI connection and return processed content
- [ ] Composite hooks chain steps correctly, passing context between them
- [ ] `before-save` hooks can cancel the save operation
- [ ] `before-export` hooks can cancel the export
- [ ] `after-save` hooks with `write_back` update the document and re-save
- [ ] File extension filter works correctly
- [ ] Path glob filter works correctly
- [ ] Frontmatter filter works correctly
- [ ] Template variables are interpolated correctly
- [ ] Project hooks override global hooks with same name
- [ ] Hooks can be enabled/disabled in Settings
- [ ] New Hook wizard creates valid YAML files
- [ ] Bundled hook templates are extracted and available
- [ ] Hook errors show informative toast messages
- [ ] Hooks timeout after 60 seconds (configurable)

### Performance

- [ ] Hook discovery adds < 100ms to startup
- [ ] `before-save` script hooks complete in < 2 seconds (for acceptable save latency)
- [ ] `after-save` AI hooks run asynchronously without blocking the editor
- [ ] Multiple hooks on the same event run sequentially without race conditions

### Design

- [ ] Settings Hooks tab matches design system
- [ ] Hook execution indicator is subtle and non-intrusive
- [ ] Hook cancellation messages are clear and actionable
- [ ] Wizard dialog follows the same pattern as Skill/Agent creation wizards
- [ ] All UI works in light and dark mode

---

## Dependencies

### Rust
- No new dependencies — YAML parsing via `serde_yaml` (already in use)

### Frontend
- No new dependencies

---

## Files Created/Modified

### New Files
- `src-tauri/src/commands/hooks.rs` — hook discovery and YAML parsing
- `src/stores/hook-store.ts` — hook registry
- `src/hooks/useHookRunner.ts` — hook execution orchestration
- `src/components/settings/HooksSettings.tsx` — hooks settings tab
- `src/components/NewHookWizard.tsx` — hook creation wizard
- `bundled-hooks/auto-summarize.yaml` — template
- `bundled-hooks/auto-tag.yaml` — template
- `bundled-hooks/word-count.yaml` — template

### Modified Files
- `src/hooks/useFileOperations.ts` — integrate before/after save hooks
- `src/components/ExportDialog.tsx` — integrate before/after export hooks
- `src/components/settings/SettingsDialog.tsx` — add Hooks tab
- `src-tauri/src/commands/mod.rs` — register hook commands
- `src-tauri/src/lib.rs` — add to `generate_handler![]`

---

## Out of Scope

- **Real-time hooks** (on keystroke) — performance concern
- **Git hooks** — separate from document hooks
- **Chat hooks** — hooking into AI conversation events
- **Hook scheduling** (cron-like) — deferred to future workflow system
- **Remote webhook execution** — local only
- **Hook debugging/step-through** — run and see result only
- **Inter-hook dependencies or ordering** — independent execution
- **Hook versioning** — users manage via git
