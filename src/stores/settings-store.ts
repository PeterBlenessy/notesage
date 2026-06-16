import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { LogLevel } from '@/lib/logger';
import type { AccentName } from '@/lib/accent';
import {
  QUIET_CHROME_PRESETS,
  type QuietChromePreset,
  type QuietChromeTargets,
} from '@/lib/quiet-chrome-presets';


type Theme = "light" | "dark" | "system";
export type ContentWidth = "full" | "auto" | "a4" | "a5" | "letter";

/** Resizable Quiet Composer sidebar width bounds (px). */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 500;
export const SIDEBAR_DEFAULT_WIDTH = 252;
export type MeasurementUnit = "cm" | "inch";
export type ExportTemplate = "clean" | "academic" | "report";
export type ExportPageSize = "a4" | "letter" | "a5";
export type ExportFormat = "pdf" | "pptx" | "docx";
export type PptxTemplate = "simple" | "business" | "report";
export type ReleaseChannel = 'stable' | 'alpha';
interface SettingsStore {
  theme: Theme;
  /**
   * UI accent color: "default" (neutral primary), "orange", "blue", or "system"
   * (macOS NSColor.controlAccentColor). Scaffolded by ui-refresh task #3 — task
   * #6 wires `--accent` into primary-affordance sites.
   */
  accent: AccentName;
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
  /**
   * When true, inline completions are issued for files outside the command
   * bar's selected project scope (+ notes root) — the legacy behaviour
   * prior to task #17. Default false: out-of-scope files see no completion
   * traffic. Opt-in escape hatch for users who want completions everywhere.
   */
  completionsOnOutOfScope: boolean;
  chatHistoryLimit: number;
  /** Planning context (tokens) used by the local model-fit memory estimate.
   *  Not the model's max context — the size llama-server is launched with. */
  localPlanningContext: number;
  /** Phase 2 calibration share: whether to ever surface the opt-in
   *  "share with the community" prompt. The prompt only opens a reviewable
   *  GitHub submission — it never sends anything itself. */
  offerCalibrationShare: boolean;
  /** Set once the share prompt has been shown (one-time trigger). */
  calibrationSharePromptedAt: string | null;
  /** Set when the user picks "Don't ask again". */
  calibrationShareDismissed: boolean;
  skillManagement: boolean;
  /** Global toggle — controls whether tools are sent with direct API chat requests */
  toolCallingEnabled: boolean;
  /**
   * When true, every tool call requires explicit user approval — even the
   * built-in read-only / auto-allowed tools (read_file, list_directory,
   * web_search, etc.) will prompt. Gives paranoid users a global kill-switch
   * for silent tool execution. Default false.
   */
  requireAllToolConfirmations: boolean;
  /** Web search provider for client-side search tool */
  searchProvider: 'duckduckgo';
  /** @deprecated Use logLevel instead. Kept for migration. */
  debugLogging?: boolean;
  logLevel: LogLevel;
  autoCheckUpdates: boolean;
  lastUpdateCheck: string | null;
  dismissedVersion: string | null;
  releaseChannel: ReleaseChannel;
  /**
   * Telemetry consent — usage analytics (Aptabase). Tri-state:
   * `null` = follow the release channel (alpha → on, stable → off);
   * `true`/`false` = explicit user choice that always wins. The effective
   * value is computed by `selectEffectiveTelemetryUsage`. PRD 2026-06-07-telemetry.
   */
  telemetryUsageEnabled: boolean | null;
  /**
   * Telemetry consent — crash / error reporting (Sentry). Tri-state with the
   * same semantics as `telemetryUsageEnabled`. Effective value via
   * `selectEffectiveTelemetryCrash`.
   */
  telemetryCrashEnabled: boolean | null;
  /** Whether the first-run telemetry disclosure notice has been shown. */
  telemetryNoticeSeen: boolean;
  /** @deprecated PDF/DOCX now always use "clean". Kept for backwards compatibility. */
  lastExportTemplate: ExportTemplate;
  lastExportPageSize: ExportPageSize;
  lastExportIncludeToC: boolean;
  lastExportIncludePageNumbers: boolean;
  lastExportFormat: ExportFormat;
  lastPptxTemplate: string;
  /** @deprecated Persona migration is no longer needed. Kept for persistence schema compat. */
  personasMigrated: boolean;
  /** Whether bundled agents have been cleaned up from ~/.notesage/agents/. One-time flag. */
  bundledAgentsCleaned: boolean;
  /** Whether the chat input syntax hints have been auto-dismissed (after first send). Persisted. */
  chatHintsShown: boolean;
  /** Show dotfiles and dot-directories in the sidebar file tree */
  showHiddenFiles: boolean;
  /**
   * Show the comrak HTML preview while the editor hydrates in the
   * background (Phase 1 / Phase 3b instant-load). When false, the
   * editor mounts directly via streaming hydrate — no preview surface,
   * no preview/editor visual swap. Default true. Diagnostic / preference
   * toggle: previewing is the right default for large docs (instant
   * first paint), but some users find the visual swap distracting.
   */
  instantLoadPreview: boolean;
  /**
   * Show the file-content hover popover that previews the first ~12 lines
   * of a file when hovering its row in the Quiet Composer sidebar's
   * Recent / Pinned / Tags / Mentions sections. Default true. The folder
   * hover popover (`FolderPeek`) is a separate surface and is NOT gated
   * by this setting.
   */
  sidebarFilePreviewEnabled: boolean;
  /** Show agent mode picker in the command bar (default: off — uses default mode automatically) */
  showAgentModePicker: boolean;
  /**
   * Cross-project mode: when true, the ACP agent's filesystem sandbox is widened
   * to ALL workspace projects + explorer folders, not just the projects selected
   * in the command bar. Default false. Opt-in escape hatch — disables the
   * primary project-isolation guarantee from the project-data-isolation PRD.
   */
  crossProjectMode: boolean;
  /**
   * Quiet Composer pinned-panel mode (PRD 2026-04-21-ui-refresh, task #28).
   * When true the FloatingCommandBar renders as a right-edge side panel
   * instead of the centre-bottom floating overlay. Default false.
   */
  cmdBarPinned: boolean;
  /**
   * Width (in pixels) of the pinned command-bar side panel. Persisted across
   * restarts. Clamped to 280–800. Default 400.
   */
  cmdBarPinnedWidth: number;
  /**
   * Width (in pixels) of the floating command bar in the expanded state.
   * Persisted across restarts so users on large displays can scale the bar
   * up once and not redo it on every launch. Clamped to 480–1400. Default
   * 640. Live-test 2026-04-26.
   */
  cmdBarExpandedWidth: number;
  /**
   * Height (in pixels) of the floating command bar in the expanded state.
   * Persisted across restarts. Clamped to 240–800. Default 480 (matches the
   * previous hardcoded value so existing users see no visual change). Issue #37.
   */
  cmdBarExpandedHeight: number;
  /**
   * Quiet-chrome preset controlling which chrome targets fade under the
   * `.app.typing` pulse (ui-refresh #51). One of the named presets, or
   * "custom" when any per-element override has been toggled. Default
   * "default" — recommended balance of fade targets.
   */
  quietChromePreset: QuietChromePreset | "custom";
  /**
   * Per-element fade overrides applied when `quietChromePreset === "custom"`.
   * Named presets ignore this field. Default mirrors `PRESETS.default`.
   */
  quietChromeOverrides: QuietChromeTargets;
  /**
   * Quiet Composer translucent chrome (#132). When true, the TitleBar
   * and StatusBar get a semi-transparent background + backdrop-blur,
   * and the editor document area scrolls **under** them — matching the
   * frosted-glass chrome of Bear / Craft. Default off so existing
   * users see no change.
   */
  quietChromeTransparent: boolean;
  /**
   * Show the QuietLayout TitleBar (document name + dirty dot + close ×).
   * Default off — the filename also lives in the sidebar (Recent/Pinned) and
   * the StatusBar, and the window controls + dragging are handled by the
   * sidebar's full-height drag region, so the bar is optional chrome. When off,
   * the document area reclaims the vertical space. Trial toggle (can be flipped
   * back on in Settings > Appearance) ahead of a possible full removal.
   */
  showTitleBar: boolean;
  /**
   * Sidebar composition (ui-refresh #35). Maximum number of rows shown in
   * the quiet-composer sidebar Recent section. Clamped to [3, 15]. Default 5.
   */
  sidebarRecentCap: number;
  /**
   * Sidebar composition (ui-refresh #35). Maximum number of rows shown in
   * the quiet-composer sidebar Tags section. Clamped to [0, 15]. Default 5.
   * `0` hides the section entirely — the slider is the visibility control.
   */
  sidebarTagsCap: number;
  /**
   * Sidebar composition. Maximum number of rows shown in the quiet-composer
   * sidebar Mentions section. Clamped to [0, 15]. Default 5 — same shape as
   * `sidebarTagsCap`. `0` hides the section entirely.
   */
  sidebarMentionsCap: number;
  // System tray settings
  showInTray: boolean;
  closeToTray: boolean;
  startAtLogin: boolean;
  // Notification settings
  notifyAgentCompletion: boolean;
  notifyExternalChanges: boolean;
  /** Desktop notification when a BACKGROUNDED session hits a permission request
   *  (task #15). Default on — the notification is the time-sensitive signal for
   *  an unwatched session. */
  notifyPermissionRequest: boolean;
  /** Max concurrent live AI sessions before further sends queue (task #5).
   *  Clamped to [3, 5]; default 4. Protects RAM / agent process count and, for
   *  `local_bundled`, the single llama-server that serializes requests. */
  maxConcurrentSessions: number;
  // Runtime-only (not persisted) — detected on startup
  homeDir: string | null; // Resolved once on startup, used by skill pipeline to avoid IPC
  skillsReady: boolean; // Set early — after home dir resolution, before tree validation
  startupReady: boolean;
  icloudAvailable: boolean;
  icloudNotesagePath: string | null;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: AccentName) => void;
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
  setNotesRootPath: (path: string) => void;
  setGitEnabled: (enabled: boolean) => void;
  setPrintLayout: (enabled: boolean) => void;
  setTypewriterScrolling: (enabled: boolean) => void;
  setExternalChangeDiffReview: (enabled: boolean) => void;
  setSourceWordWrap: (enabled: boolean) => void;
  setCopilotMaxCompletionChars: (chars: number) => void;
  setFimContextChars: (chars: number) => void;
  setInlineCompletionsDisabled: (disabled: boolean) => void;
  setCompletionsOnOutOfScope: (enabled: boolean) => void;
  setChatHistoryLimit: (limit: number) => void;
  setLocalPlanningContext: (ctx: number) => void;
  setOfferCalibrationShare: (enabled: boolean) => void;
  markCalibrationSharePrompted: () => void;
  dismissCalibrationShare: () => void;
  setSkillManagement: (enabled: boolean) => void;
  setToolCallingEnabled: (enabled: boolean) => void;
  setRequireAllToolConfirmations: (enabled: boolean) => void;
  setLogLevel: (level: LogLevel) => void;
  setAutoCheckUpdates: (enabled: boolean) => void;
  setLastUpdateCheck: (timestamp: string | null) => void;
  setDismissedVersion: (version: string | null) => void;
  setReleaseChannel: (channel: ReleaseChannel) => void;
  setTelemetryUsageEnabled: (v: boolean | null) => void;
  setTelemetryCrashEnabled: (v: boolean | null) => void;
  setTelemetryNoticeSeen: (v: boolean) => void;
  /** @deprecated PDF/DOCX now always use "clean". Kept for backwards compatibility. */
  setLastExportTemplate: (template: ExportTemplate) => void;
  setLastExportPageSize: (pageSize: ExportPageSize) => void;
  setLastExportIncludeToC: (include: boolean) => void;
  setLastExportIncludePageNumbers: (include: boolean) => void;
  setLastExportFormat: (format: ExportFormat) => void;
  setLastPptxTemplate: (template: string) => void;
  setHomeDir: (dir: string) => void;
  setSkillsReady: (ready: boolean) => void;
  setStartupReady: (ready: boolean) => void;
  setICloudAvailable: (available: boolean) => void;
  setICloudNotesagePath: (path: string | null) => void;
  setPersonasMigrated: (migrated: boolean) => void;
  setBundledAgentsCleaned: (cleaned: boolean) => void;
  setChatHintsShown: (shown: boolean) => void;
  setShowHiddenFiles: (show: boolean) => void;
  setInstantLoadPreview: (enabled: boolean) => void;
  setSidebarFilePreviewEnabled: (enabled: boolean) => void;
  setShowAgentModePicker: (show: boolean) => void;
  setCrossProjectMode: (enabled: boolean) => void;
  setCmdBarPinned: (pinned: boolean) => void;
  setCmdBarPinnedWidth: (width: number) => void;
  setCmdBarExpandedWidth: (width: number) => void;
  setCmdBarExpandedHeight: (height: number) => void;
  setQuietChromePreset: (preset: QuietChromePreset | "custom") => void;
  /** #132 — toggle the translucent chrome + editor flow-under effect. */
  setQuietChromeTransparent: (enabled: boolean) => void;
  setShowTitleBar: (show: boolean) => void;
  /**
   * Toggle a single per-element override. Automatically flips the preset to
   * "custom" so the override is actually used at read time.
   */
  setQuietChromeOverride: (key: keyof QuietChromeTargets, value: boolean) => void;
  setSidebarRecentCap: (n: number) => void;
  setSidebarTagsCap: (n: number) => void;
  setSidebarMentionsCap: (n: number) => void;
  setShowInTray: (show: boolean) => void;
  setCloseToTray: (close: boolean) => void;
  setStartAtLogin: (start: boolean) => void;
  setNotifyAgentCompletion: (notify: boolean) => void;
  setNotifyExternalChanges: (notify: boolean) => void;
  setNotifyPermissionRequest: (notify: boolean) => void;
  setMaxConcurrentSessions: (n: number) => void;
  /**
   * When true, the HTML viewer bypasses DOMPurify and renders content in an
   * isolated iframe with `sandbox="allow-scripts"` (no `allow-same-origin`).
   * Inline `<script>` blocks execute; same-directory `<script src="./local.js">`
   * is pre-processed via read_file and inlined. Default false (scripts stripped).
   */
  htmlViewerAllowScripts: boolean;
  setHtmlViewerAllowScripts: (enabled: boolean) => void;
  /**
   * When true, the HTML viewer strips external network resources (remote `src`,
   * `href`, and `srcset` attribute values starting with `https?:`) before
   * rendering. Applied via a shared `stripExternalResources()` utility on all
   * render paths (sanitised-div, allowScripts iframe, unsafe-preview iframe).
   * Inline `<style>` blocks, `data:` URIs, `blob:` URIs, and relative paths are
   * unaffected. Default false (all resources load freely).
   */
  htmlViewerBlockExternalResources: boolean;
  setHtmlViewerBlockExternalResources: (enabled: boolean) => void;
  /**
   * When true, link-preview cards load the remote preview image and favicon
   * fetched from the (attacker-controllable) target page. These render as live
   * `<img>` elements, so loading them is an un-validated outbound request —
   * a tracking beacon / IP-leak and a potential internal-GET primitive from
   * agent-authored `> [!link](url)` cards (security audit MEDIUM). Default
   * false (privacy by default): the card still shows title/description/site
   * (safe text) but falls back to a neutral globe glyph instead of fetching
   * remote images. Card metadata fetching is unaffected — only the image
   * `<img src>` loads are gated.
   */
  linkPreviewRemoteImages: boolean;
  setLinkPreviewRemoteImages: (enabled: boolean) => void;
}

/**
 * Effective usage-analytics consent. When the user hasn't made an explicit
 * choice (`telemetryUsageEnabled === null`), the value follows the release
 * channel: alpha defaults on, stable defaults off.
 */
export const selectEffectiveTelemetryUsage = (
  state: Pick<SettingsStore, 'telemetryUsageEnabled' | 'releaseChannel'>,
): boolean => state.telemetryUsageEnabled ?? state.releaseChannel === 'alpha';

/**
 * Effective crash-reporting consent. Same channel-derived default semantics as
 * {@link selectEffectiveTelemetryUsage}.
 */
export const selectEffectiveTelemetryCrash = (
  state: Pick<SettingsStore, 'telemetryCrashEnabled' | 'releaseChannel'>,
): boolean => state.telemetryCrashEnabled ?? state.releaseChannel === 'alpha';

/**
 * Push the recomputed effective consent booleans to the Rust backend so it can
 * gate Sentry init / Aptabase egress. Best-effort and fire-and-forget — a
 * missing command or backend error must never surface to the user.
 */
function applyTelemetryConsent(state: SettingsStore): void {
  try {
    invoke('telemetry_apply_consent', {
      usage: selectEffectiveTelemetryUsage(state),
      crash: selectEffectiveTelemetryCrash(state),
    }).catch((e) => {
      // Never surface to the user (matches the track() contract), but leave a
      // diagnostic trail so a Rust/UI consent drift is debuggable.
      console.error('telemetry_apply_consent failed:', e);
    });
  } catch {
    /* invoke unavailable (e.g. non-Tauri test env) — ignore */
  }
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      theme: "system",
      accent: "default",
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
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      notesRootPath: "~/Notesage",
      gitEnabled: false,
      personasMigrated: false,
      bundledAgentsCleaned: false,
      chatHintsShown: false,
      showHiddenFiles: false,
      instantLoadPreview: true,
      sidebarFilePreviewEnabled: true,
      showAgentModePicker: false,
      crossProjectMode: false,
      cmdBarPinned: false,
      cmdBarPinnedWidth: 400,
      cmdBarExpandedWidth: 640,
      cmdBarExpandedHeight: 480,
      quietChromePreset: "default",
      quietChromeOverrides: { ...QUIET_CHROME_PRESETS.default },
      quietChromeTransparent: false,
      showTitleBar: false,
      sidebarRecentCap: 5,
      sidebarTagsCap: 5,
      sidebarMentionsCap: 5,
      showInTray: true,
      closeToTray: false,
      startAtLogin: false,
      notifyAgentCompletion: true,
      notifyExternalChanges: false,
      notifyPermissionRequest: true,
      maxConcurrentSessions: 4,
      homeDir: null,
      skillsReady: false,
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
      completionsOnOutOfScope: false,
      chatHistoryLimit: 0,
      localPlanningContext: 8192,
      offerCalibrationShare: true,
      calibrationSharePromptedAt: null,
      calibrationShareDismissed: false,
      skillManagement: false,
      toolCallingEnabled: true,
      requireAllToolConfirmations: false,
      searchProvider: 'duckduckgo' as const,
      logLevel: 'warn',
      autoCheckUpdates: true,
      lastUpdateCheck: null,
      dismissedVersion: null,
      releaseChannel: 'stable' as ReleaseChannel,
      telemetryUsageEnabled: null,
      telemetryCrashEnabled: null,
      telemetryNoticeSeen: false,
      lastExportTemplate: "clean",
      lastExportPageSize: "a4",
      lastExportIncludeToC: false,
      lastExportIncludePageNumbers: false,
      lastExportFormat: "pdf",
      lastPptxTemplate: "simple",

      setTheme: (theme: Theme) => {
        set({ theme });
      },

      setAccent: (accent: AccentName) => {
        set({ accent });
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
        set({
          sidebarWidth: Math.round(
            Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width)),
          ),
        });
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

      setCompletionsOnOutOfScope: (enabled: boolean) => {
        set({ completionsOnOutOfScope: enabled });
      },

      setChatHistoryLimit: (limit: number) => {
        set({ chatHistoryLimit: limit });
      },

      setLocalPlanningContext: (ctx: number) => {
        set({ localPlanningContext: ctx });
      },

      setOfferCalibrationShare: (enabled: boolean) => {
        set({ offerCalibrationShare: enabled });
      },

      markCalibrationSharePrompted: () => {
        set({ calibrationSharePromptedAt: new Date().toISOString() });
      },

      dismissCalibrationShare: () => {
        set({ calibrationShareDismissed: true });
      },

      setSkillManagement: (enabled: boolean) => {
        set({ skillManagement: enabled });
      },

      setToolCallingEnabled: (enabled: boolean) => {
        set({ toolCallingEnabled: enabled });
      },

      setRequireAllToolConfirmations: (enabled: boolean) => {
        set({ requireAllToolConfirmations: enabled });
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

      setReleaseChannel: (channel: ReleaseChannel) => {
        set({ releaseChannel: channel });
        // Channel change can flip the `null`-derived effective consent values,
        // so re-sync the backend.
        applyTelemetryConsent(get());
      },

      setTelemetryUsageEnabled: (v: boolean | null) => {
        set({ telemetryUsageEnabled: v });
        applyTelemetryConsent(get());
      },

      setTelemetryCrashEnabled: (v: boolean | null) => {
        set({ telemetryCrashEnabled: v });
        applyTelemetryConsent(get());
      },

      setTelemetryNoticeSeen: (v: boolean) => {
        set({ telemetryNoticeSeen: v });
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

      setHomeDir: (dir: string) => {
        set({ homeDir: dir });
      },

      setSkillsReady: (ready: boolean) => {
        set({ skillsReady: ready });
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

      setBundledAgentsCleaned: (cleaned: boolean) => {
        set({ bundledAgentsCleaned: cleaned });
      },

      setChatHintsShown: (shown: boolean) => {
        set({ chatHintsShown: shown });
      },

      setShowHiddenFiles: (show: boolean) => {
        set({ showHiddenFiles: show });
      },

      setInstantLoadPreview: (enabled: boolean) => {
        set({ instantLoadPreview: enabled });
      },

      setSidebarFilePreviewEnabled: (enabled: boolean) => {
        set({ sidebarFilePreviewEnabled: enabled });
      },

      setShowAgentModePicker: (show: boolean) => {
        set({ showAgentModePicker: show });
      },

      setCrossProjectMode: (enabled: boolean) => {
        set({ crossProjectMode: enabled });
      },

      setCmdBarPinned: (pinned: boolean) => {
        set({ cmdBarPinned: pinned });
      },

      setCmdBarPinnedWidth: (width: number) => {
        // Clamp to the same min/max enforced by the drag handle UI so the
        // store cannot be poisoned by an out-of-range value (e.g., from a
        // hand-edited persisted state).
        set({ cmdBarPinnedWidth: Math.round(Math.max(280, Math.min(800, width))) });
      },

      setCmdBarExpandedWidth: (width: number) => {
        // Clamp to the same min/max enforced by the floating-mode resize
        // handle in `FloatingCommandBar`. 480 keeps the prefix-mode pickers
        // legible at minimum width; 1400 covers ultrawide displays without
        // letting the bar dominate the viewport.
        set({
          cmdBarExpandedWidth: Math.round(Math.max(480, Math.min(1400, width))),
        });
      },

      setCmdBarExpandedHeight: (height: number) => {
        // Clamp to the same min/max enforced by the top resize handle in
        // `FloatingCommandBar`. 240 keeps the input row + buttons visible;
        // 800 prevents the bar from dominating smaller displays.
        set({
          cmdBarExpandedHeight: Math.round(Math.max(240, Math.min(800, height))),
        });
      },

      setQuietChromePreset: (preset: QuietChromePreset | "custom") => {
        // Picking a named preset resets the overrides to that preset's
        // mapping so the Advanced switches mirror the effective state if
        // the user later flips back to "custom".
        if (preset === "custom") {
          set({ quietChromePreset: "custom" });
        } else {
          set({
            quietChromePreset: preset,
            quietChromeOverrides: { ...QUIET_CHROME_PRESETS[preset] },
          });
        }
      },

      setQuietChromeOverride: (key: keyof QuietChromeTargets, value: boolean) => {
        set((state) => ({
          quietChromePreset: "custom",
          quietChromeOverrides: { ...state.quietChromeOverrides, [key]: value },
        }));
      },

      setQuietChromeTransparent: (enabled: boolean) => {
        set({ quietChromeTransparent: enabled });
      },

      setShowTitleBar: (show: boolean) => {
        set({ showTitleBar: show });
      },

      setSidebarRecentCap: (n: number) => {
        // Clamp to [3, 15] per PRD; round so the slider value stays integer.
        set({ sidebarRecentCap: Math.round(Math.max(3, Math.min(15, n))) });
      },

      setSidebarTagsCap: (n: number) => {
        // Clamp to [0, 15] — 0 hides the section, the slider is the
        // visibility control.
        set({ sidebarTagsCap: Math.round(Math.max(0, Math.min(15, n))) });
      },

      setSidebarMentionsCap: (n: number) => {
        // Clamp to [0, 15] — 0 hides the section, the slider is the
        // visibility control.
        set({ sidebarMentionsCap: Math.round(Math.max(0, Math.min(15, n))) });
      },

      setShowInTray: (show: boolean) => {
        set({ showInTray: show });
      },

      setCloseToTray: (close: boolean) => {
        set({ closeToTray: close });
      },

      setStartAtLogin: (start: boolean) => {
        set({ startAtLogin: start });
      },

      setNotifyAgentCompletion: (notify: boolean) => {
        set({ notifyAgentCompletion: notify });
      },

      setNotifyExternalChanges: (notify: boolean) => {
        set({ notifyExternalChanges: notify });
      },

      setNotifyPermissionRequest: (notify: boolean) => {
        set({ notifyPermissionRequest: notify });
      },

      setMaxConcurrentSessions: (n: number) => {
        set({ maxConcurrentSessions: Math.round(Math.max(3, Math.min(5, n))) });
      },

      htmlViewerAllowScripts: false,

      setHtmlViewerAllowScripts: (enabled: boolean) => {
        set({ htmlViewerAllowScripts: enabled });
      },

      htmlViewerBlockExternalResources: false,

      setHtmlViewerBlockExternalResources: (enabled: boolean) => {
        set({ htmlViewerBlockExternalResources: enabled });
      },

      linkPreviewRemoteImages: false,

      setLinkPreviewRemoteImages: (enabled: boolean) => {
        set({ linkPreviewRemoteImages: enabled });
      },
    }),
    {
      name: "notesage-settings",
      version: 23,

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
        if (version < 4) {
          // Phase 1 of Quiet Composer rollout: existing users default to
          // "legacy" so no one is force-flipped to the new UI on upgrade.
          state.uiPreview = "legacy";
        }
        if (version < 5) {
          // ui-refresh task #3 — add accent field, default to "default" (no
          // accent applied; consumers fall back to neutral --primary).
          if (typeof state.accent !== 'string') {
            state.accent = 'default';
          }
        }
        if (version < 6) {
          // ui-refresh task #28 — pinned-panel mode for the Quiet Composer
          // command bar. Existing users default to floating mode (off) so
          // upgrading does not silently re-arrange their workspace.
          if (typeof state.cmdBarPinned !== 'boolean') {
            state.cmdBarPinned = false;
          }
          if (typeof state.cmdBarPinnedWidth !== 'number') {
            state.cmdBarPinnedWidth = 400;
          }
        }
        if (version < 7) {
          // ui-refresh task #51 — quiet-chrome presets. Existing users
          // default to the recommended preset so upgrading doesn't silently
          // fade more (or less) chrome than before. The overrides mirror
          // the preset mapping so flipping to "custom" later starts from a
          // sane baseline.
          if (typeof state.quietChromePreset !== 'string') {
            state.quietChromePreset = 'default';
          }
          if (
            state.quietChromeOverrides === null ||
            typeof state.quietChromeOverrides !== 'object'
          ) {
            state.quietChromeOverrides = { ...QUIET_CHROME_PRESETS.default };
          }
          if (typeof state.quietChromeTransparent !== 'boolean') {
            state.quietChromeTransparent = false;
          }
          if (typeof state.showTitleBar !== 'boolean') {
            state.showTitleBar = false;
          }
          if (
            typeof state.sidebarWidth !== 'number' ||
            Number.isNaN(state.sidebarWidth)
          ) {
            state.sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
          } else {
            state.sidebarWidth = Math.round(
              Math.max(
                SIDEBAR_MIN_WIDTH,
                Math.min(SIDEBAR_MAX_WIDTH, state.sidebarWidth),
              ),
            );
          }
        }
        if (version < 8) {
          // ui-refresh task #35 — sidebar composition. Defaults mirror the
          // pre-#35 hardcoded caps (5 for Recent, 5 for Tags) and keep Tags
          // visible so existing users see zero visual change.
          if (typeof state.sidebarRecentCap !== 'number') {
            state.sidebarRecentCap = 5;
          }
          if (typeof state.sidebarTagsCap !== 'number') {
            state.sidebarTagsCap = 5;
          }
          if (typeof state.sidebarTagsHidden !== 'boolean') {
            state.sidebarTagsHidden = false;
          }
        }
        if (version < 9) {
          // ui-refresh task #97 — preview invitation banner timestamps.
          // Default both to null so the banner shows on the first launch
          // after upgrade for users still on the legacy shell, then enters
          // the 30-day cooldown after dismissal.
          if (typeof state.previewInvitationShownAt !== 'number') {
            state.previewInvitationShownAt = null;
          }
          if (typeof state.previewInvitationDismissedAt !== 'number') {
            state.previewInvitationDismissedAt = null;
          }
        }
        if (version < 10) {
          // Live-test 2026-04-26 — floating cmd-bar resize. Default to the
          // historical fixed width (640 px) so existing users see zero
          // visual change after upgrade.
          if (typeof state.cmdBarExpandedWidth !== 'number') {
            state.cmdBarExpandedWidth = 640;
          }
        }
        if (version < 11) {
          // Sidebar composition — Mentions section. Mirrors the v7→v8
          // migration shape: defaults match the Tags equivalents (cap 5,
          // visible by default) so existing users see zero visual change.
          if (typeof state.sidebarMentionsCap !== 'number') {
            state.sidebarMentionsCap = 5;
          }
          if (typeof state.sidebarMentionsHidden !== 'boolean') {
            state.sidebarMentionsHidden = false;
          }
        }
        if (version < 12) {
          // Drop the boolean Hidden toggles for the Tags / Mentions sidebar
          // sections. The slider is now the visibility control: cap === 0
          // hides the section. Preserve "I had this hidden" intent by
          // collapsing a true Hidden flag down into cap = 0 before deleting
          // the flag itself. Idempotent — a v11 state with Hidden = false
          // keeps the cap untouched.
          if (state.sidebarTagsHidden === true) {
            state.sidebarTagsCap = 0;
          }
          if (state.sidebarMentionsHidden === true) {
            state.sidebarMentionsCap = 0;
          }
          delete state.sidebarTagsHidden;
          delete state.sidebarMentionsHidden;
        }
        if (version < 13) {
          // Issue #37 — resizable command bar height. Default to 480 (the
          // previous hardcoded value) so existing users see zero visual change.
          if (typeof state.cmdBarExpandedHeight !== 'number') {
            state.cmdBarExpandedHeight = 480;
          }
        }
        if (version < 14) {
          // Issue #143 — alpha release channel. Existing users default to
          // 'stable' so upgrading does not silently opt anyone into alpha.
          if (typeof state.releaseChannel !== 'string') {
            state.releaseChannel = 'stable';
          }
        }
        if (version < 15) {
          // Issue #186 — HTML viewer allow-forms. Default false (forms blocked)
          // so existing users see no behaviour change after upgrade.
          if (typeof state.htmlViewerAllowForms !== 'boolean') {
            state.htmlViewerAllowForms = false;
          }
        }
        if (version < 16) {
          // Issue #184 — HTML viewer allow-scripts. Default false (scripts stripped)
          // so existing users see no behaviour change after upgrade.
          if (typeof state.htmlViewerAllowScripts !== 'boolean') {
            state.htmlViewerAllowScripts = false;
          }
        }
        if (version < 17) {
          // Issue #183 — HTML viewer block-external-resources. Default false
          // (all resources load freely) so existing users see no behaviour change.
          if (typeof state.htmlViewerBlockExternalResources !== 'boolean') {
            state.htmlViewerBlockExternalResources = false;
          }
        }
        if (version < 18) {
          // Classic layout removal (#325) — force all users onto the Quiet
          // Composer shell. Any persisted "legacy" value is upgraded to
          // "quiet-composer". Undefined (first launch after install) also gets
          // the new default.
          if (state.uiPreview === 'legacy' || typeof state.uiPreview === 'undefined') {
            state.uiPreview = 'quiet-composer';
          }
        }
        if (version < 19) {
          // Classic layout removal (#325) finalization — the uiPreview,
          // chatPanelOpen, and preview/revert-invitation fields no longer
          // exist in the store. Drop them from persisted state so a future
          // schema reshuffle can reuse the names cleanly.
          delete state.uiPreview;
          delete state.chatPanelOpen;
          delete state.previewInvitationShownAt;
          delete state.previewInvitationDismissedAt;
          delete state.revertInvitationShownAt;
          delete state.revertInvitationDismissedAt;
        }
        if (version < 20) {
          // HTML viewer allowForms removal (#360) — the toggle was non-functional
          // when allowScripts was ON (DOMPurify hook never ran on the iframe path).
          // Forms without scripts are inert in a sanitised div, so the setting is
          // dropped. Delete the persisted key so the name is free for future reuse.
          delete state.htmlViewerAllowForms;
        }
        if (version < 21) {
          // Quiet-chrome extension (2026-05-28) — add `titlebar` and `cmdbar`
          // keys to `quietChromeOverrides` so a Custom-mode user gets sane
          // defaults the first time they see the new rows. Existing preset
          // values (`relaxed`/`default`/`aggressive`) bake the new keys in
          // via `QUIET_CHROME_PRESETS`; this branch only matters for
          // persisted Custom-mode overrides.
          if (
            state.quietChromeOverrides &&
            typeof state.quietChromeOverrides === 'object'
          ) {
            const overrides = state.quietChromeOverrides as Record<string, unknown>;
            if (typeof overrides.titlebar !== 'boolean') {
              overrides.titlebar = false;
            }
            if (typeof overrides.cmdbar !== 'boolean') {
              overrides.cmdbar = false;
            }
          }
        }
        if (version < 22) {
          // Security audit MEDIUM — link-preview remote images. Default false
          // (privacy by default): preview/favicon images from the target page
          // are no longer auto-loaded as live <img> beacons unless opted in.
          if (typeof state.linkPreviewRemoteImages !== 'boolean') {
            state.linkPreviewRemoteImages = false;
          }
        }
        if (version < 23) {
          // Command-bar session multitasking (#8) — concurrency cap + the
          // backgrounded-permission notification toggle.
          if (typeof state.maxConcurrentSessions !== 'number') {
            state.maxConcurrentSessions = 4;
          } else {
            state.maxConcurrentSessions = Math.round(
              Math.max(3, Math.min(5, state.maxConcurrentSessions)),
            );
          }
          if (typeof state.notifyPermissionRequest !== 'boolean') {
            state.notifyPermissionRequest = true;
          }
        }
        return state;
      },

      partialize: (state) => {
        // Exclude runtime-only fields and deprecated fields from persistence
        const { homeDir: _hd, skillsReady: _sr, startupReady: _s, icloudAvailable: _a, icloudNotesagePath: _b, debugLogging: _d, ...persisted } = state;
        return persisted;
      },
      // After rehydration, push the effective consent to Rust so the backend
      // matches the (possibly channel-derived) UI state. Without this, a fresh
      // alpha install would show crash reporting ON in Settings while the Rust
      // consent file (absent) leaves Sentry unbound until the user toggled it.
      onRehydrateStorage: () => (state) => {
        if (state) applyTelemetryConsent(state);
      },
    }
  )
);
