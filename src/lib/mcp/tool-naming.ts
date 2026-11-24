/**
 * Model-facing names for MCP tools.
 *
 * A chat model sees an MCP tool as `mcp__<server>__<tool>`. Providers accept
 * only `[a-zA-Z0-9_-]` and at most 64 characters in a tool name, while MCP
 * server and tool names are free text, so the exposed name is derived: each
 * part is sanitised, the whole is fitted into the limit, and a short
 * deterministic hash is appended whenever fitting or sanitising would make
 * two different tools share a name. The reverse map routes a call back to the
 * server id and the ORIGINAL tool name, which is what `tools/call` needs.
 *
 * Pure: no store access, so the same inputs always give the same names.
 */

/** Prefix of every model-facing MCP tool name. */
export const MCP_TOOL_PREFIX = 'mcp__';

/** Longest tool name every supported provider accepts. */
export const MCP_TOOL_NAME_MAX = 64;

const SEPARATOR = '__';
const HASH_LENGTH = 8;
/** `_` + hash. */
const HASH_SUFFIX_LENGTH = 1 + HASH_LENGTH;
/** Characters the server part keeps at minimum when a name must be shortened. */
const MIN_SERVER_PART = 16;

/** What identifies one MCP tool: the server's id and the tool's own name. */
export interface McpToolIdentity {
  serverId: string;
  /** Display name of the server, used for the readable part of the name. */
  serverName: string;
  /** Tool name exactly as the server reports it. */
  toolName: string;
}

export interface McpToolNameMap<T extends McpToolIdentity = McpToolIdentity> {
  /** Exposed name → the tool it stands for. */
  byName: Map<string, T>;
  /** Exposed name of a tool, by {@link mcpToolIdentityKey}. */
  nameOf: Map<string, string>;
}

/** Whether a tool name is in the MCP namespace (it may still be unknown). */
export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}

/** Stable key for a tool identity (server id + original tool name). */
export function mcpToolIdentityKey(tool: Pick<McpToolIdentity, 'serverId' | 'toolName'>): string {
  return `${tool.serverId}\u0000${tool.toolName}`;
}

/** Replace everything a provider would reject; never returns an empty part. */
export function sanitizeMcpNamePart(part: string): string {
  const cleaned = part.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : '_';
}

/** FNV-1a (32 bit) as fixed-width lowercase hex. Not cryptographic: it only
 *  has to keep two names apart, and collisions are re-salted by the caller. */
export function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(HASH_LENGTH, '0');
}

/** `mcp__<server>__<tool>` with no hash, or `null` when it is too long. */
function plainName(serverPart: string, toolPart: string): string | null {
  const name = `${MCP_TOOL_PREFIX}${serverPart}${SEPARATOR}${toolPart}`;
  return name.length <= MCP_TOOL_NAME_MAX ? name : null;
}

/** `mcp__<server>__<tool>_<hash>`, shortening the parts to fit the limit. */
function hashedName(serverPart: string, toolPart: string, hash: string): string {
  const budget = MCP_TOOL_NAME_MAX - MCP_TOOL_PREFIX.length - SEPARATOR.length - HASH_SUFFIX_LENGTH;
  // The tool part carries more meaning for the model, so the server part
  // gives way first, down to a floor that keeps it recognisable.
  const serverLength = Math.min(
    serverPart.length,
    Math.max(MIN_SERVER_PART, budget - toolPart.length),
  );
  const toolLength = Math.min(toolPart.length, budget - serverLength);
  return (
    `${MCP_TOOL_PREFIX}${serverPart.slice(0, serverLength)}${SEPARATOR}` +
    `${toolPart.slice(0, toolLength)}_${hash}`
  );
}

/**
 * Assign a unique, provider-safe name to every tool.
 *
 * A name is the readable `mcp__<server>__<tool>` unless that is too long or
 * is claimed by more than one tool (two servers with the same display name,
 * or names that only differ in characters sanitising replaces); those get a
 * hash of their identity appended. The result depends only on the set of
 * identities, not on their order, except for the vanishing case of a hash
 * collision, which is resolved by re-salting in identity-key order.
 *
 * Duplicate identities (same server id and tool name) share one name; the
 * first occurrence is the one the reverse map returns.
 */
export function buildMcpToolNames<T extends McpToolIdentity>(tools: readonly T[]): McpToolNameMap<T> {
  const unique = new Map<string, T>();
  for (const tool of tools) {
    const key = mcpToolIdentityKey(tool);
    if (!unique.has(key)) unique.set(key, tool);
  }

  interface Candidate {
    key: string;
    tool: T;
    serverPart: string;
    toolPart: string;
    plain: string | null;
  }
  const candidates: Candidate[] = [...unique.entries()].map(([key, tool]) => {
    const serverPart = sanitizeMcpNamePart(tool.serverName);
    const toolPart = sanitizeMcpNamePart(tool.toolName);
    return { key, tool, serverPart, toolPart, plain: plainName(serverPart, toolPart) };
  });

  const plainClaims = new Map<string, number>();
  for (const c of candidates) {
    if (c.plain) plainClaims.set(c.plain, (plainClaims.get(c.plain) ?? 0) + 1);
  }

  const byName = new Map<string, T>();
  const nameOf = new Map<string, string>();
  const needHash: Candidate[] = [];
  for (const c of candidates) {
    if (c.plain && plainClaims.get(c.plain) === 1) {
      byName.set(c.plain, c.tool);
      nameOf.set(c.key, c.plain);
    } else {
      needHash.push(c);
    }
  }

  needHash.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const c of needHash) {
    let salt = 0;
    let name = hashedName(c.serverPart, c.toolPart, shortHash(c.key));
    while (byName.has(name)) {
      salt += 1;
      name = hashedName(c.serverPart, c.toolPart, shortHash(`${c.key}\u0000${salt}`));
    }
    byName.set(name, c.tool);
    nameOf.set(c.key, name);
  }

  return { byName, nameOf };
}
