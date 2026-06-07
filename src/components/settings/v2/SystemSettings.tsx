import { useEffect, useState } from 'react';
import { clearAllViewports } from '@/lib/viewport-cache';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowUpCircle,
  Download,
  FolderOpen,
  Loader2,
  RefreshCw,
  ScrollText,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import { setLogLevel as setLoggerLevel } from '@/lib/logger';
import type { LogLevel } from '@/lib/logger';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  useSettingsStore,
  selectEffectiveTelemetryUsage,
  selectEffectiveTelemetryCrash,
} from '@/stores/settings-store';
import { toastTelemetryNotice } from '@/lib/notifications';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useEditorStore } from '@/stores/editor-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import type { UpdateState } from '@/hooks/useAutoUpdate';
import { ChangelogDialog } from '../ChangelogDialog';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

export interface SystemSettingsProps {
  updateState?: UpdateState;
  onCheckForUpdate?: () => Promise<void>;
  onOpenUpdateDialog?: () => void;
  /**
   * Optional callback fired after the user picks "View Update" — used by the
   * v2 shell to close the settings dialog when the standalone update dialog
   * opens, matching the legacy behavior.
   */
  onDismissSettings?: () => void;
}

/** Public privacy doc the "What we collect" link opens (created in task #14). */
const TELEMETRY_DOC_URL =
  'https://github.com/peterblenessy/notesage/blob/main/docs/telemetry.md';

function friendlyUpdateError(error: string | null): string {
  if (!error) return 'Could not check for updates';
  const lower = error.toLowerCase();
  if (
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('connect') ||
    lower.includes('dns')
  )
    return 'Could not connect to update server';
  if (lower.includes('404') || lower.includes('not found'))
    return 'No published release found';
  if (lower.includes('timeout')) return 'Update check timed out';
  if (lower.includes('signature') || lower.includes('verify'))
    return 'Update signature verification failed';
  if (
    lower.includes('json') ||
    lower.includes('parse') ||
    lower.includes('deserialize')
  )
    return 'Invalid update manifest';
  return error.length > 80 ? 'Could not check for updates' : error;
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * System settings panel (v2).
 *
 * Consolidation 2026-04-26: this is the former General panel, now folded
 * together with Advanced (Diagnostics, Show Hidden Files) and About
 * (version, Changelog, Updates). The standalone Advanced and About panels
 * are removed from the nav.
 */
export function SystemSettings({
  updateState,
  onCheckForUpdate,
  onOpenUpdateDialog,
  onDismissSettings,
}: SystemSettingsProps = {}) {
  // Tray
  const showInTray = useSettingsStore((s) => s.showInTray);
  const setShowInTray = useSettingsStore((s) => s.setShowInTray);
  const closeToTray = useSettingsStore((s) => s.closeToTray);
  const setCloseToTray = useSettingsStore((s) => s.setCloseToTray);
  const startAtLogin = useSettingsStore((s) => s.startAtLogin);
  const setStartAtLogin = useSettingsStore((s) => s.setStartAtLogin);

  // Notifications
  const notifyAgentCompletion = useSettingsStore((s) => s.notifyAgentCompletion);
  const setNotifyAgentCompletion = useSettingsStore(
    (s) => s.setNotifyAgentCompletion,
  );
  const notifyExternalChanges = useSettingsStore((s) => s.notifyExternalChanges);
  const setNotifyExternalChanges = useSettingsStore(
    (s) => s.setNotifyExternalChanges,
  );

  // HTML viewer
  const htmlViewerAllowScripts = useSettingsStore((s) => s.htmlViewerAllowScripts);
  const setHtmlViewerAllowScripts = useSettingsStore((s) => s.setHtmlViewerAllowScripts);
  const htmlViewerBlockExternalResources = useSettingsStore((s) => s.htmlViewerBlockExternalResources);
  const setHtmlViewerBlockExternalResources = useSettingsStore((s) => s.setHtmlViewerBlockExternalResources);

  // Files
  const showHiddenFiles = useSettingsStore((s) => s.showHiddenFiles);
  const setShowHiddenFiles = useSettingsStore((s) => s.setShowHiddenFiles);
  const sidebarFilePreviewEnabled = useSettingsStore(
    (s) => s.sidebarFilePreviewEnabled,
  );
  const setSidebarFilePreviewEnabled = useSettingsStore(
    (s) => s.setSidebarFilePreviewEnabled,
  );

  // Performance
  const instantLoadPreview = useSettingsStore((s) => s.instantLoadPreview);
  const setInstantLoadPreview = useSettingsStore((s) => s.setInstantLoadPreview);

  // Diagnostics
  const logLevel = useSettingsStore((s) => s.logLevel);
  const setLogLevel = useSettingsStore((s) => s.setLogLevel);

  // Updates
  const autoCheckUpdates = useSettingsStore((s) => s.autoCheckUpdates);
  const setAutoCheckUpdates = useSettingsStore((s) => s.setAutoCheckUpdates);
  const lastUpdateCheck = useSettingsStore((s) => s.lastUpdateCheck);
  const releaseChannel = useSettingsStore((s) => s.releaseChannel);
  const setReleaseChannel = useSettingsStore((s) => s.setReleaseChannel);

  // Telemetry — switches bind to the *effective* value (explicit override or
  // channel default) so the toggle reflects what's actually happening; the
  // setters store the explicit boolean, which overrides the channel default.
  const telemetryUsageEffective = useSettingsStore(selectEffectiveTelemetryUsage);
  const telemetryCrashEffective = useSettingsStore(selectEffectiveTelemetryCrash);
  const setTelemetryUsageEnabled = useSettingsStore(
    (s) => s.setTelemetryUsageEnabled,
  );
  const setTelemetryCrashEnabled = useSettingsStore(
    (s) => s.setTelemetryCrashEnabled,
  );
  const setTelemetryNoticeSeen = useSettingsStore((s) => s.setTelemetryNoticeSeen);

  const [changelogOpen, setChangelogOpen] = useState(false);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logSize, setLogSize] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [path, size] = await Promise.all([
          tauriApi.getLogPath(),
          tauriApi.getLogSize(),
        ]);
        if (!cancelled) {
          setLogPath(path);
          setLogSize(size);
        }
      } catch {
        // Commands may not exist yet — silently ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const appVersion =
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

  return (
    <>
      <SettingsGroup label="About">
        <SettingsRow
          label="Notesage version"
          control={
            <span className="text-[13px] text-muted-foreground tabular-nums">
              {appVersion}
            </span>
          }
        />
        <SettingsRow
          label="Changelog"
          description="Release notes for recent versions."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChangelogOpen(true)}
            >
              <ScrollText className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              View Changelog
            </Button>
          }
        />
        <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
        <SettingsRow
          label="Check for updates"
          description={
            updateState?.updateInfo
              ? `Update available: v${updateState.updateInfo.version}`
              : updateState?.status === 'checking'
              ? 'Checking for updates…'
              : updateState?.status === 'error'
              ? friendlyUpdateError(updateState.error)
              : `Last checked: ${formatRelativeTime(lastUpdateCheck)}`
          }
          control={
            updateState?.updateInfo && onOpenUpdateDialog ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onOpenUpdateDialog();
                  onDismissSettings?.();
                }}
                title={`View update v${updateState.updateInfo.version}`}
                aria-label="View update"
              >
                <ArrowUpCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCheckForUpdate}
                disabled={updateState?.status === 'checking'}
                title="Check for updates"
                aria-label="Check for updates"
              >
                {updateState?.status === 'checking' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
              </Button>
            )
          }
        />
        <SettingsRow
          label="Automatically check for updates"
          description="Look for new versions when the app starts."
          htmlFor="auto-check-updates"
          control={
            <Switch
              id="auto-check-updates"
              checked={autoCheckUpdates}
              onCheckedChange={setAutoCheckUpdates}
            />
          }
        />
        <SettingsRow
          label="Release channel"
          description="Stable receives tested releases. Alpha receives pre-release builds."
          control={
            <Select
              value={releaseChannel ?? 'stable'}
              onValueChange={(v) => {
                const next = v as 'stable' | 'alpha';
                const previous = releaseChannel ?? 'stable';
                setReleaseChannel(next);
                // On a stable → alpha switch, surface the one-time telemetry
                // disclosure as a confirming toast and mark the notice seen so
                // the first-run notice in useAppLifecycle doesn't re-show it.
                if (next === 'alpha' && previous !== 'alpha') {
                  toastTelemetryNotice({
                    onOpenSettings: () =>
                      window.dispatchEvent(
                        new CustomEvent('notesage:open-settings', {
                          detail: { tab: 'system' },
                        }),
                      ),
                  });
                  setTelemetryNoticeSeen(true);
                }
              }}
            >
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">Stable</SelectItem>
                <SelectItem value="alpha">Alpha</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="Telemetry"
        description="Anonymous usage analytics and crash reports. No document content, file contents, or AI prompts are ever sent. Alpha defaults these on; Stable defaults them off — your choice here overrides the default."
        searchKeywords={['telemetry', 'analytics', 'crash', 'sentry', 'privacy', 'aptabase']}
      >
        <SettingsRow
          label="Usage analytics"
          description="Share anonymous feature-usage events so the maintainer can see which features are used and prune what isn't."
          htmlFor="telemetry-usage"
          control={
            <Switch
              id="telemetry-usage"
              checked={telemetryUsageEffective}
              onCheckedChange={(v) => setTelemetryUsageEnabled(v)}
              aria-label="Usage analytics"
            />
          }
        />
        <SettingsRow
          label="Crash reports"
          description="Share anonymous crash and error reports grouped by version so regressions can be fixed without a manual report."
          htmlFor="telemetry-crash"
          control={
            <Switch
              id="telemetry-crash"
              checked={telemetryCrashEffective}
              onCheckedChange={(v) => setTelemetryCrashEnabled(v)}
              aria-label="Crash reports"
            />
          }
        />
        <SettingsRow
          label="What we collect"
          description="Read exactly what is and isn't sent."
          control={
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              aria-label="View what we collect"
              onClick={() => {
                openUrl(TELEMETRY_DOC_URL).catch(() => {});
              }}
            >
              View
            </Button>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="System Tray"
        description="Menu bar icon and background behavior."
      >
        <SettingsRow
          label="Show in menu bar"
          description="Keep Notesage accessible from the menu bar."
          htmlFor="show-in-tray"
          control={
            <Switch
              id="show-in-tray"
              checked={showInTray}
              onCheckedChange={(checked) => {
                setShowInTray(checked);
                invoke('set_tray_visible', { visible: checked }).catch(() => {});
              }}
            />
          }
        />
        <SettingsRow
          label="Close window to tray"
          description="Closing the window hides it instead of quitting the app."
          htmlFor="close-to-tray"
          control={
            <Switch
              id="close-to-tray"
              checked={closeToTray}
              onCheckedChange={(checked) => {
                setCloseToTray(checked);
                invoke('set_close_to_tray', { enabled: checked }).catch(() => {});
              }}
            />
          }
        />
        <SettingsRow
          label="Start at login"
          description="Launch Notesage automatically when you log in."
          htmlFor="start-at-login"
          control={
            <Switch
              id="start-at-login"
              checked={startAtLogin}
              onCheckedChange={async (checked) => {
                try {
                  if (checked) {
                    await import('@tauri-apps/plugin-autostart').then((m) =>
                      m.enable(),
                    );
                  } else {
                    await import('@tauri-apps/plugin-autostart').then((m) =>
                      m.disable(),
                    );
                  }
                  setStartAtLogin(checked);
                } catch (e) {
                  console.error('Failed to toggle autostart:', e);
                }
              }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="Notifications"
        description="Choose which desktop notifications to receive."
      >
        <SettingsRow
          label="Agent task completion"
          description="Notify when an agent finishes or encounters an error."
          htmlFor="notify-agent"
          control={
            <Switch
              id="notify-agent"
              checked={notifyAgentCompletion}
              onCheckedChange={setNotifyAgentCompletion}
            />
          }
        />
        <SettingsRow
          label="External file changes"
          description="Notify when files are modified externally."
          htmlFor="notify-external"
          control={
            <Switch
              id="notify-external"
              checked={notifyExternalChanges}
              onCheckedChange={setNotifyExternalChanges}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="HTML viewer"
        description="Configure sandboxing behaviour when rendering .html and .htm files."
      >
        <SettingsRow
          label="Allow scripts (unsafe)"
          description="When on, inline and same-directory scripts execute in an isolated iframe. Forms and event handlers are included when scripts are enabled. Scripts cannot access Tauri IPC or host storage. Off by default — only enable for local HTML files you trust."
          htmlFor="html-viewer-allow-scripts"
          control={
            <Switch
              id="html-viewer-allow-scripts"
              checked={htmlViewerAllowScripts}
              onCheckedChange={setHtmlViewerAllowScripts}
            />
          }
        />
        <SettingsRow
          label="Block external resources"
          description="When on, remote images, stylesheets, and fonts (URLs starting with http:// or https://) are stripped before rendering across all render paths. Inline styles, data: URIs, and relative-path resources are unaffected."
          htmlFor="html-viewer-block-external"
          control={
            <Switch
              id="html-viewer-block-external"
              checked={htmlViewerBlockExternalResources}
              onCheckedChange={setHtmlViewerBlockExternalResources}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup label="Files" description="File visibility and hover behaviour in the sidebar.">
        <SettingsRow
          label="Show hidden files"
          description='Show dotfiles and dot-directories (starting with ".") in the sidebar file tree.'
          htmlFor="show-hidden-files"
          control={
            <Switch
              id="show-hidden-files"
              checked={showHiddenFiles}
              onCheckedChange={setShowHiddenFiles}
            />
          }
        />
        <SettingsRow
          label="File hover preview"
          description="Show a small popover with the first lines of a file when hovering its row in the sidebar. Folder hover previews are unaffected."
          htmlFor="sidebar-file-preview"
          control={
            <Switch
              id="sidebar-file-preview"
              checked={sidebarFilePreviewEnabled}
              onCheckedChange={setSidebarFilePreviewEnabled}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="Performance"
        description="Document loading behaviour."
      >
        <SettingsRow
          label="Instant-load preview"
          description="Show a quick HTML preview of the document while the editor hydrates in the background. Disable to mount the editor directly — slightly slower first paint on large docs but no preview/editor swap."
          htmlFor="instant-load-preview"
          control={
            <Switch
              id="instant-load-preview"
              checked={instantLoadPreview}
              onCheckedChange={setInstantLoadPreview}
            />
          }
        />
        <SettingsRow
          label="Viewport cache"
          description="Previously viewed large documents are cached to IndexedDB for instant first paint on cold start. Clear this cache to free disk space or force a fresh load."
          control={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Clear viewport cache
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear viewport cache?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes all cached viewport snapshots from IndexedDB. The next cold open of each file will rebuild the cache automatically.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      clearAllViewports().then(() => {
                        toast.success('Viewport cache cleared');
                      });
                    }}
                  >
                    Clear cache
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="Diagnostics"
        description="Logging and diagnostics export."
      >
        <SettingsRow
          label="Log level"
          description="Controls which messages are written to log files. Default is Warn."
          control={
            <Select
              value={logLevel}
              onValueChange={(value: string) => {
                const level = value as LogLevel;
                setLogLevel(level);
                setLoggerLevel(level);
                tauriApi.setLogLevel(level);
              }}
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
          }
        />

        {logPath && (
          <div className="py-3 flex items-center gap-1">
            <p className="text-[10px] leading-tight text-muted-foreground font-mono break-all select-all flex-1 min-w-0">
              {logPath}
              {logSize !== null && (
                <span className="font-sans ml-1.5">
                  (
                  {logSize < 1024
                    ? `${logSize} B`
                    : logSize < 1024 * 1024
                    ? `${(logSize / 1024).toFixed(1)} KB`
                    : `${(logSize / (1024 * 1024)).toFixed(1)} MB`}
                  )
                </span>
              )}
            </p>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => tauriApi.revealInFinder(logPath)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reveal in Finder</TooltipContent>
              </Tooltip>

              <AlertDialog>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={logSize === 0}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </Button>
                    </AlertDialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Clear logs</TooltipContent>
                </Tooltip>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear log files?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all diagnostic log data.
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        try {
                          await tauriApi.clearLogs();
                          const size = await tauriApi.getLogSize();
                          setLogSize(size);
                        } catch {
                          // silently ignore
                        }
                      }}
                    >
                      Clear Logs
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TooltipProvider>
          </div>
        )}

        <SettingsRow
          label="Export diagnostics"
          description="Save backend and frontend state to a JSON file for bug reports. No API keys are included."
          control={
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={async () => {
                try {
                  const backend = await tauriApi.collectDiagnostics();
                  const { connections } = useConnectionsStore.getState();
                  const redactedConnections = connections.map(
                    ({ id, provider, authMethod, capabilities, status }) => ({
                      id,
                      provider,
                      authMethod,
                      capabilities,
                      status,
                    }),
                  );
                  const { routing } = useRoutingStore.getState();
                  const localAIState = useLocalAIStore.getState();
                  const dump = {
                    timestamp: new Date().toISOString(),
                    version: (await import('@tauri-apps/api/app')).getVersion(),
                    backend,
                    frontend: {
                      connections: redactedConnections,
                      routing,
                      logLevel,
                      tabCount: useEditorStore.getState().openDocuments.length,
                      localAI: {
                        activeModelId: localAIState.activeModelId,
                        binaryStatus: localAIState.binaryStatus,
                        serverStatus: localAIState.serverStatus,
                        serverError: localAIState.serverError,
                        contextLength: localAIState.contextLength,
                        gpuLayers: localAIState.gpuLayers,
                      },
                    },
                  };
                  const json = JSON.stringify(dump, null, 2);
                  const date = new Date().toISOString().split('T')[0];
                  const { save } = await import('@tauri-apps/plugin-dialog');
                  const path = await save({
                    defaultPath: `notesage-diagnostics-${date}.json`,
                    filters: [{ name: 'JSON', extensions: ['json'] }],
                  });
                  if (path) {
                    await tauriApi.writeFile(path, json);
                    toast.success('Diagnostics exported');
                    tauriApi.revealInFinder(path);
                  }
                } catch (err) {
                  toast.error(`Export failed: ${err}`);
                }
              }}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              Export
            </Button>
          }
        />
      </SettingsGroup>
    </>
  );
}
