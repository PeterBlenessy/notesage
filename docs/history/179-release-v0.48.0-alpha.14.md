# Release v0.48.0-alpha.14

**Date:** 2026-07-07
**Previous version:** 0.48.0-alpha.13
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

### Fixes
- fix(security): reject unregistered agent ids in agent_uninstall (path traversal) (#536)
- fix(security): mcp_oauth redirect SSRF + mcp command wrapper bypass + CI audit gating (#537)

## Under the hood

Auto-generated from merged PRs + commits since `v0.48.0-alpha.13`. Alpha builds list commit-level detail for technical users.

- fix(security): harden mcp_oauth redirects + mcp command guard, gate CI audits
- fix(security): reject unregistered agent ids in agent_uninstall
