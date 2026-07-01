// One-time migration from v1 ai-store to v2 connections + routing stores.
// Runs on app startup if connections-store is empty.
// See: docs/prds/2026-02-21-ai-provider-architecture-v2.md — Migration from v1

import { useAIStore } from '@/stores/ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import type { ConnectionProvider, AuthMethod, ConnectionCredentials } from '@/lib/ai/connections';

export function migrateV1AISettings(): void {
  const connections = useConnectionsStore.getState();

  // Only migrate if connections-store is empty (first run after upgrade)
  if (connections.connections.length > 0) return;

  const ai = useAIStore.getState();
  if (!ai.provider) return;

  const routing = useRoutingStore.getState();

  let provider: ConnectionProvider | null = null;
  let authMethod: AuthMethod | null = null;
  let credentials: ConnectionCredentials | null = null;
  let label: string | null = null;

  switch (ai.provider) {
    case 'anthropic':
      if (ai.apiKeys.anthropic) {
        provider = 'anthropic';
        authMethod = 'api_key';
        credentials = { type: 'api_key', key: ai.apiKeys.anthropic };
        label = 'Anthropic (API Key)';
      }
      break;
    case 'openai':
      if (ai.apiKeys.openai) {
        provider = 'openai';
        authMethod = 'api_key';
        credentials = { type: 'api_key', key: ai.apiKeys.openai };
        label = 'OpenAI (API Key)';
      }
      break;
    case 'ollama':
      provider = 'ollama';
      authMethod = 'local';
      credentials = { type: 'local', url: ai.ollamaUrl || 'http://localhost:11434' };
      label = 'Ollama (Local)';
      break;
  }

  if (!provider || !authMethod || !credentials || !label) return;

  console.log(`[migration] Migrating v1 AI settings: ${ai.provider} → v2 connection`);

  const connectionId = connections.addConnection(
    {
      provider,
      authMethod,
      status: 'connected',
      label,
      credentials,
    },
    // One-time v1→v2 port — not a new user action, so don't emit telemetry.
    { silent: true },
  );

  routing.autoAssign(connectionId);

  console.log(`[migration] Created connection ${connectionId}, auto-assigned to routing slots`);
}
