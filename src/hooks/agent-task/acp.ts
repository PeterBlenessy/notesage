// ---------------------------------------------------------------------------
// ACP task backend (agent_managed connections).
//
// Runs a background task through the shared delegation agent's ACP session:
// ensure-agent + session restore happen BEFORE the task is registered (a
// failure there propagates without creating a task entry), then the strategy
// wires `acp-session-update` / `acp-permission-request` listeners and sends
// the prompt.
// ---------------------------------------------------------------------------

import { listen } from '@tauri-apps/api/event';
import { useChatStore } from '@/stores/chat-store';
import { useActivityStore } from '@/stores/activity-store';
import type { Connection } from '@/lib/ai/connections';
import { tauriApi } from '@/lib/tauri';
import { formatAcpToolName, truncateDetail, normalizeToolCallContent, hasSessionCapability, formatResourceLinkAsMarkdown } from '@/lib/ai/acp-utils';
import type { AcpSessionUpdatePayload, AcpPermissionRequestPayload, AcpAgentCapabilities } from '@/lib/ai/acp-utils';
import { restoreOrCreateAcpSession } from '@/lib/ai/acp-session-restore';
import { buildAcpMcpServerInputs } from '@/lib/ai/acp-mcp';
import { ensureAcpAgent, getAcpAgent, stopAcpAgent, TASK_AGENT_KEY } from '@/lib/ai/acp-agent-state';
import { isToolCallAllowed } from '@/lib/ai/path-filter';
import { log } from '@/lib/logger';
import { agentTaskRegistry } from './task-registry';
import { runAgentTask, type TaskCallbacks, type TaskMeta } from './run-task';
import { getHomeDir } from './home-dir';

// ---------------------------------------------------------------------------
// Task agent — the background comment-delegation agent.
//
// Only one delegation agent runs at a time. After the singleton → registry
// migration (PRD `2026-06-14-command-bar-session-multitasking`, task #2) it is
// no longer a standalone module global: it lives in the shared ACP agent
// registry (`acp-agent-state.ts`) under the reserved {@link TASK_AGENT_KEY},
// spawned with `role: 'task'`. This unifies spawn/respawn/liveness/teardown with
// the chat agents — `getAllAcpAgents()` now sees the task agent too, and the
// per-key spawn-promise guard / scope-respawn / `acp_agent_exists` liveness
// check come from the registry instead of a parallel implementation here.
// ---------------------------------------------------------------------------

/** Read the delegation agent's advertised capabilities (or null when not spawned). */
export function taskCapabilities(): AcpAgentCapabilities | null {
  return (getAcpAgent(TASK_AGENT_KEY)?.capabilities ?? null) as AcpAgentCapabilities | null;
}

export function stopTaskAgent(): void {
  stopAcpAgent(TASK_AGENT_KEY);
}

/** Maximum recursion depth for ensureTaskAgent to prevent infinite loops. */
const MAX_ENSURE_AGENT_DEPTH = 3;

/**
 * Ensure the shared delegation agent is spawned for `connection` + `cwd`, tracked
 * in the registry under {@link TASK_AGENT_KEY}. Thin wrapper over the registry's
 * `ensureAcpAgent` (with `role: 'task'`); the registry owns the spawn-promise
 * guard, sandbox-scope respawn, and liveness check.
 *
 * @internal Exported for testing only.
 * @param _depth Internal recursion counter — callers should not set this.
 */
export async function ensureTaskAgent(connection: Connection, cwd: string, sandboxPaths?: string[], _depth = 0): Promise<string> {
  if (_depth > MAX_ENSURE_AGENT_DEPTH) {
    throw new Error('Task agent spawn failed after multiple retries.');
  }
  // Delegation sandboxes to the task's single project folder. Passing it as the
  // scope makes the registry's `sandboxScopeKey` track the project, so a switch to
  // a different delegation project respawns — matching the old projectRoot check.
  const scopePaths = sandboxPaths ?? (cwd !== '/tmp' ? [cwd] : []);
  return ensureAcpAgent(connection, cwd, scopePaths, 'task', {
    conversationId: TASK_AGENT_KEY,
    role: 'task',
    depth: _depth,
  });
}

// ---------------------------------------------------------------------------
// ACP task flow
// ---------------------------------------------------------------------------

export async function startAcpTask(
  prompt: string,
  callbacks: TaskCallbacks | undefined,
  taskMeta: TaskMeta | undefined,
  connection: Connection,
  selectedProjectPaths: string[],
): Promise<string> {
  // Use explicit projectRoot from taskMeta (delegation/chat), fall back to chat selection
  const cwd = taskMeta?.projectRoot ?? (selectedProjectPaths[0] || '/tmp');
  const instanceId = await ensureTaskAgent(connection, cwd);

  // Look up prior session ID from the active conversation (task conversations use the
  // same chat-store). Use `restoreOrCreateAcpSession` so reopening a delegated comment
  // restores the agent-side context via resume/load when capabilities allow.
  const chatState = useChatStore.getState();
  const activeConversationId = chatState.activeConversationId;
  const activeConv = activeConversationId
    ? chatState.conversations.find((c) => c.id === activeConversationId)
    : undefined;
  const storedSessionId = activeConv?.acpSessionId;

  // Scope MCP servers to the task's project (explicit projectRoot when set, else
  // the chat selection) so a delegated task gets the same enabled, capability-
  // gated servers the interactive chat would (task #11).
  const mcpScopePaths = taskMeta?.projectRoot ? [taskMeta.projectRoot] : selectedProjectPaths;
  const session = await restoreOrCreateAcpSession({
    instanceId,
    cwd,
    storedSessionId,
    capabilities: taskCapabilities(),
    mcpServers: buildAcpMcpServerInputs(taskCapabilities(), mcpScopePaths),
  });

  // Persist the (possibly new) session ID back onto the conversation so a subsequent
  // reopen can attempt resume/load again.
  if (activeConversationId) {
    useChatStore.getState().setSegmentSessionId(session.session_id);
  }

  return runAgentTask({ prompt, callbacks, taskMeta, connection }, {
    name: 'acp',
    run: async (handle) => {
      const { taskId, task, track } = handle;
      const { onActivity, onChunk } = handle.callbacks;
      task.instanceId = instanceId;
      task.sessionId = session.session_id;

      /** Fire a best-effort `session/close` when the task reaches a terminal state. */
      const closeSessionIfSupported = () => {
        if (hasSessionCapability(taskCapabilities(), 'close')) {
          tauriApi.acpSessionClose(instanceId, session.session_id).catch(() => {}); // Expected: best-effort cleanup
        }
      };

      // Listen for session updates
      let receivedFirstChunk = false;
      const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        if (event.payload.sessionId !== session.session_id) return;
        const { update } = event.payload;

        const current = agentTaskRegistry.getTask(taskId);
        if (!current) return;

        const eventType = update.sessionUpdate;
        // `content` is a single ContentBlock for *_chunk events and an array for tool_call_update.
        const chunkContent = Array.isArray(update.content) ? undefined : update.content;

        if (
          eventType === 'agent_message_chunk' &&
          chunkContent?.type === 'text' &&
          chunkContent.text
        ) {
          if (!receivedFirstChunk) {
            receivedFirstChunk = true;
            onActivity?.({ kind: 'agent_responding', label: 'Agent responding', event: 'agent_responding' });
          }
          current.output += chunkContent.text;
          onChunk?.(chunkContent.text);
          if (track) useActivityStore.getState().appendPartialOutput(taskId, chunkContent.text);
        } else if (
          eventType === 'agent_message_chunk' &&
          chunkContent?.type === 'resource_link' &&
          chunkContent.uri
        ) {
          // Render resource_link inline as a markdown link (same treatment as chat path).
          const markdown = formatResourceLinkAsMarkdown(chunkContent);
          if (markdown) {
            if (!receivedFirstChunk) {
              receivedFirstChunk = true;
              onActivity?.({ kind: 'agent_responding', label: 'Agent responding', event: 'agent_responding' });
            }
            current.output += markdown;
            onChunk?.(markdown);
            if (track) useActivityStore.getState().appendPartialOutput(taskId, markdown);
          }
        } else if (eventType === 'agent_thought_chunk') {
          const text = chunkContent?.text;
          if (text && track) {
            useActivityStore.getState().appendThinkingOutput(taskId, text);
          }
        } else if (eventType === 'tool_call') {
          const label = formatAcpToolName(update.kind, update.title);
          const detail = truncateDetail(update.rawInput, 200);
          onActivity?.({ kind: update.kind || 'unknown', label, detail: detail || undefined, event: 'tool_call' });
          if (track) {
            // Optimistic `approvalMode: 'auto'`. Task-delegation flow auto-approves
            // every tool call (the comment is a one-shot delegation — no interactive
            // permission prompts). Path-filter denials below patch it to 'denied'.
            useActivityStore.getState().appendActivity(taskId, {
              label,
              detail: detail || undefined,
              status: 'running',
              timestamp: Date.now(),
              approvalMode: 'auto',
            });
          }
        } else if (eventType === 'tool_call_update') {
          const label = formatAcpToolName(update.kind, update.title);
          onActivity?.({ kind: update.kind || 'unknown', label, event: 'tool_call' });
          // Rich content (diff / text / terminal). Per ACP spec this is a full
          // replacement — attach to the most recent tool-call activity so the
          // activity panel can render inline diffs.
          if (Array.isArray(update.content) && track) {
            const content = normalizeToolCallContent(update.content);
            if (content.length > 0) {
              useActivityStore.getState().setLastActivityContent(taskId, content);
            }
          }
        } else if (eventType === 'tool_result') {
          onActivity?.({ kind: 'tool_result', label: 'Tool result', event: 'tool_result' });
          if (track) useActivityStore.getState().completeLastActivity(taskId);
        } else if (eventType === 'agent_turn_complete') {
          if (handle.complete({ notify: true })) {
            closeSessionIfSupported();
            handle.runCleanup();
          }
        } else if (eventType === 'user_message_chunk') {
          // Agent echoes user message as received — we already have it locally.
          // Recognize explicitly to suppress the "Unknown session update" debug log.
        } else if (eventType) {
          // Unknown session update type — log for debugging, don't crash
          log.debug('ai', `Unknown ACP task session update type: ${eventType}`);
        }
      });

      // Resolve home dir once for path filtering in this task
      const homeDir = await getHomeDir();

      const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        const payload = event.payload;
        const rawOptions = payload.options;
        let firstOptionId: string | null = null;
        if (Array.isArray(rawOptions) && rawOptions.length > 0) {
          const opt = rawOptions[0];
          firstOptionId = String(opt?.optionId ?? opt?.id ?? '');
        }

        const tc = payload.toolCall;
        const toolKind = String(tc?.kind ?? tc?.type ?? 'unknown');
        const toolLabel = String(tc?.title ?? tc?.name ?? toolKind);
        const rawInput = typeof tc?.rawInput === 'string' ? tc.rawInput : JSON.stringify(tc?.rawInput ?? '');

        // Path filtering: deny tool calls targeting paths outside the project
        if (cwd && cwd !== '/tmp') {
          const result = isToolCallAllowed(toolKind, rawInput, cwd, homeDir);
          if (!result.allowed) {
            log.info('ai', `Tool call denied: ${toolLabel} targets ${result.deniedPath} outside project ${cwd}`);
            onActivity?.({ kind: 'denied', label: `Denied: ${toolLabel} — outside project scope`, detail: result.deniedPath, event: 'tool_denied' });
            if (track) {
              useActivityStore.getState().appendActivity(taskId, {
                label: `Denied: ${toolLabel} — outside project scope`,
                detail: result.deniedPath,
                status: 'error',
                timestamp: Date.now(),
                approvalMode: 'denied',
              });
            }
            tauriApi.acpPermissionRespond(instanceId, payload.requestId, null).catch(() => {}); // Expected: fire-and-forget permission deny
            return;
          }
        }

        // Auto-approve — sandbox is the enforcement layer
        onActivity?.({ kind: 'permission', label: `Auto-approved: ${toolLabel}`, event: 'permission_auto_approved' });
        tauriApi.acpPermissionRespond(instanceId, payload.requestId, firstOptionId).catch(() => {}); // Expected: fire-and-forget permission approve
      });

      handle.registerCleanup(() => { unlisten(); unlistenPermission(); });

      tauriApi.acpSessionPrompt(instanceId, session.session_id, prompt)
        .then(() => {
          const t = agentTaskRegistry.getTask(taskId);
          if (t && t.status === 'running') {
            handle.complete({ notify: true });
          }
        })
        .catch((error) => {
          const t = agentTaskRegistry.getTask(taskId);
          if (!t) return;
          handle.fail(error, { notify: true, completeActivities: true, recordError: true });
          closeSessionIfSupported();
        })
        .finally(() => {
          handle.runCleanup();
        });
    },
  });
}
