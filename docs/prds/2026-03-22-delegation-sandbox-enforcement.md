# Delegation Sandbox Enforcement

**Date:** 2026-03-22 **Status:** In Progress — soft enforcement done, tool call path filtering next

## Prior work

This PRD addresses gaps found during verification of previous sandboxing work:

| PRD | What it did | Gap found |
| --- | --- | --- |
| [agent-data-safety](2026-03-15-agent-data-safety.md) | Defined sandbox architecture: OS-level filesystem sandbox + chat context isolation. Specified delegation should be scoped to document's parent folder. | Quality gate "Delegation: agent cannot read files in other project folders" left unverified. |
| [network-sandboxing](2026-03-16-network-sandboxing.md) | Added HTTP proxy with per-agent domain allowlists, kernel-enforced network deny. | Network layer works. Filesystem layer has the bugs below. |
| [sandbox-hardening-macos](2026-03-21-sandbox-hardening-macos.md) | Hardened Seatbelt profiles, added `.git` read-only, blocked sensitive dirs. | Seatbelt profiles are correct — the problem is they're not applied to delegation agents. |
| [comment-delegation-modes](2026-03-03-comment-delegation-modes.md) | Added delegate/chat/reply modes for comments, multi-turn threads. | Delegation spawns task agents but doesn't scope them per-project. |
| [acp-session-recovery](2026-03-22-acp-session-recovery.md) | Added health check, auto-retry, friendly errors for dead agents. | Unrelated to sandbox, but revealed the delegation flow during investigation. |

## Problem

Delegation sandbox enforcement has three bugs that together mean **delegation has no effective filesystem isolation between projects**:

### Bug 1: Task agent reused across projects

`ensureTaskAgent()` in `useAgentTaskOperations.ts` reuses the task agent if the connection ID matches (line 79-90). It does not check whether the project has changed. A delegation in Project A spawns an agent sandboxed to Project A. A subsequent delegation in Project B reuses that same agent — which still has Project A's sandbox. Project B's agent can read Project A's files.

### Bug 2: `cwd` comes from chat selection, not document location

`startAcpTask()` sets `cwd = selectedProjectPaths[0]` (line 259) — the project selected in the **chat footer**, not the project containing the document being delegated. If the user has Project B selected in the chat footer but delegates a comment on a file in Project A, the agent gets Project B's sandbox scope. The document's actual project root is available as `projectRoot` in the delegation call chain but is not threaded through to `ensureTaskAgent`.

### Bug 3: Auto-approve bypasses permission check

The permission handler in `startAcpTask` (lines 344-368) has a read-only check that adds write tools to the permission store for UI approval. But line 367-368 **unconditionally auto-approves every request** regardless of the check result. The `addRequest` call on line 353 is dead code — the approval on line 368 fires immediately after.

## Goals

1. Task agent respawns when the project scope changes (different project = different sandbox).
2. Delegation uses the document's project root as `cwd`, not the chat footer selection.
3. Write tool permissions in delegation are actually enforced (not auto-approved).
4. Non-project files (explorer folders) get correct sandbox scope.
5. No performance regression — agent reuse within the same project is preserved.

## Non-Goals

- Changing the chat panel agent reuse policy (chat agents already cover all workspace folders by design).
- Adding per-file sandbox granularity (still directory-level).
- Changing network sandbox behavior (already working correctly).

## Technical Approach

### Fix 1: Track project root in task agent state

Add `projectRoot` to `TaskAgentState`. In `ensureTaskAgent`, compare `cwd` against the stored `projectRoot`. If different, stop the old agent and spawn a new one with the correct sandbox scope.

```typescript
interface TaskAgentState {
  instanceId: string;
  connectionId: string;
  projectRoot: string;   // NEW
  sessionId: string | null;
}

// In ensureTaskAgent:
if (taskAgent && (taskAgent.connectionId !== connection.id || taskAgent.projectRoot !== cwd)) {
  // Stop and respawn
}
```

### Fix 2: Thread document project root through delegation

The delegation call chain is:

```
useCommentDelegation.delegateComment(comment, documentId, projectRoot, mode)
  → startTask(prompt, callbacks, taskMeta)
    → startAcpTask(prompt, callbacks, taskMeta, connection, selectedProjectPaths)
      → ensureTaskAgent(connection, cwd)  // cwd = selectedProjectPaths[0]
```

`projectRoot` is available at the top (`delegateComment` receives it) but is lost by the time it reaches `startAcpTask`. Thread it through:

- Add `projectRoot?: string` to `TaskMeta`
- In `startAcpTask`, use `taskMeta.projectRoot ?? selectedProjectPaths[0]` as `cwd`
- `delegateComment` already passes `projectRoot` — just need to include it in `taskMeta`

For non-project files (explorer folders), the caller should pass the explorer folder path as `projectRoot`. Check how `useCommentDelegation` resolves `projectRoot` for explorer folder files.

### Fix 3: Fix auto-approve logic

The current code:

```typescript
// Lines 344-364: read-only check, adds write tools to permission store
if (!readOnly.includes(toolKind)) {
  usePermissionStore.getState().addRequest({ ... });
}

// Lines 366-368: ALWAYS auto-approves, regardless of the check above
onActivity?.({ kind: 'permission', label: `Auto-approved: ${toolLabel}`, ... });
tauriApi.acpPermissionRespond(instanceId, payload.requestId, firstOptionId).catch(() => {});
```

Fix: move the auto-approve into the read-only branch, and `return` after adding the permission request so write tools wait for user approval:

```typescript
if (readOnly.includes(toolKind)) {
  // Auto-approve read-only tools
  onActivity?.({ kind: 'permission', label: `Auto-approved: ${toolLabel}`, ... });
  tauriApi.acpPermissionRespond(instanceId, payload.requestId, firstOptionId).catch(() => {});
} else {
  // Write tools: require user approval via PermissionCard
  usePermissionStore.getState().addRequest({ ... });
  onActivity?.({ kind: 'permission', label: `Permission requested: ${toolLabel}`, ... });
}
```

Note: this changes delegation UX — write tool calls will now show permission cards in the activity panel. Need to verify the PermissionCard renders correctly in the delegation context (it currently only renders in ChatPanel).

### Fix 4: Explorer folder files

Files opened from explorer folders (not projects) don't have a `projectRoot` in the usual sense. Check how `useCommentDelegation` resolves this — if it falls back to a sensible path (the explorer folder root), it's fine. If it passes an empty string or the file path itself, the sandbox scope could be too narrow or wrong.

### Fix 5: Comment-to-chat inherits project scope

`moveToChat()` in `useCommentDelegation.ts` creates a new chat conversation with `projectPaths: [projectPath]` (line 401). This correctly sets the chat footer project selection. However, the chat panel agent (`useAcpLifecycle`) spawns with **all workspace folders** in its sandbox (by design — for instant project switching). This means a comment conversation moved to chat loses its per-project filesystem restriction.

When a conversation has `sourceCommentId` set, the chat agent should be scoped to the source document's project only — inheriting the delegation's sandbox restriction. This requires:

- In `useAcpLifecycle.ensureAcpAgent`, check if the active conversation has `sourceCommentId`
- If so, pass only the conversation's `projectPaths` as `sandboxPaths` instead of all workspace folders
- The agent must respawn if the sandbox scope differs from what it was spawned with (same pattern as Fix 1)
- If the user later changes the project selection in this conversation, the existing project switch prompt handles context isolation, but the sandbox would need to widen — show a warning that sandbox restrictions will change

## Files to modify

| File | Changes |
| --- | --- |
| `src/hooks/useAgentTaskOperations.ts` | Add `projectRoot` to `TaskAgentState`, check in `ensureTaskAgent`, fix auto-approve logic, accept `cwd` from `taskMeta` |
| `src/hooks/useCommentDelegation.ts` | Pass `projectRoot` in `taskMeta` |
| `src/hooks/useAgentTaskOperations.ts` (types) | Add `projectRoot` to `TaskMeta` interface |
| `src/hooks/useAcpLifecycle.ts` | Detect comment-sourced conversations, scope sandbox to source project |
| `src/components/chat/ChatPanel.tsx` | Thread `sourceCommentId` / conversation metadata to agent lifecycle |

## Quality Gates

- [ ] Delegate comment in Project A → agent can list files in Project A

- [ ] Delegate comment in Project B (after Project A) → agent respawns, cannot list files in Project A

- [ ] Delegate comment on file in Project A while chat footer shows Project B → agent scoped to Project A (not B)

- [ ] Write tool calls in delegation show permission card (not auto-approved)

- [ ] Read tool calls in delegation are still auto-approved

- [ ] Agent reused within same project (no unnecessary respawn)

- [ ] Explorer folder files get correct sandbox scope

- [ ] Move comment to chat → chat agent scoped to comment's project (not all workspace folders)

- [ ] Move comment to chat → agent cannot list files in other projects

- [ ] `npx tsc --noEmit` passes

- [ ] No regression in regular chat panel agent behavior (non-comment conversations)

## Implementation status

### Implemented (soft enforcement)

- **Bug 1 fixed**: Task agent tracks `projectRoot`, respawns when project changes
- **Bug 2 fixed**: Delegation uses document's actual project root via `resolveSandboxRoot()`, not chat footer selection
- **Bug 3 fixed**: Auto-approve all tools in delegation (sandbox is enforcement, not permissions)
- **Fix 4 done**: Explorer folder files resolved via `resolveSandboxRoot()` (checks projects, then explorer folders)
- **Fix 5 done**: Comment-to-chat conversations inherit project scope via `sandboxScopeKey` tracking
- **Scope instruction**: Agent system message tells the agent to stay within the project folder
- **CLAUDECODE env fix**: Strip env var to prevent nested session detection when launched from Claude Code

### Seatbelt read restrictions — attempted and abandoned

Replacing `(allow file-read*)` with selective reads caused agents to crash — they need access to hundreds of system paths (dyld cache, Node.js internals, `realpathSync` parent directory traversal for iCloud paths, etc.). Each fix revealed another missing path. Seatbelt is designed to sandbox entire apps, not isolate project folders within a process that needs broad system access.

### Next: Tool call path filtering

**Threat model:** Prevent accidental leakage from a well-behaved agent. Not defending against prompt injection or deliberate circumvention.

ACP agents request permission for every tool call. The agent **waits** for our response before executing. We currently auto-approve everything. By parsing the target paths from tool call inputs and checking them against the project root, we get enforcement at the protocol layer — no OS-level filesystem tricks needed.

#### Path extraction

**Structured tool calls** (Read, Write, Glob, Grep, etc.): Parse `rawInput` as JSON. Extract `file_path`, `path`, `directory` fields. Well-defined — 100% reliable.

**Terminal/Bash commands**: Scan for absolute paths in the command string. Regex-based, catches direct path references like `ls "/other-project"`. Misses dynamic construction (`$(echo /path)`) and relative traversal (`cd ..`), which is acceptable for this threat model.

#### Path validation

```typescript
function isPathAllowed(path: string, projectRoot: string): boolean {
  // Within the project → allowed
  if (path === projectRoot || path.startsWith(projectRoot + '/')) return true;

  // System paths → allowed
  const systemPrefixes = ['/tmp', '/private/tmp', '/private/var', '/dev',
    '/usr', '/bin', '/sbin', '/opt', '/etc', '/private/etc',
    '/System', '/Library', '/Applications', '/var'];
  if (systemPrefixes.some(p => path.startsWith(p))) return true;

  // Agent config dirs → allowed
  const safeHomeDirs = ['.claude', '.codex', '.copilot', '.gemini', '.notesage',
    '.config', '.npm', '.nvm', '.volta', '.fnm', '.local', '.cargo', '.rustup'];
  if (safeHomeDirs.some(d => path.startsWith(home + '/' + d))) return true;

  // Everything else → denied
  return false;
}
```

#### Deny response

Send `null` as `optionId` (deny). Log the denial. Add activity entry: "Denied: {tool} — outside project scope". The agent receives the denial and can explain to the user.

#### Scope

| Context | Filtered? | Allowed paths |
| --- | --- | --- |
| Delegation (comment thread, activity strip) | Yes | Document's project folder only |
| Comment moved to chat panel | Yes | Source project (widens if user changes project selector) |
| Regular chat panel | No | All workspace folders |

#### Files to modify

| File | Changes |
| --- | --- |
| `src/lib/ai/path-filter.ts` | New: `isToolCallAllowed`, `extractPaths`, `isPathAllowed` |
| `src/hooks/useAgentTaskOperations.ts` | Use path filter in permission handler |
| `src/hooks/useAcpLifecycle.ts` | Add path filtering for comment-to-chat conversations |

#### Quality gates for path filtering

- [ ] Structured tool call (Read) targeting other project → denied

- [ ] Structured tool call (Read) targeting current project → approved

- [ ] Terminal command with absolute path to other project → denied

- [ ] Terminal command with absolute path to system dir → approved

- [ ] Terminal command with no absolute paths (e.g., `git status`) → approved

- [ ] Agent config path (\~/.claude) → approved

- [ ] Regular chat panel → no filtering

- [ ] Comment-to-chat → filtering applied

- [ ] Denied tool call shows activity entry

- [ ] `npx tsc --noEmit` passes

#### Not covered (acceptable gaps for this threat model)

- Relative path traversal (`cd ../other-project`)
- Script content analysis (paths inside written scripts)
- Dynamic path construction (`$(echo /other/path)`)
- Eval-based file access (`node -e "fs.readFileSync(...)"`)

## Out of Scope / Future Work

- **Container-based isolation**: Use a container runtime (e.g., [sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)) to create a fully isolated filesystem where only the project folder is mounted. Hard read/write isolation without path enumeration. Requires Docker on macOS (heavy) or Bubblewrap on Linux (lightweight). Significant architecture work.
- PermissionCard rendering in delegation activity panel
- Batch delegation sandbox (all comments in one document share one agent — already correct)
- Windows/Linux sandbox enforcement
- Widening sandbox scope when user changes project selection in a comment-sourced chat