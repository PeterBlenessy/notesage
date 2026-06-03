// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
  registerDefaultHandlers,
} from '@/test/tauri-mock';
import { useMcpOperations, type McpValidationResult } from '../useMcpOperations';

// The hook is mocked at the @tauri-apps boundary by src/test/tauri-mock.ts
// (wired globally in vitest setup). We register per-test invoke handlers.

describe('useMcpOperations.validateServer', () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
    registerDefaultHandlers();
  });

  it('invokes mcp_validate_server with a snake_case source and ephemeral id', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    const okResult: McpValidationResult = {
      ok: true,
      tools: [{ name: 'read_file', description: null, input_schema: {}, server_id: '__validate__' }],
      server_info: { name: 'demo', version: '1.0.0' },
      error: null,
      error_kind: null,
      stderr_tail: null,
    };
    setMockInvokeHandler('mcp_validate_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return okResult;
    });

    const { result } = renderHook(() => useMcpOperations());
    const res = await result.current.validateServer({
      name: 'Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { TOKEN: 'abc' },
    });

    expect(res.ok).toBe(true);
    expect(res.tools).toHaveLength(1);
    expect(captured.config).toMatchObject({
      id: '__validate__',
      name: 'Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { TOKEN: 'abc' },
      source: 'notesage_global',
      enabled: true,
    });
  });

  it('forwards transport + url for remote (http) configs', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    setMockInvokeHandler('mcp_validate_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return { ok: true, tools: [], server_info: null, error: null, error_kind: null, stderr_tail: null };
    });

    const { result } = renderHook(() => useMcpOperations());
    await result.current.validateServer({
      name: 'Remote',
      command: '',
      args: [],
      env: {},
      transport: 'http',
      url: 'https://example.com/mcp',
    });

    expect(captured.config).toMatchObject({
      transport: 'http',
      url: 'https://example.com/mcp',
      command: '',
    });
  });

  it('defaults transport to stdio and url to null when omitted', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    setMockInvokeHandler('mcp_validate_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return { ok: true, tools: [], server_info: null, error: null, error_kind: null, stderr_tail: null };
    });

    const { result } = renderHook(() => useMcpOperations());
    await result.current.validateServer({ name: 'x', command: 'node', args: [], env: {} });

    expect(captured.config?.transport).toBe('stdio');
    expect(captured.config?.url).toBeNull();
  });

  it('falls back to the command as the name when none is provided', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    setMockInvokeHandler('mcp_validate_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return { ok: true, tools: [], server_info: null, error: null, error_kind: null, stderr_tail: null };
    });

    const { result } = renderHook(() => useMcpOperations());
    await result.current.validateServer({ name: '', command: 'uvx', args: ['mcp-server-git'], env: {} });

    expect(captured.config?.name).toBe('uvx');
  });

  it('propagates a failed validation result (mapped error) to the caller', async () => {
    const failResult: McpValidationResult = {
      ok: false,
      tools: [],
      server_info: null,
      error: "Command not found: 'nope'. Make sure it is installed and on your PATH.",
      error_kind: 'binary_not_found',
      stderr_tail: null,
    };
    setMockInvokeHandler('mcp_validate_server', () => failResult);

    const { result } = renderHook(() => useMcpOperations());
    const res = await result.current.validateServer({ name: 'x', command: 'nope', args: [], env: {} });

    expect(res.ok).toBe(false);
    expect(res.error_kind).toBe('binary_not_found');
    expect(res.error).toContain('PATH');
  });
});
