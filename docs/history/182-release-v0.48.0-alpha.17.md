# Release v0.48.0-alpha.17

**Date:** 2026-07-09
**Previous version:** 0.48.0-alpha.16
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

### Fixes
- fix(security): reject unregistered agent ids in agent_uninstall (path traversal) (#536)
- fix(security): mcp_oauth redirect SSRF + mcp command wrapper bypass + CI audit gating (#537)
- fix(security): gate zero-click link-preview fetch, narrow process cap, extend IPv6 blocklist (#538)
- fix(deps): bump crossbeam-epoch 0.9.18 → 0.9.20 (RUSTSEC-2026-0204) (#542)

## Under the hood

Auto-generated from merged PRs + commits since `v0.48.0-alpha.16`. Alpha builds list commit-level detail for technical users.

- Bump rollup from 4.57.1 to 4.59.0 in the npm_and_yarn group across 1 directory (#1)
- docs: 2026-07-05 security re-audit + dependency health reports (#535)
- chore(deps): bump @tiptap/* 3.23.6 → 3.27.3 (#540)
- chore(deps): bump pdfjs-dist 5.7.284 → 6.1.200 (#541)
- test(markdown): cover Mermaid in round-trip gate + add drift guard (#546)
- test(hooks): direct tests for agent-task + acp extracted functions (#547)
- test: cover extracted agent-task + acp session-config units
- test(markdown): cover Mermaid in round-trip gate + add drift guard
- docs: add resolution notes to 2026-07-05 audit reports
- docs: add 2026-07-05 security re-audit and dependency health reports
