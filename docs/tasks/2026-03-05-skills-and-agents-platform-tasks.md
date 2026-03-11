# Tasks: Skills & Agents Platform (Step A)

**Status:** ✅ Complete

**PRD:** `docs/prds/2026-03-05-skills-and-agents-platform.md`
**Total:** 22 tasks — 22/22 done — 5S, 11M, 6L
**Estimated phases:** 4 implementation groups (Backend → State → Core Hooks → UI)

## Summary

The implementation follows a bottom-up approach: Rust backend commands first, then Zustand state management, then core hooks that wire discovery and AI integration together, and finally UI components. The riskiest parts are the script execution runtime (security boundary) and the AI prompt injection (must work across both direct API and ACP paths without duplication).

**Suggested implementation order:** Tasks 1-6 (backend), then 7-8 (stores), then 9-12 (hooks + integration), then 13-22 (UI + bundled skills). Tasks within each group can sometimes be parallelized.

**Open questions:**
- Should bundled skills live in `src-tauri/bundled-skills/` (included via `include_str!`) or in `public/bundled-skills/` (served as assets)? Recommendation: `src-tauri/bundled-skills/` with `include_str!` for the SKILL.md and scripts, extracted to `~/.notesage/bundled-skills/` at startup.
- How should the skill description context budget be enforced? The spec says 2% of context window — should this be configurable in settings?

---

## Tasks

### 1. Define Rust types and structs for skills ✅ DONE

**Description:** Create the foundational Rust types used across all skill commands: `SkillEntry`, `SkillContent`, `ScriptResult`, `AgentInstruction`. These are serialized to/from the frontend via serde.

**Complexity:** S
**Category:** backend
**Dependencies:** None
**Files:**
- Create `src-tauri/src/commands/skills.rs` (types section)

**Acceptance criteria:**
- All structs derive `Serialize, Deserialize, Clone`
- Types match the PRD data model exactly
- Proper use of `Option<T>` for optional fields

---

### 2. Implement `discover_skills` Tauri command ✅ DONE

**Description:** Scan a list of base directories for subdirectories containing `SKILL.md` files. Parse YAML frontmatter to extract metadata (name, description, license, compatibility, metadata, allowed-tools, user-invocable, disable-model-invocation). Return a flat `Vec<SkillEntry>` with source attribution. Do NOT read the full SKILL.md body (progressive disclosure).

Follow the filesystem scanning pattern in `commands/watcher.rs` (async, error handling, path normalization). Use `serde_yaml` for frontmatter parsing.

**Complexity:** L
**Category:** backend
**Dependencies:** #1
**Files:**
- Modify `src-tauri/src/commands/skills.rs`
- Modify `src-tauri/Cargo.toml` (add `serde_yaml` if not present)

**Acceptance criteria:**
- Scans directories recursively one level deep (skill dirs are direct children)
- Parses YAML frontmatter between `---` delimiters
- Returns source attribution per skill (which base directory it came from)
- Handles missing/malformed SKILL.md gracefully (skip with warning, don't fail)
- Handles non-existent base directories gracefully (skip, don't error)
- `has_scripts` and `has_references` flags set by checking directory existence

---

### 3. Implement `read_skill_content` Tauri command ✅ DONE

**Description:** Given an absolute path to a skill directory, read the full SKILL.md body (everything after YAML frontmatter) and list all files in `scripts/`, `references/`, and `assets/` subdirectories. This is the Level 2 progressive disclosure load.

**Complexity:** S
**Category:** backend
**Dependencies:** #1
**Files:**
- Modify `src-tauri/src/commands/skills.rs`

**Acceptance criteria:**
- Returns the markdown body (after frontmatter) as a string
- Lists relative paths for scripts, references, and assets
- Handles missing subdirectories gracefully (empty arrays)
- Returns error if skill directory doesn't exist or has no SKILL.md

---

### 4. Implement `execute_skill_script` Tauri command ✅ DONE

**Description:** Execute a script from a skill's `scripts/` directory with controlled environment. This is the critical security boundary — must validate paths, resolve interpreters, enforce timeouts, and capture output.

**High blast radius** — this command runs arbitrary code on the user's machine. Path traversal protection and timeout enforcement are non-negotiable.

**Complexity:** L
**Category:** backend
**Dependencies:** #1
**Files:**
- Modify `src-tauri/src/commands/skills.rs`

**Acceptance criteria:**
- Script path validated: must resolve to within the skill directory (canonicalize both, check prefix)
- Interpreter resolution: inspect shebang line first, fall back to extension mapping (.sh→bash, .py→python3, .js→node, .ts→npx tsx)
- Missing interpreter returns helpful error ("Python 3 not found. Install it to use this skill's scripts.")
- Timeout: default 30s, max 300s, process killed on timeout with `timed_out: true` in result
- Working directory: `working_dir` param or project root or home directory
- Environment: inherits user's shell env + optional extra env vars
- Captures stdout and stderr separately, returns both with exit_code
- Uses `tokio::process::Command` with `tokio::time::timeout`

---

### 5. Implement `read_agent_instructions` Tauri command ✅ DONE

**Description:** Discover and read agent instruction files for a project. Accepts the project root path and list of connected provider types. Checks for files in the defined priority order, returns array of `AgentInstruction` structs with source attribution and priority.

**Complexity:** M
**Category:** backend
**Dependencies:** #1
**Files:**
- Modify `src-tauri/src/commands/skills.rs`

**Acceptance criteria:**
- Discovery order: AGENTS.md (always) → CLAUDE.md (if claude connected) → GEMINI.md (if gemini connected) → ~/.notesage/agents.md (always) → .notesage/agents.md (always)
- Priority numbers assigned correctly (1=lowest, 5=highest)
- Each file read in full as content string
- Missing files skipped silently
- Works when project_root is None (only global files discovered)
- source_type field correctly identifies the file type

---

### 6. Register skill commands in Tauri builder ✅ DONE

**Description:** Add the new skills module and all commands to the Tauri command registration.

**Complexity:** S
**Category:** backend
**Dependencies:** #2, #3, #4, #5
**Files:**
- Modify `src-tauri/src/commands/mod.rs` — add `pub mod skills;`
- Modify `src-tauri/src/lib.rs` — add commands to `generate_handler![]`

**Acceptance criteria:**
- All four commands registered: `discover_skills`, `read_skill_content`, `execute_skill_script`, `read_agent_instructions`
- App compiles and starts without errors
- Commands callable from frontend via `invoke()`

---

### 7. Create `skill-store.ts` Zustand store ✅ DONE

**Description:** Central store for discovered skills and agent instructions. Persists `enabledOverrides` only — skills and agent instructions are rebuilt from scan. Provides computed getters for active skills (filtered by hierarchy and enabled state) and merged agent instructions.

Follow the pattern in `permission-store.ts` for separating persisted vs runtime state.

**Complexity:** M
**Category:** frontend
**Dependencies:** #6
**Files:**
- Create `src/stores/skill-store.ts`

**Acceptance criteria:**
- `skills: SkillEntry[]` — populated by scan, not persisted
- `enabledOverrides: Record<string, boolean>` — persisted via Zustand persist
- `agentInstructions: AgentInstruction[]` — populated by scan, not persisted
- `isScanning: boolean` — runtime flag
- `getActiveSkills()` — filters by enabled, resolves hierarchy (same-name: project > global > external)
- `getSkillDescriptionsForPrompt()` — formats active skills for system message injection
- `getMergedAgentInstructions()` — concatenates by priority order
- `scanSkills(baseDirs)` — calls `discover_skills` Tauri command
- `scanAgentInstructions(projectRoot, providers)` — calls `read_agent_instructions` Tauri command
- `toggleSkill(skillPath, enabled)` — updates enabledOverrides
- TypeScript interfaces for `SkillEntry`, `SkillContent`, `ScriptResult`, `AgentInstruction` matching Rust types

---

### 8. Extend `permission-store.ts` for skill script permissions ✅ DONE

**Description:** Add skill-specific script execution permissions to the existing permission store. Follow the same tiered pattern (session / always) already used for ACP tool calls.

**Complexity:** S
**Category:** frontend
**Dependencies:** #7
**Files:**
- Modify `src/stores/permission-store.ts`

**Acceptance criteria:**
- New `skillScriptSession: Set<string>` (non-persisted, cleared on app restart)
- New `skillScriptAlways: string[]` (persisted)
- `isSkillScriptAllowed(skillName: string): 'none' | 'session' | 'always'`
- `allowSkillScriptSession(skillName: string)`, `allowSkillScriptAlways(skillName: string)`
- `removeSkillScriptAlways(skillName: string)`
- Integrates with existing persist partialize (skillScriptAlways persisted, skillScriptSession excluded)

---

### 9. Create `useSkillOperations.ts` hook ✅ DONE

**Description:** Orchestration hook that manages skill discovery lifecycle: when to scan, which directories to scan based on connections, and how to trigger rescans. Also provides helpers for reading skill content and executing scripts.

**Complexity:** M
**Category:** frontend
**Dependencies:** #7, #8
**Files:**
- Create `src/hooks/useSkillOperations.ts`

**Acceptance criteria:**
- `useSkillDiscovery()` — runs initial scan on mount (after `startupReady`), rescans on connection changes and project open/close
- Reads `connections-store` to determine which provider paths to scan
- Maps provider types to filesystem paths (`claude-code` → `~/.claude/skills/`, etc.)
- Always includes `~/.notesage/skills/` and project-level `.notesage/skills/`
- `readSkillContent(skillName)` — calls `read_skill_content` Tauri command, returns `SkillContent`
- `executeScript(skillName, script, args)` — checks permission, calls `execute_skill_script`, returns `ScriptResult`
- Permission check flow: check permission-store → if 'none', show permission prompt → on allow, execute → on deny, return error

---

### 10. Integrate skill context into `useAIOperations.ts` — Direct API path ✅ DONE

**Description:** Modify the direct API code path to inject skill descriptions into the system message and add `execute_skill_script` and `read_skill_content` as function tools. When the model calls these tools, handle the tool call loop (call Tauri command → return result → continue conversation).

**High blast radius** — modifies the core AI integration. Must not break existing chat, inline actions, or web search functionality.

**Complexity:** L
**Category:** frontend
**Dependencies:** #7, #9
**Files:**
- Modify `src/hooks/useAIOperations.ts`
- Modify `src/lib/ai/types.ts` (add tool definitions)

**Acceptance criteria:**
- Active skill descriptions appended to system message for all direct API calls
- Agent instructions prepended to system message (before skill descriptions)
- Two new tool definitions added to Anthropic/OpenAI tool arrays: `execute_skill_script`, `read_skill_content`
- Tool call handling: when model calls `read_skill_content`, load skill body and return; when model calls `execute_skill_script`, check permissions, execute, return result
- Tool call results fed back to the model for continued generation
- Existing functionality (chat, inline actions, web search) unaffected
- Ollama: skill descriptions injected but tools not added (Ollama may not support tool use)
- Budget enforcement: skill descriptions capped at reasonable token count

---

### 11. Integrate skill context into `useAIOperations.ts` — ACP path ✅ DONE

**Description:** Modify the ACP code path to inject Notesage-specific skill descriptions into session prompts. Only inject `.notesage/skills/` — not external provider skills that the ACP agent discovers on its own. Agent instructions: only inject `.notesage/agents.md` files.

**Complexity:** M
**Category:** frontend
**Dependencies:** #10
**Files:**
- Modify `src/hooks/useAIOperations.ts`

**Acceptance criteria:**
- ACP prompts include Notesage-specific skill descriptions (project + global `.notesage/skills/` only)
- ACP prompts include Notesage-specific agent instructions (`.notesage/agents.md` only)
- External provider skills NOT injected (Claude Code discovers `~/.claude/skills/` itself)
- External agent files (CLAUDE.md, AGENTS.md, GEMINI.md) NOT injected for ACP
- `execute_skill_script` tool description included in ACP prompt context for Notesage skills
- Existing ACP chat and delegation functionality unaffected

---

### 12. Add tool call rendering for skill tools in `ChatMessage.tsx` ✅ DONE

**Description:** When the AI calls `execute_skill_script` or `read_skill_content`, display the tool call in the chat message with appropriate formatting: skill name, script path, and output in a collapsible code block.

Follow the existing pattern for ACP tool call rendering (activity entries).

**Complexity:** M
**Category:** frontend
**Dependencies:** #10
**Files:**
- Modify `src/components/chat/ChatMessage.tsx`

**Acceptance criteria:**
- Script execution shows: "Running `scripts/download.py` from skill `web-research`"
- Script output displayed in collapsible code block (stdout, stderr separated if both present)
- Exit code shown (success = green check, failure = red X)
- Timed-out scripts show warning indicator
- `read_skill_content` calls shown as "Loading skill: `web-research`"
- Styling consistent with existing ACP tool call display

---

### 13. Create `SkillsSettings.tsx` — Skills browser section ✅ DONE

**Description:** Settings tab component showing all discovered skills grouped by source, with enable/disable toggles, source badges, hierarchy override indicators, and action buttons.

**Complexity:** L
**Category:** frontend
**Dependencies:** #7, #9
**Files:**
- Create `src/components/settings/SkillsSettings.tsx`

**Acceptance criteria:**
- Skills grouped by source: Project, Global, Claude Code, Codex, Gemini (only sources with skills shown)
- Each skill entry: name, description (truncated to 2 lines), source badge, enable/disable Switch
- Overridden skills greyed out with "Overridden by [source]" text
- Project and Global groups have "+ New Skill" button (opens wizard)
- External provider groups shown as read-only (no enable/disable for individual skills? or toggle available)
- "Rescan" button in section header triggers `scanSkills()`
- Click skill name to open SKILL.md in editor (invoke `openFile` from `useFileOperations`)
- Empty state when no skills discovered: guidance text
- Follows existing settings component patterns (shadcn/ui components, design system compliance)

---

### 14. Create `SkillsSettings.tsx` — Agent Instructions section ✅ DONE

**Description:** Section within the Skills & Agents settings tab showing discovered agent instruction files with priority, source badges, and edit/create actions.

**Complexity:** M
**Category:** frontend
**Dependencies:** #13
**Files:**
- Modify `src/components/settings/SkillsSettings.tsx`

**Acceptance criteria:**
- List of discovered instruction files ordered by priority (highest first)
- Each entry: priority number, file name, source type badge, Edit button (for Notesage files) or "read-only" label (for external)
- Edit button opens file in editor
- "+ New Agent Instructions" button (opens wizard or creates file in `.notesage/agents.md`)
- "Preview Merged Context" collapsible section showing the concatenated agent instructions
- Empty state: guidance text explaining what agent instructions are

---

### 15. Add Skills & Agents tab to `SettingsDialog.tsx` ✅ DONE

**Description:** Register the new Skills & Agents tab in the settings dialog navigation, with appropriate icon. Place it logically in the tab order (after Connections, before Project).

**Complexity:** S
**Category:** frontend
**Dependencies:** #13
**Files:**
- Modify `src/components/settings/SettingsDialog.tsx`

**Acceptance criteria:**
- New tab "Skills & Agents" with appropriate icon (e.g., `Blocks` or `Puzzle` from lucide-react)
- Tab renders `SkillsSettings` component
- Tab position: after Connections/Routing, before Project settings
- Active tab highlighting consistent with existing tabs

---

### 16. Add skill slash commands to `ChatInput.tsx` ✅ DONE

**Description:** Extend the chat input to support `/skill-name` invocation. When the user types `/`, show an autocomplete dropdown listing available user-invocable skills (filtered by what they're typing). On selection, the skill name is sent as part of the prompt and the skill body is loaded and injected.

**Complexity:** L
**Category:** frontend
**Dependencies:** #7, #10
**Files:**
- Modify `src/components/chat/ChatInput.tsx`
- Potentially create `src/components/chat/SkillCommandMenu.tsx`

**Acceptance criteria:**
- Typing `/` at the start of the input shows a dropdown of user-invocable skills
- Dropdown filters as user types (case-insensitive substring match)
- Each entry shows skill name + short description
- Selecting a skill inserts `/skill-name` into the input
- On send, the `/skill-name` prefix is detected, the skill body is loaded, and injected into the prompt
- Skills with `user-invocable: false` are excluded from the dropdown
- Keyboard navigation: arrow keys, Enter to select, Escape to dismiss
- Dropdown styled consistently with existing UI (use shadcn Command or Popover)
- Empty state when no user-invocable skills: "No skills available"

---

### 17. Add agent instructions indicator to `StatusBar.tsx` ✅ DONE

**Description:** Show an indicator in the editor status bar when agent instruction files are loaded. Clicking it opens a popover showing which files are active and a preview of each.

Follow the existing Copilot status bar indicator pattern.

**Complexity:** M
**Category:** frontend
**Dependencies:** #7
**Files:**
- Modify `src/components/editor/StatusBar.tsx`

**Acceptance criteria:**
- Indicator visible when at least one agent instruction file is loaded (icon + file count)
- Icon: `FileText` or `ScrollText` from lucide-react, strokeWidth 1.5
- Click opens Popover showing list of loaded files: filename, source type, priority, content preview (first ~100 chars)
- Hidden when no agent instructions are loaded
- Indicator positioned in the right section of status bar, after existing indicators
- Works in both light and dark mode

---

### 18. Create `NewSkillWizard.tsx` dialog ✅ DONE

**Description:** Guided dialog for non-technical users to create skills. Collects description, name, scope, script options. On create, invokes the `create-skill` built-in skill (or directly scaffolds if the built-in skill isn't ready yet — fallback to direct file creation).

**Complexity:** L
**Category:** frontend
**Dependencies:** #9, #13, #20
**Files:**
- Create `src/components/NewSkillWizard.tsx`

**Acceptance criteria:**
- Multi-step dialog: Description → Name → Scope → Scripts → Review & Create
- Description: textarea for plain language description
- Name: auto-suggested from description (lowercase, hyphens), editable, validated against naming rules (1-64 chars, lowercase alphanumeric + hyphens, no consecutive hyphens)
- Scope: radio buttons — "This project" (`.notesage/skills/`) or "Global" (`~/.notesage/skills/`)
- Scripts toggle: if yes, select interpreter (Bash, Python, Node.js)
- Review step shows preview of generated SKILL.md content
- Create button: invokes create-skill skill via chat, or directly scaffolds directory + SKILL.md
- Success: toast notification, skill appears in skills browser
- Cancel at any step closes dialog
- Uses shadcn Dialog, Input, Textarea, RadioGroup, Switch, Button
- Responsive and polished in both themes

---

### 19. Create `NewAgentWizard.tsx` dialog ✅ DONE

**Description:** Guided dialog for creating agent instruction files. Collects description, scope, optional skill references. Creates `.notesage/agents.md` or appends to existing.

**Complexity:** M
**Category:** frontend
**Dependencies:** #9, #14, #21
**Files:**
- Create `src/components/NewAgentWizard.tsx`

**Acceptance criteria:**
- Steps: Description → Scope → Skill Access → Review & Create
- Description: textarea for what the agent should do
- Scope: Project or Global
- Skill access: multi-select of available skills the agent should reference
- Review: preview of generated markdown content
- Create: writes file via Tauri `write_file` command (or invokes create-agent skill)
- If file exists: ask whether to append or replace
- Success: toast, agent instructions indicator updates
- Uses shadcn Dialog, Textarea, RadioGroup, Checkbox, Button

---

### 20. Create `create-skill` bundled skill ✅ DONE

**Description:** Write the SKILL.md, scaffold script, validation script, and reference files for the built-in `create-skill` skill. This skill guides the AI through creating a well-formed skill directory.

**Complexity:** M
**Category:** both
**Dependencies:** #4 (script execution must work)
**Files:**
- Create `bundled-skills/create-skill/SKILL.md`
- Create `bundled-skills/create-skill/scripts/scaffold.sh`
- Create `bundled-skills/create-skill/scripts/validate.sh`
- Create `bundled-skills/create-skill/references/SKILL-SPEC.md`
- Create `bundled-skills/create-skill/references/EXAMPLES.md`

**Acceptance criteria:**
- SKILL.md has valid frontmatter (name, description matching spec)
- Instructions guide the AI through: asking what the skill should do, determining scope, running scaffold.sh, generating SKILL.md content, optionally generating scripts, running validate.sh
- `scaffold.sh` accepts arguments: skill name, target directory. Creates directory structure (skill-name/, SKILL.md template, scripts/, references/)
- `validate.sh` accepts skill directory path. Checks: SKILL.md exists, frontmatter has name + description, name matches directory name, name follows naming rules
- `SKILL-SPEC.md` contains a concise summary of the Agent Skills specification (for the AI to reference)
- `EXAMPLES.md` contains 2-3 example skills showing different patterns (simple prompt-only, with scripts, with references)

---

### 21. Create `create-agent` bundled skill ✅ DONE

**Description:** Write the SKILL.md, scaffold script, and reference files for the built-in `create-agent` skill.

**Complexity:** S
**Category:** both
**Dependencies:** #4
**Files:**
- Create `bundled-skills/create-agent/SKILL.md`
- Create `bundled-skills/create-agent/scripts/scaffold.sh`
- Create `bundled-skills/create-agent/references/AGENT-PATTERNS.md`
- Create `bundled-skills/create-agent/references/EXAMPLES.md`

**Acceptance criteria:**
- SKILL.md guides the AI through: asking what agent behavior is wanted, determining scope, creating/appending agents.md
- `scaffold.sh` creates `.notesage/agents.md` or `~/.notesage/agents.md` with template content
- `AGENT-PATTERNS.md` documents common patterns: research agent, code review agent, writing assistant
- `EXAMPLES.md` shows 2-3 example agent instruction files

---

### 22. Integrate bundled skills into app startup ✅ DONE

**Description:** Ensure bundled skills are discoverable at app startup. Bundled skills should be extracted from the app bundle to a known location (`~/.notesage/bundled-skills/`) on first run or when the app version changes. The discovery scan includes this directory automatically.

**Complexity:** M
**Category:** both
**Dependencies:** #2, #6, #20, #21
**Files:**
- Modify `src-tauri/src/commands/skills.rs` (add `extract_bundled_skills` command or startup logic)
- Modify `src-tauri/src/lib.rs` (call extraction on startup)
- Modify `src/hooks/useSkillOperations.ts` (include bundled skills path in scan)

**Acceptance criteria:**
- Bundled skills are available on first app launch without user action
- Bundled skill files are included in the Tauri app bundle (via `include_str!` or Tauri resource embedding)
- On startup, bundled skills extracted to `~/.notesage/bundled-skills/create-skill/` and `~/.notesage/bundled-skills/create-agent/`
- Extraction only runs if files are missing or app version has changed (avoid overwriting user modifications... actually bundled skills shouldn't be user-modifiable, always overwrite)
- `discover_skills` scan includes `~/.notesage/bundled-skills/` as a source with `source: "bundled"`
- Bundled skills appear in the skills browser with a "Built-in" badge

---

## Implementation Order

### Group 1: Backend (Tasks 1-6)
Build all Tauri commands first. Can test via direct `invoke()` calls from browser console.

```
#1 (S) → #2 (L), #3 (S), #4 (L), #5 (M) → #6 (S)
```

Tasks 2, 3, 4, 5 can be parallelized after task 1.

### Group 2: State Management (Tasks 7-8)
Create stores that wire frontend to backend.

```
#7 (M) → #8 (S)
```

### Group 3: Core Integration (Tasks 9-12)
Wire skills into the AI pipeline and chat UI.

```
#9 (M) → #10 (L) → #11 (M)
#10 → #12 (M)
```

### Group 4: UI & Bundled Skills (Tasks 13-22)
Build the user-facing components and bundled skills. Mostly parallelizable.

```
#13 (L) → #14 (M) → #15 (S)
#16 (L) — independent
#17 (M) — independent
#18 (L) — depends on #20
#19 (M) — depends on #21
#20 (M), #21 (S) — independent
#22 (M) — depends on #20, #21
```

## Risk Notes

- **Task 4 (script execution)** is the highest-risk task. Path traversal protection and process management must be correct from the start. Consider a security review before merging.
- **Tasks 10-11 (AI integration)** modify the core chat pipeline. Regression risk is high — test all existing AI flows (chat, inline actions, web search, ACP delegation) after changes.
- **Task 16 (slash commands)** may conflict with existing editor slash commands (`/` in editor). Must ensure chat input slash commands are isolated from editor slash commands.
- **Task 22 (bundled skills)** requires a decision on how to embed files in the Tauri binary. `include_str!` is simplest but limits file types. Tauri resource embedding is more flexible but requires build config changes.
