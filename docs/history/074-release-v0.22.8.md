# Release v0.22.8

**Date:** 2026-03-21
**Previous version:** 0.22.7

## Changes

### Fixes
- Fix Copilot LSP device code never appearing — `execute_embedded_command` was blocking the sign-in return because `finishDeviceFlow` polls GitHub indefinitely; emit device code event before fire-and-forget command execution
- Fix Copilot LSP being assigned to chat/agent routing slots — restrict capabilities to `['inline_completion']` only (LSP does not speak ACP)
- Fix Gemini CLI auth detection — read `security.auth.selectedType` from `~/.gemini/settings.json` instead of wrong field names; check `GEMINI_API_KEY` env var
- Fix skill discovery loop triggering on its own filesystem writes

### Improvements
- Copilot LSP: add Protocol A support (`signInInitiate` + `signInConfirm` direct methods) alongside existing Protocol B (`signIn` + workspace command)
- Copilot LSP: defer `finishDeviceFlow` execution until user clicks "Open GitHub" — prevents browser from opening before device code is visible
- Copilot LSP: auto-copy device code to clipboard on arrival
- Copilot LSP: comprehensive JSON-RPC message logging at info level + `copilot-lsp-message` Tauri events for browser console debugging
- Gemini CLI: in-app API key input with link to Google AI Studio (free) — no terminal needed; stored as `envVars` in connection credentials
- Gemini CLI: terminal-based Google OAuth as secondary option via `run_in_terminal` command (macOS Terminal.app)
- Agent auth: add stderr logging for agent subprocesses (was piped but never read)
- Agent auth: add `authenticating` phase with "Waiting for sign-in" UI feedback
- Agent auth: shorten authenticate timeout from 120s to 30s
- Update and changelog dialogs: improved sizing, render inline markdown in changelog entries
- New Skill wizard: widened dialog for better readability

### Documentation
- Document Copilot LSP Protocol A/B auth variants and deferred finishDeviceFlow UX
- Document `run_in_terminal` and `copilot_lsp_finish_auth` Tauri command signatures
- Document Gemini API key support and capability restrictions

## Files Changed
- 15 files changed across 7 commits
