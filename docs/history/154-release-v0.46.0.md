# Release v0.46.0

**Date:** 2026-06-14
**Previous version:** 0.45.0

The headline of 0.46.0 is **Local AI Agents** — a real agent that runs entirely on your Mac — alongside on-device meeting transcription, a big upgrade to Model Context Protocol (MCP) connections, opt-in telemetry, and a wave of editor and interface polish.

## Changes

### Features

- **Local AI Agents — a private agent that runs on your Mac.** Set up a local agent in one step (Settings → AI Providers → Add → "Local Agent") and it runs a real agent loop — planning, multiple steps, reading and editing your files — entirely on-device against the bundled local model. No API keys, no cloud account. You can also connect your own agent if it speaks the open Agent Client Protocol.
- **Meeting recording with on-device transcription.** Record a meeting and Notesage transcribes it locally in the background, then offers to file the audio and transcript into a project. Start, pause, and stop from the agent orb or with ⌘⇧R; choose the model and language in Settings → Voice.
- **Connect far more AI tools (MCP).** Connect to remote MCP servers (not just local ones), sign in to protected servers with OAuth, browse a built-in catalog of official servers, preview a server's tools before adding it, keep credentials in your OS keychain, and install a server in one click from a `notesage://` link.
- **Opt-in usage and crash reporting.** Optional, privacy-first telemetry that stays off until you turn it on, with a single switch in Settings. Nothing leaves your device without your consent.

### Improvements

- **A calmer, more flexible workspace.** The title bar is now optional and the sidebar is resizable, with a tidier sidebar (the Pinned section hides when empty, a sticky header, clearer nesting lines, and the open document highlighted) and a stronger "fade the chrome while I type" option.
- **Agent controls in the command bar.** When enabled, the agent permission-mode picker is always available and shows each agent's modes with plain-language names.
- **Smoother indexing indicator.** The ring around the status dot now spins steadily while your library indexes instead of flickering.
- **More reliable HTML viewing.** HTML files render correctly under the app's stricter security policy, with a sandboxed mode and find-in-document.

### Fixes

- **Fixed a startup crash** that affected a few mid-cycle builds.
- **Closed two security issues** in how external tools connect (a malicious-link and a sign-in request-forgery path).
- **Meeting transcription now detects the spoken language automatically** instead of assuming English.
- **Buttons stay legible** — primary and destructive buttons keep a clear white label on the colored fill in both light and dark mode.
- **Chat and agent stability** — conversations and branches keep their state correctly.
- **The Local Agent is far more reliable.** Adding it now succeeds cleanly, its connection check passes once it's set up, and it no longer fails to start with a timeout on larger models. If it ever stops working, you get a clear message in the chat instead of a silent switch to a different model.
- **Signing back in to AI providers is now in-app.** Re-authenticating Claude Code, Codex, Copilot, or Gemini opens the same friendly sign-in you used to add them — no surprise Terminal window — and the sign-in shortcut only appears when a provider actually needs it.

## Under the hood

Promotes the `0.46.0-alpha.1 … 30` line to stable (history entries 126–156), tagged at the alpha.30 commit (`bbd0616c`) so stable contains only alpha-tested code — main HEAD and the alpha.30 commit are identical (no post-alpha commits). This re-cuts 0.46.0 from the fixed alpha after the first attempt (tagged at alpha.28) was rolled back because the Local Agent shipped broken.

Marquee work:

- **Local AI Agents** — PRD `docs/prds/2026-06-12-local-ai-agents.md`, PR #458. Custom `custom_acp` agent connections + a one-click **Local Agent** preset built on **Goose** (an open-source agent from the Agentic AI Foundation — AAIF, a Linux Foundation project; created by Block and donated to AAIF) wired to the bundled llama-server. Real agent loop + MCP pass-through, under a Seatbelt FS sandbox + kernel network deny with staged setup.
- **Local Agent hardening (#461)** — `resolveAgentLaunch` self-heals a missing `config.binaryPath` from `credentials.agentBinary`; `start_local_server` reuses a live server with adequate context and raises the cold-load health budget to 120 s; the preset heartbeat runs the real smoke test (correct env + llama port). Degraded-UX redesign: a failed setup is rolled back so a broken agent never reaches the dropdown, and a runtime failure surfaces in the chat message — the old silent direct-local-chat (Path 4) fallback and the header "Fix" pill were removed.
- **In-app re-authentication (#461)** — the key icon opens a `ReauthDialog` reusing the install flow (browser OAuth / device-code / credential form), prefers the OAuth method over an API-key form for multi-method agents (Codex), and is gated on `expired`/`error` status (a 401 flips the connection to `expired`).
- **MCP** — remote (Streamable HTTP) transport, OAuth 2.1 (PKCE, RFC 9728/8414 discovery, DCR), curated catalog, validate-on-add, keychain env secrets, `notesage://mcp/install` deep links (#410); deep-link RCE + OAuth SSRF closed (#419).
- **Telemetry** — Aptabase (usage) + Sentry (crash) with channel-based consent, PII scrubber, Rust-only egress (#423).
- **Meeting recording** — capture-to-WAV + whole-file Whisper background transcription; orb recording controls; language auto-detect (#427, #437).
- **Quiet Composer** — optional/hide-able title bar, resizable sidebar, sidebar polish (#452); always-visible agent mode picker with friendly labels; status-dot indexing spinner; neutral (non-red) command-bar stop button.
- **HTML viewer** — render under the production CSP via `blob:` URLs, sandboxed-iframe modes, find-in-document (#447, #449, #451, #454).
- Launch-crash fix (telemetry runtime panic, #432); ACP conversation/session/branch integrity (#445); `esbuild` pinned to `>=0.28.1` to clear two build-time advisories (#463).

## Files Changed

- Promotion of the 0.46.0 alpha line to stable: `package.json` version `0.46.0-alpha.30` → `0.46.0`, this history entry, the README index row, and the regenerated `public/changelog.json`.
