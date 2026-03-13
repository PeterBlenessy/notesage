# PRD: Local AI Tool Calling & Skills Execution

**Date:** 2026-03-11 **Phase:** 11 **Status:** Draft

---

## Problem

Notesage has a mature skills system (7 bundled skills, SKILL.md discovery, script execution runtime) and a powerful local AI engine (bundled llama-server with curated models). But these two systems are **completely disconnected**. Local models can describe what a skill does — they see skill descriptions in the system prompt — but they cannot *execute* skills. The `ai_chat_stream` command passes zero tool definitions to any provider (Anthropic, OpenAI, Ollama, or local bundled).

This means:

1. **Local models can't act** — a user asks "download this webpage and save it as research" and the model can only explain what to do, not do it
2. **Cloud API models can't act either** — even Anthropic and OpenAI, which have native tool calling APIs, receive no tool schemas
3. **Skills are text-only** — skill descriptions are injected as system prompt text, forcing the model to "imagine" executing them rather than actually calling `execute_skill_script`

The Skills & Agents Platform (Phase 7) laid the foundation — discovery, permissions, script execution — but stopped short of the tool calling loop that makes skills autonomous. This PRD closes that gap.

**Why now:** Qwen3, Llama 3.1+, and Phi-4-mini all support native function calling in GGUF format via llama.cpp's `--jinja` flag. The llama-server already exposes an OpenAI-compatible API that accepts `tools` in chat completions. The infrastructure is ready.

---

## Goals

1. **Tool calling for all providers** — Add structured tool definitions to `ai_chat_stream` for Anthropic, OpenAI, Ollama, local bundled, and OpenAI-compatible providers
2. **Skill-to-tool conversion** — Automatically convert active SKILL.md metadata into provider-native tool schemas
3. **Execution loop** — When a model calls a tool, execute it (skill script, read skill content) and feed the result back for continued generation
4. **Permission integration** — Reuse existing tiered permission system (once/session/always) for tool call approval
5. **Agent-aware tool filtering** — Respect `allowed-tools` from agent frontmatter to limit which tools an agent can call
6. **Read and write file tools** — Expose `read_file` and `write_file` Tauri commands as tools so models can read context and save outputs
7. **Progressive disclosure** — Models see tool descriptions initially, load full skill body on demand via `read_skill_content` tool

## Non-Goals

- **MCP tool integration** — MCP tools are not wired into this flow (separate future work)
- **Streaming tool execution** — Script output returned after completion, not streamed
- **Multi-tool parallel execution** — Tools executed sequentially (model calls one, gets result, calls next)
- **Custom user-defined tools** — Only skills and built-in tools; no arbitrary tool definitions
- **Tool calling for non-chat paths** — `ai_generate_text` (single-shot) is not modified
- **Vision/multimodal tool inputs** — Text-only tool arguments

---

## User Stories

**Local-first researcher:**

> As a user with Qwen3-4B running locally, I want to say "research battery technology" in chat and have the model automatically call the `download-webpage` and `save-research` skills, so I get useful research saved without manual steps.

**Cloud + skills user:**

> As an Anthropic user, I want Claude to automatically use my project's custom skills when relevant, so I don't have to manually invoke `/skill-name` every time.

**Privacy-conscious writer:**

> As a user who won't use cloud APIs, I want my local model to be able to read files, run skill scripts, and write outputs — all on-device — so I have a fully autonomous local assistant.

**Agent author:**

> As someone who created a "research-agent" with `allowed-tools: [download-webpage, save-research, synthesize-sources]`, I want only those skills available when that agent is active, so different agents have different capabilities.

---

## Technical Approach

### Tool Schema Generation

Convert active skills into tool definitions at prompt time:

```typescript
// Built-in tools (always available)
const builtInTools = [
  {
    name: 'read_skill_content',
    description: 'Load the full instructions and file listing of a skill. Call this when you need detailed instructions for using a skill.',
    input_schema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string', description: 'Name of the skill to load' }
      },
      required: ['skill_name']
    }
  },
  {
    name: 'execute_skill_script',
    description: 'Execute a script from a skill directory. Returns stdout, stderr, and exit code.',
    input_schema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string', description: 'Name of the skill' },
        script: { type: 'string', description: 'Relative path to script (e.g., "scripts/download.py")' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the script' }
      },
      required: ['skill_name', 'script']
    }
  },
  {
    name: 'read_file',
    description: 'Read a file from the filesystem. Returns file contents as text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Content to write' }
      },
      required: ['path', 'content']
    }
  }
];
```

### Provider-Specific Tool Formats

The Rust backend converts the generic tool schema to each provider's native format:

**Anthropic (Messages API):**

```json
{
  "tools": [
    {
      "name": "execute_skill_script",
      "description": "...",
      "input_schema": { ... }
    }
  ]
}
```

**OpenAI (Responses API / Chat Completions):**

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "execute_skill_script",
        "description": "...",
        "parameters": { ... }
      }
    }
  ]
}
```

**Ollama & Local Bundled (OpenAI-compatible)**:Same as OpenAI format. Requires models that support function calling (Qwen3, Llama 3.1+, Mistral). For local bundled, llama-server needs `--jinja` flag to enable native tool calling.

### Tool Execution Loop

The streaming flow changes from single-pass to multi-turn:

```
1. Frontend sends messages + tools to ai_chat_stream
2. Model streams response
3. If response contains tool_use:
   a. Emit "ai-tool-call" event to frontend (tool name, args)
   b. Frontend checks permission (once/session/always)
   c. If denied → emit tool result with error, model continues without tool
   d. If approved → execute tool (skill script, read_file, etc.)
   e. Emit "ai-tool-result" event (result text)
   f. Send tool result back to model as next message
   g. Model continues generating (go to step 2)
4. If response is text-only → emit as ai-stream-chunk (existing flow)
5. When model finishes → emit ai-stream-done
```

### Rust Backend Changes

**Modified:** `src-tauri/src/commands/ai.rs`

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub content: String,
    pub is_error: bool,
}

#[tauri::command]
pub async fn ai_chat_stream(
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
    web_search_enabled: Option<bool>,
    tools: Option<Vec<ToolDefinition>>,        // NEW
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: Option<String>,
    state: tauri::State<'_, super::local_inference::LocalInferenceState>,
) -> Result<(), String>
```

The streaming implementation detects `tool_use` blocks in the response and emits new events:

**New Tauri events:**

- `ai-tool-call` (`{ id: string, name: string, arguments: object }`) — model wants to call a tool
- `ai-tool-result` (`{ tool_call_id: string, content: string }`) — tool execution completed

**New Tauri command for continuing after tool execution:**

```rust
#[tauri::command]
pub async fn ai_chat_stream_continue(
    window: tauri::Window,
    messages: Vec<ChatMessage>,        // Full history including tool results
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
    tools: Option<Vec<ToolDefinition>>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: Option<String>,
    state: tauri::State<'_, super::local_inference::LocalInferenceState>,
) -> Result<(), String>
```

### Frontend Changes

**Modified:** `src/hooks/useAIOperations.ts`

```typescript
// Build tools array from active skills + built-in tools
function buildToolsForChat(activeAgent?: AgentEntry): ToolDefinition[] {
  const skills = useSkillStore.getState().getActiveSkills();
  const allowedTools = activeAgent?.allowed_tools;

  // Filter skills by agent's allowed-tools (if specified)
  const filteredSkills = allowedTools
    ? skills.filter(s => allowedTools.includes(s.name))
    : skills;

  // Convert skills to tool definitions
  const skillTools = filteredSkills
    .filter(s => s.has_scripts && !s.disable_model_invocation)
    .map(skillToToolDefinition);

  return [...builtInTools, ...skillTools];
}

// Handle tool call events
listen<ToolCall>('ai-tool-call', async (event) => {
  const { id, name, arguments: args } = event.payload;

  // Check permission
  const tier = getToolPermissionTier(name);
  if (tier === 'none') {
    const approved = await showToolPermissionPrompt(name, args);
    if (!approved) {
      await continueWithToolError(id, 'User denied permission');
      return;
    }
  }

  // Execute the tool
  const result = await executeToolCall(name, args);

  // Continue the conversation with the tool result
  await continueStreamWithToolResult(id, result);
});
```

**Modified:** `src/components/chat/ChatMessage.tsx`

Tool call activity rendered inline:

```
┌─────────────────────────────────────────┐
│ ▸ execute_skill_script                  │
│   Skill: download-webpage               │
│   Script: scripts/download.sh           │
│   Args: ["https://example.com"]         │
│   ┌───────────────────────────────────┐ │
│   │ Downloaded: example.com           │ │
│   │ Saved to: .notesage/research/...  │ │
│   │ Exit code: 0                      │ │
│   └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Local Bundled llama-server Changes

**Modified:** `src-tauri/src/commands/local_inference.rs`

Add `--jinja` flag when starting llama-server to enable native tool calling:

```rust
let mut cmd = Command::new(&binary_path);
cmd.arg("--model").arg(&model_path)
   .arg("--port").arg(port.to_string())
   .arg("--ctx-size").arg(context_length.to_string())
   .arg("--jinja")  // Enable Jinja2 template engine for tool calling
   .arg("--n-gpu-layers").arg(gpu_layers.to_string());
```

**Model capability detection:** Not all models support tool calling. The model catalog gets a new `supports_tool_calling` field. For models without native support, tools are injected as text in the system prompt (degraded but functional).

### Permission Flow

Reuses and extends the existing `permission-store`:

```typescript
// Tool call permission check
function getToolPermissionTier(toolName: string): PermissionTier {
  const store = usePermissionStore.getState();

  // Built-in read-only tools (read_file, read_skill_content) — auto-allow
  if (['read_file', 'read_skill_content'].includes(toolName)) return 'always';

  // Check persisted always-allow
  if (store.toolCallAlways.includes(toolName)) return 'always';

  // Check session allow
  if (store.toolCallSession.has(toolName)) return 'session';

  // Needs approval
  return 'none';
}
```

Safe tools (`read_file`, `read_skill_content`) are auto-allowed. Write operations (`write_file`, `execute_skill_script`) require user approval.

### Tool Call Limit

To prevent runaway tool loops, enforce a maximum of **20 tool calls per conversation turn**. After the limit, the model receives a "Tool call limit reached" message and must respond with text.

---

## UI/UX

### Tool Call Permission Prompt

Shown inline in chat when a tool call needs approval:

```
┌─────────────────────────────────────────────────────┐
│  🔧 Tool call: execute_skill_script                 │
│                                                     │
│  Skill: download-webpage                            │
│  Script: scripts/download.sh                        │
│  Args: ["https://arxiv.org/abs/2401.00001"]         │
│                                                     │
│  [ Allow ] [ Allow for session ▾ ] [ Deny ]         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Same tiered pattern as ACP permission cards — split Allow button with dropdown for session/always.

### Chat Footer — Tools Indicator

When tools are available for the active connection, show a "Tools" badge in the chat footer:

```
┌─────────────────────────────────────────────────────┐
│  [ Qwen3-4B · Local ▾ ]  [ 🔧 5 tools ]  [ Send ] │
└─────────────────────────────────────────────────────┘
```

Click opens a popover listing available tools with descriptions. Same pattern as existing "Tools" popover for ACP agents.

### Tool Execution Activity

Tool calls appear in the chat as collapsible activity blocks:

- **Pending:** spinner + tool name + arguments
- **Running:** spinner + elapsed time
- **Complete:** green checkmark + result (collapsible)
- **Error:** red icon + error message
- **Denied:** grey icon + "Permission denied"

### Settings — Tool Calling Toggle

In Settings &gt; Advanced:

```
Tool Calling
Allow AI to call tools and execute skills autonomously
[■] Enable tool calling for direct API connections
    Safe tools (read files, read skills) are auto-allowed.
    Script execution requires approval.
```

Default: enabled. Users who want text-only AI can disable.

---

## Data Model

### Model Catalog Extension

Add `supports_tool_calling` to `model-catalog.json`:

```json
{
  "id": "qwen3-4b",
  "name": "Qwen3 4B",
  "supports_tool_calling": true,
  ...
}
```

Models with `supports_tool_calling: true` get structured tool definitions. Others get text-based tool descriptions in the system prompt.

### ChatMessage Extension

The `ChatMessage` struct needs to support tool call and tool result messages:

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatMessage {
    pub role: String,           // "user" | "assistant" | "system" | "tool"
    pub content: String,
    pub tool_calls: Option<Vec<ToolCall>>,    // For assistant messages with tool use
    pub tool_call_id: Option<String>,          // For tool result messages
}
```

### Permission Store Extension

```typescript
interface PermissionStore {
  // Existing...

  // Tool call permissions (NEW)
  toolCallSession: Set<string>;      // tool names allowed this session
  toolCallAlways: string[];           // tool names always allowed (persisted)

  isToolAutoAllowed(toolName: string): boolean;
  allowToolSession(toolName: string): void;
  allowToolAlways(toolName: string): void;
}
```

---

## Dependencies

### Rust Changes

- No new crate dependencies — uses existing `reqwest`, `serde_json`, `serde`
- `ai_streaming.rs` modified to parse tool_use blocks from each provider's SSE format

### Frontend Changes

- No new npm dependencies
- Modified: `useAIOperations.ts`, `ChatMessage.tsx`, `ChatInput.tsx`, `permission-store.ts`

### llama-server

- Add `--jinja` flag to startup command (already supported by llama-server)

---

## Quality Gates

### Functional

- [ ] Anthropic tool calling works (model calls execute_skill_script, gets result, continues)

- [ ] OpenAI tool calling works (same flow)

- [ ] Ollama tool calling works with Qwen3 and Llama 3.1

- [ ] Local bundled tool calling works with Qwen3-4B

- [ ] Models without tool calling support get text-based tool descriptions (graceful degradation)

- [ ] Permission prompt appears for write/execute tools

- [ ] Auto-allow works for read-only tools

- [ ] Session and always permission tiers persist correctly

- [ ] Agent `allowed-tools` restricts available tools per agent

- [ ] Tool call limit (20) prevents runaway loops

- [ ] Tool errors are handled gracefully (model receives error, continues)

- [ ] read_file tool returns file contents correctly

- [ ] write_file tool creates/overwrites files correctly

- [ ] read_skill_content tool returns full skill body

- [ ] execute_skill_script tool runs scripts and returns results

- [ ] Multi-turn tool chains work (model calls tool A → result → calls tool B → result → final response)

- [ ] Tool calling can be disabled globally in Settings

### Performance

- [ ] Tool schema generation adds &lt; 50ms to prompt preparation

- [ ] Tool calling overhead does not noticeably slow streaming responses

- [ ] 20 tool calls in a single turn completes in &lt; 60 seconds

### Design

- [ ] Tool permission prompt matches ACP PermissionCard design

- [ ] Tool call activity blocks are visually consistent with ACP tool use display

- [ ] Tools popover follows design system

- [ ] All UI works in light and dark mode

---

## Files Created/Modified

### New Files

- None — all changes extend existing files

### Modified Rust Files

- `src-tauri/src/commands/ai.rs` — add `tools` parameter, `ai_chat_stream_continue` command
- `src-tauri/src/commands/ai_streaming.rs` — parse tool_use blocks per provider, emit tool call events
- `src-tauri/src/commands/local_inference.rs` — add `--jinja` flag, tool calling support detection
- `src-tauri/src/commands/mod.rs` — register new command
- `src-tauri/src/lib.rs` — add to `generate_handler![]`
- `src-tauri/model-catalog.json` — add `supports_tool_calling` field

### Modified Frontend Files

- `src/hooks/useAIOperations.ts` — build tools array, handle tool call events, continuation loop
- `src/components/chat/ChatMessage.tsx` — render tool call activity blocks
- `src/components/chat/ChatPanel.tsx` — tool call permission prompt inline
- `src/stores/permission-store.ts` — add tool call permission tiers
- `src/stores/skill-store.ts` — add `skillToToolDefinition()` helper
- `src/lib/ai/types.ts` — add ToolDefinition, ToolCall, ToolResult types

---

## Out of Scope

- **MCP tool routing** — MCP tools not included in this phase
- **Parallel tool execution** — sequential only
- **Tool streaming** — script output not streamed
- **Vision/image tools** — text-only arguments and results
- **Custom tool definitions** — only skills and built-in tools
- **Tool call history/replay** — no persistent tool call log beyond chat history
- **Cross-turn tool context** — tools re-evaluated each turn, no "tool memory"