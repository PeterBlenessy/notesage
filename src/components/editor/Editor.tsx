import { useEffect, useCallback, useRef, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useEditorViewport } from "@/hooks/useEditorViewport";
import { useTypewriterScroll } from "@/hooks/useTypewriterScroll";
import { EditorContent } from "@tiptap/react";
import { EditorStateCache } from "@/lib/editor-state-cache";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorZoom } from "@/hooks/useEditorZoom";
import { useEditor } from "@/hooks/useEditor";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useExportOperations } from "@/hooks/useExportOperations";
import { useDiffReview } from "@/hooks/useDiffReview";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useUnresolvedDocCreate } from "@/hooks/useUnresolvedDocCreate";
import { useCommentEditorSync } from "@/hooks/useCommentEditorSync";
import { useEditorCompletions } from "@/hooks/useEditorCompletions";
import { useEditorTabContentLoader } from "@/hooks/useEditorTabContentLoader";
import { useEditorTypography } from "@/hooks/useEditorTypography";
import { useEditorImageDrop } from "@/hooks/useEditorImageDrop";
import { useEditorKeyBindings } from "@/hooks/useEditorKeyBindings";
import { useFileWatcherIntegration } from "@/hooks/useFileWatcherIntegration";
import { useEditorTabSwitch } from "@/hooks/useEditorTabSwitch";
import type { EditorView as CMEditorView } from "@codemirror/view";
import {
  PAGE_HF_CLICK_EVENT,
  PAGE_BREAKS_RECALC_EVENT,
} from "@/components/editor/extensions";
import type { PageHFClickDetail } from "@/components/editor/extensions";
import { FOCUS_EDITOR_EVENT } from "@/lib/editor-events";
import { usePageSettings } from "@/hooks/usePageSettings";
import { useActiveProject } from "@/hooks/useActiveProject";
const ExportDialog = lazy(() => import("@/components/ExportDialog").then(m => ({ default: m.ExportDialog })));
import { Toolbar } from "./Toolbar";
import { MarkdownPreview } from "./MarkdownPreview";
import { SourceModeEditor } from "./SourceModeEditor";
import { ImageInsertDialog } from "./ImageInsertDialog";
import { TableHeaderMenu } from "./TableHeaderMenu";
import { PageHeaderFooterEditor } from "./PageHeaderFooterEditor";
import { tauriApi } from "@/lib/tauri";
import { track } from "@/lib/telemetry";
import { setEditorRef } from "@/lib/editor-bridge";
import { CONTENT_WIDTHS, CONTENT_HEIGHTS, PX_PER_CM } from "./editor-utils";
import { EditorViewerContainer } from "./EditorViewerContainer";
import { EditorEmptyState } from "./EditorEmptyState";
import { BubbleMenu } from "./BubbleMenu";
import { FindBar } from "./FindBar";
import { DiffReviewPill } from "./DiffReviewPill";
import { EditorCommentPopover } from "./EditorCommentPopover";
import { EditorDatePicker } from "./EditorDatePicker";
import { SidebarStatusBar } from "./StatusBar";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { DocumentOutline } from "@/components/DocumentOutline";
import { getDocumentDir } from "@/lib/image-utils";
import { toast } from "sonner";
import "@/styles/editor.css";

interface EditorProps {
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
  onShortcutsOpen?: () => void;
  onOpenActions?: () => void;
}

export function Editor({ onNewNote, onNewProject, onOpenFolder, onOpenProject, onOpenFile, exportOpen, onExportOpenChange, focusMode, outlineOpen, onOutlineOpenChange, onShortcutsOpen, onOpenActions }: EditorProps) {
  const openDocuments = useEditorStore((s) => s.openDocuments);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const updateTabContent = useEditorStore((s) => s.updateTabContent);
  const setFrontmatter = useEditorStore((s) => s.setFrontmatter);
  const recentFiles = useEditorStore((s) => s.recentFiles);
  const externalChanges = useEditorStore((s) => s.externalChanges);
  const clearExternalChange = useEditorStore((s) => s.clearExternalChange);
  const toggleViewMode = useEditorStore((s) => s.toggleViewMode);
  const recentProjects = useWorkspaceStore((s) => s.recentProjects);
  const showFloatingToolbar = useSettingsStore((s) => s.showFloatingToolbar);
  const toolbarVisible = useSettingsStore((s) => s.toolbarVisible);
  const contentWidth = useSettingsStore((s) => s.contentWidth);
  const marginTop = useSettingsStore((s) => s.marginTop);
  const marginBottom = useSettingsStore((s) => s.marginBottom);
  const marginLeft = useSettingsStore((s) => s.marginLeft);
  const marginRight = useSettingsStore((s) => s.marginRight);
  const printLayout = useSettingsStore((s) => s.printLayout);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const sourceWordWrap = useSettingsStore((s) => s.sourceWordWrap);
  const setSourceWordWrap = useSettingsStore((s) => s.setSourceWordWrap);
  const { zoom: editorZoom } = useEditorZoom();
  const { projectPath } = useActiveProject();
  const commentStorageRoot = projectPath ?? (notesRootPath && !notesRootPath.startsWith('~') ? notesRootPath : null);
  const { saveFile } = useFileOperations();
  const maxWidth = CONTENT_WIDTHS[contentWidth];
  const isPaperMode = contentWidth === 'a4' || contentWidth === 'a5' || contentWidth === 'letter';
  const pageHeight = isPaperMode ? CONTENT_HEIGHTS[contentWidth] : undefined;
  const activeTab = openDocuments.find((tab) => tab.id === activeTabId);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // On-demand + background content loading for editor tabs (extracted).
  useEditorTabContentLoader({ activeTab, activeTabId, openDocuments });

  // NOTE: theme reactivity for the preview surface was attempted but removed —
  // depending on `activeTab.previewState` caused the effect to re-fire each
  // time the state cycled (loading → ready), producing 3 backend preview calls
  // per file open instead of 1. The brief preview window (typically <2s)
  // means a theme mismatch during a mid-window toggle is rarely visible; the
  // hydrated editor reads CSS variables and reflows correctly. Revisit if
  // user feedback shows the gap matters.

  // Viewport controller: scroll persistence + cursor guard + resize (extracted).
  const {
    isProgrammaticScroll,
    lastLoadedTabId,
    restoreScrollRatio,
    saveOutgoingTabScroll,
  } = useEditorViewport({
    scrollAreaRef,
    contentRef,
    activeTabId,
    activeTabFilePath: activeTab?.filePath,
  });
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [cmView, setCmView] = useState<CMEditorView | null>(null);

  // Convert cm margins to px.
  // In print layout mode, top/bottom padding is 0 — margin decorations handle it.
  const isPrintLayout = isPaperMode && printLayout;
  const paddingTop = isPrintLayout ? '0px' : `${marginTop * PX_PER_CM}px`;
  const paddingBottom = isPrintLayout ? '0px' : `${marginBottom * PX_PER_CM}px`;
  const paddingLeft = `${marginLeft * PX_PER_CM}px`;
  const paddingRight = `${marginRight * PX_PER_CM}px`;

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
    documentDir: activeTab ? getDocumentDir(activeTab.filePath) : undefined,
  });

  // Proactively grant the active document's directory asset-protocol scope so
  // its images (asset.localhost URLs) load on first paint instead of waiting for
  // the startup `useStartWatchers` grant to win the race (which left images as
  // broken placeholders until a manual refresh). Idempotent on the Rust side;
  // the per-image `error` self-heal in local-image.ts is the safety net for
  // images that still race or sit outside the doc dir.
  useEffect(() => {
    const dir = activeTab ? getDocumentDir(activeTab.filePath) : null;
    if (dir) void tauriApi.allowAssetDir(dir).catch(() => {});
    // Keyed on the path only — re-running on every content edit is pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.filePath]);

  // Typewriter scrolling (Settings > Writing) — keeps the caret vertically
  // centered in the scroll viewport while typing. No-op unless the setting
  // is on; while on, useCursorScrollGuard stands down (see that hook).
  useTypewriterScroll(editor, scrollAreaRef);

  const { exportPdf, exportPptx, isExporting } = useExportOperations(editor);
  // Branch diff review — the hook drives the inline diff decorations via its
  // own effects; the returned state + handlers feed the DiffReviewPill
  // (persistent "review is running" affordance) rendered below.
  const diffReview = useDiffReview(editor);
  const { settings: pageSettings, updateSettings: updatePageSettings } = usePageSettings(editor);
  const [hfEditState, setHfEditState] = useState<{ type: 'header' | 'footer'; page: number; zoneElement: HTMLDivElement } | null>(null);
  const hfEditStateRef = useRef(hfEditState);
  hfEditStateRef.current = hfEditState;
  useFileWatcher();
  useUnresolvedDocCreate();
  // Inline completions: Copilot LSP (Tiptap + CodeMirror) + local FIM (extracted).
  useEditorCompletions(editor, cmView);
  // Finder → editor image drops (HTML5 drag events, scoped to the editor's
  // scroll area so command-bar / sidebar drops keep their own handlers).
  useEditorImageDrop(editor, scrollAreaRef);

  // Expose editor instance for tool executor access (comment tools, etc.)
  useEffect(() => {
    setEditorRef(editor);
    return () => setEditorRef(null);
  }, [editor]);

  // Listen for header/footer zone click events from the decoration DOM
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PageHFClickDetail>).detail;
      const zone = detail.zoneElement;
      zone.classList.add('page-hf-editing');
      setHfEditState({ type: detail.type, page: detail.page, zoneElement: zone });
    };
    window.addEventListener(PAGE_HF_CLICK_EVENT, handler);
    return () => window.removeEventListener(PAGE_HF_CLICK_EVENT, handler);
  }, []);

  // Listen for `notesage:focus-editor` events. Fired by callers that
  // open a new tab AND want the cursor to land in the editor instead
  // of falling to body — e.g., the Quiet sidebar's inline-create flow
  // (`ProjectsSection.handleCreateCommit`). Without this, after the
  // SidebarInlineEdit input commits and unmounts, focus has nowhere
  // to inherit so it lands on body, leaving the cursor outside the
  // editor. PRD-less bug fix tracked in
  // `docs/tasks/2026-04-28-quiet-composer-phase2-keyboard-blockers-tasks.md`
  // task #6.
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      editor.commands.focus();
    };
    window.addEventListener(FOCUS_EDITOR_EVENT, handler);
    return () => window.removeEventListener(FOCUS_EDITOR_EVENT, handler);
  }, [editor]);

  const closeHfEditor = useCallback(() => {
    const state = hfEditStateRef.current;
    if (!state) return;
    state.zoneElement.classList.remove('page-hf-editing');
    setHfEditState(null);
    // Trigger recalculation to rebuild decorations with updated content
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event(PAGE_BREAKS_RECALC_EVENT));
    });
  }, []);

  // Close header/footer editor on tab switch
  useEffect(() => { closeHfEditor(); }, [activeTabId]);

  // Keyboard shortcuts + find bar
  const {
    findBarOpen,
    findMatchCount,
    findCurrentMatch,
    findInitialQuery,
    findReplaceExpanded,
    setFindReplaceExpanded,
    handleFindSearch,
    handleFindNext,
    handleFindPrevious,
    handleFindReplace,
    handleFindReplaceAll,
    handleFindClose,
    handleToggleViewMode,
  } = useEditorKeyBindings({
    editor,
    activeTab: activeTab ?? null,
    saveFile,
    updateTabContent,
    toggleViewMode,
  });

  // Comments — the full sync bundle drives the EditorCommentPopover; only the
  // pieces the status bar + tab-switch hook need are destructured here.
  const commentSync = useCommentEditorSync(editor);
  const { commentOps, delegateComment, delegateAll, canDelegate, savedSuggestionsRef } = commentSync;
  /**
   * Per-file ProseMirror EditorState cache — preserves undo/redo, selection,
   * and plugin state across tab switches AND across single-doc-shell evictions
   * (Quiet Composer opens evict the previous tab, minting a new tab.id; keying
   * by filePath keeps the cache reachable across the re-open).
   */
  const cachedEditorStatesRef = useRef(new EditorStateCache());

  // External change detection + inline diff review. The hook drives
  // auto-reload / inline-diff decorations via its own effects; its return
  // values fed the removed StatusBar full variant (#415), so we call it for
  // side effects only.
  useFileWatcherIntegration({
    editor,
    activeTab: activeTab ?? null,
    cachedEditorStatesRef,
    updateTabContent,
    clearExternalChange,
    saveFile,
    externalChanges,
  });

  // Tab switch, scroll-to-tag/text, source↔WYSIWYG, page position
  useEditorTabSwitch({
    editor,
    activeTab: activeTab ?? null,
    cachedEditorStatesRef,
    savedSuggestionsRef,
    scrollAreaRef,
    isProgrammaticScroll,
    lastLoadedTabId,
    saveOutgoingTabScroll,
    restoreScrollRatio,
    externalChanges,
    updateTabContent,
    clearExternalChange,
    setImageDialogOpen,
    isPaperMode,
    marginTop,
    marginBottom,
    pageHeight,
  });

  // Auto-save on blur (when switching tabs or focus changes)
  useEffect(() => {
    const handleBlur = async () => {
      if (activeTab && activeTab.isDirty) {
        try {
          await saveFile(activeTab.filePath, activeTab.content, activeTab.id);
        } catch (error) {
          toast.error(`Auto-save failed: ${error}`);
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

  // Typography controller: per-block CSS vars + per-document `style:` presets
  // (owns its own editor-styles-store reads; must run before early returns).
  const typographyCssVars = useEditorTypography(activeTab);

  if (!activeTab) {
    return (
      <EditorEmptyState
        recentProjects={recentProjects}
        recentFiles={recentFiles}
        onNewNote={onNewNote}
        onNewProject={onNewProject}
        onOpenFolder={onOpenFolder}
        onOpenProject={onOpenProject}
        onOpenFile={onOpenFile}
      />
    );
  }

  // Show error state for tabs whose files could not be loaded from disk
  if (activeTab && activeTab.loadError) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
          <span>
            {/not found|no such file/i.test(activeTab.loadError)
              ? "File not found"
              : "Could not open file"}
          </span>
          <span className="text-xs max-w-md text-center truncate opacity-60">{activeTab.filePath}</span>
          {/* Surface the actual backend error (e.g. "Permission denied", "Is a
              directory") instead of always claiming "not found" (audit a11y L5). */}
          <span className="text-xs max-w-md text-center break-words font-mono opacity-50">{activeTab.loadError}</span>
        </div>
        {!focusMode && (
          <SidebarStatusBar editor={null} onShortcutsOpen={onShortcutsOpen} onOpenActions={onOpenActions} />
        )}
      </div>
    );
  }

  // Show loading state for placeholder tabs (content not yet loaded from disk)
  if (activeTab && activeTab.contentLoaded === false) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading...
        </div>
        {!focusMode && (
          <SidebarStatusBar editor={null} onShortcutsOpen={onShortcutsOpen} onOpenActions={onOpenActions} />
        )}
      </div>
    );
  }

  // Route non-markdown file types to their viewers
  if (activeTab && activeTab.fileType !== "markdown") {
    return (
      <EditorViewerContainer
        activeTab={activeTab}
        focusMode={!!focusMode}
        onOpenFile={onOpenFile}
        onShortcutsOpen={onShortcutsOpen}
        onOpenActions={onOpenActions}
        updateTabContent={updateTabContent}
        saveFile={saveFile}
      />
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
      {activeTab?.viewMode === "source" ? (
        <SourceModeEditor
          tabId={activeTab.id}
          content={activeTab.content}
          frontmatter={activeTab.frontmatter}
          isDirty={activeTab.isDirty}
          filePath={activeTab.filePath}
          sourceWordWrap={sourceWordWrap}
          showFloatingToolbar={showFloatingToolbar}
          updateTabContent={updateTabContent}
          setFrontmatter={setFrontmatter}
          saveFile={saveFile}
          onToggleViewMode={handleToggleViewMode}
          onToggleWordWrap={() => setSourceWordWrap(!sourceWordWrap)}
          onCmViewChange={setCmView}
        />
      ) : (
        <div className="flex-1 overflow-hidden relative">
          {/*
            Quiet Composer pill toolbar (#110). Floats over the document area
            anchored to the top-centre of this `relative` container. Hidden in
            focus mode; source mode renders SourceModeEditor instead so this
            branch is already wysiwyg-only. The StatusTray hosts the source-
            mode toggle for the quiet shell.
          */}
          {toolbarVisible && !focusMode && (
            <div
              data-editor-pill-toolbar
              className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-auto"
            >
              <Toolbar
                editor={editor}
                onImageInsert={() => setImageDialogOpen(true)}
                viewMode={activeTab?.viewMode}
                onToggleViewMode={activeTab?.fileType === "markdown" ? handleToggleViewMode : undefined}
                sourceWordWrap={sourceWordWrap}
                onToggleWordWrap={() => setSourceWordWrap(!sourceWordWrap)}
                variant="pill"
              />
            </div>
          )}
          {/*
            Branch diff review pill — persistent affordance while a review
            session is active (started from the sidebar's "Compare branch…"
            context-menu action). Top-right so it never collides with the
            centred pill toolbar. Hidden in focus mode with the rest of the
            chrome; the sidebar context menu still offers "End branch review".
          */}
          {diffReview.reviewActive && !focusMode && (
            <DiffReviewPill
              compareBranch={diffReview.compareBranch}
              onAcceptAll={() => void diffReview.handleAcceptAll()}
              onEnd={diffReview.endReview}
            />
          )}
          {findBarOpen && activeTab?.fileType === "markdown" && (
            <FindBar
              open={findBarOpen}
              onClose={handleFindClose}
              matchCount={findMatchCount}
              currentMatch={findCurrentMatch}
              onSearch={handleFindSearch}
              onNext={handleFindNext}
              onPrevious={handleFindPrevious}
              replaceEnabled={true}
              replaceExpanded={findReplaceExpanded}
              onReplaceExpandedChange={setFindReplaceExpanded}
              onReplace={handleFindReplace}
              onReplaceAll={handleFindReplaceAll}
              initialQuery={findInitialQuery}
            />
          )}
          <div ref={scrollAreaRef} className="h-full overflow-y-auto">
          {/*
            #142 — `data-editor-scroll-content` lets the
            `.app[data-quiet-chrome-transparent="true"]` rule in globals.css
            push the inner content top padding down so initial markdown
            sits BELOW the absolute frosted title bar at scroll-top, while
            still allowing it to slide UP behind the bar as the user scrolls.
            Without an attribute hook the editor doesn't know it's mounted
            inside QuietLayout's transparent shell.
           */}
          <div
            data-editor-scroll-content
            className={`min-h-full flex justify-center ${
              contentWidth === "full" ? "py-4 px-4" : "py-10 px-8"
            }`}
          >
            <div
              ref={contentRef}
              className={`w-full ${isPaperMode ? 'paper-mode' : ''} ${focusMode ? 'focus-mode' : ''}`}
              style={{
                position: isPaperMode ? 'relative' as const : undefined,
                maxWidth: maxWidth ? `${maxWidth}px` : undefined,
                '--editor-padding-top': paddingTop,
                '--editor-padding-bottom': paddingBottom,
                '--editor-padding-left': paddingLeft,
                '--editor-padding-right': paddingRight,
                '--editor-zoom-multiplier': String(editorZoom),
                // CSS `zoom` only when actually zoomed — applying `zoom: 1`
                // unconditionally triggers WebKit layout containment for
                // every descendant and slows file-load 2-3x on large docs.
                ...(editorZoom !== 1 ? { zoom: editorZoom } : {}),
                ...typographyCssVars,
                ...(pageHeight ? { '--page-height': `${pageHeight}px` } : {}),
              } as React.CSSProperties & Record<`--${string}`, string | undefined>}
            >
              {activeTab && (
                <FrontmatterBlock tabId={activeTab.id} frontmatter={activeTab.frontmatter} />
              )}
              {/*
                Instant-load preview surface (PRD § "Layer 1"). When a markdown
                tab activates we kick off a comrak HTML render in parallel with
                the file read; while the result is on screen the user can scroll
                / select / read while the Tiptap editor finishes hydrating
                invisibly behind us. The editor is kept mounted (just hidden via
                display:none) so its plugins, decorations, and selection state
                are unaffected by the swap — we just toggle which child of the
                same scroll wrapper is visible. State transitions:
                  loading  → editor visible (preview HTML not yet returned)
                  ready    → preview visible, editor hidden
                  hydrated → editor visible, preview unmounted (HTML dropped)
              */}
              {activeTab?.previewState === "ready" && activeTab.previewHtml ? (
                <MarkdownPreview key={activeTab.id} html={activeTab.previewHtml} />
              ) : null}
              <div style={activeTab?.previewState === "ready" ? { display: "none" } : undefined}>
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
          {editor && showFloatingToolbar && <BubbleMenu editor={editor} />}
          {editor && <TableHeaderMenu editor={editor} />}
          {hfEditState && createPortal(
            <PageHeaderFooterEditor
              type={hfEditState.type}
              page={hfEditState.page}
              settings={hfEditState.type === 'header' ? pageSettings.header : pageSettings.footer}
              pageNumberStart={pageSettings.pageNumberStart}
              onUpdate={(updated) => {
                const newSettings = { ...pageSettings };
                newSettings[hfEditState.type] = updated;
                updatePageSettings(newSettings);
              }}
              onPageNumberStartChange={(n) => updatePageSettings({ ...pageSettings, pageNumberStart: n })}
              onClose={closeHfEditor}
            />,
            hfEditState.zoneElement,
          )}
        </div>
        </div>
      )}
      {!focusMode && (
        <SidebarStatusBar
          editor={editor}
          onToggleViewMode={activeTab?.fileType === "markdown" ? handleToggleViewMode : undefined}
          comments={commentOps.comments}
          onSelectComment={(comment) => {
            if (activeTab?.viewMode === "source") {
              // Comments aren't rendered in source mode — offer to switch
              toast("Comments are not available in Raw mode", {
                description: "Switch to Rich text to view and edit comments.",
                action: {
                  label: "Switch",
                  onClick: () => {
                    handleToggleViewMode();
                    // Wait for mode switch and editor re-render, then scroll and activate
                    setTimeout(() => {
                      if (editor) {
                        try {
                          const dom = editor.view.domAtPos(comment.from);
                          const node = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
                          node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        } catch { /* position may be invalid */ }
                        setTimeout(() => commentOps.setActiveComment(comment.id), 300);
                      }
                    }, 200);
                  },
                },
                id: "source-mode-comment",
              });
              return;
            }
            if (editor) {
              // Scroll comment into view, then activate it so the popover positions correctly
              const dom = editor.view.domAtPos(comment.from);
              const node = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
              node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Delay activation so scroll completes and coordsAtPos returns correct position
              setTimeout(() => commentOps.setActiveComment(comment.id), 300);
            } else {
              commentOps.setActiveComment(comment.id);
            }
          }}
          onDelegateComment={async (comment) => {
            if (commentOps.commentKey && commentStorageRoot) {
              await delegateComment(comment, commentOps.commentKey, commentStorageRoot, 'delegate');
            }
          }}
          onDelegateAll={async () => {
            if (commentOps.commentKey && commentStorageRoot) {
              await delegateAll(commentOps.commentKey, commentStorageRoot);
            }
          }}
          canDelegate={canDelegate}
          viewMode={activeTab?.viewMode}
          onShortcutsOpen={onShortcutsOpen}
          onOpenActions={onOpenActions}
        />
      )}
      <DocumentOutline open={outlineOpen ?? false} onOpenChange={(open) => onOutlineOpenChange?.(open)} editor={editor} />
      <Suspense fallback={null}>
        <ExportDialog
          open={exportOpen ?? false}
          onOpenChange={(open) => onExportOpenChange?.(open)}
          onExport={async (options) => {
            if (options.format === 'pptx') {
              await exportPptx(options);
            } else {
              await exportPdf(options);
            }
            onExportOpenChange?.(false);
          }}
          isExporting={isExporting}
        />
      </Suspense>
      <EditorCommentPopover
        editor={editor}
        sync={commentSync}
        activeTab={activeTab}
        commentStorageRoot={commentStorageRoot}
        setFrontmatter={setFrontmatter}
      />
      <ImageInsertDialog
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        documentDir={activeTab ? getDocumentDir(activeTab.filePath) : undefined}
        projectRoot={projectPath ?? undefined}
        onInsert={(src, alt) => {
          if (editor) {
            editor.chain().focus().setImage({ src, alt: alt || undefined }).run();
            track("block_inserted", { kind: "image" });
          }
        }}
      />
      <EditorDatePicker editor={editor} />
    </div>
  );
}
