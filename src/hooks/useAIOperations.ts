import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useAIStore } from '@/stores/ai-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useConnectionsStore } from '@/stores/connections-store';
import type { AIProviderType, ChatMessage, ImageAttachment } from '@/lib/ai/types';
import { resolveConnectionCredentials } from '@/lib/ai/credentials';
import { useAIContext } from '@/hooks/useAIContext';
import { useDirectApiChat } from '@/hooks/useDirectApiChat';
import { useAcpLifecycle } from '@/hooks/useAcpLifecycle';
import { useCopilotChat } from '@/hooks/useCopilotChat';
import { findLockConflict, ProjectLockViolation, describeLockTarget } from '@/lib/ai/project-lock';

// Re-export ACP utilities for external consumers
export { stopAcpAgent } from '@/lib/ai/acp-agent-state';
export { truncateDetail, formatAcpToolName } from '@/lib/ai/acp-utils';
export { ProjectLockViolation };

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

  // Resolve the effective connection: project override takes priority over global routing
  const effectiveConnection = useMemo(() => {
    const projectProviderOverride = singleMetadata?.ai.provider ?? null;
    if (projectProviderOverride) {
      const conn = connections.find((c) => c.id === projectProviderOverride);
      if (conn) return conn;
    }
    return interactiveConnection;
  }, [singleMetadata, interactiveConnection, connections]);

  // Resolve effective provider + credentials
  const resolved = useMemo(() => {
    const projectProviderOverride = singleMetadata?.ai.provider ?? null;

    if (projectProviderOverride) {
      const conn = connections.find((c) => c.id === projectProviderOverride);
      if (conn) {
        const fromConn = resolveConnectionCredentials(conn, useCaseModel);
        if (fromConn) return fromConn;
      }

      const legacyProvider = projectProviderOverride as AIProviderType;
      if (['anthropic', 'openai', 'ollama', 'google'].includes(legacyProvider)) {
        return {
          provider: legacyProvider,
          connectionId: '',
          ollamaUrl,
          config: undefined,
        };
      }
    }

    if (interactiveConnection) {
      const fromConnection = resolveConnectionCredentials(interactiveConnection, useCaseModel);
      if (fromConnection) return fromConnection;
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
  }, [singleMetadata, interactiveConnection, aiStore.provider, aiStore.apiKeys, ollamaUrl, useCaseModel]);

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

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      assertLockAllowsSend();
      if (effectiveConnection?.credentials && 'agentBinary' in effectiveConnection.credentials && effectiveConnection.credentials.agentBinary === 'copilot-language-server') {
        return copilotGenerateText(prompt);
      }
      if (effectiveConnection?.authMethod === 'agent_managed') {
        return acpGenerateText(prompt);
      }
      return directGenerateText(prompt);
    },
    [effectiveConnection, copilotGenerateText, acpGenerateText, directGenerateText, assertLockAllowsSend]
  );

  const sendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[], opts?: { displayContent?: string; skillName?: string; attachedFilePaths?: string[]; sandboxPaths?: string[]; parentId?: string | null; attachments?: ImageAttachment[] }) => {
      assertLockAllowsSend();
      if (effectiveConnection?.credentials && 'agentBinary' in effectiveConnection.credentials && effectiveConnection.credentials.agentBinary === 'copilot-language-server') {
        return copilotSendChatMessage(content, messages, opts);
      }
      if (effectiveConnection?.authMethod === 'agent_managed') {
        return acpSendChatMessage(content, messages, opts);
      }
      return directSendChatMessage(content, messages, opts);
    },
    [effectiveConnection, copilotSendChatMessage, acpSendChatMessage, directSendChatMessage, assertLockAllowsSend]
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
