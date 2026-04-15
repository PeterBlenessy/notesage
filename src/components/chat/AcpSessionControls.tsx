import { memo, useSyncExternalStore, useCallback, useState } from 'react';
import { ChevronUp, Lock } from 'lucide-react';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import {
  getSessionInfo,
  subscribeSessionInfo,
  getModeLabel,
  acpAgent,
} from '@/lib/ai/acp-agent-state';
import { useConnectionsStore } from '@/stores/connections-store';
import type { AcpSessionConfigOption } from '@/lib/ai/acp-utils';

// ---------------------------------------------------------------------------
// Mode-sandbox conflict detection
// ---------------------------------------------------------------------------

/** Mode IDs that imply unrestricted access — conflict with sandbox/network restrictions */
const UNRESTRICTED_MODE_IDS = new Set([
  'bypassPermissions', 'yolo', 'full-access', 'autopilot', 'full_access',
]);

function isUnrestrictedMode(modeId: string): boolean {
  return UNRESTRICTED_MODE_IDS.has(modeId);
}

function hasActiveRestrictions(connectionId: string): boolean {
  const conn = useConnectionsStore.getState().connections.find(c => c.id === connectionId);
  if (!conn) return false;
  return !!(conn.sandboxEnabled || conn.networkSandboxEnabled || conn.kernelNetworkDeny);
}

// ---------------------------------------------------------------------------
// Mode Picker — compact chip for switching agent modes
// ---------------------------------------------------------------------------

export const AcpModePicker = memo(function AcpModePicker() {
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);
  const modes = sessionInfo.modes;
  const [conflictMode, setConflictMode] = useState<{ id: string; name: string } | null>(null);

  const applyMode = useCallback(async (modeId: string) => {
    if (!acpAgent?.instanceId || !acpAgent.chatSessionId) return;
    try {
      await tauriApi.acpSessionSetMode(acpAgent.instanceId, acpAgent.chatSessionId, modeId);
    } catch (err) {
      log.error('ai', `Failed to set mode: ${String(err)}`);
      toast.error('Failed to set mode');
    }
  }, []);

  const handleSetMode = useCallback((modeId: string, modeName: string) => {
    // Check for mode-sandbox conflict
    if (isUnrestrictedMode(modeId) && acpAgent?.connectionId && hasActiveRestrictions(acpAgent.connectionId)) {
      setConflictMode({ id: modeId, name: modeName });
      return;
    }
    applyMode(modeId);
  }, [applyMode]);

  const handleConflictKeep = useCallback(() => {
    if (conflictMode) applyMode(conflictMode.id);
    setConflictMode(null);
  }, [conflictMode, applyMode]);

  const handleConflictRemovePermanent = useCallback(() => {
    if (!acpAgent?.connectionId) { setConflictMode(null); return; }
    // Update connection settings to remove restrictions
    useConnectionsStore.getState().updateConnection(acpAgent.connectionId, {
      sandboxEnabled: false,
      networkSandboxEnabled: false,
      kernelNetworkDeny: false,
    });
    if (conflictMode) applyMode(conflictMode.id);
    setConflictMode(null);
    toast.info('Security restrictions removed. Agent will respawn with new settings on next session.');
  }, [conflictMode, applyMode]);

  if (!modes || modes.availableModes.length < 2) return null;

  const agentBinary = acpAgent?.agentBinary;
  const connectionId = acpAgent?.connectionId;
  const restricted = connectionId ? hasActiveRestrictions(connectionId) : false;
  const currentMode = modes.availableModes.find(m => m.id === modes.currentModeId);
  const currentLabel = currentMode
    ? getModeLabel(agentBinary, currentMode.id, currentMode.name)
    : { name: modes.currentModeId, tooltip: '' };

  return (
    <>
      <Popover>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 border border-transparent hover:border-border"
                >
                  {currentLabel.name}
                  <ChevronUp className="h-3 w-3 opacity-50" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            {currentLabel.tooltip && (
              <TooltipContent side="top" className="text-xs max-w-[200px]">
                {currentLabel.tooltip}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        <PopoverContent
          align="start"
          side="top"
          className="w-auto min-w-[140px] max-w-[300px] p-1"
        >
          {modes.availableModes.map((mode) => {
            const label = getModeLabel(agentBinary, mode.id, mode.name);
            const isActive = mode.id === modes.currentModeId;
            const showLock = restricted && isUnrestrictedMode(mode.id);
            return (
              <button
                key={mode.id}
                className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors duration-150 ${
                  isActive
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                onClick={() => { if (!isActive) handleSetMode(mode.id, label.name); }}
              >
                <div className="flex items-center gap-1.5">
                  <span>{label.name}</span>
                  {showLock && <Lock className="h-3 w-3 opacity-40" />}
                </div>
                {(label.tooltip || mode.description) && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {label.tooltip || mode.description}
                  </div>
                )}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      {/* Mode-sandbox conflict dialog */}
      <AlertDialog open={!!conflictMode} onOpenChange={(open) => { if (!open) setConflictMode(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mode conflicts with security settings</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                <span className="font-medium">{conflictMode?.name}</span> allows the agent to operate without permission checks, but this connection has security restrictions enabled that will block some operations.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction onClick={handleConflictKeep} className="w-full">
              Keep restrictions
            </AlertDialogAction>
            <AlertDialogAction
              onClick={handleConflictRemovePermanent}
              className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove restrictions permanently
            </AlertDialogAction>
            <AlertDialogCancel className="w-full mt-0">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

// ---------------------------------------------------------------------------
// Config Option Picker — dropdowns for agent config options
// Config options use { value, name } for select options (not { id, name })
// ---------------------------------------------------------------------------

const ConfigOptionPicker = memo(function ConfigOptionPicker({ option }: { option: AcpSessionConfigOption }) {
  const handleSetValue = useCallback(async (value: string) => {
    if (!acpAgent?.instanceId || !acpAgent.chatSessionId) return;
    try {
      await tauriApi.acpSessionSetConfigOption(acpAgent.instanceId, acpAgent.chatSessionId, option.id, value);
    } catch (err) {
      log.error('ai', `Failed to set config option: ${String(err)}`);
      toast.error('Failed to set config option');
    }
  }, [option.id]);

  const options = option.options ?? [];
  if (options.length < 2) return null;

  // Config select options use `value` field (not `id`)
  const currentOption = options.find(o => (o.value ?? o.name) === option.currentValue);
  const displayName = currentOption?.name ?? option.currentValue ?? option.name;
  // Capitalize first letter of displayed name
  const capitalizedDisplay = displayName.charAt(0).toUpperCase() + displayName.slice(1);

  return (
    <Popover>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 border border-transparent hover:border-border"
              >
                {capitalizedDisplay}
                <ChevronUp className="h-3 w-3 opacity-50" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          {option.description && (
            <TooltipContent side="top" className="text-xs max-w-[200px]">
              {option.description}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="start"
        side="top"
        className="w-auto min-w-[140px] max-w-[300px] p-1"
      >
        <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {option.name}
        </div>
        {options.map((opt) => {
          const optValue = opt.value ?? opt.name;
          const isActive = optValue === option.currentValue;
          return (
            <button
              key={optValue}
              className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors duration-150 ${
                isActive
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              onClick={() => { if (!isActive) handleSetValue(optValue); }}
            >
              <div>{opt.name}</div>
              {opt.description && (
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                  {opt.description}
                </div>
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
});

// ---------------------------------------------------------------------------
// Combined controls — renders mode picker + config options
// ---------------------------------------------------------------------------

export const AcpSessionControls = memo(function AcpSessionControls({ showModePicker }: { showModePicker: boolean }) {
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);

  // Filter config options:
  // - Skip "model" category (handled by model picker)
  // - Skip "mode" category (duplicates the modes picker from session modes)
  const configOptions = (sessionInfo.configOptions ?? []).filter(
    opt => opt.category !== 'model' && opt.category !== 'mode'
  );

  const hasControls = (showModePicker && sessionInfo.modes && sessionInfo.modes.availableModes.length >= 2) || configOptions.length > 0;
  if (!hasControls) return null;

  return (
    <div className="flex items-center gap-1">
      {showModePicker && <AcpModePicker />}
      {configOptions.map(opt => (
        <ConfigOptionPicker key={opt.id} option={opt} />
      ))}
    </div>
  );
});
