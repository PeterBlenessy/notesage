import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { canReauthenticate, reauthenticateAgent, isAuthError } from '@/lib/ai/reauth';

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('reauth — canReauthenticate', () => {
  it('returns true for the four supported ACP agents + Copilot LSP', () => {
    expect(canReauthenticate('claude-agent-acp')).toBe(true);
    expect(canReauthenticate('codex-acp')).toBe(true);
    expect(canReauthenticate('copilot')).toBe(true);
    expect(canReauthenticate('copilot-language-server')).toBe(true);
    expect(canReauthenticate('gemini')).toBe(true);
  });

  it('returns false for unknown agents', () => {
    expect(canReauthenticate('unknown-agent')).toBe(false);
    expect(canReauthenticate('')).toBe(false);
  });
});

describe('reauth — isAuthError', () => {
  it('matches common auth-failure error strings', () => {
    expect(isAuthError('401 Unauthorized')).toBe(true);
    expect(isAuthError('Authentication failed')).toBe(true);
    expect(isAuthError('Authentication required')).toBe(true);
    expect(isAuthError('Invalid authentication credentials')).toBe(true);
    expect(isAuthError('invalid api key')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isAuthError('Connection refused')).toBe(false);
    expect(isAuthError('Timeout waiting for response')).toBe(false);
    expect(isAuthError('Rate limited')).toBe(false);
    expect(isAuthError('Session not found')).toBe(false);
  });

  it('accepts Error instances', () => {
    expect(isAuthError(new Error('401 Unauthorized'))).toBe(true);
    expect(isAuthError(new Error('ok'))).toBe(false);
  });
});

describe('reauth — reauthenticateAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the agent-specific sign-in command via run_in_terminal', async () => {
    let terminalCmd: string | null = null;
    setMockInvokeHandler('run_in_terminal', (args) => {
      terminalCmd = (args as { command: string }).command;
      return undefined;
    });

    await reauthenticateAgent('claude-agent-acp', 'Claude Code');

    expect(terminalCmd).toBe('claude auth login');
    expect(toast.info).toHaveBeenCalledOnce();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      'run_in_terminal',
      expect.objectContaining({ command: 'claude auth login' }),
    );
  });

  it('dispatches the correct command per agent binary', async () => {
    const seen: string[] = [];
    setMockInvokeHandler('run_in_terminal', (args) => {
      seen.push((args as { command: string }).command);
      return undefined;
    });

    await reauthenticateAgent('codex-acp', 'Codex');
    await reauthenticateAgent('copilot', 'Copilot');
    await reauthenticateAgent('gemini', 'Gemini');

    expect(seen).toEqual([
      'codex login --device-auth',
      'copilot auth login',
      'cd /tmp && gemini',
    ]);
  });
});
