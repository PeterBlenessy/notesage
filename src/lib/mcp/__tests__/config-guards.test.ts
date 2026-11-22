import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWarn = vi.fn();
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: (...args: unknown[]) => mockWarn(...args), error: vi.fn(), debug: vi.fn() },
}));

import {
  isMcpEnvValue,
  isImportedMcpConfig,
  filterValidMcpConfigs,
  extractMcpServersRecord,
  type McpServerConfig,
} from '../config-guards';

const VALID: McpServerConfig = {
  id: 'claude_desktop:filesystem',
  name: 'filesystem',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  env: { TOKEN: 'abc', SECRET_KEY: { secret: true } },
  source: 'claude_desktop',
  enabled: true,
};

beforeEach(() => {
  mockWarn.mockClear();
});

describe('isMcpEnvValue', () => {
  it('accepts a plaintext string', () => {
    expect(isMcpEnvValue('abc')).toBe(true);
    expect(isMcpEnvValue('')).toBe(true);
  });

  it('accepts a keychain secret reference', () => {
    expect(isMcpEnvValue({ secret: true })).toBe(true);
    expect(isMcpEnvValue({ secret: false })).toBe(true);
  });

  it('rejects junk primitives and wrong object shapes', () => {
    expect(isMcpEnvValue(42)).toBe(false);
    expect(isMcpEnvValue(null)).toBe(false);
    expect(isMcpEnvValue(undefined)).toBe(false);
    expect(isMcpEnvValue({ secret: 'yes' })).toBe(false);
    expect(isMcpEnvValue({})).toBe(false);
    expect(isMcpEnvValue(['x'])).toBe(false);
  });
});

describe('isImportedMcpConfig', () => {
  it('accepts a valid stdio config', () => {
    expect(isImportedMcpConfig(VALID)).toBe(true);
  });

  it('accepts a valid http config with transport and url', () => {
    expect(
      isImportedMcpConfig({
        ...VALID,
        command: '',
        args: [],
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
      }),
    ).toBe(true);
  });

  it('accepts url null and transport omitted', () => {
    expect(isImportedMcpConfig({ ...VALID, url: null })).toBe(true);
  });

  it('rejects junk primitives', () => {
    expect(isImportedMcpConfig(null)).toBe(false);
    expect(isImportedMcpConfig(undefined)).toBe(false);
    expect(isImportedMcpConfig(42)).toBe(false);
    expect(isImportedMcpConfig('server')).toBe(false);
    expect(isImportedMcpConfig([VALID])).toBe(false);
  });

  it('rejects missing / wrong-typed core fields', () => {
    expect(isImportedMcpConfig({ ...VALID, id: 7 })).toBe(false);
    expect(isImportedMcpConfig({ ...VALID, name: undefined })).toBe(false);
    expect(isImportedMcpConfig({ ...VALID, command: null })).toBe(false);
    expect(isImportedMcpConfig({ ...VALID, enabled: 'yes' })).toBe(false);
  });

  it('rejects non-string args entries', () => {
    expect(isImportedMcpConfig({ ...VALID, args: ['ok', 42] })).toBe(false);
    expect(isImportedMcpConfig({ ...VALID, args: 'not-an-array' })).toBe(false);
  });

  it('rejects malformed env records', () => {
    expect(isImportedMcpConfig({ ...VALID, env: { KEY: 42 } })).toBe(false);
    expect(isImportedMcpConfig({ ...VALID, env: ['KEY=1'] })).toBe(false);
    expect(isImportedMcpConfig({ ...VALID, env: null })).toBe(false);
  });

  // Exactly what `serde_json` emits for a Rust `McpServerConfig` parsed out of
  // VS Code's settings (`parse_vscode_config`): every field present, `url`
  // null, and `source` spelled the way `McpConfigSource` serializes it.
  it('accepts a Rust-shaped VS Code import', () => {
    const fromRust: unknown = JSON.parse(
      '{"id":"vscode:github","name":"github","command":"npx",' +
        '"args":["-y","@modelcontextprotocol/server-github"],' +
        '"env":{"GITHUB_TOKEN":"abc"},"source":"vscode","enabled":true,' +
        '"transport":"stdio","url":null}',
    );
    expect(isImportedMcpConfig(fromRust)).toBe(true);
    expect(filterValidMcpConfigs([fromRust], 'vscode')).toEqual({
      configs: [fromRust],
      skipped: 0,
    });
  });

  // Mirrors `mcp_config_source_wire_names_match_the_frontend_guard` in
  // `src-tauri/src/commands/mcp/types.rs` — keep the two lists identical.
  it.each(['notesage_global', 'notesage_project', 'claude_desktop', 'cursor', 'vscode'])(
    'accepts the Rust wire name %s as a source',
    (source) => {
      expect(isImportedMcpConfig({ ...VALID, source })).toBe(true);
    },
  );

  it('rejects unknown source values', () => {
    expect(isImportedMcpConfig({ ...VALID, source: 'zed' })).toBe(false);
    expect(isImportedMcpConfig({ ...VALID, source: 42 })).toBe(false);
  });

  it('rejects invalid transport / url values', () => {
    expect(isImportedMcpConfig({ ...VALID, transport: 'websocket' })).toBe(false);
    expect(isImportedMcpConfig({ ...VALID, url: 42 })).toBe(false);
  });
});

describe('filterValidMcpConfigs', () => {
  it('passes through an all-valid array with skipped = 0', () => {
    const { configs, skipped } = filterValidMcpConfigs([VALID], 'test');
    expect(configs).toEqual([VALID]);
    expect(skipped).toBe(0);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('drops malformed entries and counts them', () => {
    const { configs, skipped } = filterValidMcpConfigs(
      [VALID, { ...VALID, enabled: 'yes' }, 42, null, 'junk'],
      'test',
    );
    expect(configs).toEqual([VALID]);
    expect(skipped).toBe(4);
    expect(mockWarn).toHaveBeenCalledTimes(4);
  });

  it('degrades to an empty result for a non-array payload', () => {
    expect(filterValidMcpConfigs({ mcpServers: {} }, 'test')).toEqual({ configs: [], skipped: 0 });
    expect(filterValidMcpConfigs(null, 'test')).toEqual({ configs: [], skipped: 0 });
    expect(filterValidMcpConfigs('junk', 'test')).toEqual({ configs: [], skipped: 0 });
    expect(mockWarn).toHaveBeenCalledTimes(3);
  });
});

describe('extractMcpServersRecord', () => {
  it('extracts a well-formed mcpServers record', () => {
    const servers = { filesystem: { command: 'npx', args: [], env: {} } };
    expect(extractMcpServersRecord({ mcpServers: servers })).toEqual(servers);
  });

  it('degrades to {} for junk primitives', () => {
    expect(extractMcpServersRecord(null)).toEqual({});
    expect(extractMcpServersRecord(42)).toEqual({});
    expect(extractMcpServersRecord('x')).toEqual({});
    expect(extractMcpServersRecord(undefined)).toEqual({});
  });

  it('degrades to {} when mcpServers is missing or not a record', () => {
    expect(extractMcpServersRecord({})).toEqual({});
    expect(extractMcpServersRecord({ mcpServers: [1, 2] })).toEqual({});
    expect(extractMcpServersRecord({ mcpServers: 'nope' })).toEqual({});
  });
});
