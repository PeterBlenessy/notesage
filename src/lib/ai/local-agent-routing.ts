// Local Agent (Goose preset) interactive routing (task #13).
//
// The preset is the agentic-chat default for "Local AI": when healthy, the
// interactive slot routes to the agent (Path 2, ACP). When the preset is
// degraded — binary missing, spawn failed, or the last smoke test failed — we
// fall back to the existing direct local chat (Path 4) against a local_bundled
// connection so chat never dead-ends. Every non-preset connection is returned
// unchanged.

import { isLocalAgentPreset } from '@/lib/ai/acp-agent-state';
import type { Connection } from '@/lib/ai/connections';

/**
 * The Path-4 fallback target for a degraded preset: the first `local_bundled`
 * connection (the bundled llama-server's own direct-chat connection). `null`
 * when none exists.
 */
export function findLocalBundledFallback(connections: Connection[]): Connection | null {
  return connections.find((c) => c.authMethod === 'local_bundled') ?? null;
}

/**
 * Resolve which connection the interactive slot should actually use, applying
 * the degraded-preset → Path-4 fallback.
 *
 * - Non-preset connection → returned unchanged.
 * - Healthy preset → returned unchanged (routes to the agent).
 * - Degraded preset → the local_bundled fallback if one exists, else the preset
 *   unchanged (no fallback available; the agent path will surface its own error
 *   rather than silently pretending to be healthy).
 */
export function resolveInteractiveConnection(
  effective: Connection | null,
  connections: Connection[],
  presetDegraded: boolean,
): Connection | null {
  if (!effective || !isLocalAgentPreset(effective) || !presetDegraded) return effective;
  return findLocalBundledFallback(connections) ?? effective;
}

/**
 * Classify an error thrown by the agent send/spawn path as a "preset is
 * unhealthy" signal (binary missing, spawn/connect failure, server down) versus
 * an ordinary turn error. Only the former should flip the degraded flag so a
 * one-off model error doesn't permanently route around the agent.
 */
export function isAgentHealthError(error: unknown): boolean {
  const msg = String(
    (error as { message?: unknown })?.message ?? error ?? '',
  ).toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('not executable') ||
    msg.includes('spawn') ||
    msg.includes('failed to start') ||
    msg.includes('is not running') ||
    msg.includes('/health') ||
    msg.includes('connection refused') ||
    msg.includes('econnrefused') ||
    msg.includes('agent spawn failed')
  );
}
