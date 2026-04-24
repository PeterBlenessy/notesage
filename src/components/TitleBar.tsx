import { MessageSquare, Bot } from "lucide-react";
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
}

interface QuietTitleBarProps {
  mode: "quiet";
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
            chatPanelOpen && "text-foreground bg-accent"
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
            panelExpanded && "text-foreground bg-accent"
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
      className="h-9 flex items-center shrink-0 select-none"
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
        Right: chat toggle + activity strip toggle. Suppressed in Quiet
        Composer (tasks #103 + #124) — the FloatingCommandBar replaces the
        chat panel and the AgentOrb replaces the activity strip, so these
        two buttons would be dead controls in that shell. See the JSDoc on
        `TitleBarProps` above for the rationale.
       */}
      {classicControls}
    </div>
  );
}
