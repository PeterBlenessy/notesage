import { describe, it, expect } from 'vitest';
import { parseMcpInstallUrl, isAllowedMcpCommand, MCP_ALLOWED_COMMANDS } from '../deeplink';

describe('parseMcpInstallUrl', () => {
  it('parses a stdio install link with args', () => {
    const r = parseMcpInstallUrl(
      'notesage://mcp/install?name=Filesystem&command=npx&args=-y%20@modelcontextprotocol/server-filesystem'
    );
    expect(r).toEqual({
      ok: true,
      prefill: {
        name: 'Filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: [],
        transport: 'stdio',
        url: null,
        untrusted: true,
      },
    });
  });

  it('parses a remote (http) install link', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?name=Sentry&transport=http&url=https://mcp.sentry.dev/mcp');
    expect(r).toMatchObject({
      ok: true,
      prefill: { name: 'Sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp', command: '', args: [], untrusted: true },
    });
  });

  it('derives a name from the command when none is given', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?command=uvx&args=mcp-server-git');
    expect(r).toMatchObject({ ok: true, prefill: { name: 'uvx' } });
  });

  it('collects env keys with secret flags but no values', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?command=node&env=PORT&env=TOKEN:secret');
    expect(r?.ok).toBe(true);
    expect(r?.ok && r.prefill.env).toEqual([
      { key: 'PORT', value: '', secret: false },
      { key: 'TOKEN', value: '', secret: true },
    ]);
  });

  it('rejects non-notesage protocols', () => {
    expect(parseMcpInstallUrl('https://mcp/install?command=node')).toBeNull();
  });

  it('rejects the wrong path', () => {
    expect(parseMcpInstallUrl('notesage://mcp/remove?command=node')).toBeNull();
  });

  it('rejects a stdio link with no command', () => {
    expect(parseMcpInstallUrl('notesage://mcp/install?name=x')).toBeNull();
  });

  it('rejects an http link with no url', () => {
    expect(parseMcpInstallUrl('notesage://mcp/install?transport=http&name=x')).toBeNull();
  });

  it('rejects malformed urls', () => {
    expect(parseMcpInstallUrl('not a url')).toBeNull();
  });

  // --- Command allowlist (RCE defense) ---

  it('accepts each allowlisted command', () => {
    for (const cmd of MCP_ALLOWED_COMMANDS) {
      const r = parseMcpInstallUrl(`notesage://mcp/install?command=${cmd}&args=foo`);
      expect(r?.ok).toBe(true);
    }
  });

  it('rejects a bare disallowed command (bash) without opening', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?command=bash&args=-c%20whoami');
    expect(r).toMatchObject({ ok: false });
    expect(r?.ok === false && r.reason).toContain('bash');
  });

  it('rejects an absolute-path command (/bin/bash)', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?command=/bin/bash');
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects /usr/bin/env', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?command=/usr/bin/env&args=npx');
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects sh (with -c args)', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?command=sh&args=-c%20rm%20-rf');
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects a relative path command (./evil)', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?command=./evil');
    expect(r).toMatchObject({ ok: false });
  });
});

describe('isAllowedMcpCommand', () => {
  it('returns true only for exact allowlist matches', () => {
    expect(isAllowedMcpCommand('npx')).toBe(true);
    expect(isAllowedMcpCommand('  npx  ')).toBe(true);
    expect(isAllowedMcpCommand('python3')).toBe(true);
  });

  it('rejects path separators and off-list values', () => {
    expect(isAllowedMcpCommand('/bin/bash')).toBe(false);
    expect(isAllowedMcpCommand('./npx')).toBe(false);
    expect(isAllowedMcpCommand('C:\\Windows\\system32\\cmd.exe')).toBe(false);
    expect(isAllowedMcpCommand('bash')).toBe(false);
    expect(isAllowedMcpCommand('env')).toBe(false);
    expect(isAllowedMcpCommand('')).toBe(false);
  });
});
