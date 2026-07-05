import type { McpTransport } from '@/stores/mcp-store';

/**
 * One editable env-var row. `secret` marks it for keychain storage (the value
 * is written to the keychain, only a `{ secret: true }` reference to mcp.json).
 * `stored` flags a secret loaded from an existing server but not yet revealed.
 */
export interface EnvRow {
  key: string;
  value: string;
  secret?: boolean;
  stored?: boolean;
}

/** Pre-filled values when adding a server from the catalog. */
export interface CatalogPrefill {
  name: string;
  command: string;
  args: string[];
  env: EnvRow[];
  transport?: McpTransport;
  url?: string | null;
  /**
   * `true` when the prefill came from an attacker-controllable source (a
   * `notesage://mcp/install` deep link). The Add dialog renders a warning
   * banner and gates Test/Add behind an explicit acknowledgement when set.
   * The in-app catalog and manual adds are trusted and leave this unset.
   */
  untrusted?: boolean;
}
