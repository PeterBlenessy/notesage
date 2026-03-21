# AI Providers

Multi-provider AI architecture with subscription-based auth, agent mode, and per-use-case routing.

## Connections & Routing

- Multi-provider connection system: users can connect multiple AI providers simultaneously
- Three auth methods: API key (Anthropic, OpenAI), agent-managed subscription (Claude Code, Codex, Copilot, Gemini CLI via ACP/LSP), local (Ollama)
- Per-use-case routing: separate provider assignment for interactive (chat + inline actions), agent tasks, and inline completion
- GitHub Copilot split into two connections: CLI (ACP — chat/agents only) and LSP (inline completions + chat/agents)
- Smart auto-assignment: first connection fills all compatible use case slots
- One-time migration from v1 ai-store preserves existing API key configurations
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

## Web Search

When web search is enabled (toggle in chat footer — only visible for direct API connections):

- **Anthropic:** `web_search_20250305` server tool added to request
- **OpenAI:** `web_search_preview` tool added to Responses API request
- **Ollama:** Search toggle disabled in UI (toast notification)
- Citations extracted from provider-specific response formats, displayed as numbered "Sources" section

## Key Files

| File | Purpose |
| --- | --- |
| `src-tauri/src/commands/ai.rs` | AI provider commands (direct API) |
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
| `src/stores/permission-store.ts` | ACP tool call permissions + domain allowlists |
| `src/stores/local-ai-store.ts` | Local AI server state |

## Future Enhancements

- Agent binary auto-install wizard (PRD: `docs/prds/2026-02-21-agent-install-wizard.md`)
- ACP agent binary bundling as Tauri sidecar
- Multi-line panel completions (`copilotPanelCompletion`)
- Inline edits / next edit suggestions (`copilotInlineEdit`)
- Partial acceptance (accept word-by-word)
- Embeddings and semantic search
- Windows/Linux llama-server bundling
