import { memo, useSyncExternalStore, useCallback, useState } from 'react';
import { ChevronUp, Lock, Shield, Brain } from 'lucide-react';
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
  getCommonModes,
  getCommonMode,
  updateCurrentMode,
  updateConfigOptionValue,
  acpAgent,
} from '@/lib/ai/acp-agent-state';
import { useConnectionsStore } from '@/stores/connections-store';
import type { AcpSessionConfigOption } from '@/lib/ai/acp-utils';

// ---------------------------------------------------------------------------
// Mode-sandbox conflict detection
// ---------------------------------------------------------------------------

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
// Context usage indicator — circular progress icon
// ---------------------------------------------------------------------------

function ContextUsageIcon({ used, size }: { used: number; size: number }) {
  const ratio = size > 0 ? Math.min(used / size, 1) : 0;
  const r = 6;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - ratio);

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      {/* Background circle */}
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      {/* Progress arc */}
      <circle
        cx="8" cy="8" r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        opacity="0.7"
      />
    </svg>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Mode Picker
// ---------------------------------------------------------------------------

export const AcpModePicker = memo(function AcpModePicker() {
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);
  const modes = sessionInfo.modes;
  const [conflictMode, setConflictMode] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);

  const applyMode = useCallback(async (modeId: string) => {
    if (!acpAgent?.instanceId || !acpAgent.chatSessionId) {
      log.warn('ai', 'Cannot set mode: no active ACP session');
      toast.error('No active session — send a message first');
      return;
    }
    try {
      updateCurrentMode(modeId);
      await tauriApi.acpSessionSetMode(acpAgent.instanceId, acpAgent.chatSessionId, modeId);
    } catch (err) {
      log.error('ai', `Failed to set mode: ${String(err)}`);
      toast.error('Failed to set mode');
    }
  }, []);

  const handleSetMode = useCallback((modeId: string, modeName: string) => {
    if (isUnrestrictedMode(modeId) && acpAgent?.connectionId && hasActiveRestrictions(acpAgent.connectionId)) {
      setConflictMode({ id: modeId, name: modeName });
      return;
    }
    applyMode(modeId);
    setOpen(false);
  }, [applyMode]);

  const handleConflictKeep = useCallback(() => {
    if (conflictMode) applyMode(conflictMode.id);
    setConflictMode(null);
    setOpen(false);
  }, [conflictMode, applyMode]);

  const handleConflictRemovePermanent = useCallback(() => {
    if (!acpAgent?.connectionId) { setConflictMode(null); return; }
    useConnectionsStore.getState().updateConnection(acpAgent.connectionId, {
      sandboxEnabled: false,
      networkSandboxEnabled: false,
      kernelNetworkDeny: false,
    });
    if (conflictMode) applyMode(conflictMode.id);
    setConflictMode(null);
    setOpen(false);
    toast.info('Security restrictions removed. Agent will respawn with new settings on next session.');
  }, [conflictMode, applyMode]);

  // Map agent modes to common modes (Agent/Plan/Chat) — hide agent-specific modes
  const commonModes = modes ? getCommonModes(modes.availableModes) : [];
  if (commonModes.length < 2) return null;

  const connectionId = acpAgent?.connectionId;
  const restricted = connectionId ? hasActiveRestrictions(connectionId) : false;
  const currentCommon = getCommonMode(modes!.currentModeId);
  const currentLabel = currentCommon ?? { name: 'Agent', tooltip: '' };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 border border-transparent hover:border-border"
                >
                  <Shield className="h-3 w-3" strokeWidth={1.5} />
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
          className="w-auto min-w-[120px] max-w-[250px] p-1"
        >
          {commonModes.map((cm) => {
            const isActive = currentCommon?.key === cm.commonKey;
            const showLock = restricted && isUnrestrictedMode(cm.agentModeId);
            return (
              <button
                key={cm.commonKey}
                className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors duration-150 ${
                  isActive
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                onClick={() => { if (!isActive) handleSetMode(cm.agentModeId, cm.name); }}
              >
                <div className="flex items-center gap-1.5">
                  <span>{cm.name}</span>
                  {showLock && <Lock className="h-3 w-3 opacity-40" />}
                </div>
                {cm.tooltip && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {cm.tooltip}
                  </div>
                )}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      {/* Mode-sandbox conflict dialog */}
      <AlertDialog open={!!conflictMode} onOpenChange={(o) => { if (!o) setConflictMode(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mode conflicts with security settings</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <span className="font-medium">{conflictMode?.name}</span> allows the agent to operate without permission checks, but this connection has security restrictions enabled that will block some operations.
              </div>
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
// Config Option Picker
// ---------------------------------------------------------------------------

const ConfigOptionPicker = memo(function ConfigOptionPicker({ option }: { option: AcpSessionConfigOption }) {
  const [open, setOpen] = useState(false);

  const handleSetValue = useCallback(async (value: string) => {
    if (!acpAgent?.instanceId || !acpAgent.chatSessionId) {
      toast.error('No active session — send a message first');
      return;
    }
    try {
      updateConfigOptionValue(option.id, value);
      await tauriApi.acpSessionSetConfigOption(acpAgent.instanceId, acpAgent.chatSessionId, option.id, value);
      setOpen(false);
    } catch (err) {
      log.error('ai', `Failed to set config option: ${String(err)}`);
      toast.error('Failed to set config option');
    }
  }, [option.id]);

  const options = option.options ?? [];
  if (options.length < 2) return null;

  const currentOption = options.find(o => (o.value ?? o.name) === option.currentValue);
  const displayName = currentOption?.name ?? option.currentValue ?? option.name;
  const capitalizedDisplay = displayName.charAt(0).toUpperCase() + displayName.slice(1);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 border border-transparent hover:border-border"
              >
                {option.category === 'thought_level' && <Brain className="h-3 w-3" strokeWidth={1.5} />}
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
// Usage Indicator — circular progress with tooltip
// ---------------------------------------------------------------------------

const UsageIndicator = memo(function UsageIndicator() {
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);
  const usage = sessionInfo.usage;
  if (!usage || (usage.contextUsed === 0 && usage.contextSize === 0)) return null;

  const label = usage.contextSize > 0
    ? `${formatTokenCount(usage.contextUsed)} / ${formatTokenCount(usage.contextSize)}`
    : formatTokenCount(usage.contextUsed);

  const costText = usage.cost
    ? `${usage.cost.currency === 'USD' ? '$' : usage.cost.currency + ' '}${usage.cost.amount.toFixed(2)}`
    : undefined;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center text-muted-foreground/50 cursor-default">
            <ContextUsageIcon used={usage.contextUsed} size={usage.contextSize} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>{label}</p>
          {costText && <p className="text-muted-foreground">{costText}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

// ---------------------------------------------------------------------------
// Combined controls
// ---------------------------------------------------------------------------

export const AcpSessionControls = memo(function AcpSessionControls({ showModePicker }: { showModePicker: boolean }) {
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);

  const configOptions = (sessionInfo.configOptions ?? []).filter(
    opt => opt.category !== 'model' && opt.category !== 'mode'
  );

  const hasControls = (showModePicker && sessionInfo.modes && sessionInfo.modes.availableModes.length >= 2)
    || configOptions.length > 0
    || sessionInfo.usage;
  if (!hasControls) return null;

  return (
    <div className="flex items-center gap-1">
      {showModePicker && <AcpModePicker />}
      {configOptions.map(opt => (
        <ConfigOptionPicker key={opt.id} option={opt} />
      ))}
      <UsageIndicator />
    </div>
  );
});
