/**
 * Red tests for issue #325 — Remove Classic Layout.
 *
 * These tests assert the post-removal invariants:
 * 1. settings-store persist version bumped to 18
 * 2. Migration at v18 removes uiPreview / chatPanelOpen / previewInvitation* fields
 * 3. Initial state has no uiPreview or chatPanelOpen
 * 4. shouldShowPreviewInvitation and shouldShowRevertInvitation are removed
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — localStorage polyfill (mirrors settings-store.test.ts pattern)
// ---------------------------------------------------------------------------

const { localStorageMock, storageBacking } = vi.hoisted(() => {
  const storageBacking = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (key: string) => storageBacking.get(key) ?? null,
    setItem: (key: string, value: string) => { storageBacking.set(key, value); },
    removeItem: (key: string) => { storageBacking.delete(key); },
    clear: () => { storageBacking.clear(); },
    get length() { return storageBacking.size; },
    key: (index: number) => [...storageBacking.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  if (typeof globalThis.window === 'undefined') {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
  return { localStorageMock, storageBacking };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/tauri-storage', () => {
  const { createJSONStorage } = require('zustand/middleware');
  return { createTauriStorage: () => createJSONStorage(() => localStorageMock) };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../settings-store';

const STORAGE_KEY = 'notesage-settings';

async function waitForPersist(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

beforeEach(() => {
  storageBacking.clear();
  useSettingsStore.setState(useSettingsStore.getInitialState?.() ?? {}, true);
});

// ---------------------------------------------------------------------------
// 1. Persist version is 18
// ---------------------------------------------------------------------------

describe('settings-store: persist version after Classic Layout removal', () => {
  it('persist version is 18 (bumped from 17 by the uiPreview cleanup migration)', () => {
    const options = useSettingsStore.persist.getOptions();
    expect(options.version).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// 2. Initial state has no uiPreview field
// ---------------------------------------------------------------------------

describe('settings-store: Classic Layout fields removed from initial state', () => {
  it('uiPreview is NOT in the initial state', () => {
    const state = useSettingsStore.getState() as Record<string, unknown>;
    expect('uiPreview' in state).toBe(false);
  });

  it('chatPanelOpen is NOT in the initial state', () => {
    const state = useSettingsStore.getState() as Record<string, unknown>;
    expect('chatPanelOpen' in state).toBe(false);
  });

  it('previewInvitationShownAt is NOT in the initial state', () => {
    const state = useSettingsStore.getState() as Record<string, unknown>;
    expect('previewInvitationShownAt' in state).toBe(false);
  });

  it('previewInvitationDismissedAt is NOT in the initial state', () => {
    const state = useSettingsStore.getState() as Record<string, unknown>;
    expect('previewInvitationDismissedAt' in state).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. v18 migration removes legacy fields from stored state
// ---------------------------------------------------------------------------

describe('settings-store: v18 migration removes Classic Layout fields', () => {
  it('migrates a v17 state with uiPreview:"legacy" to remove the field', async () => {
    // Simulate a persisted state from v17 with uiPreview: "legacy"
    const v17State = {
      state: {
        uiPreview: 'legacy',
        chatPanelOpen: false,
        previewInvitationShownAt: null,
        previewInvitationDismissedAt: null,
        theme: 'system',
        logLevel: 'warn',
      },
      version: 17,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v17State));
    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const state = useSettingsStore.getState() as Record<string, unknown>;
    // After migration, these fields should be gone
    expect('uiPreview' in state).toBe(false);
    expect('chatPanelOpen' in state).toBe(false);
  });

  it('migrates a v17 state with uiPreview:"quiet-composer" to remove the field', async () => {
    const v17State = {
      state: {
        uiPreview: 'quiet-composer',
        chatPanelOpen: true,
        theme: 'system',
        logLevel: 'warn',
      },
      version: 17,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v17State));
    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const state = useSettingsStore.getState() as Record<string, unknown>;
    expect('uiPreview' in state).toBe(false);
    expect('chatPanelOpen' in state).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. shouldShowPreviewInvitation and shouldShowRevertInvitation removed
// ---------------------------------------------------------------------------

describe('settings-store: preview/revert invitation helpers removed', () => {
  it('shouldShowPreviewInvitation is NOT exported from settings-store', async () => {
    const mod = await import('../settings-store');
    expect('shouldShowPreviewInvitation' in mod).toBe(false);
  });

  it('shouldShowRevertInvitation is NOT exported from settings-store', async () => {
    const mod = await import('../settings-store');
    expect('shouldShowRevertInvitation' in mod).toBe(false);
  });
});
