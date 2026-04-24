import { useMemo, useState } from "react";
import { AlertTriangle, Clock, Pin, PinOff, Plus, Lock, Target, X, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProviderLogo } from "@/components/ProviderLogo";
import { useConnectionsStore } from "@/stores/connections-store";
import { useRoutingStore } from "@/stores/routing-store";
import { useChatStore, selectProjectPaths } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useGoalsDiscovery } from "@/hooks/useGoalsDiscovery";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
}

function CommandBarContext({ className }: CommandBarContextProps) {
  // Active interactive connection (the provider pill).
  const interactiveConnection = useRoutingStore((s) =>
    s.getConnectionForUseCase("interactive"),
  ) as Connection | null;
  const setRouting = useRoutingStore((s) => s.setRouting);

  // All registered connections — the dropdown lists those with the
  // `interactive` capability. Reads from connections-store so the same
  // store action ChatFooter dispatches drives the AgentSwitchCard flow
  // via ChatPanel's `effectiveConnection?.id` effect (no duplicate logic).
  const allConnections = useConnectionsStore((s) => s.connections);
  const interactiveConnections = useMemo(
    () => allConnections.filter((c) => c.capabilities.includes("interactive")),
    [allConnections],
  );

  // Current conversation (project chips). Read defensively — there may be
  // no conversation yet when the bar is first opened.
  const activeConversation = useChatStore((s) => {
    const id = s.activeConversationId;
    if (!id) return null;
    return (s.conversations as Conversation[]).find((c) => c.id === id) ?? null;
  });

  const projectPaths = activeConversation?.projectPaths ?? [];

  // Per-project metadata — used to surface the lock icon when `aiLock` is set.
  const metadataMap = useProjectMetadataStore(
    (s) => s.metadataMap,
  ) as Record<string, ProjectMetadata>;

  // Workspace projects — used to populate the "+ project" popover with paths
  // not already in scope (#25).
  const workspaceProjects = useWorkspaceStore(
    (s) => s.projects,
  ) as WorkspaceProject[];

  // Chat-store actions for project chip add/remove (#25). Reuse the same
  // `toggleProjectPath` ChatFooter dispatches so the surrounding
  // `selectPendingProjectSwitch` flow continues to fire.
  const toggleProjectPath = useChatStore((s) => s.toggleProjectPath);

  // Pinned-mode toggle state (#28). Wired to `settings-store.cmdBarPinned`.
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);
  const setCmdBarPinned = useSettingsStore((s) => s.setCmdBarPinned);

  // Cross-project mode warning pill (#73). Replaces the deleted legacy banner
  // above the chat input with a compact indicator on the context row — the
  // pill is only rendered when the opt-in is active (default off). Clicking
  // the pill opens Settings > Advanced (the "developer" tab) so the user can
  // toggle the mode off in one jump.
  const crossProjectMode = useSettingsStore((s) => s.crossProjectMode);

  // #125 — Parity with ChatFooter. The mode picker is gated on
  // `showAgentModePicker` (Settings > Advanced toggle, same as legacy).
  // Goals discovery runs for the single-project case; the pill surfaces
  // the count as "N goals" so users know what's being injected as AI
  // context.
  const showAgentModePicker = useSettingsStore((s) => s.showAgentModePicker);
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const singleProjectPath =
    selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);

  // Locked-paths derived view drives the explain-lock dialog when the user
  // clicks a chip's lock icon. The dialog accepts an array (multiple chips
  // can each be locked); we only ever surface the clicked one.
  const [explainLockPaths, setExplainLockPaths] = useState<string[]>([]);

  // Projects available to add — workspace projects not already in scope.
  // Computed fresh each render; the list is small and rendered inside a
  // popover, so memoization isn't worth the noise.
  const addableProjects = workspaceProjects.filter(
    (p) => !projectPaths.includes(p.path),
  );

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
        connection={interactiveConnection}
        connections={interactiveConnections}
        onPick={(id) => {
          // Ignore re-picking the active connection — the change-detect
          // effect in ChatPanel relies on `prev !== curr` to fire the
          // AgentSwitchCard prompt. Calling setRouting unconditionally
          // would spuriously bump the routing-store's reference identity.
          if (id === interactiveConnection?.id) return;
          setRouting("interactive", id);
        }}
      />

      <Divider />

      {/*
       * Project chip group — the one flex child that is allowed to shrink
       * below its intrinsic content width. `min-w-0` releases the default
       * `min-width: auto` that would otherwise propagate each chip's
       * content width upward, and `overflow-hidden` clips anything that
       * spills past the available space. Chips themselves carry `min-w-0`
       * + internal `truncate` so their labels ellipsize rather than the
       * chips disappearing entirely. The `+ project` button sits inside
       * the same group and shares the shrink budget.
       */}
      <div
        data-cmd-chip-group
        className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden"
      >
        {projectPaths.map((path) => {
          const metadata = metadataMap[path];
          const locked = Boolean(metadata?.aiLock);
          return (
            <ProjectChip
              key={path}
              path={path}
              locked={locked}
              onRemove={() => toggleProjectPath(path)}
              onLockClick={() => setExplainLockPaths([path])}
            />
          );
        })}

        {/* Dashed "+ project" button -------------------------------------- */}
        <AddProjectButton
          addableProjects={addableProjects}
          onPick={handleAddProject}
        />
      </div>

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
       * #26 — Reuse the existing chat-footer mode picker (`AcpModePicker`)
       * instead of forking a parallel implementation. The picker:
       *   - Reads available modes from `connection.acpCapabilities.availableModes`
       *     (probed at registration), maps them to the four common permission
       *     levels (Read Only / Agent / Full Access / Plan) via `getCommonModes`,
       *     and hides itself when fewer than 2 levels are available — which is
       *     the case for every non-ACP provider (no `acpCapabilities` set).
       *   - Dispatches mode changes through `updateCurrentMode` +
       *     `tauriApi.acpSessionSetMode`, the same store action `ChatFooter`
       *     uses, so the active ACP session stays in sync no matter which
       *     surface the user picks from.
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
        // usage indicator. Swapping in this one component replaces what
        // used to be a bare `<AcpModePicker />` + hidden config pickers
        // with feature parity against `ChatFooter`.
        <div className="shrink-0">
          <AcpSessionControls
            showModePicker={showAgentModePicker}
            connection={interactiveConnection}
          />
        </div>
      ) : null}

      {/* Goals indicator (#125) — mirrors ChatFooter's "N goals" pill.
       *  Only surfaces when the selection resolves to a single project
       *  that has goal files; multi-project or zero-project selections
       *  don't carry an unambiguous goal context.
       */}
      {goalFiles.length > 0 ? (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 items-center gap-0.5 px-1 py-px rounded text-[10px] font-medium text-muted-foreground bg-accent">
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

      {/* Cross-project scope warning pill (#73) — replaces the legacy banner */}
      {crossProjectMode ? <CrossProjectScopePill /> : null}

      {/* Trailing icons ---------------------------------------------------- */}
      <IconButton
        ariaLabel="Open history"
        icon={Clock}
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
}

function ProviderPill({ connection, connections, onPick }: ProviderPillProps) {
  const label = connection?.label ?? "No provider";
  const provider = connection?.provider ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-md shrink-0",
            "border border-border bg-muted/50",
            "hover:bg-muted transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
          aria-label={`Active provider: ${label}`}
        >
          {provider ? (
            <ProviderLogo provider={provider} className="w-3.5 h-3.5" bare />
          ) : null}
          <span className="text-foreground">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {connections.map((c) => {
          const isActive = c.id === connection?.id;
          return (
            <DropdownMenuItem
              key={c.id}
              onSelect={() => onPick(c.id)}
              aria-label={`Switch provider to ${c.label}`}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "flex items-center gap-2 cursor-pointer",
                isActive && "bg-accent/50",
              )}
            >
              <ProviderLogo provider={c.provider} className="w-4 h-4" bare />
              <span className="flex-1 truncate text-foreground">{c.label}</span>
              {isActive ? (
                <Check
                  className="h-3.5 w-3.5 text-foreground shrink-0"
                  strokeWidth={1.5}
                  aria-hidden
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ProjectChipProps {
  path: string;
  locked: boolean;
  /** Called when the chip's × button is clicked. */
  onRemove: () => void;
  /**
   * Called when the chip's lock icon is clicked. Only fires when `locked`
   * is true; the icon isn't rendered otherwise.
   */
  onLockClick: () => void;
}

function ProjectChip({ path, locked, onRemove, onLockClick }: ProjectChipProps) {
  // Use the basename for the visible label — the full path stays in the
  // tooltip via `title` so no information is lost.
  const name = basename(path);

  return (
    <span
      className={cn(
        // `min-w-0 shrink` lets the chip collapse below its intrinsic
        // content width so the label inside can truncate when the row
        // runs out of horizontal space. Without this the chip would
        // flex-default to `min-width: auto` and push trailing siblings
        // (mode picker, pin icon) out of view.
        "flex items-center gap-1 px-2 py-0.5 rounded-md min-w-0 shrink",
        "border border-border bg-muted/30",
      )}
      title={path}
    >
      {locked ? (
        <button
          type="button"
          onClick={onLockClick}
          aria-label={`${name} is locked to a provider`}
          className={cn(
            "flex items-center justify-center shrink-0",
            "text-foreground hover:text-foreground/80 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded",
          )}
        >
          <Lock className="w-3 h-3" strokeWidth={1.5} />
        </button>
      ) : null}
      {/*
       * The label is the only element inside the chip that is allowed to
       * ellipsize — the lock icon and × button stay full-size via
       * `shrink-0` so the affordance is never clipped.
       */}
      <span className="text-foreground truncate min-w-0">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className={cn(
          "flex items-center justify-center -mr-0.5 shrink-0",
          "text-muted-foreground hover:text-foreground transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded",
        )}
      >
        <X className="w-3 h-3" strokeWidth={1.5} />
      </button>
    </span>
  );
}

interface AddProjectButtonProps {
  addableProjects: WorkspaceProject[];
  onPick: (path: string) => void;
}

function AddProjectButton({ addableProjects, onPick }: AddProjectButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add project"
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded-md shrink-0",
            "border border-dashed border-border text-muted-foreground",
            "hover:text-foreground hover:border-foreground/40 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
        >
          <Plus className="w-3 h-3" strokeWidth={1.5} />
          <span>project</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-1">
        {addableProjects.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No other projects to add
          </div>
        ) : (
          addableProjects.map((project) => {
            const name = basename(project.path);
            return (
              <button
                key={project.path}
                type="button"
                onClick={() => onPick(project.path)}
                aria-label={`Add project ${name}`}
                className={cn(
                  "w-full flex flex-col items-start gap-0.5 px-2 py-1.5 rounded",
                  "text-xs transition-colors text-foreground hover:bg-accent/50",
                )}
              >
                <span className="truncate w-full text-left">{name}</span>
                <span className="truncate w-full text-left text-[10px] text-muted-foreground">
                  {project.path}
                </span>
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
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
    "Cross-project mode exposes all workspace folders to the agent. Click to open Settings > Advanced.";
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent("notesage:open-settings", {
            detail: { tab: "developer" },
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
}

function IconButton({ ariaLabel, icon: Icon, onClick }: IconButtonProps) {
  return (
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
