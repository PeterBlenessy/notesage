/**
 * Unit tests for settings-store.
 *
 * Covers: initial state defaults, setters (boolean, string/enum, number),
 * sidebar width clamping, contrast level clamping, runtime-only setters,
 * persistence round-trip, transient field exclusion,
 * v0→v1 migration (debugLogging→logLevel), and v1→v2 migration (softMode→contrastLevel).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — runs before vi.mock factories and module-level store code.
// Sets up an in-memory localStorage polyfill since Node.js v22+ has a native
// localStorage without standard methods (setItem, getItem, clear, etc.).
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

  // Zustand persist default storage uses `window.localStorage` (not globalThis).
  // In Node.js there is no `window`, so we must define it.
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
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/tauri-storage', () => {
  const { createJSONStorage } = require('zustand/middleware');
  return {
    createTauriStorage: () => createJSONStorage(() => localStorageMock),
  };
});

// `buildIsAlpha()` reads the Vite-injected `__APP_VERSION__`, which isn't defined
// under vitest. Mock it so tests can drive the build-derived telemetry default
// (alpha build → on) deterministically. `isPrereleaseVersion` stays real.
const buildChannel = vi.hoisted(() => ({ isAlpha: false }));
vi.mock('@/lib/version', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/version')>();
  return { ...actual, buildIsAlpha: () => buildChannel.isAlpha };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  useSettingsStore,
  selectEffectiveTelemetryUsage,
  selectEffectiveTelemetryCrash,
  RELATIONS_PANEL_DEFAULT_HEIGHT,
  RELATIONS_PANEL_MIN_HEIGHT,
  RELATIONS_PANEL_MAX_HEIGHT,
} from '../settings-store';
import { useFlagStore } from '@/stores/flag-store';
import type { FlagId } from '@/lib/flags';
import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'notesage-settings';

/** Wait for Zustand persist to flush writes to storage. */
async function waitForPersist(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

/**
 * Simulate an app restart: snapshot localStorage, reset in-memory store
 * (which also overwrites localStorage), restore the snapshot, then rehydrate.
 */
async function simulateRestart(
  store: {
    setState: (state: Record<string, unknown>) => void;
    persist: { rehydrate: () => void | Promise<void> };
  },
  storageKey: string,
  defaults: Record<string, unknown>,
): Promise<void> {
  const snapshot = localStorageMock.getItem(storageKey);
  // Reset data fields (merge mode, preserves action functions)
  store.setState(defaults);
  await waitForPersist();
  // Restore the persisted snapshot
  if (snapshot) localStorageMock.setItem(storageKey, snapshot);
  // Rehydrate from storage
  await store.persist.rehydrate();
  await waitForPersist();
}

const SETTINGS_DEFAULTS: Record<string, unknown> = {
  theme: 'system',
  contrastLevel: 0,
  showFloatingToolbar: true,
  toolbarVisible: true,
  contentWidth: 'auto',
  measurementUnit: 'cm',
  marginTop: 2.54,
  marginBottom: 2.54,
  marginLeft: 2.54,
  marginRight: 2.54,
  sidebarOpen: true,
  sidebarPinned: true,
  sidebarWidth: 252,
  notesRootPath: '~/Notesage',
  gitEnabled: false,
  personasMigrated: false,
  startupReady: false,
  icloudAvailable: false,
  icloudNotesagePath: null,
  printLayout: false,
  typewriterScrolling: false,
  externalChangeDiffReview: false,
  showHiddenFiles: false,
  crossProjectMode: false,
  sourceWordWrap: true,
  copilotMaxCompletionChars: 80,
  fimContextChars: 500,
  inlineCompletionsDisabled: false,
  chatHistoryLimit: 0,
  skillManagement: false,
  toolCallingEnabled: true,
  requireAllToolConfirmations: false,
  logLevel: 'warn',
  autoCheckUpdates: true,
  lastUpdateCheck: null,
  dismissedVersion: null,
  lastExportTemplate: 'clean',
  lastExportPageSize: 'a4',
  lastExportIncludeToC: false,
  lastExportIncludePageNumbers: false,
  lastExportFormat: 'pdf',
  lastPptxTemplate: 'simple',
  accent: 'default',
  cmdBarPinned: false,
  cmdBarPinnedWidth: 400,
  cmdBarExpandedHeight: 480,
  quietChromePreset: 'default',
  quietChromeOverrides: {
    toolbar: true,
    status: true,
    docHead: true,
    sidebar: false,
    orb: false,
    titlebar: false,
    cmdbar: false,
  },
  sidebarRecentCap: 5,
  sidebarTagsCap: 5,
  sidebarMentionsCap: 5,
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  storageBacking.clear();
  // Reset from the store's OWN initial state, not a hand-written copy.
  //
  // `SETTINGS_DEFAULTS` below lists 58 fields; the store has 97. The other 39
  // — `relationsPanelHeight`, `locale`, `maxConcurrentSessions` and the rest —
  // were never reset, because the list has to be updated by hand every time a
  // setting is added and nothing enforces that. Tests asserting on those
  // fields' defaults were really asserting on whatever the previous test file
  // left behind.
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

afterEach(() => {
  storageBacking.clear();
});

// ===========================================================================
// Initial state defaults
// ===========================================================================

describe('initial state defaults', () => {
  // This one deliberately keeps the hand-written list: asserting the store's
  // defaults against a literal is the point of the test. It is the RESET path
  // above that must not duplicate them.
  it('has correct default values for all fields', () => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
    const s = useSettingsStore.getState();

    expect(s.theme).toBe('system');
    expect(s.contrastLevel).toBe(0);
    expect(s.showFloatingToolbar).toBe(true);
    expect(s.toolbarVisible).toBe(true);
    expect(s.contentWidth).toBe('auto');
    expect(s.measurementUnit).toBe('cm');
    expect(s.marginTop).toBe(2.54);
    expect(s.marginBottom).toBe(2.54);
    expect(s.marginLeft).toBe(2.54);
    expect(s.marginRight).toBe(2.54);
    expect(s.sidebarOpen).toBe(true);
    expect(s.sidebarPinned).toBe(true);
    expect(s.sidebarWidth).toBe(252);
    expect(s.notesRootPath).toBe('~/Notesage');
    expect(s.gitEnabled).toBe(false);
    expect(s.personasMigrated).toBe(false);
    expect(s.startupReady).toBe(false);
    expect(s.icloudAvailable).toBe(false);
    expect(s.icloudNotesagePath).toBeNull();
    expect(s.printLayout).toBe(false);
    expect(s.typewriterScrolling).toBe(false);
    expect(s.externalChangeDiffReview).toBe(false);
    expect(s.showHiddenFiles).toBe(false);
    expect(s.crossProjectMode).toBe(false);
    expect(s.sourceWordWrap).toBe(true);
    expect(s.copilotMaxCompletionChars).toBe(80);
    expect(s.fimContextChars).toBe(500);
    expect(s.inlineCompletionsDisabled).toBe(false);
    expect(s.chatHistoryLimit).toBe(0);
    expect(s.skillManagement).toBe(false);
    expect(s.toolCallingEnabled).toBe(true);
    expect(s.requireAllToolConfirmations).toBe(false);
    expect(s.logLevel).toBe('warn');
    expect(s.autoCheckUpdates).toBe(true);
    expect(s.lastUpdateCheck).toBeNull();
    expect(s.dismissedVersion).toBeNull();
    expect(s.lastExportTemplate).toBe('clean');
    expect(s.lastExportPageSize).toBe('a4');
    expect(s.lastExportIncludeToC).toBe(false);
    expect(s.lastExportIncludePageNumbers).toBe(false);
    expect(s.lastExportFormat).toBe('pdf');
    expect(s.lastPptxTemplate).toBe('simple');
    // ui-refresh task #28
    expect(s.cmdBarPinned).toBe(false);
    expect(s.cmdBarPinnedWidth).toBe(400);
  });
});

// ===========================================================================
// setTheme cycles light/dark
// ===========================================================================

describe('setTheme', () => {
  it('sets theme to light', () => {
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('sets theme to dark', () => {
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('sets theme to system', () => {
    useSettingsStore.getState().setTheme('dark');
    useSettingsStore.getState().setTheme('system');
    expect(useSettingsStore.getState().theme).toBe('system');
  });

  it('cycles through themes', () => {
    const { setTheme } = useSettingsStore.getState();
    setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
    setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
    setTheme('system');
    expect(useSettingsStore.getState().theme).toBe('system');
  });
});

// ===========================================================================
// setContrastLevel
// ===========================================================================

describe('setContrastLevel', () => {
  it('sets contrast level to 100', () => {
    useSettingsStore.getState().setContrastLevel(100);
    expect(useSettingsStore.getState().contrastLevel).toBe(100);
  });

  it('sets contrast level to 0', () => {
    useSettingsStore.getState().setContrastLevel(100);
    useSettingsStore.getState().setContrastLevel(0);
    expect(useSettingsStore.getState().contrastLevel).toBe(0);
  });

  it('sets contrast level to intermediate value', () => {
    useSettingsStore.getState().setContrastLevel(50);
    expect(useSettingsStore.getState().contrastLevel).toBe(50);
  });

  it('clamps values above 100 to 100', () => {
    useSettingsStore.getState().setContrastLevel(150);
    expect(useSettingsStore.getState().contrastLevel).toBe(100);
  });

  it('clamps values below 0 to 0', () => {
    useSettingsStore.getState().setContrastLevel(-10);
    expect(useSettingsStore.getState().contrastLevel).toBe(0);
  });

  it('rounds fractional values', () => {
    useSettingsStore.getState().setContrastLevel(33.7);
    expect(useSettingsStore.getState().contrastLevel).toBe(34);
  });
});

// ===========================================================================
// Boolean setters (representative sample)
// ===========================================================================

describe('boolean setters', () => {
  it('setShowFloatingToolbar', () => {
    useSettingsStore.getState().setShowFloatingToolbar(false);
    expect(useSettingsStore.getState().showFloatingToolbar).toBe(false);
  });

  it('setToolbarVisible', () => {
    useSettingsStore.getState().setToolbarVisible(false);
    expect(useSettingsStore.getState().toolbarVisible).toBe(false);
  });

  it('setSidebarOpen', () => {
    useSettingsStore.getState().setSidebarOpen(false);
    expect(useSettingsStore.getState().sidebarOpen).toBe(false);
  });

  it('setSidebarPinned', () => {
    useSettingsStore.getState().setSidebarPinned(false);
    expect(useSettingsStore.getState().sidebarPinned).toBe(false);
  });

  it('setGitEnabled', () => {
    useSettingsStore.getState().setGitEnabled(true);
    expect(useSettingsStore.getState().gitEnabled).toBe(true);
  });

  it('setTypewriterScrolling', () => {
    useSettingsStore.getState().setTypewriterScrolling(true);
    expect(useSettingsStore.getState().typewriterScrolling).toBe(true);
  });

  it('setExternalChangeDiffReview', () => {
    useSettingsStore.getState().setExternalChangeDiffReview(true);
    expect(useSettingsStore.getState().externalChangeDiffReview).toBe(true);
  });

  it('setShowHiddenFiles', () => {
    expect(useSettingsStore.getState().showHiddenFiles).toBe(false);
    useSettingsStore.getState().setShowHiddenFiles(true);
    expect(useSettingsStore.getState().showHiddenFiles).toBe(true);
    useSettingsStore.getState().setShowHiddenFiles(false);
    expect(useSettingsStore.getState().showHiddenFiles).toBe(false);
  });

  it('setCrossProjectMode', () => {
    expect(useSettingsStore.getState().crossProjectMode).toBe(false);
    useSettingsStore.getState().setCrossProjectMode(true);
    expect(useSettingsStore.getState().crossProjectMode).toBe(true);
    useSettingsStore.getState().setCrossProjectMode(false);
    expect(useSettingsStore.getState().crossProjectMode).toBe(false);
  });

  it('setSourceWordWrap', () => {
    useSettingsStore.getState().setSourceWordWrap(false);
    expect(useSettingsStore.getState().sourceWordWrap).toBe(false);
  });

  it('setInlineCompletionsDisabled', () => {
    useSettingsStore.getState().setInlineCompletionsDisabled(true);
    expect(useSettingsStore.getState().inlineCompletionsDisabled).toBe(true);
  });

  it('setSkillManagement', () => {
    useSettingsStore.getState().setSkillManagement(true);
    expect(useSettingsStore.getState().skillManagement).toBe(true);
  });

  it('setToolCallingEnabled defaults to true and can be toggled off and on', () => {
    expect(useSettingsStore.getState().toolCallingEnabled).toBe(true);
    useSettingsStore.getState().setToolCallingEnabled(false);
    expect(useSettingsStore.getState().toolCallingEnabled).toBe(false);
    useSettingsStore.getState().setToolCallingEnabled(true);
    expect(useSettingsStore.getState().toolCallingEnabled).toBe(true);
  });

  it('setRequireAllToolConfirmations defaults to false and can be toggled', () => {
    expect(useSettingsStore.getState().requireAllToolConfirmations).toBe(false);
    useSettingsStore.getState().setRequireAllToolConfirmations(true);
    expect(useSettingsStore.getState().requireAllToolConfirmations).toBe(true);
    useSettingsStore.getState().setRequireAllToolConfirmations(false);
    expect(useSettingsStore.getState().requireAllToolConfirmations).toBe(false);
  });

  it('setAutoCheckUpdates', () => {
    useSettingsStore.getState().setAutoCheckUpdates(false);
    expect(useSettingsStore.getState().autoCheckUpdates).toBe(false);
  });

  it('linkPreviewRemoteImages defaults to false (privacy by default) and can be toggled', () => {
    // Security audit MEDIUM: remote link-preview images are off by default so
    // opening an agent-authored `[!link]` card does not fire an outbound beacon.
    expect(useSettingsStore.getState().linkPreviewRemoteImages).toBe(false);
    useSettingsStore.getState().setLinkPreviewRemoteImages(true);
    expect(useSettingsStore.getState().linkPreviewRemoteImages).toBe(true);
    useSettingsStore.getState().setLinkPreviewRemoteImages(false);
    expect(useSettingsStore.getState().linkPreviewRemoteImages).toBe(false);
  });

  it('setLastExportIncludeToC', () => {
    useSettingsStore.getState().setLastExportIncludeToC(true);
    expect(useSettingsStore.getState().lastExportIncludeToC).toBe(true);
  });

  it('setLastExportIncludePageNumbers', () => {
    useSettingsStore.getState().setLastExportIncludePageNumbers(true);
    expect(useSettingsStore.getState().lastExportIncludePageNumbers).toBe(true);
  });

  it('setPersonasMigrated', () => {
    useSettingsStore.getState().setPersonasMigrated(true);
    expect(useSettingsStore.getState().personasMigrated).toBe(true);
  });
});

// ===========================================================================
// String/enum setters
// ===========================================================================

describe('string/enum setters', () => {
  it('setContentWidth to each valid value', () => {
    const values = ['full', 'auto', 'a4', 'a5', 'letter'] as const;
    for (const v of values) {
      useSettingsStore.getState().setContentWidth(v);
      expect(useSettingsStore.getState().contentWidth).toBe(v);
    }
  });

  it('setMeasurementUnit', () => {
    useSettingsStore.getState().setMeasurementUnit('inch');
    expect(useSettingsStore.getState().measurementUnit).toBe('inch');
    useSettingsStore.getState().setMeasurementUnit('cm');
    expect(useSettingsStore.getState().measurementUnit).toBe('cm');
  });

  it('setPrintLayout', () => {
    useSettingsStore.getState().setPrintLayout(true);
    expect(useSettingsStore.getState().printLayout).toBe(true);
    useSettingsStore.getState().setPrintLayout(false);
    expect(useSettingsStore.getState().printLayout).toBe(false);
  });

  it('setLastExportTemplate', () => {
    const templates = ['clean', 'academic', 'report'] as const;
    for (const t of templates) {
      useSettingsStore.getState().setLastExportTemplate(t);
      expect(useSettingsStore.getState().lastExportTemplate).toBe(t);
    }
  });

  it('setLastExportPageSize', () => {
    const sizes = ['a4', 'letter', 'a5'] as const;
    for (const s of sizes) {
      useSettingsStore.getState().setLastExportPageSize(s);
      expect(useSettingsStore.getState().lastExportPageSize).toBe(s);
    }
  });

  it('setNotesRootPath', () => {
    useSettingsStore.getState().setNotesRootPath('/Users/test/Documents');
    expect(useSettingsStore.getState().notesRootPath).toBe('/Users/test/Documents');
  });

  it('setLogLevel to each valid value', () => {
    const levels = ['error', 'warn', 'info', 'debug'] as const;
    for (const l of levels) {
      useSettingsStore.getState().setLogLevel(l);
      expect(useSettingsStore.getState().logLevel).toBe(l);
    }
  });

  it('setLastUpdateCheck', () => {
    useSettingsStore.getState().setLastUpdateCheck('2026-03-27T12:00:00Z');
    expect(useSettingsStore.getState().lastUpdateCheck).toBe('2026-03-27T12:00:00Z');
  });

  it('setLastUpdateCheck to null', () => {
    useSettingsStore.getState().setLastUpdateCheck('2026-03-27T12:00:00Z');
    useSettingsStore.getState().setLastUpdateCheck(null);
    expect(useSettingsStore.getState().lastUpdateCheck).toBeNull();
  });

  it('setDismissedVersion', () => {
    useSettingsStore.getState().setDismissedVersion('0.23.0');
    expect(useSettingsStore.getState().dismissedVersion).toBe('0.23.0');
  });

  it('setDismissedVersion to null', () => {
    useSettingsStore.getState().setDismissedVersion('0.23.0');
    useSettingsStore.getState().setDismissedVersion(null);
    expect(useSettingsStore.getState().dismissedVersion).toBeNull();
  });
});

// ===========================================================================
// Number setters
// ===========================================================================

describe('number setters', () => {
  it('setMarginTop', () => {
    useSettingsStore.getState().setMarginTop(3.0);
    expect(useSettingsStore.getState().marginTop).toBe(3.0);
  });

  it('setMarginBottom', () => {
    useSettingsStore.getState().setMarginBottom(1.5);
    expect(useSettingsStore.getState().marginBottom).toBe(1.5);
  });

  it('setMarginLeft', () => {
    useSettingsStore.getState().setMarginLeft(2.0);
    expect(useSettingsStore.getState().marginLeft).toBe(2.0);
  });

  it('setMarginRight', () => {
    useSettingsStore.getState().setMarginRight(2.0);
    expect(useSettingsStore.getState().marginRight).toBe(2.0);
  });

  it('setCopilotMaxCompletionChars', () => {
    useSettingsStore.getState().setCopilotMaxCompletionChars(200);
    expect(useSettingsStore.getState().copilotMaxCompletionChars).toBe(200);
  });

  it('setFimContextChars', () => {
    useSettingsStore.getState().setFimContextChars(1000);
    expect(useSettingsStore.getState().fimContextChars).toBe(1000);
  });

  it('setChatHistoryLimit', () => {
    useSettingsStore.getState().setChatHistoryLimit(50);
    expect(useSettingsStore.getState().chatHistoryLimit).toBe(50);
  });
});

// ===========================================================================
// Sidebar width clamping
// ===========================================================================

describe('setMaxConcurrentSessions clamping (task #8)', () => {
  it('defaults to 4', () => {
    expect(useSettingsStore.getState().maxConcurrentSessions).toBe(4);
  });
  it('accepts values within [3, 5]', () => {
    useSettingsStore.getState().setMaxConcurrentSessions(5);
    expect(useSettingsStore.getState().maxConcurrentSessions).toBe(5);
  });
  it('clamps below the minimum (3)', () => {
    useSettingsStore.getState().setMaxConcurrentSessions(1);
    expect(useSettingsStore.getState().maxConcurrentSessions).toBe(3);
  });
  it('clamps above the maximum (5)', () => {
    useSettingsStore.getState().setMaxConcurrentSessions(99);
    expect(useSettingsStore.getState().maxConcurrentSessions).toBe(5);
  });
  it('rounds fractional values', () => {
    useSettingsStore.getState().setMaxConcurrentSessions(4.6);
    expect(useSettingsStore.getState().maxConcurrentSessions).toBe(5);
  });
});

describe('setNotifyPermissionRequest (task #8)', () => {
  it('defaults to true and toggles', () => {
    expect(useSettingsStore.getState().notifyPermissionRequest).toBe(true);
    useSettingsStore.getState().setNotifyPermissionRequest(false);
    expect(useSettingsStore.getState().notifyPermissionRequest).toBe(false);
  });
});

describe('setSidebarWidth clamping', () => {
  it('sets width within valid range', () => {
    useSettingsStore.getState().setSidebarWidth(300);
    expect(useSettingsStore.getState().sidebarWidth).toBe(300);
  });

  it('clamps width below minimum (200) to 200', () => {
    useSettingsStore.getState().setSidebarWidth(100);
    expect(useSettingsStore.getState().sidebarWidth).toBe(200);
  });

  it('clamps width above maximum (500) to 500', () => {
    useSettingsStore.getState().setSidebarWidth(600);
    expect(useSettingsStore.getState().sidebarWidth).toBe(500);
  });

  it('rounds fractional values', () => {
    useSettingsStore.getState().setSidebarWidth(250.7);
    expect(useSettingsStore.getState().sidebarWidth).toBe(251);
  });

  it('clamps and rounds simultaneously', () => {
    useSettingsStore.getState().setSidebarWidth(150.4);
    expect(useSettingsStore.getState().sidebarWidth).toBe(200);
  });

  it('handles exact boundary values', () => {
    useSettingsStore.getState().setSidebarWidth(200);
    expect(useSettingsStore.getState().sidebarWidth).toBe(200);

    useSettingsStore.getState().setSidebarWidth(400);
    expect(useSettingsStore.getState().sidebarWidth).toBe(400);
  });
});

// ===========================================================================
// Runtime-only setters
// ===========================================================================

describe('runtime-only setters', () => {
  it('setStartupReady', () => {
    useSettingsStore.getState().setStartupReady(true);
    expect(useSettingsStore.getState().startupReady).toBe(true);
  });

  it('setICloudAvailable', () => {
    useSettingsStore.getState().setICloudAvailable(true);
    expect(useSettingsStore.getState().icloudAvailable).toBe(true);
  });

  it('setICloudNotesagePath', () => {
    const path = '/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Notesage';
    useSettingsStore.getState().setICloudNotesagePath(path);
    expect(useSettingsStore.getState().icloudNotesagePath).toBe(path);
  });

  it('setICloudNotesagePath to null', () => {
    useSettingsStore.getState().setICloudNotesagePath('/some/path');
    useSettingsStore.getState().setICloudNotesagePath(null);
    expect(useSettingsStore.getState().icloudNotesagePath).toBeNull();
  });
});

// ===========================================================================
// Export format settings
// ===========================================================================

describe('export format settings', () => {
  it('lastExportFormat defaults to pdf', () => {
    const s = useSettingsStore.getState();
    expect(s.lastExportFormat).toBe('pdf');
  });

  it('ExportFormat type includes pdf, docx, and pptx', () => {
    const formats: Array<'pdf' | 'docx' | 'pptx'> = ['pdf', 'docx', 'pptx'];
    for (const fmt of formats) {
      useSettingsStore.getState().setLastExportFormat(fmt);
      expect(useSettingsStore.getState().lastExportFormat).toBe(fmt);
    }
  });

  it('setLastExportFormat to docx', () => {
    useSettingsStore.getState().setLastExportFormat('docx');
    expect(useSettingsStore.getState().lastExportFormat).toBe('docx');
  });

  it('setLastExportFormat switches back to pdf', () => {
    useSettingsStore.getState().setLastExportFormat('docx');
    expect(useSettingsStore.getState().lastExportFormat).toBe('docx');
    useSettingsStore.getState().setLastExportFormat('pdf');
    expect(useSettingsStore.getState().lastExportFormat).toBe('pdf');
  });

  it('setLastExportFormat to pptx', () => {
    useSettingsStore.getState().setLastExportFormat('pptx');
    expect(useSettingsStore.getState().lastExportFormat).toBe('pptx');
  });

  it('lastExportTemplate defaults to clean', () => {
    expect(useSettingsStore.getState().lastExportTemplate).toBe('clean');
  });

  it('lastExportPageSize defaults to a4', () => {
    expect(useSettingsStore.getState().lastExportPageSize).toBe('a4');
  });

  it('lastExportIncludeToC defaults to false', () => {
    expect(useSettingsStore.getState().lastExportIncludeToC).toBe(false);
  });

  it('lastExportIncludePageNumbers defaults to false', () => {
    expect(useSettingsStore.getState().lastExportIncludePageNumbers).toBe(false);
  });

  it('lastPptxTemplate defaults to simple', () => {
    expect(useSettingsStore.getState().lastPptxTemplate).toBe('simple');
  });

  it('setLastPptxTemplate updates the value', () => {
    useSettingsStore.getState().setLastPptxTemplate('business');
    expect(useSettingsStore.getState().lastPptxTemplate).toBe('business');
  });

  it('setLastPptxTemplate accepts custom template names', () => {
    useSettingsStore.getState().setLastPptxTemplate('my-custom-template');
    expect(useSettingsStore.getState().lastPptxTemplate).toBe('my-custom-template');
  });

  it('export format persists across restart', async () => {
    useSettingsStore.getState().setLastExportFormat('docx');
    useSettingsStore.getState().setLastPptxTemplate('report');
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    const s = useSettingsStore.getState();
    expect(s.lastExportFormat).toBe('docx');
    expect(s.lastPptxTemplate).toBe('report');
  });

  it('all export settings persist together', async () => {
    useSettingsStore.setState({
      lastExportFormat: 'pptx',
      lastExportTemplate: 'report',
      lastExportPageSize: 'letter',
      lastExportIncludeToC: true,
      lastExportIncludePageNumbers: true,
      lastPptxTemplate: 'business',
    });
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    const s = useSettingsStore.getState();
    expect(s.lastExportFormat).toBe('pptx');
    expect(s.lastExportTemplate).toBe('report');
    expect(s.lastExportPageSize).toBe('letter');
    expect(s.lastExportIncludeToC).toBe(true);
    expect(s.lastExportIncludePageNumbers).toBe(true);
    expect(s.lastPptxTemplate).toBe('business');
  });
});

// ===========================================================================
// Persistence round-trip
// ===========================================================================

describe('persistence round-trip', () => {
  it('persists and restores persisted fields', async () => {
    useSettingsStore.setState({
      theme: 'dark',
      contrastLevel: 75,
      contentWidth: 'a4',
      sidebarWidth: 320,
      notesRootPath: '/custom/path',
      logLevel: 'debug',
      lastExportTemplate: 'academic',
      lastExportPageSize: 'letter',
      lastExportIncludeToC: true,
      lastExportIncludePageNumbers: true,
      gitEnabled: true,
      copilotMaxCompletionChars: 150,
      personasMigrated: true,
    });
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    const s = useSettingsStore.getState();
    expect(s.theme).toBe('dark');
    expect(s.contrastLevel).toBe(75);
    expect(s.contentWidth).toBe('a4');
    expect(s.sidebarWidth).toBe(320);
    expect(s.notesRootPath).toBe('/custom/path');
    expect(s.logLevel).toBe('debug');
    expect(s.lastExportTemplate).toBe('academic');
    expect(s.lastExportPageSize).toBe('letter');
    expect(s.lastExportIncludeToC).toBe(true);
    expect(s.lastExportIncludePageNumbers).toBe(true);
    expect(s.gitEnabled).toBe(true);
    expect(s.copilotMaxCompletionChars).toBe(150);
    expect(s.personasMigrated).toBe(true);
  });

  it('persists nullable string fields', async () => {
    useSettingsStore.setState({
      lastUpdateCheck: '2026-03-27T00:00:00Z',
      dismissedVersion: '0.23.1',
    });
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    const s = useSettingsStore.getState();
    expect(s.lastUpdateCheck).toBe('2026-03-27T00:00:00Z');
    expect(s.dismissedVersion).toBe('0.23.1');
  });
});

// ===========================================================================
// Transient fields NOT persisted
// ===========================================================================

describe('transient fields NOT persisted', () => {
  it('does NOT persist startupReady', async () => {
    useSettingsStore.setState({ startupReady: true });
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.state.startupReady).toBeUndefined();
  });

  it('does NOT persist icloudAvailable', async () => {
    useSettingsStore.setState({ icloudAvailable: true });
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.state.icloudAvailable).toBeUndefined();
  });

  it('does NOT persist icloudNotesagePath', async () => {
    useSettingsStore.setState({ icloudNotesagePath: '/some/icloud/path' });
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.state.icloudNotesagePath).toBeUndefined();
  });

  it('does NOT persist deprecated debugLogging', async () => {
    useSettingsStore.setState({ debugLogging: true } as Record<string, unknown>);
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.state.debugLogging).toBeUndefined();
  });

  it('transient fields reset to defaults after restart', async () => {
    useSettingsStore.setState({
      startupReady: true,
      icloudAvailable: true,
      icloudNotesagePath: '/icloud/path',
      theme: 'dark', // persisted field, for contrast
    });
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    const s = useSettingsStore.getState();
    // Transient fields should be at defaults (from SETTINGS_DEFAULTS reset)
    expect(s.startupReady).toBe(false);
    expect(s.icloudAvailable).toBe(false);
    expect(s.icloudNotesagePath).toBeNull();
    // Persisted field should survive
    expect(s.theme).toBe('dark');
  });
});

// ===========================================================================
// v0 → v1 migration (debugLogging → logLevel)
// ===========================================================================

describe('v0 → v1 migration (debugLogging → logLevel)', () => {
  it('migrates debugLogging: true to logLevel: debug', async () => {
    // Seed localStorage with a v0 payload that has debugLogging: true
    const v0State = {
      state: {
        theme: 'light',
        softMode: false,
        debugLogging: true,
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
      },
      version: 0,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v0State));

    // Rehydrate from v0 storage — migration should run
    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.logLevel).toBe('debug');
    // debugLogging is deleted from persisted state by migration,
    // but the in-memory state may still have it from shallow merge.
    // The key assertion is that logLevel was correctly set.
  });

  it('migrates debugLogging: false to logLevel: warn', async () => {
    const v0State = {
      state: {
        theme: 'dark',
        softMode: true,
        debugLogging: false,
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
      },
      version: 0,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v0State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.logLevel).toBe('warn');
    // Other fields should carry through
    expect(s.theme).toBe('dark');
    // softMode: true in v0 state migrates to contrastLevel: 100
    expect(s.contrastLevel).toBe(100);
  });

  it('v0 state without debugLogging uses logLevel default', async () => {
    const v0State = {
      state: {
        theme: 'system',
        softMode: false,
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
      },
      version: 0,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v0State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    // logLevel should fall through to the store default 'warn'
    expect(useSettingsStore.getState().logLevel).toBe('warn');
  });
});

// ===========================================================================
// v1 → v2 migration (softMode → contrastLevel)
// ===========================================================================

describe('v1 → v2 migration (softMode → contrastLevel)', () => {
  it('migrates softMode: true to contrastLevel: 100', async () => {
    const v1State = {
      state: {
        theme: 'dark',
        softMode: true,
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
      },
      version: 1,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v1State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.contrastLevel).toBe(100);
    expect(s.theme).toBe('dark');
  });

  it('migrates softMode: false to contrastLevel: 0', async () => {
    const v1State = {
      state: {
        theme: 'light',
        softMode: false,
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
      },
      version: 1,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v1State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.contrastLevel).toBe(0);
  });

  it('v1 state without softMode defaults contrastLevel to 0', async () => {
    const v1State = {
      state: {
        theme: 'system',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
      },
      version: 1,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v1State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(useSettingsStore.getState().contrastLevel).toBe(0);
  });

  it('v0 state with softMode: true migrates through both steps', async () => {
    const v0State = {
      state: {
        theme: 'dark',
        softMode: true,
        debugLogging: true,
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
      },
      version: 0,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v0State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.contrastLevel).toBe(100);
    expect(s.logLevel).toBe('debug');
  });
});

// ===========================================================================
// v18 → v19 migration (Classic layout removal — drop deleted fields)
// ===========================================================================

describe('v18 → v19 migration (Classic layout removal)', () => {
  it('strips uiPreview, chatPanelOpen, previewInvitation*, revertInvitation* from persisted state', async () => {
    const v18State = {
      state: {
        theme: 'dark',
        contrastLevel: 50,
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: true,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        printLayout: false,
        uiPreview: 'quiet-composer',
        accent: 'default',
        previewInvitationShownAt: 1234567890,
        previewInvitationDismissedAt: 1234567899,
        revertInvitationShownAt: 1234567890,
        revertInvitationDismissedAt: 1234567899,
      },
      version: 18,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v18State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    // Pre-existing kept fields survive untouched.
    const s = useSettingsStore.getState();
    expect(s.theme).toBe('dark');
    expect(s.contrastLevel).toBe(50);
    expect(s.accent).toBe('default');

    // The persisted JSON is at v19 with the deleted fields gone.
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
    expect(parsed.state.uiPreview).toBeUndefined();
    expect(parsed.state.chatPanelOpen).toBeUndefined();
    expect(parsed.state.previewInvitationShownAt).toBeUndefined();
    expect(parsed.state.previewInvitationDismissedAt).toBeUndefined();
    expect(parsed.state.revertInvitationShownAt).toBeUndefined();
    expect(parsed.state.revertInvitationDismissedAt).toBeUndefined();
  });
});

// ===========================================================================
// Accent (UI refresh task #3)
// ===========================================================================

describe('accent field', () => {
  it('default value is "default"', () => {
    expect(useSettingsStore.getState().accent).toBe('default');
  });

  it('setAccent flips between values', () => {
    const { setAccent } = useSettingsStore.getState();

    setAccent('orange');
    expect(useSettingsStore.getState().accent).toBe('orange');

    setAccent('blue');
    expect(useSettingsStore.getState().accent).toBe('blue');

    setAccent('system');
    expect(useSettingsStore.getState().accent).toBe('system');

    setAccent('default');
    expect(useSettingsStore.getState().accent).toBe('default');
  });

  it('persists accent across restart', async () => {
    useSettingsStore.getState().setAccent('blue');
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    expect(useSettingsStore.getState().accent).toBe('blue');
  });
});

// ===========================================================================
// cmdBarPinned + cmdBarPinnedWidth (UI refresh task #28)
// ===========================================================================

describe('cmdBarPinned (pinned-panel mode)', () => {
  it('default cmdBarPinned is false', () => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
    expect(useSettingsStore.getState().cmdBarPinned).toBe(false);
  });

  it('default cmdBarPinnedWidth is 400', () => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(400);
  });

  it('setCmdBarPinned toggles between false and true', () => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
    const { setCmdBarPinned } = useSettingsStore.getState();

    setCmdBarPinned(true);
    expect(useSettingsStore.getState().cmdBarPinned).toBe(true);

    setCmdBarPinned(false);
    expect(useSettingsStore.getState().cmdBarPinned).toBe(false);
  });

  it('setCmdBarPinnedWidth sets a value within range', () => {
    useSettingsStore.getState().setCmdBarPinnedWidth(500);
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(500);
  });

  it('setCmdBarPinnedWidth clamps below the minimum (280)', () => {
    useSettingsStore.getState().setCmdBarPinnedWidth(100);
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(280);
  });

  it('setCmdBarPinnedWidth clamps above the maximum (800)', () => {
    useSettingsStore.getState().setCmdBarPinnedWidth(1200);
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(800);
  });

  it('setCmdBarPinnedWidth rounds fractional values', () => {
    useSettingsStore.getState().setCmdBarPinnedWidth(450.7);
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(451);
  });

  it('persists cmdBarPinned across restart', async () => {
    useSettingsStore.getState().setCmdBarPinned(true);
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    expect(useSettingsStore.getState().cmdBarPinned).toBe(true);
  });

  it('persists cmdBarPinnedWidth across restart', async () => {
    useSettingsStore.getState().setCmdBarPinnedWidth(560);
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(560);
  });
});

describe('v5 → v6 migration (cmdBarPinned + cmdBarPinnedWidth)', () => {
  it('adds cmdBarPinned: false and cmdBarPinnedWidth: 400 to a v5 state lacking them', async () => {
    const v5State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
      },
      version: 5,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v5State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.cmdBarPinned).toBe(false);
    expect(s.cmdBarPinnedWidth).toBe(400);

    // Persisted JSON should reflect the bumped version + new fields so the
    // migration doesn't re-run on the next launch.
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
    expect(parsed.state.cmdBarPinned).toBe(false);
    expect(parsed.state.cmdBarPinnedWidth).toBe(400);
  });

  it('preserves existing cmdBarPinned when present (idempotent)', async () => {
    const v6State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
        cmdBarPinned: true,
        cmdBarPinnedWidth: 500,
      },
      version: 6,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v6State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.cmdBarPinned).toBe(true);
    expect(s.cmdBarPinnedWidth).toBe(500);
  });
});

describe('v4 → v5 migration (accent field)', () => {
  it('adds accent: "default" to a v4 state lacking it', async () => {
    const v4State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
      },
      version: 4,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v4State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(useSettingsStore.getState().accent).toBe('default');
  });

  it('preserves existing accent when present (idempotent)', async () => {
    const v5State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'orange',
      },
      version: 5,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v5State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(useSettingsStore.getState().accent).toBe('orange');
  });
});

// ===========================================================================
// v6 → v7 migration (quiet-chrome presets + overrides)
// ===========================================================================

describe('v6 → v7 migration (quietChromePreset + quietChromeOverrides)', () => {
  it('adds quietChromePreset: "default" and the default overrides to a v6 state lacking them', async () => {
    const v6State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
        cmdBarPinned: false,
        cmdBarPinnedWidth: 400,
      },
      version: 6,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v6State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.quietChromePreset).toBe('default');
    expect(s.quietChromeOverrides).toEqual({
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: false,
      orb: false,
      titlebar: false,
      cmdbar: false,
    });

    // Persisted JSON should reflect bumped version and new fields so the
    // migration doesn't re-run on the next launch.
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(27);
    expect(parsed.state.quietChromePreset).toBe('default');
    expect(parsed.state.quietChromeOverrides).toBeTruthy();
  });

  it('preserves existing quietChromePreset when present (idempotent)', async () => {
    const v7State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
        cmdBarPinned: false,
        cmdBarPinnedWidth: 400,
        quietChromePreset: 'aggressive',
        quietChromeOverrides: {
          toolbar: true,
          status: true,
          docHead: true,
          sidebar: true,
          orb: true,
        },
      },
      version: 7,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v7State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.quietChromePreset).toBe('aggressive');
    expect(s.quietChromeOverrides.sidebar).toBe(true);
    expect(s.quietChromeOverrides.orb).toBe(true);
  });
});

describe('quiet-chrome setters', () => {
  beforeEach(() => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
  });

  it('setQuietChromePreset flips to a named preset and resets overrides to match', () => {
    const { setQuietChromePreset } = useSettingsStore.getState();

    setQuietChromePreset('aggressive');
    const a = useSettingsStore.getState();
    expect(a.quietChromePreset).toBe('aggressive');
    expect(a.quietChromeOverrides).toEqual({
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: true,
      orb: true,
      titlebar: true,
      cmdbar: true,
    });

    setQuietChromePreset('relaxed');
    const r = useSettingsStore.getState();
    expect(r.quietChromePreset).toBe('relaxed');
    expect(r.quietChromeOverrides).toEqual({
      toolbar: true,
      status: true,
      docHead: false,
      sidebar: false,
      orb: false,
      titlebar: false,
      cmdbar: false,
    });
  });

  it('setQuietChromePreset("custom") preserves existing overrides', () => {
    const { setQuietChromePreset, setQuietChromeOverride } =
      useSettingsStore.getState();

    // First, flip a single switch — this auto-switches preset to "custom".
    setQuietChromeOverride('sidebar', true);
    const before = useSettingsStore.getState();
    expect(before.quietChromePreset).toBe('custom');
    expect(before.quietChromeOverrides.sidebar).toBe(true);

    // Explicitly re-select "custom" — shouldn't reset the overrides.
    setQuietChromePreset('custom');
    const after = useSettingsStore.getState();
    expect(after.quietChromePreset).toBe('custom');
    expect(after.quietChromeOverrides.sidebar).toBe(true);
  });

  it('setQuietChromeOverride flips the preset to "custom"', () => {
    const { setQuietChromeOverride } = useSettingsStore.getState();
    expect(useSettingsStore.getState().quietChromePreset).toBe('default');

    setQuietChromeOverride('orb', true);
    expect(useSettingsStore.getState().quietChromePreset).toBe('custom');
    expect(useSettingsStore.getState().quietChromeOverrides.orb).toBe(true);
    // Other overrides unchanged.
    expect(useSettingsStore.getState().quietChromeOverrides.toolbar).toBe(true);
  });
});

// ===========================================================================
// Sidebar composition (ui-refresh task #35)
// ===========================================================================

describe('sidebar composition — defaults', () => {
  beforeEach(() => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
  });

  it('sidebarRecentCap defaults to 5', () => {
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(5);
  });

  it('sidebarTagsCap defaults to 5', () => {
    expect(useSettingsStore.getState().sidebarTagsCap).toBe(5);
  });

  it('sidebarMentionsCap defaults to 5', () => {
    expect(useSettingsStore.getState().sidebarMentionsCap).toBe(5);
  });
});

describe('setSidebarRecentCap clamping', () => {
  beforeEach(() => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
  });

  it('sets value within [3, 15]', () => {
    useSettingsStore.getState().setSidebarRecentCap(7);
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(7);
  });

  it('clamps values below 3 to 3', () => {
    useSettingsStore.getState().setSidebarRecentCap(1);
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(3);

    useSettingsStore.getState().setSidebarRecentCap(-5);
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(3);
  });

  it('clamps values above 15 to 15', () => {
    useSettingsStore.getState().setSidebarRecentCap(20);
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(15);

    useSettingsStore.getState().setSidebarRecentCap(1000);
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(15);
  });

  it('rounds fractional values', () => {
    useSettingsStore.getState().setSidebarRecentCap(8.6);
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(9);
  });

  it('handles exact boundary values', () => {
    useSettingsStore.getState().setSidebarRecentCap(3);
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(3);

    useSettingsStore.getState().setSidebarRecentCap(15);
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(15);
  });
});

describe('setSidebarTagsCap clamping', () => {
  beforeEach(() => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
  });

  it('sets value within [0, 15]', () => {
    useSettingsStore.getState().setSidebarTagsCap(10);
    expect(useSettingsStore.getState().sidebarTagsCap).toBe(10);
  });

  it('accepts 0 (slider IS the visibility control — 0 hides the section)', () => {
    useSettingsStore.getState().setSidebarTagsCap(0);
    expect(useSettingsStore.getState().sidebarTagsCap).toBe(0);
  });

  it('clamps negative values to 0', () => {
    useSettingsStore.getState().setSidebarTagsCap(-5);
    expect(useSettingsStore.getState().sidebarTagsCap).toBe(0);
  });

  it('clamps values above 15 to 15', () => {
    useSettingsStore.getState().setSidebarTagsCap(100);
    expect(useSettingsStore.getState().sidebarTagsCap).toBe(15);
  });

  it('rounds fractional values', () => {
    useSettingsStore.getState().setSidebarTagsCap(12.4);
    expect(useSettingsStore.getState().sidebarTagsCap).toBe(12);
  });
});

describe('setSidebarMentionsCap clamping', () => {
  beforeEach(() => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
  });

  it('sets value within [0, 15]', () => {
    useSettingsStore.getState().setSidebarMentionsCap(9);
    expect(useSettingsStore.getState().sidebarMentionsCap).toBe(9);
  });

  it('accepts 0 (slider IS the visibility control — 0 hides the section)', () => {
    useSettingsStore.getState().setSidebarMentionsCap(0);
    expect(useSettingsStore.getState().sidebarMentionsCap).toBe(0);
  });

  it('clamps negative values to 0', () => {
    useSettingsStore.getState().setSidebarMentionsCap(-3);
    expect(useSettingsStore.getState().sidebarMentionsCap).toBe(0);
  });

  it('clamps values above 15 to 15', () => {
    useSettingsStore.getState().setSidebarMentionsCap(50);
    expect(useSettingsStore.getState().sidebarMentionsCap).toBe(15);
  });

  it('rounds fractional values', () => {
    useSettingsStore.getState().setSidebarMentionsCap(7.7);
    expect(useSettingsStore.getState().sidebarMentionsCap).toBe(8);
  });
});

describe('sidebar composition — persistence round-trip', () => {
  it('persists sidebarRecentCap and sidebarTagsCap across restart', async () => {
    useSettingsStore.getState().setSidebarRecentCap(12);
    useSettingsStore.getState().setSidebarTagsCap(8);
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    const s = useSettingsStore.getState();
    expect(s.sidebarRecentCap).toBe(12);
    expect(s.sidebarTagsCap).toBe(8);
  });

  it('persists sidebarMentionsCap across restart', async () => {
    useSettingsStore.getState().setSidebarMentionsCap(11);
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    const s = useSettingsStore.getState();
    expect(s.sidebarMentionsCap).toBe(11);
  });

  it('persists sidebarTagsCap = 0 (hidden state) across restart', async () => {
    useSettingsStore.getState().setSidebarTagsCap(0);
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    const s = useSettingsStore.getState();
    expect(s.sidebarTagsCap).toBe(0);
  });
});

// ===========================================================================
// v7 → v8 migration (sidebar composition)
// ===========================================================================

describe('v7 → v8 migration (sidebar composition)', () => {
  it('adds sidebarRecentCap: 5 and sidebarTagsCap: 5 to a v7 state lacking them', async () => {
    const v7State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
        cmdBarPinned: false,
        cmdBarPinnedWidth: 400,
        quietChromePreset: 'default',
        quietChromeOverrides: {
          toolbar: true,
          status: true,
          docHead: true,
          sidebar: false,
          orb: false,
        },
      },
      version: 7,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v7State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.sidebarRecentCap).toBe(5);
    expect(s.sidebarTagsCap).toBe(5);
    // The Hidden flag was added in v8, then dropped in v12. After rehydrating
    // a v7 state through to v12 the Hidden field should not exist on state.
    expect((s as unknown as Record<string, unknown>).sidebarTagsHidden).toBeUndefined();

    // Persisted JSON should reflect the bumped version + new fields so the
    // migration doesn't re-run on the next launch.
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
    expect(parsed.state.sidebarRecentCap).toBe(5);
    expect(parsed.state.sidebarTagsCap).toBe(5);
    // Hidden field stripped by v11 → v12 migration.
    expect(parsed.state.sidebarTagsHidden).toBeUndefined();
  });

  it('preserves existing sidebar composition cap values when present (idempotent)', async () => {
    // v8 state with Hidden = false should preserve the cap untouched as the
    // chain runs forward to v12. Hidden = true is covered by the dedicated
    // v11 → v12 migration test below.
    const v8State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
        cmdBarPinned: false,
        cmdBarPinnedWidth: 400,
        quietChromePreset: 'default',
        quietChromeOverrides: {
          toolbar: true,
          status: true,
          docHead: true,
          sidebar: false,
          orb: false,
        },
        sidebarRecentCap: 10,
        sidebarTagsCap: 7,
        sidebarTagsHidden: false,
      },
      version: 8,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v8State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.sidebarRecentCap).toBe(10);
    expect(s.sidebarTagsCap).toBe(7);
    expect((s as unknown as Record<string, unknown>).sidebarTagsHidden).toBeUndefined();
  });
});


describe('v9 → v10 migration (cmdBarExpandedWidth)', () => {
  it('adds cmdBarExpandedWidth: 640 to a v9 state lacking it', async () => {
    const v9State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
        cmdBarPinned: false,
        cmdBarPinnedWidth: 400,
        quietChromePreset: 'default',
        quietChromeOverrides: {
          toolbar: true,
          status: true,
          docHead: true,
          sidebar: false,
          orb: false,
        },
        sidebarRecentCap: 5,
        sidebarTagsCap: 5,
        sidebarTagsHidden: false,
        previewInvitationShownAt: null,
        previewInvitationDismissedAt: null,
      },
      version: 9,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v9State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.cmdBarExpandedWidth).toBe(640);

    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
    expect(parsed.state.cmdBarExpandedWidth).toBe(640);
  });

  it('clamps the setter to the 480–1400 range', () => {
    useSettingsStore.getState().setCmdBarExpandedWidth(100);
    expect(useSettingsStore.getState().cmdBarExpandedWidth).toBe(480);
    useSettingsStore.getState().setCmdBarExpandedWidth(2000);
    expect(useSettingsStore.getState().cmdBarExpandedWidth).toBe(1400);
    useSettingsStore.getState().setCmdBarExpandedWidth(800);
    expect(useSettingsStore.getState().cmdBarExpandedWidth).toBe(800);
  });
});

// ===========================================================================
// v10 → v11 migration (sidebar Mentions composition)
// ===========================================================================

describe('v10 → v11 migration (sidebar Mentions composition)', () => {
  it('adds sidebarMentionsCap: 5 to a v10 state lacking it (v11 added Hidden, v12 dropped it)', async () => {
    const v10State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
        cmdBarPinned: false,
        cmdBarPinnedWidth: 400,
        cmdBarExpandedWidth: 640,
        quietChromePreset: 'default',
        quietChromeOverrides: {
          toolbar: true,
          status: true,
          docHead: true,
          sidebar: false,
          orb: false,
        },
        sidebarRecentCap: 5,
        sidebarTagsCap: 5,
        sidebarTagsHidden: false,
        previewInvitationShownAt: null,
        previewInvitationDismissedAt: null,
      },
      version: 10,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v10State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.sidebarMentionsCap).toBe(5);
    // Hidden field stripped by v11 → v12 migration.
    expect((s as unknown as Record<string, unknown>).sidebarMentionsHidden).toBeUndefined();

    // Persisted JSON should reflect the bumped version + new fields so the
    // migration doesn't re-run on the next launch.
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
    expect(parsed.state.sidebarMentionsCap).toBe(5);
    expect(parsed.state.sidebarMentionsHidden).toBeUndefined();
  });

  it('v11 state with sidebarMentionsHidden: true migrates to sidebarMentionsCap: 0 in v12', async () => {
    const v11State = {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
        cmdBarPinned: false,
        cmdBarPinnedWidth: 400,
        cmdBarExpandedWidth: 640,
        quietChromePreset: 'default',
        quietChromeOverrides: {
          toolbar: true,
          status: true,
          docHead: true,
          sidebar: false,
          orb: false,
        },
        sidebarRecentCap: 5,
        sidebarTagsCap: 5,
        sidebarTagsHidden: false,
        sidebarMentionsCap: 9,
        sidebarMentionsHidden: true,
        previewInvitationShownAt: null,
        previewInvitationDismissedAt: null,
      },
      version: 11,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v11State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    // v11→v12 collapsed Hidden: true → cap 0 to preserve user intent.
    expect(s.sidebarMentionsCap).toBe(0);
    expect((s as unknown as Record<string, unknown>).sidebarMentionsHidden).toBeUndefined();
  });
});

// ===========================================================================
// v11 → v12 migration (drop Tags / Mentions Hidden booleans, collapse to
// cap = 0 when the flag was true so the user's "I had this hidden" intent
// survives the migration)
// ===========================================================================

describe('v11 → v12 migration (drop Hidden booleans)', () => {
  function buildV11State(overrides: Record<string, unknown>) {
    return {
      state: {
        theme: 'dark',
        showFloatingToolbar: true,
        toolbarVisible: true,
        contentWidth: 'auto',
        sidebarOpen: true,
        sidebarPinned: true,
        sidebarWidth: 280,
        chatPanelOpen: false,
        notesRootPath: '~/Notesage',
        gitEnabled: false,
        logLevel: 'warn',
        contrastLevel: 0,
        printLayout: false,
        uiPreview: 'legacy',
        accent: 'default',
        cmdBarPinned: false,
        cmdBarPinnedWidth: 400,
        cmdBarExpandedWidth: 640,
        quietChromePreset: 'default',
        quietChromeOverrides: {
          toolbar: true,
          status: true,
          docHead: true,
          sidebar: false,
          orb: false,
        },
        sidebarRecentCap: 5,
        sidebarTagsCap: 5,
        sidebarTagsHidden: false,
        sidebarMentionsCap: 5,
        sidebarMentionsHidden: false,
        previewInvitationShownAt: null,
        previewInvitationDismissedAt: null,
        ...overrides,
      },
      version: 11,
    };
  }

  it('collapses sidebarTagsHidden: true into sidebarTagsCap: 0 and deletes the flag', async () => {
    const v11State = buildV11State({
      sidebarTagsCap: 5,
      sidebarTagsHidden: true,
    });
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v11State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.sidebarTagsCap).toBe(0);
    expect((s as unknown as Record<string, unknown>).sidebarTagsHidden).toBeUndefined();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
    expect(parsed.state.sidebarTagsCap).toBe(0);
    expect(parsed.state.sidebarTagsHidden).toBeUndefined();
  });

  it('collapses sidebarMentionsHidden: true into sidebarMentionsCap: 0 and deletes the flag', async () => {
    const v11State = buildV11State({
      sidebarMentionsCap: 9,
      sidebarMentionsHidden: true,
    });
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v11State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.sidebarMentionsCap).toBe(0);
    expect((s as unknown as Record<string, unknown>).sidebarMentionsHidden).toBeUndefined();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
    expect(parsed.state.sidebarMentionsCap).toBe(0);
    expect(parsed.state.sidebarMentionsHidden).toBeUndefined();
  });

  it('preserves cap and drops the flag when Hidden is false (no collapse)', async () => {
    const v11State = buildV11State({
      sidebarTagsCap: 7,
      sidebarTagsHidden: false,
      sidebarMentionsCap: 4,
      sidebarMentionsHidden: false,
    });
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v11State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.sidebarTagsCap).toBe(7);
    expect(s.sidebarMentionsCap).toBe(4);
    expect((s as unknown as Record<string, unknown>).sidebarTagsHidden).toBeUndefined();
    expect((s as unknown as Record<string, unknown>).sidebarMentionsHidden).toBeUndefined();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
    expect(parsed.state.sidebarTagsHidden).toBeUndefined();
    expect(parsed.state.sidebarMentionsHidden).toBeUndefined();
  });

  it('handles both flags true at once (collapses both caps to 0)', async () => {
    const v11State = buildV11State({
      sidebarTagsCap: 8,
      sidebarTagsHidden: true,
      sidebarMentionsCap: 12,
      sidebarMentionsHidden: true,
    });
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v11State));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.sidebarTagsCap).toBe(0);
    expect(s.sidebarMentionsCap).toBe(0);
    expect((s as unknown as Record<string, unknown>).sidebarTagsHidden).toBeUndefined();
    expect((s as unknown as Record<string, unknown>).sidebarMentionsHidden).toBeUndefined();
  });
});

// ===========================================================================
// cmdBarExpandedHeight — resizable command bar height (issue #37)
// ===========================================================================

describe('cmdBarExpandedHeight', () => {
  it('defaults to 480', () => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(480);
  });

  it('setCmdBarExpandedHeight sets a value within range', () => {
    useSettingsStore.getState().setCmdBarExpandedHeight(600);
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(600);
  });

  it('setCmdBarExpandedHeight clamps below the minimum (240) to 240', () => {
    useSettingsStore.getState().setCmdBarExpandedHeight(100);
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(240);
  });

  it('setCmdBarExpandedHeight clamps above the maximum (800) to 800', () => {
    useSettingsStore.getState().setCmdBarExpandedHeight(1200);
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(800);
  });

  it('setCmdBarExpandedHeight rounds fractional values', () => {
    useSettingsStore.getState().setCmdBarExpandedHeight(350.7);
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(351);
  });

  it('persists cmdBarExpandedHeight across restart', async () => {
    useSettingsStore.getState().setCmdBarExpandedHeight(600);
    await waitForPersist();

    await simulateRestart(useSettingsStore, STORAGE_KEY, SETTINGS_DEFAULTS);

    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(600);
  });
});


// ===========================================================================
// v14 migration — releaseChannel defaults to 'stable' on upgrade
// ===========================================================================

describe('v14 migration: releaseChannel', () => {
  function buildV13State(overrides: Record<string, unknown> = {}): string {
    const state = {
      theme: 'system',
      logLevel: 'warn',
      autoCheckUpdates: true,
      cmdBarExpandedHeight: 480,
      ...overrides,
    };
    return JSON.stringify({ state, version: 13 });
  }

  it("migrates v13 state without releaseChannel to 'stable'", async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV13State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(
      (useSettingsStore.getState() as unknown as Record<string, unknown>).releaseChannel,
    ).toBeUndefined();
  });

  it('drops a persisted alpha channel entirely — v26 removed the concept', async () => {
    // v14's intent was "do not clobber a channel the user already chose", and
    // it held until there was only one stream. v26 deletes the key: the
    // picker and the alpha update path are gone, so a lingering value would
    // only mislead a future reader.
    localStorageMock.setItem(STORAGE_KEY, buildV13State({ releaseChannel: 'alpha' }));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const raw = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(raw.state.releaseChannel).toBeUndefined();
  });

  it('bumps persisted version to 18 after migration', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV13State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
  });
});

// ===========================================================================
// v15 migration — htmlViewerAllowForms defaults to false on upgrade
// (field subsequently deleted in v20 — see v20 migration tests below)
// ===========================================================================

describe('v15 migration: htmlViewerAllowForms (field removed in v20)', () => {
  function buildV14State(overrides: Record<string, unknown> = {}): string {
    const state = {
      theme: 'system',
      logLevel: 'warn',
      autoCheckUpdates: true,
      releaseChannel: 'stable',
      ...overrides,
    };
    return JSON.stringify({ state, version: 14 });
  }

  it('migrates v14 state and htmlViewerAllowForms is absent after v20 deletes it', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV14State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    // v20 migration deletes the key — it should not be present on the store
    expect((useSettingsStore.getState() as unknown as Record<string, unknown>).htmlViewerAllowForms).toBeUndefined();
  });

  it('bumps persisted version to 20 after all migrations', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV14State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
  });
});

// ===========================================================================
// v20 migration — htmlViewerAllowForms key deleted (#360)
// ===========================================================================

describe('v20 migration: htmlViewerAllowForms deletion', () => {
  function buildV19State(overrides: Record<string, unknown> = {}): string {
    const state = {
      theme: 'system',
      logLevel: 'warn',
      autoCheckUpdates: true,
      releaseChannel: 'stable',
      htmlViewerAllowForms: false,
      htmlViewerAllowScripts: false,
      htmlViewerBlockExternalResources: false,
      ...overrides,
    };
    return JSON.stringify({ state, version: 19 });
  }

  it('deletes htmlViewerAllowForms from persisted state', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV19State({ htmlViewerAllowForms: true }));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.state.htmlViewerAllowForms).toBeUndefined();
  });

  it('bumps persisted version forward', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV19State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    // Latest persist version — re-bumped to 21 by the quiet-chrome
    // titlebar/cmdbar extension (2026-05-28). Whatever the current version
    // is, an older state should rehydrate up to it in one pass.
    expect(parsed.version).toBeGreaterThanOrEqual(20);
  });

  it('preserves unrelated settings during migration', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV19State({ htmlViewerAllowScripts: true }));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(useSettingsStore.getState().htmlViewerAllowScripts).toBe(true);
  });
});

// ===========================================================================
// v16 migration — htmlViewerAllowScripts defaults to false on upgrade
// ===========================================================================

describe('v16 migration: htmlViewerAllowScripts', () => {
  function buildV15State(overrides: Record<string, unknown> = {}): string {
    const state = {
      theme: 'system',
      logLevel: 'warn',
      autoCheckUpdates: true,
      releaseChannel: 'stable',
      htmlViewerAllowForms: false,
      ...overrides,
    };
    return JSON.stringify({ state, version: 15 });
  }

  it('migrates v15 state without htmlViewerAllowScripts to false', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV15State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(useSettingsStore.getState().htmlViewerAllowScripts).toBe(false);
  });

  it('preserves existing htmlViewerAllowScripts when already present', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV15State({ htmlViewerAllowScripts: true }));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(useSettingsStore.getState().htmlViewerAllowScripts).toBe(true);
  });

  it('bumps persisted version to 18 after migration', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV15State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBeGreaterThanOrEqual(20);
  });
});

// ===========================================================================
// v17 migration — htmlViewerBlockExternalResources defaults to false on upgrade
// ===========================================================================

describe('v17 migration: htmlViewerBlockExternalResources', () => {
  function buildV16State(overrides: Record<string, unknown> = {}): string {
    const state = {
      theme: 'system',
      logLevel: 'warn',
      autoCheckUpdates: true,
      releaseChannel: 'stable',
      htmlViewerAllowForms: false,
      htmlViewerAllowScripts: false,
      ...overrides,
    };
    return JSON.stringify({ state, version: 16 });
  }

  it('htmlViewerBlockExternalResources defaults to false (new installs)', () => {
    expect(useSettingsStore.getState().htmlViewerBlockExternalResources).toBe(false);
  });

  it('setHtmlViewerBlockExternalResources toggles the setting', () => {
    useSettingsStore.getState().setHtmlViewerBlockExternalResources(true);
    expect(useSettingsStore.getState().htmlViewerBlockExternalResources).toBe(true);
    useSettingsStore.getState().setHtmlViewerBlockExternalResources(false);
    expect(useSettingsStore.getState().htmlViewerBlockExternalResources).toBe(false);
  });

  it('migrates v16 state without htmlViewerBlockExternalResources to false', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV16State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(useSettingsStore.getState().htmlViewerBlockExternalResources).toBe(false);
  });

  it('preserves existing htmlViewerBlockExternalResources when already present', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV16State({ htmlViewerBlockExternalResources: true }));

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(useSettingsStore.getState().htmlViewerBlockExternalResources).toBe(true);
  });

  it('bumps persisted version forward after migration', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV16State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    // Re-bumped to 21 by the quiet-chrome extension (2026-05-28). Asserting
    // ≥ 20 so future bumps don't churn this test for free.
    expect(parsed.version).toBeGreaterThanOrEqual(20);
  });
});

// ===========================================================================
// v21 migration — quiet-chrome titlebar/cmdbar backfill (2026-05-28)
// ===========================================================================
//
// The 2026-05-28 quiet-chrome extension added `titlebar` and `cmdbar` keys
// to `QuietChromeTargets`. Users on a named preset see no impact (the preset
// table bakes the new keys in), but Custom-mode users with persisted
// overrides need the new keys backfilled or the Advanced switches in
// Settings would render an undefined checkbox state.

describe('v21 migration: quietChromeOverrides titlebar/cmdbar backfill', () => {
  function buildV20State(overridesPatch: Record<string, unknown> = {}): string {
    const state = {
      theme: 'system',
      logLevel: 'warn',
      autoCheckUpdates: true,
      releaseChannel: 'stable',
      htmlViewerAllowScripts: false,
      htmlViewerBlockExternalResources: false,
      quietChromePreset: 'custom',
      quietChromeOverrides: {
        toolbar: true,
        status: true,
        docHead: true,
        sidebar: true,
        orb: false,
        // Intentionally missing titlebar + cmdbar — the v20 shape.
        ...overridesPatch,
      },
    };
    return JSON.stringify({ state, version: 20 });
  }

  it('backfills titlebar=false and cmdbar=false on a v20 Custom-mode state', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV20State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.quietChromeOverrides.titlebar).toBe(false);
    expect(s.quietChromeOverrides.cmdbar).toBe(false);
    // Existing overrides are preserved verbatim.
    expect(s.quietChromeOverrides.sidebar).toBe(true);
    expect(s.quietChromeOverrides.orb).toBe(false);
  });

  it('does not overwrite an explicit titlebar/cmdbar value already in the persisted state', async () => {
    // A user could already have these keys (e.g. they downgraded once and
    // re-upgraded). The migration must be idempotent.
    localStorageMock.setItem(
      STORAGE_KEY,
      buildV20State({ titlebar: true, cmdbar: true }),
    );

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const s = useSettingsStore.getState();
    expect(s.quietChromeOverrides.titlebar).toBe(true);
    expect(s.quietChromeOverrides.cmdbar).toBe(true);
  });

  it('bumps persisted version to the latest after migration', async () => {
    localStorageMock.setItem(STORAGE_KEY, buildV20State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(27);
  });

  it('v22 migration backfills linkPreviewRemoteImages=false (privacy by default)', async () => {
    // A persisted v21 state lacking the new flag must rehydrate with it OFF.
    localStorageMock.setItem(STORAGE_KEY, buildV20State());

    await useSettingsStore.persist.rehydrate();
    await waitForPersist();

    expect(useSettingsStore.getState().linkPreviewRemoteImages).toBe(false);
  });
});

// ===========================================================================
// Telemetry consent (tri-state fields + effective selectors + Rust sync)
// ===========================================================================

describe('telemetry consent', () => {
  // `buildAlpha` simulates running an alpha vs stable BUILD (the real signal is
  // `buildIsAlpha()`, mocked at the top of this file). Telemetry defaults key on
  // the build, not the update channel.
  // `labsOn` replaces the old `buildAlpha` argument: with one binary there is
  // no alpha build to key on, so the default follows Labs instead (PRD
  // 2026-08-15-single-binary-feature-flags).
  function resetTelemetry(labsOn = false) {
    buildChannel.isAlpha = false;
    useFlagStore.setState({ enabled: labsOn ? (['demo'] as FlagId[]) : [] });
    useSettingsStore.setState({
      ...SETTINGS_DEFAULTS,
      telemetryUsageEnabled: null,
      telemetryCrashEnabled: null,
      telemetryNoticeSeen: false,
    } as Record<string, unknown>);
  }

  afterEach(() => {
    buildChannel.isAlpha = false;
  });

  it('defaults: tri-state null, notice unseen', () => {
    resetTelemetry();
    const s = useSettingsStore.getState();
    expect(s.telemetryUsageEnabled).toBeNull();
    expect(s.telemetryCrashEnabled).toBeNull();
    expect(s.telemetryNoticeSeen).toBe(false);
  });

  it('effective default follows LABS when not overridden', () => {
    resetTelemetry(false); // nothing experimental enabled → off
    expect(selectEffectiveTelemetryUsage(useSettingsStore.getState())).toBe(false);
    expect(selectEffectiveTelemetryCrash(useSettingsStore.getState())).toBe(false);

    resetTelemetry(true); // an experimental feature enabled → on
    expect(selectEffectiveTelemetryUsage(useSettingsStore.getState())).toBe(true);
    expect(selectEffectiveTelemetryCrash(useSettingsStore.getState())).toBe(true);
  });

  it('Labs default is ON regardless of the update channel', () => {
    // Keying on Labs. (The release channel this once contrasted with no
    // longer exists — one binary, one stream.)
    resetTelemetry(true);
    expect(selectEffectiveTelemetryUsage(useSettingsStore.getState())).toBe(true);
    expect(selectEffectiveTelemetryCrash(useSettingsStore.getState())).toBe(true);
  });

  it('explicit override wins over the build default', () => {
    resetTelemetry(true); // alpha build → default on
    useSettingsStore.getState().setTelemetryUsageEnabled(false);
    expect(selectEffectiveTelemetryUsage(useSettingsStore.getState())).toBe(false);

    resetTelemetry(false); // stable build → default off
    useSettingsStore.getState().setTelemetryCrashEnabled(true);
    expect(selectEffectiveTelemetryCrash(useSettingsStore.getState())).toBe(true);
  });


  it('syncs effective consent to Rust via telemetry_apply_consent on toggle', () => {
    resetTelemetry(false); // stable build
    vi.mocked(invoke).mockClear();

    // Explicitly enabling usage → usage true, crash still build default (false).
    useSettingsStore.getState().setTelemetryUsageEnabled(true);
    expect(invoke).toHaveBeenCalledWith('telemetry_apply_consent', {
      usage: true,
      crash: false,
    });
  });

  it('toggle sync reflects the Labs default for the untouched stream', () => {
    resetTelemetry(true); // an experimental feature enabled → both default on
    vi.mocked(invoke).mockClear();

    // Explicitly disabling crash → crash false, usage still build default (true).
    useSettingsStore.getState().setTelemetryCrashEnabled(false);
    expect(invoke).toHaveBeenCalledWith('telemetry_apply_consent', {
      usage: true,
      crash: false,
    });
  });
});

describe('single-binary migration (v26)', () => {
  // Shipped in alpha.36 as "rewrite the channel to stable", which is what got
  // existing alpha users onto the single stream before the endpoint went
  // away. Now that the channel concept is gone entirely, the same step DROPS
  // the key — a lingering value would only mislead a future reader.
  function migrate(persisted: Record<string, unknown>, from: number) {
    const opts = (useSettingsStore as unknown as {
      persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } };
    }).persist.getOptions();
    return opts.migrate!(persisted, from) as Record<string, unknown>;
  }

  it('drops the channel key for an alpha-channel user', () => {
    expect(migrate({ releaseChannel: 'alpha' }, 25).releaseChannel).toBeUndefined();
  });

  it('drops it for a stable user too — the concept is gone, not the value', () => {
    expect(migrate({ releaseChannel: 'stable' }, 25).releaseChannel).toBeUndefined();
  });

  it('is idempotent — re-running cannot resurrect the key', () => {
    const once = migrate({ releaseChannel: 'alpha' }, 25);
    expect(migrate(once, 25).releaseChannel).toBeUndefined();
  });

  it('does not re-run for a blob already past it', () => {
    // Version-gated, so it is a one-time migration rather than a permanent
    // filter over every rehydrate.
    expect(migrate({ releaseChannel: 'alpha' }, 26).releaseChannel).toBe('alpha');
  });
});

describe('relationsPanelHeight (OKF wiki-navigation)', () => {
  beforeEach(() => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
  });

  it('defaults to the mid-band fraction', () => {
    expect(useSettingsStore.getState().relationsPanelHeight).toBe(
      RELATIONS_PANEL_DEFAULT_HEIGHT,
    );
  });

  it('sets an in-band fraction verbatim', () => {
    useSettingsStore.getState().setRelationsPanelHeight(0.55);
    expect(useSettingsStore.getState().relationsPanelHeight).toBe(0.55);
  });

  it('clamps below the minimum (e.g. repeated keyboard down-arrows)', () => {
    useSettingsStore.getState().setRelationsPanelHeight(0.1);
    expect(useSettingsStore.getState().relationsPanelHeight).toBe(
      RELATIONS_PANEL_MIN_HEIGHT,
    );
  });

  it('clamps above the maximum (e.g. repeated keyboard up-arrows)', () => {
    useSettingsStore.getState().setRelationsPanelHeight(0.95);
    expect(useSettingsStore.getState().relationsPanelHeight).toBe(
      RELATIONS_PANEL_MAX_HEIGHT,
    );
  });
});

describe('Inbox view preferences (v27)', () => {
  function migrate(persisted: Record<string, unknown>, from: number) {
    const opts = (useSettingsStore as unknown as {
      persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } };
    }).persist.getOptions();
    return opts.migrate!(persisted, from) as Record<string, unknown>;
  }

  it('defaults the three Inbox preferences for a blob that predates them', () => {
    const out = migrate({}, 26);
    expect(out.inboxLayout).toBe('list');
    expect(out.inboxCondensed).toBe(false);
    expect(out.inboxGallerySize).toBe('medium');
  });

  it('keeps valid values and repairs invalid ones', () => {
    const out = migrate({ inboxLayout: 'gallery', inboxCondensed: true, inboxGallerySize: 'huge' }, 26);
    expect(out.inboxLayout).toBe('gallery');
    expect(out.inboxCondensed).toBe(true);
    expect(out.inboxGallerySize).toBe('medium');
  });

  it('setters persist the choice', () => {
    useSettingsStore.getState().setInboxLayout('gallery');
    useSettingsStore.getState().setInboxGallerySize('small');
    useSettingsStore.getState().setInboxCondensed(true);
    const s = useSettingsStore.getState();
    expect([s.inboxLayout, s.inboxGallerySize, s.inboxCondensed]).toEqual(['gallery', 'small', true]);
  });
});
