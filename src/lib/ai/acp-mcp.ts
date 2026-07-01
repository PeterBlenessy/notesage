// Assemble the MCP servers attached to an ACP session at `session/new` /
// `session/load` (task #11). Built from the same `mcp-store` registry the
// direct-API tool-calling path uses, filtered by project scope AND the agent's
// advertised MCP transport capabilities. Env secrets are NOT resolved here —
// only `{ secret: true }` references travel over IPC; the backend resolves the
// real values from the keychain at session-build time.

import { useMcpStore, type McpEnvValue } from '@/stores/mcp-store';
import { hasMcpCapability, type AcpAgentCapabilities } from '@/lib/ai/acp-utils';

/**
 * One MCP server input for `acpSessionNew` / `acpSessionLoad`. Mirrors the Rust
 * `AcpMcpServerInput` (camelCase over IPC) — only the fields a spawn needs, not
 * the store's `source`/`enabled`/`status` bookkeeping.
 */
export interface AcpMcpServerInput {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string[];
  env: Record<string, McpEnvValue>;
  url: string | null;
}

/**
 * Build the MCP servers to attach to an ACP session for the given agent and
 * project scope. Returns enabled, scope-matching servers whose transport the
 * agent advertises support for. An agent that advertises no MCP capability gets
 * an empty list (no MCP), which serializes the same as the legacy no-MCP path.
 */
export function buildAcpMcpServerInputs(
  capabilities: AcpAgentCapabilities | null | undefined,
  selectedProjectPaths: string[],
): AcpMcpServerInput[] {
  const servers = useMcpStore.getState().getActiveServers(selectedProjectPaths);
  return servers
    .map((s) => ({
      id: s.id,
      name: s.name,
      transport: (s.transport ?? 'stdio') as 'stdio' | 'http',
      command: s.command ?? '',
      args: s.args ?? [],
      env: s.env ?? {},
      url: s.url ?? null,
    }))
    .filter((s) => hasMcpCapability(capabilities, s.transport));
}
