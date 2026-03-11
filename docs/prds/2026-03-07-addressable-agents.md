# PRD: Addressable Agents (Personas to Agents Evolution)

**Date:** 2026-03-07 **Status:** ✅ Complete **Parent:** Phase 7 — Skills & Agents Platform (Step C) **Depends on:** Step A (v0.18.0, complete)

## Problem

Notesage has two disconnected systems for shaping AI behavior:

1. **Personas** — hardcoded roles (General Assistant, Creative Writer, etc.) stored in `ai-store.ts` with simple system messages. Users can create custom personas via a settings UI, but they're just name + icon + system prompt. No connection to skills, no file-based portability, no cross-tool compatibility.

2. **Agent instruction files** — `agents.md` files discovered from the filesystem and injected into AI context (Phase 7 Step A). These are always-on project context, not selectable or addressable.

Neither system supports what the industry has converged on: **addressable agents** — named roles with responsibilities, personality, skill access, and model preferences, stored as portable markdown files that work across tools.

### Industry Alignment

Three major platforms have independently converged on the same pattern:

| Platform | Agent format | Location | Invocation |
| --- | --- | --- | --- |
| **GitHub Copilot** | `.github/agents/*.md` | Project + user profile | `@agent-name` in chat |
| **Claude Code** | `.claude/agents/*.md` | Project + `~/.claude/agents/` | `@agent-name` in chat |
| **VS Code Copilot** | `.github/agents/*.agent.md` | Project + user profile + configurable | `@agent-name` + dropdown |

All three use YAML frontmatter with `name`, `description`, `model`, and tool/skill references. All three support `@agent-name` addressing in chat. Notesage's persona system predates this convergence and should evolve to match it.

### What Changes

Personas become agents. The concept is the same — a named AI role with specific behavior — but backed by portable markdown files instead of hardcoded store entries, with skill awareness and cross-tool compatibility.

| Persona concept | Agent equivalent |
| --- | --- |
| Name + icon | `name` + `description` in frontmatter |
| System message | Markdown body (instructions) |
| Built-in presets | Bundled agent files in `~/.notesage/agents/` |
| Custom personas | User-created `.md` files in `agents/` directories |
| Persona picker dropdown | Agent picker dropdown |
| Per-project persona override | Agent files in project `.notesage/agents/` |
| — (not possible) | `@agent-name` inline addressing |
| — (not possible) | Skill references via `allowed-tools` |
| — (not possible) | Per-agent model preference |
| — (not possible) | Cross-tool portability |

## Goals

1. **Discover agent files** from `agents/` directories using the same scanning pattern as skills
2. **Replace the persona picker** with an agent dropdown populated from discovered agents
3. **Support** `@agent-name` in chat input for inline agent scoping
4. **Connect agents to skills** via frontmatter fields (`tools`, `allowed-tools`)
5. **Per-agent model preference** via `model` frontmatter field
6. **Migrate built-in personas** to bundled agent files shipped with the app
7. **One-time migration** of custom personas to agent `.md` files
8. **Maintain two distinct layers**: agent instruction files (`agents.md`) remain always-on context; agent files (`agents/*.md`) are selectable roles

## Non-Goals

- **Agent handoffs** — multi-agent workflow transitions (deferred to Workflows & Automation, "Beyond" roadmap)
- **Subagent composition** — agents referencing other agents (`agents:` field in VS Code)
- **Agent marketplace or sharing** — users manage agent files manually
- **Breaking existing** `agents.md` — the always-on instruction layer is unchanged
- **Agent-specific conversation history** — all agents share the same chat history
- **Custom agent icons** — use Lucide icons mapped from description keywords; emoji supported in frontmatter `icon` field
- **Agent file hot-reload during conversation** — discovery runs at startup + on demand

## User Stories

1. **As a user**, I want to select `@editor` in the chat and have it use the editor agent's instructions and skills, so the AI behaves as a specialized editor.
2. **As a user**, I want to type `@fact-checker review this paragraph` in chat and have it scoped to the fact-checker agent for that message.
3. **As a user with Claude Code agents**, I want my `.claude/agents/` files to appear in Notesage's agent picker without duplication.
4. **As a user**, I want to create a new agent by dropping a `.md` file in `.notesage/agents/`, without touching any settings UI.
5. **As a non-technical user**, I want the familiar built-in agents (General Assistant, Creative Writer, etc.) available out of the box.
6. **As a user**, I want my agent to reference specific skills (e.g., `allowed-tools: check-chapter-structure, analyze-dialog`) so it knows which capabilities to use.
7. **As a user**, I want to set a preferred model per agent (e.g., `model: opus` for complex tasks, `model: haiku` for quick edits).
8. **As a user**, I want my existing custom personas migrated to agent files automatically on first launch after the update.

## Technical Approach

### Agent File Format

Agent files are markdown with YAML frontmatter, following the cross-tool standard:

```markdown
---
name: editor
description: Specialist in editorial consistency, chapter structure, and character voice
model: sonnet
icon: pen-line
allowed-tools:
  - check-chapter-structure
  - analyze-dialog
  - check-character-balance
user-invocable: true
---

# Editor Agent

You are an editor. Your job is to ensure consistency in voice, structure, and quality.

## Your Workflow

1. Read the chapter structure guidelines
2. Check character voice consistency
3. Review dialog flow and pacing
4. Validate factual sections against chapter questions
```

**Frontmatter fields:**

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | **required** | Agent identifier (lowercase, hyphens) |
| `description` | string | **required** | Brief explanation shown in picker dropdown |
| `model` | string | string\[\] | (use routing default) | Preferred model(s). Maps to available connections. |
| `icon` | string | `user-round` | Lucide icon name or single emoji |
| `allowed-tools` | string\[\] | (all skills) | Skill names this agent can access. Empty = all. |
| `user-invocable` | boolean | `true` | Show in agent picker and `@` menu |
| `disable-model-invocation` | boolean | `false` | Prevent AI from auto-selecting this agent |

### Agent Discovery

**New Tauri command:** `discover_agents`

Scans filesystem paths to build an agent registry, mirroring skill discovery:

| Connection Provider | Paths Scanned |
| --- | --- |
| Claude Code (ACP) | `~/.claude/agents/` |
| Codex CLI (ACP) | `~/.codex/agents/` |
| Gemini CLI (ACP) | `~/.gemini/agents/` |
| Copilot CLI (ACP) | `~/.github/agents/`, `.github/agents/` (project) |
| Copilot LSP | `~/.github/agents/`, `.github/agents/` (project) |
| (always) | `~/.notesage/agents/`, `.notesage/agents/` (per open project), `~/.notesage/agents/` |

**File matching:** `*.md` and `*.agent.md` files with valid YAML frontmatter containing `name` and `description`.

**Hierarchy resolution** (later overrides earlier, same-name agents shadow):

1. External provider agents (e.g., `~/.claude/agents/`) — lowest priority
2. `~/.notesage/agents/` (global Notesage — includes bundled agents extracted here at startup)
3. `.notesage/agents/` per project (highest priority)

When multiple sources provide an agent with the same name, the highest-priority version is used. Lower-priority versions are visible in settings (greyed out, showing "overridden by \[source\]").

**Scan triggers:** Same as skill scanning — app startup, project open/close, connection changes, manual rescan.

### Agent Discovery vs Agent Instructions

Two distinct concepts that coexist:

| Concept | Files | Purpose | Behavior |
| --- | --- | --- | --- |
| **Agent instructions** | `agents.md`, `CLAUDE.md`, `AGENTS.md` | Always-on project context | Concatenated and injected into every prompt |
| **Addressable agents** | `agents/*.md` files | Selectable AI roles | Active agent's body injected when selected |

Agent instruction files (`agents.md`) continue to work exactly as in Step A. Addressable agents (`agents/*.md`) are a new layer on top — the active agent's instructions are appended after agent instruction context.

### Bundled Agents (Replacing Built-in Personas)

The 7 built-in personas become bundled agent files, extracted to `~/.notesage/agents/` at startup (same directory as global user agents; bundled files are always overwritten on startup to ensure updates):

| Current Persona | Agent File | Icon |
| --- | --- | --- |
| General Assistant | `general-assistant.md` | `sparkles` |
| Creative Writer | `creative-writer.md` | `pen-tool` |
| Technical Editor | `technical-editor.md` | `settings` |
| Fact Checker | `fact-checker.md` | `search` |
| Academic Writer | `academic-writer.md` | `graduation-cap` |
| Copywriter | `copywriter.md` | `megaphone` |
| Proofreader | `proofreader.md` | `spell-check` |

Each bundled agent file contains the same system message as the current persona, formatted as a proper agent markdown file with frontmatter. Users can override any bundled agent by creating a same-named file in project `.notesage/agents/` (project-level agents take priority over global).

### Custom Persona Migration

On first launch after the update, a one-time migration runs:

1. Read `customPersonas` from `ai-store` persisted state
2. For each custom persona, generate an agent `.md` file:
   - `name`: kebab-case from persona name
   - `description`: first sentence of system message (or persona name)
   - `icon`: emoji from persona (preserved in frontmatter)
   - Body: persona's `systemMessage`
3. Write files to `~/.notesage/agents/`
4. Set a `personasMigrated: true` flag in settings-store to prevent re-migration
5. Map `activePersonaId` to the equivalent agent name in the new agent store
6. Show a toast: "Your personas have been upgraded to agents"

After migration, the `customPersonas` and `activePersonaId` fields in `ai-store` become unused (kept for rollback safety, removed in a later release).

### Agent Picker (Replaces Persona Picker)

The persona picker popover in `ChatPanel.tsx` becomes an agent picker:

**Dropdown behavior:**

- Shows all discovered agents with `user-invocable !== false`
- Grouped by source: Project, Global, Bundled, External
- Each entry: icon + name + description (truncated)
- Click to select as active agent for the conversation
- Active agent indicated with checkmark
- "Manage Agents" link at bottom → opens Settings &gt; Skills & Agents

**State:** `activeAgentName` in a new `agent-store` (or extend `skill-store`), persisted. Falls back to `general-assistant` if the active agent is no longer discovered.

### `@agent-name` Chat Addressing

Typing `@` in the chat input triggers an agent autocomplete menu (same UX pattern as `/skill-name`):

**Behavior:**

- `@` at word boundary triggers the menu
- Menu shows filtered list of user-invocable agents
- Selecting an agent inserts `@agent-name` into the message
- When the message is sent, `@agent-name` is parsed out and that agent's instructions are used for this message only
- The dropdown selection is NOT changed — `@` is per-message scoping
- Multiple `@` mentions in one message: last one wins (simple rule)
- `@agent-name` without additional text: switch the active agent in the dropdown

**Implementation:**

- Reuse the same `forwardRef + useImperativeHandle` pattern from `SkillCommandMenu`
- New `AgentCommandMenu.tsx` component
- `ChatInput.tsx` detects `@` prefix and manages menu visibility
- `ChatPanel.tsx` resolves agent name before sending, loads agent body

### Agent Context Injection

When an agent is active (via picker or `@` mention), its instructions are injected into the AI prompt:

**Prompt composition order:**

1. Agent instruction files (`agents.md`, `CLAUDE.md`, etc.) — always-on context
2. **Active agent body** — the selected agent's markdown instructions
3. Skill descriptions — from active skills (filtered by agent's `allowed-tools` if set)
4. Project context (goals, file tree, etc.)
5. User message

**Skill filtering:**

- If the active agent has `allowed-tools`, only those skills are included in the prompt
- If `allowed-tools` is empty or absent, all active skills are included
- This scoping applies to both skill descriptions and the `execute_skill_script` tool

**Model routing:**

- If the agent has a `model` field, attempt to match it against available connections
- Matching logic: `model` value checked against connection model names (partial match, case-insensitive)
- If no match found, fall back to the default routing
- Model preference is a hint, not a hard requirement — the user's configured connections take priority

### Settings UI Updates

**Skills & Agents tab** gains a new Agents section (between Skills and Agent Instructions):

```
AGENTS                                           [Rescan]

Project (.notesage/agents/)                [+ New Agent]
+---------------------------------------------------+
|  editor                                            |
|    Specialist in editorial consistency              |
|  researcher                                        |
|    Finds and synthesizes information from sources   |
+---------------------------------------------------+

Global (~/.notesage/agents/)               [+ New Agent]
+---------------------------------------------------+
|  proofreader                                       |
|    Meticulous grammar and style checker             |
+---------------------------------------------------+

Bundled (~/.notesage/agents/)
+---------------------------------------------------+
|  general-assistant                                 |
|    Helpful writing assistant                       |
|  creative-writer                                   |
|    Imaginative expression and storytelling          |
|  ... (5 more)                                      |
+---------------------------------------------------+

Claude Code (~/.claude/agents/)
+---------------------------------------------------+
|  code-reviewer                                     |
|    Reviews code against project conventions         |
|  design-reviewer                                   |
|    Reviews UI against design system                 |
+---------------------------------------------------+
```

- Enable/disable toggles per agent
- Overridden agents shown greyed out
- Click agent name to open file in editor
- "+ New Agent" button opens the existing `NewAgentWizard` (updated to create individual agent files instead of appending to `agents.md`)

### Persona Settings Removal

The `PersonasSettings.tsx` tab is removed from the settings dialog. The "Personas" tab in navigation is replaced by the expanded "Skills & Agents" tab which now covers skills, agents, and agent instructions.

### Data Model

**Rust structs (new):**

```rust
#[derive(Serialize, Deserialize)]
pub struct AgentEntry {
    pub name: String,
    pub description: String,
    pub path: String,              // absolute path to agent file
    pub source: String,            // "notesage-project" | "notesage-global" | "claude" | "codex" | "gemini" | "github"
    pub model: Option<String>,
    pub icon: Option<String>,      // Lucide icon name or emoji
    pub allowed_tools: Option<Vec<String>>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
}
```

**Frontend store extension (skill-store or new agent-store):**

```typescript
interface AgentState {
  // State
  agents: AgentEntry[];
  activeAgentName: string;        // persisted, default "general-assistant"
  agentEnabledOverrides: Record<string, boolean>;

  // Computed
  getActiveAgent(): AgentEntry | undefined;
  getUserInvocableAgents(): AgentEntry[];
  getAgentByName(name: string): AgentEntry | undefined;

  // Actions
  scanAgents(baseDirs: string[]): Promise<void>;
  setActiveAgent(name: string): void;
  toggleAgent(agentPath: string, enabled: boolean): void;
}
```

### Files Created/Modified

**New files:**

- `src-tauri/src/commands/agents.rs` — agent discovery and content reading (or extend `skills.rs`)
- `src/components/chat/AgentCommandMenu.tsx` — `@agent-name` autocomplete menu
- `bundled-agents/general-assistant.md` — bundled agent (x7, one per current persona)

**Modified files:**

- `src-tauri/src/commands/skills.rs` — add `discover_agents`, `read_agent_content` commands; `extract_bundled_agents`
- `src-tauri/src/lib.rs` — register new commands
- `src/stores/skill-store.ts` — add agent state (agents array, activeAgentName, scanning)
- `src/hooks/useSkillOperations.ts` — add agent discovery to scan cycle
- `src/hooks/useAIOperations.ts` — replace persona injection with active agent injection; skill filtering by `allowed-tools`
- `src/components/chat/ChatPanel.tsx` — replace persona picker with agent picker
- `src/components/chat/ChatInput.tsx` — add `@` trigger for agent menu
- `src/components/settings/SkillsSettings.tsx` — add Agents section
- `src/components/settings/SettingsDialog.tsx` — remove Personas tab
- `src/components/NewAgentWizard.tsx` — update to create individual agent files (not `agents.md`)
- `src/stores/ai-store.ts` — deprecate persona fields (keep for migration)
- `src/stores/project-metadata-store.ts` — replace `personaId` with `agentName`

**Removed files:**

- `src/components/settings/PersonasSettings.tsx` — replaced by Agents section in SkillsSettings
- `src/components/PersonaIcon.tsx` — replaced by Lucide icon resolution from agent `icon` field

### Migration Safety

- `ai-store` persona fields (`activePersonaId`, `customPersonas`, built-in personas) are kept in code for one release cycle
- Migration runs once, gated by `personasMigrated` flag
- If migration fails, personas continue to work as before
- `project-metadata-store` `personaId` field renamed to `agentName` with backward-compatible read (if `agentName` is null, check `personaId` and map to agent name)

## Quality Gates

### Functional — Agent Discovery

- [x] Agent files in `.notesage/agents/` (project) are discovered

- [x] Agent files in `~/.notesage/agents/` (global) are discovered

- [x] Agent files in `~/.claude/agents/` are discovered when Claude is connected

- [x] Agent files in `.github/agents/` are discovered when Copilot is connected

- [x] Bundled agents are extracted and discovered at startup

- [x] Same-name agents resolved by hierarchy (project &gt; global &gt; external)

- [x] Overridden agents shown greyed out in settings

- [x] Adding/removing an agent file triggers re-discovery

### Functional — Agent Picker

- [x] Agent picker shows all user-invocable agents grouped by source

- [x] Selecting an agent changes the active agent

- [x] Active agent's instructions injected into AI prompts

- [x] Active agent persists across app restarts

- [x] Fallback to `general-assistant` if active agent is no longer found

### Functional — `@agent-name` Addressing

- [x] Typing `@` in chat input shows agent autocomplete menu

- [x] Selecting an agent inserts `@agent-name` into message

- [x] `@agent-name` in sent message scopes that message to the agent

- [x] Agent picker dropdown is not changed by `@` mentions

- [x] Menu keyboard navigation (arrow keys, Enter, Escape)

### Functional — Skill Filtering

- [x] Agent with `allowed-tools` only sees listed skills in context

- [x] Agent without `allowed-tools` sees all active skills

- [x] `execute_skill_script` tool respects agent's `allowed-tools`

### Functional — Model Preference

- [x] Agent with `model` field attempts to route to matching connection

- [x] Falls back to default routing if no match

- [x] Model preference shown in agent picker tooltip

### Functional — Migration

- [x] Custom personas migrated to `~/.notesage/agents/` files on first launch

- [x] Active persona mapped to active agent

- [x] Migration runs only once (`personasMigrated` flag)

- [x] Migration failure doesn't break the app

- [x] Per-project `personaId` mapped to `agentName`

### Design

- [x] Agent picker matches existing persona picker style

- [x] `@` autocomplete menu matches `/` skill menu style

- [x] Agents section in settings matches skills section layout

- [x] Agent icons render correctly (Lucide names + emoji fallback)

- [x] All UI works in both light and dark mode

## Implementation Tasks

**Summary:** 16 tasks: 5S, 7M, 4L **Suggested order:** Backend (Rust) -&gt; Store -&gt; UI (Chat) -&gt; UI (Settings + AI) -&gt; Migration + Cleanup

### Group 1 — Backend (Rust)

| \# | Title | Complexity | Category | Dependencies | Key Files |
| --- | --- | --- | --- | --- | --- |
| 1 | Add `AgentEntry` struct and `discover_agents` Tauri command | L | backend | \-- | `skills.rs`, `lib.rs` |
| 2 | Add `read_agent_content` Tauri command | S | backend | #1 | `skills.rs`, `lib.rs` |
| 3 | Add `extract_bundled_agents` Tauri command | M | backend | \-- | `skills.rs`, `lib.rs` |
| 4 | Create 7 bundled agent markdown files | M | both | \-- | `bundled-agents/*.md` |
| 5 | Write backend tests for agent discovery | M | backend | #1 | `skills.rs` |

### Group 2 — Store & Discovery Wiring

| \# | Title | Complexity | Category | Dependencies | Key Files |
| --- | --- | --- | --- | --- | --- |
| 6 | Extend `skill-store` with agent state | L | frontend | #1 | `skill-store.ts` |
| 7 | Write skill-store agent tests | M | frontend | #6 | `skill-store.test.ts` |
| 8 | Add agent discovery to `useSkillDiscovery` | M | frontend | #3, #6 | `useSkillOperations.ts` |

### Group 3 — UI: Chat Agent Picker & @-Addressing

| \# | Title | Complexity | Category | Dependencies | Key Files |
| --- | --- | --- | --- | --- | --- |
| 9 | Replace persona picker with agent picker in ChatPanel | L | frontend | #6, #8 | `ChatPanel.tsx` |
| 10 | Create `AgentCommandMenu` component | M | frontend | #6 | `AgentCommandMenu.tsx` |
| 11 | Add `@agent-name` trigger to ChatInput | M | frontend | #10 | `ChatInput.tsx` |
| 12 | Handle `@agent-name` in ChatPanel send | S | frontend | #2, #9, #11 | `ChatPanel.tsx` |

### Group 4 — AI Injection & Settings

| \# | Title | Complexity | Category | Dependencies | Key Files |
| --- | --- | --- | --- | --- | --- |
| 13 | Replace persona injection with agent injection in `useAIOperations` | L | frontend | #6, #8 | `useAIOperations.ts` |
| 14 | Add Agents section to SkillsSettings | M | frontend | #6, #8 | `SkillsSettings.tsx` |

### Group 5 — Migration & Cleanup

| \# | Title | Complexity | Category | Dependencies | Key Files |
| --- | --- | --- | --- | --- | --- |
| 15 | Custom persona migration to agent files | S | frontend | #6, #8 | `settings-store.ts`, `useSkillOperations.ts` |
| 16 | Remove PersonasSettings and PersonaIcon | S | frontend | #9, #14, #15 | `PersonasSettings.tsx`, `PersonaIcon.tsx`, `SettingsDialog.tsx`, `ProjectSettings.tsx` |

### Task Details

**Task 1 — Add** `AgentEntry` **struct and** `discover_agents` **command**:Add `AgentEntry` Rust struct (name, description, path, source, model, icon, allowed_tools, user_invocable, disable_model_invocation). Add `discover_agents(base_dirs)` that scans for `*.md` / `*.agent.md` files with valid YAML frontmatter containing `name` + `description`. Follow `discover_skills` pattern. Register in `generate_handler![]`.

**Task 2 — Add** `read_agent_content` **command**:Read full body of an agent file (markdown after frontmatter). Returns `AgentContent { name, body, path }`. Follow `read_skill_content` pattern.

**Task 3 — Add** `extract_bundled_agents` **command**:Embed 7 bundled agent files via `include_str!`. Write to `~/.notesage/agents/` at startup (always overwrite). Same pattern as `extract_bundled_skills`.

**Task 4 — Create bundled agent files**:Create `bundled-agents/` directory with 7 `.md` files. Each has frontmatter (name, description, icon as Lucide name) and body from current persona `systemMessage`. Files: `general-assistant.md`, `creative-writer.md`, `technical-editor.md`, `fact-checker.md`, `academic-writer.md`, `copywriter.md`, `proofreader.md`.

**Task 5 — Backend tests**:Tests for `discover_agents`: valid files found, invalid frontmatter skipped, `*.agent.md` supported, source attribution correct, missing name/description rejected.

**Task 6 — Extend skill-store**:Add: `agents: AgentEntry[]`, `activeAgentName: string` (default `'general-assistant'`), `agentEnabledOverrides: Record<string, boolean>`. Methods: `scanAgents`, `setActiveAgent`, `toggleAgent`, `getActiveAgents` (hierarchy-resolved), `getActiveAgent`, `getUserInvocableAgents`, `getAgentByName`. Use same `SOURCE_PRIORITY`. Extend `partialize`.

**Task 7 — Store tests**:Tests for hierarchy resolution, active agent fallback, enable/disable, scan updates, `getUserInvocableAgents` filtering.

**Task 8 — Discovery wiring**:In `useSkillDiscovery`: call `extract_bundled_agents` after `extract_bundled_skills`. Build agent base dirs. Call `scanAgents`. Add `getAgentPathsForConnection()` helper.

**Task 9 — Agent picker**:Replace persona popover in ChatPanel with agent picker. Group by source. Show icon + name + description. Click to select. Active agent checkmark. "Manage" link to Settings. Remove `PersonaIcon`/`getActivePersona`/`getAllPersonas` imports.

**Task 10 — AgentCommandMenu**:Same `forwardRef + useImperativeHandle` pattern as `SkillCommandMenu`. Shows filtered agents. Icon + `@name` + description. Keyboard navigation. Absolutely positioned above input.

**Task 11 —** `@` **trigger in ChatInput**:Detect `@` at word boundary. Track `showAgentMenu`/`agentQuery`. On select insert `@agent-name `. Delegate keyboard events. Ensure `@` and `/` menus don't conflict.

**Task 12 —** `@` **in send**:Parse `@agent-name` from message (regex). Load agent body. Use as context for this message only. Strip prefix from displayed message. Fall back to active agent if no `@`.

**Task 13 — Agent injection in useAIOperations**:Replace `effectivePersonaId`/`getActivePersona` with agent-based injection. Load agent body. Inject after agent instructions, before skills. Filter skills by `allowed-tools` if set. Handle `model` as routing hint (log for now).

**Task 14 — Agents in SkillsSettings**:New "AGENTS" section between Skills and Agent Instructions. Group by source. Enable/disable toggles. Override badges. "+ New Agent" button. Click to open file.

**Task 15 — Persona migration**:One-time migration gated by `personasMigrated` flag. Read `customPersonas`, generate `.md` files. Map `activePersonaId` to `activeAgentName`. Map project `personaId` to `agentName`. Toast notification.

**Task 16 — Cleanup**:Delete `PersonasSettings.tsx`, `PersonaIcon.tsx`. Remove Personas tab from `SettingsDialog.tsx`. Update `ProjectSettings.tsx` to use agent name. Mark persona fields as `@deprecated` in `ai-store.ts`.

## Out of Scope

- **Agent handoffs** — multi-step workflow transitions between agents (future: Workflows & Automation)
- **Subagent composition** — agents referencing other agents
- **Agent-specific conversation memory** — all agents share chat history
- **Agent file creation from chat** — use the existing `create-agent` skill or wizard
- **Per-message model switching** — `@agent-name` scopes instructions, not the connection
- **Agent binary/runtime management** — Phase 10 concern