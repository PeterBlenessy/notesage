import { useEffect, useState } from 'react';
import { Download, FolderOpen, Trash2 } from 'lucide-react';
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
import { useSettingsStore } from '@/stores/settings-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useEditorStore } from '@/stores/editor-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

/**
 * Advanced settings panel (v2) — power-user features, diagnostics, and
 * opt-in scope toggles.
 *
 * Grouped into three clusters per the design brief:
 *   1. Diagnostics — log level, log file access, diagnostics export
 *   2. Scope — hidden files, cross-project mode, out-of-scope completions,
 *              "require confirmation for all tool calls"
 *   3. Experimental — UI preview toggle, skill management, agent mode picker,
 *                     tool calling
 *
 * Note: the "Review External Changes" toggle currently lives here (legacy) —
 * task #68 migrates it to the Editor panel and depends on task #71.
 */
export function AdvancedSettings() {
  const uiPreview = useSettingsStore((s) => s.uiPreview);
  const setUiPreview = useSettingsStore((s) => s.setUiPreview);
  const logLevel = useSettingsStore((s) => s.logLevel);
  const setLogLevel = useSettingsStore((s) => s.setLogLevel);
  const toolCallingEnabled = useSettingsStore((s) => s.toolCallingEnabled);
  const setToolCallingEnabled = useSettingsStore((s) => s.setToolCallingEnabled);
  const requireAllToolConfirmations = useSettingsStore(
    (s) => s.requireAllToolConfirmations,
  );
  const setRequireAllToolConfirmations = useSettingsStore(
    (s) => s.setRequireAllToolConfirmations,
  );
  const skillManagement = useSettingsStore((s) => s.skillManagement);
  const setSkillManagement = useSettingsStore((s) => s.setSkillManagement);
  const showHiddenFiles = useSettingsStore((s) => s.showHiddenFiles);
  const setShowHiddenFiles = useSettingsStore((s) => s.setShowHiddenFiles);
  const showAgentModePicker = useSettingsStore((s) => s.showAgentModePicker);
  const setShowAgentModePicker = useSettingsStore((s) => s.setShowAgentModePicker);
  const crossProjectMode = useSettingsStore((s) => s.crossProjectMode);
  const setCrossProjectMode = useSettingsStore((s) => s.setCrossProjectMode);
  const completionsOnOutOfScope = useSettingsStore(
    (s) => s.completionsOnOutOfScope,
  );
  const setCompletionsOnOutOfScope = useSettingsStore(
    (s) => s.setCompletionsOnOutOfScope,
  );

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

  return (
    <>
      <SettingsGroup
        label="Diagnostics"
        description="Logging, log files, and diagnostics export."
      >
        <SettingsRow
          label="Log Level"
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
          }
        />

        {logPath && (
          <div className="px-4 py-3 flex items-center gap-1">
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
          label="Export Diagnostics"
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

      <SettingsGroup
        label="Scope"
        description="Project isolation and confirmation behavior."
      >
        <SettingsRow
          label="Show Hidden Files"
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
          label="Cross-Project Mode"
          description={
            <>
              Exposes{' '}
              <span className="font-medium text-foreground">
                all workspace folders
              </span>{' '}
              to the AI agent — disables project isolation. Only enable for
              power-user workflows that explicitly need multi-project
              visibility. A persistent banner appears in the chat panel while
              this is on.
            </>
          }
          htmlFor="cross-project-mode"
          control={
            <Switch
              id="cross-project-mode"
              checked={crossProjectMode}
              onCheckedChange={setCrossProjectMode}
            />
          }
        />
        <SettingsRow
          label="Allow completions for files outside the selected project (legacy behavior)"
          description="By default, inline completions are suppressed when the active file sits outside the project scope selected in the chat footer — so the completion provider never sees unrelated file contents. Enable this to restore the pre-isolation behaviour and receive completions everywhere."
          htmlFor="completions-on-out-of-scope"
          control={
            <Switch
              id="completions-on-out-of-scope"
              checked={completionsOnOutOfScope}
              onCheckedChange={setCompletionsOnOutOfScope}
            />
          }
        />
        <SettingsRow
          label="Require Confirmation for All Tool Calls"
          description="Prompt for approval on every single tool call — including auto-allowed read-only tools like file reads and web searches. Disables silent tool execution. Off by default."
          htmlFor="require-all-tool-confirmations"
          control={
            <Switch
              id="require-all-tool-confirmations"
              checked={requireAllToolConfirmations}
              onCheckedChange={setRequireAllToolConfirmations}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="Experimental"
        description="Preview features and power-user affordances."
      >
        <SettingsRow
          label="Try the new UI"
          description="Opt in to the Quiet Composer preview. Toggle off to return to the classic layout. Restart not required."
          htmlFor="ui-preview"
          control={
            <Switch
              id="ui-preview"
              checked={uiPreview === 'quiet-composer'}
              onCheckedChange={(checked) =>
                setUiPreview(checked ? 'quiet-composer' : 'legacy')
              }
            />
          }
        />
        <SettingsRow
          label="Tool Calling"
          description="Enable tool calling in chat for local AI and API key connections. When on, AI can search the web, read files, and execute skills during conversations — safe tools run automatically, others require your approval. When off, chat is text-only."
          htmlFor="tool-calling"
          control={
            <Switch
              id="tool-calling"
              checked={toolCallingEnabled}
              onCheckedChange={setToolCallingEnabled}
            />
          }
        />
        <SettingsRow
          label="Skill & Agent Management"
          description="Enable delete and move actions for custom skills and agents in Settings."
          htmlFor="skill-management"
          control={
            <Switch
              id="skill-management"
              checked={skillManagement}
              onCheckedChange={setSkillManagement}
            />
          }
        />
        <SettingsRow
          label="Show Agent Mode Picker"
          description="Show a mode picker in the chat footer for agents that support modes (e.g., Claude Code: Edit/Plan/Chat). When off, the default mode is used automatically."
          htmlFor="show-agent-mode-picker"
          control={
            <Switch
              id="show-agent-mode-picker"
              checked={showAgentModePicker}
              onCheckedChange={setShowAgentModePicker}
            />
          }
        />
        <SettingsRow
          label="Web Search"
          description="Search provider used by AI tool calling. DuckDuckGo works without an API key."
          control={
            <span className="text-[11px] font-medium text-muted-foreground rounded-full bg-muted px-2.5 py-0.5">
              DuckDuckGo
            </span>
          }
        />
      </SettingsGroup>
    </>
  );
}
