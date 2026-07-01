import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, MessageSquare, Pin, PinOff, Lock, Plus, Target, ChevronUp, FolderOpen, Settings2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { track } from "@/lib/telemetry";
import { ProviderLogo } from "@/components/ProviderLogo";
import { useConnectionsStore } from "@/stores/connections-store";
import { useRoutingStore } from "@/stores/routing-store";
import { useChatStore, selectProjectPaths } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useLocalAIStore } from "@/stores/local-ai-store";
import { useGoalsDiscovery } from "@/hooks/useGoalsDiscovery";
import { tauriApi } from "@/lib/tauri";
import { getAgentModels, prettyModelName } from "@/lib/ai/connections";
import { AGENT_KNOWN_MODELS } from "@/components/settings/connection/ModelSelectionForm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PickerCheckboxItem, PickerItem } from "@/components/ui/picker-item";
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

// ---------------------------------------------------------------------------
// Sub-components — kept private to this module per the "one component per
// file" rule. These are pure visual fragments, not standalone components.
// ---------------------------------------------------------------------------

function Divider() {
  return <div className="h-4 w-px bg-border shrink-0" aria-hidden />;
}

interface ProviderPillProps {
  connection: Connection | null;
  connections: Connection[];
  onPick: (connectionId: string) => void;
  /** True when the active conversation has at least one project with
   *  `aiLock`. Disables the picker dropdown — clicking the pill opens
   *  the explain-lock dialog instead. */
  locked: boolean;
  /** The locked connection (resolved from `aiLock.connectionId`).
   *  Used for the title / aria-label copy. */
  lockedConnection: Connection | null;
  /** Paths to pass to `onExplainLock` when the user clicks the pill in
   *  locked mode. */
  lockedProjectPaths: string[];
  /** Open the explain-lock dialog with the given locked paths. */
  onExplainLock: (paths: string[]) => void;
}

function ProviderPill({
  connection,
  connections,
  onPick,
  locked,
  lockedConnection,
  lockedProjectPaths,
  onExplainLock,
}: ProviderPillProps) {
  const label = connection?.label ?? "No provider";
  const provider = connection?.provider ?? null;

  // Locked variant — single static button.
  // Click opens the explain-lock dialog.
  if (locked) {
    return (
      <button
        type="button"
        data-testid="cmd-bar-provider"
        data-locked="true"
        onClick={() => onExplainLock(lockedProjectPaths)}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2 rounded-md shrink-0",
          "text-xs font-medium text-foreground",
          "border border-transparent bg-muted",
          "transition-colors duration-150",
          "hover:border-border",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
        title={`Locked to ${
          lockedConnection?.label ?? "a specific provider"
        } by project — click to learn more`}
        aria-label={`Provider locked to ${
          lockedConnection?.label ?? "a specific provider"
        }. Click to learn more.`}
      >
        {provider ? (
          <ProviderLogo provider={provider} className="w-3.5 h-3.5" bare />
        ) : null}
        <span>{label}</span>
        <Lock className="h-3 w-3 opacity-60" strokeWidth={1.5} aria-hidden="true" />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="cmd-bar-provider"
                data-locked="false"
                className={cn(
                  // Live-test 2026-04-26 — picker rhythm (h-7, text-xs
                  // font-medium, transparent border, soft `bg-muted` fill
                  // — same as ProjectChip).
                  "inline-flex items-center gap-1.5 h-7 px-2 rounded-md shrink-0",
                  "text-xs font-medium text-foreground",
                  "border border-transparent bg-muted",
                  "transition-colors duration-150",
                  "hover:border-border",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
                aria-label={`Active provider: ${label}`}
              >
                {provider ? (
                  <ProviderLogo provider={provider} className="w-3.5 h-3.5" bare />
                ) : null}
                <span>{label}</span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            Active provider: {label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="start" className="min-w-[200px] p-1">
        <DropdownMenuRadioGroup
          value={connection?.id ?? ""}
          onValueChange={(value) => {
            if (value && value !== connection?.id) onPick(value);
          }}
        >
          {connections.map((c) => (
            <PickerItem
              key={c.id}
              value={c.id}
              label={c.label}
              leading={<ProviderLogo provider={c.provider} className="w-4 h-4" bare />}
            />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ProjectsPickerProps {
  /** Currently-selected project paths (active conversation scope). */
  projectPaths: string[];
  /** All workspace projects (selected + unselected). */
  workspaceProjects: WorkspaceProject[];
  /** Per-project metadata — used to surface the lock icon. */
  metadataMap: Record<string, ProjectMetadata>;
  /** Toggle a project ON (handles lock conflict checks upstream). */
  onToggle: (path: string) => void;
  /** Toggle a project OFF (skips lock conflict checks — already in scope). */
  onRemove: (path: string) => void;
  /** Open the explain-lock dialog for a locked project. */
  onExplainLock: (path: string) => void;
}

/**
 * Project multiselect picker (live-test 2026-04-26). Single trigger
 * button shows the count + a representative label; popover shows every
 * workspace project with a checkmark for selected ones — `+`
 * consolidated menu pattern.
 */
function ProjectsPicker({
  projectPaths,
  workspaceProjects,
  metadataMap,
  onToggle,
  onRemove,
  onExplainLock,
}: ProjectsPickerProps) {
  // Trigger label: "All projects" if every workspace project is selected;
  // a single name when only one is selected; "<name> +N" when multiple.
  const triggerLabel = useMemo(() => {
    if (projectPaths.length === 0) return "Projects";
    if (workspaceProjects.length > 0 &&
        projectPaths.length === workspaceProjects.length) {
      return "All projects";
    }
    if (projectPaths.length === 1) {
      const meta = metadataMap[projectPaths[0]];
      return meta?.name?.trim() || basename(projectPaths[0]);
    }
    const firstMeta = metadataMap[projectPaths[0]];
    const firstName = firstMeta?.name?.trim() || basename(projectPaths[0]);
    return `${firstName} +${projectPaths.length - 1}`;
  }, [projectPaths, workspaceProjects.length, metadataMap]);

  // Indicate lock state on the trigger when ANY selected project is locked.
  const anyLocked = projectPaths.some((p) => Boolean(metadataMap[p]?.aiLock));

  // Sorted projects for the popover — selected first (alphabetical),
  // unselected after (alphabetical).
  const sortedProjects = useMemo(() => {
    const byName = (a: WorkspaceProject, b: WorkspaceProject) => {
      const an = metadataMap[a.path]?.name?.trim() || basename(a.path);
      const bn = metadataMap[b.path]?.name?.trim() || basename(b.path);
      return an.localeCompare(bn, undefined, { sensitivity: "base" });
    };
    const selected: WorkspaceProject[] = [];
    const unselected: WorkspaceProject[] = [];
    for (const p of workspaceProjects) {
      if (projectPaths.includes(p.path)) selected.push(p);
      else unselected.push(p);
    }
    selected.sort(byName);
    unselected.sort(byName);
    return [...selected, ...unselected];
  }, [workspaceProjects, projectPaths, metadataMap]);

  const allSelected =
    workspaceProjects.length > 0 &&
    projectPaths.length === workspaceProjects.length;

  const tooltipText =
    projectPaths.length === 0
      ? "Pick projects to scope chat to"
      : `${projectPaths.length} project${projectPaths.length === 1 ? "" : "s"} in scope: ${triggerLabel}`;

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={
                  projectPaths.length === 0
                    ? "Pick projects"
                    : `${projectPaths.length} project${projectPaths.length === 1 ? "" : "s"} selected — ${triggerLabel}`
                }
                className={cn(
                  // Same h-7 command-bar rhythm as ProviderPill.
                  "inline-flex items-center gap-1.5 h-7 px-2 rounded-md min-w-0 shrink",
                  "text-xs font-medium",
                  "border border-transparent",
                  "transition-colors duration-150",
                  projectPaths.length > 0
                    ? "text-foreground bg-muted hover:border-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                <span className="truncate min-w-0">{triggerLabel}</span>
                {anyLocked ? (
                  <Lock
                    className="w-3 h-3 opacity-60 shrink-0"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                ) : null}
                <ChevronUp className="w-3 h-3 opacity-50 shrink-0" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[260px]">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent side="top" align="start" className="w-64 p-1">
        <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Projects
        </div>
        {workspaceProjects.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No projects open
          </div>
        ) : (
          <>
            {workspaceProjects.length > 1 ? (
              <PickerCheckboxItem
                label={allSelected ? "Deselect all" : "Select all"}
                checked={allSelected}
                onCheckedChange={() => {
                  if (allSelected) {
                    // Deselect all selected.
                    for (const p of [...projectPaths]) onRemove(p);
                  } else {
                    // Select all not-yet-selected (skip locked-conflict —
                    // `onToggle` enforces it). Best-effort.
                    for (const p of workspaceProjects) {
                      if (!projectPaths.includes(p.path)) onToggle(p.path);
                    }
                  }
                }}
                onSelect={(e: Event) => e.preventDefault()}
              />
            ) : null}
            {sortedProjects.map((project) => {
              const isChecked = projectPaths.includes(project.path);
              const locked = Boolean(metadataMap[project.path]?.aiLock);
              const name =
                metadataMap[project.path]?.name?.trim() ||
                basename(project.path);
              return (
                <PickerCheckboxItem
                  key={project.path}
                  label={name}
                  trailing={
                    locked ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onExplainLock(project.path);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onExplainLock(project.path);
                          }
                        }}
                        aria-label={`${name} is locked to a provider`}
                        className="shrink-0 inline-flex text-foreground hover:text-foreground/80 transition-colors rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        <Lock className="h-3 w-3" strokeWidth={1.5} />
                      </span>
                    ) : null
                  }
                  checked={isChecked}
                  onCheckedChange={() => {
                    if (isChecked) onRemove(project.path);
                    else onToggle(project.path);
                  }}
                  onSelect={(e: Event) => e.preventDefault()}
                />
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Provider quick-config gear (live-test 2026-04-26 #53) — popover
 * containing per-provider config knobs that don't deserve a top-level
 * pill in the row. v1: model picker. Future config knobs (temperature
 * override, max tokens, etc.) plug into the same popover.
 *
 * Model list per connection type:
 *   - agent_managed (ACP): `AGENT_KNOWN_MODELS[agentBinary]` merged with
 *     dynamic `getAgentModels(connection.id)?.models` (probed from
 *     `available_commands_update` events).
 *   - local_bundled: downloaded models from `useLocalAIStore`.
 *   - api_key / openai_compatible: lazy-fetched via
 *     `tauriApi.listModels(provider, apiKey?, baseUrl?)` on first open.
 */
function ProviderQuickConfig({ connection }: { connection: Connection }) {
  const updateConnection = useConnectionsStore((s) => s.updateConnection);
  const [open, setOpen] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const localModels = useLocalAIStore((s) => s.models);
  const downloadedLocalModels = useMemo(
    () => localModels.filter((m) => m.downloaded).map((m) => m.id),
    [localModels],
  );

  // Resolve the model list for this connection synchronously when
  // possible; fall back to async fetch on first open.
  const models = useMemo<string[]>(() => {
    if (connection.authMethod === "agent_managed") {
      const creds = connection.credentials as { agentBinary?: string };
      const agentBinary = creds.agentBinary ?? "";
      const known = (AGENT_KNOWN_MODELS[agentBinary] ?? []).map((m) => m.id);
      const dynamic =
        getAgentModels(connection.id)?.models.map((m) => m.modelId) ?? [];
      const knownSet = new Set(known);
      const merged = [...known];
      for (const id of dynamic) if (!knownSet.has(id)) merged.push(id);
      return merged;
    }
    if (connection.authMethod === "local_bundled") {
      return downloadedLocalModels;
    }
    return fetchedModels;
  }, [connection, downloadedLocalModels, fetchedModels]);

  // Lazy-fetch for API-key / OpenAI-compatible providers when the popover
  // opens. ACP and local_bundled are sync (handled above).
  const needsFetch =
    connection.authMethod !== "agent_managed" &&
    connection.authMethod !== "local_bundled";

  useEffect(() => {
    if (!open || !needsFetch || fetchedModels.length > 0 || fetching) return;
    let cancelled = false;
    setFetching(true);
    setFetchError(null);
    (async () => {
      try {
        const apiKey =
          connection.credentials.type === "api_key"
            ? connection.credentials.key
            : undefined;
        const baseUrl = connection.config?.baseUrl;
        const provider =
          connection.provider === "openai_compatible"
            ? "openai_compatible"
            : connection.provider;
        const result = await tauriApi.listModels(provider, apiKey, baseUrl);
        if (!cancelled) setFetchedModels(result);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, needsFetch, fetchedModels.length, fetching, connection]);

  const currentModel = connection.config?.model;

  const handlePickModel = (modelId: string | undefined) => {
    updateConnection(connection.id, {
      config: { ...connection.config, model: modelId } as Connection["config"],
    });
  };

  const tooltipText = currentModel
    ? `Model: ${prettyModelName(currentModel)}`
    : "Default model — click to choose";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Provider quick config"
                className={cn(
                  "inline-flex items-center justify-center h-7 w-7 rounded-md shrink-0",
                  "text-muted-foreground border border-transparent",
                  "hover:text-foreground hover:bg-muted hover:border-border",
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[240px]">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-64 max-h-[320px] overflow-y-auto p-1"
      >
        <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Model
        </div>
        <DropdownMenuRadioGroup
          value={currentModel ?? ""}
          onValueChange={(value) => {
            handlePickModel(value === "" ? undefined : value);
          }}
        >
          <PickerItem value="" label="Default" />
          {models.map((m) => (
            <PickerItem key={m} value={m} label={prettyModelName(m)} />
          ))}
        </DropdownMenuRadioGroup>
        {fetching ? (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {fetchError ? (
          <p className="px-2 py-1.5 text-[11px] text-destructive">
            {fetchError}
          </p>
        ) : null}
        {!fetching && !fetchError && models.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
            No models available
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * CrossProjectScopePill — compact warning indicator that replaces the
 * legacy "Cross-project mode" banner (#73). Only rendered when
 * `settings-store.crossProjectMode` is true; clicking opens Settings >
 * Advanced so the user can toggle the mode off.
 */
function CrossProjectScopePill() {
  const title =
    "Cross-project mode exposes all workspace folders to the agent. Click to open Settings > AI & Agents.";
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent("notesage:open-settings", {
            detail: { tab: "ai" },
          }),
        );
      }}
      aria-label={title}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 h-5 px-2 rounded-full shrink-0",
        "text-[11px] font-medium",
        "bg-destructive/10 text-destructive border border-destructive/30",
        "hover:bg-destructive/15 hover:border-destructive/40 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40",
      )}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-hidden />
      <span>Cross-project scope</span>
    </button>
  );
}

interface IconButtonProps {
  ariaLabel: string;
  icon: typeof Clock;
  onClick: () => void;
  /** Tooltip text shown on hover/focus. Defaults to `ariaLabel`. */
  tooltip?: string;
}

function IconButton({ ariaLabel, icon: Icon, onClick, tooltip }: IconButtonProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className={cn(
              "flex items-center justify-center w-6 h-6 rounded-md shrink-0",
              "text-muted-foreground hover:text-foreground hover:bg-muted",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          {tooltip ?? ariaLabel}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basename(path: string): string {
  if (!path) return "";
  // Trim trailing slashes so "/foo/bar/" -> "bar" rather than "".
  const trimmed = path.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}

export default CommandBarContext;
