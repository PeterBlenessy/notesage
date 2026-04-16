# PRD: Agent System Simplification

|  |  |
| --- | --- |
| **Date** | 2026-04-16 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Removes dead-weight bundled agents, makes `@` addressing work natively with provider subagents (Claude Code, Gemini, Copilot), expands agent discovery to all provider-native project directories |
| **Tasks** | [agent-system-simplification-tasks](../tasks/2026-04-16-agent-system-simplification-tasks.md) |

## Problem

Notesage's agent system was designed before ACP providers had their own subagent infrastructure. Today it has three problems:

1. **Bundled agents are weak.** The 7 bundled agents (General Assistant, Creative Writer, Proofreader, etc.) are one-line system prompt swaps. They have no tools, no scripts, no real capabilities. A user can achieve the same result by saying "write this in an academic style" in their message. They add clutter to the Settings UI, the `@` menu, and the startup discovery pipeline without meaningful value.

2. **`@` addressing conflicts with provider-native subagents.** When a user types `@creative-writer`, Notesage intercepts it, strips the prefix, swaps the system prompt, and sends only the remaining text to the AI. The ACP agent never sees `@creative-writer`. This means users **cannot** address provider-native subagents (Claude Code's `.claude/agents/`, Gemini's `.gemini/agents/`) from Notesage's chat input — Notesage eats the `@` prefix before the provider can act on it.

3. **Project-level agent discovery is incomplete.** Notesage scans `<project>/.notesage/agents/` and `<project>/.github/agents/`, but not `<project>/.claude/agents/` or `<project>/.gemini/agents/`. Users who have provider-native agent files in their project don't see them in the `@` autocomplete menu.

## Goals

1. **Remove bundled prompt-only agents** — stop shipping, extracting, and defaulting to agents that provide no real capability
2. **Make `@` addressing transparent** — for ACP connections, pass `@agent-name` through to the provider so native subagent delegation works
3. **Expand agent discovery** — scan all provider-native project-level directories so users see their agents in the `@` autocomplete
4. **Keep `@` system prompt swap for direct API** — direct API connections (Anthropic, OpenAI, Ollama, local) have no subagent runtime, so the existing system prompt swap remains the only option
5. **Simplify the UI** — agent picker already removed from footer; complete the cleanup by removing bundled agent infrastructure

## Non-Goals

- **Cross-provider agent file syncing** — writing Notesage agents to `.claude/agents/`, `.github/agents/`, etc. is a separate feature (opt-in symlinks or file generation). Not part of this simplification.
- **Agent creation/editing UI** — the Settings > Skills & Agents section for viewing/managing agents stays as-is for user-created agents
- **Removing the `@` autocomplete menu** — the menu stays; it's how users discover and address agents. Only the behavior changes for ACP connections.
- **Codex TOML agent support** — Codex uses `.codex/agents/*.toml` (TOML, not Markdown). Adding a TOML parser is out of scope. Codex agents won't appear in the `@` menu.

## User Stories

1. **As a user with Claude Code connected**, I want to type `@security-auditor review this file` and have Claude Code delegate to its `.claude/agents/security-auditor.md` subagent, so I can use provider-native agents directly from Notesage.

2. **As a user with a direct API connection**, I want to type `@proofreader check this paragraph` and have the AI adopt the proofreader's system prompt, so I can use custom agents even without ACP.

3. **As a user with `.claude/agents/` in my project**, I want to see those agents in the `@` autocomplete when I type `@` in the chat input, so I can discover and use them without memorizing names.

4. **As a new user**, I want the app to start without 7 agents I didn't ask for cluttering my Settings panel and startup logs.

5. **As a user selecting text in the editor**, I want to see useful text transformations (Proofread, Academic Tone, Creative Rewrite) in the BubbleMenu, so I can quickly restyle text without switching agents or writing a prompt.

## Technical Approach

### 1. Remove bundled agents

**Delete:**
- `bundled-agents/*.md` — all 7 agent files (general-assistant, creative-writer, technical-editor, fact-checker, academic-writer, copywriter, proofreader)
- `bundled-agents/agents.md` — the bundled agent instructions file

**Remove extraction pipeline:**
- `extract_bundled_agents()` Tauri command in `agents.rs` — no longer needed
- `extractBundledAgents` call in `useSkillOperations.ts` — remove from startup sequence
- `extractBundledAgents` wrapper in `lib/tauri.ts`
- Bundled agent `include_str!` directives in `agents.rs`

**Clean up existing installations:**
- On first launch after upgrade, delete the 7 bundled agent files from `~/.notesage/agents/` (general-assistant.md, creative-writer.md, technical-editor.md, fact-checker.md, academic-writer.md, copywriter.md, proofreader.md)
- Only delete files that match the known bundled names — never delete user-created agents
- Replace `extract_bundled_agents()` with a one-time `cleanup_bundled_agents()` Tauri command that removes these specific files
- Also clean up the legacy `~/.notesage/bundled-agents/` directory if it still exists
- Gate cleanup behind a `bundledAgentsCleaned` flag in settings store (similar to how `personasMigrated` works, but this one runs once and is removed in a future release)

**Remove persona migration:**
- `migratePersonasToAgents()` in `useSkillOperations.ts` — legacy migration from v0.20 personas, no longer needed
- `PERSONA_TO_AGENT` mapping constant
- `personasMigrated` flag in settings store

**Migrate valuable agent personas to bundled custom prompts:**

The useful part of agents like "Academic Writer" and "Proofreader" is not the persistent persona — it's the text transformation. Migrate these as **bundled custom prompts** that appear in the BubbleMenu (text selection popup) alongside the existing Improve/Summarize/Expand actions.

Notesage already has a custom prompts feature (`ai-store.customPrompts`, Settings > Prompts, rendered in `BubbleMenu.tsx`) that is underused. Ship default prompts that cover the same ground:

| Bundled Agent → | Bundled Custom Prompt | Template |
| --- | --- | --- |
| Academic Writer | Academic Tone | Rewrite this text in formal academic style with precise language and structured argumentation. |
| Creative Writer | Creative Rewrite | Rewrite this text with vivid, engaging language. Use metaphors, varied sentence structures, and evocative descriptions. |
| Proofreader | Proofread | Check this text for grammar, spelling, punctuation, and style issues. Fix all errors and improve clarity. |
| Copywriter | Marketing Copy | Rewrite this text as compelling marketing copy. Make it concise, persuasive, and action-oriented. |
| Technical Editor | Technical Edit | Edit this text for technical accuracy, clarity, and consistency. Improve structure and remove ambiguity. |
| Fact Checker | (skip) | Not useful as a text transformation — fact checking needs context, not a template. |
| General Assistant | (skip) | Already the default behavior — no template needed. |

Bundled prompts are seeded into `ai-store.customPrompts` on first launch (gated by a `defaultPromptsBundled` flag). Users can edit, reorder, or delete them. They are NOT overwritten on upgrade — once seeded, they belong to the user.

**Update defaults:**
- `skill-store.ts`: change `activeAgentName` default from `'general-assistant'` to `''` (no agent)
- When no agent is active, the system prompt falls back to `'You are a helpful writing assistant.'` (already the case in `useAIContext.ts:51`)

### 2. Change `@` behavior by connection type

**Current flow (all connections):**
```
User types "@agent-name message"
  → Notesage intercepts, strips "@agent-name"
  → Calls setActiveAgent(agentName) → swaps system prompt
  → Sends only "message" to provider
```

**New flow:**

**ACP connections** (`authMethod === 'agent_managed'`):
```
User types "@agent-name message"
  → Notesage does NOT intercept
  → Sends "@agent-name message" verbatim as the prompt
  → ACP agent sees @agent-name and delegates to its native subagent
```

**Direct API connections** (`authMethod === 'api_key'`, `local`, `local_bundled`):
```
User types "@agent-name message"
  → Notesage intercepts, strips "@agent-name"  (existing behavior)
  → Reads agent body from discovered agent file
  → Injects as system prompt override
  → Sends only "message" to provider
```

**Copilot LSP connections** (`lspBinary === 'copilot-language-server'`):
```
User types "@agent-name message"
  → Notesage does NOT intercept
  → Sends "@agent-name message" verbatim (Copilot LSP handles it)
```

**Implementation:** In `ChatPanel.tsx`, the `@` match logic at line ~180 checks the effective connection's auth method before deciding whether to intercept or pass through.

### 3. Expand project-level agent discovery

**Current project-level agent directories:**
- `<project>/.notesage/agents/` ✅
- `<project>/.github/agents/` ✅

**Add:**
- `<project>/.claude/agents/`
- `<project>/.gemini/agents/`

These are added unconditionally (not gated on connected providers) because:
- The user may connect a provider later
- Agent discovery is fast (just reads directory + parses frontmatter)
- Showing all project agents in the `@` menu is useful for awareness even before connecting

**Implementation:** Update `buildDiscoveryDirs()` in `useSkillOperations.ts` to add these directories in the project loop.

### 4. Update `@` autocomplete menu

The `AgentCommandMenu` component already works. Changes:

- **Source badge:** Show a subtle source indicator so users can distinguish agent origins:
  - `notesage` — from `.notesage/agents/`
  - `claude` — from `.claude/agents/`
  - `github` — from `.github/agents/`
  - `gemini` — from `.gemini/agents/`
  - Provider-specific icons or text labels (e.g., a small Claude/GitHub/Gemini icon)

- **No active agent indicator:** Since there's no persistent "active agent" for ACP connections, the menu is purely for insertion — no checkmark on the "current" agent.

- **ACP behavior hint:** When using an ACP connection, the hint text below the input could change from `@ for agents` to `@ to delegate` or similar.

### 5. Clean up `activeAgent` concept

For ACP connections, there's no concept of a persistent "active agent" — each `@` mention is a one-shot delegation. The `activeAgentName` field in skill-store becomes relevant only for direct API connections.

- When the effective connection is ACP: `activeAgentName` is ignored, no agent body is injected into the system prompt
- When the effective connection is direct API: `activeAgentName` works as before (system prompt swap)
- The `setActiveAgent` action remains for direct API use, but is not called from the `@` path for ACP connections

### 6. Simplify `useAIContext.ts`

When no agent is active (or connection is ACP):
- `agentSystemMessage` falls back to `'You are a helpful writing assistant.'`
- No `<role-instructions>` block injected into ACP system prompt
- The ACP system prompt becomes just project context + skill descriptions (cleaner)

When an agent IS active (direct API only):
- Current behavior preserved — agent body injected as system message

## UI/UX

### Chat Input

- `@` autocomplete menu: shows all discovered agents with source badges
- For ACP connections: selecting an agent inserts `@agent-name ` into the input (user continues typing their message)
- For direct API: selecting an agent inserts `@agent-name ` into the input (on send, Notesage intercepts and swaps system prompt)
- Hint text: `Type / for skills, @ for agents` (unchanged)

### Settings > Skills & Agents

- **Agents section stays** — users who create their own agents in `.notesage/agents/` still see and manage them here
- **Bundled agents disappear** — the 7 built-in agents no longer show up after removal
- **Provider-native agents appear** — agents from `.claude/agents/`, `.github/agents/`, etc. show up with their source attribution (read-only, can't be deleted/moved from Notesage)

### Chat Footer

- Agent picker: **already removed** (done in this session)
- Tools popover: **already removed** (done in this session)
- No new footer elements needed

## Data Model

### Removed

```typescript
// skill-store.ts — default changes
activeAgentName: '' // was 'general-assistant'

// settings-store.ts — removed
personasMigrated: boolean // no longer needed
```

### No New Types

The `AgentEntry` type is unchanged. The `source` field already distinguishes origins (`notesage-global`, `notesage-project`, `claude`, `github`, `gemini`, etc.).

### Removed Tauri Commands

| Command | File | Reason |
| --- | --- | --- |
| `extract_bundled_agents` | `agents.rs` | No bundled agents to extract |

## Dependencies

None. This is purely a simplification — no new libraries or APIs.

## Quality Gates

### Functional

- [ ] No bundled agents appear in Settings > Skills & Agents on fresh install
- [ ] `@agent-name message` with ACP connection sends the full text including `@agent-name` to the provider
- [ ] `@agent-name message` with direct API connection strips prefix and injects agent body as system prompt
- [ ] Agents from `<project>/.claude/agents/` appear in `@` autocomplete
- [ ] Agents from `<project>/.gemini/agents/` appear in `@` autocomplete
- [ ] Agents from `<project>/.notesage/agents/` still appear in `@` autocomplete
- [ ] Agents from global directories (`~/.claude/agents/`, `~/.notesage/agents/`) still appear
- [ ] App starts without "extracting bundled agents" step in startup logs
- [ ] Existing user-created agents in `.notesage/agents/` continue to work
- [ ] No regression in skill discovery or tool calling
- [ ] Bundled custom prompts (Proofread, Academic Tone, etc.) appear in BubbleMenu on fresh install
- [ ] Bundled custom prompts are editable and deletable by the user
- [ ] Existing user custom prompts are not overwritten on upgrade
- [ ] Previously extracted bundled agents cleaned up from `~/.notesage/agents/` on upgrade

### Design

- [ ] Source badges in `@` menu are subtle (`text-muted-foreground`, not distracting)
- [ ] `@` menu works in both light and dark mode
- [ ] No visual gap where agent picker used to be in footer

### Testing

- [ ] Unit tests for `@` pass-through vs intercept logic (ACP vs direct API)
- [ ] Unit tests for expanded discovery directories
- [ ] Existing agent discovery tests updated (no bundled agents expected)
- [ ] TypeScript typecheck passes
- [ ] Performance benchmarks pass within budget

### Documentation

- [ ] `docs/features/ai-workflows.md` — update Addressable Agents section
- [ ] `docs/features/ai-providers.md` — update agent discovery paths
- [ ] `docs/architecture.md` — remove bundled-agents from project structure
- [ ] `docs/product-description.md` — update agent description
- [ ] `CLAUDE.md` — remove references to bundled agents if any

## Out of Scope

- **Cross-provider agent file syncing** — writing `.notesage/agents/` files to `.claude/agents/` etc. via symlinks or file generation. Could be a follow-up PRD with opt-in toggle.
- **Codex TOML agent discovery** — Codex uses TOML format, not Markdown. Would need a TOML parser. Low priority since Codex's agent ecosystem is less mature.
- **Agent creation wizard** — a UI for creating new agent files. Users create them manually or with AI assistance.
- **Per-message agent tracking** — storing which agent was used for each message in chat history. Could be useful for conversation export but adds complexity.
- **`additionalDirectories` ACP feature** — passing extra paths to `session/new` for multi-root workspace support. Separate from agent discovery.
