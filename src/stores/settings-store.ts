import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LogLevel } from '@/lib/logger';


type Theme = "light" | "dark" | "system";
export type ContentWidth = "full" | "auto" | "a4" | "a5" | "letter";
export type MeasurementUnit = "cm" | "inch";
export type ExportTemplate = "clean" | "academic" | "report";
export type ExportPageSize = "a4" | "letter" | "a5";
export type ExportFormat = "pdf" | "pptx" | "docx";
export type PptxTemplate = "simple" | "business" | "report";
interface SettingsStore {
  theme: Theme;
  contrastLevel: number;
  /** Hue angle for UI color tint (0–360, oklch hue). 0 = warm yellow, 270 = cool blue, etc. */
  tintHue: number;
  /** Chroma intensity for UI color tint (0–30, mapped to 0–0.03 oklch chroma). 0 = neutral grey. */
  tintChroma: number;
  showFloatingToolbar: boolean;
  toolbarVisible: boolean;
  contentWidth: ContentWidth;
  measurementUnit: MeasurementUnit;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  sidebarOpen: boolean;
  sidebarPinned: boolean;
  sidebarWidth: number;
  chatPanelOpen: boolean;
  notesRootPath: string;
  gitEnabled: boolean;
  printLayout: boolean;
  typewriterScrolling: boolean;
  externalChangeDiffReview: boolean;
  sourceWordWrap: boolean;
  copilotMaxCompletionChars: number;
  fimContextChars: number;
  /** Global toggle — disables inline completions across all documents */
  inlineCompletionsDisabled: boolean;
  chatHistoryLimit: number;
  skillManagement: boolean;
  /** Global toggle — controls whether tools are sent with direct API chat requests */
  toolCallingEnabled: boolean;
  /** Web search provider for client-side search tool */
  searchProvider: 'duckduckgo';
  /** @deprecated Use logLevel instead. Kept for migration. */
  debugLogging?: boolean;
  logLevel: LogLevel;
  autoCheckUpdates: boolean;
  lastUpdateCheck: string | null;
  dismissedVersion: string | null;
  /** @deprecated PDF/DOCX now always use "clean". Kept for backwards compatibility. */
  lastExportTemplate: ExportTemplate;
  lastExportPageSize: ExportPageSize;
  lastExportIncludeToC: boolean;
  lastExportIncludePageNumbers: boolean;
  lastExportFormat: ExportFormat;
  lastPptxTemplate: string;
  /** Whether custom personas have been migrated to agent files. Persisted. */
  personasMigrated: boolean;
  /** Whether the chat input syntax hints have been auto-dismissed (after first send). Persisted. */
  chatHintsShown: boolean;
  /** Show dotfiles and dot-directories in the sidebar file tree */
  showHiddenFiles: boolean;
  // Runtime-only (not persisted) — detected on startup
  startupReady: boolean;
  icloudAvailable: boolean;
  icloudNotesagePath: string | null;
  setTheme: (theme: Theme) => void;
  setContrastLevel: (level: number) => void;
  setTintHue: (hue: number) => void;
  setTintChroma: (chroma: number) => void;
  setShowFloatingToolbar: (show: boolean) => void;
  setToolbarVisible: (visible: boolean) => void;
  setContentWidth: (width: ContentWidth) => void;
  setMeasurementUnit: (unit: MeasurementUnit) => void;
  setMarginTop: (margin: number) => void;
  setMarginBottom: (margin: number) => void;
  setMarginLeft: (margin: number) => void;
  setMarginRight: (margin: number) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarPinned: (pinned: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setChatPanelOpen: (open: boolean) => void;
  setNotesRootPath: (path: string) => void;
  setGitEnabled: (enabled: boolean) => void;
  setPrintLayout: (enabled: boolean) => void;
  setTypewriterScrolling: (enabled: boolean) => void;
  setExternalChangeDiffReview: (enabled: boolean) => void;
  setSourceWordWrap: (enabled: boolean) => void;
  setCopilotMaxCompletionChars: (chars: number) => void;
  setFimContextChars: (chars: number) => void;
  setInlineCompletionsDisabled: (disabled: boolean) => void;
  setChatHistoryLimit: (limit: number) => void;
  setSkillManagement: (enabled: boolean) => void;
  setToolCallingEnabled: (enabled: boolean) => void;
  setLogLevel: (level: LogLevel) => void;
  setAutoCheckUpdates: (enabled: boolean) => void;
  setLastUpdateCheck: (timestamp: string | null) => void;
  setDismissedVersion: (version: string | null) => void;
  /** @deprecated PDF/DOCX now always use "clean". Kept for backwards compatibility. */
  setLastExportTemplate: (template: ExportTemplate) => void;
  setLastExportPageSize: (pageSize: ExportPageSize) => void;
  setLastExportIncludeToC: (include: boolean) => void;
  setLastExportIncludePageNumbers: (include: boolean) => void;
  setLastExportFormat: (format: ExportFormat) => void;
  setLastPptxTemplate: (template: string) => void;
  setStartupReady: (ready: boolean) => void;
  setICloudAvailable: (available: boolean) => void;
  setICloudNotesagePath: (path: string | null) => void;
  setPersonasMigrated: (migrated: boolean) => void;
  setChatHintsShown: (shown: boolean) => void;
  setShowHiddenFiles: (show: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",
      contrastLevel: 0,
      tintHue: 60,
      tintChroma: 0,
      showFloatingToolbar: true,
      toolbarVisible: true,
      contentWidth: "auto",
      measurementUnit: "cm",
      marginTop: 2.54,
      marginBottom: 2.54,
      marginLeft: 2.54,
      marginRight: 2.54,
      sidebarOpen: true,
      sidebarPinned: true,
      sidebarWidth: 280,
      chatPanelOpen: false,
      notesRootPath: "~/Notesage",
      gitEnabled: false,
      personasMigrated: false,
      chatHintsShown: false,
      showHiddenFiles: false,
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
      searchProvider: 'duckduckgo' as const,
      logLevel: 'warn',
      autoCheckUpdates: true,
      lastUpdateCheck: null,
      dismissedVersion: null,
      lastExportTemplate: "clean",
      lastExportPageSize: "a4",
      lastExportIncludeToC: false,
      lastExportIncludePageNumbers: false,
      lastExportFormat: "pdf",
      lastPptxTemplate: "simple",

      setTheme: (theme: Theme) => {
        set({ theme });
      },

      setContrastLevel: (level: number) => {
        set({ contrastLevel: Math.round(Math.max(0, Math.min(100, level))) });
      },

      setTintHue: (hue: number) => {
        set({ tintHue: Math.round(((hue % 360) + 360) % 360) });
      },

      setTintChroma: (chroma: number) => {
        set({ tintChroma: Math.round(Math.max(0, Math.min(30, chroma))) });
      },

      setShowFloatingToolbar: (show: boolean) => {
        set({ showFloatingToolbar: show });
      },

      setToolbarVisible: (visible: boolean) => {
        set({ toolbarVisible: visible });
      },

      setContentWidth: (width: ContentWidth) => {
        set({ contentWidth: width });
      },

      setMeasurementUnit: (unit: MeasurementUnit) => {
        set({ measurementUnit: unit });
      },

      setMarginTop: (margin: number) => {
        set({ marginTop: margin });
      },

      setMarginBottom: (margin: number) => {
        set({ marginBottom: margin });
      },

      setMarginLeft: (margin: number) => {
        set({ marginLeft: margin });
      },

      setMarginRight: (margin: number) => {
        set({ marginRight: margin });
      },

      setSidebarOpen: (open: boolean) => {
        set({ sidebarOpen: open });
      },

      setSidebarPinned: (pinned: boolean) => {
        set({ sidebarPinned: pinned });
      },

      setSidebarWidth: (width: number) => {
        set({ sidebarWidth: Math.round(Math.max(200, Math.min(400, width))) });
      },

      setChatPanelOpen: (open: boolean) => {
        set({ chatPanelOpen: open });
      },

      setNotesRootPath: (path: string) => {
        set({ notesRootPath: path });
      },

      setGitEnabled: (enabled: boolean) => {
        set({ gitEnabled: enabled });
      },

      setPrintLayout: (enabled: boolean) => {
        set({ printLayout: enabled });
      },

      setTypewriterScrolling: (enabled: boolean) => {
        set({ typewriterScrolling: enabled });
      },

      setExternalChangeDiffReview: (enabled: boolean) => {
        set({ externalChangeDiffReview: enabled });
      },

      setSourceWordWrap: (enabled: boolean) => {
        set({ sourceWordWrap: enabled });
      },

      setCopilotMaxCompletionChars: (chars: number) => {
        set({ copilotMaxCompletionChars: chars });
      },

      setFimContextChars: (chars: number) => {
        set({ fimContextChars: chars });
      },

      setInlineCompletionsDisabled: (disabled: boolean) => {
        set({ inlineCompletionsDisabled: disabled });
      },

      setChatHistoryLimit: (limit: number) => {
        set({ chatHistoryLimit: limit });
      },

      setSkillManagement: (enabled: boolean) => {
        set({ skillManagement: enabled });
      },

      setToolCallingEnabled: (enabled: boolean) => {
        set({ toolCallingEnabled: enabled });
      },

      setLogLevel: (level: LogLevel) => {
        set({ logLevel: level });
      },

      setAutoCheckUpdates: (enabled: boolean) => {
        set({ autoCheckUpdates: enabled });
      },

      setLastUpdateCheck: (timestamp: string | null) => {
        set({ lastUpdateCheck: timestamp });
      },

      setDismissedVersion: (version: string | null) => {
        set({ dismissedVersion: version });
      },

      setLastExportTemplate: (template: ExportTemplate) => {
        set({ lastExportTemplate: template });
      },

      setLastExportPageSize: (pageSize: ExportPageSize) => {
        set({ lastExportPageSize: pageSize });
      },

      setLastExportIncludeToC: (include: boolean) => {
        set({ lastExportIncludeToC: include });
      },

      setLastExportIncludePageNumbers: (include: boolean) => {
        set({ lastExportIncludePageNumbers: include });
      },

      setLastExportFormat: (format: ExportFormat) => {
        set({ lastExportFormat: format });
      },

      setLastPptxTemplate: (template: string) => {
        set({ lastPptxTemplate: template });
      },

      setStartupReady: (ready: boolean) => {
        set({ startupReady: ready });
      },

      setICloudAvailable: (available: boolean) => {
        set({ icloudAvailable: available });
      },

      setICloudNotesagePath: (path: string | null) => {
        set({ icloudNotesagePath: path });
      },

      setPersonasMigrated: (migrated: boolean) => {
        set({ personasMigrated: migrated });
      },

      setChatHintsShown: (shown: boolean) => {
        set({ chatHintsShown: shown });
      },

      setShowHiddenFiles: (show: boolean) => {
        set({ showHiddenFiles: show });
      },
    }),
    {
      name: "notesage-settings",
      version: 3,

      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        if (version === 0) {
          // Migrate debugLogging boolean → logLevel string
          if (typeof state.debugLogging === 'boolean') {
            state.logLevel = state.debugLogging ? 'debug' : 'warn';
            delete state.debugLogging;
          }
        }
        if (version < 2) {
          // Migrate softMode boolean → contrastLevel number
          if (typeof state.softMode === 'boolean') {
            state.contrastLevel = state.softMode ? 100 : 0;
          } else {
            state.contrastLevel = 0;
          }
          delete state.softMode;
        }
        if (version < 3) {
          // Migrate pageBreaks: "visible"/"continuous" → printLayout: boolean
          state.printLayout = state.pageBreaks === 'visible';
          delete state.pageBreaks;
        }
        return state;
      },

      partialize: (state) => {
        // Exclude runtime-only fields and deprecated fields from persistence
        const { startupReady: _s, icloudAvailable: _a, icloudNotesagePath: _b, debugLogging: _d, ...persisted } = state;
        return persisted;
      },
    }
  )
);
