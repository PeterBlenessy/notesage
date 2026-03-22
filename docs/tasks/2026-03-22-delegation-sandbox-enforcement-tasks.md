# Delegation Sandbox Enforcement — Tasks

**PRD:** [delegation-sandbox-enforcement ](../prds/2026-03-22-delegation-sandbox-enforcement.md)**Date:** 2026-03-22

## Summary

**8 tasks: 7 done, 1 abandoned**

**Implementation order:** #1 ✅ → #2 ✅ → #3 ~~abandoned~~ → #4 ✅ → #5 ✅ → #6 ✅ → #7 ✅ → #8 ✅

---

## Completed Tasks

### 1. Add `projectRoot` to `TaskAgentState` and respawn on project change ✅

**Complexity:** S | **Category:** frontend

Task agent tracks `projectRoot`, respawns when project changes. Previously reverted in `0a11c2e` (wrongly attributed hang — actual cause was ACP agent failing on iCloud file reads, unrelated). Re-applied in `cf47807` without the `acp_agent_exists` health check or scope instruction.

**Files:** `src/hooks/useAgentTaskOperations.ts`

---

### 2. Thread `projectRoot` from delegation to task agent ✅

**Complexity:** M | **Category:** frontend

Added `projectRoot` to `TaskMeta`. Comment chat uses document's actual project root via `resolveSandboxRoot()` (checks projects first, then explorer folders). Previously reverted alongside #1, re-applied in `cf47807`.

**Files:** `src/hooks/useAgentTaskOperations.ts`, `src/hooks/useCommentDelegation.ts`

---

### ~~3. Fix auto-approve bypassing write permission check~~ — ABANDONED

**Reason:** Originally planned to require user approval for write tools via PermissionCard. Abandoned because PermissionCard only renders in ChatPanel — delegation has no UI surface for approval. Instead, all tools are auto-approved and the sandbox (Seatbelt write restrictions + tool call path filtering) is the enforcement layer.

---

### 4. Explorer folder sandbox scope ✅

**Complexity:** S | **Category:** frontend

Resolved via `resolveSandboxRoot()` in task #2. Checks projects first, then explorer folders.

---

### 5. Comment-to-chat inherits project scope ✅

**Complexity:** L | **Category:** frontend

Chat agent tracks `sandboxScopeKey`, respawns when scope changes. `ChatPanel` detects `sourceCommentId` and passes restricted `projectPaths`. Path filtering wired into both primary and retry permission handlers in `useAcpLifecycle.ts`.

**Files:** `src/hooks/useAcpLifecycle.ts`, `src/components/chat/ChatPanel.tsx`

---

### 6. Create path filter utility ✅

**Complexity:** S | **Category:** frontend | **Dependencies:** None

Created `src/lib/ai/path-filter.ts` with 4 exported functions. 52 unit tests in `src/lib/ai/__tests__/path-filter.test.ts`.

**Files:** `src/lib/ai/path-filter.ts`, `src/lib/ai/__tests__/path-filter.test.ts`

---

### 7. Wire path filter into permission handlers ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #1, #2, #6

Wired `isToolCallAllowed` into permission handlers in both `useAgentTaskOperations.ts` (comment chat and background tasks) and `useAcpLifecycle.ts` (comment-to-chat conversations). Key fix: ACP sends `rawInput` as an object — now JSON.stringify'd before path extraction. Denied calls show in activity log (comment) and as system messages (chat).

**Files:** `src/hooks/useAgentTaskOperations.ts`, `src/hooks/useAcpLifecycle.ts`

---

### 8. Manual verification ✅

Tested on both local and iCloud projects:

- [x] Comment chat in Project A, ask agent to read file in Project B → denied
- [x] Comment chat in Project A, ask agent to read file in Project A → approved
- [x] Agent receives denial and responds sensibly
- [x] Agent completes normally (no hang) after denial
- [x] Regular chat → no filtering (by design)
- [x] `npx tsc --noEmit` passes
- [x] Works on iCloud projects

**Not yet tested:**

- [ ] Terminal command with absolute path to other project → denied
- [ ] Terminal command `git status` (no absolute paths) → approved
- [ ] Agent config path (~/.claude) → approved
- [ ] Comment moved to chat → filtering applied
- [ ] Activity panel shows denial entries (delegation mode)
