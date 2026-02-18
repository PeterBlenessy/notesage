import { useEffect, useCallback, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { Command, File, FolderDot, Folder, Clock } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore, type ContentWidth } from "@/stores/settings-store";
import { useEditor } from "@/hooks/useEditor";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useExportOperations } from "@/hooks/useExportOperations";
import { useDiffReview } from "@/hooks/useDiffReview";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useGitStore } from "@/stores/git-store";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ExportDialog } from "@/components/ExportDialog";
import { Toolbar } from "./Toolbar";
import { BubbleMenu } from "./BubbleMenu";
import { DiffReviewBanner } from "./DiffReviewBanner";
import { ExternalChangeBanner } from "./ExternalChangeBanner";
import { BranchDiffSelector } from "./BranchDiffSelector";
import { StatusBar } from "./StatusBar";
import { FrontmatterBlock } from "./FrontmatterBlock";
import "@/styles/editor.css";

// 1 CSS px = 1/96 inch, 1 inch = 2.54 cm
const PX_PER_CM = 96 / 2.54;

// Full page widths at 96 CSS DPI (1 CSS px = 1/96 inch)
// ProseMirror padding acts as page margins
const CONTENT_WIDTHS: Record<ContentWidth, number | undefined> = {
  full: undefined,
  auto: 720,
  a4: 794,
  a5: 559,
  letter: 816,
};

// Full page heights at 96 CSS DPI (1 CSS px = 1/96 inch)
const CONTENT_HEIGHTS: Record<string, number> = {
  a4: 1123,
  a5: 794,
  letter: 1056,
};

interface EditorProps {
  onNewNote?: () => void;
  onNewProject?: () => void;
  onOpenFolder?: () => void;
  onOpenProject?: (path: string) => void;
  onOpenFile?: (path: string, name: string) => void;
  exportOpen?: boolean;
  onExportOpenChange?: (open: boolean) => void;
}

export function Editor({ onNewNote, onNewProject, onOpenFolder, onOpenProject, onOpenFile, exportOpen, onExportOpenChange }: EditorProps) {
  const { tabs, activeTabId, updateTabContent, recentFiles, scrollPositions, setScrollPosition, externalChanges, clearExternalChange } = useEditorStore();
  const recentProjects = useWorkspaceStore((s) => s.recentProjects);
  const { showFloatingToolbar, contentWidth, marginTop, marginBottom, marginLeft, marginRight, gitEnabled } = useSettingsStore();
  const { projectPath } = useActiveProject();
  const repo = useGitStore((s) => projectPath ? s.repos[projectPath] : undefined);
  const isGitRepo = repo?.isGitRepo ?? false;
  const { saveFile } = useFileOperations();
  const maxWidth = CONTENT_WIDTHS[contentWidth];
  const isPaperMode = contentWidth === 'a4' || contentWidth === 'a5' || contentWidth === 'letter';
  const pageHeight = isPaperMode ? CONTENT_HEIGHTS[contentWidth] : undefined;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const lastLoadedTabId = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);
  const resizeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [renderedWidth, setRenderedWidth] = useState<number | null>(null);

  // Convert cm margins to px
  const paddingTop = `${marginTop * PX_PER_CM}px`;
  const paddingBottom = `${marginBottom * PX_PER_CM}px`;
  const paddingLeft = `${marginLeft * PX_PER_CM}px`;
  const paddingRight = `${marginRight * PX_PER_CM}px`;

  // Save current scroll position as a ratio (0–1) keyed by file path
  const saveScrollRatio = useCallback(() => {
    const el = scrollAreaRef.current;
    // Skip save during resize or before first tab load (prevents saving 0 on remount)
    if (!el || !activeTab || isResizing.current || !lastLoadedTabId.current) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const ratio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
    setScrollPosition(activeTab.filePath, ratio);
  }, [activeTab, setScrollPosition]);

  // Restore scroll position from the persisted ratio
  const restoreScrollRatio = useCallback((filePath: string, onComplete?: () => void) => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const ratio = scrollPositions[filePath] ?? 0;
    // Double-RAF: first waits for ProseMirror DOM update, second for layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!scrollAreaRef.current) return;
        const maxScroll = scrollAreaRef.current.scrollHeight - scrollAreaRef.current.clientHeight;
        scrollAreaRef.current.scrollTop = ratio * maxScroll;
        onComplete?.();
      });
    });
  }, [scrollPositions]);

  // Save scroll position on scroll events (debounced)
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || !activeTab) return;
    let timeout: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(saveScrollRatio, 150);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(timeout);
    };
  }, [activeTab, saveScrollRatio]);

  // Observe rendered width of content container
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setRenderedWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeTab]);

  // Observe scroll container for resize — suppress scroll saves and restore after settling
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || !activeTab) return;
    const observer = new ResizeObserver(() => {
      isResizing.current = true;
      clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => {
        restoreScrollRatio(activeTab.filePath);
        // Allow saves again after restore has been fully applied (matches double-RAF in restore)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            isResizing.current = false;
          });
        });
      }, 100);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(resizeTimer.current);
    };
  }, [activeTab, restoreScrollRatio]);

  const handleUpdate = useCallback(
    (content: string) => {
      if (activeTab) {
        // Check if content has actually changed
        const hasChanged = content !== activeTab.content;
        updateTabContent(activeTab.id, content, hasChanged);
      }
    },
    [activeTab, updateTabContent]
  );

  const editor = useEditor({
    content: activeTab?.content || "",
    onUpdate: handleUpdate,
    editable: true,
  });

  const { exportPdf, isExporting } = useExportOperations(editor);
  const { reviewActive, compareBranch, handleAcceptAll, handleRejectAll } = useDiffReview(editor);
  useFileWatcher();

  // External change detection — check if the active tab has a pending external change
  const activeExternalContent = activeTab ? externalChanges[activeTab.filePath] : undefined;

  const handleExternalReload = useCallback(() => {
    if (!editor || !activeTab || activeExternalContent === undefined) return;
    editor.commands.setContent(activeExternalContent);
    updateTabContent(activeTab.id, activeExternalContent, false);
    clearExternalChange(activeTab.filePath);
  }, [editor, activeTab, activeExternalContent, updateTabContent, clearExternalChange]);

  const handleExternalKeep = useCallback(() => {
    if (!activeTab) return;
    clearExternalChange(activeTab.filePath);
  }, [activeTab, clearExternalChange]);

  // Update editor content when switching tabs, saving/restoring scroll position
  useEffect(() => {
    if (editor && activeTab && activeTab.id !== lastLoadedTabId.current) {
      // Save scroll position of the tab we're leaving
      saveScrollRatio();

      // Hide scroll area to prevent flicker (content renders at top before scroll restores)
      if (scrollAreaRef.current) {
        scrollAreaRef.current.style.opacity = '0';
      }

      lastLoadedTabId.current = activeTab.id;
      editor.commands.setContent(activeTab.content);

      // Restore scroll position then reveal
      restoreScrollRatio(activeTab.filePath, () => {
        if (scrollAreaRef.current) {
          scrollAreaRef.current.style.opacity = '1';
        }
      });
    }
  }, [activeTab?.id, editor, activeTab, saveScrollRatio, restoreScrollRatio]);

  // Handle Cmd+S to save
  useEffect(() => {
    const handleSave = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activeTab && activeTab.isDirty) {
          try {
            await saveFile(activeTab.filePath, activeTab.content, activeTab.id);
          } catch (error) {
            alert(`Failed to save file: ${error}`);
          }
        }
      }
    };

    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [activeTab, saveFile]);

  // Auto-save on blur (when switching tabs or focus changes)
  useEffect(() => {
    const handleBlur = async () => {
      if (activeTab && activeTab.isDirty) {
        try {
          await saveFile(activeTab.filePath, activeTab.content, activeTab.id);
        } catch (error) {
          console.error("Auto-save failed:", error);
        }
      }
    };

    // Debounced auto-save
    const timeoutId = setTimeout(() => {
      if (activeTab && activeTab.isDirty) {
        handleBlur();
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [activeTab?.content, activeTab?.isDirty, activeTab, saveFile]);

  if (!activeTab) {
    return (
      <div className="h-full overflow-y-auto @container" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="flex min-h-full items-center justify-center">
        <div className="text-center max-w-3xl px-6 py-8">
          <div className="space-y-3 mb-12">
            <img src="/app-icon.svg" alt="Notesage" className="h-14 w-14 mx-auto rounded-xl mb-2" />
            <h2 className="text-xl font-semibold text-foreground">Notesage</h2>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
              Write in a rich markdown editor that feels native to your Mac. Organize your work into projects,
              each with its own structure and settings. When you need a creative partner, bring in AI to improve
              your writing, brainstorm ideas, or summarize long documents — right from the editor.
            </p>
            <p className="text-xs text-muted-foreground/70 max-w-md mx-auto">
              Your files stay on your computer. Pick up where you left off anytime.
            </p>
          </div>
          <div className="grid grid-cols-1 @[768px]:grid-cols-3 gap-3">
            <Card className="text-left flex flex-col">
              <CardHeader className="pb-3 flex-1">
                <CardTitle className="text-base font-semibold inline-flex items-center gap-2">
                  <File className="h-5 w-5 text-foreground" strokeWidth={1.5} />
                  New Note
                </CardTitle>
                <CardDescription className="text-xs">Quickly jot down an idea or start drafting something new in your notes folder</CardDescription>
              </CardHeader>
              <CardFooter className="pt-0">
                <Button variant="outline" size="sm" className="w-full justify-between text-xs" onClick={() => onNewNote?.()}>
                  <span>New Note</span>
                  <span className="inline-flex items-center gap-0.5 shrink-0 ml-2">
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded border text-xs font-semibold text-foreground/50" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
                      <Command className="h-3 w-3" />
                    </kbd>
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded border text-xs font-semibold text-foreground/50" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
                      N
                    </kbd>
                  </span>
                </Button>
              </CardFooter>
            </Card>
            <Card className="text-left flex flex-col">
              <CardHeader className="pb-3 flex-1">
                <CardTitle className="text-base font-semibold inline-flex items-center gap-2">
                  <FolderDot className="h-5 w-5 text-foreground" strokeWidth={1.5} />
                  New Project
                </CardTitle>
                <CardDescription className="text-xs">Organize your work into a dedicated project with its own folder, settings, and AI context</CardDescription>
              </CardHeader>
              <CardFooter className="pt-0">
                <Button variant="outline" size="sm" className="w-full justify-between text-xs" onClick={() => onNewProject?.()}>
                  <span>New Project</span>
                  <span className="inline-flex items-center gap-0.5 shrink-0 ml-2">
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded border text-xs font-semibold text-foreground/50" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
                      <Command className="h-3 w-3" />
                    </kbd>
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded border text-sm font-semibold text-foreground/50 leading-none" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
                      ⇧
                    </kbd>
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded border text-xs font-semibold text-foreground/50" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
                      N
                    </kbd>
                  </span>
                </Button>
              </CardFooter>
            </Card>
            <Card className="text-left flex flex-col">
              <CardHeader className="pb-3 flex-1">
                <CardTitle className="text-base font-semibold inline-flex items-center gap-2">
                  <Folder className="h-5 w-5 text-foreground" strokeWidth={1.5} />
                  Open Folder
                </CardTitle>
                <CardDescription className="text-xs">Browse and edit markdown files in any folder on your computer using the Explorer</CardDescription>
              </CardHeader>
              <CardFooter className="pt-0">
                <Button variant="outline" size="sm" className="w-full justify-between text-xs" onClick={() => onOpenFolder?.()}>
                  <span>Open Folder</span>
                  <span className="inline-flex items-center gap-0.5 shrink-0 ml-2">
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded border text-xs font-semibold text-foreground/50" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
                      <Command className="h-3 w-3" />
                    </kbd>
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded border text-xs font-semibold text-foreground/50" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
                      O
                    </kbd>
                  </span>
                </Button>
              </CardFooter>
            </Card>
          </div>

          {/* Recent sections */}
          {(recentProjects.length > 0 || recentFiles.length > 0) && (
            <div className="space-y-4 text-left mt-6">
              {recentProjects.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Recent Projects
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {recentProjects.map((project) => (
                      <Button
                        key={project.path}
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5"
                        onClick={() => onOpenProject?.(project.path)}
                      >
                        <FolderDot className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                        {project.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {recentFiles.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Recent Notes
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {recentFiles.map((file) => (
                      <Button
                        key={file.path}
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5"
                        onClick={() => onOpenFile?.(file.path, file.name)}
                      >
                        <File className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                        {file.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Privacy note */}
          <div className="pt-[100px]">
            <p className="text-xs text-muted-foreground/50 max-w-md mx-auto leading-relaxed">
              Your files never leave your computer. Notesage reads and writes directly to your local filesystem — no cloud sync, no accounts, no tracking. AI features connect only when you provide an API key.
            </p>
          </div>
        </div>
        </div>
      </div>
    );
  }

  if (!editor) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading editor...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center border-b border-border shrink-0" style={{ backgroundColor: 'var(--color-background)' }}>
        <Toolbar editor={editor} />
        {gitEnabled && isGitRepo && projectPath && !reviewActive && (
          <div className="shrink-0 pr-2">
            <BranchDiffSelector projectPath={projectPath} />
          </div>
        )}
      </div>
      {reviewActive && compareBranch && (
        <DiffReviewBanner
          editor={editor}
          branchName={compareBranch}
          onAcceptAll={handleAcceptAll}
          onRejectAll={handleRejectAll}
        />
      )}
      {activeExternalContent !== undefined && (
        <ExternalChangeBanner onReload={handleExternalReload} onKeep={handleExternalKeep} />
      )}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto editor-scroll-area">
        <div
          className={`min-h-full flex justify-center ${
            contentWidth === "full" ? "py-4 px-4" : "py-10 px-8"
          }`}
        >
          <div
            ref={contentRef}
            className={`w-full ${isPaperMode ? 'paper-mode' : ''}`}
            style={{
              maxWidth: maxWidth ? `${maxWidth}px` : undefined,
              '--editor-padding-top': paddingTop,
              '--editor-padding-bottom': paddingBottom,
              '--editor-padding-left': paddingLeft,
              '--editor-padding-right': paddingRight,
              ...(pageHeight ? { '--page-height': `${pageHeight}px` } : {}),
            } as React.CSSProperties}
          >
            {activeTab && (
              <FrontmatterBlock tabId={activeTab.id} frontmatter={activeTab.frontmatter} />
            )}
            <EditorContent editor={editor} />
          </div>
        </div>
        {editor && showFloatingToolbar && <BubbleMenu editor={editor} />}
      </div>
      <StatusBar editor={editor} maxWidth={maxWidth} renderedWidth={renderedWidth} />
      <ExportDialog
        open={exportOpen ?? false}
        onOpenChange={(open) => onExportOpenChange?.(open)}
        onExport={async (options) => {
          await exportPdf(options);
          onExportOpenChange?.(false);
        }}
        isExporting={isExporting}
      />
    </div>
  );
}
