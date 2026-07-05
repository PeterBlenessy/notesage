// ---------------------------------------------------------------------------
// Eager ACP session creation — spawn agent + create session as soon as chat is
// opened with an ACP connection, so the mode picker populates before the first
// message. If the active conversation has a stored sessionId, try session/load
// first to restore agent-side conversation context.
//
// Extracted from `useAcpLifecycle` — this module owns the promise lock that
// serialises concurrent effect firings and the init-time session listener that
// bridges the gap until the full chat listeners take over on first prompt.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import { tauriApi } from '@/lib/tauri';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Connection } from '@/lib/ai/connections';
import type { AcpSessionResult, AcpSessionUpdatePayload } from '@/lib/ai/acp-utils';
import { getChatSandboxScope } from '@/lib/ai/acp-utils';
import { restoreOrCreateAcpSession } from '@/lib/ai/acp-session-restore';
import { buildAcpMcpServerInputs } from '@/lib/ai/acp-mcp';
import {
  getAcpAgent,
  ensureAcpAgent,
  setSessionModes,
  setSessionConfigOptions,
  updateCurrentMode,
  updateConfigOptionValue,
  setAvailableCommands,
  backfillAcpCapabilities,
} from '@/lib/ai/acp-agent-state';
import { reapplySessionMode, applyConnectionModelOption, cacheAgentModels } from '@/hooks/acp/session-config';

/**
 * In-flight promise for the eager session-creation effect. React 18 strict mode
 * and store rehydration can each trigger the effect multiple times at startup;
 * without this lock all firings would race and create redundant ACP sessions.
 * Subsequent callers await the first one instead of duplicating the work.
 */
let eagerSessionPromise: Promise<void> | null = null;

interface EagerAcpSessionParams {
  effectiveConnection: Connection | null;
  selectedProjectPaths: string[];
  activeConversationId: string | null;
}

interface EagerAcpSession {
  /**
   * Tear down the eager init-time session listener. The prompt-send and retry
   * paths call this once the full chat listeners take over, so init-time
   * notifications aren't double-handled.
   */
  stopEagerListener: () => void;
}

export function useEagerAcpSession({ effectiveConnection, selectedProjectPaths, activeConversationId }: EagerAcpSessionParams): EagerAcpSession {
  const eagerUnlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!effectiveConnection || effectiveConnection.authMethod !== 'agent_managed') return;

    // Look up the conversation we should be attached to. Its id is the registry
    // key for this conversation's ACP agent (task #2).
    const eagerConvId = activeConversationId ?? undefined;
    const targetConv = useChatStore.getState().conversations.find((c) => c.id === activeConversationId);
    const targetSessionId = targetConv?.acpSessionId;
    const eagerAgent = getAcpAgent(eagerConvId);

    // Skip only when the agent is already attached to the right session. This lets
    // switching conversations re-trigger restoration for the new conversation's
    // stored session (otherwise a chat switch leaves the agent on the previous
    // conversation's session and prompts go to the wrong timeline).
    if (eagerAgent?.chatSessionId && targetSessionId && eagerAgent.chatSessionId === targetSessionId) return;
    // Brand-new conversations have no stored session — keep whatever session the
    // agent currently has; the prompt-send path creates a fresh one on first message.
    if (eagerAgent?.chatSessionId && !targetSessionId) return;
    // Skip if another firing of this effect is already doing the work (React strict
    // mode + hydration state changes can fire this effect multiple times at startup;
    // without the lock, all firings race to create/resume redundantly).
    if (eagerSessionPromise) return;

    // Cleanup-race guard: the IIFE below only reaches its `await listen(...)`
    // after long awaits (hydration, agent spawn, session restore). If this
    // effect firing is cleaned up during that window (conversation switch,
    // unmount), the late-resolving listener must be unlistened immediately
    // instead of being stored in a ref that cleanup already drained.
    let active = true;

    eagerSessionPromise = (async () => {
      try {
        // Wait for the persisted chat-store to rehydrate. The tauri-storage backend
        // is async, so the initial in-memory `conversations` array is empty — without
        // this gate, `storedSessionId` reads undefined and we never attempt resume/load.
        // See `docs/prds/2026-04-17-acp-session-lifecycle-completeness.md` for context.
        const persistApi = (useChatStore as unknown as { persist?: { hasHydrated?: () => boolean; onFinishHydration?: (cb: () => void) => () => void } }).persist;
        if (persistApi?.hasHydrated && !persistApi.hasHydrated()) {
          await new Promise<void>((resolve) => {
            const unsub = persistApi.onFinishHydration?.(() => { unsub?.(); resolve(); });
            // Safety net in case hydration has already completed between the check and the subscribe.
            if (persistApi.hasHydrated?.()) { unsub?.(); resolve(); }
          });
        }

        // Re-read project paths from the store after hydration — the `selectedProjectPaths`
        // closure value was captured when the effect dispatched (pre-hydration), and is
        // stale once the persist middleware populates `conversations`. Using the stale
        // value spawns the agent with an empty scope, which then triggers a respawn
        // later when any caller fires with the hydrated scope. Task #6d diagnostic.
        const freshPaths = selectProjectPaths(useChatStore.getState());
        const cwd = freshPaths[0] || '/tmp';
        const sandboxScope = getChatSandboxScope(
          { projectPaths: freshPaths },
          effectiveConnection,
          useSettingsStore.getState().crossProjectMode,
        );
        // Re-read the active conversation after hydration — it may have changed
        // while awaiting. This is the registry key the spawned agent binds to.
        const convId = useChatStore.getState().activeConversationId ?? undefined;
        log.info('ai', `[eager] activeConversationId=${convId} freshPaths=[${freshPaths.join('|')}] scope=[${sandboxScope.join('|')}] closurePaths=[${selectedProjectPaths.join('|')}]`);
        const instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope, 'eager', { conversationId: convId });

        // Re-read the target session after the async hydration/spawn waits — the
        // active conversation may have changed while we were waiting.
        const conv = useChatStore.getState().conversations
          .find(c => c.id === useChatStore.getState().activeConversationId);
        const storedSessionId = conv?.acpSessionId;
        const agent = getAcpAgent(convId);

        // If the agent is already attached to the right session, nothing to do.
        if (agent?.chatSessionId && storedSessionId && agent.chatSessionId === storedSessionId) return;
        // If the conversation has no stored session and the agent has any current session,
        // keep it — new chats shouldn't disturb the agent's current session.
        if (agent?.chatSessionId && !storedSessionId) return;

        const session: AcpSessionResult = await restoreOrCreateAcpSession({
          instanceId,
          cwd,
          storedSessionId,
          capabilities: agent?.capabilities,
          mcpServers: buildAcpMcpServerInputs(agent?.capabilities, freshPaths),
        });

        const boundAgent = getAcpAgent(convId);
        if (!boundAgent) return;

        boundAgent.chatSessionId = session.session_id;
        useChatStore.getState().setSegmentSessionId(session.session_id);

        // Cache models
        cacheAgentModels(effectiveConnection, session);

        // Register a lightweight listener for init-time session notifications
        // (available_commands_update, session_info_update, etc.) that fire before
        // the full chat listeners are set up on first prompt.
        const eagerUnlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
          if (event.payload.instanceId !== instanceId) return;
          const { update } = event.payload;
          if (update.sessionUpdate === 'available_commands_update') {
            const rawCommands = (update.availableCommands ?? update.available_commands) as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(rawCommands)) {
              const commands = rawCommands.map(cmd => ({
                name: String(cmd.name ?? ''),
                description: String(cmd.description ?? ''),
                inputHint: typeof cmd.inputHint === 'string' ? cmd.inputHint : undefined,
              }));
              setAvailableCommands(commands);
            }
          } else if (update.sessionUpdate === 'current_mode_update' && typeof update.currentModeId === 'string') {
            updateCurrentMode(update.currentModeId);
            // Persist agent-initiated mode changes too, so a later restore re-applies
            // the latest actual mode rather than a stale user pick.
            useChatStore.getState().setConversationMode(update.currentModeId);
          } else if (update.sessionUpdate === 'config_option_update') {
            const configId = update.optionId ?? update.option_id;
            const value = update.selectedValueId ?? update.selected_value_id ?? update.value;
            if (typeof configId === 'string' && typeof value === 'string') updateConfigOptionValue(configId, value);
          }
        });
        // This effect firing was cleaned up while the listen was in flight —
        // drop the late registration now; nothing will unlisten it later.
        if (!active) {
          eagerUnlisten();
          return;
        }
        // Store unlisten so cleanup can call it
        const prevEagerUnlisten = eagerUnlistenRef.current;
        eagerUnlistenRef.current = eagerUnlisten;
        prevEagerUnlisten?.();

        // Populate mode picker and config options
        log.info('ai', `ACP eager session modes: ${JSON.stringify(session.modes)}`);
        setSessionModes(session.modes ?? null);
        setSessionConfigOptions(session.config_options ?? null);
        backfillAcpCapabilities(effectiveConnection?.id, session);

        // Re-apply the conversation's remembered mode (or, for fresh sessions, the
        // connection default). Listeners aren't active yet for the eager session, so
        // the optimistic local update inside the helper is what the picker reads.
        const restored = session.session_id === storedSessionId;
        reapplySessionMode(instanceId, session, effectiveConnection, restored);

        // Apply remaining configured defaults only for fresh sessions. A restoration hit
        // returns the agent's existing config — don't overwrite it.
        if (!restored) {
          const defaults = effectiveConnection.acpDefaults;
          if (defaults?.thinkingEffort && session.session_id) {
            updateConfigOptionValue('reasoning_effort', defaults.thinkingEffort);
            tauriApi.acpSessionSetConfigOption(instanceId, session.session_id, 'reasoning_effort', defaults.thinkingEffort).catch(() => {});
          }
          void applyConnectionModelOption(instanceId, session, effectiveConnection.config?.model);
        }
      } catch (err) {
        log.debug('ai', `ACP eager session creation failed (non-fatal): ${String(err)}`);
      }
    })().finally(() => {
      eagerSessionPromise = null;
    });

    return () => {
      // Flag first so an in-flight IIFE's late `listen` resolution unlistens
      // itself instead of repopulating the ref after this cleanup ran.
      active = false;
      // Tear down the init-time session listener.
      eagerUnlistenRef.current?.();
      eagerUnlistenRef.current = null;
    };
  }, [effectiveConnection, selectedProjectPaths, activeConversationId]);

  const stopEagerListener = useCallback(() => {
    eagerUnlistenRef.current?.();
    eagerUnlistenRef.current = null;
  }, []);

  return { stopEagerListener };
}
