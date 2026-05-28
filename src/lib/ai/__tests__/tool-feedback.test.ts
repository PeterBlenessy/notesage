import { describe, it, expect } from 'vitest';
import {
  toolCallKey,
  wrapToolError,
  buildRepeatedFailureFeedback,
  ToolCallHistory,
  buildToolResultContent,
} from '@/lib/ai/tool-feedback';

describe('toolCallKey', () => {
  it('produces identical keys for semantically identical calls', () => {
    // Same tool, same arg shape → same key, so history lookup works.
    expect(toolCallKey('read_file', { path: '/foo' })).toBe(
      toolCallKey('read_file', { path: '/foo' })
    );
  });

  it('distinguishes different arguments', () => {
    expect(toolCallKey('read_file', { path: '/foo' })).not.toBe(
      toolCallKey('read_file', { path: '/bar' })
    );
  });

  it('distinguishes different tool names', () => {
    expect(toolCallKey('read_file', { path: '/foo' })).not.toBe(
      toolCallKey('write_file', { path: '/foo' })
    );
  });

  it('handles null and undefined args as the empty object', () => {
    expect(toolCallKey('list_dir', null)).toBe(toolCallKey('list_dir', {}));
    expect(toolCallKey('list_dir', undefined)).toBe(toolCallKey('list_dir', {}));
  });
});

describe('wrapToolError', () => {
  it('preserves the original error content verbatim', () => {
    // The model needs the underlying error (path, permission, etc.) to choose
    // a different approach — never elide it.
    const wrapped = wrapToolError('read_file', 'ENOENT: no such file: /etc/foo');
    expect(wrapped).toContain('ENOENT: no such file: /etc/foo');
  });

  it('directs the model to reason before retrying', () => {
    const wrapped = wrapToolError('read_file', 'permission denied');
    expect(wrapped).toMatch(/reason about why/i);
    expect(wrapped).toMatch(/different approach/i);
    expect(wrapped).toMatch(/do not retry the same call/i);
  });

  it('names the failing tool', () => {
    expect(wrapToolError('list_directory', 'EPERM')).toMatch(/list_directory/);
  });
});

describe('ToolCallHistory', () => {
  it('returns false for unseen calls', () => {
    const h = new ToolCallHistory();
    expect(h.isRepeatedFailure('read_file', { path: '/x' })).toBe(false);
  });

  it('detects a repeated failure of the same call shape', () => {
    const h = new ToolCallHistory();
    h.record('read_file', { path: '/x' }, true);
    expect(h.isRepeatedFailure('read_file', { path: '/x' })).toBe(true);
  });

  it('does NOT flag a different call shape as a repeat', () => {
    const h = new ToolCallHistory();
    h.record('read_file', { path: '/x' }, true);
    expect(h.isRepeatedFailure('read_file', { path: '/y' })).toBe(false);
    expect(h.isRepeatedFailure('write_file', { path: '/x' })).toBe(false);
  });

  it('only remembers failures, not successes', () => {
    // A successful call followed by a failure on the same shape should NOT
    // count as a repeat — the model might have legitimately re-fetched data.
    const h = new ToolCallHistory();
    h.record('read_file', { path: '/x' }, false);
    expect(h.isRepeatedFailure('read_file', { path: '/x' })).toBe(false);
  });
});

describe('buildToolResultContent', () => {
  it('passes successful results through unchanged', () => {
    const h = new ToolCallHistory();
    const out = buildToolResultContent({
      toolName: 'read_file',
      args: { path: '/x' },
      rawContent: 'file contents here',
      isError: false,
      history: h,
    });
    expect(out).toBe('file contents here');
  });

  it('wraps the first failure with reasoning guidance', () => {
    const h = new ToolCallHistory();
    const out = buildToolResultContent({
      toolName: 'read_file',
      args: { path: '/x' },
      rawContent: 'permission denied',
      isError: true,
      history: h,
    });
    expect(out).toContain('permission denied'); // raw error preserved
    expect(out).toMatch(/reason about why/i);   // guidance added
    expect(out).not.toMatch(/already called/i); // no anti-loop yet
  });

  it('prepends the anti-loop directive on the second identical failure', () => {
    // The drive-it-into-the-wall failure mode: small models will retry the
    // exact same failing call. The second attempt must carry a stronger
    // stop signal than the first.
    const h = new ToolCallHistory();
    buildToolResultContent({
      toolName: 'read_file',
      args: { path: '/x' },
      rawContent: 'permission denied',
      isError: true,
      history: h,
    });
    const second = buildToolResultContent({
      toolName: 'read_file',
      args: { path: '/x' },
      rawContent: 'permission denied',
      isError: true,
      history: h,
    });
    expect(second).toMatch(/already called .*read_file/i);
    expect(second).toMatch(/do not call it again/i);
  });

  it('does NOT prepend anti-loop when arguments differ', () => {
    // Same tool, different args = a legitimate new attempt.
    const h = new ToolCallHistory();
    buildToolResultContent({
      toolName: 'read_file',
      args: { path: '/x' },
      rawContent: 'permission denied',
      isError: true,
      history: h,
    });
    const second = buildToolResultContent({
      toolName: 'read_file',
      args: { path: '/y' },
      rawContent: 'permission denied',
      isError: true,
      history: h,
    });
    expect(second).not.toMatch(/already called/i);
    expect(second).toMatch(/reason about why/i); // still wrapped
  });

  it('does NOT prepend anti-loop when the first attempt succeeded', () => {
    const h = new ToolCallHistory();
    buildToolResultContent({
      toolName: 'read_file',
      args: { path: '/x' },
      rawContent: 'first read ok',
      isError: false,
      history: h,
    });
    const second = buildToolResultContent({
      toolName: 'read_file',
      args: { path: '/x' },
      rawContent: 'now it fails',
      isError: true,
      history: h,
    });
    expect(second).not.toMatch(/already called/i);
  });
});

describe('buildRepeatedFailureFeedback', () => {
  it('mentions the failing tool name', () => {
    expect(buildRepeatedFailureFeedback('write_file')).toMatch(/write_file/);
  });

  it('offers concrete alternatives, not just "stop"', () => {
    // A bare "stop" wedges the model. Concrete alternatives let it move on.
    const text = buildRepeatedFailureFeedback('read_file');
    expect(text).toMatch(/different arguments/i);
    expect(text).toMatch(/different tool/i);
    expect(text).toMatch(/respond with text/i);
  });
});
