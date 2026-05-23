import { useCallback } from "react";
import { TabBar } from "@/components/tabs/TabBar";
import { Editor } from "@/components/editor/Editor";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ActivityRail, ActivityPanel } from "@/components/activity/ActivityStrip";
import { TitleBar } from "@/components/TitleBar";
import { SidebarPanel } from "@/components/SidebarPanel";
import { QuietLayout } from "@/components/QuietLayout";
import { PreviewInvitation } from "@/components/PreviewInvitation";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useSettingsStore } from "@/stores/settings-store";
import { useActivityStore } from "@/stores/activity-store";

// --- Panel size persistence ---

const PANEL_SIZES_KEY = "notesage-panel-sizes";

function layoutConfigKey(panelIds: string[]): string {
  return `main:${[...panelIds].sort().join(",")}`;
}

function savePanelSizes(layout: Record<string, number>) {
  try {
    const key = layoutConfigKey(Object.keys(layout));
    const stored = JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || "{}");
    stored[key] = layout;
    localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(stored));
  } catch {
    // localStorage may be full or unavailable
  }
}

function loadPanelSize(configKey: string, panel: string, fallback: number): number {
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || "{}");
    return stored[configKey]?.[panel] ?? fallback;
  } catch {
    return fallback;
  }
}

// --- EditorArea helper ---

interface EditorAreaProps {
  onNewNote?: () => void;
  onNewProject?: () => void;
  onOpenFolder?: () => void;
  onOpenProject?: (path: string) => void;
  onOpenFile?: (path: string, name: string) => void;
  exportOpen?: boolean;
  onExportOpenChange?: (open: boolean) => void;
  focusMode?: boolean;
  outlineOpen?: boolean;
  onOutlineOpenChange?: (open: boolean) => void;
  updateAvailable?: boolean;
  updateVersion?: string | null;
  onUpdateClick?: () => void;
  onShortcutsOpen?: () => void;
  onOpenActions?: () => void;
}

function EditorArea({
  onNewNote,
  onNewProject,
  onOpenFolder,
  onOpenProject,
  onOpenFile,
  exportOpen,
  onExportOpenChange,
  focusMode,
  outlineOpen,
  onOutlineOpenChange,
  updateAvailable,
  updateVersion,
  onUpdateClick,
  onShortcutsOpen,
  onOpenActions,
}: EditorAreaProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-muted">
      {!focusMode && <TabBar />}
      <div id="editor-content" className="flex-1 min-h-0">
      <Editor
        onNewNote={onNewNote}
        onNewProject={onNewProject}
        onOpenFolder={onOpenFolder}
        onOpenProject={onOpenProject}
        onOpenFile={onOpenFile}
        exportOpen={exportOpen}
        onExportOpenChange={onExportOpenChange}
        focusMode={focusMode}
        outlineOpen={outlineOpen}
        onOutlineOpenChange={onOutlineOpenChange}
        updateAvailable={updateAvailable}
        updateVersion={updateVersion}
        onUpdateClick={onUpdateClick}
        onShortcutsOpen={onShortcutsOpen}
        onOpenActions={onOpenActions}
      />
      </div>
    </div>
  );
}

// --- Layout component ---

export interface LayoutProps {
  focusMode?: boolean;
  stripExpanded: boolean;
  // Editor area callbacks
  onNewNote: (parentPath?: string) => void;
  onNewProject: () => void;
  onOpenFolder: () => void;
  onOpenProject: (path: string) => void;
  onOpenFile: (path: string, name: string) => void;
  // Export
  exportOpen: boolean;
  onExportOpenChange: (open: boolean) => void;
  // Outline
  outlineOpen: boolean;
  onOutlineOpenChange: (open: boolean) => void;
  // Update
  updateAvailable: boolean;
  updateVersion: string | null;
  onUpdateClick: () => void;
  // Misc
  onShortcutsOpen: () => void;
  onOpenActions: () => void;
  onOpenSettings: () => void;
  onBrowseForProject: () => void;
  onOpenProjectSettings: (path: string) => void;
  onMakeProject: (path: string) => void;
  onExportFile: (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => void;
  // Activity
  onCancelTask: (taskId: string) => Promise<void>;
  onClickTask: (task: import("@/stores/activity-store").AgentTask) => void;
}

/**
 * Pure helper: whether the caller should render the legacy chrome
 * (TabBar, ChatPanel, ActivityStrip/Rail, ChatFooter) for the given
 * `uiPreview` value. The Quiet Composer preview (task #74) swaps in
 * equivalent surfaces — FloatingCommandBar, AgentOrb, etc. — so the
 * legacy components are preview-gated until Phase 3 full deletion.
 *
 * Exported for unit testing.
 */
export function shouldRenderLegacyChrome(uiPreview: string): boolean {
  return uiPreview !== "quiet-composer";
}

export function Layout(props: LayoutProps) {
  // UI refresh preview flag (PRD `2026-04-21-ui-refresh`, task #5).
  //
  // Preview gate (#74): when `uiPreview === "quiet-composer"` we short-
  // circuit to `QuietLayout` before any legacy panel mounts. That means
  // `TabBar`, `ChatPanel`, `ActivityRail`, `ActivityPanel`, and the
  // `ChatFooter` (rendered inside `ChatPanel`) never hit the DOM in
  // the preview. Components remain in code and render on the legacy
  // path until Phase 3 full deletion. Default "legacy" preserves
  // today's tree.
  const uiPreview = useSettingsStore((s) => s.uiPreview);
  if (!shouldRenderLegacyChrome(uiPreview)) {
    return <QuietLayout {...props} />;
  }

  return <LegacyLayout {...props} />;
}

function LegacyLayout({
  focusMode,
  stripExpanded,
  onNewNote,
  onNewProject,
  onOpenFolder,
  onOpenProject,
  onOpenFile,
  exportOpen,
  onExportOpenChange,
  outlineOpen,
  onOutlineOpenChange,
  updateAvailable,
  updateVersion,
  onUpdateClick,
  onShortcutsOpen,
  onOpenActions,
  onOpenSettings,
  onBrowseForProject,
  onOpenProjectSettings,
  onMakeProject,
  onExportFile,
  onCancelTask,
  onClickTask,
}: LayoutProps) {
  const chatPanelOpen = useSettingsStore((s) => s.chatPanelOpen);
  const setChatPanelOpen = useSettingsStore((s) => s.setChatPanelOpen);

  const handlePanelLayout = useCallback((layout: Record<string, number>) => {
    savePanelSizes(layout);
  }, []);

  const handleToggleChat = useCallback(() => {
    const current = useSettingsStore.getState().chatPanelOpen;
    setChatPanelOpen(!current);
  }, [setChatPanelOpen]);

  const handleToggleActivityStrip = useCallback(() => {
    const store = useActivityStore.getState();
    store.setManuallyHidden(!store.isManuallyHidden);
  }, []);

  // Panel config key (editor + optional chat + optional activity)
  const configKey = layoutConfigKey([
    "editor",
    ...(chatPanelOpen ? ["chat"] : []),
    ...(stripExpanded ? ["activity"] : []),
  ]);

  return (
    <>
      {/* Left: SidebarPanel — full window height, rail + drawer (hidden in focus mode) */}
      {!focusMode && (
        <ErrorBoundary name="Sidebar">
          <SidebarPanel
            onOpenSettings={onOpenSettings}
            onNewNote={onNewNote}
            onNewProject={onNewProject}
            onOpenExistingProject={onBrowseForProject}
            onOpenProjectSettings={onOpenProjectSettings}
            onMakeProject={onMakeProject}
            onExportFile={onExportFile}
          />
        </ErrorBoundary>
      )}

      {/* Right: Title bar + editor + chat */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!focusMode && (
          <TitleBar
            onToggleChat={handleToggleChat}
            onToggleActivityStrip={handleToggleActivityStrip}
          />
        )}

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <ResizablePanelGroup
            orientation="horizontal"
            className="flex h-full w-full"
            onLayoutChanged={handlePanelLayout}
          >
            <ResizablePanel
              id="editor"
              defaultSize={loadPanelSize(configKey, "editor", chatPanelOpen || stripExpanded ? 65 : 100)}
              minSize={300}
            >
              <ErrorBoundary name="Editor">
                <EditorArea
                  onNewNote={onNewNote}
                  onNewProject={onNewProject}
                  onOpenFolder={onOpenFolder}
                  onOpenProject={onOpenProject}
                  onOpenFile={onOpenFile}
                  exportOpen={exportOpen}
                  onExportOpenChange={onExportOpenChange}
                  focusMode={focusMode}
                  outlineOpen={outlineOpen}
                  onOutlineOpenChange={onOutlineOpenChange}
                  updateAvailable={updateAvailable}
                  updateVersion={updateVersion}
                  onUpdateClick={onUpdateClick}
                  onShortcutsOpen={onShortcutsOpen}
                  onOpenActions={onOpenActions}
                />
              </ErrorBoundary>
            </ResizablePanel>

            {chatPanelOpen && !focusMode && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel
                  id="chat"
                  defaultSize={loadPanelSize(configKey, "chat", 35)}
                  minSize="450px"
                  maxSize="50%"
                >
                  <ErrorBoundary name="Chat">
                    <ChatPanel />
                  </ErrorBoundary>
                </ResizablePanel>
              </>
            )}

            {stripExpanded && !focusMode && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel
                  id="activity"
                  defaultSize={loadPanelSize(configKey, "activity", 25)}
                  minSize={240}
                  maxSize={500}
                >
                  <ActivityPanel
                    onCancelTask={onCancelTask}
                    onClickTask={onClickTask}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>

          {/* Activity rail — narrow 40px strip, always visible */}
          {!focusMode && !stripExpanded && <ActivityRail />}
        </div>
      </div>

      {/*
        Preview invitation banner (PRD `2026-04-21-ui-refresh`, task #97).
        Floating bottom-centre overlay that nudges legacy users to try the
        Quiet Composer preview. Self-gates on `shouldShowPreviewInvitation`,
        so this mount is cheap when the banner has nothing to render. Not
        mounted in `QuietLayout` — users already on the new UI don't need
        to be invited. Hidden in focus mode to avoid distractions.
       */}
      {!focusMode && <PreviewInvitation />}
    </>
  );
}
