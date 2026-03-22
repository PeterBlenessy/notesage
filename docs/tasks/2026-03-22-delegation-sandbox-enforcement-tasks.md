# Delegation Sandbox Enforcement — Tasks

**PRD:** [delegation-sandbox-enforcement ](../prds/2026-03-22-delegation-sandbox-enforcement.md)**Date:** 2026-03-22

## Summary

**8 tasks: 2 done, 1 abandoned, 5 remaining**

**Implementation order:** #1 → #2 → #3 ~~abandoned~~ → #4 → #5 → #6 ✅ → #7 → #8 (verification)

---

## Completed Tasks

### ~~3. Fix auto-approve bypassing write permission check~~ — ABANDONED

**Reason:** Originally planned to require user approval for write tools via PermissionCard. Abandoned because PermissionCard only renders in ChatPanel — delegation has no UI surface for approval. Instead, all tools are auto-approved and the sandbox (Seatbelt write restrictions + tool call path filtering) is the enforcement layer.

---

### 6. Create path filter utility ✅

**Complexity:** S | **Category:** frontend | **Dependencies:** None

Created `src/lib/ai/path-filter.ts` with 4 exported functions. 52 unit tests in `src/lib/ai/__tests__/path-filter.test.ts`.

**Files:** `src/lib/ai/path-filter.ts`, `src/lib/ai/__tests__/path-filter.test.ts`

---

## Reverted Tasks (were implemented, then reverted in `0a11c2e` — caused agent hang)

These were implemented and marked done, but reverted because they caused the comment chat/delegation to hang. Root cause was initially thought to be the scope instruction (removed in `b21a813`), but the hang persists even without it. **Root cause still TBD.**

### 1. Add `projectRoot` to `TaskAgentState` and respawn on project change — REVERTED

**Complexity:** S | **Category:** frontend

Added `projectRoot` to `TaskAgentState`, respawn when project changes. Reverted because delegation hangs when these changes are applied.

**Files:** `src/hooks/useAgentTaskOperations.ts`

---

### 2. Thread `projectRoot` from delegation to task agent — REVERTED

**Complexity:** M | **Category:** frontend

Added `projectRoot` to `TaskMeta`, `resolveSandboxRoot()` in `useCommentDelegation.ts`. Reverted alongside #1.

**Files:** `src/hooks/useAgentTaskOperations.ts`, `src/hooks/useCommentDelegation.ts`

---

### 4. Explorer folder sandbox scope — REVERTED

**Complexity:** S | **Category:** frontend

Was resolved via `resolveSandboxRoot()` in task #2. Reverted alongside #1/#2.

---

### 5. Comment-to-chat inherits project scope — UNVERIFIED

**Complexity:** L | **Category:** frontend

Chat agent tracks `sandboxScopeKey`, respawns when scope changes. `ChatPanel` detects `sourceCommentId` and passes restricted `projectPaths`. This code is still in the codebase (was NOT reverted) but has never been verified to work because the delegation side (#1/#2) isn't wired.

**Files:** `src/hooks/useAcpLifecycle.ts`, `src/components/chat/ChatPanel.tsx`

---

## Remaining Tasks

### 7. Wire path filter into permission handlers

**Complexity:** M | **Category:** frontend | **Dependencies:** #1, #2, #6

**Blocked by:** Tasks #1/#2 must be re-applied first. The path filter checks `cwd` which currently comes from the chat footer selection (wrong). When #1/#2 are applied, `cwd` comes from the document's actual project root (correct), and the path filter can enforce boundaries.

The path filter code (`src/lib/ai/path-filter.ts`) is ready. The wiring was written but reverted along with #1/#2 because they share the same files and the hang makes them untestable.

**What needs to happen:**

1. Investigate and fix the root cause of the agent hang when #1/#2 are applied
2. Re-apply #1/#2 with the fix
3. Re-apply the path filter wiring (import `isToolCallAllowed`, add to permission handlers)

**Files:**

- Modify: `src/hooks/useAgentTaskOperations.ts`
- Modify: `src/hooks/useAcpLifecycle.ts`
- Modify: `src/hooks/useCommentDelegation.ts`

---

### 8. Manual verification

**Complexity:** M | **Category:** frontend | **Dependencies:** #1, #2, #7

Test each quality gate from the PRD:

 1. Delegate in Project A, ask agent to read file in Project B → denied
 2. Delegate in Project A, ask agent to read file in Project A → approved
 3. Terminal command with absolute path to other project → denied
 4. Terminal command `git status` (no absolute paths) → approved
 5. Terminal command referencing `/usr/bin/...` → approved
 6. Agent config path `~/.claude/...` → approved
 7. Regular chat → no filtering
 8. Comment moved to chat → filtering applied
 9. Activity panel shows denial entries
10. `npx tsc --noEmit` passes

**Files:**

- May need minor fixes based on test results