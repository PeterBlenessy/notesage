import { MessageSquare, Bot } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { useActivityStore } from "@/stores/activity-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TitleBarProps {
  onToggleChat: () => void;
  onToggleActivityStrip: () => void;
}

export function TitleBar({ onToggleChat, onToggleActivityStrip }: TitleBarProps) {
  const chatPanelOpen = useSettingsStore((s) => s.chatPanelOpen);
  const activeTab = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });
  const panelExpanded = useActivityStore((s) => !s.isManuallyHidden);
  const hasRunning = useActivityStore((s) => s.tasks.some((t) => t.status === 'running'));

  const title = activeTab?.fileName ?? "Notesage";

  return (
    <div
      className="h-9 flex items-center shrink-0 select-none"
      data-tauri-drag-region
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

      {/* Right: chat toggle + activity strip toggle */}
      <div className="flex items-center gap-0.5 pr-3 shrink-0">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggleChat}
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
          onClick={onToggleActivityStrip}
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
    </div>
  );
}
