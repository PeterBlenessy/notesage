# Release v0.38.0

**Date:** 2026-04-20
**Previous version:** 0.37.0

Project & data isolation. AI features now respect the project you've selected in the chat footer — chats, tool calls, inline completions, and Copilot document syncing all stay within scope. Per-project AI provider locks keep a project tied to one provider even on accidental multi-selects.

## Changes

### Features

- Lock a project to a specific AI provider — chats, inline actions, and agent tasks in that project can only use that provider
- Resend or edit an older message while the chat footer is set to a different provider — a dialog asks whether to use the original provider or the current one
- Chat footer shows a padlock on locked projects and refuses to mix projects locked to different providers in a multi-select
- Re-authenticate any AI provider in one click via a new key icon on the connection card in Settings → Connections, or from the "Authentication failed" toast when a session dies
- New **Settings → Privacy → Approvals** panel lists every "always allow" approval you've granted, with per-row revoke and bulk-revoke for legacy or out-of-scope approvals
- New **Settings → Advanced → Cross-project mode** opt-in for power users who want the agent to access all workspace folders at once (default off — isolated)
- New **Settings → Advanced → Require confirmation for all tool calls** disables auto-allow entirely
- Activity panel now marks each tool call as auto-approved, user-approved, or denied, with the full path on hover

### Improvements

- AI chats now only see files from the projects you've explicitly selected in the chat footer. Skill descriptions, agent instructions, and `CLAUDE.md` content from unselected projects no longer leak into prompts
- Direct-API file operations (Anthropic, OpenAI, Ollama, local) refuse paths outside the selected projects instead of silently reading any file the model asks for
- Project isolation is enforced at the kernel level on macOS. The OS itself blocks agent reads and writes outside the selected project(s) — not just the app
- Copilot chat and inline completions now stay within the selected projects. Tabs from unselected projects no longer sync to Copilot's servers
- Inline completions from Ollama, local AI, and any OpenAI-compatible provider also stay in scope; a status-bar indicator ("Completions: off (outside project)") shows when suppressed
- "Always allow" tool approvals are now scoped to the specific provider and project they were granted in — approvals no longer leak across projects or providers
- Tray "Recent" menu shows files from your selected projects only, with an opt-in "All Recent" submenu for the full list
- Command palette and chat history filter to selected projects by default, with a "search all projects" toggle
- Per-agent config directory isolation — Claude Code can no longer write to Codex's config, and vice versa

### Fixes

- Claude Code, Codex, and Copilot now spawn correctly when installed at non-standard paths (previously failed with "Authentication required" or "server shut down unexpectedly")
- Claude Code can authenticate on machines where the OAuth token lives in the macOS keychain
- Resend / edit dialog correctly fires when the original message was sent to a different provider
- Asset protocol no longer allows serving arbitrary files from anywhere on disk — hardened to the notes library, app data, and system resource paths only

## Under the hood

Released as a follow-up to the project-data-isolation audit (2026-04-18) and PRD. Track 1 Critical + High leaks all closed. Full red-team verification landed in v0.38.1. Kernel sandbox now uses deny-by-default inside `$HOME` with a curated allow-list for language runtimes and per-agent config directories.

See `docs/prds/2026-04-18-project-data-isolation.md` for the full scope and `docs/audits/2026-04-18-project-isolation.md` for the original leak inventory.

## Files Changed

114 files changed across 34 commits. 3,062 unit tests passing, 27 macOS sandbox tests passing, all performance benchmarks within budget.
