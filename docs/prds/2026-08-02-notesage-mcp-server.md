# PRD: Notesage MCP Server (Serve Notesage tools to external agents)

|  |  |
| --- | --- |
| **Date** | 2026-08-02 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Any MCP-capable agent (Claude Code, Claude Desktop, Cursor, CI pipelines) can read, search, and — with approval — write the user's Notesage workspace through vetted, scope-gated tools instead of raw file edits |
| **Tasks** | — (not yet planned) |

## Problem

Notesage is an MCP **client** today (`src-tauri/src/commands/mcp.rs` attaches external servers to our AI paths), but it offers nothing in the other direction. When a user runs Claude Code in a terminal, uses Claude Desktop, or wires up an automation pipeline, those agents have no structured way to work with the Notesage workspace. Their only option is raw filesystem access to the markdown folders, which bypasses everything Notesage adds on top of the files:

- The SQLite document index (FTS5 content search, tags, mentions, tasks, goals, research) — agents re-grep what we already indexed.
- The link graph (`links.db` backlinks/outlinks) — invisible to outside agents.
- Frontmatter conventions, sidecar comments, drawing/chart fenced-block formats — easy to corrupt from outside.
- Self-write suppression (`mark_self_write`) — external writes trigger the external-change flow in a running app, as designed, but an agent acting *on the user's behalf* generates noise the user then has to review.
- Project isolation and approval UX — none of Notesage's consent model applies to an outside agent.

The MCP **2026-07-28 specification** makes this the right moment to build the server side. The stateless protocol core removes the hardest part of embedding a server in a desktop app (no sessions, no handshake, no held-open bidirectional streams — every POST is self-contained), and the revision adds exactly the primitives a local tool server wants: a mandatory `server/discover` RPC, cacheable deterministic list results (`ttlMs`/`cacheScope`), header-based routing (`Mcp-Method`/`Mcp-Name`), Multi Round-Trip Requests for mid-call input, and a formal extensions framework (Tasks) for long-running operations. It also *deprecates* Roots, Sampling, and Logging — features we can now simply skip rather than half-implement.

References: [2026-07-28 announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [specification](https://modelcontextprotocol.io/specification/2026-07-28), changelog SEPs 2575/2567 (stateless core), 2322 (MRTR), 2243 (headers), 2549 (cacheable lists), 2663 (Tasks extension), 2468/2352/837 (auth hardening), 2577/2596 (deprecations).

## Goals

1. An MCP-capable agent can connect to a running Notesage instance over Streamable HTTP (localhost) and call read/search tools against user-selected projects — zero exposure by default, explicit per-project opt-in.
2. Write tools exist behind the same consent model as in-app AI: native Notesage approval cards with allow-once / session / always (scoped), 30-second auto-deny, and `mark_self_write` so agent writes don't masquerade as external changes.
3. The server is spec-correct for 2026-07-28: implements `server/discover`, requires and validates `Mcp-Method`/`Mcp-Name`, stamps `resultType` on every result, returns deterministic tool ordering with `ttlMs`/`cacheScope: "private"` on list results, and implements none of the deprecated features (Roots, Sampling, Logging, HTTP+SSE, DCR).
4. Index-backed tools (`search_notes`, tags, tasks, backlinks, research) answer from SQLite — an agent gets better-than-grep results without ever widening scope beyond what the user exposed.
5. The whole surface is off by default, binds to `127.0.0.1` only, and requires a Notesage-minted bearer token; a regression-lock test enforces all three.

## Non-Goals

- **Remote / network exposure.** v1 is localhost-only. No TLS termination, no OAuth 2.1 / CIMD flows, no multi-user story. (The spec's full authorization framework targets remote servers; a localhost port + bearer token is the established posture for local tool servers. If we ever ship remote access, that is its own PRD and must use CIMD — DCR is deprecated.)
- **Migrating Notesage's MCP *client* to 2026-07-28.** Our client still speaks the sessionful protocol (`initialize`, `Mcp-Session-Id` in `McpConn`). The deprecation clock (12-month window) means it needs migrating, but that's a separate effort — tracked as follow-up, not this PRD.
- **Tasks extension, MCP Apps, Skills-over-MCP prompts** — deferred (see Out of Scope).
- **Exposing explorer folders.** Mirrors the index policy: only projects and `~/Notesage` are exposable. Arbitrary system directories opened via Explorer are never served.
- **Sampling/Roots/Logging support** — deprecated in 2026-07-28; we never implement them.
- **A general-purpose file server.** Tools are note-shaped (markdown + index), not `read_file`-on-anything.

## User Stories

- As a Claude Code user, I want `claude mcp add notesage --transport http http://127.0.0.1:<port>/mcp` to give my terminal agent search and read access to my notes, so research from my knowledge base flows into coding sessions without copy-paste.
- As an automation author, I want an external pipeline to append daily entries to a journal note through `write_note`, so entries land correctly (frontmatter preserved, index updated, no external-change toast) instead of as raw file writes.
- As a privacy-conscious user, I want nothing served until I explicitly pick which projects are exposed, and I want write calls to pop the same approval card in-app AI tools get, so an outside agent can never do more than I watched it be granted.
- As an agent, I want `search_notes` / `get_backlinks` instead of grepping the folder, so I find the right note in one call using the index Notesage already maintains.

## Technical Approach

### Where the server lives

**Embedded Streamable HTTP server in the Rust backend** (`src-tauri/src/commands/mcp_server.rs` + a small module tree), running inside the Notesage process. This is the only placement that can reach what makes the server valuable: the live SQLite index (`IndexState`), the links DB, the watcher's `mark_self_write`, and the frontend approval UI via Tauri events. A standalone binary would have to re-open the databases (locking conflicts) and would have no consent surface.

The 2026-07-28 stateless core makes this cheap: each request is one HTTP POST carrying its own `_meta` (protocol version, client info, capabilities). No handshake state machine, no session registry, no SSE resumability (removed in this revision — a broken stream just means the client re-issues the request). The handler is a plain request → response function.

**Transport bridging for stdio-only clients** is Phase 2: a tiny `notesage-mcp` shim binary (installed to `~/.notesage/bin/` via the existing managed-install pattern) that proxies stdio ⇄ the localhost HTTP endpoint, reading port + token from the connection file. Claude Code and other modern clients speak Streamable HTTP directly, so Phase 1 doesn't need it.

**Implementation base:** reuse `json_rpc.rs` types where they fit, and evaluate the official Rust SDK (supports 2026-07-28 in beta) for the schema layer. Given we already hand-roll MCP client protocol helpers, hand-rolling the server handler on a minimal `hyper`/`axum` listener is acceptable if the SDK's beta surface fights us; the protocol is small now (a stateless request dispatcher + ~6 methods).

### Spec-correctness requirements (2026-07-28)

| Requirement | Implementation |
| --- | --- |
| `server/discover` (MUST) | Returns supported protocol versions (`2026-07-28`), `serverInfo` (`notesage`, app version), capabilities (`tools`, `resources`), and declared `extensions` (none in v1). |
| Per-request `_meta` | Read `io.modelcontextprotocol/protocolVersion` from each request; reply `UnsupportedProtocolVersionError` (`-32022`) on mismatch. Stamp `io.modelcontextprotocol/serverInfo` into every result's `_meta`. |
| `resultType` | Every result carries `resultType: "complete"` (or `"input_required"` when MRTR lands in Phase 3). |
| Header routing (MUST) | POSTs must carry `Mcp-Method` (and `Mcp-Name` for `tools/call`); mismatch with the JSON body → `HeaderMismatchError` (`-32020`). This also lets us reject junk before parsing bodies. |
| Cacheable lists | `tools/list`, `resources/list`, `resources/read` return `ttlMs` (tools: 3 600 000 — the catalog only changes on app update or scope change; resources: 30 000) and `cacheScope: "private"` (always — this is user data). |
| Deterministic ordering | Tools sorted by name; resources sorted by URI. Locked by a snapshot test. |
| Error codes | Use the new allocation policy: spec-reserved codes as above; implementation-defined errors (scope violation, approval denied, approval timeout) in `-32000..-32019`. Resource-not-found is `-32602` per the changelog. |
| Deprecated features | No `initialize`, no `Mcp-Session-Id`, no ping/logging/roots/sampling, no HTTP GET SSE endpoint. Per-request log level via `_meta` `io.modelcontextprotocol/logLevel` is honored (forwarded to our existing logger) — and `notifications/message` is only emitted on the response stream of requests that set it. |

### Security model

This is the mirror image of our MCP-client hardening, and it reuses the same enforcement points:

1. **Off by default; opt-in scope.** `enabled: false` until the user flips Settings → MCP → "Serve Notesage". Exposure is a per-project checklist (projects + the `~/Notesage` library root; explorer folders are not listed — same data-security rationale as the index scope). Empty scope ⇒ the server answers `server/discover` and empty lists, nothing else.
2. **Bind + token.** Listener binds `127.0.0.1` on an OS-assigned port. Every request must present `Authorization: Bearer <token>`; the token is minted on first enable, stored in the OS keychain (`credentials.rs`, service `notesage:mcp-server`), and written — together with the port — into `~/.notesage/mcp-server.json` (mode `0600`) so local clients can discover the endpoint. A "Regenerate token" button revokes all existing clients at once.
3. **DNS-rebinding defense.** Validate `Origin`/`Host` on every request (reject anything that isn't localhost) — a browser page must not be able to drive the server even with the token leaked into a URL.
4. **Path gating.** Every tool argument that names a path or note is canonicalized and prefix-checked against the exposed scopes (same approach as `isToolCallAllowed`, but Rust-side, before any I/O). Traversal (`..`), symlink escapes (canonicalize-then-check), and out-of-scope absolute paths are rejected with a scope-violation error.
5. **Write consent.** Write tools (`write_note`, `create_note`, `toggle_task`) emit an `mcp-server-approval-request` Tauri event; the frontend renders the existing tiered approval card pattern (allow once / session / always) with the calling client's `clientInfo` displayed, 30-second auto-deny. "Always" approvals persist as `ScopedApproval` triples in `permission-store` with a synthetic connection id (`mcp-server:<client-name>`), listed and revocable in Settings → Privacy → Approvals like every other approval. The HTTP response is held until resolution (bounded by the 30 s timeout) — no protocol gymnastics needed in v1.
6. **`aiLock` respected.** Projects carrying an `aiLock` are excluded from the exposable list — an external agent is by definition not the locked connection.
7. **Self-write suppression.** Approved writes call `mark_self_write` before writing and enqueue reindex, exactly like `saveFile` — the watcher stays quiet, the index stays fresh. If the written note is open and dirty in the editor, we do *not* suppress: the external-change diff-review flow is the correct surface for a conflicting write, so the write proceeds without `mark_self_write` and the user reviews it.
8. **Isolation invariant unchanged.** Serving the link graph through explicit tools does not violate the "link graph never auto-widens AI context" rule (ADR 0002/0003): the caller only ever receives edges whose *both* endpoints are inside its exposed scope; edges pointing out of scope are returned as opaque broken/`out-of-scope` markers.

### Tool surface

All tools are note-shaped and index-backed. Names, descriptions, and `inputSchema`/`outputSchema` (JSON Schema 2020-12, per SEP-2106) are defined in one Rust table so `tools/list` and dispatch can't drift.

**Phase 1 — read-only:**

| Tool | Backing | Notes |
| --- | --- | --- |
| `list_projects` | workspace scope config | Exposed projects only: name, root, note counts |
| `list_notes` | `list_directory` logic, scope-gated | Tree or flat listing of `.md` within one exposed root |
| `read_note` | `read_file` + frontmatter parse | Returns markdown body + parsed frontmatter (`type`/`title`/`description`) separately |
| `search_notes` | FTS5 (`index.db`) | Full-text with porter stemming; snippet + file + score |
| `search_tags` / `search_mentions` | index queries | Occurrences with file, line, snippet |
| `list_tasks` | index tasks table | Open/done filter, per-project |
| `get_backlinks` / `get_outlinks` | `links.db` | Scope-clamped per §Security 8 |
| `search_research` | `index_search_research` | Same shape as the in-app command |

**Phase 2 — write (approval-gated):**

| Tool | Notes |
| --- | --- |
| `create_note` | Path within an exposed root; optional frontmatter map; duplicate detection |
| `write_note` | Full-content replace with the self-write/dirty-tab rule above; returns new index state |
| `toggle_task` | Context-based matching via `index/tasks.rs` — the same primitive the Actions dashboard uses |

**Resources:** notes are additionally exposed as MCP resources (`notesage://<project-slug>/<relative-path>` URIs) with `resources/list` (paginated, deterministic) and `resources/read`. Resource templates (`notesage://{project}/{path}`) advertised via `resources/templates/list`. This gives resource-oriented clients (Claude Desktop attachment pickers) a native path while tool-oriented agents use `read_note`.

### Frontend & settings

- **Settings → MCP** gains a second section, "Serve Notesage" (the existing section becomes "Connected servers"): enable switch, exposed-projects checklist, endpoint display (`http://127.0.0.1:<port>/mcp`) with copy button, copy-paste snippets for Claude Code / Claude Desktop / generic JSON, token regenerate, and a read-only "Connected clients" list derived from recent `clientInfo` sightings (informational — the protocol is stateless, so this is a rolling window, not a session list).
- **Approval cards** reuse the `ToolCallPermissionCard` visual family, rendered through the same hoisted store pattern as `domain-request-store` so approvals work while the command bar is collapsed. Card shows: client name/version, tool, target path, diff-style preview for `write_note` (old vs new, via the existing `computeUnifiedDiff`).
- **Status surface:** the StatusTray gains a row when serving is enabled (port, scope count, calls-today counter); errors (port bind failure) surface as a toast + tray badge.
- **State:** a new `mcp-server-store` (Zustand) holds enablement, exposed scopes, and the transient connected-clients window. Persisted: `enabled`, `exposedScopes`. Not persisted: port (OS-assigned per run), client sightings.

### Tauri commands

```rust
// src-tauri/src/commands/mcp_server.rs
#[tauri::command] async fn mcp_server_start(state, config: McpServeConfig) -> Result<McpServeStatus, String>;
#[tauri::command] async fn mcp_server_stop(state) -> Result<(), String>;
#[tauri::command] async fn mcp_server_status(state) -> Result<McpServeStatus, String>;
#[tauri::command] async fn mcp_server_regenerate_token(state) -> Result<(), String>;
#[tauri::command] async fn mcp_server_resolve_approval(state, request_id: String, decision: ApprovalDecision) -> Result<(), String>;

pub struct McpServeConfig { pub exposed_scopes: Vec<String>, pub read_only: bool }
pub struct McpServeStatus { pub running: bool, pub port: Option<u16>, pub exposed_scopes: Vec<String>, pub calls_today: u64 }
```

Lifecycle: started from `useAppLifecycle` when enabled; stopped in the `RunEvent::Exit` cleanup hook alongside ACP/local-inference teardown; `~/.notesage/mcp-server.json` deleted on stop so stale endpoints can't be probed.

### Events

- `mcp-server-approval-request` `{ requestId, clientName, clientVersion, tool, args, preview? }` → frontend approval card.
- `mcp-server-client-seen` `{ clientName, clientVersion, at }` → connected-clients window.
- `mcp-server-error` `{ message }` → toast.

## Data Model

```typescript
// src/stores/mcp-server-store.ts
interface McpServerState {
  enabled: boolean;               // persisted
  exposedScopes: string[];        // persisted — project roots + optionally the notes root
  readOnly: boolean;              // persisted, default true
  status: 'stopped' | 'starting' | 'running' | 'error';
  port: number | null;            // transient
  recentClients: { name: string; version: string; lastSeen: number }[]; // transient
}
```

Approval persistence reuses `ScopedApproval` (`{ toolName, connectionId: 'mcp-server:<client>', projectRoot, grantedAt }`) — no new store, no migration.

## Dependencies

- HTTP listener: `axum` (or raw `hyper`, already in the tree via reqwest's ecosystem) — evaluate the official Rust MCP SDK (2026-07-28 support in beta) first; adopt it if its server API is stable enough, otherwise hand-roll the ~6-method dispatcher on our `json_rpc.rs` types.
- No new frontend libraries — settings UI, approval cards, and stores compose existing shadcn/ui + Zustand patterns.
- Prerequisite reading for implementers: SEP-2575/2567 (stateless), SEP-2243 (headers), SEP-2549 (caching), SEP-2322 (MRTR, Phase 3), Tasks extension SEP-2663 (Phase 3).

## Quality Gates

**Functional / spec-correctness (cargo test):**

- [ ] `server/discover` returns protocol version `2026-07-28`, serverInfo, and capabilities; every result carries `resultType` and serverInfo `_meta`.
- [ ] Missing/mismatched `Mcp-Method`/`Mcp-Name` → `-32020`; unsupported protocol version → `-32022`; missing/wrong bearer token → HTTP 401; non-localhost `Origin`/`Host` → rejected.
- [ ] `tools/list` snapshot test: deterministic order, `ttlMs` + `cacheScope: "private"` present, schemas valid JSON Schema 2020-12.
- [ ] Path gating: `..` traversal, symlink escape, and out-of-scope absolute paths rejected for every path-taking tool (table-driven test over the whole tool surface).
- [ ] Write flow: approval-denied and approval-timeout return distinct implementation-range errors; approved write calls `mark_self_write` and triggers reindex; dirty-open-tab write skips suppression.
- [ ] Empty scope ⇒ empty lists and scope errors, never a default exposure.
- [ ] Regression lock (`mcp-server-surface.test` in the spirit of `tauri-capability-surface.test.ts`): server disabled by default, binds `127.0.0.1` only, token required, explorer folders and `aiLock`ed projects absent from the exposable list.

**Frontend (`pnpm typecheck` + `pnpm test`):**

- [ ] `mcp-server-store` persistence partialize (transient fields stripped) tested.
- [ ] Approval card renders client identity + diff preview; auto-deny at 30 s; "always" writes a correctly-shaped `ScopedApproval` and appears in Privacy → Approvals.

**Integration (manual, macOS):**

- [ ] Claude Code (`--transport http`) connects, lists tools, `search_notes` returns index-backed results, `write_note` pops the in-app card and the file lands with no external-change toast.
- [ ] Claude Desktop reads a note via the resource URI.

**Design:**

- [ ] Settings section, status-tray row, and approval card pass `/review-ui` (strict-neutral palette, `TooltipProvider` where applicable, both themes).

**Performance:**

- [ ] Read/search tool handlers answer from the index without touching the frontend; no measurable impact on `pnpm test:perf` budgets or `[perf:startup]` when the server is disabled (the default).

## Out of Scope (deferred)

- **`subscriptions/listen`** — serving `resourcesListChanged`/`resourceSubscriptions` off the filesystem watcher so agents can react to note changes. Clean fit for the new single-stream design; Phase 3.
- **MRTR parameter elicitation** — returning `input_required` to let the *calling client's* user supply a missing argument (e.g., disambiguating a note title). Phase 3; write-consent stays app-side regardless (the calling client is not trusted to approve writes into our workspace).
- **Tasks extension (`io.modelcontextprotocol/tasks`)** — long-running operations (PDF/DOCX export, whole-file transcription) as durable task handles with `tasks/get` polling. Natural second wave once the core surface is proven.
- **Skills-over-MCP / prompts** — exposing Notesage skills through the emerging extension; wait for the working group to stabilize.
- **Remote access** — would require the full 2026-07-28 authorization stack (CIMD-based client registration, RFC 9207 issuer validation, issuer-bound credentials). Separate PRD if ever.
- **stdio shim beyond Phase 2 basics**, Windows/Linux support, per-client scope differentiation (v1 scope is global to the server, not per token).
- **Client-side migration** of Notesage's own MCP client to 2026-07-28 — needed within the 12-month deprecation window for `initialize`/`Mcp-Session-Id`-era servers, tracked as its own follow-up.
