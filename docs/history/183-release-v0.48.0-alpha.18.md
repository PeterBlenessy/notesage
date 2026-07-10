# Release v0.48.0-alpha.18

**Date:** 2026-07-10
**Previous version:** 0.48.0-alpha.17
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

_No user-visible changes._

## Under the hood

Auto-generated from merged PRs + commits since `v0.48.0-alpha.17`. Alpha builds list commit-level detail for technical users.

- docs: 2026-07-08 test-coverage audit (#545)
- test(markdown): cover Mermaid in round-trip gate + add drift guard (#546)
- test(hooks): direct tests for agent-task + acp extracted functions (#547)
- test(markdown): cover untested converters in markdown-html-converters (#548)
- ci(coverage): enforce the coverage gate — instrument the full tree (#549)
- test(editor-store): cover the v0/v1 → v2 persist migration (#550)
- test(chat): cover the chat/message segment renderers (#551)
- test(cmd): cover FloatingCommandBar split hooks + resize handles (#552)
- test(settings/cmd): cover MCP settings dialogs + command-bar context pills (#553)
- docs(audit): reference the full coverage-PR batch (#546–#553)
- docs(audit): mark §2 findings resolved by the coverage PRs
- test: add unit tests for MCP settings and cmd context components
- test(cmd): cover command-bar split hooks and resize handles
- test: add unit tests for chat message renderers
- test(editor-store): cover the v0/v1 → v2 persist migration
- ci(coverage): regenerate baseline against the full instrumented tree
- test: add unit tests for markdown-html-converters helpers
- ci(coverage): instrument the full tree + flag new-but-uncovered files
- docs: add 2026-07-08 test-coverage audit
