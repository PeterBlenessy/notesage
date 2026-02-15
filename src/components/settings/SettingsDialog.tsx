import { Settings, Sun, Moon, Monitor, Sparkles, Sliders, UserCircle2, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AISettings } from './AISettings';
import { PersonasSettings } from './PersonasSettings';
import { PromptsSettings } from './PromptsSettings';
import { useSettingsStore } from '@/stores/settings-store';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useState } from 'react';

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { theme, setTheme, showFloatingToolbar, setShowFloatingToolbar } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<'ai' | 'personas' | 'prompts' | 'editor'>('ai');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[80vw] lg:max-w-4xl max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b bg-card/50 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Settings className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-2xl">Settings</DialogTitle>
                <DialogDescription className="mt-1">
                  Configure your Notesage experience
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Sidebar Navigation */}
          <div className="w-48 border-r bg-muted/30 p-4">
            <nav className="space-y-1">
              <button
                onClick={() => setActiveTab('ai')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'ai'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Sparkles className="h-4 w-4" />
                AI Providers
              </button>
              <button
                onClick={() => setActiveTab('personas')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'personas'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                }`}
              >
                <UserCircle2 className="h-4 w-4" />
                AI Personas
              </button>
              <button
                onClick={() => setActiveTab('prompts')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'prompts'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                }`}
              >
                <FileText className="h-4 w-4" />
                Custom Prompts
              </button>
              <button
                onClick={() => setActiveTab('editor')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'editor'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Sliders className="h-4 w-4" />
                Editor
              </button>
            </nav>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'ai' && (
              <div className="p-6 animate-in fade-in-50 duration-300">
                <AISettings />
              </div>
            )}

            {activeTab === 'personas' && (
              <div className="p-6 animate-in fade-in-50 duration-300">
                <PersonasSettings />
              </div>
            )}

            {activeTab === 'prompts' && (
              <div className="p-6 animate-in fade-in-50 duration-300">
                <PromptsSettings />
              </div>
            )}

            {activeTab === 'editor' && (
              <div className="p-6 space-y-6 animate-in fade-in-50 duration-300">
                {/* Theme Selection */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <Sun className="h-4 w-4 text-primary" />
                      Appearance
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Customize how Notesage looks
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Theme</Label>
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        onClick={() => setTheme('light')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all hover:scale-105 active:scale-95 ${
                          theme === 'light'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <Sun className="h-5 w-5" />
                        <span className="text-sm font-medium">Light</span>
                      </button>
                      <button
                        onClick={() => setTheme('dark')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all hover:scale-105 active:scale-95 ${
                          theme === 'dark'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <Moon className="h-5 w-5" />
                        <span className="text-sm font-medium">Dark</span>
                      </button>
                      <button
                        onClick={() => setTheme('system')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all hover:scale-105 active:scale-95 ${
                          theme === 'system'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <Monitor className="h-5 w-5" />
                        <span className="text-sm font-medium">System</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Editor Options */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-base font-semibold">Editor Options</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Configure your editing experience
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-primary/50 transition-all bg-card/50">
                      <div>
                        <Label
                          htmlFor="floating-toolbar"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Floating Toolbar
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          Show formatting toolbar when text is selected
                        </p>
                      </div>
                      <Switch
                        id="floating-toolbar"
                        checked={showFloatingToolbar}
                        onCheckedChange={setShowFloatingToolbar}
                        className="data-[state=checked]:bg-primary"
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
