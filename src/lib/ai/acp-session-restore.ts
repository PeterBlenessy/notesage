// Restoration preference chain for ACP sessions: resume → load → new,
// with `session/list` as a sanity check when both resume and load fail.
//
// Pulled out of `useAcpLifecycle.ts` so the logic is unit-testable.

import { log } from '@/lib/logger';
import { tauriApi } from '@/lib/tauri';
import {
  type AcpAgentCapabilities,
  type AcpSessionResult,
  hasSessionCapability,
  hasLoadSessionCapability,
} from '@/lib/ai/acp-utils';

import type { AcpMcpServerInput } from '@/lib/ai/acp-mcp';

export interface AcpSessionRestoreDeps {
  instanceId: string;
  cwd: string;
  /** Previously stored session ID (from Conversation.acpSessionId or branchSessions). */
  storedSessionId: string | undefined;
  /** Agent capabilities from AcpSpawnResult. */
  capabilities: AcpAgentCapabilities | null | undefined;
  /**
   * MCP servers to attach to the session (task #11). Passed to `session/load`
   * and `session/new` (ACP treats load's list as the complete set). `resume` is
   * a live takeover and keeps the session's existing servers, so it's not sent.
   */
  mcpServers?: AcpMcpServerInput[];
}

/**
 * Resolve an ACP session, preferring cheapest-first recovery when a stored ID exists:
 *
 * 1. `session/resume` — live-takeover, no replay (agent must still have the session in memory)
 * 2. `session/load` — replay-based, works even after agent restart (gated on `loadSession`)
 * 3. `session/list` — sanity check when the first two fail; if the stored ID isn't listed,
 *    we don't bother retrying and go straight to creating a new session
 * 4. `session/new` — final fallback
 *
 * Each step is independently optional based on agent capabilities; missing capabilities are
 * silently skipped. All failures log at info level and fall through to the next step.
 */
export async function restoreOrCreateAcpSession(
  deps: AcpSessionRestoreDeps,
): Promise<AcpSessionResult> {
  const { instanceId, cwd, storedSessionId, capabilities, mcpServers } = deps;
  const supportsLoad = hasLoadSessionCapability(capabilities);
  const supportsResume = hasSessionCapability(capabilities, 'resume');
  const supportsList = hasSessionCapability(capabilities, 'list');

  if (storedSessionId) {
    // 1. Try resume first (lightest).
    if (supportsResume) {
      try {
        const session = await tauriApi.acpSessionResume(instanceId, storedSessionId, cwd);
        log.info('ai', `ACP session restored via session/resume (${storedSessionId})`);
        return session;
      } catch (err) {
        log.info('ai', `ACP session/resume failed, trying load: ${String(err)}`);
      }
    }

    // 2. Try load (replay-based).
    if (supportsLoad) {
      try {
        const session = await tauriApi.acpSessionLoad(instanceId, storedSessionId, cwd, mcpServers);
        log.info('ai', `ACP session restored via session/load (${storedSessionId})`);
        return session;
      } catch (err) {
        log.info('ai', `ACP session/load failed: ${String(err)}`);
      }
    }

    // 3. Before we give up, ask the agent whether the session actually exists.
    //    If it's gone, no point in retrying — go straight to new.
    //    If list isn't supported either, we can't verify, just fall through.
    if (supportsList) {
      try {
        const result = await tauriApi.acpSessionList(instanceId, cwd);
        const known = result.sessions.some((s) => s.session_id === storedSessionId);
        if (!known) {
          log.info('ai', `ACP session/list confirms ${storedSessionId} is gone — creating new`);
        } else {
          log.info(
            'ai',
            `ACP session/list reports ${storedSessionId} exists but resume+load failed — creating new`,
          );
        }
      } catch (err) {
        log.info('ai', `ACP session/list failed (non-fatal): ${String(err)}`);
      }
    }
  }

  // 4. Final fallback.
  const session = await tauriApi.acpSessionNew(instanceId, cwd, mcpServers);
  log.info('ai', `ACP session created fresh (session/new)`);
  return session;
}
