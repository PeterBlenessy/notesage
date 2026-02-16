import { Settings, Sun, Moon, Monitor, Sparkles, Sliders, UserCircle2, FileText, FolderCog } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AISettings } from './AISettings';
import { PersonasSettings } from './PersonasSettings';
import { PromptsSettings } from './PromptsSettings';
import { ProjectSettings } from './ProjectSettings';
import { useSettingsStore, type MeasurementUnit } from '@/stores/settings-store';
import { useProjectStore } from '@/stores/project-store';
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
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type SettingsTab = 'ai' | 'personas' | 'prompts' | 'editor' | 'project';

const BASE_TABS: { id: SettingsTab; label: string; icon: typeof Sparkles }[] = [
  { id: 'ai', label: 'AI Providers', icon: Sparkles },
  { id: 'personas', label: 'AI Personas', icon: UserCircle2 },
  { id: 'prompts', label: 'Custom Prompts', icon: FileText },
  { id: 'editor', label: 'Editor', icon: Sliders },
];

const PROJECT_TAB: { id: SettingsTab; label: string; icon: typeof Sparkles } = {
  id: 'project', label: 'Project', icon: FolderCog,
};

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

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const {
    theme, setTheme,
    showFloatingToolbar, setShowFloatingToolbar,
    contentWidth, setContentWidth,
    measurementUnit, setMeasurementUnit,
    marginTop, setMarginTop,
    marginBottom, setMarginBottom,
    marginLeft, setMarginLeft,
    marginRight, setMarginRight,
  } = useSettingsStore();
  const rootPath = useProjectStore((s) => s.rootPath);
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');

  const tabs = rootPath ? [PROJECT_TAB, ...BASE_TABS] : BASE_TABS;

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
      <DialogContent className="max-w-[80vw] lg:max-w-4xl max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0" style={{ backgroundColor: 'var(--color-card)' }}>
          <div className="flex items-center gap-3">
            <Settings className="h-10 w-10" style={{ color: 'var(--color-foreground)' }} />
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
          <div
            className="w-52 border-r p-3 shrink-0"
            style={{ backgroundColor: 'var(--color-card)' }}
          >
            <nav className="space-y-0.5">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors',
                      isActive
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    )}
                    style={{
                      backgroundColor: isActive ? 'var(--color-accent)' : undefined,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = ''; }}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'project' && (
              <div className="p-6">
                <ProjectSettings />
              </div>
            )}

            {activeTab === 'ai' && (
              <div className="p-6">
                <AISettings />
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
                          'flex flex-col items-center gap-2 py-3 rounded-lg border transition-colors',
                          theme === value
                            ? 'text-foreground font-medium'
                            : 'text-muted-foreground'
                        )}
                        style={{
                          borderColor: theme === value ? 'var(--color-foreground)' : 'var(--color-border)',
                          backgroundColor: theme === value ? 'var(--color-accent)' : undefined,
                        }}
                        onMouseEnter={(e) => { if (theme !== value) e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
                        onMouseLeave={(e) => { if (theme !== value) e.currentTarget.style.backgroundColor = ''; }}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="text-xs">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px" style={{ backgroundColor: 'var(--color-border)' }} />

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
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors"
                      style={{ borderColor: 'var(--color-border)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                    >
                      <div>
                        <Label
                          htmlFor="floating-toolbar"
                          className="text-[13px] font-medium cursor-pointer"
                        >
                          Floating Toolbar
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Show formatting toolbar when text is selected
                        </p>
                      </div>
                      <Switch
                        id="floating-toolbar"
                        checked={showFloatingToolbar}
                        onCheckedChange={setShowFloatingToolbar}
                        className="ml-auto"
                      />
                    </div>
                  </div>
                </div>

                <div className="h-px" style={{ backgroundColor: 'var(--color-border)' }} />

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
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors"
                      style={{ borderColor: 'var(--color-border)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                    >
                      <div>
                        <Label className="text-[13px] font-medium">Units</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Measurement unit for dimensions
                        </p>
                      </div>
                      <div
                        className="ml-auto flex rounded-md overflow-hidden border"
                        style={{ borderColor: 'var(--color-border)' }}
                      >
                        {(['cm', 'inch'] as const).map((unit) => (
                          <button
                            key={unit}
                            onClick={() => setMeasurementUnit(unit)}
                            className={cn(
                              'px-3.5 py-1.5 text-xs font-medium transition-colors',
                              measurementUnit === unit
                                ? 'text-foreground'
                                : 'text-muted-foreground'
                            )}
                            style={{
                              backgroundColor: measurementUnit === unit ? 'var(--color-accent)' : undefined,
                            }}
                            onMouseEnter={(e) => { if (measurementUnit !== unit) e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
                            onMouseLeave={(e) => { if (measurementUnit !== unit) e.currentTarget.style.backgroundColor = ''; }}
                          >
                            {unit === 'cm' ? 'cm' : 'in'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Page Size */}
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors"
                      style={{ borderColor: 'var(--color-border)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                    >
                      <div>
                        <Label className="text-[13px] font-medium">Page Size</Label>
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

                    {/* Page Margins */}
                    <div
                      className="px-4 py-3 rounded-lg border transition-colors"
                      style={{ borderColor: 'var(--color-border)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                    >
                      <div className="mb-3">
                        <Label className="text-[13px] font-medium">Page Margins</Label>
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
