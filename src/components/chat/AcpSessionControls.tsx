import { memo, useSyncExternalStore, useCallback } from 'react';
import { ChevronUp } from 'lucide-react';
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
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import {
  getSessionInfo,
  subscribeSessionInfo,
  getModeLabel,
  acpAgent,
} from '@/lib/ai/acp-agent-state';
import type { AcpSessionConfigOption } from '@/lib/ai/acp-utils';

// ---------------------------------------------------------------------------
// Mode Picker — compact chip for switching agent modes
// ---------------------------------------------------------------------------

export const AcpModePicker = memo(function AcpModePicker() {
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);
  const modes = sessionInfo.modes;

  const handleSetMode = useCallback(async (modeId: string) => {
    if (!acpAgent?.instanceId || !acpAgent.chatSessionId) return;
    try {
      await tauriApi.acpSessionSetMode(acpAgent.instanceId, acpAgent.chatSessionId, modeId);
    } catch (err) {
      log.error('ai', `Failed to set mode: ${String(err)}`);
      toast.error('Failed to set mode');
    }
  }, []);

  if (!modes || modes.availableModes.length < 2) return null;

  const agentBinary = acpAgent?.agentBinary;
  const currentMode = modes.availableModes.find(m => m.id === modes.currentModeId);
  const currentLabel = currentMode
    ? getModeLabel(agentBinary, currentMode.id, currentMode.name)
    : { name: modes.currentModeId, tooltip: '' };

  return (
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
        className="w-auto min-w-[140px] p-1"
      >
        {modes.availableModes.map((mode) => {
          const label = getModeLabel(agentBinary, mode.id, mode.name);
          const isActive = mode.id === modes.currentModeId;
          return (
            <button
              key={mode.id}
              className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors duration-150 ${
                isActive
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              onClick={() => { if (!isActive) handleSetMode(mode.id); }}
            >
              <div>{label.name}</div>
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
  );
});

// ---------------------------------------------------------------------------
// Config Option Picker — dropdowns for agent config options
// ---------------------------------------------------------------------------

const ConfigOptionPicker = memo(function ConfigOptionPicker({ option }: { option: AcpSessionConfigOption }) {
  const handleSetValue = useCallback(async (valueId: string) => {
    if (!acpAgent?.instanceId || !acpAgent.chatSessionId) return;
    try {
      await tauriApi.acpSessionSetConfigOption(acpAgent.instanceId, acpAgent.chatSessionId, option.id, valueId);
    } catch (err) {
      log.error('ai', `Failed to set config option: ${String(err)}`);
      toast.error('Failed to set config option');
    }
  }, [option.id]);

  const options = option.options ?? [];
  if (options.length < 2) return null;

  const currentOption = options.find(o => o.id === option.currentValue);
  const displayName = currentOption?.name ?? option.currentValue ?? option.name;

  return (
    <Popover>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 border border-transparent hover:border-border"
              >
                {displayName}
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
        className="w-auto min-w-[140px] p-1"
      >
        <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {option.name}
        </div>
        {options.map((opt) => {
          const isActive = opt.id === option.currentValue;
          return (
            <button
              key={opt.id}
              className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors duration-150 ${
                isActive
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              onClick={() => { if (!isActive) handleSetValue(opt.id); }}
            >
              {opt.name}
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

  // Filter config options: skip "model" category (handled by model picker)
  const configOptions = (sessionInfo.configOptions ?? []).filter(
    opt => opt.category !== 'model'
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
