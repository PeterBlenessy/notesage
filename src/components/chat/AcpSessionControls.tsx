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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PickerItem } from '@/components/ui/picker-item';
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
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Mode-sandbox conflict detection
// ---------------------------------------------------------------------------

/** Check if a mode maps to the "Full Access" common mode (conflicts with sandbox) */
function isUnrestrictedMode(modeId: string): boolean {
  const common = getCommonMode(modeId);
  return common?.key === 'full_access';
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
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      {/* Progress arc */}
      <circle
        cx="8" cy="8" r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
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

export const AcpModePicker = memo(function AcpModePicker({ connection }: { connection: Connection }) {
  // Available modes come from the connection's capability probe (persisted at
  // registration, refreshed ≥24h later). The live session's `modes` field is
  // used only to determine the currently-selected value for highlighting.
  // This lets the footer populate instantly on agent switch, without waiting
  // for session/new to complete.
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);
  const availableModes = connection.acpCapabilities?.availableModes ?? [];
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
  const commonModes = getCommonModes(availableModes);
  if (commonModes.length < 2) return null;

  const restricted = hasActiveRestrictions(connection.id);
  // Currently-selected mode resolution, preferring most-recent truth:
  //   1. Live session (if a session is currently active for this agent)
  //   2. User-configured default on the connection (acpDefaults.modeId)
  //   3. First mapped common mode (so the picker has something selected)
  // Note: when the user switches connections, sessionInfo is cleared by
  // ensureAcpAgent → clearSessionInfo, so (1) won't bleed across agents.
  const currentModeId =
    sessionInfo.modes?.currentModeId
    ?? connection.acpDefaults?.modeId
    ?? commonModes[0]?.agentModeId
    ?? null;
  const currentCommon = currentModeId ? getCommonMode(currentModeId) : null;
  const currentLabel = currentCommon ?? { name: commonModes[0]?.name ?? 'Agent', tooltip: '' };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 border border-transparent hover:border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Shield className="h-4 w-4" strokeWidth={1.5} />
                  {currentLabel.name}
                  <ChevronUp className="h-3 w-3 opacity-50" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {currentLabel.tooltip && (
              <TooltipContent side="top" className="text-xs max-w-[200px]">
                {currentLabel.tooltip}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-auto min-w-[120px] max-w-[250px] p-1"
        >
          <DropdownMenuRadioGroup
            value={currentCommon?.key ?? ''}
            onValueChange={(value) => {
              const next = commonModes.find((cm) => cm.commonKey === value);
              if (next && next.commonKey !== currentCommon?.key) {
                handleSetMode(next.agentModeId, next.name);
              }
            }}
          >
            {commonModes.map((cm) => {
              const showLock = restricted && isUnrestrictedMode(cm.agentModeId);
              return (
                <PickerItem
                  key={cm.commonKey}
                  value={cm.commonKey}
                  label={cm.name}
                  description={cm.tooltip || undefined}
                  trailing={showLock ? <Lock className="h-3 w-3 opacity-40" /> : undefined}
                />
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

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

/**
 * Pretty-format a config option value name for display.
 *
 * Agents frequently send the raw value string as the name (e.g.
 * `{value: "medium", name: "medium"}`), producing an all-lowercase label that
 * looks like an internal key rather than a human label in the dropdown.
 * This helper expands known short-codes and capitalizes the rest.
 *
 * Known expansions mapped to proper Title Case (covers the common cases we
 * ship today; unknown values fall through to "capitalize first letter").
 */
const PRETTY_NAME_MAP: Record<string, string> = {
  // Reasoning effort (Codex, Copilot, Claude subset)
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
};

function prettifyOptionName(name: string): string {
  const key = name.toLowerCase();
  if (PRETTY_NAME_MAP[key]) return PRETTY_NAME_MAP[key];
  // Fallback: capitalize first letter, leave the rest as the agent sent it.
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Short abbreviation for the footer trigger when space matters (e.g.
 * thought_level, which typically has 4–5 values and appears alongside other
 * compact widgets). The Brain icon gives the category context, so a single
 * letter is enough for most users.
 */
const THOUGHT_LEVEL_ABBREV: Record<string, string> = {
  minimal: 'Min',
  low: 'L',
  medium: 'M',
  high: 'H',
  xhigh: 'X',
};

/**
 * `option` carries the static capability data (id/name/description/options list)
 * discovered at probe time. `liveCurrentValue` comes from sessionInfo when a
 * session is active, overriding the probe-time currentValue so changes made
 * mid-conversation are reflected immediately. When no session is live the
 * picker falls back to the probe-time currentValue (initial default).
 */
const ConfigOptionPicker = memo(function ConfigOptionPicker({
  option,
  liveCurrentValue,
}: {
  option: AcpSessionConfigOption;
  liveCurrentValue?: string;
}) {
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

  const currentValue = liveCurrentValue ?? option.currentValue;
  const currentOption = options.find(o => (o.value ?? o.name) === currentValue);
  const rawDisplayName = currentOption?.name ?? currentValue ?? option.name;
  // thought_level uses a 1-char abbreviation (Min/L/M/H/X) alongside the Brain
  // icon — keeps the footer compact since reasoning effort is a scalar value
  // most users scan rather than read. Other categories show the prettified
  // Title Case name directly.
  const triggerLabel = option.category === 'thought_level'
    ? (THOUGHT_LEVEL_ABBREV[rawDisplayName.toLowerCase()] ?? prettifyOptionName(rawDisplayName))
    : prettifyOptionName(rawDisplayName);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 border border-transparent hover:border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {option.category === 'thought_level' && <Brain className="h-4 w-4" strokeWidth={1.5} />}
                {triggerLabel}
                <ChevronUp className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          {option.description && (
            <TooltipContent side="top" className="text-xs max-w-[200px]">
              {option.description}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-auto min-w-[140px] max-w-[300px] p-1"
      >
        <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {option.name}
        </div>
        <DropdownMenuRadioGroup
          value={currentValue ?? ''}
          onValueChange={(value) => {
            if (value !== currentValue) handleSetValue(value);
          }}
        >
          {options.map((opt) => {
            const optValue = opt.value ?? opt.name;
            return (
              <PickerItem
                key={optValue}
                value={optValue}
                label={prettifyOptionName(opt.name)}
                description={opt.description}
              />
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

  // Bordered pill to match the other footer buttons. Just the icon at rest —
  // the token count (and optional cost) live in the tooltip, which gives the
  // same affordance without consuming horizontal space.
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center h-7 px-2 rounded-md text-muted-foreground/60 transition-colors duration-150 border border-transparent hover:text-foreground hover:bg-muted hover:border-border cursor-default">
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

export const AcpSessionControls = memo(function AcpSessionControls({
  showModePicker,
  connection,
}: {
  showModePicker: boolean;
  connection?: Connection;
}) {
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);

  if (!connection) return null;

  // Available modes + config options come from the connection's probed
  // capabilities (captured at registration, refreshed ≥24h later) — not from
  // the live session response. This gives the footer instant response on agent
  // switch, with no wait for session/new. `category` filter excludes mode/model
  // which have dedicated pickers (mode picker above, model picker elsewhere).
  const capabilities = connection.acpCapabilities;
  const availableModes = capabilities?.availableModes ?? [];
  const configOptions = (capabilities?.configOptions ?? []).filter(
    opt => opt.category !== 'model' && opt.category !== 'mode'
  );

  // Build a lookup of live current values from sessionInfo — used by each
  // config picker to highlight the currently-selected entry. Falls back to the
  // probe-time currentValue when no session is live for this connection.
  const liveCurrentValues = new Map<string, string | undefined>();
  for (const opt of sessionInfo.configOptions ?? []) {
    liveCurrentValues.set(opt.id, opt.currentValue);
  }

  const hasControls = (showModePicker && availableModes.length >= 2)
    || configOptions.length > 0
    || sessionInfo.usage;
  if (!hasControls) return null;

  return (
    <div className="flex items-center gap-1">
      {showModePicker && <AcpModePicker connection={connection} />}
      {configOptions.map(opt => (
        <ConfigOptionPicker
          key={opt.id}
          option={opt as AcpSessionConfigOption}
          liveCurrentValue={liveCurrentValues.get(opt.id)}
        />
      ))}
      <UsageIndicator />
    </div>
  );
});
