import { useMemo, useState } from "react";
import { Clock, MessageSquare, Pin, PinOff, Plus, Target, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { track } from "@/lib/telemetry";
import { useConnectionsStore } from "@/stores/connections-store";
import { useRoutingStore } from "@/stores/routing-store";
import { useChatStore, selectProjectPaths } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useGoalsDiscovery } from "@/hooks/useGoalsDiscovery";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExplainLockDialog } from "@/components/chat/ExplainLockDialog";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { AcpSessionControls } from "@/components/chat/AcpSessionControls";
import {
  describeLockTarget,
  getProjectLock,
} from "@/lib/ai/project-lock";
import type { Connection } from "@/lib/ai/connections";
import type { Conversation } from "@/stores/chat-store";
import type { WorkspaceProject } from "@/stores/workspace-store";
import type { ProjectMetadata } from "@/stores/project-metadata-store";
import { Divider, IconButton } from "./context/shared";
import { ProviderPill } from "./context/ProviderPill";
import { ProjectsPicker } from "./context/ProjectsPicker";
import { ProviderQuickConfig } from "./context/ProviderQuickConfig";
import { CrossProjectScopePill } from "./context/CrossProjectScopePill";

/**
 * CommandBarContext — the expanded-state context row that sits above the
 * input inside `FloatingCommandBar`. Renders, in a single horizontal line:
 *
 *   - Provider pill (active interactive connection) — wired in #24
 *   - Project chips (one per path on the active conversation; lock icon
 *     when the project carries an `aiLock`)
 *   - Dashed `+ project` button
 *   - Mode pill (Read Only / Agent / Full Access / Plan — defaults to Agent)
 *   - Clock icon → opens history (forward-declared, #27)
 *   - Pin icon  → toggles pinned mode
 *
 * Wiring lives in #24 (provider switch — done), #25 (project chips — done),
 * #26 (mode picker — done), #27 (history). Pin (#28) is wired.
 *
 * The row reads everything from stores; it accepts only an optional
 * `className` so the parent can override layout (e.g. add a top divider).
 */

export interface CommandBarContextProps {
  /** Caller-supplied utility classes appended after the defaults. */
  className?: string;
  /**
   * Current chatView from `FloatingCommandBar`. Drives the trailing
   * history-toggle icon: `Clock` when "chat" (the user can switch INTO
   * history), `MessageSquare` when "history" (the user can switch BACK
   * to chat). Live-test 2026-04-25 #158 — without this, both directions
   * showed the same clock icon and the toggle direction wasn't clear.
   */
  chatView?: "chat" | "history";
}

function CommandBarContext({ className, chatView = "chat" }: CommandBarContextProps) {
  // Active interactive connection (the provider pill).
  const interactiveConnection = useRoutingStore((s) =>
    s.getConnectionForUseCase("interactive"),
  ) as Connection | null;
  const setRouting = useRoutingStore((s) => s.setRouting);

  // All registered connections — the dropdown lists those with the
  // `interactive` capability. Reads from connections-store so the
  // store action drives the AgentSwitchCard flow via the bar's
  // `effectiveConnection?.id` effect (no duplicate logic).
  const allConnections = useConnectionsStore((s) => s.connections);
  const interactiveConnections = useMemo(
    () => allConnections.filter((c) => c.capabilities.includes("interactive")),
    [allConnections],
  );

  // Lock-aware effective connection (live-test 2026-04-26 audit gap
  // #2 / #8) — a locked project pins the provider pill to the locked
  // connection and disables the picker. Multiple locks resolving to
  // ONE id is treated as locked; a mixed-locks case is impossible
  // here because `handleAddProject` refuses to add a project with a
  // different lock.

  // Current conversation (project chips). Read defensively — there may be
  // no conversation yet when the bar is first opened.
  const activeConversation = useChatStore((s) => {
    const id = s.activeConversationId;
    if (!id) return null;
    return (s.conversations as Conversation[]).find((c) => c.id === id) ?? null;
  });

  const projectPaths = activeConversation?.projectPaths ?? [];

  // (continued from above) — derive lock state from selected project
  // paths once we have them in scope.

  // Per-project metadata — used to surface the lock icon when `aiLock` is set.
  const metadataMap = useProjectMetadataStore(
    (s) => s.metadataMap,
  ) as Record<string, ProjectMetadata>;

  // Locked-provider derivation. When any selected project carries an
  // `aiLock`, the provider pill is pinned to that connection and the
  // picker dropdown is disabled — clicking opens the explain-lock
  // dialog instead.
  const lockedConnectionId = useMemo(() => {
    const ids = projectPaths
      .map((p) => metadataMap[p]?.aiLock?.connectionId)
      .filter((id): id is string => Boolean(id));
    return ids.length === 1 ? ids[0] : null;
  }, [projectPaths, metadataMap]);
  const lockedConnection = useMemo(
    () =>
      lockedConnectionId
        ? allConnections.find((c) => c.id === lockedConnectionId) ?? null
        : null,
    [lockedConnectionId, allConnections],
  );
  const isProviderLocked = Boolean(lockedConnectionId);
  const effectiveConnection = lockedConnection ?? interactiveConnection;

  // Workspace projects — used to populate the "+ project" popover with paths
  // not already in scope (#25).
  const workspaceProjects = useWorkspaceStore(
    (s) => s.projects,
  ) as WorkspaceProject[];

  // Chat-store actions for project chip add/remove (#25). Reuse the same
  // `toggleProjectPath` drives the surrounding
  // `selectPendingProjectSwitch` flow.
  const toggleProjectPath = useChatStore((s) => s.toggleProjectPath);

  // "New chat" action. `createConversation()` creates a fresh
  // conversation and atomically promotes it to the active conversation,
  // so the bar's existing selectors (active conversation, segments,
  // etc.) refresh
  // without any extra wiring. Live-test 2026-04-26 — the cmd bar had
  // no UI affordance to start a new chat from its chrome.
  const createConversation = useChatStore((s) => s.createConversation);

  // Pinned-mode toggle state (#28). Wired to `settings-store.cmdBarPinned`.
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);
  const setCmdBarPinned = useSettingsStore((s) => s.setCmdBarPinned);

  // Cross-project mode warning pill (#73). Replaces the deleted legacy banner
  // above the chat input with a compact indicator on the context row — the
  // pill is only rendered when the opt-in is active (default off). Clicking
  // the pill opens Settings > Advanced (the "developer" tab) so the user can
  // toggle the mode off in one jump.
  const crossProjectMode = useSettingsStore((s) => s.crossProjectMode);

  // #125 — The mode picker is gated on `showAgentModePicker` (Settings
  // > Advanced toggle). Goals discovery runs for the single-project
  // case; the pill surfaces the count as "N goals" so users know what's
  // being injected as AI context.
  const showAgentModePicker = useSettingsStore((s) => s.showAgentModePicker);
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const singleProjectPath =
    selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);

  // Locked-paths derived view drives the explain-lock dialog when the user
  // clicks a chip's lock icon. The dialog accepts an array (multiple chips
  // can each be locked); we only ever surface the clicked one.
  const [explainLockPaths, setExplainLockPaths] = useState<string[]>([]);

  // Existing locked connection ids in the current chat scope. Used to gate
  // additions: a project carrying a different `aiLock`, or any unlocked
  // project added on top of a locked-only selection, is rejected.
  const existingLockedConnectionIds = projectPaths
    .map((p) => getProjectLock(p, metadataMap)?.connectionId)
    .filter((id): id is string => Boolean(id));

  const handleAddProject = (path: string) => {
    const newLock = getProjectLock(path, metadataMap);
    const lockedSet = new Set(existingLockedConnectionIds);

    if (newLock && lockedSet.size > 0 && !lockedSet.has(newLock.connectionId)) {
      toast.error(
        "These projects are locked to different providers.",
        { id: "provider-lock-conflict" },
      );
      return;
    }

    if (!newLock && lockedSet.size > 0) {
      const lockedId = Array.from(lockedSet)[0];
      const lockedConn = allConnections.find((c) => c.id === lockedId);
      toast.error(
        `Current selection is locked to ${describeLockTarget(lockedId, lockedConn?.label)}. Unlock or deselect first.`,
        { id: "provider-lock-conflict" },
      );
      return;
    }

    toggleProjectPath(path);
  };

  return (
    <div
      data-cmd-context
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 border-b border-border",
        "text-xs text-muted-foreground",
        // Root is NOT scrollable: the chip group below owns overflow so the
        // trailing pickers/icons (mode pill, history, pin) stay pinned to the
        // right edge no matter how many project chips are selected. Without
        // this, flex children default to `min-width: auto` and push trailing
        // siblings off-screen when the conversation has >2 projects.
        "overflow-hidden",
        className,
      )}
    >
      {/* Provider pill ----------------------------------------------------- */}
      <ProviderPill
        connection={effectiveConnection}
        connections={interactiveConnections}
        locked={isProviderLocked}
        lockedConnection={lockedConnection}
        lockedProjectPaths={
          isProviderLocked
            ? projectPaths.filter((p) => metadataMap[p]?.aiLock)
            : []
        }
        onExplainLock={(paths) => setExplainLockPaths(paths)}
        onPick={(id) => {
          // Ignore re-picking the active connection — the change-detect
          // effect relies on `prev !== curr` to fire the AgentSwitchCard
          // prompt. Calling setRouting unconditionally would
          // spuriously bump the routing-store's reference identity.
          if (id === effectiveConnection?.id) return;
          setRouting("interactive", id);
        }}
      />

      {/* Provider quick-config gear (live-test 2026-04-26 #53) — opens
          a popover with provider-specific settings (currently model
          picker; future config knobs go here). Keeps the row clean
          vs. a separate ModelPill chip. Hidden when the provider is
          locked — config edits would conflict with the per-project
          lock and should be made via Settings > Projects instead. */}
      {effectiveConnection && !isProviderLocked ? (
        <ProviderQuickConfig connection={effectiveConnection} />
      ) : null}

      <Divider />

      {/* Projects picker (live-test 2026-04-26) — single multiselect
          button. Trigger shows the count + label, popover lists every
          workspace project with a checkmark for selected ones. Far more
          readable than a chip-per-project row when 3+ projects are in
          scope. */}
      <ProjectsPicker
        projectPaths={projectPaths}
        workspaceProjects={workspaceProjects}
        metadataMap={metadataMap}
        onToggle={handleAddProject}
        onRemove={(path) => toggleProjectPath(path)}
        onExplainLock={(path) => setExplainLockPaths([path])}
      />

      {/* Explain-lock dialog (rendered once, controlled by chip click) ---- */}
      <ExplainLockDialog
        open={explainLockPaths.length > 0}
        onOpenChange={(open) => {
          if (!open) setExplainLockPaths([]);
        }}
        lockedProjectPaths={explainLockPaths}
      />

      <Divider />

      {/* Mode pill --------------------------------------------------------- */}
      {/*
       * #26 — The command-bar mode picker (`AcpModePicker`). The picker:
       *   - Reads available modes from `connection.acpCapabilities.availableModes`
       *     (probed at registration) and renders every mode the agent advertises
       *     with a friendly label (`getAgentModeDisplay`); it hides itself only
       *     when fewer than 2 modes are available — which is the case for every
       *     non-ACP provider (no `acpCapabilities` set).
       *   - Dispatches mode changes through `updateCurrentMode` +
       *     `tauriApi.acpSessionSetMode` so the active ACP session stays
       *     in sync.
       *   - Owns the mode-sandbox conflict `AlertDialog` (Full Access vs
       *     active sandbox restrictions). We get that for free by reusing it.
       *
       * The picker is only rendered when there's an interactive ACP-capable
       * connection; otherwise the pill is suppressed entirely (no "Direct API"
       * placeholder — the previous "Agent" stub was a #10 scaffold, not a
       * permanent affordance).
       */}
      {interactiveConnection ? (
        // `shrink-0` is a regression-lock on the overflow fix: the chip
        // group (above) owns the shrink budget; every trailing flex item —
        // mode picker, config pickers, usage indicator, goals pill,
        // warning pill, history, pin — must stay at its intrinsic width no
        // matter how many project chips are in scope.
        //
        // `AcpSessionControls` bundles the mode picker (gated by
        // `showAgentModePicker` per #125), the config option pickers
        // (thinking effort + any other agent-reported options), and the
        // usage indicator in a single component.
        <div className="shrink-0">
          <AcpSessionControls
            showModePicker={showAgentModePicker}
            connection={interactiveConnection}
          />
        </div>
      ) : null}

      {/* Goals indicator (#125) — "N goals" pill. Only surfaces when
       *  the selection resolves to a single project that has goal
       *  files; multi-project or zero-project selections don't carry
       *  an unambiguous goal context.
       */}
      {goalFiles.length > 0 ? (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 items-center gap-0.5 px-1 py-px rounded text-[10px] font-medium text-[oklch(100%_0_0)] bg-[var(--color-accent-primary)]">
                <Target className="h-2.5 w-2.5" />
                {goalFiles.length}{" "}
                {goalFiles.length === 1 ? "goal" : "goals"}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64">
              <p className="text-xs">
                {goalFiles.length} project{" "}
                {goalFiles.length === 1 ? "goal is" : "goals are"} included
                as AI context
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}

      {/* Spacer pushes the warning pill + trailing icons to the right. */}
      <div className="flex-1 min-w-2" aria-hidden />

      {/* Cross-project scope warning pill (#73) */}
      {crossProjectMode ? <CrossProjectScopePill /> : null}

      {/* Trailing icons ---------------------------------------------------- */}
      {/* New chat button — sits LEFT of the history toggle.
          `createConversation()` atomically creates and activates a fresh
          conversation; if the current conversation already has zero
          messages, clicking is a no-op so we don't churn through empty
          conversations. When the
          bar is in history view, also flip back to chat view via the
          existing `toggle-history` bus event so the user lands in the
          fresh conversation's empty stream (not the history list). */}
      <IconButton
        ariaLabel="Start a new chat"
        icon={Plus}
        onClick={() => {
          const isAlreadyEmpty =
            activeConversation && activeConversation.messages.length === 0;
          if (isAlreadyEmpty) {
            // Already on a blank slate — flip to chat view if needed and
            // bail; no point spawning another empty conversation.
            if (chatView === "history") {
              emitCmdBarEvent({ type: "toggle-history" });
            }
            return;
          }
          createConversation();
          if (chatView === "history") {
            emitCmdBarEvent({ type: "toggle-history" });
          }
        }}
      />
      <IconButton
        ariaLabel={chatView === "history" ? "Back to chat" : "Open history"}
        // Live-test 2026-04-25 #158 — Clock when the user can switch
        // INTO history; MessageSquare (chat bubble) when they're
        // already in history and the click would take them BACK. The
        // direction-explicit icon makes the toggle's behaviour
        // self-evident; the previous always-Clock made it ambiguous.
        icon={chatView === "history" ? MessageSquare : Clock}
        onClick={() => {
          // #118 — fire a bus event; FloatingCommandBar subscribes and
          // flips its chatView between 'chat' and 'history'. Keeping
          // the toggle state in the bar (not here) means `⌘⇧H` from
          // the global shortcut hook can drive the same flip without
          // needing this component on screen.
          emitCmdBarEvent({ type: "toggle-history" });
        }}
      />
      <IconButton
        ariaLabel={
          cmdBarPinned
            ? "Return chat to floating bar"
            : "Pin chat to side panel"
        }
        icon={cmdBarPinned ? PinOff : Pin}
        onClick={() => {
          setCmdBarPinned(!cmdBarPinned);
          track("feature_used", { feature: "cmd_bar_pin" });
        }}
      />
      {/* Close button (live-test 2026-04-26) — explicit mouse path
          for collapsing the bar back to the compact pill. Esc has
          always done this from the keyboard, but click-to-close was
          missing. Unpin first so the bar has a non-pinned state to
          collapse to, then fire the bus `close` event for a forced
          collapse that bypasses the prefix / pin guards in `dismiss`.
          Like Esc, it PRESERVES the typed draft — only a send clears it. */}
      <IconButton
        ariaLabel="Close command bar"
        icon={X}
        onClick={() => {
          if (cmdBarPinned) setCmdBarPinned(false);
          emitCmdBarEvent({ type: "close" });
        }}
      />
    </div>
  );
}

export default CommandBarContext;
