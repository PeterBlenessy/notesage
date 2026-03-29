# Skills-to-Tools Glue Layer — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Complete |
| **PRD** | [skills-to-tools-glue-layer](../prds/2026-03-29-skills-to-tools-glue-layer.md) |
| **Total** | 11 tasks: 3S, 5M, 3L |
| **Suggested order** | Backend (#1-#5) → State & Integration (#6-#8) → UI (#9) → Tests (#10-#11) |

**Risks:**
- Usage comment parsing is heuristic — edge cases in script headers may produce incorrect schemas. Fallback to generic `{ args: string[] }` mitigates this.
- Tool name collisions if two skills have the same name from different sources. Existing skill hierarchy resolution (project > global > external) handles this.

---

### #1 — Add `SkillToolEntry` and `ArgMapping` Rust structs ✅

**Description:** Define the new data model in `skills.rs` for tool definitions extracted from skills. Add `SkillToolEntry`, `ArgMapping`, and `ArgMappingType` as described in the PRD. These structs are serialized to the frontend via Tauri IPC.

**Complexity:** S
**Category:** backend
**Dependencies:** None
**Files:**
- `src-tauri/src/commands/skills.rs` — add structs

---

### #2 — Parse explicit `tools:` frontmatter field ✅

**Description:** Extend `SkillFrontmatter` deserialization to support the optional `tools:` YAML field. When present, each entry provides `name`, `description`, `script`, and `parameters` (JSON Schema). Convert these directly into `SkillToolEntry` values with no argument mapping needed (explicit schemas bypass the extraction pipeline). Follow the existing `parse_frontmatter()` pattern.

**Complexity:** M
**Category:** backend
**Dependencies:** Depends on #1
**Files:**
- `src-tauri/src/commands/skills.rs` — extend `SkillFrontmatter`, add `ToolFrontmatter` struct, parsing logic

---

### #3 — Implement Usage comment parser ✅

**Description:** Add a function `parse_usage_comment(script_content: &str) -> Option<(serde_json::Value, Vec<ArgMapping>)>` that reads the first 10 lines of a script file for `Usage:` patterns and extracts parameter schemas + argument mappings. Support the extraction rules from the PRD:
- `<name>` → required string parameter (positional)
- `[name]` → optional string parameter (positional)
- `[--flag]` → optional boolean parameter (bool flag)
- `[--flag "value"]` → optional string parameter (flag)

Return both the JSON Schema `properties`/`required` and the `ArgMapping` vector for later execution routing.

**Complexity:** L
**Category:** backend
**Dependencies:** Depends on #1
**Files:**
- `src-tauri/src/commands/skills.rs` — add `parse_usage_comment()` function

---

### #4 — Implement `extract_skill_tools` Tauri command ✅

**Description:** Add a new Tauri command that takes discovered `SkillEntry[]` and runs the extraction pipeline for each tool-eligible skill (has_scripts=true, disable_model_invocation!=true):
1. Check for explicit `tools:` frontmatter (Priority 1)
2. Read script files and parse Usage comments (Priority 2)
3. Fall back to generic `{ args: string[] }` schema (Priority 3)

Generate tool names following the naming convention: `skill__{skill_name}` for single-script skills, `skill__{skill_name}__{script_name}` for multi-script. Register the command in `lib.rs` `generate_handler![]`.

**Complexity:** L
**Category:** backend
**Dependencies:** Depends on #1, #2, #3
**Files:**
- `src-tauri/src/commands/skills.rs` — add `extract_skill_tools()` command, tool name generation
- `src-tauri/src/lib.rs` — register command in handler macro

---

### #5 — Rust unit tests for extraction pipeline ✅

**Description:** Add `#[cfg(test)]` tests in `skills.rs` covering:
- Usage comment parsing: positional `<arg>`, optional `[arg]`, boolean `[--flag]`, flag with value `[--flag "val"]`
- Explicit frontmatter `tools:` field parsing
- Fallback generic schema generation
- Tool name generation (snake_case, single vs multi-script)
- Skills with `disable_model_invocation: true` are excluded
- Skills with `has_scripts: false` are excluded

**Complexity:** M
**Category:** backend
**Dependencies:** Depends on #4
**Files:**
- `src-tauri/src/commands/skills.rs` — add test module

---

### #6 — Add `SkillToolEntry` TypeScript type and store integration ✅

**Description:** Add the `SkillToolEntry` and `ArgMapping` TypeScript interfaces. Extend `skill-store.ts`:
- Add `skillTools: SkillToolEntry[]` state field
- Add `setSkillTools(tools: SkillToolEntry[])` action
- Update `getToolDefinitions(allowedTools?)` to merge skill-generated tools with `BUILT_IN_TOOLS`
- Skill tools should respect `allowedTools` filtering (match on full tool name or skill name prefix)
- Update `getSkillDescriptionsForPrompt()` to exclude skills that have been converted to tools (avoid duplicate exposure)

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- `src/lib/ai/types.ts` or `src/lib/tauri.ts` — add `SkillToolEntry`, `ArgMapping` interfaces
- `src/stores/skill-store.ts` — add state, actions, update `getToolDefinitions` and `getSkillDescriptionsForPrompt`

---

### #7 — Call `extract_skill_tools` after skill discovery ✅

**Description:** In `useSkillOperations.ts` (or wherever `scanSkills` is orchestrated), call `invoke('extract_skill_tools', { skillEntries })` after skills are discovered and update the store with the results via `setSkillTools()`. This should happen during the existing skill discovery flow triggered by `useSkillDiscovery()` in `App.tsx`.

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #4, #6
**Files:**
- `src/hooks/useSkillOperations.ts` — add `extract_skill_tools` call after discovery
- `src/stores/skill-store.ts` — update `scanSkills` if the call fits better there

---

### #8 — Add `skill__` prefix routing in tool executor ✅

**Description:** Extend `executeToolCall()` in `tool-executor.ts` to handle tool calls with the `skill__` prefix. When a tool name starts with `skill__`:
1. Parse the skill name and script name from the tool name
2. Look up the `SkillToolEntry` from the skill store to get the `arg_mapping`
3. Convert the JSON arguments to `string[]` using the mapping rules (positional → in order, flag → `--name value`, bool flag → `--name` if true, spread → multiple positional args)
4. Look up the skill path from the skill store
5. Call `invoke('execute_skill_script', { skillPath, script, args })` with the mapped arguments

The existing `execute_skill_script` and `read_skill_content` cases remain for backward compatibility.

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #6
**Files:**
- `src/lib/tool-executor.ts` — add `skill__` prefix handler, argument mapping logic

---

### #9 — UI: Tools badge and popover grouping ✅

**Description:** Update the chat footer tools indicator and popover to visually distinguish skill-generated tools:
- The tools count badge already reflects `getToolDefinitions()` length — no change needed
- In the tools popover, group skill tools under a "Skills" section header, separate from built-in tools
- Show the original skill name as a subheading for each group of skill tools
- Show "auto" or "explicit" indicator next to skill tools based on whether they used frontmatter schemas or auto-extraction

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #6
**Files:**
- `src/components/chat/ChatPanel.tsx` or `src/components/chat/ChatFooter.tsx` — update tools popover rendering

---

### #10 — Frontend unit tests for argument mapping and tool assembly ✅

**Description:** Add vitest tests covering:
- `executeToolCall()` with `skill__` prefix: positional args, flags, boolean flags, spread
- `getToolDefinitions()` merging built-in + skill tools
- `getToolDefinitions()` with `allowedTools` filtering on skill tool names
- `getSkillDescriptionsForPrompt()` excludes tool-converted skills
- Tool name parsing (skill name + script name extraction)

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #8, #6
**Files:**
- `src/lib/__tests__/tool-executor.test.ts` — add skill tool execution tests
- `src/stores/__tests__/skill-store.test.ts` — add tool definition assembly tests

---

### #11 — Integration smoke test with bundled skills ✅

**Description:** Verify end-to-end that bundled skills with scripts (e.g., `download-webpage`, `create-skill`) produce correct tool definitions that can be assembled and routed. This can be a vitest integration test that:
1. Mocks `invoke('discover_skills')` with real bundled skill metadata
2. Mocks `invoke('extract_skill_tools')` with expected tool entries
3. Verifies `getToolDefinitions()` includes skill tools
4. Verifies `executeToolCall('skill__download_webpage', { url: '...', output_dir: '...' })` maps args correctly

Also verify that existing skill tests continue to pass unchanged.

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #8, #10
**Files:**
- `src/stores/__tests__/skill-store.test.ts` — add integration-level test
