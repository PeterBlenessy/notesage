import { describe, it, expect } from 'vitest';
import {
  splitCommandLine,
  joinCommandLine,
  quoteArg,
  resolveCommandAndArgs,
} from '../command-line';

describe('splitCommandLine', () => {
  it('splits on whitespace', () => {
    expect(splitCommandLine('npx -y pkg')).toEqual(['npx', '-y', 'pkg']);
  });

  it('ignores leading, trailing and repeated spaces', () => {
    expect(splitCommandLine('   npx   -y\tpkg   ')).toEqual(['npx', '-y', 'pkg']);
    expect(splitCommandLine('')).toEqual([]);
    expect(splitCommandLine('    ')).toEqual([]);
  });

  it('keeps a double-quoted argument with spaces together', () => {
    expect(splitCommandLine('"/Users/me/My Notes" --ro')).toEqual(['/Users/me/My Notes', '--ro']);
  });

  it('keeps a single-quoted argument together and takes it literally', () => {
    expect(splitCommandLine(`'/Users/me/My Notes' 'a "b" \\n'`)).toEqual([
      '/Users/me/My Notes',
      'a "b" \\n',
    ]);
  });

  it('joins adjacent quoted and unquoted parts into one argument', () => {
    expect(splitCommandLine('--dir="/tmp/a b"/c')).toEqual(['--dir=/tmp/a b/c']);
  });

  it('honours backslash escapes outside quotes', () => {
    expect(splitCommandLine('/Users/me/My\\ Notes \\"x')).toEqual(['/Users/me/My Notes', '"x']);
  });

  it('honours \\" and \\\\ inside double quotes and keeps other backslashes', () => {
    expect(splitCommandLine('"say \\"hi\\"" "a\\\\b" "C:\\dir"')).toEqual([
      'say "hi"',
      'a\\b',
      'C:\\dir',
    ]);
  });

  it('keeps an empty quoted argument', () => {
    expect(splitCommandLine('--name "" \'\' end')).toEqual(['--name', '', '', 'end']);
  });

  it('takes the rest of the line for a quote that is never closed', () => {
    expect(splitCommandLine('run "/tmp/a b')).toEqual(['run', '/tmp/a b']);
  });

  it('splits a full line pasted from a README', () => {
    expect(
      splitCommandLine('npx -y @modelcontextprotocol/server-filesystem "/Users/me/My Notes"'),
    ).toEqual(['npx', '-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Notes']);
  });
});

describe('joinCommandLine', () => {
  it('leaves plain arguments unquoted', () => {
    expect(joinCommandLine(['-y', '@scope/pkg', '/tmp/dir', '--port=8080'])).toBe(
      '-y @scope/pkg /tmp/dir --port=8080',
    );
  });

  it('quotes what needs it', () => {
    expect(quoteArg('/Users/me/My Notes')).toBe('"/Users/me/My Notes"');
    expect(quoteArg('')).toBe('""');
    expect(quoteArg('say "hi"')).toBe('"say \\"hi\\""');
  });

  it.each([
    [['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Notes']],
    [['--name', '', 'x']],
    [['a"b', "it's", 'back\\slash', 'tab\there', '$HOME', '*.md', 'a b  c']],
    [['C:\\Program Files\\node.exe', '--flag="quoted value"']],
    [[]],
  ])('round-trips %j through split', (args) => {
    expect(splitCommandLine(joinCommandLine(args))).toEqual(args);
  });
});

describe('resolveCommandAndArgs', () => {
  it('takes the first token of the Command field as the command and prepends the rest to the arguments', () => {
    expect(
      resolveCommandAndArgs('npx -y @modelcontextprotocol/server-filesystem', '"/Users/me/My Notes" /tmp'),
    ).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Notes', '/tmp'],
    });
  });

  it('keeps a quoted program path with spaces as the command', () => {
    expect(resolveCommandAndArgs('"/Applications/My Tool/bin/server" --stdio', '')).toEqual({
      command: '/Applications/My Tool/bin/server',
      args: ['--stdio'],
    });
  });

  it('yields an empty command for an empty field', () => {
    expect(resolveCommandAndArgs('   ', 'x')).toEqual({ command: '', args: ['x'] });
  });
});
