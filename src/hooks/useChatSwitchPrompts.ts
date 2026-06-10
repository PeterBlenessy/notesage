import { useEffect, useMemo, useRef } from 'react';
import {
  useChatStore,
  selectMessages,
  selectProjectPaths,
  selectPendingProjectSwitch,
  selectPendingAgentSwitch,
} from '@/stores/chat-store';
import { log } from '@/lib/logger';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';

/**
 * Mid-conversation context-isolation prompts (live-test 2026-04-26
 * audit gap #1).
 *
 * Watches two state changes on the active conversation and writes a
 * pending-switch entry to `chat-store` so `AgentSwitchCard` (inside
 * `ChatMessageList`) can show the user the "Include history? / Start
 * fresh? / Cancel" prompt:
 *
 *   1. Provider connection change — the user picked a different
 *      `interactive` connection mid-chat. We compare the previous
 *      `effectiveConnection.id` against the current one. The
 *      effective connection is `projectOverride ?? routing[interactive]`,
 *      same resolution `FloatingCommandBar` uses.
 *   2. Project selection change — the user added or removed a project
 *      from the conversation scope. We compare the previous selected
 *      path set against the current one (set-equality, ignoring
 *      order).
 *
 * Both effects no-op on:
 *   - Empty message history (nothing to isolate)
 *   - First-render rehydration (prev was empty/undefined)
 *   - A pending prompt already in flight (don't stack)
 *   - A conversation switch. The detection is keyed to
 *     `activeConversationId`: each ref stores the conversation it was
 *     captured in, and when the active conversation changes we treat the
 *     new scope/connection as a SILENT RESTORE — never a "change". Without
 *     this, switching from conversation A (scope P_A) to B (scope P_B)
 *     diffs P_A vs P_B and falsely fires ProjectSwitchCard / AgentSwitchCard,
 *     even though the user only opened B (which always had P_B). That
 *     spurious switch also spawns a redundant segment + fresh agent
 *     session, severing restored context. The prompt must fire ONLY when
 *     the scope/connection mutates WITHIN a single conversation.
 *
 * The hook lives in `useChatSwitchPrompts` so the chat surface
 * (`FloatingCommandBar`) can mount it once and get the data-isolation
 * guarantees.
 */
export function useChatSwitchPrompts(): void {
  const messages = useChatStore(selectMessages);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);
  const setPendingProjectSwitch = useChatStore(
    (s) => s.setPendingProjectSwitch,
  );
  const setPendingAgentSwitch = useChatStore((s) => s.setPendingAgentSwitch);

  const allConnections = useConnectionsStore((s) => s.connections);
  const interactiveConnection = useRoutingStore((s) =>
    s.getConnectionForUseCase('interactive'),
  );
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  // Resolve effective connection (lock → project override → routing
  // slot). Without the `aiLock` priority a locked project would still
  // see `effectiveConnection` change when the user opens the picker,
  // falsely triggering the AgentSwitchCard for projects whose provider
  // is pinned.
  const singleProjectPath =
    selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = singleProjectPath
    ? metadataMap[singleProjectPath] ?? null
    : null;
  const projectProviderOverride = singleMetadata?.ai.provider ?? null;
  const projectOverrideConnection = useMemo(() => {
    if (!projectProviderOverride) return null;
    return (
      allConnections.find((c) => c.id === projectProviderOverride) ?? null
    );
  }, [projectProviderOverride, allConnections]);
  // aiLock from any selected project pins `effectiveConnection`.
  const lockedConnection = useMemo(() => {
    const lockedIds = selectedProjectPaths
      .map((p) => metadataMap[p]?.aiLock?.connectionId)
      .filter((id): id is string => Boolean(id));
    if (lockedIds.length !== 1) return null;
    return allConnections.find((c) => c.id === lockedIds[0]) ?? null;
  }, [selectedProjectPaths, metadataMap, allConnections]);
  const effectiveConnection =
    lockedConnection ?? projectOverrideConnection ?? interactiveConnection;

  // Project selection change. The ref carries the conversation the paths
  // were captured in; a conversation switch resets it silently (no prompt).
  const prevProjectPathsRef = useRef<{ convId: string | null; paths: string[] }>({
    convId: activeConversationId,
    paths: selectedProjectPaths,
  });
  useEffect(() => {
    const prev = prevProjectPathsRef.current;
    const curr = selectedProjectPaths;
    const currConvId = activeConversationId;
    prevProjectPathsRef.current = { convId: currConvId, paths: curr };

    // Conversation switch (or restore) — adopt the new scope silently.
    if (prev.convId !== currConvId) return;
    if (messages.length === 0) return;
    if (prev.paths.length === 0) return;
    const prevSet = new Set(prev.paths);
    const currSet = new Set(curr);
    if (prevSet.size === currSet.size && [...prevSet].every((p) => currSet.has(p)))
      return;
    if (pendingProjectSwitch) return;

    log.info(
      'ai',
      `[switch-prompt] in-conversation project change conv=${currConvId} [${prev.paths.join('|')}] → [${curr.join('|')}]`,
    );
    setPendingProjectSwitch(curr, prev.paths);
  }, [
    activeConversationId,
    selectedProjectPaths,
    messages.length,
    pendingProjectSwitch,
    setPendingProjectSwitch,
  ]);

  // Provider connection change. Same conversation-scoping as projects.
  const prevConnectionRef = useRef<{ convId: string | null; id: string | undefined }>({
    convId: activeConversationId,
    id: effectiveConnection?.id,
  });
  useEffect(() => {
    const prev = prevConnectionRef.current;
    const curr = effectiveConnection?.id;
    const currConvId = activeConversationId;
    prevConnectionRef.current = { convId: currConvId, id: curr };

    // Conversation switch (or restore) — adopt the new connection silently.
    if (prev.convId !== currConvId) return;
    if (messages.length === 0) return;
    if (prev.id === curr) return;
    if (!prev.id || !curr) return;
    if (pendingAgentSwitch) return;

    const prevConn = allConnections.find((c) => c.id === prev.id);
    const currConn = allConnections.find((c) => c.id === curr);
    setPendingAgentSwitch(
      currConn?.label ?? 'Unknown provider',
      prevConn?.label ?? 'Unknown provider',
    );
  }, [
    activeConversationId,
    effectiveConnection?.id,
    messages.length,
    pendingAgentSwitch,
    setPendingAgentSwitch,
    allConnections,
  ]);
}
