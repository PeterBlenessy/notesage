// ---------------------------------------------------------------------------
// Copilot LSP task backend (agent_managed connections with
// copilot-language-server).
//
// Runs a background task through a `conversation/create` round: streaming +
// progress arrive as `copilot-chat-*` Tauri events; tool calls / confirmations
// / context requests are answered inline (headless context).
//
// Tools: a background task has nobody to ask, so it runs only what the user
// has ALREADY allowed (the same tiers chat consults: built-in read-only tools,
// "always allow" and "allow for this session"). Anything that would show a
// permission card in chat is denied here. Unlike an ACP agent, these tools
// run in the app's own process, not inside the sandbox.
// ---------------------------------------------------------------------------

import { listen } from '@tauri-apps/api/event';
import { useRoutingStore } from '@/stores/routing-store';
import { useActivityStore } from '@/stores/activity-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Connection } from '@/lib/ai/connections';
import { tauriApi } from '@/lib/tauri';
import { mapCopilotProgressStatus, type CopilotStepPayload, type CopilotToolUpdatePayload } from '@/lib/ai/copilot-progress';
import {
  openCopilotStream,
  closeCopilotStream,
  ownsCopilotProgress,
  ownsCopilotRequest,
  type CopilotStream,
} from '@/lib/ai/copilot-correlation';
import { agentTaskRegistry } from './task-registry';
import { runAgentTask, type TaskCallbacks, type TaskMeta } from './run-task';
import { getHomeDir } from './home-dir';

/** What every `$/progress`-derived event carries (see copilot-correlation.ts). */
interface CopilotProgressKey {
  token?: string;
  conversationId?: string;
}

/** Running Copilot tasks → their stream, so a cancel can reach the LSP. */
const runningTasks = new Map<string, { stream: CopilotStream; destroyed: boolean }>();

/**
 * Stop a running Copilot task's LSP conversation. Destroying the conversation
 * is what stops the server generating; without it "Cancel" only stopped the
 * frontend listening. Returns false when `taskId` is not a running Copilot
 * task. If the conversation id is not known yet, the conversation is
 * destroyed as soon as `conversation/create` returns it.
 */
export async function cancelCopilotLspTask(taskId: string): Promise<boolean> {
  const running = runningTasks.get(taskId);
  if (!running) return false;
  const conversationId = running.stream.conversationId;
  if (conversationId && !running.destroyed) {
    running.destroyed = true;
    await tauriApi.copilotLspConversationDestroy(conversationId).catch(() => {});
  }
  return true;
}

/**
 * May a background task run this tool without asking? Same tiers as chat
 * (`useDirectApiChat`), scoped to the task's connection and project. `false`
 * is what chat would turn into a permission card.
 */
function isToolPreApproved(name: string, connectionId: string, projectRoot: string | null): boolean {
  // "Confirm every tool call" means a person decides each time; a background
  // task has no one to ask.
  if (useSettingsStore.getState().requireAllToolConfirmations) return false;
  return usePermissionStore.getState().isToolAllowed(name, connectionId, projectRoot) !== 'none';
}

export async function startCopilotLspTask(
  prompt: string,
  callbacks: TaskCallbacks | undefined,
  taskMeta: TaskMeta | undefined,
  connection: Connection,
): Promise<string> {
  return runAgentTask({ prompt, callbacks, taskMeta, connection }, {
    name: 'copilot-lsp',
    run: async (handle) => {
      const { taskId, track } = handle;
      const { onActivity, onChunk } = handle.callbacks;

      // Routing store model takes priority, then connection config model.
      // Both now store correct copilot/models IDs (the connection config
      // dialog fetches from copilot/models for LSP connections).
      const model = useRoutingStore.getState().routing.agent_tasks?.model ?? connection.config?.model;

      // Correlation: progress events carry the token generated here and sent
      // as the request's workDoneToken; tool calls / confirmations / context
      // requests carry the conversation id, learned from this stream's own
      // first progress event. Events naming neither are not ours unless this
      // is the only Copilot stream running (see copilot-correlation.ts).
      const stream = openCopilotStream();
      const running = { stream, destroyed: false };
      runningTasks.set(taskId, running);
      const isOurProgress = (payload: CopilotProgressKey): boolean => ownsCopilotProgress(stream, payload);
      const isOurRequest = (payload: { conversationId?: string }): boolean => ownsCopilotRequest(stream, payload);
      const projectRoot = taskMeta?.projectRoot ?? null;

      // Binds the stream to its conversation id before the first tool call.
      const unlistenBegin = await listen<CopilotProgressKey>('copilot-chat-begin', (event) => {
        isOurProgress(event.payload);
      });

      // Listen for streaming events
      const unlistenChunk = await listen<CopilotProgressKey & { text: string }>('copilot-chat-chunk', (event) => {
        if (!isOurProgress(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;
        current.output += event.payload.text;
        onChunk?.(event.payload.text);
        if (track) useActivityStore.getState().appendPartialOutput(taskId, event.payload.text);
      });

      const unlistenThinking = await listen<CopilotProgressKey & { text: string }>('copilot-chat-thinking', (event) => {
        if (!isOurProgress(event.payload)) return;
        // Thinking events logged but not appended to output
      });

      const unlistenDone = await listen<CopilotProgressKey & { error?: unknown }>('copilot-chat-done', async (event) => {
        if (!isOurProgress(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;

        // Destroy the conversation
        if (event.payload.conversationId && !running.destroyed) {
          running.destroyed = true;
          tauriApi.copilotLspConversationDestroy(event.payload.conversationId).catch(() => {});
        }

        if (event.payload.error) {
          const errMsg = typeof event.payload.error === 'object' && event.payload.error !== null
            ? (event.payload.error as Record<string, unknown>).message as string ?? 'Unknown error'
            : String(event.payload.error);
          handle.fail(errMsg);
        } else {
          handle.complete();
        }

        handle.runCleanup();
      });

      // Intermediate progress: $/progress steps and server-side agent-round tool
      // calls. The LSP re-emits the full arrays on every report, so dedupe by
      // (id, status) and only surface actual transitions as activity entries.
      const seenSteps = new Set<string>();
      const unlistenStep = await listen<CopilotStepPayload & CopilotProgressKey>('copilot-chat-step', (event) => {
        if (!isOurProgress(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;
        const { stepId, title, status } = event.payload;
        const id = stepId ?? title ?? '';
        if (!id) return;
        const key = `${id}:${mapCopilotProgressStatus(status)}`;
        if (seenSteps.has(key)) return;
        seenSteps.add(key);
        const label = (title ?? '').trim() || 'Working…';
        onActivity?.({ kind: 'step', label, detail: status ?? undefined, event: 'tool_call' });
      });

      const seenToolUpdates = new Set<string>();
      const unlistenToolUpdate = await listen<CopilotToolUpdatePayload & CopilotProgressKey>('copilot-chat-tool-update', (event) => {
        if (!isOurProgress(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;
        const p = event.payload;
        if (!p.toolCallId) return;
        const status = p.error != null ? 'error' : mapCopilotProgressStatus(p.status);
        const key = `${p.toolCallId}:${status}`;
        if (seenToolUpdates.has(key)) return;
        seenToolUpdates.add(key);
        const name = (p.name ?? '').trim() || 'tool';
        const detail = typeof p.progressMessage === 'string' && p.progressMessage.trim()
          ? p.progressMessage
          : undefined;
        if (status === 'running') {
          onActivity?.({ kind: name, label: `Tool: ${name}`, detail, event: 'tool_call' });
        } else {
          onActivity?.({ kind: 'tool_result', label: `Tool ${status === 'error' ? 'failed' : 'finished'}: ${name}`, detail, event: 'tool_result' });
        }
      });

      // Tool call handler — execute tools and respond
      const unlistenToolCall = await listen<{ requestId: string; id: string; name: string; arguments: Record<string, unknown>; conversationId?: string }>('copilot-tool-call', async (event) => {
        if (!isOurRequest(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;

        const { requestId, name, arguments: args } = event.payload;

        // Never run a tool the user has not already allowed (see file header).
        if (!isToolPreApproved(name, connection.id, projectRoot)) {
          onActivity?.({ kind: 'tool_call', label: `Denied: ${name}`, detail: 'Not pre-approved for background tasks', event: 'tool_denied' });
          await tauriApi.copilotLspToolResult(requestId, {
            status: 'error',
            content: [{ value: `Permission denied for tool: ${name}. Background tasks only run tools the user has already allowed.` }],
          }).catch(() => {});
          return;
        }

        onActivity?.({ kind: 'tool_call', label: `Tool: ${name}`, detail: JSON.stringify(args).slice(0, 100), event: 'tool_call' });

        try {
          const { executeToolCall } = await import('@/lib/tool-executor');
          const scopeRoot = taskMeta?.projectRoot;
          const scopeHomeDir = await getHomeDir();
          const result = await executeToolCall(event.payload.id, name, args, {
            projectRoots: scopeRoot ? [scopeRoot] : [],
            homeDir: scopeHomeDir,
          });
          await tauriApi.copilotLspToolResult(requestId, {
            status: 'success',
            content: [{ value: typeof result === 'string' ? result : JSON.stringify(result) }],
          });
          onActivity?.({ kind: 'tool_result', label: `Tool result: ${name}`, event: 'tool_result' });
        } catch (err) {
          await tauriApi.copilotLspToolResult(requestId, {
            status: 'error',
            content: [{ value: String(err) }],
          });
        }
      });

      // Tool confirmation handler. Only a tool the user has already allowed
      // is confirmed; everything else is dismissed. (This used to approve
      // every request "same as the ACP path", but an ACP agent is sandboxed
      // and this is not.)
      const unlistenConfirm = await listen<{ requestId: string; name: string; conversationId?: string }>('copilot-tool-confirmation', async (event) => {
        if (!isOurRequest(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;
        const { requestId, name } = event.payload;
        const accepted = isToolPreApproved(name, connection.id, projectRoot);
        await tauriApi.copilotLspToolConfirmationResponse(requestId, accepted).catch(() => {});
        if (accepted) {
          onActivity?.({ kind: 'tool_call', label: `Approved: ${name}`, event: 'permission_auto_approved' });
        } else {
          onActivity?.({ kind: 'tool_call', label: `Denied: ${name}`, detail: 'Not pre-approved for background tasks', event: 'tool_denied' });
        }
      });

      // Context request handler — provide empty context for headless tasks
      const unlistenContext = await listen<{ requestId: string; conversationId?: string }>('copilot-context-request', async (event) => {
        if (!isOurRequest(event.payload)) return;
        await tauriApi.copilotLspContextResponse(event.payload.requestId, [null, null]).catch(() => {});
      });

      handle.registerCleanup(() => {
        closeCopilotStream(stream);
        runningTasks.delete(taskId);
        unlistenBegin();
        unlistenChunk();
        unlistenThinking();
        unlistenDone();
        unlistenStep();
        unlistenToolUpdate();
        unlistenToolCall();
        unlistenConfirm();
        unlistenContext();
      });

      onActivity?.({ kind: 'agent_responding', label: 'Agent responding', event: 'agent_responding' });

      // Create conversation and send the prompt
      const wasCancelled = () => agentTaskRegistry.getTask(taskId)?.status === 'cancelled';
      // Not awaited: `conversation/create` only returns when the whole turn
      // is over, and the caller needs the task id back while it is running
      // (to show it, and to cancel it).
      tauriApi.copilotLspConversationCreate(prompt, model, undefined, undefined, undefined, stream.token)
        .then((result) => {
          // Cancelled before any event had named the conversation: now that
          // the id is known, stop it.
          if (wasCancelled() && result?.conversationId && !running.destroyed) {
            running.destroyed = true;
            tauriApi.copilotLspConversationDestroy(result.conversationId).catch(() => {});
          }
        })
        .catch((error) => {
          // A request that fails because the user cancelled it is not a failed task.
          if (!wasCancelled()) handle.fail(error);
          handle.runCleanup();
        });
    },
  });
}
