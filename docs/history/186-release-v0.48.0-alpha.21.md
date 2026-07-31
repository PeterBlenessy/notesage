# Release v0.48.0-alpha.21

**Date:** 2026-07-31
**Previous version:** 0.48.0-alpha.20
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

### Features
- feat(local-ai): give local agentic work room to work, and make its failures visible (#566)

### Fixes
- fix(acp): tell the user when an agent stops before finishing (#565)

## Under the hood

Auto-generated from merged PRs + commits since `v0.48.0-alpha.20`. Alpha builds list commit-level detail for technical users.

- feat(telemetry): count how often context compaction fires
- feat(local-ai): add Qwen3.5 9B — 256K context in place of Qwen3 8B's 32K
- feat(local-ai): opt-in agentic eval harness for local models
- feat(local-ai): compact context at the turn boundary instead of deleting it
- feat(ai): context compaction core — summarize what a trim would delete
- docs(local-ai): record that tool calls are already grammar-constrained
- fix(local-ai): cap tool schemas against the local context window
- feat(local-ai): let users read the inference engine's log
- perf(local-ai): size the context to the model and the machine
- perf(local-ai): quantize the KV cache and give agentic turns room to work
- fix(local-ai): stream the inference server's log instead of burying it
- feat(telemetry): report how agent turns end
- fix(acp): bound the injected conversation history
- test(acp): cover the early-stop wiring, and stop the mock from rotting
- feat(acp): let the user continue a turn that ran out of room
- fix(acp): tell the user when an agent stops before finishing
- fix(acp): return the turn stop reason instead of discarding it
