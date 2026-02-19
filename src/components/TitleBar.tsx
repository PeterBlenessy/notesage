import { MessageSquare } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TitleBarProps {
  onToggleChat: () => void;
}

export function TitleBar({ onToggleChat }: TitleBarProps) {
  const chatPanelOpen = useSettingsStore((s) => s.chatPanelOpen);
  const activeTab = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });

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

      {/* Right: chat toggle */}
      <div className="flex items-center pr-3 shrink-0">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggleChat}
          className={cn(
            "text-muted-foreground hover:text-foreground transition-colors duration-150",
            chatPanelOpen && "text-foreground bg-accent"
          )}
          title={`${chatPanelOpen ? "Hide" : "Show"} AI Chat (⌘⇧A)`}
        >
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}
