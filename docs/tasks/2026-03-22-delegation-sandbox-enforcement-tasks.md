# Delegation Sandbox Enforcement — Tasks

**PRD:** [delegation-sandbox-enforcement](../prds/2026-03-22-delegation-sandbox-enforcement.md)**Date:** 2026-03-22

## Summary

**6 tasks: 3S, 2M, 1L** — All frontend, no backend changes.

**Implementation order:** #1 → #2 → #3 → #4 → #5 → #6

**Risks:**

- Task #3 (auto-approve fix) changes delegation UX — write tools will now prompt for permission. Need to verify PermissionCard renders in the delegation/activity context, not just in ChatPanel.
- Task #5 (comment-to-chat) touches the chat agent lifecycle which is shared infrastructure. Must not regress regular (non-comment) chat behavior.

---

## Tasks

### 1. Add `projectRoot` to `TaskAgentState` and respawn on project change

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Description:**

Add `projectRoot` to `TaskAgentState` interface. In `ensureTaskAgent`, compare `cwd` against `taskAgent.projectRoot`. If different, stop and respawn the agent. Store `projectRoot` when creating the state.

Also add the `acp_agent_exists` health check to `ensureTaskAgent` (same pattern as the chat agent in `useAcpLifecycle.ts`) — the task agent has the same stale-reference problem after app restart.

**Acceptance criteria:**

- Agent respawns when `cwd` differs from previous spawn
- Agent reused when `cwd` matches (no unnecessary respawn)
- Stale agent reference detected and cleared

**Files:**

- Modify: `src/hooks/useAgentTaskOperations.ts`

---

### 2. Thread `projectRoot` from delegation to task agent

**Complexity:** M | **Category:** frontend | **Dependencies:** #1

**Description:**

The delegation call chain loses the document's `projectRoot`:

```
delegateComment(comment, documentId, projectRoot, mode)
  → startTask(prompt, callbacks, taskMeta)         // projectRoot not passed
    → startAcpTask(..., selectedProjectPaths)       // uses chat footer selection
      → ensureTaskAgent(connection, cwd)            // cwd = wrong project
```

Fix:

- Add `projectRoot?: string` to `TaskMeta` interface
- In `useCommentDelegation.delegateComment`, include `projectRoot` in the `taskMeta` object passed to `startTask`
- Same for `delegateReply`
- In `startAcpTask`, use `taskMeta?.projectRoot ?? selectedProjectPaths[0]` as `cwd`

Also investigate how `projectRoot` is resolved for explorer folder files — check the callers of `delegateComment` to see what value is passed for files not in a project. If it falls back to the explorer folder path, that's correct. If not, add a fallback.

**Acceptance criteria:**

- Delegation on a file in Project A uses Project A as sandbox scope, regardless of chat footer selection
- `delegateReply` also uses the correct project root
- Explorer folder files get their parent explorer folder as sandbox scope

**Files:**

- Modify: `src/hooks/useAgentTaskOperations.ts` (TaskMeta interface, startAcpTask)
- Modify: `src/hooks/useCommentDelegation.ts` (delegateComment, delegateReply)

---

### 3. Fix auto-approve bypassing write permission check

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Description:**

The permission handler in `startAcpTask` (lines 340-368) unconditionally auto-approves all tool calls on line 367-368, making the read-only check on line 344-364 dead code.

Fix: restructure into an if/else:

```typescript
if (readOnly.includes(toolKind)) {
  onActivity?.({ kind: 'permission', label: `Auto-approved: ${toolLabel}`, event: 'permission_auto_approved' });
  tauriApi.acpPermissionRespond(instanceId, payload.requestId, firstOptionId).catch(() => {});
} else {
  // Add to permission store for UI approval — do NOT auto-approve
  usePermissionStore.getState().addRequest({ ... });
  onActivity?.({ kind: 'permission', label: `Permission requested: ${toolLabel}`, event: 'tool_call' });
  // Response will come from PermissionCard when user clicks Allow/Deny
}
```

Also update `TaskActivityEvent.event` union type to include `'permission_requested'` if needed.

After this fix, verify that PermissionCard renders for delegation tasks. It currently renders in `ChatPanel.tsx` by reading `usePermissionStore.requests`. Check if delegation permission requests are visible there or if they need to surface in the activity panel.

**Acceptance criteria:**

- Read-only tools (read, glob, list, grep, fetch, web_search) are auto-approved
- Write tools show a PermissionCard and wait for user approval
- Tool kind detection covers the ACP tool kinds used by Claude Code (check `extractToolInfo` for the mapping)
- User can approve or deny write tools

**Files:**

- Modify: `src/hooks/useAgentTaskOperations.ts` (permission handler in startAcpTask)

---

### 4. Investigate explorer folder sandbox scope

**Complexity:** S | **Category:** frontend | **Dependencies:** #2

**Description:**

Trace what `projectRoot` value is passed to `delegateComment` for files opened from explorer folders (not projects). Check:

1. Where `delegateComment` is called — likely in `CommentPopover.tsx` or `useCommentOperations.ts`
2. How `projectRoot` is resolved for the active tab
3. Whether explorer folder files get the explorer folder path or something else (empty string, file path, undefined)

If the resolution is incorrect, fix it to use the parent explorer folder path. The explorer folders are available from `workspace-store.explorerFolders`.

**Acceptance criteria:**

- Files in explorer folders get the explorer folder root as sandbox scope
- No crash or empty sandbox when delegating on explorer folder files

**Files:**

- Investigate: callers of `delegateComment` (search for usage)
- Possibly modify: the caller that resolves `projectRoot`

---

### 5. Comment-to-chat inherits project scope

**Complexity:** L | **Category:** frontend | **Dependencies:** #1

**Description:**

When `moveToChat()` creates a conversation with `sourceCommentId`, the chat agent should be scoped to the source project only — not all workspace folders.

Changes needed:

**In** `useAcpLifecycle.ts`**:**

- `ensureAcpAgent` currently receives `sandboxPaths` from `acpSendChatMessage`. The caller passes `getAllWorkspacePaths()`.
- For comment-sourced conversations, the caller should pass only the conversation's `projectPaths` instead.
- The chat agent also needs to track what sandbox scope it was spawned with (like task agent after Fix 1). If a non-comment conversation uses the same agent, it needs to respawn with broader scope.

**In** `ChatPanel.tsx` **/** `acpSendChatMessage`**:**

- Detect if the active conversation has `sourceCommentId` set
- If so, pass the conversation's `projectPaths` as `sandboxPaths` instead of `getAllWorkspacePaths()`
- The existing project-switch prompt should still work — but note that widening the scope (adding another project) would require an agent respawn with a broader sandbox

**Chat agent state:**

- Add `sandboxScope` to `AcpAgentState` (similar to `projectRoot` in task agent)
- In `ensureAcpAgent`, compare current sandbox scope with stored scope
- If different, respawn

**Edge case:** User moves comment to chat, then changes project selection → the project switch card appears (existing behavior). If they choose "Start fresh" with a different project, the agent respawn is needed for the new sandbox scope. This should work automatically if `ensureAcpAgent` checks scope.

**Acceptance criteria:**

- Comment-to-chat conversation scoped to source project only
- Agent cannot list files in other projects from a comment-sourced chat
- Regular (non-comment) chat conversations still use all workspace folders
- Switching projects in a comment-sourced chat respawns agent with new scope
- No regression in chat agent lifecycle (health check, recovery, cancel)

**Files:**

- Modify: `src/hooks/useAcpLifecycle.ts` (ensureAcpAgent, AcpAgentState, sandbox scope tracking)
- Modify: `src/components/chat/ChatPanel.tsx` (detect sourceCommentId, pass scoped sandbox paths)

---

### 6. Manual verification of all quality gates

**Complexity:** M | **Category:** frontend | **Dependencies:** #1, #2, #3, #4, #5

**Description:**

Test each quality gate from the PRD manually:

 1. Delegate in Project A → agent can list Project A files
 2. Delegate in Project B (after A) → agent respawns, cannot list Project A files
 3. Delegate in Project A while chat footer shows Project B → scoped to A
 4. Write tool call in delegation → PermissionCard shown (not auto-approved)
 5. Read tool call in delegation → auto-approved
 6. Same project delegation → agent reused
 7. Explorer folder file → correct scope
 8. Move comment to chat → scoped to source project
 9. Move comment to chat → cannot list other project files
10. Regular chat → still works with all workspace folders
11. `npx tsc --noEmit` passes

**Acceptance criteria:**

- All 11 quality gates pass
- No regressions

**Files:**

- May need minor fixes based on test results