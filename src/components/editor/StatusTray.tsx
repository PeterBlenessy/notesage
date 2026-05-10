import * as React from "react";
import { useMemo } from "react";
import {
  Cpu,
  MessageSquare,
  HelpCircle,
  Command as CommandIcon,
  FileCode,
  FileText,
  CheckSquare,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";
import { useRoutingStore } from "@/stores/routing-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { useLocalAIStore } from "@/stores/local-ai-store";
import type { Comment } from "@/stores/comment-store";
import { useActionStore } from "@/stores/action-store";
import type { ViewMode } from "@/lib/file-utils";
import { MicButton } from "./toolbar/MicButton";
import { CommentList } from "./CommentListPopover";

/**
 * Inline completion icon — italic T with sparkle trail. Mirrors the
 * SVG in `StatusBar.tsx` so the tray and the legacy bar stay visually
 * consistent.
 */
function InlineCompletionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className={className}>
      <line x1="2" y1="3" x2="8.5" y2="3" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6.5" y1="3" x2="3.5" y2="13" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 9 L9.7 11.8 L12 13 L9.7 14.2 L9 17 L8.3 14.2 L6 13 L8.3 11.8 Z" fill="currentColor" stroke="none" />
      <path d="M13.5 2 L14.55 6.2 L18 8 L14.55 9.8 L13.5 14 L12.45 9.8 L9 8 L12.45 6.2 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Completion provider picker
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Group identifiers used by the task #54 ambient dots to request that a
 * specific section of the tray be scrolled into view + focused when the
 * popover opens. These strings are stable contract between the dots in
 * `QuietStatusBar` and the tray layout below.
 */
export type StatusTrayGroup =
  | "completions"
  | "comments"
  | "actions"
  | "session"
  | "help";

export interface StatusTrayProps {
  /** Controlled open state. */
  open: boolean;
  /** Notified on any open/close transition, including Escape and outside clicks. */
  onOpenChange: (open: boolean) => void;
  /**
   * Anchor — used to position the popover. Required because the tray is
   * mounted as a sibling, not a descendant of a trigger button.
   *
   * Accepts either a ref to a real DOM element (Radix calls
   * `getBoundingClientRect()` on it directly), or a "virtual" ref holding
   * an object that exposes `getBoundingClientRect()` — used by
   * `QuietStatusBar` to anchor the popover to the click coordinates rather
   * than the whole status strip.
   */
  anchor: React.RefObject<
    HTMLElement | { getBoundingClientRect(): DOMRect } | null
  >;

  /** Comments on the active document. Count + list affordance live in Comments group. */
  comments?: Comment[];
  onSelectComment?: (c: Comment) => void;
  onDelegateComment?: (c: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate?: boolean;

  /** Opens the ⌘7 keyboard-shortcuts dialog from the Help group. */
  onShortcutsOpen?: () => void;

  /**
   * Opens the Actions dashboard from the Actions group (bugs #3-#5).
   * Mirrors the legacy `ActionsIndicator` button in `StatusBar`'s
   * full variant — the QuietStatusBar variant gets the same
   * affordance via this group inside the popover.
   */
  onOpenActions?: () => void;

  /**
   * When provided on open, scroll the named group into view and give it
   * programmatic focus so screen readers announce the section. Used by
   * the task #54 ambient dots to deep-link into their owning group
   * (e.g. clicking the red recording dot jumps to Session).
   *
   * Only read when `open` transitions from false → true. Subsequent
   * changes while the tray is already open are ignored so user scrolling
   * inside the tray is never yanked back.
   */
  initialExpandedGroup?: StatusTrayGroup;

  /**
   * Active editor instance. When provided, the tray hosts the dictation
   * `MicButton` (⌘⇧R, moved off the pill toolbar in #110). Pass `null`
   * (or omit) when there is no editor — the row hides itself.
   */
  editor?: Editor | null;

  /** Active document's viewMode. Drives the source-mode switch label/state. */
  viewMode?: ViewMode;

  /**
   * Source-mode toggle callback. When provided alongside `viewMode`, the
   * tray shows a WYSIWYG ↔ Source switcher above the Completions group.
   * Mirrors `Toolbar`'s `onToggleViewMode` prop in the legacy variant.
   */
  onToggleViewMode?: () => void;
}

// ---------------------------------------------------------------------------
// Editor tools group — hosts MicButton + view-mode toggle (#110).
// These previously lived on the inline Toolbar; the pill variant omits them
// because the pill is intentionally tiny. The keyboard shortcuts (⌘⇧R for
// dictation, no chord for view-mode) continue to work app-wide regardless of
// where the affordance lives.
// ---------------------------------------------------------------------------

function EditorToolsGroup({
  editor,
  viewMode,
  onToggleViewMode,
}: {
  editor: Editor | null;
  viewMode?: ViewMode;
  onToggleViewMode?: () => void;
}) {
  const showSourceToggle = Boolean(onToggleViewMode);
  const showMic = Boolean(editor);
  if (!showMic && !showSourceToggle) return null;

  const isSource = viewMode === "source";

  return (
    <section className="flex items-center gap-2" aria-label="Editor tools">
      {showMic && (
        // Re-enable the MicButton's built-in Tooltip so it matches the
        // rest of the tray's chrome (consistent with source toggle,
        // completion picker, actions, shortcuts). Earlier `showTooltip={false}`
        // suppressed it to avoid the focus-on-popover-open auto-show, but
        // the user explicitly wants tooltip parity here.
        <MicButton editor={editor ?? null} />
      )}
      {showSourceToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="switch"
              aria-checked={isSource}
              aria-label={
                isSource ? "Switch to Rich text" : "Switch to Markdown source"
              }
              onClick={onToggleViewMode}
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 h-7 px-2 rounded-sm border border-border",
                "text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              {isSource ? (
                <>
                  <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  <span>Source</span>
                </>
              ) : (
                <>
                  <FileCode className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  <span>WYSIWYG</span>
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            {isSource ? "Rich text" : "Markdown source"}
          </TooltipContent>
        </Tooltip>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Completion picker
// ---------------------------------------------------------------------------

function CompletionsGroup() {
  const inlineCompletionsDisabled = useSettingsStore((s) => s.inlineCompletionsDisabled);
  const setInlineCompletionsDisabled = useSettingsStore(
    (s) => s.setInlineCompletionsDisabled,
  );
  const routing = useRoutingStore((s) => s.routing);
  const setRouting = useRoutingStore((s) => s.setRouting);
  const connections = useConnectionsStore((s) => s.connections);

  // Only show connections that advertise the inline_completion capability —
  // mirrors the filter in UseCaseRoutingSettings so the two surfaces stay consistent.
  const compatibleConnections = useMemo(
    () => connections.filter((c) => c.capabilities.includes("inline_completion")),
    [connections],
  );

  const currentConnectionId = routing.inline_completion?.connectionId ?? null;

  const isOff =
    inlineCompletionsDisabled ||
    !currentConnectionId ||
    !compatibleConnections.some((c) => c.id === currentConnectionId);

  const handleSelectOff = () => {
    setInlineCompletionsDisabled(true);
  };

  const handleSelectConnection = (connId: string) => {
    setInlineCompletionsDisabled(false);
    setRouting("inline_completion", connId);
  };

  // Sentinel value used by the Select to mean "no provider / disabled".
  // Mirrors the `NONE` constant in `UseCaseRoutingSettings` so the two
  // surfaces speak the same vocabulary.
  const OFF = "__off__";
  const selectValue = isOff ? OFF : (currentConnectionId ?? OFF);

  return (
    <section className="space-y-2" aria-label="Completions">
      <div className="flex items-center gap-2">
        <InlineCompletionIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium">Completions</span>
      </div>

      {/* Dropdown picker (replaces the segmented Off/Provider/Provider toggle).
          Matches the Settings > Inline Completion picker so users see one UI. */}
      <Select
        value={selectValue}
        onValueChange={(val) => {
          if (val === OFF) handleSelectOff();
          else handleSelectConnection(val);
        }}
      >
        <SelectTrigger
          aria-label="Completion provider"
          className="w-full h-8 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={OFF}>
            <span className="text-muted-foreground">Off</span>
          </SelectItem>
          {compatibleConnections.map((conn) => (
            <SelectItem key={conn.id} value={conn.id}>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    conn.status === "connected"
                      ? "bg-green-500"
                      : conn.status === "error"
                        ? "bg-destructive"
                        : "bg-muted-foreground",
                  )}
                />
                {conn.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Empty state: no compatible connections configured */}
      {compatibleConnections.length === 0 && (
        <p className="text-[10px] text-muted-foreground/60 leading-tight px-2">
          No inline completion provider configured.{" "}
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("notesage:open-settings"))
            }
            className="underline hover:text-foreground transition-colors"
          >
            Configure in Settings…
          </button>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Comments group
// ---------------------------------------------------------------------------

function CommentsGroup({
  comments,
  onSelectComment,
  onDelegateComment,
  onDelegateAll,
  canDelegate,
  onCloseTray,
}: {
  comments: Comment[];
  onSelectComment?: (c: Comment) => void;
  onDelegateComment?: (c: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate: boolean;
  /**
   * Closes the parent StatusTray popover. Called after the user picks a
   * comment so the user lands back on the editor with focus on the
   * jumped-to anchor — same UX as the legacy `CommentListPopover` (which
   * dismisses itself on row click).
   */
  onCloseTray: () => void;
}) {
  // Match `CommentListPopover`'s "visible" semantics: a comment is open
  // unless it has been explicitly resolved. Newly created comments have
  // `status === undefined` (the `addComment` action never assigns one),
  // so a strict `=== "open"` check would miss every freshly authored
  // comment and surface "0 / none open" for documents that obviously
  // have comments.
  const openCount = comments.filter((c) => c.status !== "resolved" && c.status !== "done").length;
  const hasOpen = openCount > 0;
  const totalVisible = comments.filter((c) => c.status !== "resolved").length;

  // Local open state for the inner Comments popover. Anchored to the
  // "View open comments" button via PopoverTrigger asChild — Radix
  // handles outside-click and Escape automatically. We dispatch the
  // legacy `notesage:open-comment-list` CustomEvent on open so existing
  // listeners (and the perf/regression tests that watch for it) keep
  // firing exactly once per click.
  const [listOpen, setListOpen] = React.useState(false);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setListOpen(next);
      if (next) {
        const detail = {
          comments,
          onSelectComment,
          onDelegateComment,
          onDelegateAll,
          canDelegate,
        };
        window.dispatchEvent(
          new CustomEvent("notesage:open-comment-list", { detail }),
        );
      }
    },
    [
      comments,
      onSelectComment,
      onDelegateComment,
      onDelegateAll,
      canDelegate,
    ],
  );

  return (
    <section className="space-y-2" aria-label="Comments">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Comments</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
          {hasOpen
            ? `${openCount} open`
            : totalVisible > 0
            ? "none open"
            : "none"}
        </span>
      </div>
      {hasOpen ? (
        <Popover open={listOpen} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors",
                "rounded-sm px-2 py-1 hover:bg-muted/50",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              View open comments
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="left"
            align="start"
            sideOffset={8}
            // Sit ABOVE the parent StatusTray popover (z-50) so we don't
            // get clipped by it. Same width + max-height as the legacy
            // `CommentListPopover`'s content for visual parity.
            className="w-72 p-0 max-h-80 overflow-y-auto z-[60]"
            onClick={(e) => e.stopPropagation()}
          >
            <CommentList
              comments={comments}
              onSelectComment={(c) => {
                onSelectComment?.(c);
                // Close the inner list AND the outer tray so the user
                // lands back on the editor focused on the anchor.
                setListOpen(false);
                onCloseTray();
              }}
              onDelegateComment={onDelegateComment}
              onDelegateAll={onDelegateAll}
              canDelegate={canDelegate}
              onDismiss={() => setListOpen(false)}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <p className="text-[10px] text-muted-foreground/60 leading-tight px-2">
          {totalVisible > 0
            ? "All comments handled."
            : "No comments on this document yet."}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Local AI group
// ---------------------------------------------------------------------------
//
// Live-test 2026-04-25 — this section was previously called "Session" and
// stacked three rows (Local AI status, Tool calling toggle, Recording).
// Tool calling and Recording were dropped (toggle wasn't useful from the
// status tray; recording is conveyed by the top-row MicButton). The
// section was renamed to "Local AI" and the two remaining concepts
// (status dot + active model) now sit on a 2-row layout:
//
//   row 1: <Cpu icon> "Local AI"          <status-dot right-aligned>
//   row 2: "Model"                        <select with downloaded models>
//
// `SessionGroup` is kept as the export name to avoid touching the
// `StatusTrayGroup = "session"` deep-link key used by the StatusBar's
// dot-click navigation. The `aria-label` on the section is now "Local
// AI" so assistive tech announces the new framing.

// ---------------------------------------------------------------------------
// Actions group (bugs #3-#5) — open-actions count + click to open
// ActionsDialog. Mirrors the legacy `ActionsIndicator` button in the
// full-variant StatusBar but presents it as a click-to-reveal row
// inside the StatusTray popover, consistent with the other groups.
// When `openCount === 0` the row stays visible with a muted "No open
// actions" state for consistency with the rest of the tray.
// ---------------------------------------------------------------------------

function ActionsGroup({ onOpenActions }: { onOpenActions?: () => void }) {
  const openCount = useActionStore((s) => s.getOpenCount());
  const handleClick = () => {
    if (onOpenActions) onOpenActions();
  };
  // Visual style matches HelpGroup's "Keyboard shortcuts" button — a
  // muted-foreground row with the chord on the right. Bugs #3 / live
  // finding 8 (looks like a button, not a submenu item).
  return (
    <section className="space-y-2" aria-label="Actions">
      <div className="flex items-center gap-2">
        <CheckSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Actions</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            disabled={!onOpenActions}
            className={cn(
              "w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors",
              "rounded-sm px-2 py-1 hover:bg-muted/50",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <CheckSquare className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="flex-1 text-left">
              {openCount === 0
                ? "No open actions"
                : `${openCount} open ${openCount === 1 ? "action" : "actions"}`}
            </span>
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">
              {"⌘!"}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          Open the actions dashboard
        </TooltipContent>
      </Tooltip>
    </section>
  );
}

function SessionGroup() {
  const serverStatus = useLocalAIStore((s) => s.serverStatus);
  const activeModelId = useLocalAIStore((s) => s.activeModelId);
  const setActiveModel = useLocalAIStore((s) => s.setActiveModel);
  const models = useLocalAIStore((s) => s.models);
  const connections = useConnectionsStore((s) => s.connections);

  const hasConnection = connections.some(
    (c) => c.provider === "local_ai" && c.authMethod === "local_bundled",
  );
  if (!hasConnection) return null;

  // Server-state-driven dot. Same green/amber/red/muted semantics used
  // by the QuietStatusBar's left dot — keep the two surfaces in sync.
  const dot =
    serverStatus === "running"
      ? "bg-green-500"
      : serverStatus === "starting"
        ? "bg-amber-500 animate-pulse"
        : serverStatus === "error"
          ? "bg-red-500"
          : "bg-muted-foreground/30";

  const statusLabel =
    serverStatus === "running"
      ? "Running"
      : serverStatus === "starting"
        ? "Starting"
        : serverStatus === "error"
          ? "Error"
          : "Stopped";

  const downloadedModels = models.filter((m) => m.downloaded);

  return (
    <section className="space-y-2" aria-label="Local AI">
      {/* Title row — icon + label + right-aligned status dot. */}
      <div className="flex items-center gap-2">
        <Cpu className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Local AI</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn("ml-auto h-1.5 w-1.5 rounded-full shrink-0", dot)}
              data-testid="local-ai-status-dot"
              data-server-status={serverStatus}
              role="status"
              aria-label={`Local AI ${statusLabel}`}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            {statusLabel}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Model picker — populated with downloaded models only. Picking a
          model writes to local-ai-store; useLocalAI auto-restarts the
          server when activeModelId changes.

          Live-test 2026-04-25 — dense styling: h-6 trigger (24 px),
          tighter px-2 padding, size-3 chevron, no border (the row sits
          inside a popover that already has its own surface). The
          underlying shadcn trigger always renders min-w-fit, so we cap
          the width at 160 px and rely on the SelectValue's truncation
          to keep long model names from blowing out the row. */}
      {/* Live-test 2026-04-25 — `px-2` indent so the row's label and
          picker align with the `px-2` button content in the Comments /
          Help groups. Keeps the second-row left edge consistent across
          the whole popover. */}
      <div className="flex items-center justify-between gap-2 px-2 min-h-0">
        <label
          htmlFor="status-tray-local-ai-model"
          className="text-xs text-muted-foreground"
        >
          Model
        </label>
        <Select
          value={activeModelId ?? undefined}
          onValueChange={setActiveModel}
          disabled={downloadedModels.length === 0}
        >
          <SelectTrigger
            id="status-tray-local-ai-model"
            className={cn(
              // Live-test 2026-04-25 — tightened further: 20 px tall,
              // 11 px text, 6 px horizontal padding, 10 px chevron.
              // The trigger is inside the popover (already a surface),
              // so no border is needed; a faint muted background marks
              // the affordance.
              "h-5 w-[160px] max-w-[160px] text-[11px] leading-none",
              "px-1.5 py-0 gap-1 border-0 bg-muted/40 hover:bg-muted/70",
              "[&>svg]:size-2.5",
              "[&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:min-w-0",
            )}
            aria-label="Active local AI model"
          >
            <SelectValue
              placeholder={
                downloadedModels.length === 0
                  ? "No models downloaded"
                  : "Pick a model"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {downloadedModels.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Help group
// ---------------------------------------------------------------------------

function HelpGroup({
  onShortcutsOpen,
}: {
  onShortcutsOpen?: () => void;
}) {
  return (
    <section className="space-y-2" aria-label="Help">
      <div className="flex items-center gap-2">
        <HelpCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Help</span>
      </div>
      {onShortcutsOpen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onShortcutsOpen}
              className={cn(
                "w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors",
                "rounded-sm px-2 py-1 hover:bg-muted/50",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              <CommandIcon className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span className="flex-1 text-left">Keyboard shortcuts</span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {"\u23187"}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            Show all keyboard shortcuts
          </TooltipContent>
        </Tooltip>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Top-level tray
// ---------------------------------------------------------------------------

/**
 * StatusTray — popover mounted above the quiet `StatusBar` strip.
 *
 * Holds four groups: Completions (provider picker), Comments (count + open
 * list), Session (local AI, tool calling, recording), Help (shortcuts +
 * word count). All state reads come from existing Zustand stores so the
 * popover is additive — no new persistence, no new Tauri calls.
 */
export function StatusTray({
  open,
  onOpenChange,
  anchor,
  comments = [],
  onSelectComment,
  onDelegateComment,
  onDelegateAll,
  canDelegate = false,
  onShortcutsOpen,
  onOpenActions,
  initialExpandedGroup,
  editor = null,
  viewMode,
  onToggleViewMode,
}: StatusTrayProps) {
  const handleShortcuts = React.useCallback(() => {
    onOpenChange(false);
    onShortcutsOpen?.();
  }, [onOpenChange, onShortcutsOpen]);

  // Bugs #3 — clicking the Actions row should close the tray AND
  // open the dashboard. Wrapper is undefined when no parent handler
  // is provided so ActionsGroup can disable the button (avoids
  // surfacing a no-op affordance).
  const handleOpenActions = React.useMemo(
    () =>
      onOpenActions
        ? () => {
            onOpenChange(false);
            onOpenActions();
          }
        : undefined,
    [onOpenChange, onOpenActions],
  );

  // Per-group refs used to deep-link into a section when a task #54 dot is
  // clicked. Each group wrapper holds a `tabIndex={-1}` so `.focus()` works
  // without trapping Tab order; scrollIntoView keeps the section anchored
  // in the 300px popover when the tray is tall enough to overflow.
  const completionsRef = React.useRef<HTMLDivElement | null>(null);
  const commentsRef = React.useRef<HTMLDivElement | null>(null);
  const sessionRef = React.useRef<HTMLDivElement | null>(null);
  const helpRef = React.useRef<HTMLDivElement | null>(null);

  /** Resolve the group ref by id. Safe to call before mount — returns null. */
  const resolveGroup = React.useCallback(
    (group?: StatusTrayGroup): HTMLDivElement | null => {
      if (!group) return null;
      if (group === "completions") return completionsRef.current;
      if (group === "comments") return commentsRef.current;
      if (group === "session") return sessionRef.current;
      if (group === "help") return helpRef.current;
      return null;
    },
    [],
  );

  // `onOpenAutoFocus` runs after Radix has mounted the popover content.
  // When a dot has pre-selected a group, intercept the default autofocus
  // (which would land on the first focusable descendant — typically the
  // Completions "Off" radio) and steer focus + scroll to the requested
  // group root instead. Without this, Radix would win the focus race and
  // any scrollIntoView we did in a later tick would be overridden.
  const handleOpenAutoFocus = React.useCallback(
    (e: Event) => {
      if (!initialExpandedGroup) return;
      const target = resolveGroup(initialExpandedGroup);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ block: "nearest" });
      target.focus({ preventScroll: true });
    },
    [initialExpandedGroup, resolveGroup],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor
        virtualRef={
          anchor as React.RefObject<{ getBoundingClientRect(): DOMRect }>
        }
      />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-[300px] p-0"
        onOpenAutoFocus={handleOpenAutoFocus}
        // The anchor is the whole status strip; clicking the strip is what
        // opens us. When no `initialExpandedGroup` is set, Radix's default
        // autofocus runs (first focusable control). When a dot requested a
        // group, `handleOpenAutoFocus` preventDefaults Radix and steers
        // focus + scroll to that group root instead.
      >
        {/*
          TooltipProvider is REQUIRED here because PopoverContent portal-
          mounts to document.body — any TooltipProvider higher in the React
          tree doesn't reach into this portal. MicButton and other children
          use <Tooltip> which throws "Tooltip must be used within
          TooltipProvider" without this wrapper (see
          feedback_code_review_mandatory_gate in auto-memory).
        */}
        <TooltipProvider delayDuration={300}>
          {/*
           * Live-test 2026-04-26 — inset inter-section separators (12px
           * from each edge) instead of edge-to-edge `divide-y`. The first
           * section keeps a flush top edge — the popover's own border
           * carries that boundary already.
           */}
          <div className="[&>*+*]:relative [&>*+*]:before:pointer-events-none [&>*+*]:before:absolute [&>*+*]:before:left-3 [&>*+*]:before:right-3 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-border">
            {(editor || onToggleViewMode) && (
              <div className="p-3">
                <EditorToolsGroup
                  editor={editor}
                  viewMode={viewMode}
                  onToggleViewMode={onToggleViewMode}
                />
              </div>
            )}
            <div ref={completionsRef} tabIndex={-1} className="p-3 focus:outline-none">
              <CompletionsGroup />
            </div>
            <div ref={commentsRef} tabIndex={-1} className="p-3 focus:outline-none">
              <CommentsGroup
                comments={comments}
                onSelectComment={onSelectComment}
                onDelegateComment={onDelegateComment}
                onDelegateAll={onDelegateAll}
                canDelegate={canDelegate}
                onCloseTray={() => onOpenChange(false)}
              />
            </div>
            {/* Bugs #3 — Actions group sits between Comments and
                Session ("things to act on" cluster). Click closes the
                tray + opens the ActionsDialog via the threaded
                `onOpenActions` prop (Editor → StatusBar → here). */}
            <div tabIndex={-1} className="p-3 focus:outline-none">
              <ActionsGroup onOpenActions={handleOpenActions} />
            </div>
            <div ref={sessionRef} tabIndex={-1} className="p-3 focus:outline-none">
              <SessionGroup />
            </div>
            <div ref={helpRef} tabIndex={-1} className="p-3 focus:outline-none">
              <HelpGroup onShortcutsOpen={handleShortcuts} />
            </div>
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
