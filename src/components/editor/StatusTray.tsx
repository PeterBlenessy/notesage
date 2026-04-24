import * as React from "react";
import { useMemo } from "react";
import {
  Cpu,
  MessageSquare,
  HelpCircle,
  Command as CommandIcon,
  Mic,
  Wrench,
  FileCode,
  FileText,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";
import { useRoutingStore } from "@/stores/routing-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { useLocalAIStore } from "@/stores/local-ai-store";
import { useRecordingStore } from "@/stores/recording-store";
import type { Comment } from "@/stores/comment-store";
import type { ViewMode } from "@/lib/file-utils";
import { MicButton } from "./toolbar/MicButton";

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

type CompletionOption = "off" | "copilot" | "local_ai" | "ollama";

interface CompletionOptionMeta {
  value: CompletionOption;
  label: string;
}

const COMPLETION_OPTIONS: CompletionOptionMeta[] = [
  { value: "off", label: "Off" },
  { value: "copilot", label: "Copilot" },
  { value: "local_ai", label: "Local AI" },
  { value: "ollama", label: "Ollama" },
];

// ---------------------------------------------------------------------------
// Reading-time helper — kept in sync with StatusBar.tsx (200 wpm).
// ---------------------------------------------------------------------------

const fmt = new Intl.NumberFormat(
  typeof navigator !== "undefined" ? (navigator.languages as string[]) : undefined,
  { useGrouping: true },
);

function fmtNum(n: number): string {
  return fmt.format(n);
}

function readingTimeMinutes(words: number): number {
  return Math.max(1, Math.ceil(words / 200));
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Group identifiers used by the task #54 ambient dots to request that a
 * specific section of the tray be scrolled into view + focused when the
 * popover opens. These strings are stable contract between the dots in
 * `QuietStatusBar` and the tray layout below.
 */
export type StatusTrayGroup = "completions" | "comments" | "session" | "help";

export interface StatusTrayProps {
  /** Controlled open state. */
  open: boolean;
  /** Notified on any open/close transition, including Escape and outside clicks. */
  onOpenChange: (open: boolean) => void;
  /**
   * Anchor element — the quiet status strip — used to position the popover.
   * Required because the tray is mounted as a sibling, not a descendant of
   * a trigger button.
   */
  anchor: React.RefObject<HTMLElement | null>;

  /** Word count for the Help > Word count breakdown row. Undefined hides it. */
  wordCount?: number;

  /** Comments on the active document. Count + list affordance live in Comments group. */
  comments?: Comment[];
  onSelectComment?: (c: Comment) => void;
  onDelegateComment?: (c: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate?: boolean;

  /** Opens the ⌘7 keyboard-shortcuts dialog from the Help group. */
  onShortcutsOpen?: () => void;

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
        <MicButton editor={editor ?? null} />
      )}
      {showSourceToggle && (
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
          title={isSource ? "Rich text" : "Markdown source"}
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

  // Look up completion-capable connections by provider/flavor.
  const copilotConn = useMemo(
    () =>
      connections.find(
        (c) => c.provider === "github" && c.authMethod === "agent_managed",
      ),
    [connections],
  );
  const localAiConn = useMemo(
    () => connections.find((c) => c.authMethod === "local_bundled"),
    [connections],
  );
  const ollamaConn = useMemo(
    () => connections.find((c) => c.provider === "ollama"),
    [connections],
  );

  const currentConnectionId = routing.inline_completion?.connectionId ?? null;

  const activeOption: CompletionOption = (() => {
    if (inlineCompletionsDisabled) return "off";
    if (!currentConnectionId) return "off";
    if (copilotConn && currentConnectionId === copilotConn.id) return "copilot";
    if (localAiConn && currentConnectionId === localAiConn.id) return "local_ai";
    if (ollamaConn && currentConnectionId === ollamaConn.id) return "ollama";
    return "off";
  })();

  const isDisabled = (opt: CompletionOption) => {
    if (opt === "off") return false;
    if (opt === "copilot") return !copilotConn;
    if (opt === "local_ai") return !localAiConn;
    if (opt === "ollama") return !ollamaConn;
    return true;
  };

  const handleSelect = (opt: CompletionOption) => {
    if (isDisabled(opt)) return;
    if (opt === "off") {
      setInlineCompletionsDisabled(true);
      return;
    }
    const conn =
      opt === "copilot" ? copilotConn : opt === "local_ai" ? localAiConn : ollamaConn;
    if (!conn) return;
    setInlineCompletionsDisabled(false);
    setRouting("inline_completion", conn.id);
  };

  return (
    <section className="space-y-2" aria-label="Completions">
      <div className="flex items-center gap-2">
        <InlineCompletionIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium">Completions</span>
      </div>
      <div
        role="radiogroup"
        aria-label="Completion provider"
        className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-muted/30"
      >
        {COMPLETION_OPTIONS.map((opt) => {
          const active = opt.value === activeOption;
          const disabled = isDisabled(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={opt.label}
              disabled={disabled}
              onClick={() => handleSelect(opt.value)}
              title={
                disabled ? `${opt.label} — not configured` : opt.label
              }
              className={cn(
                "flex-1 text-[10px] h-6 px-2 rounded-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                disabled && "opacity-40 cursor-not-allowed hover:text-muted-foreground",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Comments group
// ---------------------------------------------------------------------------

function CommentsGroup({
  comments,
  onOpenCommentList,
}: {
  comments: Comment[];
  onOpenCommentList: () => void;
}) {
  const openCount = comments.filter((c) => c.status === "open").length;
  const hasOpen = openCount > 0;

  return (
    <section className="space-y-2" aria-label="Comments">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Comments</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
          {hasOpen
            ? `${openCount} open`
            : comments.length > 0
            ? "none open"
            : "none"}
        </span>
      </div>
      {hasOpen ? (
        <button
          type="button"
          onClick={onOpenCommentList}
          className={cn(
            "w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors",
            "rounded-sm px-2 py-1 hover:bg-muted/50",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          View open comments
        </button>
      ) : (
        <p className="text-[10px] text-muted-foreground/60 leading-tight px-2">
          {comments.length > 0
            ? "All comments handled."
            : "No comments on this document yet."}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Session group
// ---------------------------------------------------------------------------

function LocalAIStatusRow() {
  const serverStatus = useLocalAIStore((s) => s.serverStatus);
  const activeModelId = useLocalAIStore((s) => s.activeModelId);
  const models = useLocalAIStore((s) => s.models);
  const connections = useConnectionsStore((s) => s.connections);

  const hasConnection = connections.some(
    (c) => c.provider === "local_ai" && c.authMethod === "local_bundled",
  );
  if (!hasConnection) return null;

  const activeModel = models.find((m) => m.id === activeModelId);
  const label =
    serverStatus === "running" && activeModel
      ? `Running (${activeModel.name})`
      : serverStatus === "running"
      ? "Running"
      : serverStatus === "starting"
      ? "Starting…"
      : serverStatus === "error"
      ? "Error"
      : "Stopped";

  // Server-state-driven dot colour. Mirrors the sibling semantics used by
  // `LocalAIIndicator` (legacy full StatusBar) and the `StatusDot` component
  // in the quiet strip: green = running, amber pulse = starting, red = error,
  // neutral = idle. This is the same "content-state" colour exception the
  // other indicators in this file already take — keep the three surfaces in
  // sync so the user sees one story.
  const dot =
    serverStatus === "running"
      ? "bg-green-500"
      : serverStatus === "starting"
      ? "bg-amber-500 animate-pulse"
      : serverStatus === "error"
      ? "bg-red-500"
      : "bg-muted-foreground/30";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)}
        data-testid="local-ai-status-dot"
        data-server-status={serverStatus}
      />
      <span className="truncate">Local AI · {label}</span>
    </div>
  );
}

function ToolCallingRow() {
  const enabled = useSettingsStore((s) => s.toolCallingEnabled);
  const setEnabled = useSettingsStore((s) => s.setToolCallingEnabled);
  return (
    <div className="flex items-center justify-between gap-2">
      <label
        htmlFor="status-tray-tool-calling"
        className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer"
      >
        <Wrench className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span>Tool calling</span>
      </label>
      <Switch
        id="status-tray-tool-calling"
        checked={enabled}
        onCheckedChange={setEnabled}
        className="scale-75 origin-center"
      />
    </div>
  );
}

function RecordingRow() {
  const isRecording = useRecordingStore((s) => s.isRecording);
  const isDictating = useRecordingStore((s) => s.isDictating);
  const active = isRecording || isDictating;
  const label = isRecording ? "Recording…" : isDictating ? "Dictating…" : "Idle";
  const dot = active ? "bg-destructive animate-pulse" : "bg-muted-foreground/30";
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Mic className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
      <span className="flex-1">Recording</span>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
      <span className="text-[10px] text-muted-foreground/70 min-w-[60px] text-right">
        {label}
      </span>
    </div>
  );
}

function SessionGroup() {
  return (
    <section className="space-y-2" aria-label="Session">
      <div className="flex items-center gap-2">
        <Cpu className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Session</span>
      </div>
      <div className="space-y-2">
        <LocalAIStatusRow />
        <ToolCallingRow />
        <RecordingRow />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Help group
// ---------------------------------------------------------------------------

function HelpGroup({
  wordCount,
  onShortcutsOpen,
}: {
  wordCount?: number;
  onShortcutsOpen?: () => void;
}) {
  return (
    <section className="space-y-2" aria-label="Help">
      <div className="flex items-center gap-2">
        <HelpCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Help</span>
      </div>
      {onShortcutsOpen && (
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
      )}
      {typeof wordCount === "number" && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70 px-2 tabular-nums">
          <span>{fmtNum(wordCount)} {wordCount === 1 ? "word" : "words"}</span>
          <span aria-hidden="true">·</span>
          <span>{fmtNum(readingTimeMinutes(wordCount))} min read</span>
        </div>
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
  wordCount,
  comments = [],
  onSelectComment,
  onDelegateComment,
  onDelegateAll,
  canDelegate = false,
  onShortcutsOpen,
  initialExpandedGroup,
  editor = null,
  viewMode,
  onToggleViewMode,
}: StatusTrayProps) {
  // Pass-through handlers for the Comments "View open comments" row. We fire
  // a DOM CustomEvent so the host (StatusBar / Layout) can mount the existing
  // `CommentListPopover` without the tray needing to know about its internal
  // open state. If no host listens, the event is a no-op — the tray still
  // closes so the click feels responsive.
  const openCommentList = React.useCallback(() => {
    onOpenChange(false);
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
  }, [
    onOpenChange,
    comments,
    onSelectComment,
    onDelegateComment,
    onDelegateAll,
    canDelegate,
  ]);

  const handleShortcuts = React.useCallback(() => {
    onOpenChange(false);
    onShortcutsOpen?.();
  }, [onOpenChange, onShortcutsOpen]);

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
        virtualRef={anchor as React.RefObject<{ getBoundingClientRect(): DOMRect }>}
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
          <div className="divide-y divide-border">
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
                onOpenCommentList={openCommentList}
              />
            </div>
            <div ref={sessionRef} tabIndex={-1} className="p-3 focus:outline-none">
              <SessionGroup />
            </div>
            <div ref={helpRef} tabIndex={-1} className="p-3 focus:outline-none">
              <HelpGroup wordCount={wordCount} onShortcutsOpen={handleShortcuts} />
            </div>
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
