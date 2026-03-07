# PRD: Skills & Agents Platform

**Date:** 2026-03-05 **Status:** Steps A & C Complete (v0.18.0) **Parent:** Phase 7 (replaces AI-Assisted Research as standalone phase)

## Problem

Notesage's AI capabilities are currently hardcoded. Adding new functionality (research, code review, report writing) requires building each feature into the app. Users who already have skills and agent configurations from tools like Claude Code, Codex CLI, or Gemini CLI can't leverage them in Notesage. And users who want new AI capabilities must wait for app updates rather than installing a skill folder.

The AI development ecosystem has converged on two complementary open standards:

- **Agent Skills** (SKILL.md) — file-based capability definitions adopted by Claude Code, Codex CLI, Gemini CLI, VS Code Copilot, Cursor, and 30+ tools. 350,000+ skills available.
- **MCP (Model Context Protocol)** — tool server protocol adopted by all major AI tools for exposing callable functions.

Notesage should adopt these standards rather than build a proprietary system, so users get instant access to existing skills and tools.

## Goals

### Step A — Agent Skills & Script Execution

1. **Discover existing skills** from connected providers' filesystem paths (e.g., `~/.claude/skills/` when Claude Code is connected)
2. **Notesage skill hierarchy** — project-level `.notesage/skills/` overrides global `~/.notesage/skills/`, which overrides external provider skills
3. **Agent instruction files** — `.notesage/agents.md` (project) and `~/.notesage/agents.md` (global) injected into AI context, with discovery of existing AGENTS.md/CLAUDE.md/GEMINI.md
4. **Script execution runtime** — Tauri command for running skill scripts, available to all connection types (ACP and direct API)
5. **Built-in meta-skills** — `create-skill` and `create-agent` skills ship with the app, enabling users to create new skills from within Notesage
6. **Wizard UI** — guided dialog for non-technical users to create skills and agents
7. **Skills browser** — settings UI for viewing, enabling/disabling, and managing discovered skills
8. **Uniform injection** — skills work across all connection types (ACP, direct API) where possible

### Step B — MCP Client Integration (future, outlined only)

1. MCP client in Rust backend (stdio transport)
2. Server lifecycle management (spawn, connect, disconnect)
3. Tool discovery and invocation
4. Import existing MCP servers from other tools' config files
5. Settings UI for MCP server management

### Step C — Addressable Agents (✅ Implemented, separate PRD)

Replace the hardcoded persona system with discoverable, file-based agents aligned with the industry standard (GitHub Copilot, Claude Code, VS Code Copilot). Agents are markdown files with YAML frontmatter in `agents/` directories, selectable via dropdown or `@agent-name` in chat. See `docs/prds/2026-03-07-addressable-agents.md` for full specification.

1. Discover agent files from `agents/` directories (same scanning pattern as skills)
2. Replace persona picker with agent dropdown
3. `@agent-name` addressing in chat input
4. Agent-to-skill connection via `allowed-tools` frontmatter
5. Per-agent model preference via `model` frontmatter
6. Migrate built-in personas to bundled agent files
7. One-time migration of custom personas to agent `.md` files

## Non-Goals

- Building a proprietary skill format (use the open Agent Skills standard)
- MCP support in Step A (deferred to Step B)
- Skill marketplace or publishing (users manage skill folders manually)
- Parallel skill execution (sequential, one at a time)
- Hot-reload of skills while a prompt is in-flight (discovery runs at startup + on demand)
- OS-level sandboxing of script execution (deferred to Phase 10)
- Modifying files outside `.notesage/` or `~/.notesage/` (external skills are read-only)

## User Stories

1. **As a user with Claude Code**, I want my existing `~/.claude/skills/` to be available in Notesage, so I don't have to duplicate my skills setup.
2. **As a user**, I want to drop a skill folder into `.notesage/skills/` and have it immediately available to the AI, without rebuilding the app.
3. **As a user**, I want to create a "research-agent" with access to skills like `download-webpage` and `write-research-report`, so I can delegate research tasks.
4. **As a non-technical user**, I want a wizard that helps me create a skill step by step, so I don't need to know the SKILL.md format.
5. **As an advanced user**, I want to prompt the AI to "create a skill that downloads a webpage and converts it to markdown," and have it generate the full skill folder for me.
6. **As a user**, I want project-level skills to override my global skills when I'm in a specific project, so different projects can have specialized capabilities.
7. **As a user**, I want to see all available skills (with their sources) in one place and enable/disable them.
8. **As a user**, I want agent instruction files (`.notesage/agents.md`) to shape how the AI behaves in my project, like CLAUDE.md does in Claude Code.
9. **As a user with direct API keys** (no ACP agent), I want skills with scripts to still work, so I'm not locked out of skill functionality.

## Technical Approach

### Skill Discovery

Scan filesystem paths to build a unified skill registry. Paths scanned depend on which providers the user has connected (read from `connections-store`):

| Connection Provider | Paths Scanned |
| --- | --- |
| Claude Code (ACP) | `~/.claude/skills/` |
| Codex CLI (ACP) | `~/.codex/skills/` |
| Gemini CLI (ACP) | `~/.gemini/skills/`, `~/.agents/skills/` |
| Copilot CLI (ACP) | `~/.agents/skills/` |
| Copilot LSP | `~/.agents/skills/` |
| (always) | `~/.notesage/skills/`, `.notesage/skills/` (per open project) |

**Discovery is a Rust-side Tauri command** (`discover_skills`) that:

1. Accepts a list of base directories to scan
2. For each directory, finds subdirectories containing a `SKILL.md` file
3. Parses YAML frontmatter (name, description, license, compatibility, metadata, allowed-tools)
4. Returns a flat list of `SkillEntry` structs with source attribution
5. Does NOT read the full SKILL.md body (progressive disclosure — body loaded on demand)

**Hierarchy resolution** (later overrides earlier, same-name skills shadow):

1. External provider skills (lowest priority)
2. `~/.notesage/skills/` (global Notesage)
3. `.notesage/skills/` per project (highest priority)

When multiple sources provide a skill with the same name, the highest-priority version is used. Lower-priority versions are still visible in the skills browser (greyed out, showing "overridden by \[source\]").

**Scan triggers:**

- App startup (after `startupReady`)
- Project open/close (rescan project-level skills)
- Connection added/removed (rescan relevant provider paths)
- Manual rescan button in skills browser
- Filesystem watcher detects changes in skill directories (extend existing watcher infrastructure)

### Agent Instruction Files

Agent instruction files provide always-on context injected into every AI prompt. Notesage discovers and concatenates these files:

**Discovery order (all concatenated, later takes precedence for conflicts):**

1. `AGENTS.md` in project root (universal cross-tool standard, always discovered)
2. `CLAUDE.md` in project root (if a Claude connection exists)
3. `GEMINI.md` in project root (if a Gemini connection exists)
4. `~/.notesage/agents.md` (global Notesage instructions)
5. `.notesage/agents.md` (project-level Notesage instructions — highest priority)

**Reading is a Rust-side Tauri command** (`read_agent_instructions`) that:

1. Accepts the project root path and a list of connected provider types
2. Checks for each file in the discovery order
3. Returns an array of `{ source: string, content: string, priority: number }`
4. Frontend concatenates and injects into AI system prompt

**Injection behavior:**

- For **direct API** connections: concatenated agent instructions prepended to the system message, before skill descriptions
- For **ACP** connections: concatenated agent instructions included in the session prompt context (Notesage-specific instructions only — the ACP agent discovers its own CLAUDE.md/AGENTS.md independently)

**Important distinction for ACP:** When using an ACP agent like Claude Code, the agent already discovers and loads `CLAUDE.md` and `AGENTS.md` from the project root on its own. To avoid duplication, Notesage only injects `.notesage/agents.md` (project) and `~/.notesage/agents.md` (global) into the ACP prompt — not the external files that the agent handles itself.

### Script Execution Runtime

A Tauri command that runs scripts from skill directories in a controlled environment. This is the bridge that makes skills with scripts work for ALL connection types.

**Tauri command:** `execute_skill_script`

```rust
#[tauri::command]
pub async fn execute_skill_script(
    skill_path: String,      // absolute path to the skill directory
    script: String,           // relative path within the skill (e.g., "scripts/download.py")
    args: Vec<String>,        // arguments to pass to the script
    working_dir: Option<String>, // override working directory (default: project root)
    env: Option<HashMap<String, String>>, // additional environment variables
    timeout_ms: Option<u64>,  // timeout in milliseconds (default: 30000)
) -> Result<ScriptResult, String>
```

```rust
#[derive(Serialize)]
pub struct ScriptResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}
```

**Security constraints (pre-Phase 10):**

- Script path must resolve to within the skill directory (prevent path traversal)
- Working directory defaults to the project root (or home directory if no project)
- Timeout default: 30 seconds, max: 5 minutes
- stdout/stderr captured and returned (not streamed — streaming deferred to later)
- Environment inherits the user's shell environment + any skill-specified env vars
- No network restriction (deferred to Phase 10 sandboxing)
- Script must be executable (chmod +x) or invoked via interpreter (python, node, bash)

**Interpreter resolution:**

The command inspects the script's shebang line (`#!/usr/bin/env python3`) or file extension to determine the interpreter:

| Extension | Interpreter |
| --- | --- |
| `.sh` | `bash` (or `sh`) |
| `.py` | `python3` (falls back to `python`) |
| `.js` | `node` |
| `.ts` | `npx tsx` (or `ts-node`) |
| (no ext) | Direct execution (must be executable) |

If the required interpreter is not found on `$PATH`, the command returns an error with a helpful message ("Python 3 not found. Install it to use this skill's scripts.").

**Exposure as an AI tool:**

For direct API connections, the script execution capability is exposed as a function tool that the model can call:

```json
{
  "name": "execute_skill_script",
  "description": "Execute a script from a skill's scripts/ directory. Use this to run skill scripts that perform specific actions like downloading web pages, processing files, or generating content.",
  "input_schema": {
    "type": "object",
    "properties": {
      "skill_name": {
        "type": "string",
        "description": "Name of the skill containing the script"
      },
      "script": {
        "type": "string",
        "description": "Relative path to the script within the skill directory (e.g., 'scripts/download.py')"
      },
      "args": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Arguments to pass to the script"
      }
    },
    "required": ["skill_name", "script"]
  }
}
```

When the model calls this tool, the frontend:

1. Resolves `skill_name` to an absolute path via the skill registry
2. Validates the script path is within the skill directory
3. Checks permission (user approval — see Permission Model below)
4. Calls the `execute_skill_script` Tauri command
5. Returns the `ScriptResult` to the model as the tool result

For ACP connections, the agent already has shell access and can run scripts directly. Notesage's script execution tool is still available as an alternative path that will integrate with Phase 10 sandboxing.

### Permission Model

Script execution requires user approval, extending the existing ACP permission system:

| Permission Tier | Behavior |
| --- | --- |
| **Per-execution** (default) | User sees a permission card: "Run `scripts/download.py` from skill `web-research`?" with Allow / Deny |
| **Per-session** | "Allow all scripts from `web-research` for this session" — non-persisted |
| **Always** | "Always allow scripts from `web-research`" — persisted in permission-store |

For ACP connections, this integrates with the existing `PermissionCard` UI. For direct API, a new permission prompt is shown inline in the chat when the model calls `execute_skill_script`.

Skills with `allowed-tools` in their frontmatter can pre-declare which scripts they need. The permission card shows these upfront when the skill is first activated.

### Skill Injection into AI Prompts

How skills are presented to the AI depends on the connection type:

**Direct API (Anthropic, OpenAI, Ollama):**

1. All active skill descriptions (name + description, \~100 tokens each) appended to the system message
2. The `execute_skill_script` function tool added to the tools array
3. A `read_skill_content` function tool added so the model can load a skill's full body on demand
4. When the model decides a skill is relevant, it calls `read_skill_content` to load the full SKILL.md body and any references
5. The model follows the skill's instructions and calls `execute_skill_script` to run scripts

```json
{
  "name": "read_skill_content",
  "description": "Load the full instructions and file listing of a skill. Call this when you determine a skill is relevant to the current task.",
  "input_schema": {
    "type": "object",
    "properties": {
      "skill_name": {
        "type": "string",
        "description": "Name of the skill to load"
      }
    },
    "required": ["skill_name"]
  }
}
```

**ACP (Claude Code, Codex, Gemini CLI, Copilot CLI):**

1. The ACP agent discovers its own provider-specific skills independently
2. Notesage injects only `.notesage/skills/` descriptions into the session prompt
3. The `execute_skill_script` tool is offered for Notesage-specific skills
4. The agent uses its own tools (Bash, Read, etc.) for provider-specific skills

**Progressive disclosure (matches the Agent Skills spec):**

- **Level 1 (always loaded):** name + description for all active skills (\~100 tokens each). Budget: 2% of context window.
- **Level 2 (on demand):** Full SKILL.md body loaded when skill is activated (&lt;5000 tokens recommended per skill)
- **Level 3 (on demand):** Files in `scripts/`, `references/`, `assets/` loaded only when explicitly needed

### Built-in Skills

Two meta-skills ship with the app in a bundled skills directory:

#### `create-skill`

```
bundled-skills/create-skill/
  SKILL.md
  scripts/
    scaffold.sh          # Creates directory structure and template SKILL.md
    validate.sh          # Validates a SKILL.md file against the spec
  references/
    SKILL-SPEC.md        # Agent Skills specification summary
    EXAMPLES.md          # Example skills for reference
```

SKILL.md frontmatter:

```yaml
---
name: create-skill
description: >
  Creates a new Agent Skill directory with SKILL.md and optional scripts.
  Use when the user wants to create a new skill, add a capability,
  or package a workflow as a reusable skill.
---
```

The skill's instructions guide the AI to:

1. Ask the user what the skill should do (if not already specified)
2. Determine the scope (project `.notesage/skills/` or global `~/.notesage/skills/`)
3. Run `scripts/scaffold.sh` to create the directory structure
4. Generate the SKILL.md content (frontmatter + instructions)
5. Optionally generate scripts for deterministic operations
6. Run `scripts/validate.sh` to check the result
7. Confirm the new skill is discoverable

#### `create-agent`

```
bundled-skills/create-agent/
  SKILL.md
  scripts/
    scaffold.sh          # Creates agents.md file with template
  references/
    AGENT-PATTERNS.md    # Common agent instruction patterns
    EXAMPLES.md          # Example agent files
```

SKILL.md frontmatter:

```yaml
---
name: create-agent
description: >
  Creates or modifies agent instruction files (.notesage/agents.md).
  Use when the user wants to define agent behavior, create a specialized
  agent persona, or configure how AI operates in their project.
---
```

The skill's instructions guide the AI to:

1. Ask the user what kind of agent behavior they want
2. Determine the scope (project `.notesage/agents.md` or global `~/.notesage/agents.md`)
3. Generate the agent instructions markdown
4. If the file already exists, append or merge (ask the user)
5. Confirm the instructions are loaded

### Wizard UI

A guided dialog for users who don't know the SKILL.md format. Accessible from:

- Settings &gt; Skills & Agents &gt; "New Skill" button
- Command palette: "Create New Skill"
- Chat: the AI can suggest opening the wizard

**Wizard steps:**

1. **What does it do?** — Text area for describing the skill in plain language
2. **Name** — Auto-suggested from description, editable. Validated against naming rules.
3. **Scope** — Project or Global (radio buttons, project default)
4. **Scripts needed?** — Toggle. If yes, select interpreter (Bash, Python, Node.js) and describe what each script should do.
5. **Review & Create** — Preview of generated SKILL.md + directory structure. Edit button opens in editor.

Under the hood, the wizard invokes the `create-skill` built-in skill to generate the files. The wizard UI pre-fills the prompt with the user's inputs, so the AI does the actual generation.

For "Create Agent", a similar wizard with:

1. **What should the agent do?** — Text area
2. **Scope** — Project or Global
3. **Skill access** — Multi-select of available skills this agent should reference
4. **Review & Create** — Preview of generated agents.md content

### Settings UI — Skills & Agents Tab

New tab in the settings dialog:

**Skills section:**

- List of all discovered skills grouped by source:
  - `.notesage/skills/` (Project) — with "New Skill" button
  - `~/.notesage/skills/` (Global) — with "New Skill" button
  - `~/.claude/skills/` (Claude Code) — read-only
  - `~/.codex/skills/` (Codex) — read-only
  - `~/.gemini/skills/` (Gemini) — read-only
- Each skill entry shows: name, description (truncated), source badge, enable/disable toggle
- Overridden skills shown greyed out with "Overridden by \[source\]" label
- Click skill name to open SKILL.md in the editor
- "Rescan" button to trigger re-discovery

**Agents section:**

- List of discovered agent instruction files with source and priority
- `.notesage/agents.md` entries are editable (click to open in editor)
- External files (CLAUDE.md, AGENTS.md, GEMINI.md) shown as read-only with source badge
- "New Agent Instructions" button (opens wizard or creates file)
- Preview of concatenated agent context (collapsible, shows what gets injected)

### Chat Integration

**Skill invocation in chat:**

- User can type `/skill-name` in the chat input to explicitly invoke a skill (similar to Claude Code slash commands)
- Auto-complete dropdown shows available user-invocable skills
- The skill's full body is loaded and injected into the next prompt

**Automatic skill activation:**

- The AI sees all skill descriptions in its system context
- When it determines a skill is relevant, it calls `read_skill_content` to load it
- No user intervention needed — the AI decides when to use skills

**Script execution visibility:**

- When a skill script runs, it appears in the chat as a tool-use activity (same pattern as ACP tool calls)
- Script output shown in a collapsible code block
- Permission prompts inline in the chat (for direct API connections)

**Agent instructions indicator:**

- Status bar shows an icon when agent instructions are active (similar to Copilot icon)
- Click to see which files are loaded and their content preview
- Shows instruction file count: "2 agent files loaded"

### Tauri Commands (New)

```rust
// Discover skills from specified directories
#[tauri::command]
pub async fn discover_skills(
    base_dirs: Vec<String>,
) -> Result<Vec<SkillEntry>, String>

// Read the full content of a skill (body + file listing)
#[tauri::command]
pub async fn read_skill_content(
    skill_path: String,
) -> Result<SkillContent, String>

// Execute a script from a skill directory
#[tauri::command]
pub async fn execute_skill_script(
    skill_path: String,
    script: String,
    args: Vec<String>,
    working_dir: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<ScriptResult, String>

// Read agent instruction files for a project
#[tauri::command]
pub async fn read_agent_instructions(
    project_root: Option<String>,
    connected_providers: Vec<String>,
) -> Result<Vec<AgentInstruction>, String>
```

### Files Created/Modified

**New Rust files:**

- `src-tauri/src/commands/skills.rs` — skill discovery, content reading, script execution commands
- `src-tauri/src/commands/agents.rs` — agent instruction file discovery and reading (or combined into skills.rs)

**New frontend files:**

- `src/stores/skill-store.ts` — discovered skills registry, enable/disable state
- `src/hooks/useSkillOperations.ts` — skill discovery orchestration, skill-aware prompt building
- `src/components/settings/SkillsSettings.tsx` — Skills & Agents settings tab
- `src/components/NewSkillWizard.tsx` — guided skill creation dialog
- `src/components/NewAgentWizard.tsx` — guided agent creation dialog

**Modified frontend files:**

- `src/hooks/useAIOperations.ts` — inject skill descriptions and tools into prompts, handle `execute_skill_script` and `read_skill_content` tool calls
- `src/components/chat/ChatInput.tsx` — slash command autocomplete for skills
- `src/components/chat/ChatMessage.tsx` — render script execution tool calls
- `src/components/editor/StatusBar.tsx` — agent instructions indicator
- `src/components/settings/SettingsDialog.tsx` — add Skills & Agents tab
- `src/stores/settings-store.ts` — skill-related preferences

**Bundled skill files (shipped with app):**

- `bundled-skills/create-skill/SKILL.md`
- `bundled-skills/create-skill/scripts/scaffold.sh`
- `bundled-skills/create-skill/scripts/validate.sh`
- `bundled-skills/create-skill/references/SKILL-SPEC.md`
- `bundled-skills/create-skill/references/EXAMPLES.md`
- `bundled-skills/create-agent/SKILL.md`
- `bundled-skills/create-agent/scripts/scaffold.sh`
- `bundled-skills/create-agent/references/AGENT-PATTERNS.md`
- `bundled-skills/create-agent/references/EXAMPLES.md`

**Modified Rust files:**

- `src-tauri/src/commands/mod.rs` — register new commands
- `src-tauri/src/lib.rs` — add commands to `generate_handler![]`

## UI/UX

### Skills & Agents Settings Tab

```
┌─────────────────────────────────────────────────────────────┐
│  Skills & Agents                                            │
│─────────────────────────────────────────────────────────────│
│                                                             │
│  SKILLS                                          [Rescan]   │
│                                                             │
│  Project (.notesage/skills/)              [+ New Skill]     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ◉ web-research                                     │    │
│  │    Downloads web pages and converts to markdown      │    │
│  │  ◉ write-report                                     │    │
│  │    Generates structured reports from sources         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Global (~/.notesage/skills/)             [+ New Skill]     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ◉ code-review                                      │    │
│  │    Reviews code for best practices                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Claude Code (~/.claude/skills/)                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ◎ code-review              overridden by Global     │    │
│  │    Reviews code for security and performance         │    │
│  │  ◉ git-commit                                       │    │
│  │    Creates well-formatted git commits                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ───────────────────────────────────────────────────────    │
│                                                             │
│  AGENT INSTRUCTIONS                                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  5  .notesage/agents.md (Project)           [Edit]  │    │
│  │  4  ~/.notesage/agents.md (Global)          [Edit]  │    │
│  │  3  AGENTS.md (Project root)             read-only  │    │
│  │  2  CLAUDE.md (Project root)             read-only  │    │
│  │  1  GEMINI.md (Project root)             read-only  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  [+ New Agent Instructions]    [Preview Merged Context ▸]   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Skill Creation Wizard

```
┌─────────────────────────────────────────────────────────┐
│  Create New Skill                                   [×] │
│─────────────────────────────────────────────────────────│
│                                                         │
│  What should this skill do?                             │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Download a web page, extract its main content,  │    │
│  │ and save it as a clean markdown file             │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Skill name                                             │
│  ┌─────────────────────────────────────────────────┐    │
│  │ download-webpage                                │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Scope                                                  │
│  (•) This project    ( ) Global (all projects)          │
│                                                         │
│  Include scripts?                                       │
│  [■] Yes — this skill needs executable scripts          │
│                                                         │
│  Script interpreter                                     │
│  ( ) Bash    (•) Python    ( ) Node.js                  │
│                                                         │
│                         [Cancel]  [Create Skill]        │
└─────────────────────────────────────────────────────────┘
```

Clicking "Create Skill" invokes the `create-skill` built-in skill with the wizard inputs as the prompt. The AI generates the SKILL.md and scripts, then the skill appears in the skills browser.

### Chat Skill Invocation

```
┌───────────────────────────────────────────────────────────┐
│  You: /web-research                                       │
│  Research the latest developments in battery technology    │
│──────────────────────────────────────────────────────────│
│  AI: I'll research battery technology developments.       │
│                                                           │
│  ▸ Loading skill: web-research                            │
│  ▸ Running: scripts/search.py "battery technology 2026"   │
│    ┌────────────────────────────────────────────────┐      │
│    │ Found 12 results. Saving top 5 sources...     │      │
│    │ Saved: source-1.md, source-2.md, ...          │      │
│    └────────────────────────────────────────────────┘      │
│  ▸ Running: scripts/synthesize.py --sources 5             │
│    ┌────────────────────────────────────────────────┐      │
│    │ Synthesis complete. Report saved to            │      │
│    │ .notesage/research/battery-tech-2026.md        │      │
│    └────────────────────────────────────────────────┘      │
│                                                           │
│  I've researched the topic and saved a synthesis...       │
└───────────────────────────────────────────────────────────┘
```

### Status Bar — Agent Instructions Indicator

```
┌──────────────────────────────────────────────────────────────────────┐
│  Ln 42, Col 15  │  UTF-8  │  Markdown  │  📋 2 agent files  │  ⚙  │
└──────────────────────────────────────────────────────────────────────┘
```

Click opens a popover showing which instruction files are loaded and a preview of each.

## Data Model

### Rust Structs

```rust
#[derive(Serialize, Deserialize)]
pub struct SkillEntry {
    pub name: String,
    pub description: String,
    pub path: String,              // absolute path to skill directory
    pub source: String,            // "notesage-project" | "notesage-global" | "claude" | "codex" | "gemini" | "agents" | "bundled"
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub metadata: Option<HashMap<String, String>>,
    pub allowed_tools: Option<Vec<String>>,
    pub user_invocable: Option<bool>,        // default true
    pub disable_model_invocation: Option<bool>, // default false
    pub has_scripts: bool,         // true if scripts/ directory exists
    pub has_references: bool,      // true if references/ directory exists
}

#[derive(Serialize, Deserialize)]
pub struct SkillContent {
    pub name: String,
    pub body: String,              // full SKILL.md markdown body (after frontmatter)
    pub scripts: Vec<String>,      // relative paths to script files
    pub references: Vec<String>,   // relative paths to reference files
    pub assets: Vec<String>,       // relative paths to asset files
}

#[derive(Serialize, Deserialize)]
pub struct ScriptResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

#[derive(Serialize, Deserialize)]
pub struct AgentInstruction {
    pub source: String,            // file path
    pub source_type: String,       // "notesage-project" | "notesage-global" | "agents-md" | "claude-md" | "gemini-md"
    pub content: String,
    pub priority: u8,              // 1 (lowest) to 5 (highest)
}
```

### Frontend Store: `skill-store.ts`

```typescript
interface SkillStore {
  // State
  skills: SkillEntry[];                    // all discovered skills
  enabledOverrides: Record<string, boolean>; // user overrides (skill path → enabled)
  agentInstructions: AgentInstruction[];   // discovered agent instruction files
  lastScanTimestamp: number;
  isScanning: boolean;

  // Computed
  getActiveSkills(): SkillEntry[];         // filtered: enabled, not overridden, respects hierarchy
  getSkillByName(name: string): SkillEntry | undefined;
  getSkillDescriptionsForPrompt(): string; // formatted for system message injection
  getMergedAgentInstructions(): string;    // concatenated by priority

  // Actions
  scanSkills(baseDirs: string[]): Promise<void>;
  scanAgentInstructions(projectRoot: string | null, providers: string[]): Promise<void>;
  toggleSkill(skillPath: string, enabled: boolean): void;
  resetOverrides(): void;
}
```

Persisted via Zustand persist middleware: `enabledOverrides` persisted, `skills` and `agentInstructions` rebuilt from scan.

### Integration with Existing Stores

`connections-store` — read to determine which provider paths to scan:

```typescript
// Map connection provider to skill discovery paths
function getSkillPathsForConnection(connection: Connection): string[] {
  switch (connection.provider) {
    case 'claude-code': return [resolve('~/.claude/skills/')];
    case 'codex':       return [resolve('~/.codex/skills/')];
    case 'gemini':      return [resolve('~/.gemini/skills/'), resolve('~/.agents/skills/')];
    case 'copilot-cli': return [resolve('~/.agents/skills/')];
    case 'copilot-lsp': return [resolve('~/.agents/skills/')];
    default:            return [];
  }
}
```

`permission-store` — extended with skill script permissions:

```typescript
// Existing permission store, extended
interface PermissionStore {
  // ... existing fields
  skillScriptAllowed: Record<string, 'session' | 'always'>; // skill name → tier
}
```

`ai-store` **/** `useAIOperations` — modified to inject skill context into prompts:

- Before sending any prompt (chat or inline action), build the skill context:
  1. Get active skill descriptions from `skill-store`
  2. Get merged agent instructions from `skill-store`
  3. For direct API: prepend to system message + add tool definitions
  4. For ACP: include Notesage-specific skills in prompt context

## Dependencies

### New Rust Dependencies

- None required for Step A. Script execution uses `std::process::Command`. YAML parsing uses `serde_yaml` (already in Cargo.toml for frontmatter parsing elsewhere) or a lightweight YAML frontmatter parser.

### New Frontend Dependencies

- None required. Uses existing shadcn/ui components (Dialog, Tabs, ScrollArea, Switch, Collapsible, Command, Button, Input, Textarea, Badge, Popover).

### Runtime Dependencies (User's Machine)

- Script interpreters are **not bundled** — skills that use Python/Node.js require the user to have them installed
- Bash is available on all macOS/Linux systems
- If an interpreter is missing, the execution command returns a clear error guiding the user to install it

## Quality Gates

### Functional — Discovery

- [x] Skills in `~/.claude/skills/` are discovered when Claude Code is connected

- [x] Skills in `~/.codex/skills/` are discovered when Codex is connected

- [x] Skills in `~/.gemini/skills/` are discovered when Gemini is connected

- [x] Skills in `.notesage/skills/` (project) are always discovered

- [x] Skills in `~/.notesage/skills/` (global) are always discovered

- [x] Bundled skills (`create-skill`, `create-agent`) are always discovered

- [x] Same-name skills are resolved by hierarchy (project &gt; global &gt; external)

- [x] Overridden skills shown as greyed out in skills browser

- [x] Adding a skill folder triggers re-discovery (via filesystem watcher)

- [x] Removing a connected provider removes its skills from the registry

### Functional — Agent Instructions

- [x] `.notesage/agents.md` is discovered and injected into prompts

- [x] `~/.notesage/agents.md` is discovered and injected into prompts

- [x] `AGENTS.md` in project root is always discovered

- [x] `CLAUDE.md` in project root is discovered only when Claude is connected

- [x] `GEMINI.md` in project root is discovered only when Gemini is connected

- [x] Instructions are concatenated in correct priority order

- [x] For ACP connections, only Notesage-specific instructions are injected (no duplication)

- [x] Status bar shows agent instruction indicator when files are loaded

### Functional — Script Execution

- [x] Bash scripts execute correctly via `execute_skill_script`

- [x] Python scripts execute correctly (when Python is installed)

- [x] Node.js scripts execute correctly (when Node is installed)

- [x] Scripts that exceed timeout are killed and return `timed_out: true`

- [x] Path traversal attempts are rejected (script must be within skill directory)

- [x] Missing interpreter returns clear error message

- [x] Script stdout/stderr are captured and returned to the AI

- [x] Permission prompt appears before first script execution

- [x] Session and always permission tiers work correctly

- [x] Script execution works for direct API connections (tool call flow)

- [x] Script execution works for ACP connections (tool available)

### Functional — Skill Invocation

- [x] AI automatically activates relevant skills based on descriptions (direct API)

- [x] User can invoke skills via `/skill-name` in chat input

- [x] Slash command autocomplete shows available user-invocable skills

- [x] Skills with `disable-model-invocation: true` are not auto-activated

- [x] Skills with `user-invocable: false` are not shown in slash command menu

- [x] Progressive disclosure: only description loaded initially, body on demand

- [x] `read_skill_content` tool returns full skill body and file listing

### Functional — Built-in Skills

- [x] `create-skill` generates a valid SKILL.md with correct frontmatter

- [x] `create-skill` creates directory structure in correct scope (project/global)

- [x] `create-skill` generates scripts when requested

- [x] `create-agent` generates agent instruction file in correct scope

- [x] `create-agent` appends to existing file when one already exists

- [x] Wizard UI invokes `create-skill` with pre-filled inputs

- [x] Wizard UI validates skill name against naming rules

- [x] Newly created skills appear in skills browser without manual rescan

### Design

- [x] Skills & Agents settings tab matches app design system

- [x] Skill entries have clear source attribution badges

- [x] Overridden skills are visually distinct (greyed out)

- [x] Wizard dialog is clean and guides the user step by step

- [x] Script execution output in chat is readable (collapsible code blocks)

- [x] Permission prompts are clear and non-intrusive

- [x] Status bar agent instruction indicator is subtle and informative

- [x] All UI works in both light and dark mode

- [x] Smooth transitions for skill browser expand/collapse

## Out of Scope

- **MCP client integration** — Step B, separate implementation after Step A is stable
- **OS-level sandboxing** — Phase 10 (Seatbelt on macOS, Bubblewrap on Linux)
- **Skill marketplace / publishing** — users manage skill folders manually
- **Streaming script output** — stdout/stderr returned after completion, not streamed
- **Skill versioning or updates** — users manage versions via git or manual download
- **Multi-skill orchestration** — skills are invoked one at a time; the AI can chain them sequentially
- **Custom interpreters** — only bash, python, node.js supported initially
- **Windows support** — macOS primary, Linux secondary. Windows path handling deferred.
- **Skill sharing between users** — no built-in sharing mechanism (use git repos)
- **Agent instruction imports** (`@path` syntax) — simple file concatenation only, no recursive imports
- **Skill-specific model selection** — all skills use the active connection's model
- **Network restrictions for scripts** — no firewall/proxy rules pre-Phase 10

## Step B — MCP Client Integration (Outline)

Deferred to a separate implementation phase after Step A is stable. High-level approach:

1. **Rust MCP client** using `rmcp` crate or `rust-mcp-sdk` — stdio transport for local servers
2. **Server lifecycle** — spawn, connect, health check, reconnect, shutdown (tied to app lifecycle, `kill_on_drop`)
3. **Tool discovery** — `listTools()` from connected servers, merged with skill registry
4. **Tool execution** — `executeTool()` with structured JSON input/output, permission model aligned with skill script permissions
5. **Import from other tools** — read `claude_desktop_config.json`, `~/.cursor/mcp.json`, etc. to discover user's existing MCP servers
6. **Configuration** — `.notesage/mcp.json` (project) and `~/.notesage/mcp.json` (global) for Notesage-specific server definitions
7. **Settings UI** — MCP Servers section in Skills & Agents tab: server list, add/edit/remove, connection status, test button
8. **Hierarchy** — project MCP servers override global, which override imported servers (same pattern as skills)

## Relationship to Other Phases

- **Phase 10 (Agent Binary Management & Runtime Sandboxing):** Step A's `execute_skill_script` is the primary target for Phase 10's OS-level sandboxing. When Phase 10 lands, script execution gains Seatbelt/Bubblewrap isolation with no changes to the skill format or discovery system.
- **Original Phase 7 (AI-Assisted Research):** Becomes a skill pack shipped with the app — `download-webpage`, `save-research`, `synthesize-sources` skills using the Step A infrastructure. No longer requires custom hardcoded features.
- **Phase 8 (Workflows & Automation):** Could be implemented as a `workflow-runner` skill that reads YAML workflow definitions from `.notesage/workflows/` and executes them step by step.