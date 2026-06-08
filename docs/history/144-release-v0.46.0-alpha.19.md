# Release v0.46.0-alpha.19

**Date:** 2026-06-08
**Previous version:** 0.46.0-alpha.18
**Channel:** Alpha

Fixes the startup crash that bricked alpha.16–18.

## Changes

### Fixes
- **Fixed the launch crash** affecting alpha.16, .17, and .18 (#432). The telemetry plugin ran `tokio::spawn` during startup with no Tokio runtime entered, panicking immediately; the app now enters a runtime before the Tauri builder so it launches cleanly.

## Under the hood
- `run()` builds a Tokio runtime, hands it to Tauri (`async_runtime::set`), and enters it for the process lifetime before the builder runs (#432)
- Rust unit test proving the entered runtime gives plugin-setup `tokio::spawn` a reactor (#432)
- CI smoke-launch step builds with the telemetry key and actually starts the app, failing if the reactor panic returns or startup is never reached (#432)

## Upgrade note
If you're stuck on a broken build (alpha.16–18), the app can't auto-update — download and install alpha.19 manually once, and auto-updates resume.
