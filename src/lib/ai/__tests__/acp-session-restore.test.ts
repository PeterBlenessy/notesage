// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { restoreOrCreateAcpSession } from '../acp-session-restore';
import type { AcpAgentCapabilities, AcpSessionResult, AcpListResult } from '../acp-utils';
import {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
} from '@/test/tauri-mock';

// Minimal session shape the restoration helper can return.
const makeSession = (id: string): AcpSessionResult => ({
  session_id: id,
  current_model: null,
  available_models: [],
  modes: null,
  config_options: null,
});

// Capability builders — wire payload uses camelCase per ACP schema's rename_all.
const caps = {
  none: (): AcpAgentCapabilities => ({}),
  loadOnly: (): AcpAgentCapabilities => ({ loadSession: true }),
  resumeOnly: (): AcpAgentCapabilities => ({
    sessionCapabilities: { resume: {} },
  }),
  loadAndResume: (): AcpAgentCapabilities => ({
    loadSession: true,
    sessionCapabilities: { resume: {} },
  }),
  all: (): AcpAgentCapabilities => ({
    loadSession: true,
    sessionCapabilities: { list: {}, resume: {}, close: {}, fork: {} },
  }),
};

describe('restoreOrCreateAcpSession', () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
    // Register neutral defaults; each test overrides the commands it cares about.
    setMockInvokeHandler('acp_session_new', () => makeSession('new-session'));
  });

  describe('no stored session', () => {
    it('calls session/new directly when no stored ID is present', async () => {
      const newSpy = vi.fn(() => makeSession('fresh'));
      setMockInvokeHandler('acp_session_new', newSpy);
      const result = await restoreOrCreateAcpSession({
        instanceId: 'inst-1',
        cwd: '/tmp',
        storedSessionId: undefined,
        capabilities: caps.all(),
      });
      expect(result.session_id).toBe('fresh');
      expect(newSpy).toHaveBeenCalledOnce();
    });
  });

  describe('resume capability', () => {
    it('uses session/resume when supported and it succeeds', async () => {
      const resumeSpy = vi.fn(() => makeSession('sess-A'));
      const loadSpy = vi.fn(() => makeSession('should-not-be-called'));
      const newSpy = vi.fn(() => makeSession('should-not-be-called'));
      setMockInvokeHandler('acp_session_resume', resumeSpy);
      setMockInvokeHandler('acp_session_load', loadSpy);
      setMockInvokeHandler('acp_session_new', newSpy);

      const result = await restoreOrCreateAcpSession({
        instanceId: 'inst-1',
        cwd: '/tmp',
        storedSessionId: 'sess-A',
        capabilities: caps.all(),
      });

      expect(result.session_id).toBe('sess-A');
      expect(resumeSpy).toHaveBeenCalledOnce();
      expect(loadSpy).not.toHaveBeenCalled();
      expect(newSpy).not.toHaveBeenCalled();
    });
  });

  describe('resume fails → load succeeds', () => {
    it('falls back to session/load when resume fails', async () => {
      setMockInvokeHandler('acp_session_resume', () => {
        throw new Error('resume exploded');
      });
      const loadSpy = vi.fn(() => makeSession('sess-B'));
      setMockInvokeHandler('acp_session_load', loadSpy);
      const newSpy = vi.fn(() => makeSession('should-not-be-called'));
      setMockInvokeHandler('acp_session_new', newSpy);

      const result = await restoreOrCreateAcpSession({
        instanceId: 'inst-1',
        cwd: '/tmp',
        storedSessionId: 'sess-B',
        capabilities: caps.all(),
      });

      expect(result.session_id).toBe('sess-B');
      expect(loadSpy).toHaveBeenCalledOnce();
      expect(newSpy).not.toHaveBeenCalled();
    });
  });

  describe('no resume capability', () => {
    it('skips resume and goes straight to load when only load is supported', async () => {
      const resumeSpy = vi.fn();
      const loadSpy = vi.fn(() => makeSession('sess-C'));
      setMockInvokeHandler('acp_session_resume', resumeSpy);
      setMockInvokeHandler('acp_session_load', loadSpy);

      const result = await restoreOrCreateAcpSession({
        instanceId: 'inst-1',
        cwd: '/tmp',
        storedSessionId: 'sess-C',
        capabilities: caps.loadOnly(),
      });

      expect(result.session_id).toBe('sess-C');
      expect(resumeSpy).not.toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalledOnce();
    });
  });

  describe('both resume and load fail', () => {
    it('calls session/list then falls back to new when the stored ID is gone', async () => {
      setMockInvokeHandler('acp_session_resume', () => { throw new Error('resume fail'); });
      setMockInvokeHandler('acp_session_load', () => { throw new Error('load fail'); });
      const listSpy = vi.fn((): AcpListResult => ({ sessions: [], next_cursor: null }));
      setMockInvokeHandler('acp_session_list', listSpy);
      const newSpy = vi.fn(() => makeSession('fresh-after-fail'));
      setMockInvokeHandler('acp_session_new', newSpy);

      const result = await restoreOrCreateAcpSession({
        instanceId: 'inst-1',
        cwd: '/tmp',
        storedSessionId: 'sess-GONE',
        capabilities: caps.all(),
      });

      expect(result.session_id).toBe('fresh-after-fail');
      expect(listSpy).toHaveBeenCalledOnce();
      expect(newSpy).toHaveBeenCalledOnce();
    });

    it('skips list when list capability is absent and falls back to new', async () => {
      setMockInvokeHandler('acp_session_resume', () => { throw new Error('r'); });
      setMockInvokeHandler('acp_session_load', () => { throw new Error('l'); });
      const listSpy = vi.fn();
      setMockInvokeHandler('acp_session_list', listSpy);
      const newSpy = vi.fn(() => makeSession('fresh-no-list'));
      setMockInvokeHandler('acp_session_new', newSpy);

      const result = await restoreOrCreateAcpSession({
        instanceId: 'inst-1',
        cwd: '/tmp',
        storedSessionId: 'sess-X',
        capabilities: caps.loadAndResume(),
      });

      expect(result.session_id).toBe('fresh-no-list');
      expect(listSpy).not.toHaveBeenCalled();
      expect(newSpy).toHaveBeenCalledOnce();
    });

    it('still falls back to new even when list reports the session as existing', async () => {
      // If list says the session exists but resume and load both failed, there's nothing
      // else we can do — degrade gracefully to a new session.
      setMockInvokeHandler('acp_session_resume', () => { throw new Error('r'); });
      setMockInvokeHandler('acp_session_load', () => { throw new Error('l'); });
      setMockInvokeHandler(
        'acp_session_list',
        (): AcpListResult => ({
          sessions: [{ session_id: 'sess-Y', cwd: '/tmp' }],
          next_cursor: null,
        }),
      );
      const newSpy = vi.fn(() => makeSession('fallback-new'));
      setMockInvokeHandler('acp_session_new', newSpy);

      const result = await restoreOrCreateAcpSession({
        instanceId: 'inst-1',
        cwd: '/tmp',
        storedSessionId: 'sess-Y',
        capabilities: caps.all(),
      });

      expect(result.session_id).toBe('fallback-new');
      expect(newSpy).toHaveBeenCalledOnce();
    });
  });

  describe('no capabilities at all', () => {
    it('skips restoration entirely and creates a new session', async () => {
      const resumeSpy = vi.fn();
      const loadSpy = vi.fn();
      const newSpy = vi.fn(() => makeSession('bare-new'));
      setMockInvokeHandler('acp_session_resume', resumeSpy);
      setMockInvokeHandler('acp_session_load', loadSpy);
      setMockInvokeHandler('acp_session_new', newSpy);

      const result = await restoreOrCreateAcpSession({
        instanceId: 'inst-1',
        cwd: '/tmp',
        storedSessionId: 'sess-Z',
        capabilities: caps.none(),
      });

      expect(result.session_id).toBe('bare-new');
      expect(resumeSpy).not.toHaveBeenCalled();
      expect(loadSpy).not.toHaveBeenCalled();
      expect(newSpy).toHaveBeenCalledOnce();
    });
  });
});
