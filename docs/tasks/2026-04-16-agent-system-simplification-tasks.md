# Agent System Simplification — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-16 |
| **Status** | Complete |
| **PRD** | [agent-system-simplification](../prds/2026-04-16-agent-system-simplification.md) |
| **Total** | 15 tasks: 6S, 6M, 3L |
| **Suggested order** | Backend cleanup (#1-#2) → Frontend cleanup (#3-#5) → Custom prompts (#6-#7) → @ behavior (#8-#10) → Discovery (#11) → UI polish (#12) → Tests (#13) → Docs (#14-#15) |

**Risks:**

- Removing bundled agents changes the default experience — new users see no agents until they connect a provider or create their own
- The `@` pass-through for ACP depends on agents actually handling `@name` in prompt text (confirmed for Claude Code and Gemini, not confirmed for Copilot/Codex)
- Cleanup of `~/.notesage/agents/` must be careful not to delete user-created agents

---

## Phase 1 — Backend Cleanup

### #1 — Replace extract_bundled_agents with cleanup_bundled_agents (backend) ✅

**Description:** Replace the `extract_bundled_agents` Tauri command with a `cleanup_bundled_agents` command that removes previously extracted bundled agent files from `~/.notesage/agents/`. Only delete files matching the 7 known bundled names (general-assistant.md, creative-writer.md, technical-editor.md, fact-checker.md, academic-writer.md, copywriter.md, proofreader.md). Also remove `~/.notesage/bundled-agents/` (legacy dir) and `~/.notesage/.bundled-agents.json` (manifest). Remove all `include_str!` directives for bundled agent content.

**Acceptance criteria:**
- `cleanup_bundled_agents` deletes only the 7 known files, not user-created agents
- Legacy `~/.notesage/bundled-agents/` directory removed
- Manifest file `~/.notesage/.bundled-agents.json` removed
- Command registered in `lib.rs` `generate_handler![]` (replacing `extract_bundled_agents`)

**Complexity:** M\
**Category:** backend\
**Dependencies:** None\
**Files:**
- `src-tauri/src/commands/agents.rs` — replace `extract_bundled_agents` with `cleanup_bundled_agents`
- `src-tauri/src/lib.rs` — update `generate_handler![]`

---

### #2 — Delete bundled agent source files ✅

**Description:** Delete the `bundled-agents/` directory and all 8 files in it (7 agent .md files + agents.md instructions file). These are no longer embedded or extracted.

**Acceptance criteria:**
- `bundled-agents/` directory removed from repository
- No `include_str!("../../../bundled-agents/...")` references remain in Rust code
- `cargo check` passes

**Complexity:** S\
**Category:** backend\
**Dependencies:** #1\
**Files:**
- `bundled-agents/*.md` — delete entire directory
- `src-tauri/src/commands/agents.rs` — verify no remaining references

---

## Phase 2 — Frontend Cleanup

### #3 — Update startup to cleanup instead of extract agents ✅

**Description:** In `useSkillOperations.ts`, replace the `extractBundledAgents` startup call with `cleanupBundledAgents`. Gate behind a `bundledAgentsCleaned` settings flag so it runs once. Remove `migratePersonasToAgents()`, `PERSONA_TO_AGENT` mapping, and `personasMigrated` flag.

**Acceptance criteria:**
- On first launch after upgrade, bundled agents are cleaned from `~/.notesage/agents/`
- Cleanup runs only once (`bundledAgentsCleaned` flag set after)
- Persona migration code fully removed
- Startup no longer logs "extracting bundled agents"

**Complexity:** M\
**Category:** frontend\
**Dependencies:** #1\
**Files:**
- `src/hooks/useSkillOperations.ts` — replace extract with cleanup, remove persona migration
- `src/stores/settings-store.ts` — add `bundledAgentsCleaned`, remove `personasMigrated`
- `src/lib/tauri.ts` — replace `extractBundledAgents` wrapper with `cleanupBundledAgents`

---

### #4 — Change activeAgentName default to empty ✅

**Description:** Change the `activeAgentName` default in `skill-store.ts` from `'general-assistant'` to `''`. When empty, `useAIContext.ts` falls back to `'You are a helpful writing assistant.'` which is already the existing fallback behavior.

**Acceptance criteria:**
- Fresh install has no active agent
- System prompt defaults to generic writing assistant
- No "general-assistant not found" warnings in console

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:**
- `src/stores/skill-store.ts` — change default `activeAgentName`

---

### #5 — Remove bundled agents.md instructions extraction ✅

**Description:** The startup also extracts `bundled-agents/agents.md` to `~/.notesage/agents.md` as global agent instructions. Since we're removing bundled agents, this file is no longer relevant. Add it to the cleanup command and remove the extraction code.

**Complexity:** S\
**Category:** both\
**Dependencies:** #1, #3\
**Files:**
- `src-tauri/src/commands/agents.rs` — add `~/.notesage/agents.md` to cleanup if it matches bundled content
- `src/hooks/useSkillOperations.ts` — remove bundled agents.md extraction if separate from main extraction

---

## Phase 3 — Bundled Custom Prompts

### #6 — Seed default custom prompts on first launch ✅

**Description:** Add 5 bundled custom prompts to `ai-store.customPrompts` on first launch: Academic Tone, Creative Rewrite, Proofread, Marketing Copy, Technical Edit. Gate behind a `defaultPromptsBundled` flag in `ai-store` so it runs once. Never overwrite existing user prompts.

**Acceptance criteria:**
- Fresh install shows 5 prompts in Settings > Prompts
- Existing users get the 5 prompts added to their list (not replacing existing)
- Prompts are editable and deletable
- Re-launching doesn't duplicate them (`defaultPromptsBundled` flag prevents re-seeding)

**Complexity:** M\
**Category:** frontend\
**Dependencies:** None\
**Files:**
- `src/stores/ai-store.ts` — add `defaultPromptsBundled` flag, seeding logic in store `onRehydrateStorage`

---

### #7 — Verify BubbleMenu renders custom prompts ✅

**Description:** Verify that the existing BubbleMenu correctly renders the new bundled custom prompts. The BubbleMenu already reads `customPrompts` from `ai-store` and renders them — this task is to verify the UX works well with 5 prompts (scrolling, layout, icons) and fix any visual issues.

**Acceptance criteria:**
- BubbleMenu shows Improve, Summarize, Expand + 5 custom prompts
- Prompts don't overflow the menu — scroll or layout handles 8 items gracefully
- Icons render correctly (emoji icons from the prompt data)
- Clicking a custom prompt applies the transformation to selected text

**Complexity:** S\
**Category:** frontend\
**Dependencies:** #6\
**Files:**
- `src/components/editor/BubbleMenu.tsx` — verify rendering, fix if needed

---

## Phase 4 — @ Behavior Change

### #8 — Split @ handling by connection type in ChatPanel ✅

**Description:** Modify the `@` match logic in `ChatPanel.tsx` (line ~180) to check the effective connection type before deciding behavior:

- **ACP / Copilot LSP:** Do NOT intercept — let `@agent-name message` pass through verbatim as the prompt text. Do NOT call `setActiveAgent`.
- **Direct API (api_key, local, local_bundled):** Keep existing behavior — intercept, strip prefix, call `setActiveAgent`, send remaining text.

The `effectiveConnection` is already available in the `handleSend` callback.

**Acceptance criteria:**
- ACP connection: `@agent-name message` sent as full text including `@agent-name`
- Direct API: `@agent-name message` strips prefix, sets active agent, sends only message
- `@agent-name` alone (no message) with ACP: sends `@agent-name` as the prompt
- `@agent-name` alone with direct API: switches agent, doesn't send

**Complexity:** L\
**Category:** frontend\
**Dependencies:** None\
**Files:**
- `src/components/chat/ChatPanel.tsx` — modify `@` match logic in `handleSend`

---

### #9 — Stop injecting agent role-instructions for ACP connections ✅

**Description:** In `useAIContext.ts`, skip the `<role-instructions>` block injection into the ACP system prompt when the effective connection is ACP. The ACP agent manages its own subagent system — Notesage shouldn't inject persona instructions.

Keep the `agentSystemMessage` injection for the direct API `buildComposedSystemMessage` path.

**Acceptance criteria:**
- ACP system prompt contains only project context + skill descriptions (no `<role-instructions>`)
- Direct API system prompt still includes agent body when an agent is active
- No change when no agent is active (both paths fall back to generic assistant)

**Complexity:** M\
**Category:** frontend\
**Dependencies:** #8\
**Files:**
- `src/hooks/useAIContext.ts` — conditionally skip agent injection in `buildAcpSystemMessage`

---

### #10 — Update AgentCommandMenu for source-aware behavior ✅

**Description:** Update the `@` autocomplete menu (`AgentCommandMenu.tsx`) to:

1. Show a subtle source badge next to each agent name (`claude`, `github`, `gemini`, `notesage`) using `text-muted-foreground`
2. For ACP connections: selecting inserts `@agent-name ` into input (no `setActiveAgent` call — ChatInput already handles this)
3. For direct API: behavior unchanged (selecting calls `onSelect` which triggers `setActiveAgent`)

The `AgentCommandMenu` doesn't currently know the connection type. Pass it via a prop or read from connections store.

**Acceptance criteria:**
- Source badges visible in `@` menu (subtle, not distracting)
- Works in both light and dark mode
- Menu correctly shows agents from all discovered directories

**Complexity:** M\
**Category:** frontend\
**Dependencies:** #8\
**Files:**
- `src/components/chat/AgentCommandMenu.tsx` — add source badge rendering
- `src/components/chat/ChatInput.tsx` — pass connection type context if needed

---

## Phase 5 — Discovery Expansion

### #11 — Add project-level .claude/agents/ and .gemini/agents/ to discovery ✅

**Description:** Update `buildDiscoveryDirs()` in `useSkillOperations.ts` to add `<project>/.claude/agents/` and `<project>/.gemini/agents/` to the `agentBaseDirs` list for every project. These are added unconditionally (not gated on connected providers).

**Acceptance criteria:**
- Agents from `<project>/.claude/agents/` appear in `@` autocomplete and Settings
- Agents from `<project>/.gemini/agents/` appear in `@` autocomplete and Settings
- Existing `<project>/.notesage/agents/` and `<project>/.github/agents/` still work
- Discovery doesn't fail if directories don't exist (already handled by `discover_agents`)
- Source attribution correct (`claude`, `gemini`, etc.)

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:**
- `src/hooks/useSkillOperations.ts` — add directories in `buildDiscoveryDirs()` project loop
- `src-tauri/src/commands/agents.rs` — verify source attribution logic handles `.claude/agents/` and `.gemini/agents/` paths

---

## Phase 6 — UI Polish

### #12 — Remove agent picker remnants from footer (already done) ✅

**Description:** The agent picker and tools popover were already removed from `ChatFooter.tsx` in this session. This task verifies no visual gap remains and no dead imports/state linger.

**Acceptance criteria:**
- Footer renders cleanly with no gap
- No unused imports or state related to agent picker or tools popover
- TypeScript typecheck passes

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:**
- `src/components/chat/ChatFooter.tsx` — verify (already cleaned)

---

## Phase 7 — Tests

### #13 — Write tests for agent simplification changes ✅

**Description:** Add/update unit tests for:

- `@` pass-through vs intercept logic (mock ACP vs direct API connection)
- `cleanup_bundled_agents` Rust command (deletes known files, preserves user files)
- Default custom prompt seeding (seeds once, doesn't duplicate)
- Expanded discovery directories (`.claude/agents/`, `.gemini/agents/` included)
- `activeAgentName` default empty (no "general-assistant" assumption)
- Existing agent discovery tests: update assertions that expected 7 bundled agents

**Complexity:** L\
**Category:** both\
**Dependencies:** #1, #3, #6, #8, #11\
**Files:**
- `src-tauri/src/commands/agents.rs` — update/add Rust tests for cleanup command
- `src/hooks/__tests__/useSkillOperations.test.ts` — update for no bundled agents, cleanup flow
- `src/components/chat/__tests__/ChatPanel.test.tsx` — `@` behavior tests per connection type
- `src/stores/__tests__/ai-store.test.ts` — custom prompt seeding tests

---

## Phase 8 — Documentation

### #14 — Update feature docs for agent changes ✅

**Description:** Update all relevant documentation to reflect the agent simplification:

- `docs/features/ai-workflows.md` — rewrite "Addressable Agents" section: no bundled agents, `@` pass-through for ACP, system prompt swap for direct API, expanded discovery paths
- `docs/features/ai-providers.md` — update agent discovery path list, note `@` pass-through behavior
- `docs/architecture.md` — remove `bundled-agents/` from project structure, update skill-store description
- `docs/product-description.md` — update agent description, remove "7 bundled agents" reference

**Complexity:** L\
**Category:** frontend\
**Dependencies:** #1-#12\
**Files:**
- `docs/features/ai-workflows.md`
- `docs/features/ai-providers.md`
- `docs/architecture.md`
- `docs/product-description.md`

---

### #15 — Update CLAUDE.md and keyboard shortcuts ✅

**Description:** Remove any references to bundled agents from `CLAUDE.md`. Update `docs/keyboard-shortcuts.md` if there are agent-specific shortcuts. Verify `docs/design-system.md` has no agent picker references.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** #14\
**Files:**
- `CLAUDE.md`
- `docs/keyboard-shortcuts.md`
- `docs/design-system.md`
