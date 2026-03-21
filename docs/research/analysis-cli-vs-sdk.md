# CLI (ACP) vs Agent SDK: Analysis for Notesage

**Date:** 2026-03-15 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | — | Not planned (concluded ACP is the right approach for now) |

## Executive Summary

Notesage currently integrates AI agents by spawning locally-installed CLI binaries (Claude Code, Codex, Copilot, Gemini) as subprocesses and communicating via the **Agent Client Protocol (ACP)** over stdio. An alternative approach is to use the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), which provides the same Claude Code capabilities as a programmable TypeScript/Python library.

This document compares both approaches across programmatic control, transparency, architecture, and operational concerns.

---

## Current Architecture: CLI via ACP

### How It Works

1. Rust backend (`acp.rs`, \~1050 lines) resolves and spawns agent binaries as child processes
2. Communication via ACP protocol over stdio (JSON messages)
3. A dedicated OS thread per agent runs a single-threaded tokio runtime with `LocalSet` (required for `!Send` ACP types)
4. Events stream to the frontend via Tauri events (`acp-session-update`, `acp-permission-request`)
5. Frontend hooks (`useAIOperations`, `useAgentTaskOperations`) listen to events and update stores

### Agents Supported

| Agent | Binary | Auth |
| --- | --- | --- |
| Claude Code | `claude-agent-acp` | Subscription (browser popup) |
| OpenAI Codex | `codex-acp` | Subscription |
| GitHub Copilot CLI | `copilot --acp` | Subscription |
| Google Gemini CLI | `gemini --acp` | Google account |

### Control Surface

| Capability | Mechanism | Granularity |
| --- | --- | --- |
| Spawn/stop agents | `acp_agent_spawn`, `acp_agent_stop` | Full — per-agent lifecycle |
| Create sessions | `acp_session_new` | Full — fresh session per task or reuse |
| Send prompts | `acp_session_prompt` | Prompt string only — no options per-prompt |
| Cancel turns | `acp_session_cancel` | Full — graceful cancellation |
| Tool permissions | `acp_permission_respond` per request | Per-tool-call, blocking |
| Authentication | `acp_agent_authenticate` | At spawn time only |
| Working directory | Set at session creation | Per-session |
| Environment variables | Set at spawn | Per-agent |

### Observable Events

| Event | Data Available | Resolution |
| --- | --- | --- |
| `agent_message_chunk` | `{ type: 'text', text: string }` | Real-time streaming |
| `tool_call` | `kind`, `title`, `rawInput` | Before execution |
| `tool_result` | (empty — just "done" marker) | After execution |
| `agent_thought_chunk` | `{ type: 'text', text: string }` | Real-time streaming |
| `agent_turn_complete` | (empty marker) | Turn boundary |
| `acp-permission-request` | `toolCall` details + `options` | Blocking, per-call |

### What You CANNOT Control or See

- **System prompt**: Baked into the agent binary; you prepend to the first user message as a workaround
- **Model selection**: Controlled by the agent binary's configuration, not by Notesage
- **Tool definitions**: The agent decides its own toolset; you can only approve/deny individual calls
- **Temperature, max tokens, thinking budget**: Not exposed through ACP
- **Tool results**: Only a binary "done" signal — the actual output content is opaque
- **Token usage / cost**: Not exposed through ACP events
- **Stop reason**: Not exposed (just `agent_turn_complete`)
- **Structured output**: No way to request JSON schema-constrained responses
- **Context window management**: Agent handles internally; no visibility into compaction

---

## Alternative: Claude Agent SDK

### How It Works

1. Install `@anthropic-ai/claude-agent-sdk` (npm package, \~1.85M weekly downloads)
2. SDK bundles the Claude Code CLI internally — no separate install required
3. Call `query({ prompt, options })` which returns an `AsyncGenerator<SDKMessage>`
4. The SDK manages the agentic loop: send prompt → Claude responds → tools execute → repeat
5. Authenticates directly with an **Anthropic API key** (or Bedrock/Vertex/Azure credentials)

### Control Surface

| Capability | Mechanism | Granularity |
| --- | --- | --- |
| Start agent | `query({ prompt, options })` | Full configuration per query |
| Stop/cancel | `AbortController` or `query.close()` | Immediate termination |
| System prompt | `systemPrompt` option (string or preset) | Full custom or Claude Code preset with `append` |
| Model selection | `model` option + `fallbackModel` | Per-query, any Claude model |
| Tool allowlist | `allowedTools` / `disallowedTools` | Exact tool names |
| Custom tools | MCP servers (stdio, SSE, HTTP, in-process SDK) | Full — define tools with Zod schemas |
| Tool permissions | `permissionMode` + `canUseTool` callback | Per-tool, per-call, with input mutation |
| Thinking control | `thinking` config (adaptive, enabled, disabled, budget tokens) | Per-query |
| Max turns | `maxTurns` | Per-query |
| Max budget | `maxBudgetUsd` | Per-query, in USD |
| Working directory | `cwd` option | Per-query |
| Session resume | `resume` (session ID) / `forkSession` | Resume or fork |
| Structured output | `outputFormat: { type: 'json_schema', schema }` | JSON schema-constrained |
| Subagents | `agents` option with `AgentDefinition` | Inline definition with tools, model, prompt |
| Environment variables | `env` option | Per-query |
| Effort level | \`effort: 'low' | 'medium' |
| Hooks | 17+ hook events with callbacks | Pre/post tool use, session lifecycle, permissions |
| Streaming granularity | `includePartialMessages` option | Token-by-token Anthropic SDK events |
| File checkpointing | `enableFileCheckpointing` + `rewindFiles()` | Rewind to any user message |
| Prompt suggestions | `promptSuggestions` option | Get predicted next user prompt |
| Debug logging | `debug` / `debugFile` | To file or stderr |

### Observable Messages (SDKMessage types)

| Message Type | Data Available |
| --- | --- |
| `SDKAssistantMessage` | Full `BetaMessage` from Anthropic API: content blocks (text, tool_use, thinking), model, stop_reason, usage (input/output/cache tokens), `parent_tool_use_id` for subagent tracking |
| `SDKPartialAssistantMessage` | Raw stream events (`BetaRawMessageStreamEvent`) — token-by-token content deltas, thinking deltas |
| `SDKUserMessage` | User and synthetic messages (tool results), `tool_use_result` |
| `SDKResultMessage` | `duration_ms`, `duration_api_ms`, `num_turns`, `total_cost_usd`, `usage` breakdown, `modelUsage` per-model, `permission_denials[]`, `structured_output`, `stop_reason` |
| `SDKSystemMessage` (init) | `session_id`, `tools[]`, `model`, `permissionMode`, `mcp_servers`, `agents`, `skills`, `plugins`, `claude_code_version` |
| `SDKCompactBoundaryMessage` | Compaction trigger, pre-compaction token count |
| `SDKStatusMessage` | Agent status updates |
| `SDKHookStartedMessage` | Hook execution started |
| `SDKHookProgressMessage` | Hook execution progress |
| `SDKHookResponseMessage` | Hook execution results |
| `SDKToolProgressMessage` | Tool execution progress |
| `SDKToolUseSummaryMessage` | Tool usage summary |
| `SDKTaskNotificationMessage` | Background task notifications |
| `SDKTaskStartedMessage` | Subagent task started |
| `SDKTaskProgressMessage` | Subagent task progress |
| `SDKRateLimitEvent` | Rate limit hit details |
| `SDKPromptSuggestionMessage` | Predicted next user prompt |
| `SDKFilesPersistedEvent` | File checkpoint saved |
| `SDKAuthStatusMessage` | Authentication status |

---

## Side-by-Side Comparison

### 1. Programmatic Control

| Dimension | CLI/ACP | Agent SDK | Winner |
| --- | --- | --- | --- |
| System prompt | Prepended to first message (workaround) | `systemPrompt` option — full custom or preset with `append` | **SDK** |
| Model selection | Fixed by agent binary | `model` option, any Claude model, changeable mid-session | **SDK** |
| Tool allowlist | No control — agent decides | `allowedTools` / `disallowedTools` — exact names | **SDK** |
| Custom tools | Not possible | MCP servers + in-process SDK tools with Zod schemas | **SDK** |
| Tool permission granularity | Per-call approve/deny (binary) | `canUseTool` callback with input mutation, `updatedPermissions`, `interrupt` | **SDK** |
| Thinking/reasoning budget | No control | `thinking: { type, budgetTokens }` + `effort` level | **SDK** |
| Max turns / budget | No control | `maxTurns`, `maxBudgetUsd` | **SDK** |
| Structured output | Not possible | `outputFormat: { type: 'json_schema', schema }` | **SDK** |
| Subagent orchestration | Not possible | `agents` option — inline definition with per-agent tools, model, prompt | **SDK** |
| Session management | Create/load/cancel | Resume, fork, list sessions, file checkpointing with rewind | **SDK** |
| Mid-session changes | None | `setModel()`, `setPermissionMode()`, `streamInput()` | **SDK** |
| Context compaction | Opaque | `PreCompact` hook, compaction boundary messages, token counts | **SDK** |

### 2. Transparency / Observability

| Dimension | CLI/ACP | Agent SDK | Winner |
| --- | --- | --- | --- |
| Text output | Streamed chunks | Streamed chunks + full `BetaMessage` with content blocks | **SDK** |
| Thinking/reasoning | `agent_thought_chunk` — text only | Full thinking content blocks in `BetaMessage`, streaming deltas via `SDKPartialAssistantMessage` | **SDK** |
| Tool call details | `kind`, `title`, `rawInput` | Full typed tool input schemas, `tool_use_id`, `parent_tool_use_id` for subagent tracking | **SDK** |
| Tool results | Binary "done" marker only | Full `tool_use_result` on `SDKUserMessage`, `PostToolUse` hook with `tool_response` | **SDK** |
| Token usage | Not available | Per-message `usage` (input, output, cache tokens), per-model breakdown in result | **SDK** |
| Cost tracking | Not available | `total_cost_usd` in result message, `maxBudgetUsd` enforcement | **SDK** |
| Stop reason | Not available | `stop_reason` on both `BetaMessage` and `SDKResultMessage` | **SDK** |
| Turn count | Not available | `num_turns` in result | **SDK** |
| Timing | Not available | `duration_ms`, `duration_api_ms` in result | **SDK** |
| Rate limits | Not available | `SDKRateLimitEvent` | **SDK** |
| Permission denials | Implicit (agent sees cancel) | `permission_denials[]` in result with tool name, input, ID | **SDK** |
| Session metadata | `agent_name`, `agent_version` at spawn | `session_id`, `tools[]`, `model`, `mcp_servers`, `agents`, `claude_code_version` | **SDK** |
| Hook system | None | 17+ events: `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStart/Stop`, `PreCompact`, etc. | **SDK** |

### 3. Multi-Provider Support

| Dimension | CLI/ACP | Agent SDK | Winner |
| --- | --- | --- | --- |
| Claude | Yes (via claude-agent-acp) | Yes (native) | Tie |
| OpenAI / Codex | Yes (via codex-acp) | No | **ACP** |
| GitHub Copilot | Yes (via copilot --acp) | No | **ACP** |
| Google Gemini | Yes (via gemini --acp) | No | **ACP** |
| Ollama / local models | No (separate path) | No | Tie |
| Bedrock / Vertex / Azure | No | Yes (Claude via cloud providers) | **SDK** |

### 4. Architecture & Operations

| Dimension | CLI/ACP | Agent SDK | Winner |
| --- | --- | --- | --- |
| Installation | User must install each CLI globally | SDK bundles CLI; `npm install` is sufficient | **SDK** |
| Binary resolution | Complex 4-step PATH search with macOS workarounds | Handled internally by SDK | **SDK** |
| Process management | Manual: spawn, SIGKILL cleanup, thread management | SDK manages internally; `AbortController` / `close()` | **SDK** |
| Authentication | Subscription-based (browser popup per agent) | API key (set env var) or cloud provider credentials | Depends on use case |
| Auth model for distribution | Users use their own subscriptions | App developer pays via API key, or users provide their own | Depends on use case |
| Rust integration | Native — acp.rs runs in Tauri process | Requires Node.js sidecar or Tauri shell plugin for TypeScript SDK | **ACP** |
| Language | Rust (native Tauri) | TypeScript or Python (needs runtime) | **ACP** for Tauri |
| Latency overhead | stdio IPC (fast) | stdio IPC to bundled CLI (similar) | Tie |
| Session persistence | Agent manages internally | SDK manages — `listSessions()`, `resume`, `forkSession` | **SDK** |
| Resource usage | One process per agent | One process per query (or reuse via sessions) | Similar |
| Error types | Opaque strings from agent | Typed: `authentication_failed`, `billing_error`, `rate_limit`, `server_error` | **SDK** |

---

## Deep Dive: Thinking & Reasoning Transparency

### CLI/ACP

- `agent_thought_chunk` events stream thinking text in real-time
- Only available when the agent uses a thinking-capable model (e.g., Claude with extended thinking)
- Text-only — no metadata about thinking budget, usage, or type
- Stored in `activity-store.thinkingOutput` and displayed in the activity panel
- No control over thinking budget or whether thinking is enabled

### Agent SDK

- `thinking` option controls behavior:

  ```typescript
  thinking: { type: 'enabled', budgetTokens: 10000 }  // Fixed budget
  thinking: { type: 'adaptive' }                        // Model decides (default)
  thinking: { type: 'disabled' }                        // No thinking
  ```
- `effort` option (`'low' | 'medium' | 'high' | 'max'`) guides thinking depth
- Full thinking content blocks in `SDKAssistantMessage.message.content` (type `'thinking'`)
- Streaming thinking deltas via `SDKPartialAssistantMessage` events
- Token usage for thinking reported in `usage.cache_creation_input_tokens` and related fields
- `PreCompact` hook fires before context compaction — can save full transcript including thinking

**Verdict**: The SDK provides dramatically more visibility and control over reasoning. You can set budgets, force thinking on/off, stream thinking tokens, and get full usage metrics. ACP gives you the text but no control.

---

## Deep Dive: Tool Control & Permissions

### CLI/ACP

```
Agent decides to call tool
    → acp-permission-request event to frontend
    → Frontend checks permission-store tiers (none / session / always)
    → Auto-approve if tiered; show PermissionCard if not
    → acp_permission_respond(requestId, optionId or null)
    → Agent proceeds or stops
```

- **Approve/deny only** — cannot modify tool inputs
- **No pre-filtering** — agent can attempt any tool; you react after
- **Opaque results** — tool_result event has no content
- **No post-execution hooks** — cannot audit, log, or transform results

### Agent SDK

```typescript
// Allowlist: agent can ONLY use these tools
allowedTools: ["Read", "Glob", "Grep", "Edit"]

// Custom permission callback with input mutation
canUseTool: async (toolName, input, { signal, toolUseID }) => {
  if (toolName === "Bash" && input.command.includes("rm -rf")) {
    return { behavior: "deny", message: "Destructive commands not allowed" };
  }
  if (toolName === "Edit") {
    // Mutate the input before execution
    return {
      behavior: "allow",
      updatedInput: { ...input, file_path: sanitizePath(input.file_path) }
    };
  }
  return { behavior: "allow" };
}

// Pre/post hooks for auditing
hooks: {
  PreToolUse: [{
    matcher: "Bash|Edit|Write",
    hooks: [async (input) => {
      await auditLog(`Tool ${input.tool_name} called with ${JSON.stringify(input.tool_input)}`);
      return {};
    }]
  }],
  PostToolUse: [{
    matcher: "Edit|Write",
    hooks: [async (input) => {
      // Full tool_response available here
      await auditLog(`Tool result: ${JSON.stringify(input.tool_response)}`);
      return {};
    }]
  }]
}
```

- **Allowlist enforcement** — agent cannot even attempt disallowed tools
- **Input mutation** — modify tool inputs before execution (e.g., sanitize paths, add constraints)
- **Full result visibility** — `PostToolUse` hook receives complete `tool_response`
- **Audit trail** — log every tool call and result with full details
- **Block dangerous patterns** — deny based on input inspection (regex, path checks)

**Verdict**: The SDK provides defense-in-depth for tool control. ACP's approve/deny model is a coarse gate; the SDK's allowlist + `canUseTool` + hooks is a fine-grained policy engine.

---

## Deep Dive: Subagents & Parallel Execution

### CLI/ACP

- No subagent concept — each agent is a flat, single-threaded process
- To run multiple agents in parallel, spawn multiple processes (interactive + task)
- No orchestration between agents — each is independent
- No way to define specialized sub-tasks within an agent run

### Agent SDK

```typescript
const result = query({
  prompt: "Review this PR and check for security issues",
  options: {
    allowedTools: ["Read", "Glob", "Grep", "Task"],
    agents: {
      "security-reviewer": {
        description: "Checks for OWASP top 10 vulnerabilities",
        prompt: "Analyze code for security vulnerabilities. Focus on injection, XSS, auth issues.",
        tools: ["Read", "Glob", "Grep"],
        model: "opus"
      },
      "style-checker": {
        description: "Reviews code style and best practices",
        prompt: "Check code style, naming conventions, and TypeScript best practices.",
        tools: ["Read", "Glob", "Grep"],
        model: "haiku"  // Cheaper model for simpler task
      }
    }
  }
});
```

- Define specialized agents inline with custom prompts, tool restrictions, and model selection
- Main agent delegates via `Task` tool — subagents run in isolated context windows
- `parent_tool_use_id` on messages tracks which subagent produced which output
- `SubagentStart` / `SubagentStop` hooks for lifecycle monitoring
- Subagents can run in parallel for independent tasks
- Each subagent can have its own MCP servers

**Verdict**: The SDK enables sophisticated agent orchestration that is impossible with ACP.

---

## Integration with Notesage's Tauri Architecture

### Current ACP Integration Path

```
Frontend (React/TypeScript)
    ↓ invoke()
Rust Backend (Tauri)
    ↓ tokio::process::Command
Agent CLI Binary (subprocess)
    ↓ ACP over stdio
Agent's internal model calls
```

- Rust-native — fits naturally in Tauri
- No additional runtime dependencies
- Process isolation (agent crashes don't crash the app)

### SDK Integration Options

**Option A: Node.js sidecar process**

```
Frontend (React/TypeScript)
    ↓ invoke()
Rust Backend (Tauri)
    ↓ tauri::process::Command::new_sidecar("agent-worker")
Node.js Process (runs SDK)
    ↓ @anthropic-ai/claude-agent-sdk
Claude API
```

- Requires bundling Node.js with the app or assuming it's installed
- Communication via stdio or WebSocket between Rust and Node.js
- Adds \~70-100MB to app size for bundled Node.js
- Full SDK capabilities available

**Option B: Direct API from Rust (no SDK)**

```
Frontend (React/TypeScript)
    ↓ invoke()
Rust Backend (Tauri)
    ↓ reqwest HTTP client
Anthropic Messages API
```

- No SDK — implement the agentic loop in Rust
- Full API control but must build tool execution, streaming, session management
- Significant engineering effort to replicate SDK capabilities
- No subagents, hooks, file checkpointing, etc.

**Option C: Frontend-side SDK (TypeScript)**

```
Frontend (React/TypeScript)
    ↓ @anthropic-ai/claude-agent-sdk
    ↓ SDK spawns bundled CLI
Claude Code (subprocess of frontend)
    ↓ Claude API
```

- SDK runs in the renderer process
- Problem: SDK spawns child processes, which may not work in Tauri's webview
- API key would be in frontend memory (security concern)
- Not recommended for desktop apps

**Option D: Hybrid — ACP for multi-provider, SDK for Claude-specific features**

```
Frontend
    ↓ invoke()
Rust Backend
    ├── ACP path (Codex, Copilot, Gemini)
    └── Node.js sidecar path (Claude Agent SDK)
            ↓ Full SDK capabilities for Claude
```

- Best of both worlds but highest complexity
- Claude gets SDK benefits; other providers keep ACP
- Two code paths to maintain

---

## Pros & Cons Summary

### CLI/ACP — Pros

1. **Multi-provider**: Works with Claude, Codex, Copilot, Gemini — any ACP-compatible agent
2. **Rust-native**: No additional runtime; fits naturally in Tauri's architecture
3. **User subscriptions**: Users authenticate with their own CLI subscriptions — no API key cost to app developer
4. **Process isolation**: Agent crashes don't affect the host app
5. **Simpler auth for users**: "Log in with your existing Claude/Copilot subscription" is zero-friction
6. **No API key management**: Users don't need to create or manage API keys
7. **Proven implementation**: \~1050 lines of production Rust code already working

### CLI/ACP — Cons

 1. **Opaque agent**: No control over system prompt, model, tools, thinking, or output format
 2. **Coarse permissions**: Approve/deny only — no input mutation, no pre-filtering, no audit hooks
 3. **Limited observability**: No token usage, cost, stop reason, turn count, tool results
 4. **No subagents**: Flat execution — cannot decompose tasks into specialized sub-tasks
 5. **Binary dependency**: Users must install each agent CLI separately (complex for non-developers)
 6. **Complex binary resolution**: 4-step PATH search with macOS workarounds (\~80 lines just for finding the binary)
 7. **Thinking is text-only**: No budget control, no usage metrics, no on/off toggle
 8. **No structured output**: Cannot request JSON schema-constrained responses
 9. **No budget limits**: Cannot cap spending per task
10. **Workaround-heavy**: System prompt via prepending, no per-prompt options

### Agent SDK — Pros

 1. **Full programmatic control**: System prompt, model, tools, thinking, effort, budget, output format — all configurable per-query
 2. **Deep observability**: Token usage, cost, timing, stop reason, tool results, permission denials, rate limits — all exposed
 3. **Fine-grained permissions**: Allowlist + `canUseTool` callback with input mutation + pre/post hooks
 4. **Subagent orchestration**: Define specialized agents with custom prompts, tools, and models
 5. **Thinking control**: Set budgets, enable/disable, stream thinking tokens, get usage metrics
 6. **Structured output**: JSON schema-constrained responses for reliable data extraction
 7. **Budget enforcement**: `maxBudgetUsd` and `maxTurns` prevent runaway costs
 8. **Self-contained**: SDK bundles the CLI — `npm install` is the only setup
 9. **Session management**: Resume, fork, list sessions, file checkpointing with rewind
10. **17+ hook events**: Full lifecycle observability and intervention points
11. **MCP integration**: Connect to databases, browsers, APIs via standard protocol
12. **Context compaction visibility**: Know when and why context was compacted

### Agent SDK — Cons

1. **Claude-only**: Only works with Anthropic's Claude — no Codex, Copilot, or Gemini
2. **Requires Node.js**: TypeScript SDK needs a Node.js runtime — adds \~70-100MB to app bundle
3. **API key required**: Users must have an Anthropic API key (or Bedrock/Vertex/Azure credentials)
4. **API cost model**: Per-token billing — users pay directly for API usage, or app developer absorbs cost
5. **No Rust SDK**: No native Rust implementation — must bridge via sidecar process
6. **Proprietary license**: SDK is not open source (Anthropic Commercial Terms)
7. **Architecture complexity**: Adding a Node.js sidecar to a Tauri app is non-trivial
8. **Branding restrictions**: Cannot use "Claude Code" branding; limited to "Claude Agent" or "Powered by Claude"
9. **No subscription auth**: Cannot leverage existing Claude Pro/Team subscriptions — API key only

---

## Recommendation

The choice depends on Notesage's strategic direction:

### Keep ACP if:

- Multi-provider support remains a priority (users choose between Claude, Codex, Copilot, Gemini)
- Users prefer authenticating with existing subscriptions rather than managing API keys
- Minimizing app bundle size and runtime dependencies matters
- The current level of control and observability is sufficient

### Move to SDK if:

- Deep programmatic control over agent behavior is essential (system prompts, tool policies, thinking budgets)
- Observability is critical (cost tracking, token usage, tool result auditing)
- Subagent orchestration would unlock meaningful product features
- Structured output is needed for reliable data pipelines
- You want to eliminate the "install the CLI binary" user friction

### Hybrid approach (recommended):

- Use the **Agent SDK** for Claude-specific features where deep control matters (comment delegation, structured agent tasks, research workflows)
- Keep **ACP** for multi-provider interactive chat where the user's choice of agent matters most
- Route via the existing `routing-store` — the `agent_tasks` slot uses SDK, the `interactive` slot uses ACP or direct API

This lets Notesage offer the best of both worlds: sophisticated Claude-powered agent features with full control, alongside user-choice multi-provider chat. The incremental cost is a Node.js sidecar for the SDK path, which Phase 10 (Agent Binary Management) already contemplates.

---

## References

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [claude-agent-sdk-typescript on GitHub](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Building Agents with the Claude Agent SDK (Anthropic Engineering)](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Subagents in the SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/subagents)
- Current Notesage ACP implementation: `src-tauri/src/commands/acp.rs`
- Current frontend integration: `src/hooks/useAIOperations.ts`, `src/hooks/useAgentTaskOperations.ts`