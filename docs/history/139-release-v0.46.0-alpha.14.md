# Release v0.46.0-alpha.14

**Date:** 2026-06-04
**Previous version:** 0.46.0-alpha.13
**Channel:** Alpha

Major MCP (Model Context Protocol) registration overhaul: remote HTTP servers, OAuth 2.1, a curated catalog, keychain-stored secrets, and one-click deep-link install — plus a security hardening pass on the MCP surface.

## Changes

### Features
- Connect to **remote (Streamable HTTP) MCP servers**, not just local stdio ones — added end to end (backend transport + settings UI) (#410).
- **OAuth 2.1 for protected MCP servers**: authorization-code + PKCE, RFC 9728/8414 discovery, dynamic client registration, a loopback callback, and token refresh — tokens stored in the OS keychain with an in-app "Re-authenticate" / "Sign out" flow (#410).
- **Curated MCP server catalog**: a "Browse catalog" picker seeded with the official reference servers (Filesystem, Fetch, Memory, Git, Sequential Thinking, Time, Everything), each badged "Official" with provenance links (#410).
- **Validate-on-add**: adding a server runs a dry-run handshake (connect → initialize → list tools) and previews its tools before anything is written to `mcp.json` (#410).
- **Env secrets in the keychain**: MCP server environment values flagged secret are stored in the OS keychain and resolved only at spawn — `mcp.json` keeps just a reference, never the value (#410).
- **One-click install** via `notesage://mcp/install?…` deep-links that open the validate-first Add dialog pre-filled (#410).

### Fixes
- **Security**: closed a deep-link RCE and an OAuth SSRF on the MCP surface, and fixed an MCP server auto-start transport bug (#419).

## Under the hood
- Add remote (Streamable HTTP) MCP transport — backend (#410)
- Wire remote (HTTP) MCP servers into the UI (#410)
- Validate MCP servers before writing them (validate-on-add) (#410)
- Add MCP catalog scaffolding (empty manifest), then seed it with official reference servers + provenance badges (#410)
- Add OAuth 2.1 core for remote MCP servers (PKCE, token storage) — part 1 (#410)
- Wire the OAuth authorization-code + PKCE flow — part 2 (#410)
- Add OAuth authorize / re-auth UI for remote MCP servers — part 3 (#410)
- Use the `oauth2` crate for MCP OAuth instead of hand-rolling (#410)
- Resolve MCP env secrets from the keychain at spawn — backend (#410)
- Store MCP env secrets in the keychain from the UI — frontend (#410)
- Add `notesage://mcp/install` deep-link for one-click MCP add (#410)
- Polish MCP catalog card + fix pre-existing design-system violations in MCP settings (#410)
- Document the MCP registration UX overhaul (PRD + task breakdown) (#410)
- Refactor: extract `ProjectRow`, `ChildRow` + inline-edit/drag hooks from `ProjectsSection` (#416)
- Reconcile `Cargo.lock` after dropping the unused `tauri-plugin-fs` during merge (#419)
