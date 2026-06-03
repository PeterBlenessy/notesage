# PRD: MCP Server Registration UX Overhaul

|  |  |
| --- | --- |
| **Date** | 2026-06-03 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Make adding an MCP server feel like Claude Desktop's connector flow — add a remote server by URL with OAuth, pick from a curated catalog with one click, keep secrets out of plaintext, and never commit a broken server to config |
| **Tasks** | — (not yet planned) |
| **Phase** | Skills & Agents Platform — MCP v2 |

## Problem

MCP client integration shipped in v1 (`docs/prds/2026-03-07-mcp-client-integration.md`) and works, but adding a server is the *pre-2025* experience that Anthropic itself replaced because it wasn't user-friendly:

- **Stdio only.** `src-tauri/src/commands/mcp.rs` spawns a child process with piped stdio. There is no HTTP/SSE transport, so the entire category of **hosted/remote MCP servers** (GitHub, Linear, Notion, Sentry, and any vendor "connector") cannot be added at all. This is explicitly a v1 non-goal and is the single biggest capability gap versus Claude Desktop, Cursor, and VS Code.
- **You must already know the magic command.** The add form (`src/components/settings/McpServersSettings.tsx`) asks for a raw `command`, space-separated `args`, and `env` pairs. There is no discovery — the user has to know `npx -y @modelcontextprotocol/server-filesystem` by heart. No "browse and click."
- **Secrets in plaintext.** `env` values (API keys, tokens) are written into `~/.notesage/mcp.json` in cleartext. Notesage already has an OS-keychain layer (`src-tauri/src/commands/credentials.rs`, used for AI provider keys) — MCP bypasses it entirely. This is both a security gap and inconsistent with the rest of the app.
- **No validation on add.** The dialog writes config blindly and triggers a rescan. The user discovers a bad command, missing binary, or wrong env only later, as a red status dot — with no actionable error.

The v1 PRD deferred remote transport, marketplace/discovery, and install UX. This PRD picks them up, plus the keychain and validation fixes, to close the friction that makes the current flow "not user friendly."

## Goals

1. **Add a remote MCP server by URL** — Streamable HTTP (and SSE fallback) transport, with browser-based OAuth 2.1 authorization for servers that require it. No local binary, no PATH, no JSON.
2. **One-click add from a curated catalog** — an in-app, searchable list of popular MCP servers (both remote and local) that pre-fills everything the user shouldn't have to type, plus support for `notesage://mcp/install?...` deeplinks so docs and websites can offer an "Add to Notesage" button.
3. **Secrets in the OS keychain** — MCP `env` secrets and OAuth tokens are stored via the existing `credentials.rs` keyring, keyed by server id; `mcp.json` holds only non-sensitive metadata and references.
4. **Validate-on-add** — the add/edit dialog test-connects before committing, and shows either the discovered tool list (success) or a precise, actionable error (failure). A server is only written to config once it has been proven to start.
5. **No regression** — existing stdio servers, the Claude Desktop / Cursor / VS Code import path, project/global scoping, and the active-tools merge into the agent tool registry all keep working unchanged.

## Non-Goals

- **MCP Resources, Prompts, and Sampling** — still tools-only, consistent with v1. (The Quartr-style "load this resource first" instruction pattern is out of scope here.)
- **Building or hosting MCP servers** — Notesage remains a client.
- **A full marketplace with ratings/installs/telemetry** — the catalog is a curated static manifest (same idea as `model-catalog.json`), not a backend service.
- **Auto-installing local binaries** — for local (stdio) catalog entries we still rely on `npx`/`uvx`/`node`; we detect and guide, but do not bundle or install package managers. (Detection guidance is in scope; silent install is not.)
- **Per-tool granular permission UI** — MCP tools continue to use the existing permission system.
- **Windows/Linux deeplink registration polish** — deeplink protocol handler targets macOS first (matching the app's primary platform); other platforms best-effort.

## User Stories

1. **As a user**, I want to paste a hosted MCP server URL and click "Connect," authenticate in my browser, and have the tools appear — without installing anything — so I can use vendor connectors the way I do in Claude Desktop.
2. **As a user**, I want to browse a list of popular MCP servers and click "Add" so I don't have to memorize `npx`/`uvx` commands or hunt through READMEs.
3. **As a user**, I want a website or doc to offer an "Add to Notesage" button that opens the app pre-filled with a server, so setup is one click.
4. **As a security-conscious user**, I want my MCP API keys stored in the OS keychain like my other credentials, not in a plaintext JSON file.
5. **As a user**, I want the app to test the server when I add it and tell me exactly what's wrong if it fails, so I'm not left with a silently broken server.
6. **As an existing user**, I want my current stdio servers and imported configs to keep working with no changes.

## Technical Approach

Follows the established three-layer pattern (frontend store + Tauri IPC + Rust backend) already used by MCP v1, the Copilot LSP, and ACP.

### 1. Remote transport (Rust)

Today `mcp.rs` has a single `spawn_mcp_transport(stdin, stdout, …)` path built on the shared `JsonRpcTransport` (`json_rpc.rs`). Introduce a transport abstraction so the rest of the server lifecycle (`mcp_initialize`, `tools/list`, `tools/call`, status, cleanup) is transport-agnostic:

- **`transport: McpTransport`** discriminated field on the config (`stdio | http`). Default `stdio` for back-compat (serde `#[serde(default)]`).
- **Stdio** — unchanged (child process, piped stdio).
- **HTTP** — new client built on `reqwest` (already a dependency) speaking **Streamable HTTP** per the MCP spec: POST JSON-RPC to the endpoint, read the SSE/`text/event-stream` response, persist the `Mcp-Session-Id` header across requests, and open the optional GET stream for server→client messages. Fall back to the legacy HTTP+SSE two-endpoint transport when the server advertises it.
- **No child PID** for HTTP servers — `McpServerInfo`/health-check (`check_processes`) must treat HTTP servers as "managed by liveness ping" (a lightweight `tools/list` or `ping`) rather than process status.

### 2. OAuth 2.1 (Rust + frontend)

Mirror the existing browser/device auth flows (Copilot LSP `copilot_lsp_finish_auth`, ACP `authenticate`):

- On `401` with a `WWW-Authenticate` challenge, perform MCP's OAuth discovery (`/.well-known/oauth-protected-resource` → authorization server metadata), dynamic client registration if supported, then the **authorization code + PKCE** flow.
- Open the system browser to the authorization URL; capture the redirect on a transient `http://127.0.0.1:<port>/callback` loopback listener (same idea as other desktop OAuth tools). Exchange the code for tokens.
- **Tokens stored in keychain** (see §3), auto-refreshed on expiry. A re-authenticate affordance on the server card mirrors the connection-card key-icon pattern in Settings > Connections.

### 3. Keychain for secrets (Rust + frontend)

Reuse `credentials.rs` (`store_credential` / `get_credential` / `delete_credential`) with a namespaced service id, e.g. `notesage:mcp:<serverId>:<KEY>` for env secrets and `notesage:mcp:<serverId>:oauth` for token bundles.

- The settings UI marks env values as **secret** (default for anything that looks like a key/token, user-overridable). Secret values go to the keychain; `mcp.json` stores `"env": { "API_KEY": { "secret": true } }` (reference, no value) alongside plain non-secret values.
- At spawn time, `mcp_start_server` resolves secret env from the keychain and injects it into the child's environment / HTTP auth header — secrets never transit the frontend or appear in `mcp.json`, matching the AI-key model.
- **Migration:** on first load after upgrade, plaintext `env` values already in `mcp.json` are moved to the keychain and rewritten as references, with a one-time toast (same pattern as the credentials migration and the scoped-approvals migration).

### 4. Validate-on-add (frontend + Rust)

New `mcp_validate_server(config)` command: performs a full **start → initialize → tools/list → stop** dry run against a candidate config (stdio or http, including OAuth if needed) and returns either `{ ok: true, tools: McpToolInfo[], serverInfo }` or `{ ok: false, error, stderrTail? }`. The dialog calls it on "Test" / before "Add"; config is written only on success. Stderr tail and a mapped, human-readable cause (binary not found, auth required, bad URL, timeout) surface in the dialog.

### 5. Catalog + deeplinks (frontend + Rust)

- **Catalog manifest** — a static JSON (bundled like `model-catalog.json`, optionally refreshed from a known URL behind the existing `http:default` capability allowlist) describing curated servers: name, description, category, transport, `url` or `command`/`args` template, required env (with labels + "where to get it" links), and homepage. Rendered as a browseable, searchable card grid in the MCP settings panel (shadcn `command`/`dialog` + cards).
- **Deeplinks** — register the `notesage://` URL scheme (Tauri `deep-link` plugin). `notesage://mcp/install?name=…&url=…` (remote) or `…&command=…&args=…` (local) opens the app and pre-fills the add dialog **in validate-first mode** — the user reviews and confirms; nothing is written or executed silently. Untrusted deeplink/catalog input is treated as external data: the confirmation step is mandatory and clearly shows command/URL/env before anything runs.

### Affected files

| Layer | File | Change |
| --- | --- | --- |
| Backend | `src-tauri/src/commands/mcp.rs` | Transport abstraction, HTTP/SSE client, `mcp_validate_server`, keychain resolution at spawn, HTTP liveness in `check_processes` |
| Backend | `src-tauri/src/commands/mcp_oauth.rs` *(new)* | OAuth 2.1 discovery + PKCE + loopback callback + token refresh |
| Backend | `src-tauri/src/commands/credentials.rs` | Reused as-is (namespaced service ids) |
| Backend | `src-tauri/src/lib.rs`, `capabilities/default.json` | Register deep-link plugin + `notesage://` scheme; any new HTTP scope |
| Frontend | `src/stores/mcp-store.ts` | `transport`, secret-ref env shape, catalog/validation state |
| Frontend | `src/components/settings/McpServersSettings.tsx` | Local/Remote toggle, catalog browser, validate-on-add, secret fields, re-auth |
| Frontend | `src/components/settings/McpCatalog.tsx` *(new)* | Catalog card grid + search |
| Frontend | `src/lib/mcp/` *(new)* | Deeplink parse/confirm, catalog manifest types, validation helpers |
| Frontend | `src/hooks/useMcpDiscovery.ts` | Resolve secret refs; keychain-aware start |
| Assets | `src-tauri/mcp-catalog.json` *(new)* | Curated catalog manifest |

## UI/UX

Per `docs/design-system.md` — strictly neutral palette, shadcn/ui first, every `<Tooltip>` inside a `<TooltipProvider>`, polished states.

**MCP Servers settings panel** gains a primary action split:

- **`+ Add` → menu:** "Browse catalog" · "Add remote (URL)" · "Add local (command)" · "Import from Claude Desktop / Cursor / VS Code" (existing).

**Add Remote dialog**
- Single **Server URL** input + optional name. **Test connection** button.
- States: *idle* → *connecting* (shadcn `progress`/spinner) → if auth needed, an **"Authorize in browser"** card (opens system browser, waits for callback) → *success* shows server info + a discovered-tools list → **Add** enabled. *Error* shows mapped cause + raw detail in a collapsible.

**Browse Catalog dialog**
- shadcn `command` search over cards (icon, name, description, Remote/Local badge, category). Selecting a card opens the appropriate Add dialog pre-filled; required env render as labeled inputs with "Get your key →" links. Same validate-first gate before Add.

**Add Local dialog** — existing command/args/env form, plus: env rows get a **secret toggle** (lock icon; secret values are masked and stored in keychain), and the same **Test → tools preview** gate before Add. Footer keeps "Saved to ~/.notesage/mcp.json (global)" / project hint.

**Server card** — adds a transport badge (Local / Remote), an OAuth status + **re-authenticate** key-icon for remote servers (mirrors Connections cards), and on validation failure an inline actionable error rather than a bare red dot.

**Deeplink confirm** — `notesage://mcp/install?…` opens a confirmation sheet showing exactly what will be added (URL/command/args/env names), an explicit warning for local-command entries, and a Cancel/Review/Add choice. Nothing runs until the user confirms.

Empty state: a friendly "No MCP servers yet — Browse the catalog or add one by URL." Loading and error states for catalog fetch and validation are all explicit.

## Data Model

```typescript
// mcp-store.ts
type McpTransport = "stdio" | "http";

interface McpEnvValue {
  // non-secret values store `value`; secrets store only a keychain reference flag
  value?: string;
  secret?: boolean; // true → resolved from keychain at spawn, never persisted in mcp.json
}

interface McpServerEntry {
  id: string;
  name: string;
  transport: McpTransport;        // NEW (default "stdio")
  // stdio:
  command?: string;
  args?: string[];
  // http:
  url?: string;                   // NEW
  oauth?: { authorized: boolean; expiresAt?: number }; // NEW (tokens live in keychain)
  env: Record<string, McpEnvValue>; // shape change: value | secret-ref
  source: McpConfigSource;
  enabled: boolean;
  status: McpServerStatus;
  error?: string;
  tools: McpToolInfo[];
  projectRoot?: string | null;
  catalogId?: string;             // NEW (provenance when added from catalog)
}

interface McpCatalogItem {
  id: string; name: string; description: string; category: string;
  homepage?: string;
  transport: McpTransport;
  url?: string;                   // remote template
  command?: string; args?: string[]; // local template
  requiredEnv?: { key: string; label: string; secret: boolean; helpUrl?: string }[];
}
```

```rust
// mcp.rs
#[serde(rename_all = "snake_case")]
pub enum McpTransport { Stdio, Http }

pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default)] pub transport: McpTransport, // default Stdio
    #[serde(default)] pub command: String,
    #[serde(default)] pub args: Vec<String>,
    #[serde(default)] pub url: Option<String>,
    #[serde(default)] pub env: HashMap<String, String>, // resolved (post-keychain) at spawn
    pub source: McpConfigSource,
    #[serde(default = "default_true")] pub enabled: bool,
}

pub struct McpValidationResult {
    pub ok: bool,
    pub tools: Vec<McpToolInfo>,
    pub server_info: Option<Value>,
    pub error: Option<String>,
    pub auth_required: bool,
}
```

**New / changed Tauri commands**

```rust
#[tauri::command] async fn mcp_validate_server(config: McpServerConfig) -> Result<McpValidationResult, String>;
#[tauri::command] async fn mcp_oauth_begin(server_id: String, url: String) -> Result<OAuthChallenge, String>; // opens browser, returns pending handle
#[tauri::command] async fn mcp_oauth_status(server_id: String) -> Result<OAuthState, String>;
#[tauri::command] async fn mcp_catalog_list() -> Result<Vec<McpCatalogItem>, String>;
// mcp_start_server / mcp_save_config extended for transport + keychain-backed env
```

## Dependencies

- **`reqwest`** — already a dependency; reuse for Streamable HTTP/SSE. May add `eventsource`-style SSE parsing (or hand-roll, as `copilot_protocol.rs` already frames streams).
- **`tauri-plugin-deep-link`** — new, for the `notesage://` scheme.
- **`keyring`** via existing `credentials.rs` — no new crate.
- **`oauth2`/PKCE** — small crate or hand-rolled (the flow is simple; ACP/Copilot already do browser auth without a heavy dependency). Decide during planning.
- Catalog manifest authoring (curated list of ~15–25 popular servers).
- Capability surface: confirm `capabilities/default.json` / `tauri.conf.json` allow the deep-link scheme and any catalog-refresh HTTP endpoint without widening `fs:` permissions (per the 2026-04-19 hardening).

## Quality Gates

**Functional**
- [ ] A remote server can be added by URL; tools appear and are callable by agents.
- [ ] OAuth-protected remote server completes browser auth; tokens persist and auto-refresh across restarts; re-authenticate works.
- [ ] Catalog browse → one-click add works for both a remote and a local entry, with required-env prompts.
- [ ] `notesage://mcp/install?…` opens the app, shows the confirm sheet, and only adds after explicit confirmation.
- [ ] Secret env + OAuth tokens are stored in the OS keychain; `mcp.json` contains no plaintext secrets; existing plaintext env migrates on first launch.
- [ ] Validate-on-add blocks writing a server that fails to start and shows a mapped, actionable error (binary-not-found, auth-required, bad-URL, timeout).
- [ ] Existing stdio servers, Claude Desktop / Cursor / VS Code import, project/global scoping, and the agent tool-registry merge all still work (regression).
- [ ] HTTP servers shut down / are de-registered cleanly on app exit; no orphaned listeners; health check reflects liveness.

**Testing**
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm test:e2e` pass.
- [ ] `cargo test` in `src-tauri` passes, incl. unit tests for the HTTP transport framing, OAuth PKCE/discovery parsing, env keychain-reference (de)serialization, and deeplink URL parsing.
- [ ] Regression-lock test asserting `mcp.json` is never written with a plaintext secret value.
- [ ] No coverage regressions in changed files (`pnpm coverage:check`).

**Design**
- [ ] All new UI uses shadcn/ui, neutral palette, light + dark + soft contrast verified; every Tooltip wrapped in a provider.
- [ ] Loading / empty / error / auth-pending states are all explicit and polished.
- [ ] Would not look out of place next to Linear/Craft.

## Out of Scope

- MCP Resources, Prompts, Sampling.
- A hosted marketplace/backend, ratings, install analytics.
- Auto-installing local binaries / bundling `node`/`npx`/`uvx`.
- Per-tool granular permission UI beyond the existing system.
- Full deeplink-handler polish on Windows/Linux (macOS first).
- `.mcpb`/`.dxt` packaged-bundle import (candidate for a follow-up once remote + catalog land).
