import { MessageSquare, Bot, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { useActivityStore } from "@/stores/activity-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * TitleBar — shared top chrome for both Layout shells.
 *
 * `mode` gates which surface-specific controls render alongside the drag
 * region and the document title:
 *
 * - `"classic"` (default) — renders the chat-toggle + activity-strip-toggle
 *   pair, which drive the legacy ChatPanel and ActivityStrip side regions
 *   inside `Layout.tsx`. The `onToggleChat` and `onToggleActivityStrip`
 *   callbacks are required in this mode.
 *
 * - `"quiet"` — tasks #103 + #124. Quiet Composer replaces the legacy chat
 *   panel with the FloatingCommandBar and the legacy activity strip with the
 *   AgentOrb, both mounted by `QuietLayout.tsx`. The two toggle buttons have
 *   no behaviour in that shell, so hiding them removes dead UI from the top
 *   chrome. Callbacks are not accepted in this mode — the discriminated
 *   union prevents call sites from wiring up handlers that would never fire.
 */
interface ClassicTitleBarProps {
  mode?: "classic";
  onToggleChat: () => void;
  onToggleActivityStrip: () => void;
  /**
   * Optional extra utility classes appended to the root. Used by
   * `QuietLayout` (#132) to switch the bar to absolute positioning
   * when translucent chrome is enabled — accepted on both modes for
   * symmetry but only set in quiet mode today.
   */
  className?: string;
}

interface QuietTitleBarProps {
  mode: "quiet";
  /** See `ClassicTitleBarProps.className`. */
  className?: string;
}

export type TitleBarProps = ClassicTitleBarProps | QuietTitleBarProps;

export function TitleBar(props: TitleBarProps) {
  const mode = props.mode ?? "classic";
  const chatPanelOpen = useSettingsStore((s) => s.chatPanelOpen);
  const activeTab = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });
  const panelExpanded = useActivityStore((s) => !s.isManuallyHidden);
  const hasRunning = useActivityStore((s) => s.tasks.some((t) => t.status === 'running'));

  const title = activeTab?.fileName ?? "Notesage";
  const isDirty = Boolean(activeTab?.isDirty);

  // Quiet Composer has no DocHead breadcrumb (#131) — the dirty dot is
  // the only doc-state signal that lives in the title bar right zone.
  // The "saved Xs ago" readout moved to the StatusBar next to the word
  // count (live-test 2026-04-26) so document state info is consolidated
  // in one place. We also no longer render an em-dash placeholder when
  // `lastSavedAt` is missing — the right zone is simply empty for clean
  // tabs, matching the user's "less visual noise" preference. The
  // classic shell keeps its existing TabBar where per-tab dirty dots
  // already live.
  //
  // Live-test 2026-04-26 — added a small × close-document button next
  // to the dirty dot. Quiet Composer has no TabBar (intentional), so
  // before this there was no clickable affordance to close the active
  // document and return to the landing state. ⌘W still works globally
  // via `useKeyboardShortcuts`; this gives the same action a visible
  // home. The button reuses the same `closeTab` /
  // `setPendingCloseTabId` flow that ⌘W and the legacy TabBar X drive,
  // so warn-if-dirty behaviour is consistent across surfaces.
  const handleCloseActiveTab = () => {
    const editorState = useEditorStore.getState();
    const id = editorState.activeTabId;
    if (!id) return;
    const tab = editorState.openDocuments.find((t) => t.id === id);
    if (tab?.isDirty) {
      editorState.setPendingCloseTabId(id);
      return;
    }
    editorState.closeTab(id);
  };

  const quietDocChrome =
    props.mode === "quiet" && activeTab ? (
      <div className="flex items-center gap-2 pr-3 shrink-0">
        {isDirty ? (
          <span
            role="status"
            aria-label="Unsaved changes"
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--accent, var(--primary))" }}
          />
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCloseActiveTab}
          className={cn(
            "text-xs text-muted-foreground hover:text-foreground",
            // Live-test 2026-04-26 — the X is hover-revealed: invisible
            // at rest, fades in when the user hovers ANY part of the
            // title bar (the `group/titlebar` lives on the outer wrapper).
            // `focus-visible:opacity-100` keeps keyboard users from
            // losing the affordance.
            "opacity-0 group-hover/titlebar:opacity-100 focus-visible:opacity-100",
            "transition-[color,opacity] duration-150",
          )}
          title="Close document (⌘W)"
          aria-label="Close document"
        >
          <X className="size-3.5" strokeWidth={1.5} />
        </Button>
      </div>
    ) : null;

  // Narrow the discriminated union up front so the JSX below can reference
  // the classic-mode callbacks without triggering TS2339 on the quiet-mode
  // variant. The `mode === "quiet"` branch renders no buttons, so these
  // references are unreachable there.
  const classicControls =
    props.mode === "quiet" ? null : (
      <div className="flex items-center gap-0.5 pr-3 shrink-0">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={props.onToggleChat}
          className={cn(
            "text-muted-foreground hover:text-foreground transition-colors duration-150",
            chatPanelOpen && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
          )}
          title={`${chatPanelOpen ? "Hide" : "Show"} AI Chat (⌘⇧C)`}
          aria-label={chatPanelOpen ? "Hide AI Chat" : "Show AI Chat"}
        >
          <MessageSquare className="size-4" strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={props.onToggleActivityStrip}
          className={cn(
            "relative text-muted-foreground hover:text-foreground transition-colors duration-150",
            panelExpanded && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
          )}
          title={`${panelExpanded ? "Hide" : "Show"} Agent Panel (⌘⇧A)`}
          aria-label={panelExpanded ? "Hide Agent Panel" : "Show Agent Panel"}
        >
          <Bot className="size-4" strokeWidth={1.5} />
          {hasRunning && (
            <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-foreground" />
          )}
        </Button>
      </div>
    );

  return (
    <div
      className={cn(
        // `group/titlebar` so the close-document X (and any future
        // hover-revealed chrome) can fade in only when the bar is hovered.
        "group/titlebar h-9 flex items-center shrink-0 select-none",
        // Live-test 2026-04-25 — the title bar is now ALWAYS
        // absolute-positioned by QuietLayout (so the sidebar's right
        // border can run unbroken to y=0). The frosted bg + blur are
        // gated on the user's `quietChromeTransparent` preference via
        // the layout-root data attribute — when on, the bar is
        // translucent and editor content scrolls behind it; when off,
        // the bar is solid with no blur. Sibling selectors in
        // globals.css carry the doc-area's own pt-clearance toggle.
        "bg-background",
        "[[data-quiet-chrome-transparent='true']_&]:bg-background/40",
        "[[data-quiet-chrome-transparent='true']_&]:backdrop-blur-xl",
        props.className,
      )}
      data-tauri-drag-region
      data-titlebar-mode={mode}
    >
      {/* Center: document title (drag region) */}
      <div
        className="flex-1 flex items-center justify-center min-w-0 px-4"
        data-tauri-drag-region
      >
        <span
          className={cn(
            "text-xs truncate",
            activeTab ? "text-foreground font-medium" : "text-muted-foreground"
          )}
          data-tauri-drag-region
        >
          {title}
        </span>
      </div>

      {/*
        Right: chat toggle + activity strip toggle (classic) OR dirty
        dot only (quiet). The "saved Xs ago" readout moved to StatusBar
        (live-test 2026-04-26). Both variants never render together —
        `classicControls` is null in quiet mode and `quietDocChrome` is
        null in classic mode (or when the active tab is clean).
       */}
      {classicControls}
      {quietDocChrome}
    </div>
  );
}
