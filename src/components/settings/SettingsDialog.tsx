import { Settings, Sun, Moon, Monitor, Sparkles, Sliders, FileText, GitBranch, Cloud, Info, Loader2, ArrowUpCircle, ScrollText, Code, Download, Blocks, FolderOpen, Trash2, Mic, Cpu, Palette, RotateCcw, ShieldCheck, ChevronDown } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConnectionsSettings } from './ConnectionsSettings';
import { UseCaseRoutingSettings } from './UseCaseRoutingSettings';
import { PromptsSettings } from './PromptsSettings';
import { SyncSettings } from './SyncSettings';
import { SkillsSettings } from './SkillsSettings';
import { TranscriptionSettings } from './TranscriptionSettings';
import { LocalAISettings } from './LocalAISettings';
import { ApprovalsSettings } from './ApprovalsSettings';
import { ChangelogDialog } from './ChangelogDialog';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore, type MeasurementUnit } from '@/stores/settings-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useEditorStore } from '@/stores/editor-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
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
import { useState, useCallback, useEffect } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { QuietChromeTargets } from '@/lib/quiet-chrome';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import { setLogLevel as setLoggerLevel } from '@/lib/logger';
import type { LogLevel } from '@/lib/logger';
import type { UpdateState } from '@/hooks/useAutoUpdate';

export type SettingsTab = 'general' | 'ai' | 'local-ai' | 'prompts' | 'skills' | 'transcription' | 'editor' | 'git' | 'sync' | 'privacy' | 'developer' | 'about';

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialTab?: SettingsTab;
  updateState?: UpdateState;
  onCheckForUpdate?: () => Promise<void>;
  onOpenUpdateDialog?: () => void;
}

const TINT_PRESETS = [
  { label: 'Neutral', hue: 0, chroma: 0 },
  { label: 'Warm', hue: 60, chroma: 12 },
  { label: 'Sepia', hue: 55, chroma: 18 },
  { label: 'Rose', hue: 10, chroma: 10 },
  { label: 'Sage', hue: 145, chroma: 8 },
  { label: 'Ocean', hue: 230, chroma: 8 },
  { label: 'Lavender', hue: 290, chroma: 8 },
];

const TABS: { id: SettingsTab; label: string; icon: typeof Sparkles }[] = [
  { id: 'general', label: 'General', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Sliders },
  { id: 'ai', label: 'AI Providers', icon: Sparkles },
  { id: 'local-ai', label: 'Local AI', icon: Cpu },
  { id: 'prompts', label: 'Custom Prompts', icon: FileText },
  { id: 'skills', label: 'Skills & Agents', icon: Blocks },
  { id: 'transcription', label: 'Transcription', icon: Mic },
  { id: 'git', label: 'Version Control', icon: GitBranch },
  { id: 'sync', label: 'Sync', icon: Cloud },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'developer', label: 'Advanced', icon: Code },
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
    contrastLevel, setContrastLevel,
    tintHue, setTintHue,
    tintChroma, setTintChroma,
    showFloatingToolbar, setShowFloatingToolbar,
    toolbarVisible, setToolbarVisible,
    externalChangeDiffReview, setExternalChangeDiffReview,
    showHiddenFiles, setShowHiddenFiles,
    showAgentModePicker, setShowAgentModePicker,
    crossProjectMode, setCrossProjectMode,
    uiPreview, setUiPreview,
    completionsOnOutOfScope, setCompletionsOnOutOfScope,
    contentWidth, setContentWidth,
    measurementUnit, setMeasurementUnit,
    marginTop, setMarginTop,
    marginBottom, setMarginBottom,
    marginLeft, setMarginLeft,
    marginRight, setMarginRight,
    gitEnabled, setGitEnabled,
    printLayout, setPrintLayout,
    chatHistoryLimit, setChatHistoryLimit,
    toolCallingEnabled, setToolCallingEnabled,
    requireAllToolConfirmations, setRequireAllToolConfirmations,
    skillManagement, setSkillManagement,
    logLevel, setLogLevel,
    autoCheckUpdates, setAutoCheckUpdates,
    lastUpdateCheck,
    showInTray, setShowInTray,
    closeToTray, setCloseToTray,
    startAtLogin, setStartAtLogin,
    notifyAgentCompletion, setNotifyAgentCompletion,
    notifyExternalChanges, setNotifyExternalChanges,
  } = useSettingsStore();
  // Quiet chrome (#51) — preset + per-element overrides. Kept separate from
  // the main destructure so the unit tests that stub the store can mount
  // the dialog without having to know about every preset helper.
  const quietChromePreset = useSettingsStore((s) => s.quietChromePreset);
  const quietChromeOverrides = useSettingsStore((s) => s.quietChromeOverrides);
  const setQuietChromePreset = useSettingsStore((s) => s.setQuietChromePreset);
  const setQuietChromeOverride = useSettingsStore((s) => s.setQuietChromeOverride);
  const [quietChromeAdvancedOpen, setQuietChromeAdvancedOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [gitNotAvailable, setGitNotAvailable] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logSize, setLogSize] = useState<number | null>(null);

  // Sync activeTab when initialTab changes (e.g., opened from Project Settings → AI Providers)
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Load log file info when developer tab is active
  useEffect(() => {
    if (activeTab !== 'developer') return;
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
    return () => { cancelled = true; };
  }, [activeTab]);

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
      <DialogContent className="w-[800px] sm:max-w-none max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col top-[10vh] translate-y-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0 bg-card">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-foreground" strokeWidth={1.5} />
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
                <ConnectionsSettings onNavigateToTab={(tab) => setActiveTab(tab as SettingsTab)} />
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

            {activeTab === 'prompts' && (
              <div className="p-6">
                <PromptsSettings />
              </div>
            )}

            {activeTab === 'skills' && (
              <div className="p-6">
                <SkillsSettings />
              </div>
            )}

            {activeTab === 'local-ai' && (
              <div className="p-6">
                <LocalAISettings />
              </div>
            )}

            {activeTab === 'transcription' && (
              <div className="p-6">
                <TranscriptionSettings />
              </div>
            )}

            {activeTab === 'general' && (
              <div className="p-6 space-y-6">
                {/* Theme Selection */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Theme</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Choose light, dark, or follow your system
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

                {/* Contrast & Tint */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Appearance</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Fine-tune contrast and color tint
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-sm">Contrast</span>
                        <p className="text-xs text-muted-foreground">Adjust contrast for eye comfort</p>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                        {contrastLevel === 0 ? "Full" : contrastLevel === 100 ? "Soft" : `${contrastLevel}%`}
                      </span>
                    </div>
                    <Slider
                      value={[contrastLevel]}
                      onValueChange={([v]) => setContrastLevel(v)}
                      min={0}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-sm">Color Tint</span>
                        <p className="text-xs text-muted-foreground">Add a subtle color wash to the interface</p>
                      </div>
                      {tintChroma > 0 && (
                        <button
                          onClick={() => { setTintChroma(0); }}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
                        >
                          <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                          Reset
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {TINT_PRESETS.map((preset) => {
                        const isActive = preset.chroma === 0
                          ? tintChroma === 0
                          : tintChroma > 0 && tintHue === preset.hue && tintChroma === preset.chroma;
                        return (
                          <button
                            key={preset.label}
                            onClick={() => {
                              setTintHue(preset.hue);
                              setTintChroma(preset.chroma);
                            }}
                            className={cn(
                              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 hover:bg-accent',
                              isActive
                                ? 'border border-foreground bg-accent text-foreground'
                                : 'border border-border text-muted-foreground'
                            )}
                          >
                            <span
                              className="h-3 w-3 rounded-full shrink-0 border border-border"
                              style={{
                                backgroundColor: preset.chroma === 0
                                  ? 'oklch(70% 0 0)'
                                  : `oklch(70% 0.08 ${preset.hue})`,
                              }}
                            />
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    {tintChroma > 0 && (
                      <>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-muted-foreground">Intensity</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {tintChroma === 0 ? 'None' : `${Math.round(tintChroma / 30 * 100)}%`}
                          </span>
                        </div>
                        <Slider
                          value={[tintChroma]}
                          onValueChange={([v]) => setTintChroma(v)}
                          min={1}
                          max={30}
                          step={1}
                          className="w-full"
                        />
                        <div className="flex items-center justify-between mt-3 mb-1.5">
                          <span className="text-xs text-muted-foreground">Hue</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{tintHue}°</span>
                        </div>
                        <Slider
                          value={[tintHue]}
                          onValueChange={([v]) => setTintHue(v)}
                          min={0}
                          max={359}
                          step={1}
                          className="w-full"
                        />
                      </>
                    )}
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Quiet chrome (#51) */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Quiet chrome</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Fade chrome elements (toolbar, status bar, document
                      header, sidebar, agent orb) while you type. The
                      composer is never faded.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {([
                      {
                        value: "relaxed" as const,
                        label: "Relaxed",
                        description: "Minimal fade — only the toolbar and status strip",
                      },
                      {
                        value: "default" as const,
                        label: "Default",
                        description: "Balanced — fades toolbar, status, and document header",
                        recommended: true,
                      },
                      {
                        value: "aggressive" as const,
                        label: "Aggressive",
                        description: "Deep focus — everything fades, sidebar and orb dim",
                      },
                    ]).map(({ value, label, description, recommended }) => {
                      const isActive = quietChromePreset === value;
                      return (
                        <button
                          key={value}
                          onClick={() => setQuietChromePreset(value)}
                          className={cn(
                            "flex flex-col items-start gap-1 p-3 text-left rounded-lg border transition-colors duration-150 hover:bg-accent active:opacity-80",
                            isActive
                              ? "border-foreground bg-accent text-foreground font-medium"
                              : "border-border text-muted-foreground"
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{label}</span>
                            {recommended && (
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Recommended
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground font-normal leading-snug">
                            {description}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {quietChromePreset === "custom" && (
                    <p className="text-xs text-muted-foreground">
                      Custom overrides active — preset switched to Custom.
                      Pick a preset above to reset.
                    </p>
                  )}

                  <Collapsible
                    open={quietChromeAdvancedOpen}
                    onOpenChange={setQuietChromeAdvancedOpen}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
                      >
                        <ChevronDown
                          className={cn(
                            "h-3 w-3 transition-transform duration-150",
                            quietChromeAdvancedOpen && "rotate-180"
                          )}
                          strokeWidth={1.5}
                        />
                        Advanced — per-element toggles
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 mt-3">
                      {(
                        [
                          { key: "toolbar", label: "Toolbar" },
                          { key: "status", label: "Status bar" },
                          { key: "docHead", label: "Document header" },
                          { key: "sidebar", label: "Sidebar" },
                          { key: "orb", label: "Agent orb" },
                        ] as Array<{ key: keyof QuietChromeTargets; label: string }>
                      ).map(({ key, label }) => {
                        const id = `quiet-chrome-${String(key)}`;
                        return (
                          <div
                            key={String(key)}
                            className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <Label htmlFor={id} className="text-sm font-medium cursor-pointer">
                                Fade {label.toLowerCase()}
                              </Label>
                              <Switch
                                id={id}
                                checked={quietChromeOverrides[key]}
                                onCheckedChange={(checked) => {
                                  setQuietChromeOverride(key, checked);
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                <div className="h-px bg-border" />

                {/* System Tray */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">System Tray</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Menu bar icon and background behavior
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="show-in-tray" className="text-sm font-medium cursor-pointer">
                          Show in menu bar
                        </Label>
                        <Switch
                          id="show-in-tray"
                          checked={showInTray}
                          onCheckedChange={(checked) => {
                            setShowInTray(checked);
                            invoke('set_tray_visible', { visible: checked }).catch(() => {});
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Keep Notesage accessible from the menu bar
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="close-to-tray" className="text-sm font-medium cursor-pointer">
                          Close window to tray
                        </Label>
                        <Switch
                          id="close-to-tray"
                          checked={closeToTray}
                          onCheckedChange={(checked) => {
                            setCloseToTray(checked);
                            invoke('set_close_to_tray', { enabled: checked }).catch(() => {});
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Closing the window hides it instead of quitting the app
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="start-at-login" className="text-sm font-medium cursor-pointer">
                          Start at login
                        </Label>
                        <Switch
                          id="start-at-login"
                          checked={startAtLogin}
                          onCheckedChange={async (checked) => {
                            try {
                              if (checked) {
                                await import('@tauri-apps/plugin-autostart').then(m => m.enable());
                              } else {
                                await import('@tauri-apps/plugin-autostart').then(m => m.disable());
                              }
                              setStartAtLogin(checked);
                            } catch (e) {
                              console.error('Failed to toggle autostart:', e);
                            }
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Launch Notesage automatically when you log in
                      </p>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Notifications */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Notifications</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Choose which desktop notifications to receive
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="notify-agent" className="text-sm font-medium cursor-pointer">
                          Agent task completion
                        </Label>
                        <Switch
                          id="notify-agent"
                          checked={notifyAgentCompletion}
                          onCheckedChange={setNotifyAgentCompletion}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Notify when an agent finishes or encounters an error
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="notify-external" className="text-sm font-medium cursor-pointer">
                          External file changes
                        </Label>
                        <Switch
                          id="notify-external"
                          checked={notifyExternalChanges}
                          onCheckedChange={setNotifyExternalChanges}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Notify when files are modified externally
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'editor' && (
              <div className="p-6 space-y-6">
                {/* Editor Options */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Editor Options</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Configure your editing experience
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="toolbar-visible" className="text-sm font-medium cursor-pointer">
                          Top Toolbar
                        </Label>
                        <Switch
                          id="toolbar-visible"
                          checked={toolbarVisible}
                          onCheckedChange={setToolbarVisible}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Show the formatting toolbar above the editor
                      </p>
                    </div>
                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="floating-toolbar" className="text-sm font-medium cursor-pointer">
                          Floating Toolbar
                        </Label>
                        <Switch
                          id="floating-toolbar"
                          checked={showFloatingToolbar}
                          onCheckedChange={setShowFloatingToolbar}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Show AI actions and comment button when text is selected
                      </p>
                    </div>
                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="external-diff-review" className="text-sm font-medium cursor-pointer">
                          Review External Changes
                        </Label>
                        <Switch
                          id="external-diff-review"
                          checked={externalChangeDiffReview}
                          onCheckedChange={setExternalChangeDiffReview}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Show inline diff when files change on disk. When off, changes are auto-accepted.
                        <span className="text-muted-foreground/60"> Beta — may not preserve formatting perfectly.</span>
                      </p>
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

                    {/* Print Layout — only shown for paper sizes */}
                    {(contentWidth === 'a4' || contentWidth === 'a5' || contentWidth === 'letter') && (
                      <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="text-sm font-medium">Print Layout</Label>
                          <Switch
                            checked={printLayout}
                            onCheckedChange={setPrintLayout}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Show page boundaries with headers and footers
                        </p>
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
                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="git-integration" className="text-sm font-medium cursor-pointer">
                          Enable Git
                        </Label>
                        <Switch
                          id="git-integration"
                          checked={gitEnabled}
                          onCheckedChange={handleGitToggle}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Track file changes, view status indicators, switch branches, and commit from within the app
                      </p>
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
                          <pre className="rounded bg-muted px-2 py-1.5 font-mono text-xs select-all">
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
            {activeTab === 'privacy' && (
              <div className="p-6">
                <ApprovalsSettings />
              </div>
            )}
            {activeTab === 'developer' && (
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">Advanced</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Power user features and diagnostics
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="ui-preview" className="text-sm font-medium cursor-pointer">
                          Try the new UI
                        </Label>
                        <Switch
                          id="ui-preview"
                          checked={uiPreview === 'quiet-composer'}
                          onCheckedChange={(checked) => setUiPreview(checked ? 'quiet-composer' : 'legacy')}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Opt in to the Quiet Composer preview. Toggle off to return to the classic layout. Restart not required.
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-sm font-medium">
                          Log Level
                        </Label>
                        <Select
                          value={logLevel}
                          onValueChange={(value: string) => {
                            const level = value as LogLevel;
                            setLogLevel(level);
                            setLoggerLevel(level);
                            tauriApi.setLogLevel(level);
                          }}
                        >
                          <SelectTrigger className="w-[130px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="error">Error</SelectItem>
                            <SelectItem value="warn">Warn</SelectItem>
                            <SelectItem value="info">Info</SelectItem>
                            <SelectItem value="debug">Debug</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Controls which messages are written to log files. Default is Warn.
                      </p>
                      {logPath && (
                        <div className="flex items-center gap-1 mt-2.5 pt-2.5 border-t border-border">
                          <p className="text-[10px] leading-tight text-muted-foreground font-mono break-all select-all flex-1 min-w-0">
                            {logPath}
                            {logSize !== null && (
                              <span className="font-sans ml-1.5">
                                ({logSize < 1024
                                  ? `${logSize} B`
                                  : logSize < 1024 * 1024
                                    ? `${(logSize / 1024).toFixed(1)} KB`
                                    : `${(logSize / (1024 * 1024)).toFixed(1)} MB`})
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
                                    This will permanently delete all diagnostic log data. This action cannot be undone.
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
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-sm font-medium">
                          Export Diagnostics
                        </Label>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={async () => {
                            try {
                              const backend = await tauriApi.collectDiagnostics();
                              const { connections } = useConnectionsStore.getState();
                              const redactedConnections = connections.map(({ id, provider, authMethod, capabilities, status }) => ({
                                id, provider, authMethod, capabilities, status,
                              }));
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
                                  tabCount: useEditorStore.getState().tabs.length,
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
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Save backend and frontend state to a JSON file for bug reports. No API keys are included.
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label
                          htmlFor="tool-calling"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Tool Calling
                        </Label>
                        <Switch
                          id="tool-calling"
                          checked={toolCallingEnabled}
                          onCheckedChange={setToolCallingEnabled}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Enable tool calling in chat for local AI and API key connections. When on, AI can search the web, read files, and execute skills during conversations — safe tools run automatically, others require your approval. When off, chat is text-only.
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label
                          htmlFor="require-all-tool-confirmations"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Require Confirmation for All Tool Calls
                        </Label>
                        <Switch
                          id="require-all-tool-confirmations"
                          checked={requireAllToolConfirmations}
                          onCheckedChange={setRequireAllToolConfirmations}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Prompt for approval on every single tool call — including auto-allowed read-only tools like file reads and web searches. Disables silent tool execution. Off by default.
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border">
                      <div className="flex items-start justify-between gap-3">
                        <Label className="text-sm font-medium">Web Search</Label>
                        <span className="text-[11px] font-medium text-muted-foreground shrink-0 rounded-full bg-muted px-2.5 py-0.5 mt-0.5">DuckDuckGo</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Search provider used by AI tool calling. DuckDuckGo works without an API key.
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label
                          htmlFor="skill-management"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Skill &amp; Agent Management
                        </Label>
                        <Switch
                          id="skill-management"
                          checked={skillManagement}
                          onCheckedChange={setSkillManagement}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Enable delete and move actions for custom skills and agents in Settings
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="show-hidden-files" className="text-sm font-medium cursor-pointer">
                          Show Hidden Files
                        </Label>
                        <Switch
                          id="show-hidden-files"
                          checked={showHiddenFiles}
                          onCheckedChange={setShowHiddenFiles}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Show dotfiles and dot-directories (starting with &quot;.&quot;) in the sidebar file tree.
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="show-agent-mode-picker" className="text-sm font-medium cursor-pointer">
                          Show Agent Mode Picker
                        </Label>
                        <Switch
                          id="show-agent-mode-picker"
                          checked={showAgentModePicker}
                          onCheckedChange={setShowAgentModePicker}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Show a mode picker in the chat footer for agents that support modes (e.g., Claude Code: Edit/Plan/Chat). When off, the default mode is used automatically.
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="cross-project-mode" className="text-sm font-medium cursor-pointer">
                          Cross-Project Mode
                        </Label>
                        <Switch
                          id="cross-project-mode"
                          checked={crossProjectMode}
                          onCheckedChange={setCrossProjectMode}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Exposes <span className="font-medium text-foreground">all workspace folders</span> to the AI agent — disables project isolation. Only enable for power-user workflows that explicitly need multi-project visibility. A persistent banner appears in the chat panel while this is on.
                      </p>
                    </div>

                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="completions-on-out-of-scope" className="text-sm font-medium cursor-pointer">
                          Allow completions for files outside the selected project (legacy behavior)
                        </Label>
                        <Switch
                          id="completions-on-out-of-scope"
                          checked={completionsOnOutOfScope}
                          onCheckedChange={setCompletionsOnOutOfScope}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        By default, inline completions are suppressed when the active file sits outside the project scope selected in the chat footer — so the completion provider never sees unrelated file contents. Enable this to restore the pre-isolation behaviour and receive completions everywhere.
                      </p>
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
                    <div className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="auto-check-updates" className="text-sm font-medium cursor-pointer">
                          Automatically Check for Updates
                        </Label>
                        <Switch
                          id="auto-check-updates"
                          checked={autoCheckUpdates}
                          onCheckedChange={setAutoCheckUpdates}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Check for new versions when the app starts
                      </p>
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
