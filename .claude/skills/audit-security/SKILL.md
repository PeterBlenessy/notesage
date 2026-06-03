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
- Check that keys never appear in Tauri IPC messages (resolved on backend via `connection_id`)
- Search for keys in log statements — `log::info!`, `log::debug!`, `console.log`
- Check that error messages don't leak credential values

### Command Injection

- Find `Command::new()` calls where arguments come from user input
- Check for shell expansion vulnerabilities (e.g., passing user strings to `sh -c`)
- Verify subprocess arguments are passed as array elements, not concatenated strings

### Path Traversal

- Find file operation commands (`read_file`, `write_file`, `delete_path`) — do they validate that the path is within allowed directories?
- Check for `..` traversal in user-provided paths
- Verify Tauri capability permissions restrict filesystem access

### Sandbox Integrity

- Check Seatbelt profile generation — does `(deny default)` actually appear?
- Verify network proxy cannot be bypassed (kernel-level enforcement)
- Check domain allowlist enforcement — can agents access domains not in their allowlist?

### Dependency Vulnerabilities

Dependency vulnerability scanning (`pnpm audit`, `cargo audit`, unmaintained-package checks) is covered by `/audit-dependencies` — defer to that audit rather than duplicating the scan here.

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
| XSS | Safe | All content rendered through ProseMirror (sanitized) |
| Command injection | Safe | Subprocess args passed as array elements |
| Sandbox profiles | Safe | `(deny default)` with proxy-only network allow |
