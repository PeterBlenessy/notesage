import { MessageSquare, Bot } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { useActivityStore } from "@/stores/activity-store";
import { Button } from "@/components/ui/button";
import { SavedLabel } from "@/components/SavedLabel";
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
  const lastSavedAt = activeTab?.lastSavedAt;

  // Quiet Composer has no DocHead breadcrumb (#131) — the dirty dot and
  // "saved Xs ago" readout moved here so users still see both pieces of
  // info. Rendered in the right zone only when a document is active and
  // the mode is `quiet`. The classic shell keeps its existing TabBar
  // where per-tab dirty dots already live.
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
        <SavedLabel lastSavedAt={lastSavedAt} isDirty={isDirty} />
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
            chatPanelOpen && "text-foreground bg-[var(--color-accent-primary)]/12"
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
            panelExpanded && "text-foreground bg-[var(--color-accent-primary)]/12"
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
        "h-9 flex items-center shrink-0 select-none",
        // #142 — when QuietLayout passes the translucent-chrome
        // classes (`absolute inset-x-0 top-0 z-30`), paint a
        // strongly-translucent backdrop-blur so editor content
        // scrolling behind reads as frosted glass. The earlier
        // `bg-background/70` ratio was too opaque — the bar still
        // read as solid because 70 % background blends with the
        // identical layout-root colour and the blur is barely
        // noticeable. `bg-background/40` (40 % opacity) drops the
        // chrome enough that scrolling content visibly smears
        // through, plus a slightly stronger blur (`xl`) keeps text
        // readable behind the bar.
        props.className?.includes("absolute") &&
          "bg-background/40 backdrop-blur-xl",
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
        Right: chat toggle + activity strip toggle (classic) OR dirty dot
        + "saved Xs ago" (quiet). Both variants never render together —
        `classicControls` is null in quiet mode and `quietDocChrome` is
        null in classic mode.
       */}
      {classicControls}
      {quietDocChrome}
    </div>
  );
}
