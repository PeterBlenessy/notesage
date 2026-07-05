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
  getCommonMode,
  getAgentModeDisplay,
  resolveConfiguredModeId,
  updateCurrentMode,
  updateConfigOptionValue,
  getAcpAgent,
  isLocalAgentPreset,
} from '@/lib/ai/acp-agent-state';
import { useConnectionsStore } from '@/stores/connections-store';
import { useChatStore } from '@/stores/chat-store';
import { useUsageStore } from '@/stores/usage-store';
import { useEstimatedContextUsage, type EstimatedContextUsage } from '@/hooks/useEstimatedContextUsage';
import { UsagePopover } from '@/components/chat/UsagePopover';
import type { AcpSessionConfigOption } from '@/lib/ai/acp-utils';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Mode-sandbox conflict detection
// ---------------------------------------------------------------------------

/**
 * Check if a mode grants unrestricted/no-prompt access (conflicts with sandbox).
 * For the Local Agent preset (Goose) that's the `auto` mode; Goose's ids aren't
 * in the cross-agent common-mode map, so it's classified directly here. For
 * every other agent it's whatever maps to the "Full Access" common mode.
 */
function isUnrestrictedMode(connection: Connection, modeId: string): boolean {
  if (isLocalAgentPreset(connection)) return modeId === 'auto';
  return getCommonMode(modeId)?.key === 'full_access';
}

function hasActiveRestrictions(connectionId: string): boolean {
  const conn = useConnectionsStore.getState().connections.find(c => c.id === connectionId);
  if (!conn) return false;
  return !!(conn.sandboxEnabled || conn.networkSandboxEnabled || conn.kernelNetworkDeny);
}

// ---------------------------------------------------------------------------
// Mode Picker
// ---------------------------------------------------------------------------

export const AcpModePicker = memo(function AcpModePicker({ connection }: { connection: Connection }) {
  // Available modes come from the connection's capability probe (persisted at
  // registration, refreshed ≥24h later). The live session's `modes` field is
  // used only to determine the currently-selected value for highlighting.
  // This lets the picker populate instantly on agent switch, without waiting
  // for session/new to complete.
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);
  // Conversation-scoped remembered mode — drives the label during the brief window
  // after a respawn before `useAcpLifecycle` re-applies it to the live session.
  const conversationModeId = useChatStore((s) =>
    s.conversations.find((c) => c.id === s.activeConversationId)?.agentModeId
  );
  const availableModes = connection.acpCapabilities?.availableModes ?? [];
  const [conflictMode, setConflictMode] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);

  const applyMode = useCallback(async (modeId: string) => {
    const acpAgent = getAcpAgent(useChatStore.getState().activeConversationId ?? undefined);
    if (!acpAgent?.instanceId || !acpAgent.chatSessionId) {
      log.warn('ai', 'Cannot set mode: no active ACP session');
      toast.error('No active session — send a message first');
      return;
    }
    try {
      updateCurrentMode(modeId);
      // Persist the pick on the conversation so it survives agent respawns (a sandbox
      // scope change spawns a fresh session that otherwise resets to the agent default).
      useChatStore.getState().setConversationMode(modeId);
      await tauriApi.acpSessionSetMode(acpAgent.instanceId, acpAgent.chatSessionId, modeId);
    } catch (err) {
      log.error('ai', `Failed to set mode: ${String(err)}`);
      toast.error('Failed to set mode');
    }
  }, []);

  const handleSetMode = useCallback((modeId: string, modeName: string) => {
    const acpAgent = getAcpAgent(useChatStore.getState().activeConversationId ?? undefined);
    if (isUnrestrictedMode(connection, modeId) && acpAgent?.connectionId && hasActiveRestrictions(acpAgent.connectionId)) {
      setConflictMode({ id: modeId, name: modeName });
      return;
    }
    applyMode(modeId);
    setOpen(false);
  }, [applyMode, connection]);

  const handleConflictKeep = useCallback(() => {
    if (conflictMode) applyMode(conflictMode.id);
    setConflictMode(null);
    setOpen(false);
  }, [conflictMode, applyMode]);

  const handleConflictRemovePermanent = useCallback(() => {
    const acpAgent = getAcpAgent(useChatStore.getState().activeConversationId ?? undefined);
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

  // Render every mode the agent advertises, each with a friendly display label
  // (getAgentModeDisplay). This previously collapsed modes into four fixed common
  // buckets (Read Only / Agent / Full Access / Plan) and dropped anything that
  // didn't map — which hid the picker entirely for agents whose ids aren't in
  // the common map, e.g. the Local Agent preset (Goose: auto/approve/
  // smart_approve/chat, only `auto` mapped → 1 mode → hidden).
  //
  // The picker's ONLY visibility gate is the user's `showAgentModePicker`
  // toggle (applied by the caller via `showModePicker`). It is never hidden for
  // having "too few" modes — the lone `=== 0` guard is just defensive (an empty
  // dropdown has literally nothing to render; no real ACP agent reports 0 modes).
  if (availableModes.length === 0) return null;

  const restricted = hasActiveRestrictions(connection.id);
  const displayFor = (mode: { id: string; name: string; description?: string }) =>
    getAgentModeDisplay(connection, mode.id, mode.name, mode.description);
  // Currently-selected mode resolution, preferring most-recent truth:
  //   1. Live session (if a session is currently active for this agent)
  //   2. User-configured default on the connection (acpDefaults.modeId)
  //   3. First advertised mode (so the picker has something selected)
  // Note: when the user switches connections, sessionInfo is cleared by
  // ensureAcpAgent → clearSessionInfo, so (1) won't bleed across agents.
  const currentModeId =
    sessionInfo.modes?.currentModeId
    ?? resolveConfiguredModeId(conversationModeId, connection)
    ?? availableModes[0]?.id
    ?? null;
  const currentMode = availableModes.find((m) => m.id === currentModeId) ?? availableModes[0];
  const currentLabel = currentMode
    ? { name: displayFor(currentMode).name, tooltip: displayFor(currentMode).description ?? '' }
    : { name: 'Agent', tooltip: '' };

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
            value={currentModeId ?? ''}
            onValueChange={(value) => {
              if (value && value !== currentModeId) {
                const next = availableModes.find((m) => m.id === value);
                if (next) handleSetMode(next.id, displayFor(next).name);
              }
            }}
          >
            {availableModes.map((mode) => {
              const display = displayFor(mode);
              const showLock = restricted && isUnrestrictedMode(connection, mode.id);
              return (
                <PickerItem
                  key={mode.id}
                  value={mode.id}
                  label={display.name}
                  description={display.description || undefined}
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
 * Short abbreviation for the command-bar trigger when space matters (e.g.
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
    const acpAgent = getAcpAgent(useChatStore.getState().activeConversationId ?? undefined);
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
  // icon — keeps the command bar compact since reasoning effort is a scalar value
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
// Usage Indicator — data assembly for the usage pill + popover
// ---------------------------------------------------------------------------

const UsageIndicator = memo(function UsageIndicator({
  connectionId,
  estimate,
}: {
  connectionId: string;
  /** Locally-estimated fallback for non-ACP connections (provider-usage-display #8). */
  estimate?: EstimatedContextUsage;
}) {
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);
  // Freshness timestamp for the popover's provenance footer.
  const snapshot = useUsageStore((s) => s.snapshots[connectionId]);
  const usage = sessionInfo.usage;
  const hasAcpUsage = !!usage && !(usage.contextUsed === 0 && usage.contextSize === 0);

  // Exact ACP usage wins; the estimate is the fallback for connections that
  // report nothing. Neither source → hidden (current behavior, no invented ring).
  const source = hasAcpUsage && usage
    ? { contextUsed: usage.contextUsed, contextSize: usage.contextSize, isEstimated: false }
    : estimate
      ? { contextUsed: estimate.contextUsed, contextSize: estimate.contextSize, isEstimated: true }
      : null;
  if (!source) return null;

  return (
    <UsagePopover
      data={{
        ...source,
        cost: hasAcpUsage ? usage.cost : undefined,
        rateLimit: hasAcpUsage ? usage.rateLimit : undefined,
        lastTurnUsage: hasAcpUsage ? sessionInfo.lastTurnUsage : undefined,
        updatedAt: snapshot?.updatedAt,
      }}
    />
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

  // Estimated context for connections that never report ACP usage (direct API,
  // local) — provider-usage-display #8. The hook self-gates: it returns
  // undefined for ACP/unknown-size connections (no-denominator rule) and only
  // recomputes at message boundaries, so mounting it unconditionally is cheap.
  const activeConversation = useChatStore((s) => {
    const id = s.activeConversationId;
    return id ? s.conversations.find((c) => c.id === id) ?? null : null;
  });
  // System prompt is intentionally NOT threaded in: building it here would
  // couple this render path to useAIContext and add re-render churn for a
  // marginal accuracy gain. The estimate undershoots by the system-prompt size
  // as a result — acceptable because the "≈" prefix already flags the value as
  // approximate. Thread it through later if the undershoot proves material.
  const estimate = useEstimatedContextUsage(activeConversation, connection ?? null);

  if (!connection) return null;

  // Available modes + config options come from the connection's probed
  // capabilities (captured at registration, refreshed ≥24h later) — not from
  // the live session response. This gives the picker instant response on agent
  // switch, with no wait for session/new. `category` filter excludes mode/model
  // which have dedicated pickers (mode picker above, model picker elsewhere).
  const capabilities = connection.acpCapabilities;
  const availableModes = capabilities?.availableModes ?? [];
  // For the Local Agent preset (Goose), the provider + model are fixed by the
  // env config we generate in `local_agent.rs` (pointed at the bundled
  // llama-server). Goose's own provider/model selector would let the user
  // switch away from the bundled server and break the local-only setup — the
  // model is changed through Notesage's Local AI settings instead — so we
  // intentionally hide the agent-reported config-option pickers here. The mode
  // picker stays gated by `showModePicker` (untouched).
  const configOptions = isLocalAgentPreset(connection)
    ? []
    : (capabilities?.configOptions ?? []).filter(
        opt => opt.category !== 'model' && opt.category !== 'mode'
      );

  // Build a lookup of live current values from sessionInfo — used by each
  // config picker to highlight the currently-selected entry. Falls back to the
  // probe-time currentValue when no session is live for this connection.
  const liveCurrentValues = new Map<string, string | undefined>();
  for (const opt of sessionInfo.configOptions ?? []) {
    liveCurrentValues.set(opt.id, opt.currentValue);
  }

  const hasControls = (showModePicker && availableModes.length > 0)
    || configOptions.length > 0
    || sessionInfo.usage
    || estimate;
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
      <UsageIndicator connectionId={connection.id} estimate={estimate} />
    </div>
  );
});
