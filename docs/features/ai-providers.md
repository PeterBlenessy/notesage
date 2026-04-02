# AI Providers

Multi-provider AI architecture with subscription-based auth, agent mode, and per-use-case routing.

## Connections & Routing

- Multi-provider connection system: users can connect multiple AI providers simultaneously
- Three auth methods: API key (Anthropic, OpenAI), agent-managed subscription (Claude Code, Codex, Copilot, Gemini CLI via ACP/LSP), local (Ollama)
- Per-use-case routing: separate provider assignment for interactive (chat + inline actions), agent tasks, and inline completion
- GitHub Copilot split into two connections: CLI (ACP — chat/agents only) and LSP (inline completions + chat/agents)
- Smart auto-assignment: first connection fills all compatible use case slots
- One-time migration from v1 ai-store preserves existing API key configurations
- API keys stored in OS keychain (macOS Keychain via `keyring` crate) — never in localStorage. Backend resolves keys from keychain using `connection_id`, keys never transit through IPC. Transparent migration moves existing plaintext keys to keychain on first launch.
- Multiple OpenAI-compatible connections supported with user-defined labels (e.g., "Groq", "Together AI")
- Settings UI: Connections list with provider cards, Add Connection popover with capability guidance, Advanced Routing collapsible section

## Four AI Paths

### Path 1: Direct API (for `api_key` and `local` connections)

```typescript
interface AIProvider {
  name: 'anthropic' | 'openai' | 'ollama' | 'local';
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  chat(messages: ChatMessage[]): Promise<string>;
}
```

- **Anthropic:** Claude Sonnet 4.5 (Messages API with server-side web search via `web_search_20250305`)
- **OpenAI:** GPT-4o (Responses API `/v1/responses` with `web_search_preview` tool)
- **Ollama:** Local AI models (no web search). Generic thinking/reasoning model support via runtime capability detection — queries `/api/show` before streaming to determine whether the model supports native `think: true` (separate `message.thinking` field), has thinking tags in its template (`{{.Thinking}}`), or uses `<think>` tags by convention. No hardcoded model-specific tags.
- **Local AI (bundled):** Privacy-focused offline inference via bundled llama-server sidecar. OpenAI-compatible `/v1/chat/completions` endpoint on localhost. Thinking/reasoning model support via hardcoded tag parser (scans for `<think>`, `<reasoning>`, `<reflection>`, etc.). Inline completions via `/infill` FIM endpoint with chat-based fallback for non-FIM models. Models downloaded from Hugging Face in GGUF format to `~/.notesage/models/llm/`. Metal GPU acceleration on macOS.

### Path 2: ACP — Agent Client Protocol (for `agent_managed` connections)

- Uses the `agent-client-protocol` Rust crate to communicate with agent subprocesses over stdio
- Agent processes spawned with `kill_on_drop(true)` — SIGKILL sent when `Child` is dropped
- Agent auth: ACP `authenticate` method delegates to the agent subprocess. Most agents open a browser for OAuth. Agents that can't open a browser from a subprocess (e.g., Gemini CLI — same limitation as Zed editor #43288) fall back to API key input or terminal-based auth.
- Gemini CLI auth: in-app API key input (from Google AI Studio, free) stored as `envVars` in connection credentials and passed at spawn time. Terminal-based Google OAuth as secondary option via `run_in_terminal` command.
- Agent subprocess stderr is logged at info level for auth debugging
- Prompts sent via `acp_session_prompt`, responses streamed as `acp-session-update` Tauri events
- Four supported agents: Claude Code (`claude-agent-acp`), Codex (`codex-acp`), Copilot (`copilot --acp`), Gemini CLI (`gemini --acp`)
- Process cleanup: `AcpState::stop_all_sync()` called from `RunEvent::Exit` hook; frontend `beforeunload` as secondary defense
- Session resilience: 5-minute unresponsive timer checks if agent is alive (not auto-kill). `AgentStatusBanner` shows Wait/Retry/Cancel options. `acp-agent-exited` event for instant crash detection. Retry uses `acp_agent_reconnect` + `session/load` for context restoration, continues in same branch (no dead branches). `agent-status-store` for banner state.
- Permission request handling: all tool calls require explicit user approval with tiered options (allow once / allow for session / allow always)
- Tiered permission UI: PermissionCard with split Allow button + dropdown for session/always; session approvals non-persisted, always approvals persisted via Zustand persist
- Thinking effort slider for Codex ACP: Default / Low / Medium / High / Extra High (hidden for free accounts)
- Dynamic model dedup: strips `/low`, `/medium`, `/high`, `/xhigh` reasoning effort variants from model lists
- ACP crate version 0.10/0.11 with `usage_update` event support
- Network sandboxing: agent traffic routed through localhost HTTP proxy with per-agent domain allowlists (see Network Sandboxing section)
- Context-aware chat footer: "Search" toggle for direct API connections

### Path 3: Copilot LSP (for `inline_completion` use case only)

- Spawns `copilot-language-server --stdio` subprocess managed by `CopilotLspState`
- JSON-RPC 2.0 transport for LSP document sync and `textDocument/inlineCompletion` requests
- Ghost text rendered as ProseMirror widget decorations via `GhostText` Tiptap extension
- Separate from ACP — the Copilot CLI (`copilot --acp`) handles chat/agents, the LSP handles completions only
- **Capabilities restricted to `['inline_completion']`** — never assigned to interactive or agent_tasks routing slots (LSP does not speak ACP)
- Global inline completions toggle (persisted in settings-store, applies to all tabs)
- OAuth device flow authentication with two protocol variants:
  - **Protocol A** (copilot.lua-era): `signInInitiate` → returns `{ userCode, verificationUri }` → `signInConfirm` (blocks until auth completes)
  - **Protocol B** (newer LSP): `signIn` → returns `{ userCode, verificationUri, command }` → `finishDeviceFlow` (deferred to user click)
- Device code UX: code shown in modal, auto-copied to clipboard, browser opens only when user clicks "Open GitHub". The `finishDeviceFlow` command is stashed in `pending_auth_command` and triggered by `copilot_lsp_finish_auth` to prevent the LSP from opening the browser before the user sees the code.
- All JSON-RPC messages logged at info level and emitted as `copilot-lsp-message` Tauri events for debugging

### Path 4: Local Bundled (for `local_bundled` connections)

- Bundled `llama-server` binary runs as a Tauri sidecar process on localhost
- Auto-starts on app launch when enabled and a model is downloaded; auto-restarts on crash (max 3 retries)
- Process cleanup: `LocalInferenceState::stop_sync()` via `RunEvent::Exit` hook; `pkill llama-server` at startup for crash recovery
- Chat streaming via `/v1/chat/completions` (OpenAI-compatible SSE)
- Inline completions via `/infill` (FIM) with `/v1/chat/completions` instructed chat fallback for non-FIM models
- Model catalog embedded at compile time from `model-catalog.json`; 18 curated models across 4 categories (general, code, reasoning, compact) with capability metadata (FIM, tool calling, thinking tags, vision, multilingual, RAM-tier recommendations)
- Health checks every 30s via `/health` endpoint

### Routing

`useAIOperations` reads the `interactive` connection from `routing-store`. If the connection is `api_key`/`local`, it uses Path 1 (direct API). If `local_bundled`, it uses Path 4 (bundled server). If `agent_managed`, it uses Path 2 (ACP). `useCopilotCompletion` independently reads the `inline_completion` connection and manages the Copilot LSP. `useLocalCompletion` handles inline completions for `local`, `local_bundled`, and `openai_compatible` connections. The rest of the app (chat panel, bubble menu) is unaware of which path is used.

## Inline Completions

Ghost text completions via the Copilot Language Server or local/compatible providers.

**Copilot LSP flow:**

1. `useCopilotCompletion` spawns `copilot-language-server --stdio` via `copilot_lsp_start`
2. LSP completes `initialize` → `initialized` → `workspace/didChangeConfiguration` handshake
3. On tab activation: sends `textDocument/didOpen` with ProseMirror plain text content
4. On editor update: sends `textDocument/didChange` (full content replacement), debounces 150ms
5. After debounce: sends `textDocument/inlineCompletion` at cursor position
6. Hook strips already-typed prefix, dispatches `setGhostText` to ProseMirror plugin
7. Tab to accept, Escape to dismiss, any keystroke auto-dismisses

**Local/compatible flow:**

1. `useLocalCompletion` activates for `local` (Ollama), `local_bundled`, or `openai_compatible` connections
2. On editor update: debounces 300ms, extracts prefix/suffix text around cursor
3. For Ollama: native `/api/generate` FIM endpoint
4. For local bundled: `/infill` FIM endpoint; on 501 falls back to instructed chat
5. For OpenAI-compatible: `/v1/completions` endpoint
6. Error backoff: stops after 5 consecutive failures; resets on connection/model/tab change

## Local AI (Bundled Inference)

Privacy-focused offline AI with zero setup — no API keys, no external software, no accounts required.

**Model management:**

- Curated model catalog (18 models) embedded at compile time (`model-catalog.json`) with per-model capability metadata (`category`, `supports_tool_calling`, `supports_thinking`, `thinking_tags`, `supports_vision`, `multilingual`, `recommended_for`)
- Models downloaded from Hugging Face in GGUF format to `~/.notesage/models/llm/`
- Download progress via Tauri events, concurrent downloads with cancel support
- System RAM detection for model recommendations per tier (8GB, 16GB, 32GB, 64GB)
- Settings → Local AI tab with model cards, capability badges (Tools, Think, FIM, Vision, Multi), category filter tabs (All, General, Code, Reasoning, Downloaded), sort dropdown (Name, Size, RAM)
- Custom model support via `~/.notesage/models/llm/custom-models.json`
- Model metadata enrichment: GGUF header parsing, HF API metadata, runtime `/v1/models` — merged with hover tooltips

**Ollama thinking/reasoning model support:**

- Before streaming, queries `/api/show` to detect model capabilities at runtime
- Models with native `thinking` capability: uses `think: true` parameter, thinking in separate `message.thinking` JSON field
- Models without native support but with template tags: extracts opening/closing tags from model template
- Fallback to `<think>...</think>` for models with reasoning in name/family
- Non-reasoning models: content passed through without tag parsing
- Thinking content displayed in a collapsible section above the assistant response
- Detection code: `detect_thinking_support()` in `ai_streaming.rs`

## Network Sandboxing

Two-layer network filtering for agent subprocesses: kernel-level enforcement via Seatbelt + application-level domain filtering via HTTP proxy.

**Architecture:**

- **Layer 1 — Kernel enforcement (Seatbelt):** The sandbox profile uses `(deny default)` which blocks all network. Only `(allow network-outbound (remote ip "localhost:<proxy_port>"))` is permitted. Agents physically cannot bypass the proxy, even if they ignore `HTTP_PROXY` env vars. Uses `"*:*"` for bind/inbound (IPv6 dual-stack compatibility). DNS is intentionally blocked — resolution happens through the proxy.
- **Layer 2 — Proxy enforcement:** Rust HTTP proxy server (`network_proxy.rs`) binds to a random localhost port. Agent subprocesses have `HTTP_PROXY`/`HTTPS_PROXY` env vars set. All outbound requests are checked against the connection's domain allowlist. Unknown domains trigger a `domain-approval-request` Tauri event.
- Sandbox profiles are ephemeral temp files (`$TMPDIR/notesage-sandbox-<instanceId>.sb`), cleaned up on agent exit

**Domain allowlists:**

- Built-in default allowlists per provider (e.g., `api.anthropic.com` for Claude Code, `chatgpt.com` for Codex, `api.github.com` for Copilot)
- User-configurable additional domains per connection in the config dialog
- Telemetry domains (e.g., `sentry.io`) controlled by a separate toggle per connection

**Approval flow:**

- `DomainApprovalCard` in chat shows the requesting domain with allow/deny options
- Allow once: permits the single request
- Allow for session: permits for the current app session (non-persisted)
- Allow always: adds to persisted allowlist in `permission-store`
- Deny: blocks the request; denial shown as a chat message
- 30-second auto-deny timeout for unanswered requests

**Violation monitoring:**

- `sandbox_monitor.rs` spawns `log stream` to read macOS unified log for Seatbelt deny entries
- Filters by registered agent PIDs (registered on spawn, unregistered on exit)
- Deduplication: same (PID, operation, resource) within 5s coalesced into single event
- Rate limiting: max 10 violation events per second per agent
- Violations surface as error entries in the Activity panel alongside tool calls and domain approvals

**Security UI:**

- Connection config dialog has a boxed Security section with filesystem sandbox toggle, network restriction toggle, kernel enforcement toggle, and custom writable paths
- Kernel enforcement toggle: visible when network restriction is on; default on for new connections, off for existing (safe migration)
- Connection cards show Sandbox / Network / Managed badges
- Network restriction toggle enables/disables the proxy for each connection

## Tool Calling

Client-side tool calling for all direct API providers (Anthropic, OpenAI, Ollama, local bundled). Models can autonomously call tools and receive results in a multi-turn execution loop.

**Built-in tools (6):**

| Tool | Description | Permission |
| --- | --- | --- |
| `web_search` | Search the web via DuckDuckGo | Auto-allowed |
| `read_skill_content` | Load full SKILL.md body and file listing | Auto-allowed |
| `read_file` | Read a file from the filesystem | Auto-allowed |
| `list_directory` | List files and folders in a directory | Auto-allowed |
| `execute_skill_script` | Run a skill script (bash, python, node) | Requires approval |
| `write_file` | Create or overwrite a file | Requires approval |

**Skill-to-tool glue layer:**

Script-bearing skills are automatically converted to first-class tool definitions via the `extract_skill_tools` Tauri command, so even small local models can discover and call skills without multi-step meta-reasoning. The extraction pipeline tries three sources in priority order: explicit `tools:` frontmatter in SKILL.md, `Usage:` comment parsing from script headers, or a fallback generic `{ args: string[] }` schema. Tool names follow the `skill__{skill}__{script}` convention (or `skill__{skill}` for single-script skills). Knowledge-only skills (no scripts) remain as system prompt injections. Skill tools are filtered by the active agent's `allowed-tools` frontmatter. Skills that become tools are excluded from the system prompt text injection to avoid duplicate exposure.

**Execution loop:**

1. Frontend sends messages + tool definitions to `ai_chat_stream`
2. Model streams response; if it requests a tool call, an `ai-tool-call` event is emitted
3. Frontend checks permission: auto-allowed tools execute immediately, others show `ToolCallPermissionCard`
4. Tool is executed via the appropriate Tauri command
5. Result is fed back as a `role: "tool"` message and the model continues generating
6. Loop repeats until the model responds with text only or the 20-call-per-turn limit is reached

**Provider-specific format handling:**

- **Anthropic:** Tools sent as `tools` array with `input_schema`. Tool use detected via `content_block_start` with `type: "tool_use"` in SSE stream.
- **OpenAI:** Tools wrapped in `{ type: "function", function: { ... } }`. Tool calls detected via `delta.tool_calls` in streamed chunks.
- **Ollama:** Same format as OpenAI. Requires models with function calling support (Qwen3, Llama 3.1+, Mistral).
- **Local bundled:** Same format as OpenAI via `/v1/chat/completions`. Requires `--jinja` flag on llama-server (added automatically when `supports_tool_calling` is true in model catalog). Uses non-streaming fallback when tools are present due to llama-server streaming limitations with tool calls.

**Permission model:**

- Read-only tools (`read_file`, `read_skill_content`, `list_directory`, `web_search`) are auto-allowed
- Write/execute tools (`write_file`, `execute_skill_script`) require user approval
- `ToolCallPermissionCard` with tiered approval: allow once, allow for session, allow always
- 30-second auto-deny timeout for unanswered permission requests
- Permissions stored in `permission-store` (`toolCallSession` non-persisted, `toolCallAlways` persisted)

**Settings:**

- `toolCallingEnabled` toggle in Settings > Advanced (default: enabled)
- `searchProvider` setting for web search backend (DuckDuckGo)
- Tools indicator badge in chat footer showing count of available tools

## Web Search

Web search is implemented as a client-side tool (`web_search`) available to all providers when tool calling is enabled. The backend `web_search` Tauri command queries DuckDuckGo's HTML endpoint — no API key needed. Results are returned to the model as tool call results with title, URL, and snippet for each hit.

For providers that also support server-side web search (Anthropic `web_search_20250305`, OpenAI `web_search_preview`), the client-side tool provides a unified cross-provider experience. Citations extracted from responses are displayed as numbered "Sources" section.

## Key Files

| File | Purpose |
| --- | --- |
| `src-tauri/src/commands/ai.rs` | AI provider commands (direct API) |
| `src-tauri/src/commands/credentials.rs` | OS keychain credential storage (store, get, delete, migrate) |
| `src-tauri/src/commands/acp.rs` | ACP agent management |
| `src-tauri/src/commands/network_proxy.rs` | HTTP proxy for agent network sandboxing |
| `src-tauri/src/commands/sandbox_monitor.rs` | Seatbelt violation monitoring (macOS log stream) |
| `src-tauri/src/commands/sandbox.rs` | Seatbelt profile generation (kernel network deny) |
| `src-tauri/src/commands/copilot_lsp.rs` | Copilot Language Server (auth, completions, message logging) |
| `src-tauri/src/commands/dialog.rs` | Native dialogs + `run_in_terminal` for agent auth |
| `src-tauri/src/commands/local_inference.rs` | Bundled llama-server lifecycle |
| `src-tauri/src/commands/model_metadata.rs` | Model metadata merge + HF API fetcher |
| `src-tauri/src/commands/gguf_parser.rs` | GGUF binary header parser |
| `src-tauri/model-catalog.json` | Curated LLM model catalog |
| `src/lib/ai/` | Provider abstraction (types, connections, providers) |
| `src/hooks/useAIOperations.ts` | AI generation, chat, and ACP routing |
| `src/hooks/useCopilotCompletion.ts` | Copilot LSP lifecycle |
| `src/hooks/useLocalAI.ts` | Local AI server lifecycle |
| `src/hooks/useLocalCompletion.ts` | Local/compatible inline completions |
| `src/hooks/useModelMetadata.ts` | Batch model metadata fetching |
| `src/stores/connections-store.ts` | Provider connections |
| `src/stores/routing-store.ts` | Per-use-case provider routing |
| `src/components/chat/DomainApprovalCard.tsx` | Network domain approval UI |
| `src/components/chat/AgentSwitchCard.tsx` | Provider context isolation prompt |
| `src/stores/permission-store.ts` | ACP tool call permissions, domain allowlists, tool call permissions |
| `src/stores/local-ai-store.ts` | Local AI server state |
| `src/components/chat/ToolCallPermissionCard.tsx` | Tool call permission approval UI |
| `src/hooks/useDirectApiChat.ts` | Direct API chat with tool execution loop |
| `src/lib/tool-executor.ts` | Tool call routing (built-in + `skill__` prefix routing with arg mapping) |
| `src/stores/skill-store.ts` | Skills registry, agents, skill tool definitions, `getToolDefinitions()` |

## Future Enhancements

- ~~Agent binary auto-install wizard~~ — Complete (Phase 10): managed install to `~/.notesage/agents/bin/` with PATH fallback
- ~~ACP agent binary bundling as Tauri sidecar~~ — Superseded by managed install system; explicitly a non-goal in the install wizard PRD to avoid app bundle bloat
- Multi-line panel completions (`copilotPanelCompletion`)
- Inline edits / next edit suggestions (`copilotInlineEdit`)
- Partial acceptance (accept word-by-word)
- Embeddings and semantic search
- Windows/Linux llama-server bundling
