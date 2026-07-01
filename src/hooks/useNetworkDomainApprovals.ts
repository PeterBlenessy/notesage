import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import { usePermissionStore } from '@/stores/permission-store';
import { useDomainRequestStore } from '@/stores/domain-request-store';
import { getAllAcpAgentEntries, DEFAULT_AGENT_KEY, TASK_AGENT_KEY } from '@/lib/ai/acp-agent-state';
import { useSessionRunStore, ACTIVE_STATUSES } from '@/stores/session-run-store';
import { runAwaitingPermission } from '@/lib/ai/session-run';

interface DomainRequestEvent {
  instanceId: string;
  agentId: string;
  domain: string;
  port: number;
  requestId: string;
}

/**
 * Always-mounted owner of network-domain approvals. Mount once at the app root
 * (App.tsx) — NOT inside the command-bar stream, which unmounts when the bar is
 * collapsed.
 *
 * The agent network proxy emits `network-domain-request` whenever a sandboxed
 * agent hits a domain outside its static allowlist (e.g. Claude Code's telemetry
 * endpoints, which aren't in the built-in list). This hook:
 *
 *  1. Resolves the requesting instance back to its connection via the ACP agent
 *     registry (the proxy is only ever used by ACP agents), so the per-connection
 *     allowlist + "allow always" persistence are scoped correctly.
 *  2. Auto-approves domains already allowed (built-in for the agent, or the
 *     connection's session/global allowlist) — so a domain the user approved
 *     "always" never re-prompts, even live without an agent respawn.
 *  3. Parks anything else in `domain-request-store` for `DomainApprovalStack` to
 *     render as a card — visible whether or not the command bar is expanded.
 *
 * Without this (the regression after Classic Layout removal), a collapsed command
 * bar meant no listener at all: every unknown-domain request blocked for the
 * proxy's full 30 s timeout, wedging agents that phone home at startup.
 */
export function useNetworkDomainApprovals(): void {
  useEffect(() => {
    const unlistenRequest = listen<DomainRequestEvent>('network-domain-request', (event) => {
      const { instanceId, agentId, domain, port, requestId } = event.payload;

      // Map the requesting instance back to its conversation + connection (the
      // proxy is only used by ACP agents, so the instance is in the registry).
      const entry = getAllAcpAgentEntries().find(([, a]) => a.instanceId === instanceId);
      const conversationKey = entry?.[0] ?? null;
      const connectionId = entry?.[1].connectionId ?? null;

      const provOpt = PROVIDER_OPTIONS.find((o) => o.agentBinary === agentId);
      const builtIn = provOpt?.installMeta?.allowedDomains ?? [];

      // Auto-approve when already allowed (built-in or the connection's
      // session/global allowlist). `null` projectRoot → checks the global bucket,
      // which is where Settings-added domains land.
      const allowed = connectionId
        ? usePermissionStore.getState().isDomainAllowed(connectionId, domain, builtIn, null)
        : builtIn.some((p) => matchesDomain(p, domain));
      if (allowed) {
        invoke('network_domain_respond', { instanceId, requestId, decision: 'allow_once' }).catch(
          (err) => log.warn('ai', 'Failed to auto-approve domain', err),
        );
        return;
      }

      useDomainRequestStore.getState().addRequest({
        instanceId,
        agentId,
        domain,
        port,
        requestId,
        connectionId: connectionId ?? '',
      });

      // Reflect the block in the owning conversation's run-state so the orb
      // pulses "needs you" and the history row badges — same treatment as a tool
      // permission. Only when the conversation has a live turn (a real
      // conversation key, not a reserved sentinel, with an active run); the
      // global card already covers the no-turn case (eager-spawn telemetry). The
      // flip BACK to `running` is automatic: `useAcpSessionListeners` calls
      // `runRunning` on the next session-update once the agent resumes.
      if (
        conversationKey &&
        conversationKey !== DEFAULT_AGENT_KEY &&
        conversationKey !== TASK_AGENT_KEY
      ) {
        const run = useSessionRunStore.getState().runs[conversationKey];
        if (run && ACTIVE_STATUSES.includes(run.status)) {
          runAwaitingPermission(conversationKey);
        }
      }
    });

    // The proxy resolves its OWN 30 s timeout (and any backend-side deny) with a
    // `network-domain-resolved` event — drop a stale card if that fires first.
    const unlistenResolved = listen<{ requestId: string }>('network-domain-resolved', (event) => {
      useDomainRequestStore.getState().removeRequest(event.payload.requestId);
    });

    return () => {
      unlistenRequest.then((fn) => fn());
      unlistenResolved.then((fn) => fn());
    };
  }, []);
}

/** Mirror of the permission store's domain matcher for the no-connection path. */
function matchesDomain(pattern: string, domain: string): boolean {
  const p = pattern.toLowerCase();
  const d = domain.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    return d.endsWith(suffix) && d.length > suffix.length;
  }
  return p === d;
}
