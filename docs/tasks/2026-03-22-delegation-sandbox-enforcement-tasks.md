# Delegation Sandbox Enforcement — Tasks

**PRD:** [delegation-sandbox-enforcement](../prds/2026-03-22-delegation-sandbox-enforcement.md)
**Date:** 2026-03-22

## Summary

**7 tasks: 3 done, 1 abandoned, 3 remaining (1S, 1M, 1M)**

**Implementation order:** #1 ✅ → #2 ✅ → #3 ~~abandoned~~ → #4 ✅ → #5 ✅ → #6 (new) → #7 (new) → #8 (verification)

---

## Completed Tasks

### 1. Add `projectRoot` to `TaskAgentState` and respawn on project change ✅

**Complexity:** S | **Category:** frontend

Task agent tracks `projectRoot`, respawns when project changes. Added `acp_agent_exists` health check.

**Files:** `src/hooks/useAgentTaskOperations.ts`

---

### 2. Thread `projectRoot` from delegation to task agent ✅

**Complexity:** M | **Category:** frontend

Added `projectRoot` to `TaskMeta`. Delegation uses document's actual project root via `resolveSandboxRoot()`. Explorer folder files resolved by checking projects then explorer folders.

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

Chat agent tracks `sandboxScopeKey`, respawns when scope changes. `ChatPanel` detects `sourceCommentId` and passes restricted `projectPaths`.

**Files:** `src/hooks/useAcpLifecycle.ts`, `src/components/chat/ChatPanel.tsx`

---

## Remaining Tasks

### 6. Create path filter utility

**Complexity:** S | **Category:** frontend | **Dependencies:** None

Create `src/lib/ai/path-filter.ts` with:

- `extractPathsFromStructuredInput(rawInput: string): string[]` — parse JSON tool input for `file_path`, `path`, `directory`, `cwd`, `paths` fields
- `extractAbsolutePathsFromCommand(command: string): string[]` — regex scan for absolute paths in shell commands
- `isPathAllowed(path: string, projectRoot: string, homeDir: string): boolean` — check against project root, system prefixes, agent config dirs
- `isToolCallAllowed(toolKind: string, rawInput: string, projectRoot: string): { allowed: boolean; deniedPath?: string }` — combines extraction + validation based on tool kind

**Acceptance criteria:**
- Structured input: extracts paths from JSON fields
- Terminal commands: finds `/absolute/paths` in command strings
- System paths (`/usr`, `/tmp`, `/opt`, etc.) always allowed
- Agent config paths (`~/.claude`, `~/.config`, etc.) always allowed
- Project root and children always allowed
- Other user paths denied, with the denied path returned for logging

**Files:**
- Create: `src/lib/ai/path-filter.ts`

---

### 7. Wire path filter into permission handlers

**Complexity:** M | **Category:** frontend | **Dependencies:** #6

**In `useAgentTaskOperations.ts`:**

Replace the unconditional auto-approve in the permission handler with path-filtered logic:

```typescript
const cwd = ...; // already available from startAcpTask
const rawInput = String(tc?.rawInput ?? '');

if (cwd && cwd !== '/tmp') {
  const result = isToolCallAllowed(toolKind, rawInput, cwd);
  if (!result.allowed) {
    log.info('ai', `Tool call denied: ${toolLabel} targets ${result.deniedPath} outside project ${cwd}`);
    onActivity?.({ kind: 'denied', label: `Denied: ${toolLabel} — outside project scope`, event: 'tool_call' });
    tauriApi.acpPermissionRespond(instanceId, payload.requestId, null).catch(() => {});
    return;
  }
}
// Auto-approve
onActivity?.({ kind: 'permission', label: `Auto-approved: ${toolLabel}`, event: 'permission_auto_approved' });
tauriApi.acpPermissionRespond(instanceId, payload.requestId, firstOptionId).catch(() => {});
```

**In `useAcpLifecycle.ts`:**

For comment-to-chat conversations (where `sandboxPaths` is set), apply the same path filtering in the chat panel's permission handler. Need to thread the project root to the permission handler scope.

**Acceptance criteria:**
- Delegation: tool call to other project → denied with activity entry
- Delegation: tool call within project → auto-approved
- Delegation: system path tool call → auto-approved
- Comment-to-chat: same filtering applied
- Regular chat: no filtering (no project root restriction)
- Denied tool calls logged at info level

**Files:**
- Modify: `src/hooks/useAgentTaskOperations.ts`
- Modify: `src/hooks/useAcpLifecycle.ts`

---

### 8. Manual verification

**Complexity:** M | **Category:** frontend | **Dependencies:** #6, #7

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
