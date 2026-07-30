// ACP session/new mcpServers → pi MCP extension handoff (task #14).
//
// Secrets discipline: Notesage resolves keychain secrets into the env values
// of these configs (build_acp_mcp_servers) — they must NEVER touch disk. The
// handoff therefore rides the pi child's process ENVIRONMENT
// (NOTESAGE_MCP_SERVERS), not a config file; the shipped mcp-tools extension
// reads it at startup. Stdio servers only — http/sse/acp transports are
// handled by agents natively and are out of scope for the preset (mirrors the
// Goose preset's stdio-only pass-through).

import type { McpServer } from "@agentclientprotocol/sdk";

export const MCP_SERVERS_ENV = "NOTESAGE_MCP_SERVERS";

export interface McpStdioHandoff {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function stdioHandoffs(servers: McpServer[] | undefined): McpStdioHandoff[] {
  const out: McpStdioHandoff[] = [];
  for (const s of servers ?? []) {
    // McpServerStdio is the untagged variant (no `type` discriminant).
    if ("type" in s && s.type !== undefined) continue;
    if (typeof s.command !== "string") continue;
    out.push({
      name: s.name,
      command: s.command,
      args: s.args ?? [],
      env: Object.fromEntries((s.env ?? []).map((e) => [e.name, e.value])),
    });
  }
  return out;
}

/** Env map for the pi spawn. Empty handoff list → no env var at all. */
export function mcpEnvFor(servers: McpServer[] | undefined): Record<string, string> {
  const handoffs = stdioHandoffs(servers);
  return handoffs.length ? { [MCP_SERVERS_ENV]: JSON.stringify(handoffs) } : {};
}

/** Stable respawn key — a live pi child must be restarted when this changes
 *  (its extension snapshot the env at startup). */
export function mcpKeyFor(servers: McpServer[] | undefined): string {
  return JSON.stringify(stdioHandoffs(servers));
}
