/**
 * MCP tools for the chat paths that run their own tool loop: direct API,
 * bundled local AI and the Copilot language server. (ACP agents are handed
 * the server configs instead and connect themselves, see `acp-mcp.ts`.)
 *
 * This is the one place that reads `mcp-store` for tool calling. It answers
 * three questions:
 *   - which tool definitions does a conversation's model get
 *     ({@link getMcpToolDefinitions}),
 *   - which server and original tool does a model-facing name stand for
 *     ({@link resolveMcpTool}),
 *   - under which key is a tool's approval stored ({@link mcpPermissionKey}).
 *
 * Everything a server reports (names, descriptions, schemas) is third-party
 * text. It only ever travels in the tool-definition channel, capped in
 * length, and never into the system prompt.
 */

import { log } from '@/lib/logger';
import { useMcpStore, type McpServerEntry, type McpServerStatus, type McpToolInfo } from '@/stores/mcp-store';
import type { ToolDefinition } from '@/lib/ai/types';
import { buildMcpToolNames, isMcpToolName, type McpToolIdentity } from './tool-naming';
import { sanitizeToolSchema } from './tool-schema';

/**
 * Most MCP tools offered to a model in one request. Providers cap the tool
 * list (OpenAI at 128 functions) and tool choice degrades long before that;
 * built-in and skill tools need room in the same list.
 */
export const MCP_MAX_TOOLS_OFFERED = 64;

/**
 * Most characters of MCP tool definitions (name + description + schema) in
 * one request, roughly 15K tokens. The definitions are resent on every turn.
 */
export const MCP_MAX_TOOL_DEFINITION_CHARS = 60_000;

/** Longest tool description passed on from a server. */
export const MCP_TOOL_DESCRIPTION_MAX_CHARS = 1024;

/** A model-facing MCP tool name resolved to what a call needs. */
export interface McpToolTarget extends McpToolIdentity {
  /** Model-facing name (`mcp__<server>__<tool>`). */
  exposedName: string;
  /** Project the server belongs to; `null` for a global server. */
  projectRoot: string | null;
  /** Server status when resolved. Only `running` can take a call. */
  status: McpServerStatus;
}

interface CatalogEntry extends McpToolIdentity {
  server: McpServerEntry;
  tool: McpToolInfo;
}

/**
 * Name every tool of every enabled server in scope. Stopped and failed
 * servers are included on purpose: a name must not change, or stop
 * resolving, because a different server went down between the request that
 * listed the tools and the call that uses one.
 */
function buildCatalog(projectPaths: string[]): Map<string, CatalogEntry> {
  const servers = useMcpStore.getState().getActiveServers(projectPaths);
  const entries: CatalogEntry[] = [];
  for (const server of servers) {
    for (const tool of server.tools) {
      entries.push({ serverId: server.id, serverName: server.name, toolName: tool.name, server, tool });
    }
  }
  return buildMcpToolNames(entries).byName;
}

/** Third-party text for the description field: single-spaced, capped. */
function cleanDescription(raw: string | null, entry: CatalogEntry): string {
  // eslint-disable-next-line no-control-regex
  const text = (raw ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!text) return `Tool "${entry.toolName}" from the MCP server "${entry.serverName}".`;
  if (text.length <= MCP_TOOL_DESCRIPTION_MAX_CHARS) return text;
  return `${text.slice(0, MCP_TOOL_DESCRIPTION_MAX_CHARS - 1)}…`;
}

/**
 * Tool definitions for the MCP tools a conversation may use: tools of
 * servers that are enabled, running, and global or attached to one of
 * `projectPaths`. A tool whose schema no provider would accept is left out
 * with a warning, and the list is capped ({@link MCP_MAX_TOOLS_OFFERED},
 * {@link MCP_MAX_TOOL_DEFINITION_CHARS}) with a warning naming what was
 * dropped, so a short list is never mistaken for a model ignoring its tools.
 */
export function getMcpToolDefinitions(projectPaths: string[]): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];
  const dropped: string[] = [];
  let totalChars = 0;

  // Same set as `mcp-store.getActiveTools(projectPaths)` (enabled, running,
  // in scope), read per server so a tool is attributed to the server that
  // lists it rather than to the `server_id` it claims.
  for (const [exposedName, entry] of buildCatalog(projectPaths)) {
    if (entry.server.status !== 'running') continue;

    const sanitized = sanitizeToolSchema(entry.tool.input_schema);
    if (!sanitized.ok) {
      log.warn('mcp', `Skipping MCP tool "${entry.toolName}" of server "${entry.serverName}": ${sanitized.reason}`);
      continue;
    }
    const definition: ToolDefinition = {
      name: exposedName,
      description: cleanDescription(entry.tool.description, entry),
      input_schema: sanitized.schema,
    };
    const chars =
      definition.name.length + definition.description.length + JSON.stringify(definition.input_schema).length;
    if (definitions.length >= MCP_MAX_TOOLS_OFFERED || totalChars + chars > MCP_MAX_TOOL_DEFINITION_CHARS) {
      dropped.push(exposedName);
      continue;
    }
    totalChars += chars;
    definitions.push(definition);
  }

  if (dropped.length > 0) {
    log.warn('mcp', 'MCP tool list capped; some tools are not offered to the model', {
      offered: definitions.length,
      dropped,
      maxTools: MCP_MAX_TOOLS_OFFERED,
      maxChars: MCP_MAX_TOOL_DEFINITION_CHARS,
    });
  }
  return definitions;
}

/**
 * Resolve a model-facing tool name to its server and original tool name, for
 * the same scope the definitions were built with. `null` when the name is
 * not an MCP tool of an enabled server in scope (the server was removed or
 * disabled, or the model made the name up).
 */
export function resolveMcpTool(name: string, projectPaths: string[]): McpToolTarget | null {
  if (!isMcpToolName(name)) return null;
  const entry = buildCatalog(projectPaths).get(name);
  if (!entry) return null;
  return {
    exposedName: name,
    serverId: entry.serverId,
    serverName: entry.serverName,
    toolName: entry.toolName,
    projectRoot: entry.server.projectRoot ?? null,
    status: entry.server.status,
  };
}

/**
 * Key under which an MCP tool's approval is stored in `permission-store`
 * (`toolCallSession` / `toolCallAlways`).
 *
 * It is built from the server id and the ORIGINAL tool name, never from the
 * model-facing name: that one can change (a hash is added when a second
 * server claims it) and an approval must not move to a different tool with
 * it. A project server's key also carries its project, because two projects
 * may each define a server with the same id. It can never equal a built-in
 * tool name, so the read-only auto-allow list does not apply: an MCP tool is
 * only ever allowed by an explicit grant.
 */
export function mcpPermissionKey(target: Pick<McpToolTarget, 'serverId' | 'toolName' | 'projectRoot'>): string {
  const scope = target.projectRoot ? `@${target.projectRoot}` : '';
  return `mcp:${target.serverId}${scope}:${target.toolName}`;
}
