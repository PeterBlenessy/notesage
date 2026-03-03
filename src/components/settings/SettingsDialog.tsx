import { Settings, Sun, Moon, Monitor, Sparkles, Sliders, UserCircle2, FileText, GitBranch, Cloud, Info, Loader2, ArrowUpCircle, ScrollText, Code, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConnectionsSettings } from './ConnectionsSettings';
import { UseCaseRoutingSettings } from './UseCaseRoutingSettings';
import { PersonasSettings } from './PersonasSettings';
import { PromptsSettings } from './PromptsSettings';
import { SyncSettings } from './SyncSettings';
import { ChangelogDialog } from './ChangelogDialog';
import { useSettingsStore, type MeasurementUnit } from '@/stores/settings-store';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { tauriApi } from '@/lib/tauri';
import type { UpdateState } from '@/hooks/useAutoUpdate';

export type SettingsTab = 'ai' | 'personas' | 'prompts' | 'editor' | 'git' | 'sync' | 'developer' | 'about';

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialTab?: SettingsTab;
  updateState?: UpdateState;
  onCheckForUpdate?: () => Promise<void>;
  onOpenUpdateDialog?: () => void;
}

const TABS: { id: SettingsTab; label: string; icon: typeof Sparkles }[] = [
  { id: 'editor', label: 'Editor', icon: Sliders },
  { id: 'ai', label: 'AI Providers', icon: Sparkles },
  { id: 'personas', label: 'AI Personas', icon: UserCircle2 },
  { id: 'prompts', label: 'Custom Prompts', icon: FileText },
  { id: 'git', label: 'Version Control', icon: GitBranch },
  { id: 'sync', label: 'Sync', icon: Cloud },
  { id: 'developer', label: 'Developer', icon: Code },
  { id: 'about', label: 'About', icon: Info },
];

// Page dimensions in cm
const PAGE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  a4: { width: 21.0, height: 29.7 },
  a5: { width: 14.8, height: 21.0 },
  letter: { width: 21.6, height: 27.9 },
};

function toDisplay(cm: number, unit: MeasurementUnit): string {
  if (unit === 'inch') {
    return (cm / 2.54).toFixed(1);
  }
  return cm.toFixed(1);
}

function fromDisplay(displayValue: number, unit: MeasurementUnit): number {
  if (unit === 'inch') {
    return displayValue * 2.54;
  }
  return displayValue;
}

function formatDimension(cm: number, unit: MeasurementUnit): string {
  if (unit === 'inch') {
    return (cm / 2.54).toFixed(1);
  }
  return cm.toFixed(1);
}

function friendlyUpdateError(error: string | null): string {
  if (!error) return 'Could not check for updates';
  const lower = error.toLowerCase();
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connect') || lower.includes('dns'))
    return 'Could not connect to update server';
  if (lower.includes('404') || lower.includes('not found'))
    return 'No published release found';
  if (lower.includes('timeout'))
    return 'Update check timed out';
  if (lower.includes('signature') || lower.includes('verify'))
    return 'Update signature verification failed';
  if (lower.includes('json') || lower.includes('parse') || lower.includes('deserialize'))
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

export function SettingsDialog({ open, onOpenChange, initialTab, updateState, onCheckForUpdate, onOpenUpdateDialog }: SettingsDialogProps) {
  const {
    theme, setTheme,
    showFloatingToolbar, setShowFloatingToolbar,
    toolbarVisible, setToolbarVisible,
    externalChangeDiffReview, setExternalChangeDiffReview,
    contentWidth, setContentWidth,
    measurementUnit, setMeasurementUnit,
    marginTop, setMarginTop,
    marginBottom, setMarginBottom,
    marginLeft, setMarginLeft,
    marginRight, setMarginRight,
    gitEnabled, setGitEnabled,
    pageBreaks, setPageBreaks,
    chatHistoryLimit, setChatHistoryLimit,
    debugLogging, setDebugLogging,
    autoCheckUpdates, setAutoCheckUpdates,
    lastUpdateCheck,
  } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'editor');
  const [gitNotAvailable, setGitNotAvailable] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);

  // Sync activeTab when initialTab changes (e.g., opened from Project Settings → AI Providers)
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const handleGitToggle = useCallback(async (checked: boolean) => {
    if (!checked) {
      setGitEnabled(false);
      setGitNotAvailable(false);
      return;
    }

    try {
      const available = await tauriApi.gitCheckAvailable();
      if (available) {
        setGitEnabled(true);
        setGitNotAvailable(false);
      } else {
        setGitNotAvailable(true);
      }
    } catch {
      setGitNotAvailable(true);
    }
  }, [setGitEnabled]);

  const unitLabel = measurementUnit === 'cm' ? 'cm' : 'in';

  function pageLabel(key: string, name: string): string {
    const dims = PAGE_DIMENSIONS[key];
    if (!dims) return name;
    return `${name} (${formatDimension(dims.width, measurementUnit)} x ${formatDimension(dims.height, measurementUnit)} ${unitLabel})`;
  }

  function handleMarginInput(
    value: string,
    setter: (v: number) => void,
  ) {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0) return;
    setter(fromDisplay(parsed, measurementUnit));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[672px] sm:max-w-none max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col top-[10vh] translate-y-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0 bg-card">
          <div className="flex items-center gap-3">
            <Settings className="h-10 w-10 text-foreground" strokeWidth={1.5} />
            <div>
              <DialogTitle className="text-xl">Settings</DialogTitle>
              <DialogDescription className="text-xs">
                Configure your Notesage experience
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Sidebar Navigation */}
          <div className="w-52 border-r p-3 shrink-0 bg-card">
            <nav className="space-y-0.5">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 hover:bg-accent active:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      isActive
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'ai' && (
              <div className="p-6 space-y-6">
                <ConnectionsSettings />
                <div className="h-px bg-border" />
                <UseCaseRoutingSettings />
                <div className="h-px bg-border" />

                {/* Chat History Limit */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Chat History</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Limit how many messages are sent to AI providers
                    </p>
                  </div>
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                  >
                    <div>
                      <Label className="text-sm font-medium">Message Limit</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        For Direct API connections only. ACP agents manage their own context.
                      </p>
                    </div>
                    <Select
                      value={String(chatHistoryLimit)}
                      onValueChange={(v) => setChatHistoryLimit(Number(v))}
                    >
                      <SelectTrigger className="ml-auto w-40 text-left">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Unlimited</SelectItem>
                        <SelectItem value="10">Last 10</SelectItem>
                        <SelectItem value="20">Last 20</SelectItem>
                        <SelectItem value="50">Last 50</SelectItem>
                        <SelectItem value="100">Last 100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'personas' && (
              <div className="p-6">
                <PersonasSettings />
              </div>
            )}

            {activeTab === 'prompts' && (
              <div className="p-6">
                <PromptsSettings />
              </div>
            )}

            {activeTab === 'editor' && (
              <div className="p-6 space-y-6">
                {/* Theme Selection */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Appearance</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Customize how Notesage looks
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'light' as const, label: 'Light', Icon: Sun },
                      { value: 'dark' as const, label: 'Dark', Icon: Moon },
                      { value: 'system' as const, label: 'System', Icon: Monitor },
                    ]).map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        onClick={() => setTheme(value)}
                        className={cn(
                          'flex flex-col items-center gap-2 py-3 rounded-lg border transition-colors duration-150 hover:bg-accent active:opacity-80',
                          theme === value
                            ? 'border-foreground bg-accent text-foreground font-medium'
                            : 'border-border text-muted-foreground'
                        )}
                      >
                        <Icon className="h-5 w-5" strokeWidth={1.5} />
                        <span className="text-xs">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Editor Options */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Editor Options</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Configure your editing experience
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div>
                        <Label
                          htmlFor="toolbar-visible"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Top Toolbar
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Show the formatting toolbar above the editor
                        </p>
                      </div>
                      <Switch
                        id="toolbar-visible"
                        checked={toolbarVisible}
                        onCheckedChange={setToolbarVisible}
                        className="ml-auto"
                      />
                    </div>
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div>
                        <Label
                          htmlFor="floating-toolbar"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Floating Toolbar
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Show AI actions and comment button when text is selected
                        </p>
                      </div>
                      <Switch
                        id="floating-toolbar"
                        checked={showFloatingToolbar}
                        onCheckedChange={setShowFloatingToolbar}
                        className="ml-auto"
                      />
                    </div>
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div>
                        <Label
                          htmlFor="external-diff-review"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Review External Changes
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Show inline diff when files change on disk. When off, changes are auto-accepted.
                          <span className="text-muted-foreground/60"> Beta — may not preserve formatting perfectly.</span>
                        </p>
                      </div>
                      <Switch
                        id="external-diff-review"
                        checked={externalChangeDiffReview}
                        onCheckedChange={setExternalChangeDiffReview}
                        className="ml-auto"
                      />
                    </div>
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Page Layout */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Page Layout</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Configure page size, units, and margins
                    </p>
                  </div>

                  <div className="space-y-2">
                    {/* Units */}
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div>
                        <Label className="text-sm font-medium">Units</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Measurement unit for dimensions
                        </p>
                      </div>
                      <div className="ml-auto flex rounded-md overflow-hidden border border-border">
                        {(['cm', 'inch'] as const).map((unit) => (
                          <button
                            key={unit}
                            onClick={() => setMeasurementUnit(unit)}
                            className={cn(
                              'px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 hover:bg-accent',
                              measurementUnit === unit
                                ? 'bg-accent text-foreground'
                                : 'text-muted-foreground'
                            )}
                          >
                            {unit === 'cm' ? 'cm' : 'in'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Page Size */}
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div>
                        <Label className="text-sm font-medium">Page Size</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Page format and dimensions
                        </p>
                      </div>
                      <Select
                        value={contentWidth}
                        onValueChange={setContentWidth}
                      >
                        <SelectTrigger className="ml-auto w-64 text-left">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full">Full Width</SelectItem>
                          <SelectItem value="auto">Auto (720px)</SelectItem>
                          <SelectItem value="a4">{pageLabel('a4', 'A4')}</SelectItem>
                          <SelectItem value="a5">{pageLabel('a5', 'A5')}</SelectItem>
                          <SelectItem value="letter">{pageLabel('letter', 'Letter')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Page Breaks — only shown for paper sizes */}
                    {(contentWidth === 'a4' || contentWidth === 'a5' || contentWidth === 'letter') && (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                      >
                        <div>
                          <Label className="text-sm font-medium">Page Break Gaps</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Show visible gaps between pages
                          </p>
                        </div>
                        <Switch
                          checked={pageBreaks === 'visible'}
                          onCheckedChange={(checked) => setPageBreaks(checked ? 'visible' : 'continuous')}
                        />
                      </div>
                    )}

                    {/* Page Margins */}
                    <div
                      className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div className="mb-3">
                        <Label className="text-sm font-medium">Page Margins</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Set margins for each side independently ({unitLabel})
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {([
                          { label: 'Top', value: marginTop, setter: setMarginTop },
                          { label: 'Bottom', value: marginBottom, setter: setMarginBottom },
                          { label: 'Left', value: marginLeft, setter: setMarginLeft },
                          { label: 'Right', value: marginRight, setter: setMarginRight },
                        ] as const).map(({ label, value, setter }) => (
                          <div key={label} className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground w-12 shrink-0">{label}</Label>
                            <div className="flex items-center gap-1.5 flex-1">
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                value={toDisplay(value, measurementUnit)}
                                onChange={(e) => handleMarginInput(e.target.value, setter)}
                                className="h-8 text-xs"
                              />
                              <span className="text-xs text-muted-foreground shrink-0">{unitLabel}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'git' && (
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Git Integration</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Version control settings
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div>
                        <Label
                          htmlFor="git-integration"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Enable Git
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Track file changes, view status indicators, switch branches, and commit from within the app
                        </p>
                      </div>
                      <Switch
                        id="git-integration"
                        checked={gitEnabled}
                        onCheckedChange={handleGitToggle}
                        className="ml-auto"
                      />
                    </div>

                    {gitNotAvailable && (
                      <div className="flex gap-2.5 rounded-md border border-border bg-muted/50 p-3">
                        <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" strokeWidth={1.5} />
                        <div className="space-y-1 text-xs text-muted-foreground">
                          <p className="font-medium text-foreground">Git is not installed on this system</p>
                          <p>
                            Install it from{' '}
                            <span className="font-medium text-foreground">git-scm.com</span>
                            {' '}or via Homebrew:
                          </p>
                          <pre className="rounded bg-muted px-2 py-1.5 font-mono text-[11px] select-all">
                            brew install git
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'sync' && (
              <div className="p-6">
                <SyncSettings />
              </div>
            )}
            {activeTab === 'developer' && (
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Developer</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Troubleshooting and diagnostics
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div>
                        <Label
                          htmlFor="debug-logging"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Debug Logging
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Log diagnostic messages to the console and stderr for troubleshooting
                        </p>
                      </div>
                      <Switch
                        id="debug-logging"
                        checked={debugLogging}
                        onCheckedChange={(checked) => {
                          setDebugLogging(checked);
                          tauriApi.setDebugLogging(checked);
                        }}
                        className="ml-auto"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'about' && (
              <div className="p-6 space-y-6">
                {/* App Info */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Notesage</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Version {__APP_VERSION__}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setChangelogOpen(true)}
                  >
                    <ScrollText className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                    Changelog
                  </Button>
                  <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
                </div>

                <div className="h-px bg-border" />

                {/* Updates */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Updates</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Keep Notesage up to date
                    </p>
                  </div>

                  <div className="space-y-2">
                    {/* Check for updates */}
                    <div
                      className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-muted-foreground truncate">
                          {updateState?.updateInfo ? (
                            <span className="text-foreground">
                              Update available: v{updateState.updateInfo.version}
                            </span>
                          ) : updateState?.status === 'checking' ? (
                            'Checking...'
                          ) : updateState?.status === 'error' ? (
                            friendlyUpdateError(updateState.error)
                          ) : (
                            <>Last checked: {formatRelativeTime(lastUpdateCheck)}</>
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {updateState?.updateInfo && onOpenUpdateDialog ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              onOpenUpdateDialog();
                              onOpenChange?.(false);
                            }}
                          >
                            <ArrowUpCircle className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                            View Update
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={onCheckForUpdate}
                            disabled={updateState?.status === 'checking'}
                          >
                            {updateState?.status === 'checking' ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" strokeWidth={1.5} />
                            ) : (
                              <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                            )}
                            {updateState?.status === 'checking'
                              ? 'Checking...'
                              : 'Check for Updates'}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Auto-check toggle */}
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                    >
                      <div>
                        <Label
                          htmlFor="auto-check-updates"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Automatically Check for Updates
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Check for new versions when the app starts
                        </p>
                      </div>
                      <Switch
                        id="auto-check-updates"
                        checked={autoCheckUpdates}
                        onCheckedChange={setAutoCheckUpdates}
                        className="ml-auto"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
