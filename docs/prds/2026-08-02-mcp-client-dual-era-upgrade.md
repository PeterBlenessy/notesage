# PRD: MCP Client Dual-Era Upgrade (2026-07-28)

|  |  |
| --- | --- |
| **Date** | 2026-08-02 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Notesage's MCP client speaks the new stateless 2026-07-28 protocol with modern servers while every existing legacy server keeps working unchanged — era detected automatically per server, zero user action |
| **Tasks** | — (not yet planned) |

## Problem

Notesage's MCP client (`src-tauri/src/commands/mcp.rs`, `mcp_oauth.rs`) speaks only the pre-2026 sessionful protocol: `initialize`/`initialized` handshake, `Mcp-Session-Id` persistence on Streamable HTTP, and RFC 7591 Dynamic Client Registration for OAuth. The 2026-07-28 revision retires all three from the modern protocol (SEP-2575/2567; DCR deprecated in favor of CIMD) and defines the client-side consequences precisely in its compatibility matrix:

- **Legacy client × modern server → fails.** A modern-only server rejects our `initialize` (unknown method / missing required `_meta`); on HTTP our POSTs also lack the now-required `Mcp-Method`/`Mcp-Name` headers and get `400 Bad Request`. As the ecosystem migrates — Tier 1 SDKs shipped 2026-07-28 support on day one — users adding new servers will increasingly hit hard failures with no fall-forward path.
- We ignore the new cacheability contract (`ttlMs`/`cacheScope` on list results, deterministic ordering), so our cache-first `mcp_list_tools` refresh policy is guesswork.
- We miss the authorization hardening that applies to **clients**: RFC 9207 `iss` validation is a MUST when the parameter is present (SEP-2468), credentials MUST be keyed by issuer and never reused across authorization servers (SEP-2352), and DCR requests should carry `application_type` so localhost redirects stop being rejected (SEP-837).

At the same time, the legacy protocol is only *deprecated*, with a minimum twelve-month window, and most community servers will lag. **Constraint (user decision): the legacy path is not removed.** The spec's own answer is the "dual-era" client (Versioning § Backward Compatibility): modern first, spec-defined per-transport fallback to `initialize`, and both eras served indefinitely until we deliberately retire legacy in a future release.

## Goals

1. **Dual-era client per spec.** Every server registration is era-detected using the spec's transport-specific procedure; modern servers are spoken to statelessly (per-request `_meta`, required headers, `resultType`), legacy servers get the exact current code path, byte-for-byte unchanged behavior.
2. **Version negotiation done right.** `server/discover` used as the stdio probe and available up front; `UnsupportedProtocolVersionError` (`-32022`) handled by retrying with a mutually supported version, never by falling back to legacy (a modern error proves a modern server).
3. **Cache contract honored.** Tool-list caching keyed on `ttlMs`; `cacheScope` respected; deterministic ordering relied on for stable tool catalogs (stabilizes ACP prompt caches downstream).
4. **Auth hardening.** `iss` validated before code redemption; OAuth client credentials + tokens keyed by issuer identifier with forced re-registration on issuer change; `application_type: "native"` sent in DCR. DCR itself is retained (deprecated ≠ removed — same philosophy as our legacy transport path).
5. **Observable.** Settings → MCP server cards show the negotiated protocol era/version; validation dialog reports what was detected; era mis-detections are diagnosable from the stderr tail we already capture.

## Non-Goals

- **Removing or gating the legacy path.** Explicitly kept until the ecosystem has migrated; retiring it is a future PRD after the spec's removal, not before.
- **CIMD (Client ID Metadata Documents).** The DCR successor requires Notesage to host a stable HTTPS client-metadata URL — a publishing/infrastructure decision (where it lives, what redirect URIs it lists) that deserves its own slice. DCR keeps working against today's authorization servers. Tracked as a fast-follow, not v1.
- **Adopting deprecated features.** No Roots, Sampling, or new Logging adoption (all deprecated by SEP-2577). We keep *accepting* `notifications/message` from legacy servers; for modern servers we simply omit `io.modelcontextprotocol/logLevel` (debug builds may set it).
- **`subscriptions/listen`** (list-changed streams) and the **Tasks extension** — deferred; our current cache-first + manual-refresh model works without them.
- **MRTR elicitation UI.** v1 does not declare the elicitation capability, so conforming servers won't send us `input_required` elicitation requests; if one arrives anyway it fails that call with a clear error. Full MRTR support is Phase 3.
- **The Notesage MCP *server*** — separate PRD (`2026-08-02-notesage-mcp-server.md`).
- **ACP MCP pass-through changes.** `build_acp_mcp_servers` hands configs to ACP agents, which run their own MCP clients; their era support is the agent's concern. Config shape is unchanged.

## User Stories

- As a user adding a server built on the new SDKs, I want validate-on-add to succeed and the server to just work, so "modern-only server" doesn't read as "Notesage is broken."
- As a user with existing `mcp.json` servers, I want the upgrade to change nothing — same spawn, same handshake, same tools — so my setup survives without edits.
- As a user of an OAuth-protected remote server, I want the client to validate the issuer and never replay credentials against a different authorization server, so a URL/AS change can't silently leak or misuse my grant.
- As a user diagnosing a flaky server, I want the server card to tell me which protocol era was negotiated, so I can report the right thing upstream.

## Technical Approach

### 1. Era model and detection

New Rust type carried on every server handle (`McpConn` wrapper) and surfaced in `McpServerInfo`:

```rust
pub enum ProtocolEra {
    Modern { version: String },   // "2026-07-28" (list grows with future revisions)
    Legacy { version: String },   // whatever initialize negotiated, e.g. "2025-11-25"
}
```

Detection runs inside `mcp_start_server` and `mcp_validate_server` (the dry run reports the era it found), exactly as the spec's Backward Compatibility section prescribes:

- **stdio:** after spawn, send `server/discover` first. `DiscoverResult` → Modern (select the highest mutually supported version). A recognized modern error (`-32022`, `-32020`, `-32021`) → Modern (retry per its version list). Any other error, malformed response, or probe timeout (5 s) → Legacy: run the existing `mcp_initialize` handshake untouched.
- **Streamable HTTP:** POST `server/discover` as a modern request (headers + `_meta`). Success or a recognized modern JSON-RPC error body → Modern. A `4xx` without a recognized modern error body → Legacy: fall back to the existing `initialize` + `Mcp-Session-Id` flow. (We never supported the older HTTP+SSE transport; no further fallback.)

The era is cached on the in-memory handle for the server's lifetime and re-detected on every start/restart — never persisted to `mcp.json`, so a server that upgrades between app launches is picked up automatically and configs stay era-agnostic. One safeguard: if a Modern-classified server starts failing with transport-level era symptoms (e.g. `400` on every call), `mcp_restart_server` re-runs detection rather than looping errors.

### 2. Modern request path

A `ModernRequestCtx` helper builds what every modern call needs, alongside the untouched legacy helpers:

- `_meta`: `io.modelcontextprotocol/protocolVersion` (required), `io.modelcontextprotocol/clientCapabilities` (required — ours declares no elicitation, no deprecated features, empty `extensions`), `io.modelcontextprotocol/clientInfo` (`notesage` + app version).
- HTTP headers: `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` (for `tools/call`) on every POST.
- Result handling: read `resultType`; absent → treat as `"complete"` (spec MUST for legacy interop). `"input_required"` → fail the call with a descriptive error in v1 (see Non-Goals). Read `io.modelcontextprotocol/serverInfo` from result `_meta` to keep `McpServerInfo` fresh.
- Errors: map `-32020`/`-32021`/`-32022` to typed variants; accept **both** `-32602` (modern) and `-32002` (legacy) as resource-not-found, per the spec's explicit accept-old-codes guidance.

The transport-agnostic protocol helpers (`mcp_list_tools_from_server`, `mcp_call_tool_on_server`) become era-dispatching: one match at the top, two small per-era request builders below, shared response handling. The legacy branch is the current code, moved, not modified.

### 3. Cache contract

Extend the tool cache entry on the server handle with `fetched_at` + the response's `ttlMs`:

- `mcp_list_tools` cache-first read-through becomes TTL-aware for modern servers: within TTL → cached; expired → live refresh. Legacy servers keep the current non-empty-cache heuristic (no behavior change).
- `cacheScope` is recorded and respected in the trivially correct way for a desktop client: everything is a private, per-user cache already, so `"private"` costs nothing and `"public"` grants nothing extra — but we store it so any future shared-cache layer inherits the contract.
- Deterministic ordering: preserve server order verbatim (no client-side re-sorting), so downstream consumers (tools popover, ACP `session/new` payloads) see stable catalogs and upstream prompt caches stay warm.

### 4. Authorization hardening (`mcp_oauth.rs`)

- **RFC 9207 `iss` validation (MUST):** the loopback callback handler compares a present `iss` parameter against the issuer recorded at discovery time; mismatch aborts before the code is redeemed, with a toast naming both issuers.
- **Issuer-bound credentials (MUST):** the keychain records (`notesage:mcp:<server_id>:oauth` and the DCR client registration) gain an `issuer` field. On authorize/refresh, a stored credential whose issuer differs from the currently discovered one is discarded and registration re-runs. Existing records without an issuer are migrated lazily: stamped with the discovered issuer on next successful use.
- **`application_type` (SEP-837):** DCR registration metadata sends `application_type: "native"`, fixing authorization servers that reject `127.0.0.1` loopback redirects for web-typed clients.
- DCR remains the registration mechanism (deprecated upstream, functional everywhere); CIMD is the tracked fast-follow.

### 5. UI surface (small)

- Settings → MCP server cards: a muted era badge — `MCP 2026-07-28` or `Legacy (2025-11-25)` — next to the existing status dot; tooltip explains detection. Strict-neutral styling, no new components beyond a badge.
- `mcp_validate_server`'s result dialog reports the detected era alongside the tool preview, and the `error_kind` taxonomy gains `era_detection_failed` for the pathological both-probes-failed case (message includes both probe errors + stderr tail).

## Data Model

```rust
// mcp.rs additions (abridged)
pub enum ProtocolEra { Modern { version: String }, Legacy { version: String } }

pub struct McpServerInfo {
    // ...existing fields...
    pub protocol_era: Option<ProtocolEra>,   // None until first connect
}

struct ToolCache { tools: Vec<McpTool>, fetched_at: Instant, ttl_ms: Option<u64>, cache_scope: Option<CacheScope> }

// mcp_oauth.rs keychain records gain:
//   issuer: Option<String>   // RFC 8414 issuer identifier; None = pre-upgrade record, stamped lazily
```

Frontend: `McpServerInfo` TypeScript mirror in `src/lib/tauri.ts` gains `protocolEra`; `mcp-store` is unchanged (era is runtime info on server info snapshots, not persisted config). `mcp.json` schema: **unchanged** — that's the point.

## Dependencies

- None new. The modern path is built on the existing `reqwest` + `json_rpc.rs` foundations; era dispatch is internal to `mcp.rs`. (The official Rust SDK remains a candidate for the Notesage MCP *server* PRD; adopting it for the client would mean rewriting a working legacy path we've committed to keeping — not worth it.)
- Prerequisite reading: spec Versioning & Compatibility page (era terminology, detection procedure, compatibility matrix), SEP-2575/2567/2243/2549/2468/2352/837.

## Quality Gates

**Rust (`cargo test`, mock servers for both eras per transport):**

- [ ] stdio detection: modern server → Modern (discover result); modern server rejecting our version → Modern with retried version (never legacy fallback); legacy server (method-not-found on `server/discover`) → Legacy, `initialize` handshake runs; probe timeout → Legacy.
- [ ] HTTP detection: modern success → Modern; `400` with `UnsupportedProtocolVersionError` body → Modern + retry; `400` with unrecognized body → Legacy with `Mcp-Session-Id` flow.
- [ ] Modern requests carry required `_meta` fields and `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers; `tools/call` carries `Mcp-Name`; missing-`resultType` results treated as complete.
- [ ] Legacy path regression: with a legacy mock, every existing `mcp.rs` test still passes and the wire bytes of the handshake + a tool call are unchanged (snapshot).
- [ ] TTL cache: within-TTL hit, post-TTL refresh, legacy servers unaffected; tool order preserved verbatim.
- [ ] Error mapping: `-32020`/`-32021`/`-32022` typed; both `-32002` and `-32602` accepted as resource-not-found.
- [ ] OAuth: `iss` mismatch aborts redemption; issuer change discards stored credentials and re-registers; legacy keychain records migrate lazily; DCR metadata includes `application_type: "native"`.

**Frontend (`pnpm typecheck` + `pnpm test`):**

- [ ] Era badge renders both variants and the unknown (pre-connect) state; validation dialog shows detected era; `era_detection_failed` surfaces both probe errors.

**Integration (manual):**

- [ ] A current-SDK 2026-07-28 reference server (stdio + HTTP) validates, lists tools, and executes a tool call. An existing pre-upgrade server from the catalog (e.g. Filesystem reference server pinned to a legacy release) does the same with zero config changes.

## Out of Scope (deferred)

- **CIMD client registration** — fast-follow once we decide where Notesage hosts its client metadata document; DCR continues to serve until then.
- **MRTR elicitation** — declaring the elicitation capability and rendering `inputRequests` through the existing approval-card patterns, retrying with `inputResponses`. Unlocks interactive modern servers; Phase 3.
- **`subscriptions/listen`** — replacing manual refresh with opted-in `toolsListChanged`/`resourcesListChanged` streams.
- **Tasks extension (`io.modelcontextprotocol/tasks`)** as a client — polling long-running server operations.
- **OpenTelemetry `_meta` trace propagation** (`traceparent`/`tracestate`) — nice diagnostics, no current consumer.
- **Legacy path retirement** — its own PRD, only after the spec's removal window and ecosystem telemetry justify it.
