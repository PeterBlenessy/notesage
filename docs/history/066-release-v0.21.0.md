# Release v0.21.0

**Date:** 2026-03-15
**Previous version:** 0.20.2

## Changes

### Features

- **Agent managed installation** — Download and install ACP agent binaries (claude-agent-acp, codex-acp, copilot, copilot-language-server) directly from GitHub Releases. One-click install with progress bar, quarantine removal, and version tracking. Manual install guide as fallback.
- **Portable Node.js runtime** — Gemini CLI install flow downloads a standalone Node.js binary to `~/.notesage/runtime/node/` for users without Node.js installed.
- **OS-level filesystem sandboxing** — Managed agent installs run inside a Seatbelt sandbox on macOS. Blocks access to `~/.ssh`, `~/.aws`, `~/.gnupg`, `.env` files. Protects `.git` from writes. Linux bubblewrap support as placeholder.
- **Multi-path sandbox** — Chat agents get access to all workspace folders; delegation and inline actions are restricted to the document's parent project folder only.
- **Chat context isolation** — Project selection in the chat footer is now a data boundary. Changing projects shows an inline prompt: "Include history" or "Start fresh". New ACP sessions created per segment. Context dividers mark scope changes with collapsible details.
- **Dynamic model picker** — ACP agents report available models via `unstable_session_model` feature. Shown in a Select dropdown in connection config. Hardcoded fallback for agents that don't implement it.
- **Connection health check** — HeartPulse button on each connection card. Tests the actual provider (spawns agent for ACP, checks status for LSP, lists models for API key, verifies server for Local AI).
- **Agent update checking** — Background check against GitHub Releases on settings page open. Update badge on connection cards with one-click update.

### Fixes

- **Gemini CLI `--acp` flag** — Changed from `--acp` to `--experimental-acp` (confirmed via `--help`).
- **Codex ACP model flag** — Changed from `--model` to `-c model="..."` (codex-acp uses TOML config syntax).
- **ACP stdout corruption** — JSON line filter strips non-JSON output from agent stdout before the ACP parser sees it. Handles agents that write interactive prompts or log messages to stdout in ACP mode.
- **Gemini auth detection** — Checks `~/.gemini/settings.json` for authentication state. Shows auth guide when not signed in.
- **Connection timeout** — Increased from 60s to 120s for slower agent startups.
- **Error display** — Parses doubly-nested JSON from ACP agents. Adds actionable hints for common errors (model not supported, billing, rate limits, auth).
- **Radix dialog warning** — Added `aria-describedby={undefined}` to ConnectionConfigDialog.
- **Local AI health check** — Now actually checks if llama-server is running instead of always returning green.

### Improvements

- **Pretty model names** — `prettyModelName()` maps model IDs to display names (e.g., `gpt-5.2-codex` → "GPT-5.2 Codex").
- **Connection card layout** — Settings dialog widened to 800px. Subscription type next to provider name, model + capabilities on second row, action buttons top-right.
- **Model picker UX** — Simple Select dropdown for agent-managed connections (replacing the search combobox). Shows "Agent default" option with current model name.
- **Sandbox profile** — Allows agent config directories (`~/.gemini`, `~/.claude`, `~/.codex`, `~/.copilot`, `~/.notesage`, `~/.config`).
- **Workspace respawn** — Chat agent automatically restarts when workspace folders change (projects/explorer folders added or removed).

## Files Changed

- 28 files changed across 20 commits (+3082, -241)
