import { Settings, Sun, Moon, Monitor, Sparkles, Sliders, UserCircle2, FileText } from 'lucide-react';
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
import { useSettingsStore } from '@/stores/settings-store';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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

type SettingsTab = 'ai' | 'personas' | 'prompts' | 'editor';

const TABS: { id: SettingsTab; label: string; icon: typeof Sparkles }[] = [
  { id: 'ai', label: 'AI Providers', icon: Sparkles },
  { id: 'personas', label: 'AI Personas', icon: UserCircle2 },
  { id: 'prompts', label: 'Custom Prompts', icon: FileText },
  { id: 'editor', label: 'Editor', icon: Sliders },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { theme, setTheme, showFloatingToolbar, setShowFloatingToolbar, contentWidth, setContentWidth, contentMargin, setContentMargin } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');

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
              {TABS.map((tab) => {
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

                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors"
                      style={{ borderColor: 'var(--color-border)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                    >
                      <div>
                        <Label className="text-[13px] font-medium">Content Width</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Maximum width of your document
                        </p>
                      </div>
                      <Select
                        value={contentWidth}
                        onValueChange={setContentWidth}
                      >
                        <SelectTrigger className="ml-auto w-44 text-left">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full">Full Width</SelectItem>
                          <SelectItem value="auto">Auto (720px)</SelectItem>
                          <SelectItem value="a4">A4 (794px)</SelectItem>
                          <SelectItem value="a5">A5 (559px)</SelectItem>
                          <SelectItem value="letter">Letter (816px)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors"
                      style={{ borderColor: 'var(--color-border)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-muted-foreground)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                    >
                      <div>
                        <Label className="text-[13px] font-medium">Page Margin</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Horizontal margins inside the document
                        </p>
                      </div>
                      <Select
                        value={contentMargin}
                        onValueChange={setContentMargin}
                      >
                        <SelectTrigger className="ml-auto w-44 text-left">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="small">Small (32px)</SelectItem>
                          <SelectItem value="medium">Medium (64px)</SelectItem>
                          <SelectItem value="large">Large (96px)</SelectItem>
                        </SelectContent>
                      </Select>
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
