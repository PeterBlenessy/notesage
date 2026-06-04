# Audit Skills — Proposed Upgrades (Review Gate)

**Date:** 2026-06-03 · Status: **PROPOSALS ONLY** — nothing applied to `.claude/skills/` yet.

Each Wave-1 audit fed a Wave-2 agent that read its findings + the seed SKILL.md and drafted a surgical upgrade. Every proposed change is traceable to a real finding (cited `file:line`). The unifying lesson across all 12: **the dated skills hunt literal, local patterns; this audit's high-impact bugs were architectural / boundary-level / compositional — invisible to a per-item checklist.** Full proposals in the sibling files.

## Per-skill summary

| Skill | Stale fixes | New checks | Headline blind spot the upgrade closes |
| --- | --- | --- | --- |
| **audit-security** | 4 | 3 | Audited each component in isolation; all isolated checks *passed* while the one Critical (C1) was a **composition** — agent-writable `~/.notesage` → global MCP enabled-by-default → unsandboxed spawn. Never modeled the agent as adversary following a write→register→spawn data flow. Adds: Tauri v2 capability/CSP/asset-protocol scope; SSRF in backend fetch; MCP/ACP subprocess trust. |
| **audit-rust-backend** | 2 | 5 | "Lock across `.await`" framing is dated — the live footgun is std-`Mutex` **poisoning** (H2) and **allocations sized by untrusted input** (H1: a hostile MCP `Content-Length` aborts the app). Adds: SSRF, tar-slip, parser recursion depth, PID-reuse, kill_on_drop-defeat-via-wait-task. |
| **audit-async-flows** | 2 | 5 | Per-hook leak checks pass while the **event bus** is unsound — global un-correlated `ai-stream-*` events cross-contaminate concurrent streams; cancel only tears down frontend listeners. Fix is a `streamId`/`sessionId` correlation id, not tighter cleanup. Adds: event-bus correlation, unmount-abort of yielding pipelines + `editor.isDestroyed`, request-supersede, `getState()`-in-deps. |
| **audit-memory-leaks** | 2 | 3 | Its two flagship "broken `listen()`" examples are **already fixed** in this repo (`useSandboxViolations` is now the *good* reference). Re-points to the real remaining sites (StatusBar H3) and adds multi-listener / reused-singleton fan-out variants. |
| **audit-large-files** | 2 | 4 | Ranked by raw line count — but `pptx-parser.ts` (2279L) is fine while `StatusBar.tsx` (1148L, 11 components) is HIGH. Re-anchors to rank by *largest single unit / responsibility count / churn*. Adds: N-components-per-file, module-level mutable singletons in hooks, two-responsibility split. |
| **audit-dead-code** | 2 | 3 | Searched by export *name*, missing the largest category — **whole-file orphans** (~1,588 lines) and test-only files. Adds reachability sweep + false-positive guards for the repo's string-reachability idioms (Tauri `invoke`, dynamic imports, Zustand selectors, transitive npm). |
| **audit-type-safety** | 2 | 5 | "No `any`" is *satisfied* (0 real `any`, 3 `as any`) — yet the real exposure is unvalidated `invoke<T>` / `JSON.parse(...) as T` trust boundaries (incl. the `path-filter.ts` security gate). Adds runtime-validator guidance + a "low any count ≠ clean" warning. |
| **audit-render-performance** | 2 | 7 | Old priority ordering **deprioritized the streaming chat list** — the actual hot path. Adds: unmemoized child + inline plugin config, per-item global-flag subscription, `key={index}`, module-global closure-cached selectors, in-render derivation while streaming, MutationObserver layout thrash, React-Compiler covered-vs-must-fix-by-hand split. |
| **audit-test-coverage** | 2 | 3 | Trusted the inventory (docs said ~2,160 cases; actual ~5,000) and reflexively flagged whole tiers as absent. Adds: measured counts (exact commands), blast-radius ranking, untested async orchestrators / data-loss branches, adversarial security-boundary cases, parallel-config tests (round-trip). |
| **audit-documentation** | 2 | 2 | Read docs as a trustworthy index; reality required building the surface *from code* and diffing (3×-stale counts, deleted-but-documented TreeOverlay, 2 undocumented command modules). Adds a repeatable mechanical-drift method + cross-document consistency grep. |
| **audit-accessibility** | 2 | 3 | Had **zero** guidance on the repo's #1 recurring crash — `<Tooltip>` inside portaled `PopoverContent` with no provider (3 live crash sites). Adds: TooltipProvider+portal grep, reduced-motion `animate-pulse` grep, accent/contrast token compliance. Plus `title`-only and `placeholder`-as-label fixes. |
| **audit-error-ux** | 2 | 2 | Only covered `invoke()` rejections — but **streaming errors arrive via `listen()` handlers** (ACP/LSP) and were structurally invisible. Adds: Tauri event-based error paths, error-message-quality (generic strings discarding real detail), named mandatory ErrorBoundary surfaces. |

**Totals:** ~25 stale-guidance fixes, ~45 new checks across 12 skills.

## Recommended application order
1. **audit-security**, **audit-async-flows**, **audit-accessibility** — these missed *Critical/High live bugs entirely*; highest value.
2. **audit-rust-backend**, **audit-render-performance**, **audit-type-safety** — missed High-impact classes.
3. **audit-test-coverage**, **audit-documentation**, **audit-large-files**, **audit-dead-code** — methodology fixes (build-from-code instead of trusting indexes).
4. **audit-memory-leaks**, **audit-error-ux** — refresh stale examples + add the missed variants.

> **Gate:** review the per-skill proposal files, then I apply the approved edits into `.claude/skills/audit-*/SKILL.md`. No skill file has been modified yet.
