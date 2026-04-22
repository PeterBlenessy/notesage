import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { invoke } from '@tauri-apps/api/core';
import { PERF, log, setLogLevel, type PerfCategory } from '../logger';

const invokeMock = vi.mocked(invoke);

describe('PERF category constants', () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it('exposes the existing perf categories with stable string values', () => {
    expect(PERF.startup).toBe('perf:startup');
    expect(PERF.save).toBe('perf:save');
    expect(PERF.tree).toBe('perf:tree');
    expect(PERF.find).toBe('perf:find');
    expect(PERF.typing).toBe('perf:typing');
    expect(PERF.palette).toBe('perf:palette');
    expect(PERF.tabLoad).toBe('perf:tab-load');
    expect(PERF.tabPreload).toBe('perf:tab-preload');
    expect(PERF.skills).toBe('perf:skills');
    expect(PERF.aiChat).toBe('perf:ai-chat');
    expect(PERF.index).toBe('perf:index');
  });

  it('exposes the new Phase 1 perf categories with the expected values', () => {
    expect(PERF.cmdbar).toBe('perf:cmdbar');
    expect(PERF.orb).toBe('perf:orb');
    expect(PERF.status).toBe('perf:status');
    expect(PERF.peek).toBe('perf:peek');
    expect(PERF.treeOverlay).toBe('perf:tree-overlay');
    expect(PERF.sidebar).toBe('perf:sidebar');
    expect(PERF.focus).toBe('perf:focus');
  });

  it('every value matches the perf:<name> pattern', () => {
    for (const value of Object.values(PERF)) {
      expect(value).toMatch(/^perf:[a-z][a-z0-9-]*$/);
    }
  });

  it('values are unique (no duplicate category strings)', () => {
    const values = Object.values(PERF);
    expect(new Set(values).size).toBe(values.length);
  });

  it('PerfCategory type accepts every PERF.* value at compile time', () => {
    // Compile-time assertion: each PERF.* value must satisfy PerfCategory.
    // If PerfCategory ever drifts from the const map, these assignments fail typecheck.
    const startup: PerfCategory = PERF.startup;
    const cmdbar: PerfCategory = PERF.cmdbar;
    const orb: PerfCategory = PERF.orb;
    const status: PerfCategory = PERF.status;
    const peek: PerfCategory = PERF.peek;
    const treeOverlay: PerfCategory = PERF.treeOverlay;
    const sidebar: PerfCategory = PERF.sidebar;
    const focus: PerfCategory = PERF.focus;
    expect([startup, cmdbar, orb, status, peek, treeOverlay, sidebar, focus]).toHaveLength(8);
  });

  it('log.debug forwards a PerfCategory value as the category to the backend', async () => {
    setLogLevel('debug');
    invokeMock.mockResolvedValue(undefined);

    log.debug(PERF.cmdbar, 'focus');
    log.warn(PERF.orb, 'open', { ms: 12 });

    // Logger flushes every 500ms or 20 entries — wait long enough for one flush.
    await new Promise((resolve) => setTimeout(resolve, 600));

    const forwardedCategories = invokeMock.mock.calls
      .filter(([command]) => command === 'log_frontend')
      .flatMap(([, args]) => {
        const entries = (args as { entries: Array<{ category: string }> } | undefined)?.entries ?? [];
        return entries.map((e) => e.category);
      });

    expect(forwardedCategories).toContain('perf:cmdbar');
    expect(forwardedCategories).toContain('perf:orb');

    setLogLevel('warn');
  });
});
