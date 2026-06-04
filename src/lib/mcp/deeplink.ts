/**
 * Parser for `notesage://mcp/install` deep links.
 *
 * A website or docs page can offer a one-click "Add to Notesage" link that
 * pre-fills the MCP Add dialog. The link carries the same fields the catalog
 * provides; nothing is installed until the user reviews and confirms in the
 * validate-first Add dialog (the dialog IS the confirmation step).
 *
 * Examples:
 *   notesage://mcp/install?name=Filesystem&command=npx&args=-y%20@modelcontextprotocol/server-filesystem
 *   notesage://mcp/install?name=Sentry&transport=http&url=https://mcp.sentry.dev/mcp
 */

import type { CatalogPrefill } from '@/components/settings/McpServersSettings';

/** Parsed install request — the shape the Add dialog consumes as a prefill. */
export type McpInstallRequest = CatalogPrefill;

/**
 * Parse a `notesage://mcp/install?...` URL into an Add-dialog prefill.
 * Returns `null` for any URL that isn't a well-formed install link.
 *
 * - `args` is space-separated (each token may be percent-encoded).
 * - `transport` defaults to `stdio`; `http` requires a `url`.
 * - `env` keys come from repeatable `env` params (`env=KEY` or `env=KEY:secret`)
 *   — values are always left blank (secrets are entered by the user).
 */
export function parseMcpInstallUrl(raw: string): McpInstallRequest | null {
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
    name,
    command: transport === 'http' ? '' : command,
    args: transport === 'http' ? [] : args,
    env,
    transport,
    url: transport === 'http' ? serverUrl : null,
  };
}
