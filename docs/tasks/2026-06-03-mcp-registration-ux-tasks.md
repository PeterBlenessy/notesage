# MCP Server Registration UX Overhaul — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-06-03 |
| **Status** | Not started |
| **PRD** | [mcp-registration-ux](../prds/2026-06-03-mcp-registration-ux.md) |
| **Total** | 22 tasks: 5S, 11M, 6L |
| **Suggested order** | Foundation (#1–#4) → Keychain (#5–#7) → HTTP transport (#8–#11) → OAuth (#12–#14) → Validate-on-add (#15–#16) → Catalog & deeplinks (#17–#20) → Docs & regression (#21–#22) |

## Risks & open questions

- **OAuth crate vs hand-roll** (#12): the `oauth2` crate pulls a dependency tree; ACP/Copilot hand-roll browser auth today. Decision needed before #12 — leaning hand-rolled PKCE to stay consistent and dependency-light.
- **Streamable HTTP vs legacy HTTP+SSE** (#8): the MCP spec has two HTTP transports. Implement Streamable HTTP first, detect-and-fallback to legacy two-endpoint SSE only if a target server needs it. Defer legacy if time-boxed.
- **Loopback callback port** (#13): transient `127.0.0.1:<port>` listener must not collide with the network-sandbox proxy or llama-server ports; pick from an ephemeral range and pass `redirect_uri` accordingly.
- **Capability surface** (#19, #21): `notesage://` deep-link registration and any catalog-refresh HTTP endpoint must NOT widen `fs:` permissions — the 2026-04-19 hardening + `tauri-capability-surface.test.ts` regression lock apply. Catalog ships bundled (offline) first; remote refresh is optional.
- **High blast radius**: #1 (config struct), #5 (keychain env shape + migration), and #8 (transport abstraction) all touch the shared MCP lifecycle. Land them behind back-compat defaults (`transport` defaults to `stdio`, plaintext env still readable) and keep the v1 stdio + import paths green at every step.
- PRD references a `useMcpDiscovery.ts` hook; the actual hook is `src/hooks/useMcpOperations.ts` — tasks below use the correct name.

---

## Foundation — transport-agnostic config & lifecycle

### 1. Add `transport` discriminant to MCP config types (Rust)
- **Description:** Add `pub enum McpTransport { Stdio, Http }` (`#[serde(rename_all = "snake_case")]`) and extend `McpServerConfig` / `McpServerInfo` with `#[serde(default)] transport: McpTransport` (defaulting to `Stdio`) and `#[serde(default)] url: Option<String>`. Add a `Default` impl returning `Stdio`. Acceptance: existing `mcp.json` (no `transport`) deserializes unchanged; round-trip test passes; `cargo test` green.
- **Complexity:** S · **Category:** backend · **Depends on:** —
- **Files:** `src-tauri/src/commands/mcp.rs`

### 2. Mirror `transport`/`url` in the frontend store types (TS)
- **Description:** Add `McpTransport` union and `transport`/`url`/`oauth`/`catalogId` fields to `McpServerEntry` per the PRD data model. Default `transport: "stdio"` in `setServers`/`addServer` normalization so older persisted entries are safe. Acceptance: `pnpm typecheck` passes; existing store tests pass.
- **Complexity:** S · **Category:** frontend · **Depends on:** —
- **Files:** `src/stores/mcp-store.ts`

### 3. Extract a transport abstraction in the server lifecycle (Rust)
- **Description:** Introduce an internal `enum McpConn { Stdio(JsonRpcTransport, Child), Http(HttpMcpClient) }` (or trait) so `mcp_initialize`, `mcp_list_tools_from_server`, `mcp_call_tool_on_server`, and stop/cleanup are transport-agnostic. Stdio path unchanged. Acceptance: stdio servers start/list/call/stop exactly as before; unit + manual smoke pass. No behavior change yet — pure refactor.
- **Complexity:** L · **Category:** backend · **Depends on:** #1
- **Files:** `src-tauri/src/commands/mcp.rs`

### 4. Liveness for non-process (HTTP) servers in health check (Rust)
- **Description:** `McpState::check_processes` assumes a child PID. Make it report HTTP servers via a lightweight liveness ping (`ping` or cached `tools/list` success) instead of process status, and ensure `mcp_get_server_status` / `health.rs` consumers tolerate `pid: null`. Acceptance: an HTTP server (stub) shows `alive` without a PID; stdio unchanged.
- **Complexity:** M · **Category:** backend · **Depends on:** #3
- **Files:** `src-tauri/src/commands/mcp.rs`, `src-tauri/src/commands/health.rs`

---

## Keychain-backed secrets

### 5. Keychain-reference env shape + serialization (Rust)
- **Description:** Define the on-disk env model where a value is either a plain string or a secret reference (`{ "secret": true }`). Add (de)serialization that accepts both legacy plain `HashMap<String,String>` and the new tagged shape in `McpConfigEntry`/`mcp.json`. At spawn, resolve `secret: true` keys from keychain via `get_credential_internal` under service id `notesage:mcp:<serverId>:<KEY>`. Acceptance: unit tests for both shapes; secret values never present in serialized output.
- **Complexity:** L · **Category:** backend · **Depends on:** #1
- **Files:** `src-tauri/src/commands/mcp.rs`, `src-tauri/src/commands/credentials.rs` (reuse)

### 6. Store/delete MCP secrets on add/remove (Rust + TS)
- **Description:** When a server with secret env is added/edited, write secrets to keychain (`store_credential`) and persist only references in `mcp.json`; on `removeServer`, delete the keychain entries. Wire through `mcp_save_config` and the store's add/remove/update actions + `useMcpOperations`. Acceptance: adding a server with a secret writes keychain + reference; removing cleans up; no plaintext in `mcp.json`.
- **Complexity:** M · **Category:** both · **Depends on:** #5, #2
- **Files:** `src-tauri/src/commands/mcp.rs`, `src/hooks/useMcpOperations.ts`, `src/stores/mcp-store.ts`

### 7. One-time plaintext-env migration to keychain (Rust + TS)
- **Description:** On first load after upgrade, detect plaintext secret-looking env in `mcp.json`, move to keychain, rewrite as references, show a one-time toast (follow `migrate_credentials` + scoped-approvals migration patterns). Heuristic for "secret" (key matches `*KEY*|*TOKEN*|*SECRET*|*PASSWORD*`) with safe default. Acceptance: a fixture `mcp.json` with a plaintext key migrates idempotently; re-run is a no-op.
- **Complexity:** M · **Category:** both · **Depends on:** #6
- **Files:** `src-tauri/src/commands/mcp.rs`, `src/hooks/useMcpOperations.ts`

---

## HTTP / SSE transport

### 8. Streamable HTTP MCP client (Rust)
- **Description:** Implement `HttpMcpClient` on `reqwest`: POST JSON-RPC to the endpoint, parse `application/json` and `text/event-stream` responses, persist `Mcp-Session-Id` across requests, send `initialized`, support `tools/list` + `tools/call`. Frame SSE reuse-or-mirror `copilot_protocol.rs`. Acceptance: unit tests for request framing + session-id persistence + SSE chunk parsing against captured fixtures.
- **Complexity:** L · **Category:** backend · **Depends on:** #3
- **Files:** `src-tauri/src/commands/mcp.rs` (or new `mcp_http.rs`)

### 9. Optional server→client GET stream + legacy HTTP+SSE fallback (Rust)
- **Description:** Open the optional long-lived GET `text/event-stream` for server-initiated messages; detect legacy two-endpoint HTTP+SSE servers and fall back. Time-box: ship Streamable HTTP solidly; fallback is best-effort. Acceptance: a Streamable-HTTP stub works end to end; fallback path has at least a parse-level test.
- **Complexity:** L · **Category:** backend · **Depends on:** #8
- **Files:** `src-tauri/src/commands/mcp.rs` / `mcp_http.rs`

### 10. Route `mcp_start_server` by transport + clean teardown (Rust)
- **Description:** Branch `mcp_start_server` on `transport`: stdio (existing) vs http (`HttpMcpClient`, no child). Ensure `mcp_stop_server` / `RunEvent::Exit` cleanup closes HTTP sessions/streams (no orphaned tasks). Acceptance: starting/stopping an HTTP server registers/de-registers cleanly; no leaked tasks (audit-async sanity).
- **Complexity:** M · **Category:** backend · **Depends on:** #8, #4
- **Files:** `src-tauri/src/commands/mcp.rs`, `src-tauri/src/lib.rs`

### 11. tauri.ts wrappers + store support for remote servers (TS)
- **Description:** Add typed wrappers for any new/changed commands and ensure `useMcpOperations` start/stop/list handles `transport: "http"` + `url`. Acceptance: a remote server can be started/stopped/listed from the store; `pnpm typecheck` passes.
- **Complexity:** M · **Category:** frontend · **Depends on:** #2, #10
- **Files:** `src/lib/tauri.ts`, `src/hooks/useMcpOperations.ts`

---

## OAuth 2.1

### 12. OAuth discovery + PKCE token exchange (Rust)
- **Description:** New `mcp_oauth.rs`: on `401` + `WWW-Authenticate`, fetch `/.well-known/oauth-protected-resource` → AS metadata, do dynamic client registration if supported, build authorization-code + PKCE request. Implement token exchange + refresh. (Decision: hand-roll PKCE unless planning chooses `oauth2`.) Acceptance: unit tests for discovery parsing, PKCE challenge/verifier, and token-response parsing.
- **Complexity:** L · **Category:** backend · **Depends on:** #8
- **Files:** `src-tauri/src/commands/mcp_oauth.rs` (new), `src-tauri/src/lib.rs`

### 13. Browser auth + loopback callback + commands (Rust)
- **Description:** `mcp_oauth_begin(server_id, url)` opens the system browser to the auth URL and starts a transient `127.0.0.1:<ephemeral>/callback` listener to capture the code; exchange → store tokens in keychain (`notesage:mcp:<id>:oauth`). Add `mcp_oauth_status`. Auto-refresh on expiry at request time. Acceptance: emits a pending/result event; tokens persist across restart (manual against a real OAuth MCP server).
- **Complexity:** M · **Category:** backend · **Depends on:** #12, #5
- **Files:** `src-tauri/src/commands/mcp_oauth.rs`, `src-tauri/src/commands/mcp.rs`

### 14. OAuth status + re-authenticate UI on server card (TS)
- **Description:** Show OAuth state (authorized / expired) and a key-icon **Re-authenticate** action on remote server cards, mirroring the Settings > Connections re-auth pattern. Wire to `mcp_oauth_begin`/`mcp_oauth_status`. Acceptance: card reflects auth state; re-auth round-trips; light/dark verified; Tooltip wrapped in provider.
- **Complexity:** M · **Category:** frontend · **Depends on:** #13, #11
- **Files:** `src/components/settings/McpServersSettings.tsx`, `src/hooks/useMcpOperations.ts`

---

## Validate-on-add

### 15. `mcp_validate_server` dry-run command (Rust)
- **Description:** New command: start → initialize → `tools/list` → stop against a candidate config (stdio or http, triggering OAuth if needed), returning `McpValidationResult { ok, tools, server_info, error, auth_required }`. Map failures to causes (binary-not-found, auth-required, bad-URL, timeout) and include a stderr tail for stdio. Acceptance: success returns tools; each failure class returns the mapped cause; never registers the server in `McpState`.
- **Complexity:** M · **Category:** backend · **Depends on:** #8, #5 (and #12 for auth-required detection)
- **Files:** `src-tauri/src/commands/mcp.rs`

### 16. Validate-first add/edit dialog with tool preview (TS)
- **Description:** Refit `AddEditServerDialog` (local + remote) with a **Test** action driving `mcp_validate_server`: idle → connecting (spinner/progress) → auth card if needed → success (server info + discovered-tools list, **Add** enabled) or error (mapped cause + collapsible raw detail). Local env rows get a **secret toggle** (masked, keychain-bound). Config is written only on success. Acceptance: a bad command/URL cannot be saved; tools preview before commit; all states polished in light/dark/soft-contrast.
- **Complexity:** L · **Category:** frontend · **Depends on:** #15, #11, #6
- **Files:** `src/components/settings/McpServersSettings.tsx`, `src/lib/mcp/` (new helpers)

---

## Catalog & deeplinks

### 17. Curated catalog manifest + `mcp_catalog_list` (Rust + asset)
- **Description:** Author `src-tauri/mcp-catalog.json` (~15–25 popular servers: remote + local, with `requiredEnv` labels/help URLs), embed via `include_str!` (mirror `model-catalog.json`), expose `mcp_catalog_list() -> Vec<McpCatalogItem>`. Acceptance: command returns parsed items; a `catalog_entries_parse` test asserts every entry is well-formed (transport-appropriate fields present).
- **Complexity:** M · **Category:** backend · **Depends on:** #1
- **Files:** `src-tauri/mcp-catalog.json` (new), `src-tauri/src/commands/mcp.rs`

### 18. Catalog browser UI (TS)
- **Description:** New `McpCatalog.tsx`: shadcn `command` search over cards (icon, name, description, Remote/Local badge, category). Selecting a card opens the matching validate-first Add dialog pre-filled, with `requiredEnv` rendered as labeled inputs + "Get your key →" links. Acceptance: search filters; one-click → pre-filled add for both a remote and a local entry; empty/loading/error states present.
- **Complexity:** L · **Category:** frontend · **Depends on:** #17, #16
- **Files:** `src/components/settings/McpCatalog.tsx` (new), `src/components/settings/McpServersSettings.tsx`, `src/lib/mcp/`

### 19. Register `notesage://` deep-link scheme (Rust + config)
- **Description:** Add `tauri-plugin-deep-link`, register the `notesage://` scheme, and forward incoming URLs to the frontend via a Tauri event. Verify `capabilities/default.json` / `tauri.conf.json` changes do NOT add `fs:` permissions (keep `tauri-capability-surface.test.ts` green). Acceptance: launching `notesage://mcp/install?...` reaches a frontend listener; capability regression test passes.
- **Complexity:** M · **Category:** backend · **Depends on:** —
- **Files:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`

### 20. Deeplink parse + mandatory confirm sheet (TS)
- **Description:** Parse `notesage://mcp/install?name=&url=` (remote) or `&command=&args=` (local) into a candidate config; open a **confirmation sheet** showing exactly what will be added (URL/command/args/env names) with an explicit warning for local-command entries. Treat input as untrusted external data — nothing runs/writes until confirm, which then routes into the validate-first Add dialog. Acceptance: malformed/unknown deeplinks are rejected gracefully; confirm → validate → add; no silent execution.
- **Complexity:** M · **Category:** frontend · **Depends on:** #19, #16
- **Files:** `src/lib/mcp/deeplink.ts` (new), `src/components/settings/McpServersSettings.tsx`, `src/App.tsx` (listener mount)

---

## Docs & regression lock

### 21. Regression-lock + transport/migration tests
- **Description:** Add the no-plaintext-secret-in-`mcp.json` regression test, plus tests for env shape (de)serialization, plaintext→keychain migration idempotency, HTTP framing/session-id, OAuth PKCE/discovery parsing, and deeplink URL parsing (several may already be added inline with their tasks — consolidate and fill gaps). Acceptance: `cargo test`, `pnpm test`, `pnpm typecheck`, `pnpm test:e2e` all green; `pnpm coverage:check` shows no regression on changed files.
- **Complexity:** M · **Category:** both · **Depends on:** #6, #8, #12, #20
- **Files:** `src-tauri/src/commands/mcp.rs` (tests), `src/lib/__tests__/`, `src/lib/mcp/__tests__/`

### 22. Update docs
- **Description:** Update `docs/features/ai-workflows.md` MCP section (remote transport, OAuth, catalog, deeplinks, keychain), `docs/tauri-commands.md` (new MCP commands), `docs/architecture.md` (mcp-store fields, new files, deep-link plugin), and flip this tasks file + PRD status. Note the relationship to the v1 PRD. Acceptance: docs match shipped behavior; file paths/signatures correct (audit-documentation sanity).
- **Complexity:** S · **Category:** — · **Depends on:** #21
- **Files:** `docs/features/ai-workflows.md`, `docs/tauri-commands.md`, `docs/architecture.md`, this file, the PRD

---

### Suggested PR slicing (if shipping incrementally)

1. **Keychain + validate-on-add for existing stdio servers** (#1, #2, #5, #6, #7, #15, #16, #21-partial) — immediate security + UX win, no new transport.
2. **Remote transport** (#3, #4, #8, #9, #10, #11) — add-by-URL for non-auth servers.
3. **OAuth** (#12, #13, #14) — authenticated remote connectors.
4. **Catalog + deeplinks** (#17, #18, #19, #20) — discovery & one-click.
5. **Docs + final regression** (#22, #21-finish).
