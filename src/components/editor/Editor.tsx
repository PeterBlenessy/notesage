import { useEffect, useCallback, useRef, useState, useMemo, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useScrollPersistence } from "@/hooks/useScrollPersistence";
import { useEditorResize } from "@/hooks/useEditorResize";
import { useCursorScrollGuard } from "@/hooks/useCursorScrollGuard";
import { EditorContent } from "@tiptap/react";
import { EditorStateCache } from "@/lib/editor-state-cache";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { useEditorStylesStore, fontFamilyCSS } from "@/stores/editor-styles-store";
import { useEditorZoom } from "@/hooks/useEditorZoom";
import { useEditor } from "@/hooks/useEditor";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useExportOperations } from "@/hooks/useExportOperations";
import { useDiffReview } from "@/hooks/useDiffReview";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useUnresolvedDocCreate } from "@/hooks/useUnresolvedDocCreate";
import { useCommentEditorSync } from "@/hooks/useCommentEditorSync";
import { useCopilotCompletion } from "@/hooks/useCopilotCompletion";
import { useCopilotCompletionCM } from "@/hooks/useCopilotCompletionCM";
import { useLocalCompletion } from "@/hooks/useLocalCompletion";
import { useEditorKeyBindings } from "@/hooks/useEditorKeyBindings";
import { useFileWatcherIntegration } from "@/hooks/useFileWatcherIntegration";
import { useEditorTabSwitch } from "@/hooks/useEditorTabSwitch";
import type { EditorView as CMEditorView } from "@codemirror/view";
import { useCommentStore } from "@/stores/comment-store";
import { useChatStore } from "@/stores/chat-store";
import { getThreadResilient } from "@/lib/chat-tree";
import {
  setPendingCommentRange as setPendingRangeDecoration,
  setSuggestion,
  hasActiveSuggestion,
  PAGE_HF_CLICK_EVENT,
  PAGE_BREAKS_RECALC_EVENT,
} from "@/components/editor/extensions";
import type { PageHFClickDetail } from "@/components/editor/extensions";
import { FOCUS_EDITOR_EVENT } from "@/lib/editor-events";
import { usePageSettings } from "@/hooks/usePageSettings";
import { extractReplacementText, resolveAnchorRange } from "@/lib/pm-replace";
import { useActiveProject } from "@/hooks/useActiveProject";
const ExportDialog = lazy(() => import("@/components/ExportDialog").then(m => ({ default: m.ExportDialog })));
import { Toolbar } from "./Toolbar";
import { MarkdownPreview } from "./MarkdownPreview";
import { SourceModeEditor } from "./SourceModeEditor";
import { ImageInsertDialog } from "./ImageInsertDialog";
import { TableHeaderMenu } from "./TableHeaderMenu";
import { PageHeaderFooterEditor } from "./PageHeaderFooterEditor";
import { tauriApi } from "@/lib/tauri";
import { isBinaryFileType, documentFormat } from "@/lib/file-utils";
import { track } from "@/lib/telemetry";
import { setEditorRef } from "@/lib/editor-bridge";
import { log } from "@/lib/logger";
import { parseFrontmatter, parseDocumentStyle, documentStyleToPresets } from "@/lib/frontmatter";
import { mergePresets } from "@/lib/typography-presets";
import { setBinaryData } from "@/lib/binary-cache";
import { CONTENT_WIDTHS, CONTENT_HEIGHTS, PX_PER_CM } from "./editor-utils";
import { EditorViewerContainer } from "./EditorViewerContainer";
import { EditorEmptyState } from "./EditorEmptyState";
import { BubbleMenu } from "./BubbleMenu";
import { FindBar } from "./FindBar";
import { TranscriptionOverlay } from "./TranscriptionOverlay";
import { CommentPopover } from "./CommentPopover";
import { DatePickerPopover } from "./DatePickerPopover";
import { StatusBar } from "./StatusBar";
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
  const editorStylesPresets = useEditorStylesStore((s) => s.presets);
  const editorStylesDocPresets = useEditorStylesStore((s) => s.documentPresets);
  const editorStylesSetDocPresets = useEditorStylesStore((s) => s.setDocumentPresets);
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

  // On-demand content loading: when a placeholder tab becomes active, load its content from disk.
  useEffect(() => {
    if (!activeTab || activeTab.contentLoaded !== false) return;
    const { id, filePath, fileType } = activeTab;
    const t0 = performance.now();
    const fileName = filePath.split("/").pop() ?? filePath;

    track("document_opened", { format: documentFormat(fileName, fileType) });

    (async () => {
      try {
        if (fileType === "image") {
          useEditorStore.getState().loadTabContent(id, "");
          log.debug("perf:doc-load", "Doc content loaded from disk", { file: fileName, type: fileType, sizeKB: 0, ms: +(performance.now() - t0).toFixed(1) });
          return;
        }
        if (isBinaryFileType(fileType)) {
          const bytes = await tauriApi.readBinaryFile(filePath);
          const sizeKB = +(bytes.length / 1024).toFixed(1);
          setBinaryData(filePath, new Uint8Array(bytes));
          useEditorStore.getState().loadTabContent(id, "");
          log.debug("perf:doc-load", "Doc content loaded from disk", { file: fileName, type: fileType, sizeKB, ms: +(performance.now() - t0).toFixed(1) });
          return;
        }
        const raw = await tauriApi.readFile(filePath);
        const sizeKB = +(new TextEncoder().encode(raw).length / 1024).toFixed(1);
        if (fileType === "markdown") {
          const { frontmatter, content } = parseFrontmatter(raw);
          useEditorStore.getState().loadTabContent(id, content, frontmatter);
        } else {
          useEditorStore.getState().loadTabContent(id, raw);
        }
        log.debug("perf:doc-load", "Doc content loaded from disk", { file: fileName, type: fileType, sizeKB, ms: +(performance.now() - t0).toFixed(1) });
      } catch (err) {
        console.warn("Failed to load tab content:", filePath, err);
        useEditorStore.getState().setTabLoadError(id, String(err));
      }
    })();
  }, [activeTab?.id, activeTab?.contentLoaded]);

  // Background preloading: once the active tab is loaded, preload remaining placeholder tabs
  // so they open instantly when clicked.
  useEffect(() => {
    if (!activeTab || activeTab.contentLoaded === false) return;
    const unloaded = openDocuments.filter((t) => t.contentLoaded === false && t.id !== activeTabId);
    if (unloaded.length === 0) return;

    log.debug("perf:tab-preload", "Starting background preload", { count: unloaded.length });
    const t0 = performance.now();
    let cancelled = false;
    (async () => {
      for (const tab of unloaded) {
        if (cancelled) break;
        const tabT0 = performance.now();
        const fileName = tab.filePath.split("/").pop() ?? tab.filePath;
        try {
          if (tab.fileType === "image") {
            useEditorStore.getState().loadTabContent(tab.id, "");
            log.debug("perf:tab-preload", "Tab preloaded", { file: fileName, type: tab.fileType, sizeKB: 0, ms: +(performance.now() - tabT0).toFixed(1) });
            continue;
          }
          if (isBinaryFileType(tab.fileType)) {
            const bytes = await tauriApi.readBinaryFile(tab.filePath);
            if (cancelled) break;
            setBinaryData(tab.filePath, new Uint8Array(bytes));
            useEditorStore.getState().loadTabContent(tab.id, "");
            log.debug("perf:tab-preload", "Tab preloaded", { file: fileName, type: tab.fileType, sizeKB: +(bytes.length / 1024).toFixed(1), ms: +(performance.now() - tabT0).toFixed(1) });
            continue;
          }
          const raw = await tauriApi.readFile(tab.filePath);
          if (cancelled) break;
          const sizeKB = +(new TextEncoder().encode(raw).length / 1024).toFixed(1);
          if (tab.fileType === "markdown") {
            const { frontmatter, content } = parseFrontmatter(raw);
            useEditorStore.getState().loadTabContent(tab.id, content, frontmatter);
          } else {
            useEditorStore.getState().loadTabContent(tab.id, raw);
          }
          log.debug("perf:tab-preload", "Tab preloaded", { file: fileName, type: tab.fileType, sizeKB, ms: +(performance.now() - tabT0).toFixed(1) });
        } catch (err) {
          console.warn("Failed to preload tab:", tab.filePath, err);
          useEditorStore.getState().setTabLoadError(tab.id, String(err));
        }
      }
      if (!cancelled) {
        log.debug("perf:tab-preload", "All tabs preloaded", { count: unloaded.length, ms: +(performance.now() - t0).toFixed(1) });
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab?.contentLoaded, activeTabId, openDocuments.length]);

  // NOTE: theme reactivity for the preview surface was attempted but removed —
  // depending on `activeTab.previewState` caused the effect to re-fire each
  // time the state cycled (loading → ready), producing 3 backend preview calls
  // per file open instead of 1. The brief preview window (typically <2s)
  // means a theme mismatch during a mid-window toggle is rarely visible; the
  // hydrated editor reads CSS variables and reflows correctly. Revisit if
  // user feedback shows the gap matters.

  const {
    isProgrammaticScroll,
    isResizing,
    lastLoadedTabId,
    restoreScrollRatio,
    saveOutgoingTabScroll,
  } = useScrollPersistence({
    scrollAreaRef,
    activeTabId,
    activeTabFilePath: activeTab?.filePath,
  });

  useCursorScrollGuard(scrollAreaRef);

  useEditorResize({
    contentRef,
    scrollAreaRef,
    isProgrammaticScroll,
    isResizing,
    activeTabId,
    activeTabFilePath: activeTab?.filePath,
    restoreScrollRatio,
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

  const { exportPdf, exportPptx, isExporting } = useExportOperations(editor);
  useDiffReview(editor);
  const { settings: pageSettings, updateSettings: updatePageSettings } = usePageSettings(editor);
  const [hfEditState, setHfEditState] = useState<{ type: 'header' | 'footer'; page: number; zoneElement: HTMLDivElement } | null>(null);
  const hfEditStateRef = useRef(hfEditState);
  hfEditStateRef.current = hfEditState;
  useFileWatcher();
  useUnresolvedDocCreate();
  useCopilotCompletion(editor);
  useCopilotCompletionCM(cmView);
  useLocalCompletion(editor);

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

  // Comments
  const {
    commentOps,
    delegateComment,
    delegateReply,
    cancelDelegation,
    delegateAll,
    moveToChat,
    canDelegate,
    sendChatMessage,
    activeCommentActivities,
    commentPopoverOpen,
    setCommentPopoverOpen,
    pendingCommentRange,
    setPendingCommentRange,
    commentAnchorPos,
    generatedUUIDRef,
    savedSuggestionsRef,
    suggestionActive,
  } = useCommentEditorSync(editor);
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

  // Compute per-block-type CSS variables from typography presets
  // (must be before early returns to satisfy Rules of Hooks)
  const typographyCssVars = useMemo(() => {
    const p = editorStylesDocPresets ?? editorStylesPresets;
    const fc = fontFamilyCSS;
    return {
      // Legacy variables (backwards compat — other CSS rules reference these)
      '--editor-font-family': fc(p.paragraph.fontFamily),
      '--editor-font-size': `${p.paragraph.fontSize}px`,
      '--editor-line-height': String(p.paragraph.lineHeight),
      '--editor-paragraph-spacing': `${p.paragraph.spacingAfter}em`,

      // Paragraph
      '--ns-paragraph-font-family': fc(p.paragraph.fontFamily),
      '--ns-paragraph-font-size': `${p.paragraph.fontSize}px`,
      '--ns-paragraph-font-weight': String(p.paragraph.fontWeight),
      '--ns-paragraph-line-height': String(p.paragraph.lineHeight),
      '--ns-paragraph-spacing-after': `${p.paragraph.spacingAfter}em`,

      // Heading 1
      '--ns-h1-font-family': fc(p.heading1.fontFamily),
      '--ns-h1-font-size': `${p.heading1.fontSize}px`,
      '--ns-h1-font-weight': String(p.heading1.fontWeight),
      '--ns-h1-line-height': String(p.heading1.lineHeight),
      '--ns-h1-spacing-before': `${p.heading1.spacingBefore}em`,
      '--ns-h1-spacing-after': `${p.heading1.spacingAfter}em`,

      // Heading 2
      '--ns-h2-font-family': fc(p.heading2.fontFamily),
      '--ns-h2-font-size': `${p.heading2.fontSize}px`,
      '--ns-h2-font-weight': String(p.heading2.fontWeight),
      '--ns-h2-line-height': String(p.heading2.lineHeight),
      '--ns-h2-spacing-before': `${p.heading2.spacingBefore}em`,
      '--ns-h2-spacing-after': `${p.heading2.spacingAfter}em`,

      // Heading 3
      '--ns-h3-font-family': fc(p.heading3.fontFamily),
      '--ns-h3-font-size': `${p.heading3.fontSize}px`,
      '--ns-h3-font-weight': String(p.heading3.fontWeight),
      '--ns-h3-line-height': String(p.heading3.lineHeight),
      '--ns-h3-spacing-before': `${p.heading3.spacingBefore}em`,
      '--ns-h3-spacing-after': `${p.heading3.spacingAfter}em`,

      // Heading 4
      '--ns-h4-font-family': fc(p.heading4.fontFamily),
      '--ns-h4-font-size': `${p.heading4.fontSize}px`,
      '--ns-h4-font-weight': String(p.heading4.fontWeight),
      '--ns-h4-line-height': String(p.heading4.lineHeight),
      '--ns-h4-spacing-before': `${p.heading4.spacingBefore}em`,
      '--ns-h4-spacing-after': `${p.heading4.spacingAfter}em`,

      // Heading 5
      '--ns-h5-font-family': fc(p.heading5.fontFamily),
      '--ns-h5-font-size': `${p.heading5.fontSize}px`,
      '--ns-h5-font-weight': String(p.heading5.fontWeight),
      '--ns-h5-line-height': String(p.heading5.lineHeight),
      '--ns-h5-spacing-before': `${p.heading5.spacingBefore}em`,
      '--ns-h5-spacing-after': `${p.heading5.spacingAfter}em`,

      // Heading 6
      '--ns-h6-font-family': fc(p.heading6.fontFamily),
      '--ns-h6-font-size': `${p.heading6.fontSize}px`,
      '--ns-h6-font-weight': String(p.heading6.fontWeight),
      '--ns-h6-line-height': String(p.heading6.lineHeight),
      '--ns-h6-spacing-before': `${p.heading6.spacingBefore}em`,
      '--ns-h6-spacing-after': `${p.heading6.spacingAfter}em`,

      // Code block
      '--ns-code-font-family': fc(p.codeBlock.fontFamily),
      '--ns-code-font-size': `${p.codeBlock.fontSize}px`,

      // Blockquote
      '--ns-blockquote-font-family': fc(p.blockquote.fontFamily),
      '--ns-blockquote-font-size': `${p.blockquote.fontSize}px`,
      '--ns-blockquote-font-weight': String(p.blockquote.fontWeight),
    } as Record<`--${string}`, string>;
  }, [editorStylesPresets, editorStylesDocPresets]);

  // Apply per-document typography presets from frontmatter `style:` on tab switch
  useEffect(() => {
    if (!activeTab || activeTab.fileType !== 'markdown') {
      editorStylesSetDocPresets(null);
      return;
    }
    const docStyle = parseDocumentStyle(activeTab.frontmatter);
    if (!docStyle) {
      editorStylesSetDocPresets(null);
      return;
    }
    const partial = documentStyleToPresets(docStyle);
    if (!partial) {
      editorStylesSetDocPresets(null);
      return;
    }
    const merged = mergePresets(partial as Record<string, Partial<import("@/lib/typography-presets").BlockTypeStyle>>, editorStylesPresets);
    editorStylesSetDocPresets(merged);
  }, [activeTab?.id, activeTab?.frontmatter]);

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
          <StatusBar editor={null} onShortcutsOpen={onShortcutsOpen} onOpenActions={onOpenActions} />
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
          <StatusBar editor={null} onShortcutsOpen={onShortcutsOpen} onOpenActions={onOpenActions} />
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
        <StatusBar
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
      <TranscriptionOverlay
        projectPath={projectPath}
        onInsertAtCursor={editor ? (text) => {
          editor.chain().focus().insertContent(text).run();
        } : undefined}
      />
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
      <CommentPopover
        comment={commentOps.activeComment}
        open={commentPopoverOpen}
        anchorPosition={commentAnchorPos}
        canDelegate={canDelegate}
        activities={activeCommentActivities}
        onCancelDelegation={async () => {
          if (commentOps.activeComment && commentOps.commentKey && commentStorageRoot) {
            await cancelDelegation(commentOps.activeComment, commentOps.commentKey, commentStorageRoot);
          }
        }}
        onOpenChange={(open) => {
          setCommentPopoverOpen(open);
          if (!open) {
            commentOps.setActiveComment(null);
            if (pendingCommentRange && editor) {
              setPendingRangeDecoration(editor, null);
            }
            // If we generated a UUID for this popover but the user cancelled, revert it
            if (pendingCommentRange && generatedUUIDRef.current && activeTab) {
              const { id: _id, ...rest } = activeTab.frontmatter ?? {};
              setFrontmatter(activeTab.id, Object.keys(rest).length > 0 ? rest : null);
            }
            generatedUUIDRef.current = false;
            setPendingCommentRange(null);
          }
        }}
        onCreate={async (body) => {
          if (pendingCommentRange) {
            generatedUUIDRef.current = false;
            await commentOps.createComment(body, pendingCommentRange.from, pendingCommentRange.to);
            if (editor) setPendingRangeDecoration(editor, null);
            setPendingCommentRange(null);
          }
        }}
        onChat={async (body) => {
          if (pendingCommentRange && editor && commentOps.commentKey && commentStorageRoot) {
            generatedUUIDRef.current = false;
            const comment = await commentOps.createComment(body, pendingCommentRange.from, pendingCommentRange.to);
            if (editor) setPendingRangeDecoration(editor, null);
            setPendingCommentRange(null);
            if (comment) {
              commentOps.setActiveComment(comment.id);
              await delegateComment(comment, commentOps.commentKey, commentStorageRoot, 'chat');
            }
          }
        }}
        onDelegate={async (body) => {
          if (pendingCommentRange && editor && commentOps.commentKey && commentStorageRoot) {
            generatedUUIDRef.current = false;
            const comment = await commentOps.createComment(body, pendingCommentRange.from, pendingCommentRange.to);
            if (editor) setPendingRangeDecoration(editor, null);
            setPendingCommentRange(null);
            if (comment) {
              await delegateComment(comment, commentOps.commentKey, commentStorageRoot, 'delegate');
            }
          }
        }}
        onDelegateExisting={() => {
          const comment = commentOps.activeComment;
          const key = commentOps.commentKey;
          if (comment && key && commentStorageRoot) {
            // Close popover and clear active comment BEFORE delegation starts
            setCommentPopoverOpen(false);
            commentOps.setActiveComment(null);
            // Delegate async after popover is closed
            delegateComment(comment, key, commentStorageRoot, 'delegate');
          }
        }}
        onChatExisting={async () => {
          if (commentOps.activeComment && commentOps.commentKey && commentStorageRoot) {
            await delegateComment(commentOps.activeComment, commentOps.commentKey, commentStorageRoot, 'chat');
          }
        }}
        suggestionActive={suggestionActive}
        onMoveToChat={() => {
          if (commentOps.activeComment) {
            // Find project path for this document
            const ws = useWorkspaceStore.getState();
            const tab = useEditorStore.getState().openDocuments.find((t) => t.id === useEditorStore.getState().activeTabId);
            const projectPath = ws.projects.find((p) => tab?.filePath?.startsWith(p.path + '/'))?.path;
            moveToChat(commentOps.activeComment, projectPath, commentStorageRoot ?? undefined);
          }
        }}
        onReply={async (text) => {
          if (!commentOps.activeComment) return;

          // If comment is linked to a chat conversation, route reply through chat
          const freshComments = useCommentStore.getState().commentsByDocument[commentOps.commentKey ?? ''] ?? [];
          const freshComment = freshComments.find((c) => c.id === commentOps.activeComment!.id);

          if (freshComment?.linkedConversationId) {
            const chatStore = useChatStore.getState();
            const conv = chatStore.conversations.find((c) => c.id === freshComment.linkedConversationId);
            if (conv) {
              chatStore.setActiveConversation(conv.id);
              const threadMessages = getThreadResilient(conv.messages, conv.activeLeafId).thread;
              await sendChatMessage(text, threadMessages);
              emitCmdBarEvent({ type: 'focus' });
              return;
            }
          }

          // Fallback: existing delegation reply flow
          if (commentOps.commentKey && commentStorageRoot && freshComment) {
            await delegateReply(freshComment, text, commentOps.commentKey, commentStorageRoot, 'chat');
          }
        }}
        onDelegateReply={async (text) => {
          if (commentOps.activeComment && commentOps.commentKey && commentStorageRoot) {
            const freshComments = useCommentStore.getState().commentsByDocument[commentOps.commentKey] ?? [];
            const freshComment = freshComments.find((c) => c.id === commentOps.activeComment!.id);
            if (freshComment) {
              await delegateReply(freshComment, text, commentOps.commentKey, commentStorageRoot, 'delegate');
            }
          }
        }}
        onApply={(reply) => {
          if (!editor || !commentOps.activeComment) return;
          if (hasActiveSuggestion(editor)) {
            toast.info('Another suggestion is already active. Accept or reject it first.');
            return;
          }
          const range = resolveAnchorRange(editor, commentOps.activeComment);
          if (!range) {
            toast.error('Cannot find the commented text in the document. It may have been deleted.');
            return;
          }
          const replacementText = extractReplacementText(reply.body);
          const currentText = editor.state.doc.textBetween(range.from, range.to, '\n');
          setSuggestion(editor, range.from, range.to, currentText, replacementText);
        }}
        onResolve={async (commentId) => {
          if (commentOps.commentKey && commentStorageRoot) {
            useCommentStore.getState().setCommentStatus(commentOps.commentKey, commentId, 'resolved');
            await useCommentStore.getState().saveComments(commentOps.commentKey, commentStorageRoot);
          }
        }}
        onEdit={async (commentId, body) => {
          await commentOps.editComment(commentId, body);
        }}
        onDelete={async (commentId) => {
          await commentOps.removeComment(commentId);
        }}
      />
      <ImageInsertDialog
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        documentDir={activeTab ? getDocumentDir(activeTab.filePath) : undefined}
        projectRoot={projectPath ?? undefined}
        onInsert={(src, alt) => {
          if (editor) {
            editor.chain().focus().setImage({ src, alt: alt || undefined }).run();
          }
        }}
      />
      <DatePickerPopover
        onDateChange={(oldDate, newDate, from, to) => {
          if (!editor) return;
          const newText = `//${newDate}`;
          if (from >= 0 && to >= 0) {
            // Use the exact ProseMirror position from the click handler
            editor
              .chain()
              .focus()
              .command(({ tr }) => {
                tr.insertText(newText, from, to);
                return true;
              })
              .run();
          } else {
            // Fallback: search the document for the old date text
            const oldText = `//${oldDate}`;
            const { doc } = editor.state;
            let replaced = false;
            doc.descendants((node, pos) => {
              if (replaced) return false;
              if (!node.isText || !node.text) return;
              const idx = node.text.indexOf(oldText);
              if (idx !== -1) {
                const f = pos + idx;
                const t = f + oldText.length;
                editor
                  .chain()
                  .focus()
                  .command(({ tr }) => {
                    tr.insertText(newText, f, t);
                    return true;
                  })
                  .run();
                replaced = true;
              }
            });
          }
        }}
      />
    </div>
  );
}
