# PRD: Auto-Summarization & Document Intelligence

**Date:** 2026-03-11 **Phase:** 13 **Status:** Draft

---

## Problem

Notesage users accumulate hundreds of notes across multiple projects. Over time, notes become hard to navigate — file names aren't enough to remember content, related documents aren't connected, and there's no way to get a quick overview of a project without reading every file.

Today, all AI features in Notesage are **user-initiated** — you must ask the AI to summarize, tag, or analyze. This means AI value is proportional to how often the user remembers to invoke it. For document maintenance tasks (keeping summaries current, suggesting tags, detecting action items), the AI should work in the background automatically.

This PRD builds on two prerequisites:
1. **Agent Hooks** — provides the event-driven trigger mechanism
2. **Local AI Tool Calling** — enables the local model to read/write files autonomously

Together, they enable "document intelligence" — passive AI processing that keeps notes organized without user intervention.

**Why now:** With local models capable of tool calling and hooks providing event triggers, the infrastructure for background intelligence is complete. This PRD defines the *specific intelligent behaviors* rather than the *mechanisms* (which are covered by the prerequisite PRDs).

---

## Goals

1. **Auto-summarization** — Generate and maintain document summaries in YAML frontmatter
2. **Auto-tagging** — Suggest tags based on document content, add to frontmatter
3. **Action item extraction** — Detect and surface action items from meeting notes and documents
4. **Change summaries** — Describe what changed when a document is modified
5. **Project digest** — Weekly summary of project activity and changes
6. **All processing local** — Every operation uses the local model; no data leaves the machine

## Non-Goals

- **Real-time processing** (on every keystroke) — triggered on save only
- **Semantic search / embeddings** — deferred to Multi-Model Pipeline phase
- **Auto-linking / backlinks** — deferred
- **Content generation** — this is analysis, not creation
- **Shared/collaborative intelligence** — single-user only
- **Custom AI prompts for intelligence** — predefined behaviors with configuration

---

## User Stories

**Meeting note taker:**
> As someone who takes meeting notes, I want action items automatically extracted and highlighted after I save, so I never miss a follow-up.

**Researcher:**
> As a researcher with 50+ research notes, I want tags automatically suggested based on content, so my notes stay organized without manual effort.

**Project reviewer:**
> As a team lead reviewing a project's progress, I want a weekly digest of what changed across all project files, so I can stay informed without reading every update.

**Note browser:**
> As a user scrolling through my file tree, I want to see a summary for each document on hover, so I can find what I'm looking for faster.

---

## Technical Approach

### Intelligence Features

Each feature is implemented as a **bundled hook** (see Agent Hooks PRD) with a specific AI prompt and processing logic.

#### 1. Auto-Summarization

**Trigger:** `after-save` (debounced — only if content actually changed)

**Behavior:**
1. Read the saved document content
2. Send to local AI with summarization prompt
3. Extract 1-2 sentence summary
4. Update `summary` field in YAML frontmatter
5. If no frontmatter exists, create minimal frontmatter block

**Prompt:**
```
Summarize this document in 1-2 sentences. Be factual and concise.
Output ONLY the summary text, nothing else.
```

**Frontmatter update:**
```yaml
---
summary: "Meeting notes from Q1 planning session covering roadmap priorities and resource allocation."
summary_updated: "2026-03-11T14:30:00Z"
---
```

**Configuration:**
```yaml
# .notesage/hooks/auto-summarize.yaml
name: auto-summarize
description: Generate document summary in frontmatter
trigger: after-save
enabled: true  # User toggles in Settings

filter:
  extensions: [md]
  min_word_count: 50    # Skip very short documents

action:
  type: ai
  prompt: "Summarize this document in 1-2 sentences. Be factual and concise. Output ONLY the summary text."
  max_tokens: 100
  target: frontmatter   # Special action type: update frontmatter field
  field: summary
  timestamp_field: summary_updated
```

#### 2. Auto-Tagging

**Trigger:** `after-save` (only for new documents or documents without tags)

**Behavior:**
1. Read the saved document content
2. Send to local AI with tagging prompt
3. Extract 3-5 relevant tags
4. Merge with existing tags in frontmatter (don't duplicate, don't remove user tags)
5. Tags also added as inline `#tag` markers if user preference is set

**Prompt:**
```
Suggest 3-5 tags for this document. Tags should be lowercase, hyphenated
(e.g., "machine-learning", "meeting-notes", "project-update").
Output ONLY the tags as a comma-separated list, nothing else.
```

**Frontmatter update:**
```yaml
---
tags: [battery-technology, solid-state, research, literature-review]
tags_suggested: [literature-review]   # Tracks which tags were AI-suggested
---
```

**Merge logic:**
- AI-suggested tags are appended to existing `tags` array
- If a suggested tag already exists, skip it
- Track AI-suggested tags in `tags_suggested` so users can review/remove
- Never remove user-added tags

#### 3. Action Item Extraction

**Trigger:** `after-save` (for documents matching meeting/notes patterns)

**Behavior:**
1. Read the saved document
2. Send to local AI with action extraction prompt
3. Extract action items (who, what, deadline if mentioned)
4. Store in `.notesage/actions/{document-uuid}.json` sidecar file
5. These items appear in the Open Actions Dashboard (PRD)

**Prompt:**
```
Extract action items from this document. For each action item, provide:
- text: The action to take
- assignee: Who should do it (if mentioned, otherwise "unassigned")
- deadline: When it's due (if mentioned, otherwise null)

Output as JSON array. If no action items found, output [].
```

**Sidecar file:**
```json
{
  "document_id": "abc-123",
  "extracted_at": "2026-03-11T14:30:00Z",
  "actions": [
    {
      "text": "Send follow-up email to Sarah about design review",
      "assignee": "unassigned",
      "deadline": null,
      "line_number": 22,
      "status": "open"
    }
  ]
}
```

**Integration with Actions Dashboard:**
- Extracted actions appear alongside task lists and comments
- Source type: `"extracted"` (distinct from `"task"` which is `- [ ]` items)
- Click to navigate to the line in the source document

#### 4. Change Summaries

**Trigger:** `after-save` (only if content differs from last saved version)

**Behavior:**
1. Compare current content with previous version (stored in memory or `.notesage/`)
2. Generate a brief change description
3. Append to `.notesage/changelog/{document-uuid}.jsonl` (JSON Lines)

**Prompt:**
```
Compare the old and new versions of this document.
Describe what changed in one sentence. Be specific about what was added,
removed, or modified. Output ONLY the change description.
```

**Changelog entry:**
```jsonl
{"timestamp":"2026-03-11T14:30:00Z","summary":"Added section on solid-state battery findings with 3 new references.","word_delta":"+142"}
```

**UI integration:**
- Changelog viewable via command palette ("Document History")
- Shows timeline of changes with AI-generated descriptions
- Click entry to see approximate position of changes

#### 5. Project Digest

**Trigger:** Scheduled — runs daily at end of day (or on-demand via command palette)

**Behavior:**
1. Collect all changes across project files from the last 24 hours (or 7 days for weekly)
2. Read change summaries from `.notesage/changelog/`
3. Generate a project-level summary
4. Save as `.notesage/digests/YYYY-MM-DD.md`
5. Optionally show as notification (System Tray PRD)

**Prompt:**
```
Here are the changes made to this project in the last [period]:

[list of per-file change summaries]

Write a brief project digest (3-5 bullet points) summarizing the key
developments, decisions made, and pending items. Be concise and actionable.
```

**Digest format:**
```markdown
---
type: digest
period: 2026-03-11
---

# Project Digest — March 11, 2026

- Added literature review section with 5 new battery technology sources
- Updated project goals: 3 of 5 milestones completed
- Meeting notes captured with 4 follow-up action items pending
- Research synthesis started but not yet complete
```

---

## UI/UX

### Settings → Document Intelligence

New section in Settings:

```
┌─────────────────────────────────────────────────────┐
│  Document Intelligence                               │
│                                                     │
│  Requires Local AI to be running                    │
│                                                     │
│  [■] Auto-summarize on save                         │
│      Generate and update frontmatter summaries      │
│      Min words: [50        ]                        │
│                                                     │
│  [■] Auto-suggest tags                              │
│      Suggest tags for new documents                 │
│      [ ] Also add inline #tag markers               │
│                                                     │
│  [ ] Extract action items                           │
│      Detect action items from meeting notes         │
│      File patterns: [meetings/**, notes/**    ]     │
│                                                     │
│  [ ] Track document changes                         │
│      Generate change descriptions on save           │
│                                                     │
│  [ ] Project digest                                 │
│      Generate daily/weekly project summaries        │
│      Frequency: [Daily ▾]                           │
│                                                     │
│  All processing happens locally using your          │
│  active Local AI model.                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Summary in File Tree Tooltip

When a file has a `summary` in frontmatter, show it on hover in the sidebar:

```
┌─────────────────────────────────┐
│  📄 research-plan.md            │ ← hover
│  ┌─────────────────────────────┐│
│  │ Summary: Research plan for  ││
│  │ solid-state battery tech    ││
│  │ covering 5 key areas.       ││
│  │                             ││
│  │ Tags: research, battery     ││
│  │ Modified: 2 hours ago       ││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

### Document History (Command Palette)

`Cmd+Shift+H` or command palette "Document History":

```
┌─────────────────────────────────────────────────────┐
│  Document History — research-plan.md                │
│─────────────────────────────────────────────────────│
│                                                     │
│  Today                                              │
│  14:30  Added section on solid-state findings       │
│         +142 words                                  │
│  11:15  Restructured outline with new sub-sections  │
│         +58 words                                   │
│                                                     │
│  Yesterday                                          │
│  16:45  Added 3 new references from arxiv           │
│         +89 words                                   │
│  10:00  Created document with initial research plan │
│         +312 words                                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Project Digest Notification

When a digest is generated:

```
┌──────────────────────────────────────┐
│  📋 Project digest ready             │
│  Research Project — March 11         │
│  [View]  [Dismiss]                   │
└──────────────────────────────────────┘
```

---

## Data Model

### Storage Structure

```
.notesage/
├── comments/          # Existing
├── research/          # Existing
├── changelog/         # NEW: per-document change logs
│   ├── {uuid-1}.jsonl
│   └── {uuid-2}.jsonl
├── actions/           # NEW: extracted action items
│   ├── {uuid-1}.json
│   └── {uuid-2}.json
└── digests/           # NEW: project digests
    ├── 2026-03-10.md
    └── 2026-03-11.md
```

### Intelligence Store

```typescript
interface IntelligenceStore {
  // Settings (persisted)
  autoSummarize: boolean;        // default: true (when local AI running)
  autoTag: boolean;              // default: true
  extractActions: boolean;       // default: false
  trackChanges: boolean;         // default: false
  projectDigest: boolean;        // default: false
  digestFrequency: 'daily' | 'weekly';
  actionFilePatterns: string[];  // default: ["meetings/**", "notes/**"]
  minWordCount: number;          // default: 50

  // Runtime (non-persisted)
  processingQueue: string[];     // file paths being processed
  lastProcessed: Record<string, number>;  // file path → timestamp
}
```

### Processing Queue

To avoid overwhelming the local model, intelligence features use a queue:

```typescript
// Process one document at a time
// Skip if local AI is not running
// Skip if document was processed < 60 seconds ago
// Debounce: wait 5 seconds after save before processing
```

---

## Dependencies

### Prerequisites (must be implemented first)

1. **Local AI Tool Calling** (PRD) — for models to read/write files
2. **Agent Hooks** (PRD) — for event-driven triggers

### Rust
- No new crate dependencies

### Frontend
- No new npm dependencies

---

## Quality Gates

### Functional

- [ ] Auto-summarization generates correct summaries (spot check 10 documents)
- [ ] Summaries update when document content changes
- [ ] Summaries don't update when content hasn't changed (debounce)
- [ ] Auto-tagging suggests relevant tags (spot check 10 documents)
- [ ] Suggested tags don't duplicate existing tags
- [ ] User-added tags are never removed
- [ ] `tags_suggested` tracks AI-suggested tags correctly
- [ ] Action item extraction finds items in meeting notes
- [ ] Extracted actions appear in Actions Dashboard
- [ ] Change summaries accurately describe modifications
- [ ] Changelog appends correctly (doesn't lose history)
- [ ] Project digest covers all changed files in the period
- [ ] Processing queue prevents model overload
- [ ] Features gracefully disable when local AI is not running
- [ ] Each feature can be independently enabled/disabled
- [ ] Frontmatter preservation: existing frontmatter fields not corrupted

### Performance

- [ ] Auto-summarization completes in < 5 seconds per document
- [ ] Auto-tagging completes in < 3 seconds per document
- [ ] Processing doesn't block editor interaction
- [ ] Queue processes documents sequentially without stacking
- [ ] No noticeable slowdown during normal editing

### Design

- [ ] Settings section matches design system
- [ ] File tree tooltips with summaries are clean and readable
- [ ] Document history panel follows app aesthetic
- [ ] All UI works in light and dark mode

---

## Files Created/Modified

### New Files
- `src/stores/intelligence-store.ts` — intelligence feature settings
- `src/hooks/useDocumentIntelligence.ts` — processing queue and orchestration
- `src/components/DocumentHistory.tsx` — changelog viewer
- `bundled-hooks/auto-summarize.yaml` — bundled hook definition
- `bundled-hooks/auto-tag.yaml` — bundled hook definition
- `bundled-hooks/extract-actions.yaml` — bundled hook definition
- `bundled-hooks/track-changes.yaml` — bundled hook definition

### Modified Files
- `src/components/settings/SettingsDialog.tsx` — add Intelligence section
- `src/components/sidebar/FileTreeItem.tsx` — summary tooltip on hover
- `src/stores/action-store.ts` — integrate extracted actions
- `src/hooks/useFileOperations.ts` — trigger intelligence processing after save

---

## Out of Scope

- **Semantic search / embeddings** — separate phase
- **Auto-linking / backlinks** — separate feature
- **Content generation / auto-writing** — analysis only
- **Cross-document relationships** — no graph or linking
- **Cloud AI processing** — local only
- **Custom prompts** — predefined behaviors
- **Streaming processing feedback** — results appear when done
- **Historical reprocessing** — only processes new saves, doesn't backfill
