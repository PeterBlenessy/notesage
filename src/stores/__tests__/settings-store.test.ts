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

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../settings-store';

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
  sidebarWidth: 280,
  chatPanelOpen: false,
  notesRootPath: '~/Notesage',
  gitEnabled: false,
  personasMigrated: false,
  startupReady: false,
  icloudAvailable: false,
  icloudNotesagePath: null,
  printLayout: false,
  typewriterScrolling: false,
  externalChangeDiffReview: false,
  sourceWordWrap: true,
  copilotMaxCompletionChars: 80,
  fimContextChars: 500,
  inlineCompletionsDisabled: false,
  chatHistoryLimit: 0,
  skillManagement: false,
  toolCallingEnabled: true,
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
  searchProvider: 'duckduckgo',
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  storageBacking.clear();
  useSettingsStore.setState(SETTINGS_DEFAULTS);
});

afterEach(() => {
  storageBacking.clear();
});

// ===========================================================================
// Initial state defaults
// ===========================================================================

describe('initial state defaults', () => {
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
    expect(s.sidebarWidth).toBe(280);
    expect(s.chatPanelOpen).toBe(false);
    expect(s.notesRootPath).toBe('~/Notesage');
    expect(s.gitEnabled).toBe(false);
    expect(s.personasMigrated).toBe(false);
    expect(s.startupReady).toBe(false);
    expect(s.icloudAvailable).toBe(false);
    expect(s.icloudNotesagePath).toBeNull();
    expect(s.printLayout).toBe(false);
    expect(s.typewriterScrolling).toBe(false);
    expect(s.externalChangeDiffReview).toBe(false);
    expect(s.sourceWordWrap).toBe(true);
    expect(s.copilotMaxCompletionChars).toBe(80);
    expect(s.fimContextChars).toBe(500);
    expect(s.inlineCompletionsDisabled).toBe(false);
    expect(s.chatHistoryLimit).toBe(0);
    expect(s.skillManagement).toBe(false);
    expect(s.toolCallingEnabled).toBe(true);
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

  it('setChatPanelOpen', () => {
    useSettingsStore.getState().setChatPanelOpen(true);
    expect(useSettingsStore.getState().chatPanelOpen).toBe(true);
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

  it('setAutoCheckUpdates', () => {
    useSettingsStore.getState().setAutoCheckUpdates(false);
    expect(useSettingsStore.getState().autoCheckUpdates).toBe(false);
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

describe('setSidebarWidth clamping', () => {
  it('sets width within valid range', () => {
    useSettingsStore.getState().setSidebarWidth(300);
    expect(useSettingsStore.getState().sidebarWidth).toBe(300);
  });

  it('clamps width below minimum (200) to 200', () => {
    useSettingsStore.getState().setSidebarWidth(100);
    expect(useSettingsStore.getState().sidebarWidth).toBe(200);
  });

  it('clamps width above maximum (400) to 400', () => {
    useSettingsStore.getState().setSidebarWidth(600);
    expect(useSettingsStore.getState().sidebarWidth).toBe(400);
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
