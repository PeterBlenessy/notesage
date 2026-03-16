# Release v0.22.0

**Date:** 2026-03-16
**Previous version:** 0.21.0

## Changes

### Features
- Network sandboxing proxy for agent subprocesses — per-agent domain allowlists with HTTP CONNECT tunneling on localhost
- Domain approval cards in chat (allow once / allow for session / allow always / deny) with 30-second auto-deny timeout
- Connection config dialog: sandbox toggle, network restriction toggle with domain list, telemetry toggle (claude-agent-acp)
- Thinking effort slider for codex-acp (Default / Low / Medium / High / Extra High) with free account auto-detection
- Provider switch context isolation — "Start fresh" / "Include history" prompt when switching AI providers mid-conversation
- "Check for updates" button in connections settings with force-check (bypasses rate limit)
- Custom writable paths for sandbox (user-configurable per connection)
- Tool call deny now shows chat message ("Tool call X was denied")

### Fixes
- ACP crate bumped to 0.10/0.11 — resolves `usage_update` decode errors from codex-acp
- Dynamic model list deduplication — strips reasoning effort variants (`/low`, `/medium`, etc.) from ACP model lists
- Domain approval card 30s timeout fixed (useRef for stable timer, no reset on parent re-render)

### Improvements
- Connection cards show Sandbox, Network, and Managed badges
- Config dialog reorganized with boxed Security section, explanatory text, and proper visual hierarchy
- Sandbox badges (Shield icon), network restriction (GlobeLock icon), thinking effort (Brain icon)
- Toast feedback for update check results (success/info/error)
- Seatbelt profiles parameterized for network mode (proxy env vars as enforcement, `(allow network*)` kept for compatibility)

## Files Changed
- 29 files changed across 11 commits
- New: `network_proxy.rs`, `DomainApprovalCard.tsx`, `AgentSwitchCard.tsx`
- Major changes: `acp.rs`, `sandbox.rs`, `ConnectionConfigDialog.tsx`, `ChatPanel.tsx`, `permission-store.ts`, `connections.ts`
