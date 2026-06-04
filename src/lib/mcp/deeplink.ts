/**
 * Parser for `notesage://mcp/install` deep links.
 *
 * A website or docs page can offer a one-click "Add to Notesage" link that
 * pre-fills the MCP Add dialog. The link carries the same fields the catalog
 * provides; nothing is installed until the user reviews and confirms in the
 * validate-first Add dialog (the dialog IS the confirmation step).
 *
 * SECURITY: a deep link is attacker-controllable — any webpage, email, or chat
 * message can hand the OS a `notesage://mcp/install?command=...` URL. The Add
 * dialog spawns `command` as a subprocess on "Test"/"Add", so an unconstrained
 * command turns one benign-looking click into arbitrary code execution. Two
 * defenses live here and in the dialog:
 *   1. (this file) a hard allowlist on the stdio command — only known package
 *      runners pass; anything with a path separator or off-list is rejected.
 *   2. (the dialog) deep-link-sourced prefills are flagged untrusted and gated
 *      behind an explicit "I trust this source" acknowledgement.
 *
 * Examples:
 *   notesage://mcp/install?name=Filesystem&command=npx&args=-y%20@modelcontextprotocol/server-filesystem
 *   notesage://mcp/install?name=Sentry&transport=http&url=https://mcp.sentry.dev/mcp
 */

import type { CatalogPrefill } from '@/components/settings/McpServersSettings';

/** Parsed install request — the shape the Add dialog consumes as a prefill. */
export type McpInstallRequest = CatalogPrefill;

/**
 * Result of parsing an install URL:
 *   - `{ ok: true, prefill }`  — a well-formed, allowed install request.
 *   - `{ ok: false, reason }`  — a well-formed install URL whose command is
 *     NOT on the allowlist (the caller should surface `reason` and refuse).
 *   - `null`                   — not an install URL at all (wrong protocol/path
 *     or missing required fields); the caller should ignore it silently.
 */
export type McpInstallParseResult =
  | { ok: true; prefill: McpInstallRequest }
  | { ok: false; reason: string };

/**
 * Commands a deep link is allowed to pre-fill for a stdio MCP server.
 *
 * These are the standard package runners / interpreters MCP servers ship with.
 * The list is intentionally small and exact-match only — no shells, no env
 * wrappers, no absolute paths. Even these still permit running an arbitrary
 * package (e.g. `npx -y <anything>`), which is why the dialog adds a human
 * consent gate on top of this allowlist.
 */
export const MCP_ALLOWED_COMMANDS = [
  'npx',
  'uvx',
  'uv',
  'node',
  'python',
  'python3',
  'deno',
  'bun',
  'bunx',
] as const;

/**
 * True only if `cmd` is EXACTLY one of the allowlisted runners. Any path
 * separator (`/` or `\`) or off-list value is rejected — this blocks
 * `/bin/bash`, `./evil`, `/usr/bin/env`, `sh`, etc.
 */
export function isAllowedMcpCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  if (!trimmed) return false;
  if (trimmed.includes('/') || trimmed.includes('\\')) return false;
  return (MCP_ALLOWED_COMMANDS as readonly string[]).includes(trimmed);
}

/**
 * Parse a `notesage://mcp/install?...` URL into an Add-dialog prefill.
 *
 * - `args` is space-separated (each token may be percent-encoded).
 * - `transport` defaults to `stdio`; `http` requires a `url`.
 * - `env` keys come from repeatable `env` params (`env=KEY` or `env=KEY:secret`)
 *   — values are always left blank (secrets are entered by the user).
 * - stdio commands are checked against {@link MCP_ALLOWED_COMMANDS}; a
 *   disallowed command returns `{ ok: false }` rather than a prefill.
 */
export function parseMcpInstallUrl(raw: string): McpInstallParseResult | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'notesage:') return null;
  // Accept both notesage://mcp/install and notesage:mcp/install shapes.
  const path = `${url.hostname}${url.pathname}`.replace(/^\/+|\/+$/g, '');
  if (path !== 'mcp/install') return null;

  const q = url.searchParams;
  const transport = q.get('transport') === 'http' ? 'http' : 'stdio';
  const command = (q.get('command') ?? '').trim();
  const serverUrl = (q.get('url') ?? '').trim();

  // A valid request must have a command (stdio) or a url (http).
  if (transport === 'http') {
    if (!serverUrl) return null;
  } else if (!command) {
    return null;
  }

  // Hard allowlist gate for stdio commands. A disallowed command is a
  // well-formed install URL, so we surface it as `{ ok: false }` (not null) so
  // the caller can tell the user exactly what was rejected.
  if (transport === 'stdio' && !isAllowedMcpCommand(command)) {
    return {
      ok: false,
      reason: `"${command}" is not an allowed MCP command. Allowed commands: ${MCP_ALLOWED_COMMANDS.join(', ')}.`,
    };
  }

  const argsRaw = (q.get('args') ?? '').trim();
  const args = argsRaw ? argsRaw.split(/\s+/) : [];

  const env = q.getAll('env').map((entry) => {
    const [key, flag] = entry.split(':');
    return { key: key.trim(), value: '', secret: flag === 'secret' };
  }).filter((e) => e.key);

  const name = (q.get('name') ?? '').trim()
    || (transport === 'http' ? serverUrl : command.split('/').pop()?.replace(/^@/, ''))
    || 'server';

  return {
    ok: true,
    prefill: {
      name,
      command: transport === 'http' ? '' : command,
      args: transport === 'http' ? [] : args,
      env,
      transport,
      url: transport === 'http' ? serverUrl : null,
      // Deep-link-sourced prefills are untrusted by construction — the dialog
      // gates Test/Add behind an explicit acknowledgement.
      untrusted: true,
    },
  };
}
