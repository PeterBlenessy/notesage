// ---------------------------------------------------------------------------
// Direct API task backend (api_key / local connections — streaming chat).
//
// Runs a background task as a single-turn `ai_chat_stream` call with a unique
// stream correlation id so concurrent tasks / foreground chat never
// cross-contaminate the event bus.
// ---------------------------------------------------------------------------

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useActivityStore } from '@/stores/activity-store';
import type { Connection } from '@/lib/ai/connections';
import { streamEvent, newStreamId } from '@/lib/ai/stream-events';
import { agentTaskRegistry } from './task-registry';
import { runAgentTask, type TaskCallbacks, type TaskMeta } from './run-task';

export async function startDirectApiTask(
  prompt: string,
  callbacks: TaskCallbacks | undefined,
  taskMeta: TaskMeta | undefined,
  connection: Connection,
): Promise<string> {
  return runAgentTask({ prompt, callbacks, taskMeta, connection }, {
    name: 'direct-api',
    run: async (handle) => {
      const { taskId, track } = handle;
      const { onActivity, onChunk } = handle.callbacks;

      // Resolve provider credentials
      let provider: string;
      let ollamaUrl: string | null = null;
      const config = connection.config;
      const connectionId = connection.id;

      if (connection.credentials.type === 'api_key') {
        provider = connection.provider;
      } else if (connection.credentials.type === 'local') {
        provider = connection.provider;
        ollamaUrl = connection.credentials.url;
      } else {
        throw new Error('Unsupported credential type for direct API task');
      }

      // Build messages: system + user prompt
      const messages = [
        { role: 'system', content: 'You are a helpful AI assistant working on a delegated task. Respond with your analysis or the requested content.' },
        { role: 'user', content: prompt },
      ];

      // Listen for stream events. Unique correlation id so concurrent agent tasks
      // (and foreground chat / structured calls) never cross-contaminate the bus.
      const streamId = newStreamId();
      const unlistenChunk = await listen<string>(streamEvent('ai-stream-chunk', streamId), (event) => {
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;

        current.output += event.payload;
        onChunk?.(event.payload);
        if (track) useActivityStore.getState().appendPartialOutput(taskId, event.payload);
      });

      const unlistenDone = await listen(streamEvent('ai-stream-done', streamId), () => {
        const current = agentTaskRegistry.getTask(taskId);
        if (!current || current.status !== 'running') return;

        handle.complete();
      });

      handle.registerCleanup(() => { unlistenChunk(); unlistenDone(); });

      onActivity?.({ kind: 'agent_responding', label: 'Agent responding', event: 'agent_responding' });

      // Start streaming
      invoke('ai_chat_stream', {
        messages,
        provider,
        connectionId,
        ollamaUrl,
        webSearchEnabled: false,
        model: config?.model ?? null,
        temperature: config?.temperature ?? null,
        maxTokens: config?.maxTokens ?? null,
        baseUrl: config?.baseUrl ?? null,
        responseFormat: null,
        streamId,
      })
        .catch((error) => {
          handle.fail(error, { completeActivities: true, recordError: true });
        })
        .finally(() => {
          handle.runCleanup();
        });
    },
  });
}
