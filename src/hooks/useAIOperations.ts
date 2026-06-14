import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useAIStore } from '@/stores/ai-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import type { AIProviderType, ChatMessage, ImageAttachment } from '@/lib/ai/types';
import { resolveConnectionCredentials } from '@/lib/ai/credentials';
import { useAIContext } from '@/hooks/useAIContext';
import { useDirectApiChat } from '@/hooks/useDirectApiChat';
import { useAcpLifecycle } from '@/hooks/useAcpLifecycle';
import { useCopilotChat } from '@/hooks/useCopilotChat';
import { findLockConflict, ProjectLockViolation, describeLockTarget } from '@/lib/ai/project-lock';
import { resolveInteractiveConnection, isAgentHealthError } from '@/lib/ai/local-agent-routing';
import { isLocalAgentPreset } from '@/lib/ai/acp-agent-state';
import { track, providerKind, type AiPath } from '@/lib/telemetry';
import type { Connection } from '@/lib/ai/connections';

// Re-export ACP utilities for external consumers
export { stopAcpAgent } from '@/lib/ai/acp-agent-state';
export { truncateDetail, formatAcpToolName } from '@/lib/ai/acp-utils';
export { ProjectLockViolation };

// ---------------------------------------------------------------------------
// Telemetry — classify which of the four routing paths handles a send. Mirrors
// the branch order in `sendChatMessage` exactly so the reported `path` matches
// the path actually taken.
// ---------------------------------------------------------------------------

function aiPathFor(conn: Connection | null): AiPath {
  if (
    conn?.credentials &&
    'agentBinary' in conn.credentials &&
    conn.credentials.agentBinary === 'copilot-language-server'
  ) {
    return 'copilot_lsp';
  }
  if (conn?.authMethod === 'agent_managed') return 'acp';
  if (conn?.authMethod === 'local_bundled') return 'local_bundled';
  return 'direct';
}

// ---------------------------------------------------------------------------
// Hook — routes AI operations between direct API and ACP paths
// ---------------------------------------------------------------------------

export function useAIOperations() {
  const aiStore = useAIStore();
  const { ollamaUrl } = aiStore;
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  // Resolve interactive connection from routing store
  const interactiveConnection = useRoutingStore((s) => {
    const slot = s.routing.interactive;
    if (!slot?.connectionId) return null;
    return s.getConnectionForUseCase('interactive');
  });

  // Resolve use-case model override from routing store
  const useCaseModel = useRoutingStore((s) => s.routing.interactive?.model);

  // Provider overrides only apply when exactly one project is selected
  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = singleProjectPath ? metadataMap[singleProjectPath] ?? null : null;

  // All connections (for reactivity when a connection referenced by project override is added/removed)
  const connections = useConnectionsStore((s) => s.connections);

  // Local Agent preset degraded state (task #13) drives the Path-4 fallback.
  const localAgentDegraded = useLocalAIStore((s) => s.localAgentDegraded);
  const setLocalAgentDegraded = useLocalAIStore((s) => s.setLocalAgentDegraded);

  // Resolve the effective connection: project override takes priority over global routing
  const overrideConnection = useMemo(() => {
    const projectProviderOverride = singleMetadata?.ai.provider ?? null;
    if (projectProviderOverride) {
      const conn = connections.find((c) => c.id === projectProviderOverride);
      if (conn) return conn;
    }
    return interactiveConnection;
  }, [singleMetadata, interactiveConnection, connections]);

  // Apply the Local Agent degraded → Path-4 fallback (task #13). When the preset
  // is healthy (or this isn't a preset) `effectiveConnection === overrideConnection`,
  // so all existing routing is unchanged; when degraded it becomes the
  // local_bundled fallback so chat routes to direct local chat instead.
  const effectiveConnection = useMemo(
    () => resolveInteractiveConnection(overrideConnection, connections, localAgentDegraded),
    [overrideConnection, connections, localAgentDegraded],
  );

  // Resolve effective provider + credentials from the (post-fallback) connection.
  const resolved = useMemo(() => {
    if (effectiveConnection) {
      const fromConnection = resolveConnectionCredentials(effectiveConnection, useCaseModel);
      if (fromConnection) return fromConnection;
    }

    // Legacy: a project override that is a bare provider string (pre-connections).
    const projectProviderOverride = singleMetadata?.ai.provider ?? null;
    if (projectProviderOverride) {
      const legacyProvider = projectProviderOverride as AIProviderType;
      if (['anthropic', 'openai', 'ollama', 'google'].includes(legacyProvider)) {
        return { provider: legacyProvider, connectionId: '', ollamaUrl, config: undefined };
      }
    }

    if (aiStore.provider) {
      return {
        provider: aiStore.provider,
        connectionId: '',
        ollamaUrl,
        config: undefined,
      };
    }

    return null;
  }, [effectiveConnection, singleMetadata, aiStore.provider, aiStore.apiKeys, ollamaUrl, useCaseModel]);

  // Delegate context building to useAIContext
  const { composedSystemMessage, localSystemMessage, acpSystemMessage, buildComposedSystemMessage, buildAcpSystemMessage } = useAIContext();

  // Delegate direct API operations to useDirectApiChat
  const { generateText: directGenerateText, sendChatMessage: directSendChatMessage, cancelDirectChat } = useDirectApiChat({
    resolved,
    effectiveConnection,
    buildComposedSystemMessage,
    composedSystemMessage,
    localSystemMessage,
  });

  // Delegate ACP operations to useAcpLifecycle
  const { acpGenerateText, acpSendChatMessage, acpCancelChat } = useAcpLifecycle({
    effectiveConnection,
    acpSystemMessage,
    buildAcpSystemMessage,
  });

  // Delegate Copilot LSP operations to useCopilotChat
  const { copilotGenerateText, copilotSendChatMessage, cancelCopilotChat } = useCopilotChat({
    effectiveConnection,
    buildComposedSystemMessage,
    composedSystemMessage,
  });

  const assertLockAllowsSend = useCallback((): void => {
    const attemptedId = effectiveConnection?.id ?? null;
    const conflict = findLockConflict(selectedProjectPaths, metadataMap, attemptedId);
    if (!conflict) return;
    const lockedConn = connections.find((c) => c.id === conflict.lockedConnectionId);
    const lockedLabel = describeLockTarget(conflict.lockedConnectionId, lockedConn?.label);
    const projectName = metadataMap[conflict.projectPath]?.name || conflict.projectPath;
    toast.error(
      `"${projectName}" is locked to ${lockedLabel}. Switch provider to that connection to send.`,
      { id: `project-lock-violation:${conflict.projectPath}` },
    );
    throw new ProjectLockViolation(conflict.projectPath, conflict.lockedConnectionId, attemptedId);
  }, [effectiveConnection, selectedProjectPaths, metadataMap, connections]);

  // Run a Local Agent preset operation, flipping the degraded flag (task #13) on
  // an agent-health failure so the NEXT send/generate falls back to Path 4. The
  // current call still surfaces the error — the user retries onto local chat.
  const runPresetGuarded = useCallback(
    async <T,>(op: () => Promise<T>): Promise<T> => {
      try {
        return await op();
      } catch (err) {
        if (isAgentHealthError(err)) {
          setLocalAgentDegraded(`Local Agent unavailable: ${String((err as Error)?.message ?? err)}`);
        }
        throw err;
      }
    },
    [setLocalAgentDegraded],
  );

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      assertLockAllowsSend();
      if (effectiveConnection?.credentials && 'agentBinary' in effectiveConnection.credentials && effectiveConnection.credentials.agentBinary === 'copilot-language-server') {
        return copilotGenerateText(prompt);
      }
      if (effectiveConnection?.authMethod === 'agent_managed') {
        return isLocalAgentPreset(effectiveConnection)
          ? runPresetGuarded(() => acpGenerateText(prompt))
          : acpGenerateText(prompt);
      }
      return directGenerateText(prompt);
    },
    [effectiveConnection, copilotGenerateText, acpGenerateText, directGenerateText, assertLockAllowsSend, runPresetGuarded]
  );

  const sendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[], opts?: { displayContent?: string; skillName?: string; attachedFilePaths?: string[]; sandboxPaths?: string[]; parentId?: string | null; attachments?: ImageAttachment[] }) => {
      assertLockAllowsSend();
      const chatPath = aiPathFor(effectiveConnection);
      track('ai_chat_sent', {
        path: chatPath,
        // A Copilot LSP connection's authMethod is the generic `agent_managed`,
        // which providerKind() collapses to "agent_managed" — but the routing
        // path is copilot_lsp. Report copilot_lsp so path/provider_kind agree.
        provider_kind:
          chatPath === 'copilot_lsp'
            ? 'copilot_lsp'
            : providerKind(
                effectiveConnection?.provider ?? resolved?.provider ?? '',
                effectiveConnection?.authMethod ?? '',
              ),
      });
      if (effectiveConnection?.credentials && 'agentBinary' in effectiveConnection.credentials && effectiveConnection.credentials.agentBinary === 'copilot-language-server') {
        return copilotSendChatMessage(content, messages, opts);
      }
      if (effectiveConnection?.authMethod === 'agent_managed') {
        return isLocalAgentPreset(effectiveConnection)
          ? runPresetGuarded(() => acpSendChatMessage(content, messages, opts))
          : acpSendChatMessage(content, messages, opts);
      }
      return directSendChatMessage(content, messages, opts);
    },
    [effectiveConnection, resolved, copilotSendChatMessage, acpSendChatMessage, directSendChatMessage, assertLockAllowsSend, runPresetGuarded]
  );

  // Route cancelChat — always clean up direct listeners, then delegate ACP/Copilot if needed
  const isCopilotLsp = effectiveConnection?.credentials != null
    && 'agentBinary' in effectiveConnection.credentials
    && effectiveConnection.credentials.agentBinary === 'copilot-language-server';

  const cancelChat = useCallback(() => {
    cancelDirectChat();
    cancelCopilotChat();
    if (effectiveConnection?.authMethod === 'agent_managed' && !isCopilotLsp) {
      acpCancelChat();
    }
  }, [cancelDirectChat, cancelCopilotChat, effectiveConnection, isCopilotLsp, acpCancelChat]);

  return { generateText, sendChatMessage, cancelChat };
}
