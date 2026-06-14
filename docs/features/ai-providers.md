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
- Agent auth: ACP `authenticate` method delegates to the agent subprocess. Most agents open a browser for OAuth. Agents that can't open a browser from a subprocess (e.g., Gemini CLI — same limitation as Zed editor #43288) fall back to API key input or terminal-based auth. Auth state comes from the ACP `authenticate` response — there are no per-provider CLI `auth status` probes.
- Gemini CLI auth: in-app API key input (from Google AI Studio, free) stored via the keychain-backed EnvVar flow below. Terminal-based Google OAuth as secondary option via `run_in_terminal` command.
- **EnvVar auth flow**: Agents advertising `AuthMethod::EnvVar` drive a generic credential form — required variable names, labels, and the "get credentials" link all come from the agent. Submitted values are written per-var to the OS keychain (`notesage:<connectionId>:env:<KEY>`) by `connections-store`; the persist partialize strips the values so only the var **names** (`credentials.envVarKeys`) reach localStorage. At spawn time `acp_agent_spawn` resolves the values from the keychain by `connection_id` + key name — keychain values are authoritative over the in-memory IPC fallback (same precedence as `resolve_api_key`). Legacy plaintext `envVars` persisted by older builds migrate to the keychain on rehydrate. This replaces the Gemini-specific API-key panel; new EnvVar-auth agents (including custom ACP agents) work without per-provider UI code.
- Agent subprocess stderr is logged at info level for auth debugging
- Prompts sent via `acp_session_prompt`, responses streamed as `acp-session-update` Tauri events
- Four built-in agents: Claude Code (`claude-agent-acp`), Codex (`codex-acp`), Copilot (`copilot --acp`), Gemini CLI (`gemini --acp`)
- **Custom ACP agents (`custom_acp` connections):** any ACP-compatible binary works. The connection stores `config.binaryPath` (absolute, validated verbatim by `acp_binary.rs`) + `config.binaryArgs`; registration runs the same probe (spawn → initialize → session → stop) and blocks on failure with the agent's stderr tail. Custom binaries match no `PROVIDER_OPTIONS` entry, so they default to **maximal confinement** — empty network allowlist, kernel deny on, no Bucket C `$HOME` grants.
- **Local Agent preset (Goose, `localAgentPreset: 'goose'`):** a managed `custom_acp` connection that wires the bundled [Goose](https://github.com/aaif-goose/goose) binary (an open-source ACP agent from the Agentic AI Foundation — AAIF, a Linux Foundation project; created by Block and donated to AAIF) to the local llama-server for fully-offline agentic chat — Path 2 over the same bundled model that Path 4 uses directly. Goose is a self-contained Rust binary launched as `goose acp` — no Node runtime, no npm install, and no cloud auth — so it runs cleanly under the strict `(deny default)` Seatbelt sandbox with a **100% empty network allowlist** (it talks only to the bundled llama-server over localhost). It installs via the GitHub-release-binary path (`aaif-goose/goose`, `goose-{rust-target-triple}.tar.gz`, min version 1.37.0), not npm. Goose is configured **purely via environment variables — no config file is written**: `local_agent_write_config` (Rust `local_agent.rs`) builds the env against the **live** server port + active model (`GOOSE_PROVIDER=openai`, `OPENAI_HOST=http://localhost:<port>`, `GOOSE_MODEL=<id>`, a dummy `OPENAI_API_KEY` the local server ignores, `GOOSE_DISABLE_KEYRING=1`, and all four `XDG_*` dirs redirected into a Notesage-owned `~/.notesage/agents/goose` tree so the user's own Goose setup is untouched). `ensureAcpAgent` keys the agent respawn on `<port>:<modelId>` (mirroring `sandboxScopeKey`), injects that env, and allows the llama-server port through the kernel network sandbox alongside the proxy. Set up via the staged `useLocalAgentSetup` flow (detect → download → configure → smoke-test). The smoke test gates the add: a failure at any setup stage **rolls back the connection** (`runLocalAgentSetup`'s `rollback` dep removes the just-created connection and clears its routing slot) so a broken Local Agent never lands in the provider dropdown. Once added, if the agent later becomes unhealthy (server down, spawn failure) the error **propagates and surfaces in the chat message** when the user sends — there is no silent Path-4 fallback and no header "Fix" pill (user decision). Server cold-start no longer trips this: `start_local_server` reuses a live server that already serves the requested model with ≥ the requested context, and only cold-starts otherwise, with a 120 s health budget (the old 30 s budget spuriously failed large-context / vision-model loads).

  > The preset previously used OpenCode but switched to Goose: OpenCode requires an npm install of its provider SDK + a cloud model-registry fetch at bootstrap, which could not be satisfied under the strict empty-allowlist sandbox. Goose was empirically verified to work with zero network and no config file.
- Process cleanup: `AcpState::stop_all_sync()` called from `RunEvent::Exit` hook; frontend `beforeunload` as secondary defense
- Session resilience: 5-minute unresponsive timer checks if agent is alive (not auto-kill). `AgentStatusBanner` shows Wait/Retry/Cancel options. `acp-agent-exited` event for instant crash detection. Retry uses `acp_agent_reconnect` + `session/load` for context restoration, continues in same branch (no dead branches). `agent-status-store` for banner state.
- **MCP pass-through:** the user's enabled, project-scope-matching MCP servers are attached to every ACP session at `session/new` (and re-sent on `session/load`), gated on the agent's advertised `McpCapabilities` (`mcp.stdio` / `mcp.http`). The frontend assembles them via `buildAcpMcpServerInputs` (from `mcp-store.getActiveServers`); the backend (`build_acp_mcp_servers` in `acp.rs`) resolves stdio env secrets from the keychain (`mcp::resolve_env`) and attaches OAuth bearer tokens for http servers — secrets never transit IPC in plaintext beyond the existing spawn path. Applies to all ACP agents, not just the Local Agent preset. (Crash-recovery reconnect currently reloads with no MCP — documented follow-up.)
- Permission request handling: all tool calls require explicit user approval with tiered options (allow once / allow for session / allow always)
- Tiered permission UI: PermissionCard with split Allow button + dropdown for session/always; session approvals non-persisted, always approvals persisted via Zustand persist
- Thinking effort slider for Codex ACP: Default / Low / Medium / High / Extra High (hidden for free accounts)
- Dynamic model dedup: strips `/low`, `/medium`, `/high`, `/xhigh` reasoning effort variants from model lists
- ACP crate version 0.14.0 (schema 0.13.6) with `usage_update` event support. Builder/component API (`role::acp::Client.builder()…connect_with(transport, |conn| …)`) replacing the old `ClientSideConnection`; inbound `request_permission` / `session/update` are handled via registered `on_receive_request` / `on_receive_notification` handlers instead of a `Client` trait impl, and the connection handle is `Send + Clone` (no `!Send` thread isolation needed). `session/close` and `session/resume` are stable. The dedicated session-model API (`session/set_model`) was removed upstream — model selection goes through the session config option with category `model`; assistant message identity is agent-assigned via `ContentChunk.message_id` (the old client-supplied `PromptRequest.message_id` was removed)
- Network sandboxing: agent traffic routed through localhost HTTP proxy with per-agent domain allowlists (see Network Sandboxing section)
- Context-aware command bar: "Search" toggle for direct API connections
- **Session modes**: Permission-level mode picker (Shield icon) in command bar (hidden by default, toggle in Settings > Advanced). Agent-specific mode IDs mapped to common permission levels: Read Only (can read, must ask for writes), Agent (can read and edit, asks for risky ops), Full Access (no permission prompts), Plan (read-only, proposes without executing). Mode-sandbox conflict dialog when selecting Full Access with active restrictions.
- **Dynamic config options**: Agent-reported config options (thinking effort, etc.) rendered as dropdowns in command bar. Config options with `category: "mode"` and `category: "model"` filtered (handled by dedicated pickers).
- **Capability probing**: At connection registration, lightweight spawn → session → read → stop cycle discovers available modes, config options, and capabilities. Stored on connection, auto-refreshed when stale (>24h).
- **Connection defaults**: Default mode and thinking effort configurable in connection settings dialog, applied automatically to new sessions.
- **Eager session creation**: Session created when chat panel opens (before first message), so mode picker and config options are immediately available.
- **Session restoration**: `acpSessionId` stored per conversation. Reopening an existing chat runs a capability-gated preference chain via `restoreOrCreateAcpSession`: `session/resume` (live takeover) → `session/load` (replay) → `session/list` (sanity check) → `session/new` (fresh). Each step is optional based on agent capabilities.
- **Session forking on branch**: Branching from the current leaf with an agent that advertises `session.fork` calls `session/fork` to give the new branch its own isolated agent-side session. Branches from historical messages share the parent session (ACP has no primitive to rewind agent state). Per-branch session IDs live on `Conversation.branchSessions`; the resolver `getSessionIdForLeaf` walks the active leaf's ancestors at prompt-send time.
- **Session close on delete**: Deleting a conversation fires best-effort `session/close` for its shared session and any per-branch sessions, so agents can free resources. Skipped when the agent doesn't advertise `session.close`.
- **Usage tracking**: `usage_update` events parsed and displayed as token count in command bar with cost tooltip.
- **Plan display**: `plan` session updates rendered as collapsible `PlanSegment` cards with status icons and priority dots.
- **Agent slash commands**: `available_commands_update` events populate the `/` command menu alongside Notesage skills.
- **Thinking segments**: `agent_thought_chunk` events rendered as collapsible thinking blocks in chat messages.
- **`@agent-name` pass-through**: When the user sends `@agent-name message` on an ACP connection, the full text is passed verbatim to the provider — the provider's own subagent system handles agent routing. No `<role-instructions>` block is injected into the ACP system prompt.

### Path 3: Copilot LSP (for `interactive`, `agent_tasks`, and `inline_completion` use cases)

- Spawns `copilot-language-server --stdio` subprocess managed by `CopilotLspState`
- JSON-RPC 2.0 transport for LSP document sync, `textDocument/inlineCompletion` requests, and `conversation/*` chat methods
- Ghost text rendered as ProseMirror widget decorations via `GhostText` Tiptap extension
- Separate from ACP — the Copilot CLI (`copilot --acp`) handles chat/agents via ACP protocol, the LSP handles completions and chat via JSON-RPC
- Full capabilities: `['interactive', 'inline_completion', 'agent_tasks']` — users can use their Copilot subscription for all AI features
- Global inline completions toggle (persisted in settings-store, applies to all tabs)
- **Project isolation.** `workingDir` reflects the command bar's selected project (not a hardcoded `projects[0]`). `textDocument/didOpen`, `didChange`, `didFocus`, and the `copilot/context-request` handler all gate on `isUriInScope(uri, { projectRoots, notesRootPath })` — tabs outside the selection never reach the LSP. Out-of-scope context requests return `null`; out-of-scope doc events suppress a rate-limited per-tab toast ("Completions disabled for this file — outside selected project scope"). `completionsOnOutOfScope: true` in Settings > Advanced restores the legacy behavior.
- OAuth device flow authentication with two protocol variants:
  - **Protocol A** (copilot.lua-era): `signInInitiate` → returns `{ userCode, verificationUri }` → `signInConfirm` (blocks until auth completes)
  - **Protocol B** (newer LSP): `signIn` → returns `{ userCode, verificationUri, command }` → `finishDeviceFlow` (deferred to user click)
- Device code UX: code shown in modal, auto-copied to clipboard, browser opens only when user clicks "Open GitHub". The `finishDeviceFlow` command is stashed in `pending_auth_command` and triggered by `copilot_lsp_finish_auth` to prevent the LSP from opening the browser before the user sees the code.
- All JSON-RPC messages logged at info level and emitted as `copilot-lsp-message` Tauri events for debugging

**Chat conversations** via `conversation/*` JSON-RPC methods:
- `conversation/create` — creates a session with the first user message
- `conversation/turn` — sends follow-up messages with streaming via `$/progress`
- `conversation/destroy` — closes the session
- `copilot/models` — lists available models (GPT-4o, Claude, Gemini, etc.)
- `conversation/registerTools` — registers client-side tools for agent mode
- `conversation/invokeClientTool` — server-to-client tool execution requests
- `conversation/context` — server-to-client editor context requests
- Full tool calling support (same tools as direct API path)
- Streaming responses rendered as chronological segments

### Path 4: Local Bundled (for `local_bundled` connections)

- Bundled `llama-server` binary runs as a Tauri sidecar process on localhost
- Auto-starts on app launch when enabled and a model is downloaded; auto-restarts on crash (max 3 retries)
- Process cleanup: `LocalInferenceState::stop_sync()` via `RunEvent::Exit` hook; `pkill llama-server` at startup for crash recovery
- Chat streaming via `/v1/chat/completions` (OpenAI-compatible SSE)
- Inline completions via `/infill` (FIM) with `/v1/chat/completions` instructed chat fallback for non-FIM models
- Optional second server process for FIM (`start_completion_server` / `stop_completion_server` / `get_completion_server_status`) — resolves the `--jinja`/FIM conflict by running a dedicated llama-server WITHOUT `--jinja` on port 8190+. When running, `local_bundled_fim` routes there via `resolve_fim_port`; otherwise it falls back to the main server's `/infill` → chat chain. Lets users keep tool calling (which needs `--jinja`) on the main chat model AND get fast native FIM from a code-specialist like Qwen2.5-Coder at the same time. Pays a second model's worth of RAM/VRAM — opt-in only, no auto-start. UI lives in `CompletionServerSection` (Settings → Local AI), backed by the `completionModelId` / `completionServerStatus` / `completionServerPort` slice of `local-ai-store`. The store listens for `local-completion-server-status` events so out-of-band start/stop (e.g. `RunEvent::Exit`) stays in sync. `completionModelId` is persisted; the runtime status fields are not.
- Model catalog embedded at compile time from `model-catalog.json`; 18 curated models across 4 categories (general, code, reasoning, compact) with capability metadata (FIM, tool calling, thinking tags, vision, multilingual, RAM-tier recommendations)
- Health checks every 30s via `/health` endpoint

### Routing

`useAIOperations` reads the `interactive` connection from `routing-store`. If the connection is `api_key`/`local`, it uses Path 1 (direct API). If `local_bundled`, it uses Path 4 (bundled server). If `agent_managed` with `lspBinary`, it uses Path 3 (Copilot LSP `conversation/*` methods). If `agent_managed` without `lspBinary`, it uses Path 2 (ACP). `useCopilotCompletion` independently reads the `inline_completion` connection and manages the Copilot LSP for ghost text. `useLocalCompletion` handles inline completions for `local`, `local_bundled`, and `openai_compatible` connections. The rest of the app (chat panel, bubble menu) is unaware of which path is used.

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

**Project isolation.** Both flows check `isUriInScope(activeTabUri, { projectRoots, notesRootPath })` before firing a completion request. Out-of-scope tabs skip the request entirely — no LSP traffic for Copilot, no FIM call for local/compatible. The editor StatusBar shows a muted "Completions: off (outside project)" indicator when suppressed, with a tooltip linking to the Settings > Advanced toggle. `completionsOnOutOfScope: true` restores legacy behavior.

## Local AI (Bundled Inference)

Privacy-focused offline AI with zero setup — no API keys, no external software, no accounts required.

**Model management:**

- Curated model catalog (18 models) embedded at compile time (`model-catalog.json`) with per-model capability metadata (`category`, `supports_tool_calling`, `supports_thinking`, `thinking_tags`, `supports_vision`, `multilingual`, `recommended_for`, `draft_model_id`)
- Models downloaded from Hugging Face in GGUF format to `~/.notesage/models/llm/`
- Download progress via Tauri events, concurrent downloads with cancel support
- System RAM detection for model recommendations per tier (8GB, 16GB, 32GB, 64GB)
- Settings → Local AI tab with model cards, capability badges (Tools, Think, FIM, Vision, Multi), category filter tabs (All, General, Code, Reasoning, Downloaded), sort dropdown (Name, Size, RAM)
- Custom model support via `~/.notesage/models/llm/custom-models.json`

**Speculative decoding:**

Catalog entries can pair a main model with a smaller `draft_model_id` from the same family. When both files are downloaded, `start_local_server` passes `--model-draft <path>` to llama-server — the draft generates candidate tokens that the main model verifies in parallel for a 1.5-2x speedup on long outputs. Current pairings: Qwen3 8B/14B → Qwen3 1.7B, Qwen2.5-Coder 7B → Qwen2.5-Coder 1.5B, DeepSeek-R1-Distill 7B/14B → DeepSeek-R1-Distill 1.5B. Auto-enabled silently when the draft is present; never auto-downloaded (extra RAM/VRAM cost is an opt-in by the user installing the draft from Settings → Local AI). The `catalog_draft_model_ids_resolve_to_compatible_models` test enforces that every pairing's draft exists in the catalog and shares the main's architecture.
- Model metadata enrichment: GGUF header parsing, HF API metadata, runtime `/v1/models` — merged with hover tooltips

**Ollama thinking/reasoning model support:**

- Before streaming, queries `/api/show` to detect model capabilities at runtime
- Models with native `thinking` capability: uses `think: true` parameter, thinking in separate `message.thinking` JSON field
- Models without native support but with template tags: extracts opening/closing tags from model template
- Fallback to `<think>...</think>` for models with reasoning in name/family
- Non-reasoning models: content passed through without tag parsing
- Thinking content displayed in a collapsible section above the assistant response
- Detection code: `detect_thinking_support()` in `segment_builder.rs`

## Filesystem & Network Sandboxing

Multi-layer defense: the Seatbelt profile denies reads and writes by default in `$HOME` and network by default, then re-allows a curated set of paths and the local proxy port.

**Filesystem policy (read):**

- `(deny default)` + `(allow file-read*)` for system paths (`/usr`, `/bin`, `/Library`, `/opt`, `/System`, `/private/var`, `/tmp`, etc.)
- `(deny file-read* (subpath "$HOME"))` blocks every read inside `$HOME` by default
- Curated re-allow list inside `$HOME`:
  - **Bucket B (runtime):** `~/.npm`, `~/.nvm`, `~/.volta`, `~/.fnm`, `~/.asdf`, `~/.yarn`, `~/.pnpm`, `~/.bun`, `~/.deno`, `~/.cargo`, `~/.rustup`, `~/.local`, `~/.config`, `~/.cache`, `~/Library/Caches`, `~/Library/Application Support`, `~/Library/Preferences`, `~/.gitconfig`, `~/.gitignore_global`
  - **Bucket C (per-agent config):** narrowed by agent binary — `claude-agent-acp` gets `~/.claude` + `~/.claude.json` + `~/.claude.json.backup` + `~/Library/Keychains/login.keychain-db`; `codex-acp` gets `~/.codex`; `copilot`/`copilot-language-server` get `~/.copilot` + keychain; `gemini` gets `~/.gemini`. Basename extraction means the match works whether the caller passes the bare command or the resolved absolute path.
  - **Writable paths:** the command bar's selected project(s) — plus any ancestor-literal reads required for `fs.watch` parent-chain traversal on nested iCloud paths
- Ancestor directory literal-allows: each writable path's ancestor dirs up to `$HOME` are `(literal)`-allowed so `fs.watch` and workspace-marker discovery can `stat` / `readdir` the parents without exposing sibling contents
- Explicit deny-last: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gcloud`, and regex `\.env$` / `\.env\..*$` are denied after all the above (overrides any earlier allow)

**Filesystem policy (write):**

- Writable subpaths = command bar's selected projects (respawn on change) — plus `/tmp`, `/private/tmp`, `/private/var/folders`, `~/.config`, agent's own config dir, and a short list of device nodes (`/dev/null`, `/dev/tty`, etc.)
- Keychain literal is read-only — filtered out of the write-allow list

**Writable scope:** `getChatSandboxScope(conv, connection, crossProjectMode)` computes the set. Default mode returns `conv.projectPaths ∪ connection.extraWritablePaths`. Cross-project mode (opt-in) unions all workspace folders. `sandboxScopeKey` in `acp-agent-state.ts` triggers a respawn when the scope changes.

**Known residual:** two sibling projects at neutral paths (e.g. `~/Code/A` and `~/Code/B`) where neither is selected but both are outside the curated deny tree would not be mutually isolated if only one were selected. The `$HOME`-deny-by-default model closes this, but requires the allow list to grow with upstream agent updates — tracked in `docs/prds/2026-04-19-agent-sandbox-observability.md`.

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

## Structured Output (Schema-Constrained Generation)

Callers can pass an OpenAI-style `response_format` envelope to `ai_chat_stream` to constrain output against a JSON schema. The frontend helper `generateStructured()` in `src/lib/ai/structured.ts` wraps the call and returns a parsed object.

| Provider | Backend | Guarantee |
| --- | --- | --- |
| `local_bundled` (llama-server) | Schema → GBNF grammar; invalid tokens get `-inf` logits | 100% schema-valid output |
| `openai_compatible` | Forwarded verbatim to upstream `/v1/chat/completions` | Depends on upstream (XGrammar, Outlines, etc.) |
| `ollama` | Schema unwrapped to Ollama's bare-schema `format` field (or the literal string `"json"` for `json_object`) via `ollama_response_format` | Constrained via XGrammar |
| `anthropic`, `openai` | Ignored (different envelope shapes; not wired yet) | Best-effort prompt engineering |

`response_format` is not sent alongside `tools` for `local_bundled` — llama-server treats them as mutually exclusive grammar sources, and the tool autoparser already constrains tool-call output via the model's Jinja template. Use one or the other per request.

Use cases: skill scripts that need typed output, intent classification before tool dispatch, metadata extraction from documents, agentic planning steps that must emit a specific shape.

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

**ReAct-style protocol for local models:**

`localSystemMessage` in `useAIContext` appends a short tool-use protocol (`src/lib/ai/react-prompt.ts`) when `toolCallingEnabled` is true. It tells the model to reason in one sentence before each tool call, reflect on the result before the next step, vary its approach on errors, and prefer one well-chosen call over speculative chains. Gated to `local_bundled` only — frontier cloud models plan well naturally, and the prompt would just burn their tokens. For thinking-capable models the reasoning naturally lands inside `<think>` tags via the streaming tag parser; non-thinking models put it in visible text as a short audit trail.

**Self-correction on tool failure (`src/lib/ai/tool-feedback.ts`):**

When a tool call errors or the user denies permission, `buildToolResultContent` wraps the raw error with a ReAct-aligned directive ("reason about why this failed; do not retry the same call with the same arguments") before it's fed back to the model. The underlying error stays in full so the model can use the cause (path, permission, ENOENT) to choose a different approach. A per-turn `ToolCallHistory` tracks which `(tool, args)` shapes have already failed; the second identical failure prepends a stronger anti-loop directive that offers concrete alternatives (different arguments, different tool, or respond with text). Applies to all providers — the wrap is cheap enough that consistency beats per-provider gating.

**Sliding-window context trimming (`src/lib/ai/context-trim.ts`):**

`local_bundled` chats apply `trimMessagesToBudget` before every `ai_chat_stream` send (initial + tool-loop continuation). The budget is `useLocalAIStore.contextLength × 0.75` — the 25% reserve is the model's room to actually answer. Trimming drops the oldest complete rounds (user → assistant → tool_call/tool_result chain) so the `tool_calls`/`tool_result` pairing invariant is preserved automatically. The leading system message and the final round are always kept; if even the final round exceeds the budget alone, the API rejection is more useful than silently dropping the user's most recent prompt. Token counts are estimated via `chars / 4` (OpenAI cookbook heuristic) with a flat 2000-token-per-image budget so a 2MB base64 attachment doesn't trigger gratuitous trims. Trim events log to `[perf:context]`. Cloud providers (Anthropic, OpenAI) skip trimming — their windows are large enough that runaway conversations remain a UX problem, not a hard failure.

**Provider-specific format handling:**

- **Anthropic:** Tools sent as `tools` array with `input_schema`. Tool use detected via `content_block_start` with `type: "tool_use"` in SSE stream.
- **OpenAI:** Tools wrapped in `{ type: "function", function: { ... } }`. Tool calls detected via `delta.tool_calls` in streamed chunks.
- **Ollama:** Same format as OpenAI. Requires models with function calling support (Qwen3, Llama 3.1+, Mistral).
- **Local bundled:** Same format as OpenAI via `/v1/chat/completions`. Requires `--jinja` flag on llama-server (added automatically when `supports_tool_calling` is true in model catalog). Tool calls stream incrementally in `delta.tool_calls` (requires llama.cpp b9000+ via the toolParser compatibility layer from PR #16531). The version pin is enforced by `llama_cpp_version_is_at_least_b9000`; downgrading would re-introduce the bug where tool calls error or land in the `reasoning` field instead of `tool_calls`.

**Permission model:**

- Read-only tools (`read_file`, `read_skill_content`, `list_directory`, `web_search`) are auto-allowed
- Write/execute tools (`write_file`, `execute_skill_script`) require user approval
- `ToolCallPermissionCard` with tiered approval: allow once, allow for session, allow always
- 30-second auto-deny timeout for unanswered permission requests
- Permissions stored in `permission-store` (`toolCallSession` non-persisted, `toolCallAlways` persisted)

**Settings:**

- `toolCallingEnabled` toggle in Settings > Advanced (default: enabled)
- `searchProvider` setting for web search backend (DuckDuckGo)
- Tools indicator badge in command bar showing count of available tools

**Tool call content rendering (ACP):**

ACP agents (Claude Code, Codex, Copilot, Gemini) can emit rich `ToolCallContent` in `tool_call_update` events — `Diff` blocks with old/new text for file edits, `Content` blocks with text output, and `Terminal` blocks referencing command output. The frontend normalizes these via `normalizeToolCallContent` in `acp-utils.ts` and renders them inline below the tool-call label in both the chat panel and the delegation activity panel:

- **Diff blocks** → collapsible unified diff with line-level additions/deletions (`+/-` coloring via `--color-diff-*` CSS variables), new-file and deleted-file badges, click-to-open file path header. Uses `computeUnifiedDiff` in `src/lib/ai/diff-utils.ts` for line-mode diffing (via `diff-match-patch`) with 3-line context windows, separator markers between distant hunks, and truncation at 200 lines.
- **Content/text blocks** → collapsible monospace output (same treatment as tool result segments).
- **Terminal blocks** → muted placeholder ("Terminal output (not yet supported)") — full support requires the `terminal/create` client capability, which is out of scope for this batch.

Direct API tool calling (Anthropic/OpenAI/Ollama/local) does not emit structured content — results are rendered as plain text in the `ToolResultSegment`.

**Resource link content blocks (ACP):** Agents can emit `resource_link` content blocks alongside text in `agent_message_chunk` (URI + optional `name`, `description`, `mimeType`, `size`). Notesage normalizes these in `acp-utils.ts` and appends them as markdown links to the current text segment — the existing markdown renderer handles the rendering. `file://` URIs that resolve inside a known project open as editor tabs; other URIs open via `openExternal`. `name` (or the URI basename) is used as the link text.

## Image Attachments & Vision

Chat messages can include up to 5 image attachments, enabling multimodal conversations with vision-capable models.

**Image input methods:**

- Paste from clipboard (Cmd+V in chat input)
- Drag and drop files onto the chat input area
- File picker button in the attachment strip
- Right-click "Add to chat" on images and drawings in the editor (via `SendToAI` ProseMirror plugin)
- Right-click "Add to chat" on image files in the sidebar file tree
- Drag image files from the sidebar into the chat panel

**Image compression pipeline (`src/lib/image-compress.ts`):**

- Images resized to fit within 1568px max dimension (preserving aspect ratio)
- PNG images converted to JPEG for smaller payload
- Final size capped at 5MB per image
- Compression runs client-side via Canvas API before sending to the backend

**Vision capability detection (`src/lib/ai/vision.ts`):**

- **Anthropic / OpenAI:** Always vision-capable (all current models support images)
- **Ollama:** Detected at runtime via `/api/show` — checks for `vision` in model capabilities
- **Local bundled:** Checked via `supports_vision` flag in model catalog metadata
- **ACP agents:** Checked via `promptCapabilities.images` from the ACP session
- **OpenAI-compatible:** Always reported as vision-capable (best-effort)
- Switching to a non-vision model clears any pending image attachments

**Provider-specific image serialization (Rust backend):**

- **Anthropic:** `content` array with `type: "image"` blocks using `source.type: "base64"`
- **OpenAI / OpenAI-compatible:** `content` array with `type: "image_url"` using `data:` URI
- **Ollama:** `images` array on the message object (raw base64 strings)
- **Local bundled:** Same format as OpenAI via `/v1/chat/completions`
- **ACP:** `ContentBlock::Image` with base64 data and media type

**Multimodal projector (mmproj) for local models:**

- Vision models like Gemma 4 require a separate mmproj GGUF file for image processing
- mmproj files auto-downloaded from Hugging Face when a vision model with `mmproj_file` metadata is activated
- Download progress shown as chronological status updates in the chat panel
- mmproj path passed to llama-server via `--mmproj` flag at startup

**UI components:**

- `AttachmentStrip` shows pending image thumbnails with remove buttons below the chat input
- Sent messages display image thumbnails (120px max) that are clickable for full-size preview
- Image event bus (`src/lib/ai/vision.ts`) bridges editor "Add to chat" actions to the chat panel

**Key files:**

| File | Purpose |
| --- | --- |
| `src/lib/image-compress.ts` | Client-side image compression (resize, PNG→JPEG, 5MB cap) |
| `src/lib/ai/vision.ts` | Vision detection per provider + image event bus |
| `src/components/chat/AttachmentStrip.tsx` | Thumbnail strip with remove buttons |
| `src/components/editor/extensions/send-to-ai.ts` | ProseMirror plugin for "Add to chat" context menu |

## Re-authentication

Re-auth is **in-app and identical to initial sign-in** — it reuses the same registration components, not a terminal hand-off. The key-icon button on a subscription connection card (Settings > Connections) opens a `ReauthDialog` (`src/components/settings/ReauthDialog.tsx`) that renders `ConnectAgent` (ACP agents) or `ConnectCopilotLsp` (Copilot LSP) for the existing connection:

- **Claude Code / Codex** → spawn → `acp_agent_authenticate` → the agent opens a **browser OAuth** window ("a browser window will open, finish sign-in, return here").
- **Copilot LSP** → the in-app GitHub **device-code** flow (`copilot_lsp_sign_in` / `copilot_lsp_finish_auth`, code shown + auto-copied + "Open GitHub").
- **Gemini** → the in-app **credential form** (it genuinely can't open a browser from a subprocess).

Each reused component keeps a **terminal sign-in only as its own last-resort fallback** (shown when the in-app `authenticate` errors), never the primary path. On success no new connection is created — the OAuth token was refreshed on disk (or fresh env vars were entered), so the existing connection is marked `connected` and any new env vars persist through the keychain via `updateConnection`.

**Auth-method preference:** an ACP agent can advertise both an interactive `agent` (OAuth) method and an `env_var` (API key) method — Codex offers ChatGPT login *and* `OPENAI_API_KEY`. `ConnectAgent` prefers the OAuth method (passing its method id explicitly to `acp_agent_authenticate`, since with no id the backend picks whichever is listed first) and only shows the API-key form when `env_var` is the **sole** method (Gemini).

**The key icon reflects real need:** it is shown only when the connection's status is `expired` or `error`, and hidden when `connected` — so a healthy provider carries no permanent "needs attention" badge. A chat send that hits an auth failure (`401`, `Unauthorized`, `Authentication required`, `Invalid authentication`, `Invalid api key`) flips the connection to `expired` (the only reliable needs-reauth signal — neither heartbeat nor session-create validates the OAuth token) and fires a sonner toast with a "Re-authenticate" action, deduped per connection id. A successful reauth or heartbeat flips the status back to `connected`. (The chat-error toast's action still uses the terminal `reauthenticateAgent` fallback — a separate, rarer surface than the settings card.)

**Why this exists:** ACP agents read OAuth tokens from the OS keychain at spawn time. Tokens can go stale asynchronously while other Claude/Copilot processes on the host refresh them, leaving Notesage's spawned agent with a cached-but-rejected token until respawn. The re-auth path handles both the stale-token and the truly-expired-token cases.

## Web Search

Web search is implemented as a client-side tool (`web_search`) available to all providers when tool calling is enabled. The backend `web_search` Tauri command queries DuckDuckGo's HTML endpoint — no API key needed. Results are returned to the model as tool call results with title, URL, and snippet for each hit.

For providers that also support server-side web search (Anthropic `web_search_20250305`, OpenAI `web_search_preview`), the client-side tool provides a unified cross-provider experience. Citations extracted from responses are displayed as numbered "Sources" section.

## Key Files

| File | Purpose |
| --- | --- |
| `src-tauri/src/commands/ai.rs` | AI provider commands (direct API) |
| `src-tauri/src/commands/credentials.rs` | OS keychain credential storage (store, get, delete, migrate) |
| `src-tauri/src/commands/acp.rs` | ACP agent management; MCP pass-through (`build_acp_mcp_servers`), `acp_agent_smoke_test` |
| `src-tauri/src/commands/local_agent.rs` | Local Agent preset: `local_agent_write_config` (Goose env against the live llama-server — provider + host + model + isolated XDG tree; no config file) |
| `src-tauri/src/commands/network_proxy.rs` | HTTP proxy for agent network sandboxing |
| `src-tauri/src/commands/sandbox_monitor.rs` | Seatbelt violation monitoring (macOS log stream) |
| `src-tauri/src/commands/sandbox.rs` | Seatbelt profile generation (kernel network deny + $HOME read allow-list) |
| `src-tauri/src/commands/copilot_lsp.rs` | Copilot Language Server (auth, completions, message logging) |
| `src-tauri/src/commands/dialog.rs` | Native dialogs + `run_in_terminal` for agent auth |
| `src-tauri/src/commands/local_inference.rs` | Bundled llama-server lifecycle |
| `src-tauri/src/commands/model_metadata.rs` | Model metadata merge + HF API fetcher |
| `src-tauri/src/commands/gguf_parser.rs` | GGUF binary header parser |
| `src-tauri/model-catalog.json` | Curated LLM model catalog |
| `src/lib/ai/` | Provider abstraction (types, connections, providers) |
| `src/hooks/useAIOperations.ts` | AI generation, chat, and ACP routing (the selected provider is used as-is — no Local Agent fallback) |
| `src/hooks/useLocalAgentSetup.ts` | Local Agent staged setup orchestrator (detect → download → configure → smoke-test); rolls back the connection on failure |
| `src/lib/ai/local-agent-setup.ts` | Pure staged setup driver (`runLocalAgentSetup`) with the rollback-on-failure gate |
| `src/lib/ai/local-agent-model.ts` | Tool-calling model recommendation (RAM-fit) |
| `src/lib/ai/acp-mcp.ts` | `buildAcpMcpServerInputs` — capability-gated, scope-matched MCP servers for a session |
| `src/components/settings/LocalAgentSetupDialog.tsx` | Staged setup dialog (model picker, progress, retry) |
| `src/hooks/useCopilotCompletion.ts` | Copilot LSP lifecycle (inline completions) |
| `src/hooks/useCopilotChat.ts` | Copilot LSP chat via conversation/* JSON-RPC |
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
| `src/hooks/useDirectApiChat.ts` | Direct API chat with tool execution loop (scope-gated FS tools via #8) |
| `src/lib/tool-executor.ts` | Tool call routing + scope gate (`ToolCallScope`, `FILESYSTEM_TOOLS`) |
| `src/stores/skill-store.ts` | Skills registry, agents, skill tool definitions, `getToolDefinitions()`. Per-project registry (`byProject`) merged with `global` on demand |
| `src/components/settings/ReauthDialog.tsx` | In-app re-auth dialog — reuses `ConnectAgent` / `ConnectCopilotLsp` for an existing connection (key icon entry point) |
| `src/lib/ai/reauth.ts` | `canReauthenticate`, `isAuthError`, + `reauthenticateAgent` (terminal fallback, used by the chat-error toast) |
| `src/lib/ai/uri-scope.ts` | `isUriInScope(uri, scope)` — used by Copilot LSP doc sync, inline completion gate, active-tab auto-attach |
| `src/lib/ai/project-lock.ts` | `ProjectLockViolation` error + `getProjectLock` / `findLockConflict` utilities |
| `src/lib/ai/acp-utils.ts` | `getChatSandboxScope`, `buildAttachmentActivities`, `formatToolLabel`, `normalizeToolCallContent` |
| `src/lib/ai/structured.ts` | `generateStructured()` + `buildJsonSchemaResponseFormat()` for schema-constrained generation |
| `src/lib/ai/react-prompt.ts` | `REACT_GUIDANCE` + `buildReActAddendum()` — tool-use protocol appended to `localSystemMessage` |
| `src/lib/ai/tool-feedback.ts` | `ToolCallHistory` + `buildToolResultContent()` — wraps tool errors with reasoning guidance, escalates on repeated identical failures |
| `src/lib/ai/context-trim.ts` | `trimMessagesToBudget()` + `localBundledTrimBudget()` — sliding-window trim for local_bundled, preserves tool_call/tool_result pairing |

## Future Enhancements

- ~~Agent binary auto-install wizard~~ — Complete (Phase 10): managed install to `~/.notesage/agents/bin/` with PATH fallback
- ~~ACP agent binary bundling as Tauri sidecar~~ — Superseded by managed install system; explicitly a non-goal in the install wizard PRD to avoid app bundle bloat
- Multi-line panel completions (`copilotPanelCompletion`)
- Inline edits / next edit suggestions (`copilotInlineEdit`)
- Partial acceptance (accept word-by-word)
- Embeddings and semantic search
- Windows/Linux llama-server bundling
