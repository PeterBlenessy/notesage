# Notesage Codebase Audit — Master Synthesis

**Date:** 2026-06-03 · **Branch:** `claude/codebase-improvement-considerations-5XKDA` · **Commit:** 22bf2ef (v0.46.0-alpha.12)

Seven specialized agents tore into the codebase, each from one perspective, seeded with a (dated) audit skill but directed to apply current judgment. This synthesis deduplicates and ranks their findings. Per-domain detail lives in `01`–`07-*.md`.

**Overall posture:** genuinely strong. Kernel-enforced Seatbelt sandbox, parameterized SQL, keychain credentials, `any` discipline (~3 real casts repo-wide), FS boundary intact, ProseMirror source-of-truth intact, deep test coverage (298 unit files / ~5,000 cases). The findings below are gaps in an otherwise solid base — not a teardown of a weak one.

## Severity tally (deduplicated)

| Severity | Count | Headliners |
| --- | --- | --- |
| Critical | 3 | MCP self-enable sandbox escape · global un-correlated stream events · cosmetic stream cancel |
| High | ~14 | SSRF link preview · asset-protocol `$HOME/**` · 3× TooltipProvider crashes · chat-list re-parse storm · unbounded JSON-RPC alloc · whisper mutex poisoning · untested data-loss hooks · version/TreeOverlay doc drift |
| Medium | ~22 | proxy host-confusion · skill-script unsandboxed · IPC/JSON trust boundaries · tar-slip · selector cache · missing aria-labels |
| Low | ~16 | reduced-motion guards · PID reuse · error-string leaks · dead code |

---

## Cross-cutting themes (where multiple agents converged)

### Theme 1 — Untrusted AI-agent-authored content is the dominant threat surface
The app renders agent-written markdown, runs agent-written skills, and imports third-party MCP configs. Three independent agents flagged ingress points:
- **SSRF via auto-fetched link previews** — found by BOTH security (H2/H3) and Rust (M2). `fetch_link_metadata` runs in the *main, unsandboxed* process, auto-fires on render of a `> [!link](url)` node, follows 3 redirects, no scheme/private-IP guard. Strongest consensus finding in the audit.
- **MCP self-enable → unsandboxed RCE** (security C1): an agent can write `~/.notesage/mcp.json` (the one `$HOME` dir it can always write), which is discovered *enabled-by-default* for the global source and spawned with **no sandbox**.
- **Asset-protocol scope `$HOME/**`** (security H1): the "hardened" scope still exposes the entire home dir; the regression test gives false assurance (only checks for literal `**`).
- **Skill-script execution** runs unsandboxed with agent-influenced cwd/env (security M2).

### Theme 2 — Streaming event bus is architecturally unsound (the per-hook checklists missed this)
- **C1 (async):** `ai-stream-*` events are global with **no correlation id**. A `generateStructured()` call overlapping a chat stream cross-contaminates — JSON parse fails, chat gets garbage. Fix = thread a `streamId` (the `isOurEvent(conversationId)` pattern Copilot already uses).
- **C2 (async):** `cancelDirectChat` only unlistens the frontend — the Rust HTTP stream keeps running (burns tokens, and its late chunks land in the *next* message via C1). No backend cancel command exists.
- **H2 (async):** ACP listener filters on `instanceId` only, not `sessionId` — stale stream can write the wrong conversation.

### Theme 3 — Unbounded allocations from external input (Rust)
- **H1 (rust):** `vec![0u8; content_length]` in JSON-RPC framing with no cap — a malicious MCP server sending `Content-Length: 99999999999` triggers ~100GB alloc → app abort. Allocation happens *before* the timeout. Companion: unbounded `read_to_end` (M3/M4), GGUF recursion (M5), tar-slip (M1).

### Theme 4 — Chat list re-render/re-parse storm (render perf)
- **B1+B2 (perf):** `MarkdownContent` is unmemoized AND every `ChatMessage` subscribes to global `isLoading` → on every send, **all N messages re-parse their entire markdown twice**. Highest-impact perf finding; cheap fix. Note: these survive even under the React Compiler only partially — B2/B4/B6 are Zustand-subscription-shape bugs the compiler can't fix.

### Theme 5 — TooltipProvider portal crashes (recurring, documented anti-pattern)
- **H1/H2/H3 (a11y):** Three confirmed crash sites — `TextColorPopover`, `HighlightPopover`, `TableToolsPopover` — render `<Tooltip>` inside portaled `PopoverContent` with no provider. Identical to PR #173's editor-blanking crash. Each blanks the editor via ErrorBoundary on open.

### Theme 6 — Documentation has drifted hard since sidebar task #20
- Version says 0.39.1, code is 0.46.0-alpha.12. TreeOverlay documented as live but **deleted**. Sidebar documented as 5 sections, ships **6** (undocumented `FoldersSection` + `folder-appearance-store`). `sync-store` documented, doesn't exist. Test inventory 3× stale. Two undocumented command modules (`alpha_update.rs`, `preview.rs`). The architecture audit independently caught the Folders drift (A6), confirming it.

---

## Recommended fix sequence

**P0 — security + correctness (do first):**
1. SSRF guard on `fetch_link_metadata` (+ `web_search`): scheme allowlist, private/loopback/link-local IP rejection re-checked per redirect, body cap. (sec H2/H3, rust M2)
2. Default ALL discovered MCP servers to `enabled=false`; stop making `~/.notesage` agent-writable, or sandbox MCP spawns. (sec C1)
3. Cap `Content-Length` / header reads in `json_rpc.rs`. (rust H1)
4. Thread `streamId` through `ai_chat_stream` + add a backend cancel command. (async C1+C2)
5. Fix 3 TooltipProvider crashes. (a11y H1-H3)

**P1 — robustness + UX:**
6. Narrow asset-protocol scope off `$HOME/**`; tighten the regression test. (sec H1)
7. `parking_lot::Mutex` (or poison-recovery) for whisper ctx; release lock across inference. (rust H2)
8. Memoize `MarkdownContent`; pass streaming state as prop instead of per-message `isLoading` subscription. (perf B1/B2)
9. Wrap `FloatingCommandBar` + `AgentOrb` in ErrorBoundary; add aria-labels to the cmd-bar textarea + icon buttons. (a11y H4/H5/M2-M7)
10. Tests for `useTranscriptionJob` + `useFileWatcherIntegration` (data-loss branch). (tests A1/A2)
11. Doc refresh: version, TreeOverlay removal, Folders section, sync-store, test inventory, new commands. (docs B1-B7)

**P2 — hygiene:**
12. Delete ~1,700 lines of orphaned frontend files + 7 redundant npm deps + ungranted `tauri-plugin-fs`. (arch B1-B4)
13. Runtime validation at security-sensitive JSON boundaries (`path-filter.ts`). (types A2)
14. Split god-files: `FloatingCommandBar` (2832L), `ProjectsSection`, `StatusBar`, `useAcpLifecycle`. (arch A1-A4)
15. `motion-reduce:animate-none` on streaming cursors / skeletons; proxy host-confusion fix; tar-slip; GGUF depth cap; selector cache. (a11y L1-L6, sec M3, rust M1/M5, perf B4)

---

## Where the dated skills were blind (feeds Wave 2 skill upgrades)
- **Per-hook leak checklists missed architectural bus bugs** — global un-correlated events + frontend-only cancel pass every per-call-site check while the bus is unsound.
- **Security checklist audited components in isolation** — missed the *composition* escape (agent-writable dir → enabled-by-default discovery → unsandboxed spawn) and said nothing about Tauri v2 asset-protocol scope or SSRF in auto-fetch-on-render.
- **Rust checklist's "lock across await" framing is dated** — the live footgun is std `Mutex` *poisoning*, and *allocator/overflow* panics that the command boundary can't contain (not the harmless `.unwrap()` noise).
- **Type-safety's "no any" rule is satisfied** — the real exposure is unvalidated `invoke<T>` / `JSON.parse as T` trust boundaries, which the skill didn't enumerate.
- **Perf skill predates React Compiler** — needs to distinguish compiler-fixable (memoization) from compiler-immune (Zustand subscription shape, key stability, imperative DOM).
- **A11y skill didn't encode the portal-severs-TooltipProvider rule** as a grep check despite it being a known repeat crash.
- **Several flagship skill examples are already fixed** in this codebase — re-flagging them is noise; the skills should point at the *remaining* instances.
