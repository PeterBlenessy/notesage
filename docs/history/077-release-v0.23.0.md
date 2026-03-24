# Release v0.23.0

**Date:** 2026-03-24
**Previous version:** 0.22.10

## Changes

### Features
- **Secure credential storage**: API keys stored in macOS Keychain via `keyring` crate instead of plaintext localStorage. Backend resolves keys directly from keychain — keys never transit through IPC. Transparent one-time migration for existing users.
- **Multiple OpenAI-compatible connections**: Users can now add multiple custom API endpoints (e.g., Groq, Together AI, vLLM) with user-defined labels and inline rename support.

### Fixes
- **OpenAI-compatible config persistence race**: Merged two-step `addConnection` + `updateConnection` into a single atomic call — eliminates the race that could leave connections without a base URL.
- **OpenAI-compatible dropdown dedup**: Exempted `openai_compatible` from label-based dedup that incorrectly blocked adding more than one custom provider.
- **Startup validation**: `openai_compatible` connections missing `config.baseUrl` are now flagged as `error` on startup instead of silently failing at runtime.
- **Local AI production startup**: Removed legacy binary download path, added diagnostics for sidecar resolution failures.
- **Whisper transcription production fixes**: Entitlements for microphone access, silence detection to skip empty audio, robustness improvements.
- **Production logging gaps**: Log level selector in settings, structured logging, diagnostics export.
- **Index/watcher mutex poisoning**: Switched to `parking_lot::Mutex` for non-poisoning behavior.

### Improvements
- **Add Connection dropdown**: Denser layout, wider dropdown, removed redundant "Connected" labels, count badge for multi-instance providers.
- **Provider logo consistency**: Icon-based logos (Local AI, OpenAI-Compatible) now match the styling of image-based logos.

## Files Changed
- 30+ files changed across 11 commits
- New: `src-tauri/src/commands/credentials.rs` (OS keychain integration)
- Major: `connections-store.ts`, `useAIOperations.ts`, all AI provider classes, `ai.rs`
