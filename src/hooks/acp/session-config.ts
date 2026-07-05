// ---------------------------------------------------------------------------
// Fresh-session configuration helpers shared by the eager-session, prompt-send,
// and retry paths of the ACP chat lifecycle. Extracted from `useAcpLifecycle`
// so each call site applies the exact same sequence (mode re-apply, model
// config option, capability backfill) without duplicating it.
// ---------------------------------------------------------------------------

import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import { useChatStore } from '@/stores/chat-store';
import type { Connection } from '@/lib/ai/connections';
import { setAgentModels } from '@/lib/ai/connections';
import type { AcpSessionResult } from '@/lib/ai/acp-utils';
import {
  setSessionModes,
  setSessionConfigOptions,
  updateCurrentMode,
  updateConfigOptionValue,
  backfillAcpCapabilities,
  resolveConfiguredModeId,
} from '@/lib/ai/acp-agent-state';

/**
 * Re-apply the conversation's remembered ACP permission mode (or, for a fresh
 * session, the connection default) to a newly created or restored session.
 *
 * A sandbox-scope change respawns the agent and creates a fresh session that
 * resets to the agent's own default mode (e.g. Claude Code → 'default' = Read
 * Only). Without this, the picker's mode silently reverts after the user picked
 * "Agent". The pick is persisted per-conversation (`chat-store.agentModeId`) and
 * re-asserted here so it survives every respawn. Must be called immediately after
 * `setSessionModes(session.modes)` at each session-creation site.
 *
 * @param restored True when `session` came from session/load|resume (it already
 *   carries the agent's remembered mode, so we don't impose the connection
 *   default — but an explicit per-conversation pick still wins).
 */
export function reapplySessionMode(
  instanceId: string,
  session: AcpSessionResult,
  connection: Connection | null,
  restored: boolean,
): void {
  if (!session.modes || !session.session_id) return;
  const state = useChatStore.getState();
  const convMode = state.conversations.find((c) => c.id === state.activeConversationId)?.agentModeId;
  // On restore, only an explicit per-conversation pick wins (don't impose the
  // connection default over the agent's restored mode); on a fresh session, fall
  // back to the connection default via the shared precedence resolver.
  const targetMode = restored ? convMode : resolveConfiguredModeId(convMode, connection);
  if (!targetMode || targetMode === session.modes.currentModeId) return;
  updateCurrentMode(targetMode);
  tauriApi.acpSessionSetMode(instanceId, session.session_id, targetMode).catch((err) => {
    log.debug('ai', `ACP re-apply mode failed: ${String(err)}`);
  });
}

/**
 * Apply the connection's configured model to a fresh ACP session.
 *
 * ACP 0.14 removed the dedicated `session/set_model` request; model selection is
 * a session config option with category `"model"`. Agents without such an option
 * have no model selector — skip silently (debug log), never fail the send.
 */
export async function applyConnectionModelOption(
  instanceId: string,
  session: AcpSessionResult,
  model: string | undefined,
): Promise<void> {
  if (!model || !session.session_id) return;
  const modelOption = session.config_options?.find((opt) => opt.category === 'model');
  if (!modelOption) {
    log.debug('ai', 'ACP model default skipped: agent reports no model-category config option');
    return;
  }
  try {
    await tauriApi.acpSessionSetConfigOption(instanceId, session.session_id, modelOption.id, model);
    updateConfigOptionValue(modelOption.id, model);
  } catch (err) {
    // Agent may reject an unknown model id — not fatal, proceed without it.
    log.debug('ai', `ACP set model config option failed: ${String(err)}`);
  }
}

/** Cache the agent-reported model list on the connection for the config dialog. */
export function cacheAgentModels(connection: Connection | null, session: AcpSessionResult): void {
  if (session.available_models.length > 0 && connection) {
    setAgentModels(
      connection.id,
      session.available_models.map((m) => ({
        modelId: m.model_id,
        name: m.name,
        description: m.description,
      })),
      session.current_model,
    );
  }
}

/**
 * Apply the standard configuration sequence for a FRESH chat session (never a
 * session/load|resume restoration): publish modes + config options for the UI,
 * backfill connection capabilities, re-assert the conversation's remembered
 * permission mode, and set the connection's configured model.
 */
export async function applyFreshSessionConfig(
  instanceId: string,
  session: AcpSessionResult,
  connection: Connection | null,
): Promise<void> {
  setSessionModes(session.modes ?? null);
  setSessionConfigOptions(session.config_options ?? null);
  backfillAcpCapabilities(connection?.id, session);
  // Fresh session (respawn on scope change / new conversation / new segment)
  // resets to the agent default — re-assert the conversation's remembered mode.
  reapplySessionMode(instanceId, session, connection, false);
  // Set model via the model-category config option (replaces CLI arg injection)
  await applyConnectionModelOption(instanceId, session, connection?.config?.model);
}
