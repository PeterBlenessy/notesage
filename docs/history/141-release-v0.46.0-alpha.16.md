# Release v0.46.0-alpha.16

**Date:** 2026-06-07
**Previous version:** 0.46.0-alpha.15
**Channel:** Alpha

> ⚠️ **Broken build — does not launch.** This release crashes on startup (telemetry plugin Tokio-runtime panic). Fixed in alpha.19; the auto-updater no longer serves it. See #432.

Opt-in telemetry: privacy-first usage analytics and crash reporting, gated behind a consent toggle.

## Changes

### Features
- **Opt-in telemetry** (#423):
  - Usage analytics via **Aptabase** (privacy-first, EU/US regions).
  - Crash reporting via **Sentry** (with a PII scrubber on the way out).
  - Channel-based consent — nothing is sent until you opt in, and it can be toggled live in Settings.

## Under the hood
- Usage analytics (Aptabase) + crash reporting (Sentry) with channel-based opt-out (#423)
- Sentry client initialised once up front; crash egress gated at runtime by binding/unbinding the Hub client (#423)
- `before_send` PII scrubber + breadcrumb capture disabled to avoid leaking file paths (#423)
- Remove unused `WWW-Authenticate` parsing helpers from MCP OAuth (dead code) (#425)

## Known issues
- **Crashes on launch.** `tauri-plugin-aptabase`'s `start_polling` calls `tokio::spawn` during plugin setup with no Tokio runtime entered → panic. This is the first release built with the Aptabase key, so it's the first to hit it. Fixed in alpha.19 (#432).
