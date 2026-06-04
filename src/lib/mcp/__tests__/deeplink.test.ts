import { describe, it, expect } from 'vitest';
import { parseMcpInstallUrl } from '../deeplink';

describe('parseMcpInstallUrl', () => {
  it('parses a stdio install link with args', () => {
    const r = parseMcpInstallUrl(
      'notesage://mcp/install?name=Filesystem&command=npx&args=-y%20@modelcontextprotocol/server-filesystem'
    );
    expect(r).toEqual({
      name: 'Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: [],
      transport: 'stdio',
      url: null,
    });
  });

  it('parses a remote (http) install link', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?name=Sentry&transport=http&url=https://mcp.sentry.dev/mcp');
    expect(r).toMatchObject({ name: 'Sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp', command: '', args: [] });
  });

  it('derives a name from the command when none is given', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?command=uvx&args=mcp-server-git');
    expect(r?.name).toBe('uvx');
  });

  it('collects env keys with secret flags but no values', () => {
    const r = parseMcpInstallUrl('notesage://mcp/install?command=node&env=PORT&env=TOKEN:secret');
    expect(r?.env).toEqual([
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
});
