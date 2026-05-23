import { useEffect, useMemo, useRef } from 'react';
import {
  useChatStore,
  selectMessages,
  selectProjectPaths,
  selectPendingProjectSwitch,
  selectPendingAgentSwitch,
} from '@/stores/chat-store';
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
 *
 * The hook lives in `useChatSwitchPrompts` so the chat surface
 * (`FloatingCommandBar`) can mount it once and get the data-isolation
 * guarantees.
 */
export function useChatSwitchPrompts(): void {
  const messages = useChatStore(selectMessages);
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

  // Project selection change.
  const prevProjectPathsRef = useRef<string[]>(selectedProjectPaths);
  useEffect(() => {
    const prev = prevProjectPathsRef.current;
    const curr = selectedProjectPaths;
    prevProjectPathsRef.current = curr;

    if (messages.length === 0) return;
    if (prev.length === 0) return;
    const prevSet = new Set(prev);
    const currSet = new Set(curr);
    if (prevSet.size === currSet.size && [...prevSet].every((p) => currSet.has(p)))
      return;
    if (pendingProjectSwitch) return;

    setPendingProjectSwitch(curr, prev);
  }, [
    selectedProjectPaths,
    messages.length,
    pendingProjectSwitch,
    setPendingProjectSwitch,
  ]);

  // Provider connection change.
  const prevConnectionRef = useRef<string | undefined>(
    effectiveConnection?.id,
  );
  useEffect(() => {
    const prev = prevConnectionRef.current;
    const curr = effectiveConnection?.id;
    prevConnectionRef.current = curr;

    if (messages.length === 0) return;
    if (prev === curr) return;
    if (!prev || !curr) return;
    if (pendingAgentSwitch) return;

    const prevConn = allConnections.find((c) => c.id === prev);
    const currConn = allConnections.find((c) => c.id === curr);
    setPendingAgentSwitch(
      currConn?.label ?? 'Unknown provider',
      prevConn?.label ?? 'Unknown provider',
    );
  }, [
    effectiveConnection?.id,
    messages.length,
    pendingAgentSwitch,
    setPendingAgentSwitch,
    allConnections,
  ]);
}
