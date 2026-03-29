# Skills-to-Tools Glue Layer Research

**Date:** 2026-03-29 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [skills-to-tools-glue-layer](../prds/2026-03-29-skills-to-tools-glue-layer.md) | Draft |
| Tasks | — | Not planned |

**Context:** Notesage supports AI skills (SKILL.md files with optional scripts) and tool calling (6 hardcoded built-in tools). Currently, skills are injected as text descriptions in the system prompt — the model must reason through a multi-step chain (read system prompt, call `read_skill_content`, parse instructions, call `execute_skill_script`) to use them. This works for large models (Claude, GPT-4o) but fails for smaller local models that can handle basic tool calling but not multi-step meta-reasoning.

**Goal:** Research how to bridge skills into first-class tool definitions so any model with tool-calling support can discover and use them deterministically.

---

## 1. The Problem

### Current Architecture

Skills are presented to the LLM via two mechanisms:

1. **System prompt injection** — Skill names and descriptions appended to the system message:
   ```
   Available skills:
   - **download-webpage**: Download a web page by URL and save it as clean markdown (has scripts)
   ```

2. **Two generic meta-tools** — The model must chain these to actually use a skill:
   - `read_skill_content({ skill_name })` — loads the full SKILL.md body
   - `execute_skill_script({ skill_name, script, args[] })` — runs a script

### The Multi-Step Reasoning Chain

To use a skill, the model must:
1. Read the system prompt and notice a relevant skill exists
2. Call `read_skill_content` to load the skill's full instructions
3. Parse the instructions to identify which script to call and with what arguments
4. Call `execute_skill_script` with the correct skill name, script path, and args

This 3-step chain requires meta-reasoning that smaller models (Qwen 7B, Llama 8B, SmolLM2) cannot reliably perform, even though they can handle basic tool calling.

### How Tool Calling Actually Works

Tools are NOT in the system message. They're sent as a **separate `tools` array** in the API request:

```json
{
  "system": "You are a helpful assistant...",
  "messages": [...],
  "tools": [
    { "name": "web_search", "description": "...", "input_schema": { ... } }
  ]
}
```

The LLM provider injects tools into the model's context in a way the model was specifically fine-tuned to recognize. Tool calling is **never fully deterministic** — the model always decides *whether* to call a tool and *what values* to pass. But it IS:
- **Discoverable** — the model sees all tools in the `tools` array
- **Structured** — JSON Schema defines what params exist and their types
- **Trained behavior** — models are fine-tuned on tool-calling patterns

The gap: skills are discoverable only via system prompt text (not the trained tool-calling pathway), and their invocation requires multi-step reasoning (not a single structured call).

---

## 2. Industry Research

### Universal Convergence: JSON Schema

Every major platform uses JSON Schema for tool parameter definitions. The only variation is the envelope:

| Platform | Tool Format |
| --- | --- |
| OpenAI | `{ type: "function", function: { name, description, parameters: JSONSchema } }` |
| Anthropic | `{ name, description, input_schema: JSONSchema }` |
| MCP | `{ name, description, inputSchema: JSONSchema }` (via `tools/list` JSON-RPC) |
| LangChain | Pydantic BaseModel -> JSON Schema -> provider format |
| Semantic Kernel | Code annotations -> JSON Schema -> provider format |
| CrewAI | Pydantic `args_schema` -> JSON Schema |
| Composio | Raw schema -> provider-specific `wrap_tool` adapters |

### Schema Authoring Approaches

| Approach | Schema Source | Requires Author Work? | Used By |
| --- | --- | --- | --- |
| Manual JSON Schema | Hand-written | Yes | MCP, raw OpenAI/Anthropic |
| OpenAPI spec | Parsed from REST API description | Yes | GPT Actions, Semantic Kernel, Google ADK |
| Type hint inference | Auto-generated from function signatures | No (if typed) | LangChain `@tool`, Semantic Kernel `@kernel_function` |
| Pydantic model | Explicit `BaseModel` subclass | Yes | CrewAI `BaseTool`, LangChain `StructuredTool` |

### Key Insight: Determinism

No platform makes tool *selection* deterministic — the model always chooses heuristically. What they make deterministic is:
- **Discoverability** — the model sees proper tool definitions via the trained pathway
- **Output compliance** — `strict: true` constrains generated arguments to match the schema
- **Single-step invocation** — one tool call, not a multi-step reasoning chain

Sources:
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic)
- [MCP Tool Schema](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [LangChain Tools](https://docs.langchain.com/oss/python/langchain/tools)
- [Semantic Kernel Plugins](https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/)
- [CrewAI Custom Tools](https://docs.crewai.com/en/learn/create-custom-tools)
- [Composio Tool Calling](https://docs.composio.dev/tool-calling/introduction)
- [OpenAI Cookbook: Function Calling with OpenAPI](https://cookbook.openai.com/examples/function_calling_with_an_openapi_spec)
- [Google ADK OpenAPI Tools](https://google.github.io/adk-docs/tools-custom/openapi-tools/)

---

## 3. Skill Ecosystem Analysis

### Sample of 20 Skills Analyzed

Skills were sampled from three sources:
- [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills) (official Anthropic skills)
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) (community skills)
- Notesage bundled skills (`bundled-skills/`)

### Two Distinct Skill Types

**Type A: Knowledge Skills (no scripts, ~75% of ecosystem)**

Pure instruction sets that teach the LLM how to use existing capabilities (Bash, read_file, write_file, Python/Node code). Examples:

| Skill | What It Teaches | Scripts? |
| --- | --- | --- |
| pdf | pypdf, pdfplumber, reportlab, qpdf, OCR | No |
| frontend-design | UI design principles, typography, color | No |
| claude-api | Claude API usage, SDK patterns | No |
| changelog-generator | git log parsing, changelog formatting | No |
| invoice-organizer | File scanning, renaming, CSV generation | No |
| lead-research-assistant | Web research, lead scoring | No |
| meeting-insights-analyzer | Transcript parsing, pattern recognition | No |
| content-research-writer | Research, outlining, citation management | No |
| slack-gif-creator | PIL animation, GIF optimization | No |
| brand-guidelines | Style rules, voice consistency | No |
| mcp-builder | MCP server development patterns | No |

**These cannot become tools** — there's nothing to execute. They work by enriching the LLM's context. A tool wrapper around them would just be `{ request: string }` which adds no structure over the current system prompt injection.

**Type B: Script Skills (have executable scripts, ~25% of ecosystem)**

Have scripts that perform concrete operations with defined inputs and outputs. Examples:

| Skill | Scripts | Input → Output |
| --- | --- | --- |
| download-webpage | `download.mjs`, `setup.sh` | URL, output_dir → JSON {title, file, status} |
| search-research | `search.mjs` | query, dirs, --tag, --limit → JSON array |
| save-research | `save.mjs` | content, output_dir, --title, --tags → JSON {file, status} |
| create-skill | `scaffold.sh`, `validate.sh` | name, target_dir → directory structure |
| docx | `unpack.py`, `pack.py`, `validate.py` | file paths → processed files |
| xlsx | `recalc.py` | file path → recalculated file |
| pptx | `thumbnail.py`, `soffice.py` | file path → images |
| webapp-testing | `with_server.py` | server config → managed process |
| web-artifacts-builder | init script, bundle script | project config → HTML artifact |

Within Type B, there's a further subdivision:

- **Script-primary** (scripts ARE the capability): `download-webpage`, `search-research`, `save-research`, `create-skill` — the script does the real work, arguments are well-defined
- **Script-helper** (scripts assist the LLM's work): `docx`, `xlsx`, `pptx` — scripts handle mechanical steps (unpack XML, recalculate formulas) but the LLM still needs instructions for the creative/analytical work

### Script Parameter Discovery

Existing scripts already contain parseable parameter information:

**In script headers (Usage comments):**
```
// Usage: node download.mjs <url> <output_dir> [--force]
// Usage: node search.mjs <query> <dir1> [dir2...] [--tag "tagname"] [--limit 20]
// Usage: node save.mjs <content_or_path> <output_dir> [--title "..."] [--tags "..."]
```

**In SKILL.md invocation examples:**
```
execute_skill_script("download-webpage", "scripts/download.mjs", [url, output_dir])
execute_skill_script("search-research", "scripts/search.mjs", [query, ...search_dirs, "--tag", "ai"])
```

**In SKILL.md output documentation:**
```json
{ "title": "Article Title", "file": "/path/to/saved/article.md", "status": "created" }
```

---

## 4. Approach Evaluation

### Option 1: Inline JSON Schema in SKILL.md Frontmatter

Each script declares parameters in YAML frontmatter. The app parses these and generates tool definitions.

| Pros | Cons |
| --- | --- |
| Explicit, unambiguous schemas | Requires skill authors to add schemas |
| Matches MCP/OpenAI/Anthropic format | Breaks "no author changes" requirement |
| Backward compatible (optional field) | YAML + JSON Schema is verbose |

### Option 2: OpenAPI Spec Per Skill

Each skill ships an `openapi.yaml`. Operations become tools.

| Pros | Cons |
| --- | --- |
| Industry standard, massive ecosystem | Overkill for local scripts |
| Rich tooling (validation, codegen) | Requires skill authors to learn OpenAPI |
| Schema validation built in | Conceptual mismatch (scripts aren't REST APIs) |

### Option 3: MCP Server Per Skill

Each skill becomes an MCP server with `tools/list` discovery.

| Pros | Cons |
| --- | --- |
| Emerging industry standard | Skills must be rewritten as MCP servers |
| Already integrated in Notesage | Each skill is a running process |
| Works across all AI tools | Heavy for simple scripts |

### Option 4: Type-Hint Inference (@tool Decorator Pattern)

Skills rewritten as typed Python/TypeScript functions. Runtime infers JSON Schema.

| Pros | Cons |
| --- | --- |
| Zero-schema authoring | Requires specific language runtime |
| Extremely ergonomic | Breaks polyglot model (bash, python, node) |
| Battle-tested (LangChain, CrewAI) | Can't support shell scripts |

### Option 5 (Recommended): Automatic Extraction + Optional Schema Override

The glue layer **auto-extracts** parameter information from existing SKILL.md content and script headers at discovery time. No author changes needed. Authors CAN optionally provide explicit schemas for precision.

**Auto-extraction sources (in priority order):**
1. `scripts[].parameters` frontmatter (if author provides explicit schema — highest fidelity)
2. Script `Usage:` header comments (parseable with regex)
3. `execute_skill_script()` invocation examples in SKILL.md body
4. Fallback: single `{ args: string[] }` generic schema

| Pros | Cons |
| --- | --- |
| Zero changes to existing skills | Auto-extraction is heuristic, not perfect |
| Backward compatible | Complex extraction logic |
| Gradual improvement (authors can add schemas later) | Different quality levels per skill |
| Works with any language (bash, python, node) | |
| Matches existing ecosystem | |

---

## 5. Conclusions

1. **~75% of skills are knowledge-only** and cannot become tools. They should remain as system prompt injections. The glue layer should only target script-bearing skills.

2. **Script-primary skills map cleanly to tools.** Our bundled skills (`download-webpage`, `search-research`, `save-research`, `create-skill`) have well-defined interfaces extractable from existing metadata.

3. **The industry standard is JSON Schema** for tool parameters. Every platform converges on this. The tool definition format is already implemented in Notesage (`ToolDefinition` with `input_schema`).

4. **Auto-extraction from existing content is feasible** for well-structured skills. Script `Usage:` comments and SKILL.md invocation examples provide enough information to generate useful schemas for the most common patterns.

5. **MCP is the long-term standard** for complex integrations, but the lightweight frontmatter approach is the right fit for simple script skills. Both paths should coexist (MCP already works in Notesage).

6. **The key architectural insight:** the glue layer should treat each skill script as an independent tool, not wrap the entire skill in a single tool. A skill with 3 scripts produces 3 tools.
