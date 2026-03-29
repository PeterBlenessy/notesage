# PRD: Skills-to-Tools Glue Layer

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Any LLM with tool-calling support can discover and use skills — not just large frontier models |
| **Research** | [skills-to-tools-glue-layer](../research/skills-to-tools-glue-layer.md) |

## Problem

Notesage skills are invisible to models that can't perform multi-step meta-reasoning. Today, using a skill requires:

1. The model reads a text hint in the system prompt ("Available skills: **download-webpage**: ...")
2. The model calls `read_skill_content` to load the full SKILL.md instructions
3. The model parses the instructions and identifies the correct script + arguments
4. The model calls `execute_skill_script` with the right parameters

This 3-step chain works for Claude, GPT-4o, and large Qwen/Llama models. It fails for smaller local models (7B–14B parameter range) that can handle basic tool calling but not multi-step reasoning about a meta-protocol.

Meanwhile, the same models handle built-in tools like `web_search({ query })` and `read_file({ path })` reliably — because these are presented as first-class tool definitions via the trained tool-calling pathway.

**The gap:** Skills use a different, harder discovery mechanism than tools, even though the underlying capability (call a function with structured arguments) is identical.

## Goals

1. **Script-bearing skills automatically appear as tool definitions** alongside built-in tools — no SKILL.md changes required
2. **Any model that can call `web_search({ query })` can also call `download_webpage({ url, output_dir })`** — same abstraction level, same discovery mechanism
3. **Knowledge-only skills continue working as system prompt injections** — the glue layer only targets skills with scripts
4. **Existing skill format is fully backward compatible** — no breaking changes to SKILL.md spec
5. **Optional explicit schemas** supported for skill authors who want precise control

## Non-Goals

- Converting knowledge-only skills (no scripts) into tools — these are system prompt extensions and will remain so
- Replacing MCP integration — MCP servers remain the path for complex external integrations
- Auto-generating schemas from script source code analysis or AST parsing
- Supporting tool calling for ACP agent connections (they handle skills natively)
- Building a skill marketplace or registry

## User Stories

- As a user running a local 8B model, I want to say "download this webpage" and have the model call the download-webpage skill directly, so I get the same skill capabilities as users with frontier models
- As a skill author, I want my existing skills to work with the glue layer without any changes, so I don't need to learn a new schema format
- As a skill author, I want to optionally declare explicit parameter schemas in my SKILL.md, so I can provide more precise tool definitions for complex scripts
- As a power user, I want to see which skills are exposed as tools and which remain instruction-only, so I understand what my model can access

## Technical Approach

### Skill Classification at Discovery Time

When skills are scanned (via `discover_skills` in `skills.rs`), classify each skill:

| Classification | Criteria | Handling |
| --- | --- | --- |
| **Tool-eligible** | `has_scripts: true` AND `disable_model_invocation != true` | Generate tool definitions from scripts |
| **Instruction-only** | `has_scripts: false` OR no parseable script interface | Keep as system prompt injection (current behavior) |
| **Explicitly schema'd** | Has `tools:` field in SKILL.md frontmatter | Use author-provided JSON Schema directly |

### Parameter Schema Extraction

For tool-eligible skills without explicit schemas, extract parameter information at discovery time. The extraction pipeline runs in the Rust backend during skill scanning, in priority order:

**Priority 1 — Explicit frontmatter schema (new optional field):**

```yaml
---
name: download-webpage
description: Download a web page by URL and save as clean markdown
tools:
  - name: download
    description: Download a web page and save as markdown with images
    script: scripts/download.mjs
    parameters:
      type: object
      properties:
        url:
          type: string
          description: URL of the page to download
        output_dir:
          type: string
          description: Directory to save the downloaded file
        force:
          type: boolean
          description: Overwrite existing files
      required: [url, output_dir]
---
```

**Priority 2 — Script Usage comment parsing:**

Parse the first 10 lines of each script file for `Usage:` patterns:

```
// Usage: node download.mjs <url> <output_dir> [--force]
```

Extraction rules:
- `<name>` → required string parameter
- `[name]` → optional string parameter
- `[--flag]` → optional boolean parameter
- `[--flag "value"]` → optional string parameter
- `<name1> [name2...]` → first required, rest collected into array
- Parameter descriptions derived from SKILL.md body invocation examples where possible

**Priority 3 — Fallback generic schema:**

```json
{
  "type": "object",
  "properties": {
    "args": { "type": "array", "items": { "type": "string" }, "description": "Arguments for the script" }
  },
  "required": ["args"]
}
```

This is still better than the current 3-step chain because the tool is named and described — the model sees `download_webpage__download` not the generic `execute_skill_script`.

### Tool Definition Generation

Each tool-eligible script produces one `ToolDefinition`:

```typescript
{
  name: "skill__download_webpage__download",  // skill__{skill}__{script}
  description: "Download a web page and save as markdown with images. Returns JSON: {title, url, file, wordCount, images, status}",
  input_schema: { /* extracted or explicit JSON Schema */ }
}
```

**Naming convention:** `skill__{skill_name}__{script_name}` where:
- `skill__` prefix identifies skill-generated tools (for routing)
- Skill name and script name are snake_cased from their original names
- Script name derived from filename without extension (`download.mjs` → `download`)

For skills with a single script, the script name portion can be omitted for brevity:
- `skill__download_webpage` (single script)
- `skill__create_skill__scaffold`, `skill__create_skill__validate` (multiple scripts)

### Tool Execution Routing

In `tool-executor.ts`, add a `skill__` prefix handler:

```typescript
if (name.startsWith('skill__')) {
  // Parse: skill__{skill_name}__{script_name}
  // Look up skill and script from skill store
  // Map structured JSON args → string[] for execute_skill_script
  // Call invoke('execute_skill_script', { skillPath, script, args, ... })
}
```

**Argument mapping (JSON → string[]):**

The executor converts the structured JSON arguments from the tool call into the `string[]` that `execute_skill_script` expects:

1. Required positional params → added in order
2. Optional params with values → added as `--flag value`
3. Boolean flags that are `true` → added as `--flag`
4. Array params → spread as multiple positional args

Example: `{ url: "https://example.com", output_dir: "./articles", force: true }` → `["https://example.com", "./articles", "--force"]`

The mapping rules are stored alongside the extracted schema so the executor knows the original parameter order and flag format.

### Integration with getToolDefinitions()

Update `skill-store.ts`:

```typescript
getToolDefinitions: (allowedTools?: string[]) => {
  const builtIn = allowedTools
    ? BUILT_IN_TOOLS.filter(t => allowedTools.includes(t.name))
    : BUILT_IN_TOOLS;

  const skillTools = getSkillToolDefinitions(allowedTools);

  return [...builtIn, ...skillTools];
}
```

Skill-generated tools respect the same `allowedTools` agent filtering as built-in tools. The agent's `allowed-tools` frontmatter can reference skill tool names (e.g., `skill__download_webpage`).

### System Prompt Update

When skill tools are generated, remove those skills from the system prompt text injection (they're now in the `tools` array). Knowledge-only skills remain in the system prompt.

### Data Flow

```
Skill Discovery (Rust: skills.rs)
  │
  ├─ For each skill with has_scripts:
  │    ├─ Check frontmatter for explicit `tools:` field → use as-is
  │    ├─ Else: read first 10 lines of each script → parse Usage: comment
  │    ├─ Else: fallback to generic { args: string[] }
  │    └─ Return SkillToolEntry { name, description, script_path, parameters, arg_mapping }
  │
  └─ Frontend receives SkillEntry[] (existing) + SkillToolEntry[] (new)

Tool Assembly (TS: skill-store.ts)
  │
  ├─ Convert SkillToolEntry[] → ToolDefinition[]
  ├─ Merge with BUILT_IN_TOOLS
  └─ Pass to ai_chat_stream as tools array

Tool Execution (TS: tool-executor.ts)
  │
  ├─ Detect skill__ prefix
  ├─ Look up skill + script from store
  ├─ Convert JSON args → string[] via arg_mapping
  └─ Call execute_skill_script Tauri command
```

## Data Model

### New Rust Structs (skills.rs)

```rust
/// A tool definition extracted from a skill script.
#[derive(Serialize, Deserialize, Clone)]
pub struct SkillToolEntry {
    /// Tool name: skill__{skill}__{script}
    pub tool_name: String,
    /// Human-readable description for the LLM
    pub description: String,
    /// Parent skill name (for routing)
    pub skill_name: String,
    /// Relative script path within the skill directory
    pub script_path: String,
    /// JSON Schema for tool parameters
    pub parameters: serde_json::Value,
    /// Mapping metadata: how to convert JSON args to string[]
    pub arg_mapping: Vec<ArgMapping>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ArgMapping {
    /// Parameter name in the JSON Schema
    pub param_name: String,
    /// How this parameter maps to CLI args
    pub mapping_type: ArgMappingType,
    /// Position in the args array (for positional params)
    pub position: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone)]
pub enum ArgMappingType {
    /// Positional argument: value added at position
    Positional,
    /// Flag: --name value
    Flag { flag: String },
    /// Boolean flag: --name (present if true)
    BoolFlag { flag: String },
    /// Spread: array values added as consecutive positional args
    Spread,
}
```

### New TypeScript Interface (lib/tauri.ts)

```typescript
export interface SkillToolEntry {
  tool_name: string;
  description: string;
  skill_name: string;
  script_path: string;
  parameters: Record<string, unknown>;
  arg_mapping: ArgMapping[];
}

export interface ArgMapping {
  param_name: string;
  mapping_type: 'positional' | 'flag' | 'bool_flag' | 'spread';
  position?: number;
  flag?: string;
}
```

### Extended SKILL.md Frontmatter (Optional)

```yaml
---
name: my-skill
description: My skill description
tools:                              # NEW optional field
  - name: my-action                 # Tool name suffix
    description: What this does     # LLM-facing description
    script: scripts/my-script.sh    # Script path
    parameters:                     # JSON Schema
      type: object
      properties:
        input: { type: string, description: Input value }
      required: [input]
---
```

### Skill Store Changes (skill-store.ts)

Add to the store interface:

```typescript
interface SkillStore {
  // ... existing fields ...

  /** Tool definitions extracted from script-bearing skills. */
  skillTools: SkillToolEntry[];

  /** Update skill tools (called after skill scan). */
  setSkillTools: (tools: SkillToolEntry[]) => void;
}
```

### Updated Tauri Command

Extend `discover_skills` return type or add a new command:

```rust
#[tauri::command]
pub async fn extract_skill_tools(
    skill_entries: Vec<SkillEntry>,
) -> Result<Vec<SkillToolEntry>, String>
```

This runs the extraction pipeline on the provided skill entries and returns tool definitions. Called after `discover_skills` completes.

## UI/UX

### Settings > Skills & Agents

- Skill cards that have generated tools show a "Tools" badge with count (e.g., "2 tools")
- Expanding a skill card shows the generated tool names and their extracted parameters
- Skills with explicit `tools:` frontmatter show a checkmark indicating author-provided schemas
- Skills with auto-extracted schemas show an "auto" indicator

### Chat Footer Tools Indicator

The existing tools count badge in the chat footer already shows the number of available tools. This number will increase to include skill-generated tools. Clicking the badge shows the tools popover — skill tools should be visually grouped under a "Skills" section, separate from built-in tools.

### No Changes Required

- Chat input behavior unchanged
- Tool call permission cards work identically (skill scripts already require approval via `execute_skill_script`)
- Activity panel shows tool calls the same way

## Dependencies

- No new libraries required
- Uses existing `execute_skill_script` Tauri command for execution
- Uses existing `ToolDefinition` type for tool definitions
- Uses existing tool-calling infrastructure in `useDirectApiChat.ts`

## Quality Gates

### Functional

- [ ] Skills with scripts are automatically exposed as tool definitions
- [ ] A local model (e.g., Qwen3 8B via Ollama) can discover and call `skill__download_webpage` without ever seeing the SKILL.md body
- [ ] The same skill works via both paths: tool call (small model) and read_skill_content chain (large model)
- [ ] Skills without scripts remain as system prompt injections only
- [ ] Explicit `tools:` frontmatter schemas are used when present
- [ ] Usage comment parsing extracts correct parameters for all bundled skills
- [ ] Fallback generic schema works for skills with no parseable interface
- [ ] Agent `allowed-tools` filtering applies to skill-generated tools
- [ ] Tool execution correctly maps JSON arguments to string[] for execute_skill_script
- [ ] Boolean flags, positional args, and optional flags all map correctly

### Backward Compatibility

- [ ] Existing skills with no changes continue to work identically
- [ ] `read_skill_content` and `execute_skill_script` built-in tools remain available
- [ ] Skills with `disable_model_invocation: true` are not converted to tools
- [ ] No changes to SKILL.md spec are required (new fields are optional)

### Testing

- [ ] Unit tests for Usage comment parser (various formats: positional, flags, optional, spread)
- [ ] Unit tests for JSON → string[] argument mapping
- [ ] Unit tests for tool name generation (snake_case, dedup, prefix)
- [ ] Integration test: skill scan → tool extraction → tool definition assembly
- [ ] Rust tests for `extract_skill_tools` command
- [ ] All existing skill tests continue to pass

### Performance

- [ ] Skill tool extraction adds < 50ms to skill discovery time
- [ ] Tool definitions for skills don't significantly increase token usage (< 500 tokens per skill tool)

## Out of Scope

- **Knowledge skill conversion** — Pure instruction skills cannot become tools; this is a fundamental limitation, not a bug to fix
- **Script source code parsing** — Analyzing Python/Node/Bash ASTs to infer parameter types is fragile and not worth the complexity
- **MCP migration path** — Converting skills to MCP servers is a separate initiative; both coexist
- **Tool calling for ACP agents** — ACP agents handle skills natively via their subprocess; the glue layer targets direct API providers only
- **Deferred/lazy tool loading** — For apps with 30+ skills, sending all tool schemas per request becomes expensive. Anthropic's `defer_loading` and OpenAI's `tool_search` solve this, but it's a future optimization
- **Strict mode output validation** — Enforcing exact schema compliance on model output (OpenAI `strict: true`) is provider-specific and out of scope for v1
- **Custom tool icons or categories** — Visual grouping in the tools popover is cosmetic and can be added later
