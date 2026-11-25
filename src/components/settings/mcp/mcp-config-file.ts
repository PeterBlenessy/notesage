import { invoke } from '@tauri-apps/api/core';

/**
 * `mcp.json` exists but its servers cannot be read (invalid JSON, not the
 * expected envelope, or the read itself failed). Callers must NOT save: the
 * save rewrites the whole file, so treating this as "no servers yet" would
 * delete every server the user has configured.
 */
export class McpConfigUnreadableError extends Error {
  constructor(configPath: string, cause: unknown) {
    super(`Cannot read MCP config at ${configPath}: ${String(cause)}`);
    this.name = 'McpConfigUnreadableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `mcp.json` a server is defined in, which is the file an edit or a
 * removal must rewrite: the project's own file for a project-scoped server,
 * the global one for everything else (servers added by hand, from the catalog
 * or imported from another tool all live there). Other tools' own config
 * files are never written.
 */
export async function mcpConfigPathFor(
  server?: { source: string; projectRoot?: string | null },
): Promise<string> {
  if (server?.source === 'notesage-project' && server.projectRoot) {
    return `${server.projectRoot}/.notesage/mcp.json`;
  }
  const home = await invoke<string>('get_home_dir');
  return `${home}/.notesage/mcp.json`;
}

/**
 * Read the `mcpServers` record of an `mcp.json` that is about to be rewritten.
 *
 * - The file does not exist: `{}` (first server, start fresh).
 * - The file exists and holds an envelope: its `mcpServers` (`{}` if absent).
 * - Anything else: throws `McpConfigUnreadableError`.
 */
export async function readMcpServersForUpdate(configPath: string): Promise<Record<string, unknown>> {
  let exists: boolean;
  try {
    exists = await invoke<boolean>('path_exists', { path: configPath });
  } catch (err) {
    throw new McpConfigUnreadableError(configPath, err);
  }
  if (!exists) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(await invoke<string>('read_file', { path: configPath }));
  } catch (err) {
    throw new McpConfigUnreadableError(configPath, err);
  }

  if (!isRecord(parsed)) {
    throw new McpConfigUnreadableError(configPath, 'not a JSON object');
  }
  const servers = parsed.mcpServers;
  if (servers === undefined || servers === null) return {};
  if (!isRecord(servers)) {
    throw new McpConfigUnreadableError(configPath, '"mcpServers" is not an object');
  }
  return { ...servers };
}
