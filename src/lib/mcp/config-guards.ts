/**
 * Runtime validation for MCP server configs crossing the Rust → frontend
 * trust boundary.
 *
 * `mcp_discover_configs` and `mcp_import_configs` return configs that Rust
 * parsed out of OTHER TOOLS' config files (Claude Desktop, Cursor, VS Code)
 * or user-editable `mcp.json` files. Those files are foreign input — a
 * malformed entry must be dropped here, not asserted into shape with an
 * `invoke<...>` type parameter.
 *
 * Pattern follows `parseRawInput` in `src/lib/ai/acp-utils.ts`: narrow from
 * `unknown` with typeof/Array.isArray checks and degrade gracefully (skip the
 * entry + log) on mismatch.
 */

import { log } from '@/lib/logger';
import type { McpEnvValue } from '@/stores/mcp-store';

/**
 * Wire shape of one MCP server config as serialized by the Rust
 * `McpServerConfig` struct (`src-tauri/src/commands/mcp.rs`).
 */
export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, McpEnvValue>;
  source: 'notesage_global' | 'notesage_project' | 'claude_desktop' | 'cursor' | 'vscode';
  enabled: boolean;
  transport?: 'stdio' | 'http';
  url?: string | null;
}

const MCP_SOURCES = new Set([
  'notesage_global',
  'notesage_project',
  'claude_desktop',
  'cursor',
  'vscode',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * True when `v` matches the `McpEnvValue` union — a bare plaintext string or
 * a `{ secret: true }` keychain reference (Rust `McpSecretRef`).
 */
export function isMcpEnvValue(v: unknown): v is McpEnvValue {
  if (typeof v === 'string') return true;
  return isRecord(v) && typeof v.secret === 'boolean';
}

/**
 * Validate one entry from `mcp_import_configs` / `mcp_discover_configs`
 * against the Rust `McpServerConfig` wire shape.
 */
export function isImportedMcpConfig(v: unknown): v is McpServerConfig {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.command !== 'string') {
    return false;
  }
  if (!Array.isArray(v.args) || !v.args.every((a) => typeof a === 'string')) return false;
  if (!isRecord(v.env) || !Object.values(v.env).every(isMcpEnvValue)) return false;
  if (typeof v.source !== 'string' || !MCP_SOURCES.has(v.source)) return false;
  if (typeof v.enabled !== 'boolean') return false;
  if (v.transport !== undefined && v.transport !== 'stdio' && v.transport !== 'http') return false;
  if (v.url !== undefined && v.url !== null && typeof v.url !== 'string') return false;
  return true;
}

/**
 * Narrow an untrusted command result to the valid MCP configs it contains.
 * Malformed entries (and a non-array payload) are dropped with a log entry;
 * `skipped` reports how many entries were rejected so UI surfaces can toast.
 */
export function filterValidMcpConfigs(
  value: unknown,
  context: string,
): { configs: McpServerConfig[]; skipped: number } {
  if (!Array.isArray(value)) {
    log.warn('mcp', `${context}: expected an array of MCP configs, got ${typeof value} — ignoring`);
    return { configs: [], skipped: 0 };
  }
  const configs: McpServerConfig[] = [];
  let skipped = 0;
  for (const entry of value) {
    if (isImportedMcpConfig(entry)) {
      configs.push(entry);
    } else {
      skipped++;
      log.warn('mcp', `${context}: skipping malformed MCP config entry`, entry);
    }
  }
  return { configs, skipped };
}

/**
 * Extract the `mcpServers` record from a parsed `mcp.json` payload.
 * Returns `{}` when the file content is not the expected envelope
 * (e.g. a half-written or hand-edited file) instead of throwing.
 */
export function extractMcpServersRecord(parsed: unknown): Record<string, unknown> {
  if (!isRecord(parsed)) return {};
  const servers = parsed.mcpServers;
  return isRecord(servers) ? (servers as Record<string, unknown>) : {};
}
