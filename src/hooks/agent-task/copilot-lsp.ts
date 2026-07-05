// ---------------------------------------------------------------------------
// Copilot LSP task backend (agent_managed connections with
// copilot-language-server).
//
// Runs a background task through a `conversation/create` round: streaming +
// progress arrive as `copilot-chat-*` Tauri events; tool calls / confirmations
// / context requests are answered inline (auto-approve, headless context).
// ---------------------------------------------------------------------------

import { listen } from '@tauri-apps/api/event';
import { useRoutingStore } from '@/stores/routing-store';
import { useActivityStore } from '@/stores/activity-store';
import type { Connection } from '@/lib/ai/connections';
import { tauriApi } from '@/lib/tauri';
import { mapCopilotProgressStatus, type CopilotStepPayload, type CopilotToolUpdatePayload } from '@/lib/ai/copilot-progress';
import { agentTaskRegistry } from './task-registry';
import { runAgentTask, type TaskCallbacks, type TaskMeta } from './run-task';
import { getHomeDir } from './home-dir';

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

      // Latch onto the conversationId from the first event (we don't know it
      // until events arrive because conversation/create blocks until streaming finishes).
      let eventConvId: string | null = null;
      const isOurEvent = (payload: { conversationId?: string }): boolean => {
        if (!payload.conversationId) return true;
        if (eventConvId === null) {
          eventConvId = payload.conversationId;
          return true;
        }
        return payload.conversationId === eventConvId;
      };

      // Listen for streaming events
      const unlistenChunk = await listen<{ text: string; conversationId?: string }>('copilot-chat-chunk', (event) => {
        if (!isOurEvent(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;
        current.output += event.payload.text;
        onChunk?.(event.payload.text);
        if (track) useActivityStore.getState().appendPartialOutput(taskId, event.payload.text);
      });

      const unlistenThinking = await listen<{ text: string; conversationId?: string }>('copilot-chat-thinking', (event) => {
        if (!isOurEvent(event.payload)) return;
        // Thinking events logged but not appended to output
      });

      const unlistenDone = await listen<{ conversationId: string; error?: unknown }>('copilot-chat-done', async (event) => {
        if (!isOurEvent(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;

        // Destroy the conversation
        if (event.payload.conversationId) {
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
      const unlistenStep = await listen<CopilotStepPayload>('copilot-chat-step', (event) => {
        if (!isOurEvent(event.payload)) return;
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
      const unlistenToolUpdate = await listen<CopilotToolUpdatePayload>('copilot-chat-tool-update', (event) => {
        if (!isOurEvent(event.payload)) return;
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
        if (!isOurEvent(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;

        const { requestId, name, arguments: args } = event.payload;
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

      // Tool confirmation handler — auto-approve for agent tasks
      const unlistenConfirm = await listen<{ requestId: string; name: string; conversationId?: string }>('copilot-tool-confirmation', async (event) => {
        if (!isOurEvent(event.payload)) return;
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;
        // Auto-approve tool confirmations for agent tasks (same as ACP path)
        await tauriApi.copilotLspToolConfirmationResponse(event.payload.requestId, true);
        onActivity?.({ kind: 'tool_call', label: `Approved: ${event.payload.name}`, event: 'permission_auto_approved' });
      });

      // Context request handler — provide empty context for headless tasks
      const unlistenContext = await listen<{ requestId: string; conversationId?: string }>('copilot-context-request', async (event) => {
        if (!isOurEvent(event.payload)) return;
        await tauriApi.copilotLspContextResponse(event.payload.requestId, [null, null]);
      });

      handle.registerCleanup(() => {
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
      try {
        await tauriApi.copilotLspConversationCreate(prompt, model);
      } catch (error) {
        handle.fail(error);
        handle.runCleanup();
      }
    },
  });
}
