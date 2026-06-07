# Telemetry — what Notesage collects (and what it never sends)

Notesage can send two kinds of **anonymous** diagnostic data to help stabilize
the fast-moving alpha:

1. **Usage analytics** — coarse, fixed-taxonomy events about *which features are
   used* (e.g. "a document was opened", "an export ran").
2. **Crash reports** — stack traces for Rust panics and frontend errors, grouped
   by app version, so regressions can be found and fixed.

Both are **off by default on the Stable channel** and **on by default on the
Alpha channel** (alpha users are explicitly opting into helping test). Either
can be turned off at any time in **Settings → System → Telemetry**, independently
of the release channel.

## What is sent

**Usage analytics** — only the events and properties in this fixed list. Every
property is a low-cardinality enum; there is no free text.

| Event | Properties |
| --- | --- |
| `app_launched` | app version, coarse OS (`macos`/`windows`/`linux`), channel |
| `document_opened` | format (`md`/`epub`/`pdf`/`docx`/`pptx`/`code`/`image`/`text`) |
| `ai_chat_sent` | AI path (`direct`/`acp`/`copilot_lsp`/`local_bundled`), provider *kind* |
| `ai_action_used` | action (`improve`/`summarize`/`expand`) |
| `export_performed` | format, template (built-in name, or `custom` for user-uploaded) |
| `connection_added` | provider *kind* |
| `skill_invoked` / `mcp_tool_called` | source (`user`/`project`) |
| `feature_used` | feature name (e.g. `focus_mode`, `recording`, `cmd_bar_pin`) |

**Crash reports** — exception type and message, and a stack trace with
**function and module names only**. File paths, the hostname, and any user
identity are stripped before the report leaves your machine (a single
`before_send` scrub point), and `send_default_pii` is off.

Daily/monthly active-user counts are deduplicated using the analytics SDK's own
anonymous identifier — not tied to any account or device fingerprint. Notesage
does not attach its own user or install id to events.

## What is NEVER sent

- Document content, titles, or file names
- File paths or folder names
- AI prompts, completions, or chat content
- API keys or credentials
- Project names or search queries
- Your IP-derived identity, account, email, or hostname
- Any free-text field — only the fixed enums above

## How it works

- **All network egress originates in the Rust backend.** The frontend's
  hardened capability surface is unchanged — no new filesystem or HTTP
  permissions, no direct phone-home from the WebView.
- Usage analytics use [Aptabase](https://aptabase.com); crash reports use
  [Sentry](https://sentry.io) (DSN-based, so a self-hosted
  [GlitchTip](https://glitchtip.com) is a config swap, not a code change).
- Consent is stored locally in `~/.notesage/telemetry-consent.json`. Toggling
  a switch takes effect immediately — turning crash reporting off stops new
  reports in the same session, no restart required.
- Builds without telemetry keys (every local/dev build from source) send
  nothing at all — the SDKs simply don't initialize.

## Turning it off

**Settings → System → Telemetry** has independent switches for **Usage
analytics** and **Crash reports**. Your choice there always overrides the
channel default and persists across restarts.
