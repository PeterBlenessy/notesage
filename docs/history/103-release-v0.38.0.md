# Release v0.38.0

**Date:** 2026-04-20
**Previous version:** 0.37.0

Project & Data Isolation — Track 1 / Track 2 / partial Track 3 from
the 2026-04-18 audit and PRD. This release closes 22 isolation leaks
identified in two audits, introduces hard per-project AI provider
locks, and narrows the kernel sandbox to deny `$HOME` by default with
a curated allow-list.

## Theme: Project Isolation

Every chat, every tool call, every LSP document sync now respects the
chat footer's project selection. A message sent to Claude Code from
Project A cannot silently bleed into Project B when you switch
providers. An agent scoped to Project A receives `EACCES` from the
kernel if it tries to read a sibling project's files. Copilot LSP
won't sync tabs outside scope. Inline completions go quiet for
out-of-scope tabs.

Red-team TDD discipline: every Critical / High leak has a failing-by-
design attack test that reproduces the leak, then flips to assert the
attack must fail. The tests are permanent regression locks — any
future change that re-opens a leak trips them.

## Changes

### Features

- **aiLock enforcement (#1, #12, #13, #14)** — new `ProjectMetadata.aiLock`
  hard-locks a project to a specific AI provider. Honoured at every send
  path: new message, resend, edit, comment delegation, inline actions
  (ACP + direct API). Multi-select refuses projects with conflicting
  locks. Sidebar padlock overlay, chat-footer lock ribbon with
  explain-modal, Settings → Project lock section with confirmation
  dialog.

- **Resend / edit provider-mismatch dialog (#10, #11)** — when the
  message's original `connectionId` differs from the current footer
  connection, a dialog prompts "Resend with original" vs "Resend with
  current". aiLock disables the non-matching option. Default is
  original. Edit path creates a new branch; resend wipes the thread
  from the resent message down. User messages now carry the target
  connection id so the detector can fire.

- **Scoped approvals (#2, #3)** — permission-store `alwaysAllowed`,
  `toolCallAlways`, `skillScriptAlways` are now `(toolName,
  connectionId, projectRoot)` triples, not flat strings. Domain
  allowlists scoped similarly. One-time migration into a legacy bucket
  preserves existing behaviour. New Settings → Privacy → Approvals
  panel lists every persisted approval with revoke / bulk-revoke.

- **Direct-API tool-executor scope (#8)** — `read_file`,
  `list_directory`, `write_file`, and the implicit-FS tools
  (`add_comments`, `list_comments`, `resolve_comments`,
  `generate_pptx`) refuse paths outside the chat's selected projects.
  Missing scope denies (secure default). 8 red-team attack tests lock
  the wire-level behaviour — the Tauri IPC is never reached on deny.

- **Kernel-level sandbox (#0, #4, #5, #6, #6b, #6c, #6d)** — Seatbelt
  profile now uses `(deny file-read* (subpath "$HOME"))` with a curated
  allow-list that enumerates every path the four supported ACP agents
  need at init time. Sibling-path leak (`~/Code/A` vs `~/Code/B`)
  closed by the allow-list model. Cross-project mode is an explicit
  opt-in. Selected-project-only path filter applied unconditionally
  for every ACP chat (no more `opts.sandboxPaths` gate). Test harness
  at `src-tauri/tests/sandbox_isolation.rs` spawns a real agent and
  asserts kernel denials.

- **Per-project registries (#18, #19, #20)** — skills, agents, agent
  instructions, and MCP servers are now keyed by project. System-prompt
  composition pulls only `global ∪ selectedProjects`. `read_agent_instructions`
  no longer silently ships Project A's CLAUDE.md into Project B's chat.

- **Copilot LSP isolation (#15, #16)** — workingDir reflects the chat
  footer selection (not hard-coded `projects[0]`). `didOpen`,
  `didChange`, `didFocus`, and `copilot/context-request` are all gated
  on the active tab being in-scope. Rate-limited per-tab toast when
  completions are suppressed.

- **Inline completion scope gate (#17)** — Copilot LSP, Ollama FIM,
  local-bundled FIM, and OpenAI-compatible completions all skip the
  request for out-of-scope tabs. New `completionsOnOutOfScope` setting
  under Settings → Advanced (default off — secure) for users who want
  the legacy behaviour. Editor StatusBar shows "Completions: off
  (outside project)" when suppressed.

- **Agent activity visibility (#22)** — `AgentActivity` gains an
  `approvalMode` field (`auto` / `user` / `denied`). Activity panel
  renders a badge. Full path argument visible on hover. New
  `requireAllToolConfirmations` global toggle disables auto-allow.

- **Tauri capability hardening (#21)** — `assetProtocol.scope.allow`
  narrowed from `["**"]` to a curated list (`$HOME/Notesage`,
  `$APPDATA`, etc.). Unused `fs:allow-*` plugin capabilities dropped.

- **Tray recent files scope (#31)** — tray "Recent" submenu filters
  by the selected projects. Opt-in "All Recent" submenu shows
  everything.

- **Per-project command palette / autocomplete (#25)** — `@` mentions,
  `#` tags, and research (`?`) searches filter to selected projects
  by default. "Search all projects" toggle for the current session.

- **History tab project scope (#26)** — chat history filters by
  `projectPaths` intersection with the selection. "All projects"
  toggle preserves the old unfiltered view.

- **Sandbox respawn on scope change (#7)** — changing the project
  selection triggers an ACP agent respawn with the updated writable
  paths. Integration test locks the assertion.

- **Per-agent writable config subpath (#24)** — sandbox profile emits
  only the `~/.<agent>` subpath matching the spawning binary (not
  every agent's config dir). Cross-agent config leakage closed.

- **User-friendly re-authentication** — new key-icon button on every
  ACP connection card in Settings → Connections opens Terminal with
  the agent's sign-in command pre-filled (same command used at
  initial registration). Chat error path auto-detects 401 /
  authentication failures and fires a toast with a "Re-authenticate"
  action button. Reuses `getAuthGuide()` as the single source of
  truth for each agent's sign-in flow.

### Fixes

- **Sandbox basename extraction** — `agent_config_entries` was
  matching the full resolved binary path
  (`/opt/homebrew/bin/copilot`) against the bare command name
  (`"copilot"`), so every absolute-path caller fell into the `_` arm
  and silently stripped Bucket C. Reproduced in live testing:
  Claude / Codex / Copilot all failed at session/new with EPERM on
  their config files; only Gemini worked. Fix extracts the basename
  before matching; regression locked by
  `agent_config_entries_resolves_absolute_paths`.

- **Claude keychain access** — Claude Code's SDK reads OAuth tokens
  from the macOS login keychain via node-keytar. Without keychain
  access, session/new succeeded but session/prompt returned
  "Authentication required". Added the same narrow `login.keychain-db`
  literal allow that Copilot already has.

- **User messages carry connectionId (#10 follow-up)** — only
  assistant messages were stamped, so the resend/edit dialog never
  fired (the mismatch check reads the user message). Stamped at
  creation in both `useDirectApiChat.ts` and `useAcpLifecycle.ts`.
  Regression test added.

- **Scope isAutoAllowed per-project (#6b)** — lookup site passed
  `(null, null)` even after #2 added scoped `ScopedApproval` data, so
  an "always allow" granted in Project A auto-approved the same tool
  in Project B.

- **Footer capability source-of-truth** — connection cards now derive
  capabilities from the connection itself, not from an ephemeral live
  session that can be gone by the time the user looks at the UI.

### Improvements

- **Footer consolidated "+" menu** — merged the standalone image-attach
  button and the project picker into a single `+` popover. Provider
  logo downsized to 18px for visual balance. Icon-only provider pill.

- **Performance** — this release accidentally improved startup (likely
  iCloud sync happened to be cold-cache friendly for the baseline
  run): phase1-ready 3,817 → 3,199 (−16%), skills total 4,434 → 3,217
  (−27%), tree refresh 4,914 → 3,330 (−32%), startup ready 5,999 →
  4,387 (−27%), tabs restored 5,706 → 4,100 (−28%). None of this
  release's changes target the startup hot path, so these numbers are
  likely noise rather than a durable improvement — kept for the
  baseline record.

### Documentation

- Project & data isolation audit, PRD, and 37-task breakdown
- Test harness README for `sandbox_isolation.rs`
- UX follow-ups captured in `docs/audits/2026-04-20-isolation-followups.md`
  (tray grouping by project; editor-tab ↔ chat-footer scope coupling
  discoverability)

## Files Changed

114 files changed across 34 commits. +14,372 / −836 lines.

3,062 vitest tests passing. 27 macOS-specific sandbox unit tests
passing. cargo lib tests green.

## Quality Gates

| Gate | Status |
| --- | --- |
| Unit tests (3,062) | pass |
| TypeScript typecheck | clean |
| Performance benchmarks (24 cases) | within budget |
| Rust sandbox tests (27) | pass |
| Kernel sandbox integration tests | pass (manual `--ignored sandbox` run) |
| Red-team attack tests | pass for every Critical / High leak |
