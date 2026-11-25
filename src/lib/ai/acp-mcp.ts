// Assemble the MCP servers attached to an ACP session at `session/new` /
// `session/load` (task #11). Built from the same `mcp-store` registry the
// direct-API tool-calling path uses, filtered by project scope AND the agent's
// advertised MCP transport capabilities.
//
// What travels here is the app's own IPC input, not the ACP wire format. The
// backend (`build_acp_mcp_servers` in `src-tauri/src/commands/acp/helpers.rs`)
// turns each input into the ACP `McpServer` the agent receives:
//   stdio: { name, command, args, env: [{ name, value }] }
//   http:  { type: "http", name, url, headers: [{ name, value }] }
// and that is also where secrets are resolved: env and header values marked
// `{ secret: true }` are looked up in the keychain, and an OAuth bearer token
// is attached for an authorised remote server. Only the references cross IPC;
// the agent never receives a `{ secret: true }` placeholder, and the renderer
// never sees a secret value.

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
  /**
   * Static request headers of a remote server (an API key, say). Same value
   * shape as `env`: plaintext, or a keychain reference the backend resolves.
   * Omitted when the server has none.
   */
  headers?: Record<string, McpEnvValue>;
}

/** `headers` of a store entry, when the store carries them (remote servers). */
function entryHeaders(entry: object): Record<string, McpEnvValue> | undefined {
  const headers = (entry as { headers?: unknown }).headers;
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) return undefined;
  const out: Record<string, McpEnvValue> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[name] = value;
    else if (typeof value === 'object' && value !== null && 'secret' in value) {
      out[name] = { secret: (value as { secret: unknown }).secret === true };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build the MCP servers to attach to an ACP session for the given agent and
 * project scope: enabled servers that are global or belong to a selected
 * project, and whose transport the agent accepts (see `hasMcpCapability`:
 * stdio for every initialised agent, http only when advertised). An agent
 * with no capabilities at all gets an empty list, which serializes the same
 * as the legacy no-MCP path.
 *
 * The app's `http` transport is Streamable HTTP, so it is gated on the
 * agent's `http` capability; the app has no legacy-SSE transport to offer,
 * so `sse` is never used here.
 */
export function buildAcpMcpServerInputs(
  capabilities: AcpAgentCapabilities | null | undefined,
  selectedProjectPaths: string[],
): AcpMcpServerInput[] {
  const servers = useMcpStore.getState().getActiveServers(selectedProjectPaths);
  return servers
    .map((s): AcpMcpServerInput => {
      const transport = (s.transport ?? 'stdio') as 'stdio' | 'http';
      const headers = transport === 'http' ? entryHeaders(s) : undefined;
      return {
        id: s.id,
        name: s.name,
        transport,
        command: s.command ?? '',
        args: s.args ?? [],
        env: s.env ?? {},
        url: s.url ?? null,
        ...(headers ? { headers } : {}),
      };
    })
    .filter((s) => hasMcpCapability(capabilities, s.transport));
}
