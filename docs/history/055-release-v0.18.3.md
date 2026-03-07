# Release v0.18.3

**Date:** 2026-03-07
**Previous version:** 0.18.2

## Changes

### Features
- MCP Client Integration (Phase 7 Step B): Rust backend with stdio JSON-RPC transport, Zustand store, discovery hook, and Settings UI for managing MCP servers
- Import existing MCP server configurations from Claude Desktop, Cursor, and VS Code
- Add/edit/remove MCP servers with `.notesage/mcp.json` (global) persistence
- Edit custom skills and agents from Settings with structured dialog (description, instructions, advanced options)
- New addressable agent creation dialog with advanced fields (model, icon, allowed-tools, user-invocable, disable-model-invocation)
- Rewrite skill creation wizard as single-page dialog with advanced options (allowed-tools, disable-model-invocation)

### Improvements
- Use existing `serializeFrontmatter` library instead of hand-rolled YAML builders across all create/edit dialogs
- Memoize skill/agent source grouping to avoid redundant filter passes on re-render
- Add async cancellation guards to edit dialog effects to prevent stale writes on rapid open/close
- Update bundled `create-skill` to guide AI about advanced frontmatter fields
- Scrollable dialog bodies when window is small
- MCP server auto-start on discovery, parallel startup via `Promise.allSettled`

### Fixes
- Fix MCP `mcp_start_server` holding Tokio mutex across network I/O
- Fix MCP `mcp_call_tool` holding mutex during tool call round-trip
- Fix MCP settings UI using `useState` instead of `useEffect` for async config import check
- Remove broken MCP project scope selector (both paths saved to global)
- Remove useless async MCP stop calls from `beforeunload` handler
- Remove duplicate `requestRescan` alias in SkillsSettings
- Remove empty `className=""` on delete menu items

## Files Changed
- 16 files changed across 2 commits
