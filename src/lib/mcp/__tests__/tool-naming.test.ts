import { describe, it, expect } from 'vitest';
import {
  buildMcpToolNames,
  isMcpToolName,
  mcpToolIdentityKey,
  sanitizeMcpNamePart,
  shortHash,
  MCP_TOOL_NAME_MAX,
  type McpToolIdentity,
} from '../tool-naming';

const PROVIDER_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function tool(serverId: string, serverName: string, toolName: string): McpToolIdentity {
  return { serverId, serverName, toolName };
}

describe('sanitizeMcpNamePart', () => {
  it('keeps provider-safe characters and replaces everything else', () => {
    expect(sanitizeMcpNamePart('github')).toBe('github');
    expect(sanitizeMcpNamePart('get-issue_2')).toBe('get-issue_2');
    expect(sanitizeMcpNamePart('My Server (v2)')).toBe('My_Server__v2_');
    expect(sanitizeMcpNamePart('files/read.text')).toBe('files_read_text');
    expect(sanitizeMcpNamePart('sök')).toBe('s_k');
  });

  it('never returns an empty part', () => {
    expect(sanitizeMcpNamePart('')).toBe('_');
  });
});

describe('shortHash', () => {
  it('is deterministic, fixed width and provider-safe', () => {
    expect(shortHash('abc')).toBe(shortHash('abc'));
    expect(shortHash('abc')).not.toBe(shortHash('abd'));
    expect(shortHash('')).toMatch(/^[0-9a-f]{8}$/);
    expect(shortHash('x'.repeat(500))).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('isMcpToolName', () => {
  it('recognises the MCP namespace only', () => {
    expect(isMcpToolName('mcp__github__create_issue')).toBe(true);
    expect(isMcpToolName('skill__download_webpage')).toBe(false);
    expect(isMcpToolName('read_file')).toBe(false);
    expect(isMcpToolName('mcp_single_underscore')).toBe(false);
  });
});

describe('buildMcpToolNames', () => {
  it('names a clean tool mcp__<server>__<tool> with no hash', () => {
    const { byName, nameOf } = buildMcpToolNames([tool('global:github', 'github', 'create_issue')]);
    expect([...byName.keys()]).toEqual(['mcp__github__create_issue']);
    expect(nameOf.get(mcpToolIdentityKey({ serverId: 'global:github', toolName: 'create_issue' })))
      .toBe('mcp__github__create_issue');
  });

  it('sanitises both parts without a hash when nothing collides', () => {
    const { byName } = buildMcpToolNames([tool('global:My Server', 'My Server', 'files/read')]);
    expect([...byName.keys()]).toEqual(['mcp__My_Server__files_read']);
  });

  it('round-trips every name to the server id and ORIGINAL tool name', () => {
    const tools = [
      tool('global:github', 'github', 'create_issue'),
      tool('global:My Server', 'My Server', 'files/read'),
      tool('project:db', 'db', 'run query'),
    ];
    const { byName, nameOf } = buildMcpToolNames(tools);
    expect(byName.size).toBe(3);
    for (const t of tools) {
      const name = nameOf.get(mcpToolIdentityKey(t))!;
      expect(name).toMatch(PROVIDER_NAME);
      expect(byName.get(name)).toEqual(t);
    }
  });

  it('truncates to 64 characters and adds a hash so truncated names stay apart', () => {
    const long = 'a_very_long_tool_name_that_goes_on_and_on_and_on_and_on_and_on_';
    const tools = [
      tool('global:srv', 'server-with-a-long-display-name', `${long}one`),
      tool('global:srv', 'server-with-a-long-display-name', `${long}two`),
    ];
    const { byName, nameOf } = buildMcpToolNames(tools);
    const names = tools.map((t) => nameOf.get(mcpToolIdentityKey(t))!);
    expect(new Set(names).size).toBe(2);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(MCP_TOOL_NAME_MAX);
      expect(name).toMatch(PROVIDER_NAME);
      expect(name).toMatch(/_[0-9a-f]{8}$/);
      expect(name.startsWith('mcp__server-with-a-lo__')).toBe(true);
    }
    expect(byName.get(names[0])).toEqual(tools[0]);
    expect(byName.get(names[1])).toEqual(tools[1]);
  });

  it('keeps as much of the tool name as fits when only the server name is long', () => {
    const { byName } = buildMcpToolNames([tool('global:x', 's'.repeat(80), 'query')]);
    const [name] = [...byName.keys()];
    expect(name.length).toBe(MCP_TOOL_NAME_MAX);
    expect(name).toMatch(/__query_[0-9a-f]{8}$/);
  });

  it('separates two servers with the same display name and tool', () => {
    const a = tool('global:notes', 'notes', 'search');
    const b = tool('project:notes', 'notes', 'search');
    const { byName, nameOf } = buildMcpToolNames([a, b]);
    const nameA = nameOf.get(mcpToolIdentityKey(a))!;
    const nameB = nameOf.get(mcpToolIdentityKey(b))!;
    expect(nameA).not.toBe(nameB);
    expect(nameA).toMatch(/^mcp__notes__search_[0-9a-f]{8}$/);
    expect(nameB).toMatch(/^mcp__notes__search_[0-9a-f]{8}$/);
    expect(byName.get(nameA)).toEqual(a);
    expect(byName.get(nameB)).toEqual(b);
    // Neither may keep the bare name: a call must never be routed by guesswork.
    expect(byName.has('mcp__notes__search')).toBe(false);
  });

  it('separates names that differ only in characters sanitising replaces', () => {
    const a = tool('global:fs', 'fs', 'read file');
    const b = tool('global:fs', 'fs', 'read.file');
    const c = tool('global:fs', 'fs', 'read_file');
    const { byName, nameOf } = buildMcpToolNames([a, b, c]);
    const names = [a, b, c].map((t) => nameOf.get(mcpToolIdentityKey(t))!);
    expect(new Set(names).size).toBe(3);
    names.forEach((n, i) => expect(byName.get(n)).toEqual([a, b, c][i]));
  });

  it('separates an ambiguous split (a__b + c versus a + b__c)', () => {
    const a = tool('global:a__b', 'a__b', 'c');
    const b = tool('global:a', 'a', 'b__c');
    const { byName, nameOf } = buildMcpToolNames([a, b]);
    expect(nameOf.get(mcpToolIdentityKey(a))).not.toBe(nameOf.get(mcpToolIdentityKey(b)));
    expect(byName.size).toBe(2);
  });

  it('gives the same names whatever order the tools arrive in', () => {
    const tools = [
      tool('global:notes', 'notes', 'search'),
      tool('project:notes', 'notes', 'search'),
      tool('global:github', 'github', 'create_issue'),
      tool('global:fs', 'fs', 'read file'),
      tool('global:fs', 'fs', 'read.file'),
    ];
    const forward = buildMcpToolNames(tools).nameOf;
    const backward = buildMcpToolNames([...tools].reverse()).nameOf;
    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
  });

  it('treats a repeated identity as one tool', () => {
    const t = tool('global:github', 'github', 'create_issue');
    const { byName } = buildMcpToolNames([t, { ...t }]);
    expect([...byName.keys()]).toEqual(['mcp__github__create_issue']);
  });

  it('stays unique and provider-safe over a large awkward set', () => {
    const tools: McpToolIdentity[] = [];
    for (let s = 0; s < 6; s++) {
      for (let i = 0; i < 40; i++) {
        tools.push(tool(`src${s}:same name`, 'same name', `tool ${'x'.repeat(i * 3)}/${i % 5}`));
      }
    }
    const { byName, nameOf } = buildMcpToolNames(tools);
    expect(byName.size).toBe(new Set(tools.map(mcpToolIdentityKey)).size);
    for (const name of byName.keys()) expect(name).toMatch(PROVIDER_NAME);
    for (const t of tools) expect(byName.get(nameOf.get(mcpToolIdentityKey(t))!)).toEqual(t);
  });
});
