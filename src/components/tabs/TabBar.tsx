import { useEditorStore } from "@/stores/editor-store";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditorStore();

  if (tabs.length === 0) {
    return null;
  }

  const handleCloseTab = (
    e: React.MouseEvent,
    tabId: string,
    isDirty: boolean
  ) => {
    e.stopPropagation();

    if (isDirty) {
      const confirmed = window.confirm(
        "This file has unsaved changes. Close anyway?"
      );
      if (!confirmed) return;
    }

    closeTab(tabId);
  };

  return (
    <div className="border-b border-border bg-card">
      <Tabs value={activeTabId || undefined} className="w-full">
        <TabsList className="w-full justify-start rounded-none bg-transparent h-auto p-0">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative rounded-none border-r border-border px-4 py-2",
                "data-[state=active]:bg-background data-[state=active]:shadow-none",
                "hover:bg-accent/50 transition-colors"
              )}
            >
              <span className="flex items-center gap-2">
                {tab.isDirty && (
                  <span className="h-2 w-2 rounded-full bg-primary" />
                )}
                <span className="max-w-[150px] truncate">{tab.fileName}</span>
                <button
                  onClick={(e) => handleCloseTab(e, tab.id, tab.isDirty)}
                  className="ml-2 hover:bg-accent rounded-sm p-0.5 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
