import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { EditorContent } from "@tiptap/react";
import { Command, File, FolderDot, Folder, Clock } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { useRoutingStore } from "@/stores/routing-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore, type ContentWidth } from "@/stores/settings-store";
import { useEditorStylesStore, fontFamilyCSS } from "@/stores/editor-styles-store";
import { useExternalChangeStore } from "@/stores/external-change-store";
import { useEditor } from "@/hooks/useEditor";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useExportOperations } from "@/hooks/useExportOperations";
import { useDiffReview } from "@/hooks/useDiffReview";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useCommentOperations } from "@/hooks/useCommentOperations";
import { useCopilotCompletion } from "@/hooks/useCopilotCompletion";
import { useCopilotCompletionCM } from "@/hooks/useCopilotCompletionCM";
import { useLocalCompletion } from "@/hooks/useLocalCompletion";
import type { EditorView as CMEditorView } from "@codemirror/view";
import { useCommentDelegation } from "@/hooks/useCommentDelegation";
import { useAIOperations } from "@/hooks/useAIOperations";
import { useCommentStore, type DelegationActivity } from "@/stores/comment-store";
import { useChatStore } from "@/stores/chat-store";
import {
  setPendingCommentRange as setPendingRangeDecoration,
  showInlineDiff,
  clearInlineDiff,
  acceptAllDiffHunks,
  rejectAllDiffHunks,
  acceptDiffHunk,
  rejectDiffHunk,
  getInlineDiffHunks,
  setSearchQuery,
  searchNext,
  searchPrevious,
  clearSearch,
  replaceCurrentMatch,
  replaceAllMatches,
  getSearchState,
  setSuggestion,
  hasActiveSuggestion,
} from "@/components/editor/extensions";
import { mapExternalChangeToPM } from "@/lib/external-diff";
import { extractReplacementText, resolveAnchorRange } from "@/lib/pm-replace";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useGitStore } from "@/stores/git-store";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ExportDialog } from "@/components/ExportDialog";
import { Toolbar } from "./Toolbar";
import { SourceEditor } from "./SourceEditor";
import { ImageInsertDialog } from "./ImageInsertDialog";
import { ImageViewer } from "./viewers/ImageViewer";
import { PlainTextViewer } from "./viewers/PlainTextViewer";
import { PdfViewer } from "./viewers/PdfViewer";
import { DocxViewer } from "./viewers/DocxViewer";
import { EpubViewer } from "./viewers/EpubViewer";
import { BubbleMenu } from "./BubbleMenu";

import { SourceBubbleMenu } from "./SourceBubbleMenu";
import { FindBar } from "./FindBar";
import { RecordingBar } from "@/components/recording/RecordingBar";
import { TranscriptionDialog } from "@/components/recording/TranscriptionDialog";
import { useRecording } from "@/hooks/useRecording";
import type { AudioBufferInfo } from "@/lib/tauri";
import { openSearchPanel } from "@codemirror/search";
import { DiffReviewBanner } from "./DiffReviewBanner";
import { BranchDiffSelector } from "./BranchDiffSelector";
import { CommentPopover } from "./CommentPopover";
import { StatusBar } from "./StatusBar";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { parseFrontmatter, serializeFrontmatter } from "@/lib/frontmatter";
import { DocumentOutline } from "@/components/DocumentOutline";
import { getMarkdownFromEditor, loadRawMarkdownIntoEditor } from "@/lib/markdown";
import { getDocumentDir } from "@/lib/image-utils";
import { toast } from "sonner";
import "@/styles/editor.css";

// 1 CSS px = 1/96 inch, 1 inch = 2.54 cm
const PX_PER_CM = 96 / 2.54;

// Stable empty array for Zustand selector fallback (avoids infinite re-render loop)
const EMPTY_ACTIVITIES: DelegationActivity[] = [];

/**
 * Find the ProseMirror position of the Nth occurrence (0-based) of `#tag` in the document.
 * Walks all text nodes and searches for the tag pattern.
 */
function findNthTagInDoc(doc: { descendants: (fn: (node: { isText: boolean; text?: string }, pos: number) => boolean | void) => void }, tag: string, occurrence: number): number | null {
  const needle = `#${tag}`;
  // Characters that can follow a tag name (i.e., the tag ends here)
  const tagTerminators = new Set([' ', '\t', '\n', ',', '.', ';', ':', '!', '?', ')', ']', '}', '"', "'", '`']);
  let found = 0;
  let result: number | null = null;
  doc.descendants((node, pos) => {
    if (result !== null) return false;
    if (!node.isText || !node.text) return;
    let searchFrom = 0;
    while (searchFrom < node.text.length) {
      const idx = node.text.indexOf(needle, searchFrom);
      if (idx === -1) break;
      // Verify the character after the tag name is a terminator or end-of-text
      const afterIdx = idx + needle.length;
      const isEnd = afterIdx >= node.text.length || tagTerminators.has(node.text[afterIdx]) || !/[a-zA-Z0-9_-]/.test(node.text[afterIdx]);
      if (isEnd) {
        if (found === occurrence) {
          result = pos + idx;
          return false;
        }
        found++;
      }
      searchFrom = idx + 1;
    }
  });
  return result;
}

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
  focusMode?: boolean;
  outlineOpen?: boolean;
  onOutlineOpenChange?: (open: boolean) => void;
  updateAvailable?: boolean;
  updateVersion?: string | null;
  onUpdateClick?: () => void;
  onShortcutsOpen?: () => void;
}

export function Editor({ onNewNote, onNewProject, onOpenFolder, onOpenProject, onOpenFile, exportOpen, onExportOpenChange, focusMode, outlineOpen, onOutlineOpenChange, updateAvailable, updateVersion, onUpdateClick, onShortcutsOpen }: EditorProps) {
  const { tabs, activeTabId, updateTabContent, setFrontmatter, recentFiles, scrollPositions, setScrollPosition, externalChanges, clearExternalChange, toggleCopilotForTab, toggleViewMode, setScrollToTag } = useEditorStore();
  const recentProjects = useWorkspaceStore((s) => s.recentProjects);
  const { showFloatingToolbar, toolbarVisible, contentWidth, marginTop, marginBottom, marginLeft, marginRight, gitEnabled, pageBreaks, notesRootPath, sourceWordWrap, setSourceWordWrap } = useSettingsStore();
  const editorStyles = useEditorStylesStore();
  const { projectPath } = useActiveProject();
  const commentStorageRoot = projectPath ?? (notesRootPath && !notesRootPath.startsWith('~') ? notesRootPath : null);
  const repo = useGitStore((s) => projectPath ? s.repos[projectPath] : undefined);
  const isGitRepo = repo?.isGitRepo ?? false;
  const copilotConnection = useRoutingStore((s) => s.getConnectionForUseCase('inline_completion'));
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
  const [pageInfo, setPageInfo] = useState<{ current: number; total: number } | null>(null);
  const [commentListOpen, setCommentListOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [cmView, setCmView] = useState<CMEditorView | null>(null);

  // Source mode: holds the full raw text (frontmatter + body) for CodeMirror
  const [sourceContent, setSourceContent] = useState("");
  // Prevents the init effect from clobbering user edits
  const sourceUserEditRef = useRef(false);

  // Recording state
  const recording = useRecording();
  const [transcriptionDialogOpen, setTranscriptionDialogOpen] = useState(false);
  const [lastBufferInfo, setLastBufferInfo] = useState<AudioBufferInfo | null>(null);

  // Find in document state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findMatchCount, setFindMatchCount] = useState(0);
  const [findCurrentMatch, setFindCurrentMatch] = useState(-1);
  const [findInitialQuery, setFindInitialQuery] = useState("");
  const [findReplaceExpanded, setFindReplaceExpanded] = useState(false);

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
    documentDir: activeTab ? getDocumentDir(activeTab.filePath) : undefined,
  });

  const { exportPdf, isExporting } = useExportOperations(editor);
  const { reviewActive, compareBranch, handleAcceptAll, handleRejectAll } = useDiffReview(editor);
  useFileWatcher();
  useCopilotCompletion(editor);
  useCopilotCompletionCM(cmView);
  useLocalCompletion(editor);

  // Page position: calculate from editor content height and page geometry
  const marginTopPx = marginTop * PX_PER_CM;
  const marginBottomPx = marginBottom * PX_PER_CM;
  const usablePageHeight = pageHeight ? pageHeight - marginTopPx - marginBottomPx : 0;

  useEffect(() => {
    if (!editor || !isPaperMode || !usablePageHeight || !activeTab) {
      setPageInfo(null);
      return;
    }

    const updatePageInfo = () => {
      const el = scrollAreaRef.current;
      if (!el) return;

      // Total content height from the ProseMirror DOM
      const contentHeight = editor.view.dom.scrollHeight;
      const totalPages = Math.max(1, Math.ceil(contentHeight / usablePageHeight));

      // Current page: which page is at the viewport center
      const viewportCenter = el.scrollTop + el.clientHeight / 2;
      const contentOffsetTop =
        editor.view.dom.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      const posInContent = viewportCenter - contentOffsetTop;
      const currentPage = Math.min(
        totalPages,
        Math.max(1, Math.ceil(posInContent / usablePageHeight))
      );
      setPageInfo({ current: currentPage, total: totalPages });
    };

    // Update on scroll
    let timeout: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(updatePageInfo, 100);
    };

    // Update when editor content changes
    const onTransaction = () => {
      clearTimeout(timeout);
      timeout = setTimeout(updatePageInfo, 300);
    };

    const el = scrollAreaRef.current;
    if (el) {
      el.addEventListener('scroll', onScroll, { passive: true });
    }
    editor.on('transaction', onTransaction);

    // Initial calculation — delay to ensure layout is complete
    const initTimeout = setTimeout(updatePageInfo, 200);

    return () => {
      if (el) {
        el.removeEventListener('scroll', onScroll);
      }
      editor.off('transaction', onTransaction);
      clearTimeout(timeout);
      clearTimeout(initTimeout);
    };
  }, [editor, isPaperMode, usablePageHeight, activeTab?.id]);

  // Comments
  const commentOps = useCommentOperations(editor);
  const { delegateComment, delegateReply, cancelDelegation, delegateAll, moveToChat, canDelegate } = useCommentDelegation();
  const { sendChatMessage } = useAIOperations();
  const activeCommentId = commentOps.activeComment?.id ?? null;
  const activeCommentActivities = useCommentStore((s) =>
    activeCommentId ? s.activitiesByComment[activeCommentId] : undefined
  ) ?? EMPTY_ACTIVITIES;
  const [commentPopoverOpen, setCommentPopoverOpen] = useState(false);
  const [pendingCommentRange, setPendingCommentRange] = useState<{ from: number; to: number } | null>(null);
  const [commentAnchorPos, setCommentAnchorPos] = useState<{ top: number; left: number } | null>(null);
  // Track if we generated a UUID for this popover session (to revert on cancel)
  const generatedUUIDRef = useRef(false);
  // Track whether an AI suggestion decoration is active (for Apply collision prevention)
  const [suggestionActive, setSuggestionActiveState] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const check = () => setSuggestionActiveState(hasActiveSuggestion(editor));
    check();
    editor.on('transaction', check);
    return () => { editor.off('transaction', check); };
  }, [editor]);

  // Listen for comment creation requests (Cmd+Shift+M or bubble menu)
  useEffect(() => {
    if (!editor) return;
    const check = () => {
      const pending = commentOps.consumePendingCreate();
      if (pending) {
        setPendingCommentRange(pending);
        commentOps.setActiveComment(null);
        // For project files, ensure document has a UUID before the popover opens.
        // Non-project files use a path hash — no frontmatter modification needed.
        if (commentOps.isProjectFile) {
          generatedUUIDRef.current = !commentOps.documentId;
          commentOps.ensureUUID();
        }
        // Show pending range decoration in the editor
        setPendingRangeDecoration(editor, pending);
        // Position popover at the selection
        const coords = editor.view.coordsAtPos(pending.from);
        setCommentAnchorPos({ top: coords.bottom, left: coords.left });
        setCommentPopoverOpen(true);
      }
    };
    editor.on('transaction', check);
    return () => { editor.off('transaction', check); };
  }, [editor, commentOps]);

  // Listen for comment click (active comment changed)
  useEffect(() => {
    if (commentOps.activeCommentId && commentOps.activeComment && editor) {
      setPendingCommentRange(null);
      setPendingRangeDecoration(editor, null);
      // Position popover at the comment's start
      const coords = editor.view.coordsAtPos(commentOps.activeComment.from);
      setCommentAnchorPos({ top: coords.bottom, left: coords.left });
      setCommentPopoverOpen(true);
    }
  }, [commentOps.activeCommentId, commentOps.activeComment, editor]);

  // Scroll-to-comment: triggered by external navigation (e.g. activity panel click)
  const scrollToCommentId = useCommentStore((s) => s.scrollToCommentId);
  useEffect(() => {
    if (!scrollToCommentId || !editor) return;
    useCommentStore.getState().clearScrollToComment();
    const docId = commentOps.documentId;
    if (!docId) return;
    const comments = useCommentStore.getState().commentsByDocument[docId] ?? [];
    const comment = comments.find((c) => c.id === scrollToCommentId);
    if (!comment) return;
    try {
      const dom = editor.view.domAtPos(comment.from);
      const node = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch { /* position may be invalid */ }
    // Delay activation so scroll completes and coordsAtPos returns correct position
    setTimeout(() => commentOps.setActiveComment(scrollToCommentId), 300);
  }, [scrollToCommentId, editor, commentOps]);

  // External change detection via editor-store
  const activeExternalContent = activeTab ? externalChanges[activeTab.filePath] : undefined;

  // Auto-reload clean tabs; show toast with Reload action for dirty tabs
  useEffect(() => {
    if (!editor || !activeTab || activeExternalContent === undefined) return;

    if (!activeTab.isDirty) {
      // Clean tab: auto-reload silently + toast
      loadRawMarkdownIntoEditor(editor, activeExternalContent);
      updateTabContent(activeTab.id, activeExternalContent, false);
      clearExternalChange(activeTab.filePath);
      toast("File updated from disk", { id: "external-change", description: activeTab.fileName });
    } else {
      // Dirty tab: persistent toast with Reload action
      const filePath = activeTab.filePath;
      const tabId = activeTab.id;
      const content = activeExternalContent;
      toast("File modified externally", {
        id: `external-change-dirty-${filePath}`,
        description: activeTab.fileName,
        duration: 8000,
        action: {
          label: "Reload",
          onClick: () => {
            const currentEditor = editor;
            if (!currentEditor) return;
            loadRawMarkdownIntoEditor(currentEditor, content);
            useEditorStore.getState().updateTabContent(tabId, content, false);
            useEditorStore.getState().clearExternalChange(filePath);
          },
        },
        onDismiss: () => {
          useEditorStore.getState().clearExternalChange(filePath);
        },
      });
    }
  }, [editor, activeTab?.id, activeTab?.isDirty, activeExternalContent, updateTabContent, clearExternalChange]);

  // --- External change review (clean tabs) ---
  // Select the raw record and derive the array in a memo to avoid new-reference infinite loops
  const externalChangesRecord = useExternalChangeStore((s) => s.changes);
  const externalChangesAll = useMemo(() => Object.values(externalChangesRecord), [externalChangesRecord]);
  const activeExternalChange = activeTab ? externalChangesRecord[activeTab.filePath] : undefined;
  const [changeListOpen, setChangeListOpen] = useState(false);
  const lastExternalDecoratedFile = useRef<string | null>(null);

  // When a new external change arrives for the active tab, immediately show
  // inline diffs (red/green decorations) and a toast with Accept / Review.
  // On auto-dismiss the change defers to the status bar tracker.
  //
  // Uses rAF to ensure the editor content is loaded first — when switching tabs,
  // this effect may fire BEFORE the tab-switch effect loads the correct content.
  // Without rAF, mapExternalChangeToPM would diff the previous tab's content
  // against the new file, producing a giant incorrect diff.
  useEffect(() => {
    if (!editor || !activeTab || !activeExternalChange) return;
    if (activeExternalChange.status !== "pending") return;

    const filePath = activeTab.filePath;
    const tabId = activeTab.id;
    const fileName = activeTab.fileName;

    const rafId = requestAnimationFrame(() => {
      // Re-check: the change may have been resolved during the rAF delay
      const currentChange = useExternalChangeStore.getState().getChange(filePath);
      if (!currentChange || currentChange.status !== "pending") return;

      // Compute PM-level diff (this is the single source of truth for display)
      const pmHunks = mapExternalChangeToPM(editor, currentChange.newContent);

      if (pmHunks.length === 0) {
        // Content renders identically at PM level — silently accept the new markdown
        useExternalChangeStore.getState().resolveChange(filePath);
        updateTabContent(tabId, currentChange.newContent, false);
        return;
      }

      // Load decorations and sync store hunks to match PM-level hunks
      showInlineDiff(editor, pmHunks);
      lastExternalDecoratedFile.current = filePath;
      useExternalChangeStore.getState().setHunks(filePath, pmHunks.map(h => ({
        id: h.id,
        charFrom: h.from,
        charTo: h.to,
        deleteText: h.deleteText,
        insertText: h.insertText,
      })));

      // Set to deferred — decorations visible, no banner, tracked in status bar.
      // This prevents the effect from re-firing and is the default resting state.
      useExternalChangeStore.getState().setStatus(filePath, "deferred");

      toast("File changed externally", {
        id: `external-change-${filePath}`,
        description: fileName,
        duration: 8000,
        closeButton: true,
        cancel: {
          label: "Accept",
          onClick: () => {
            const change = useExternalChangeStore.getState().getChange(filePath);
            if (!change) return;
            // Nullify ref and resolve BEFORE dispatching the accept transaction.
            // acceptAllDiffHunks dispatches synchronously, which fires the sync
            // effect's onTransaction listener. Without this guard, the sync effect
            // would also resolve + save, causing a double-save race condition.
            lastExternalDecoratedFile.current = null;
            useExternalChangeStore.getState().resolveChange(filePath);
            acceptAllDiffHunks(editor);
            const markdown = getMarkdownFromEditor(editor);
            updateTabContent(tabId, markdown, true);
            saveFile(filePath, markdown, tabId).catch((err) =>
              console.error("Failed to save after accepting:", err)
            );
          },
        },
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [editor, activeTab?.filePath, activeExternalChange?.timestamp]);

  // Load/unload external change decorations when switching tabs or editor changes
  useEffect(() => {
    if (!editor || !activeTab) return;

    const change = useExternalChangeStore.getState().getChange(activeTab.filePath);

    // Clear decorations from the previous file
    if (lastExternalDecoratedFile.current && lastExternalDecoratedFile.current !== activeTab.filePath) {
      clearInlineDiff(editor);
      lastExternalDecoratedFile.current = null;
    }

    // Load decorations for the incoming tab if it has a pending change
    if (change && change.status !== "pending") {
      // Use rAF to ensure editor content is loaded first (tab-switch sets content synchronously)
      requestAnimationFrame(() => {
        const currentChange = useExternalChangeStore.getState().getChange(activeTab.filePath);
        if (!currentChange) return;
        const hunks = mapExternalChangeToPM(editor, currentChange.newContent);
        if (hunks.length > 0) {
          showInlineDiff(editor, hunks);
          lastExternalDecoratedFile.current = activeTab.filePath;
        }
      });
    }
  }, [editor, activeTab?.id]);

  // Handle accept all for external change review
  const handleExternalAcceptAll = useCallback(async () => {
    if (!editor || !activeTab) return;
    // Nullify ref and resolve BEFORE dispatching — prevents sync effect double-save
    lastExternalDecoratedFile.current = null;
    useExternalChangeStore.getState().resolveChange(activeTab.filePath);
    acceptAllDiffHunks(editor);
    const markdown = getMarkdownFromEditor(editor);
    updateTabContent(activeTab.id, markdown, true);
    try {
      await saveFile(activeTab.filePath, markdown, activeTab.id);
    } catch (error) {
      console.error("Failed to save after accepting external changes:", error);
    }
  }, [editor, activeTab, updateTabContent, saveFile]);

  // Handle reject all for external change review
  const handleExternalRejectAll = useCallback(() => {
    if (!editor || !activeTab) return;
    // Nullify ref and resolve BEFORE dispatching — prevents sync effect double-save
    lastExternalDecoratedFile.current = null;
    useExternalChangeStore.getState().resolveChange(activeTab.filePath);
    rejectAllDiffHunks(editor);
    // Save the old content to disk to overwrite the external change.
    // Without this, the file watcher would re-detect the mismatch in a loop.
    const markdown = getMarkdownFromEditor(editor);
    saveFile(activeTab.filePath, markdown, activeTab.id).catch((err) =>
      console.error("Failed to save after rejecting external changes:", err)
    );
  }, [editor, activeTab, saveFile]);

  // Handle per-hunk accept/reject from the ChangeListPopover.
  // Only works for the focused file (PM plugin dispatch).
  const handleExternalAcceptHunk = useCallback((hunkId: string) => {
    if (!editor || !activeTab) return;
    acceptDiffHunk(editor, hunkId);
  }, [editor, activeTab]);

  const handleExternalRejectHunk = useCallback((hunkId: string) => {
    if (!editor || !activeTab) return;
    rejectDiffHunk(editor, hunkId);
  }, [editor, activeTab]);

  // Sync: keep the external-change-store's hunks in sync with the InlineDiff
  // plugin state. When individual hunks are accepted/rejected via inline controls,
  // only the plugin state updates — this effect mirrors those changes to the store
  // so the ChangeListPopover stays accurate.
  //
  // When ALL hunks are resolved, resolves the change entry and saves.
  //
  // Guards against race conditions:
  // 1. Only fires if we previously loaded decorations for this specific file
  //    (prevents premature resolution before decorations exist)
  // 2. Only fires if the change status is not "pending"
  //    (prevents resolution during the window before the toast effect runs)
  useEffect(() => {
    if (!editor || !activeTab) return;
    const onTransaction = () => {
      const filePath = activeTab.filePath;
      // Guard: only process if we actually loaded decorations for this file
      if (lastExternalDecoratedFile.current !== filePath) return;
      const change = useExternalChangeStore.getState().getChange(filePath);
      if (!change || change.status === "pending") return;

      const pluginHunks = getInlineDiffHunks(editor);

      if (pluginHunks.length === 0) {
        // All hunks resolved — clean up and save
        lastExternalDecoratedFile.current = null;
        useExternalChangeStore.getState().resolveChange(filePath);
        const markdown = getMarkdownFromEditor(editor);
        updateTabContent(activeTab.id, markdown, true);
        saveFile(filePath, markdown, activeTab.id).catch((err) =>
          console.error("Failed to save after resolving all hunks:", err)
        );
      } else if (pluginHunks.length !== change.hunks.length) {
        // Some hunks resolved — update store to keep popover in sync
        useExternalChangeStore.getState().setHunks(filePath, pluginHunks.map(h => ({
          id: h.id,
          charFrom: h.from,
          charTo: h.to,
          deleteText: h.deleteText,
          insertText: h.insertText,
        })));
      }
    };
    editor.on('transaction', onTransaction);
    return () => { editor.off('transaction', onTransaction); };
  }, [editor, activeTab?.filePath, activeTab?.id, updateTabContent, saveFile]);

  // Update editor content when switching tabs, saving/restoring scroll position
  useEffect(() => {
    if (editor && activeTab && activeTab.id !== lastLoadedTabId.current) {
      // Save scroll position of the tab we're LEAVING.
      // Cannot use saveScrollRatio() here because activeTab already points to the
      // new tab in this render.  Instead, look up the previous tab by its id.
      const el = scrollAreaRef.current;
      const prevTabId = lastLoadedTabId.current;
      if (el && prevTabId && !isResizing.current) {
        const prevTab = tabs.find((t) => t.id === prevTabId);
        if (prevTab) {
          const maxScroll = el.scrollHeight - el.clientHeight;
          const ratio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
          setScrollPosition(prevTab.filePath, ratio);
        }
      }

      // Hide scroll area to prevent flicker (content renders at top before scroll restores)
      if (el) {
        el.style.opacity = '0';
      }

      lastLoadedTabId.current = activeTab.id;

      // Set document directory BEFORE setContent so image nodes resolve paths correctly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imageStorage = (editor.storage as any).image;
      if (imageStorage) {
        imageStorage.documentDir = getDocumentDir(activeTab.filePath);
        imageStorage.openInsertDialog = () => setImageDialogOpen(true);
      }

      // If the tab has a pending external change in the old store (dirty tab / git auto-accept),
      // load that content instead of the stale tab.content.
      const pendingExternal = externalChanges[activeTab.filePath];
      if (pendingExternal !== undefined && !activeTab.isDirty) {
        loadRawMarkdownIntoEditor(editor, pendingExternal);
        updateTabContent(activeTab.id, pendingExternal, false);
        clearExternalChange(activeTab.filePath);
        toast("File updated from disk", { id: "external-change", description: activeTab.fileName });
      } else {
        loadRawMarkdownIntoEditor(editor, activeTab.content);
      }

      editor.commands.blur();

      // If scrollToTag is set, scroll to that tag instead of restoring saved position
      if (activeTab.scrollToTag) {
        const { tag, occurrence } = activeTab.scrollToTag;
        setScrollToTag(activeTab.id, undefined);
        requestAnimationFrame(() => {
          if (!editor.state?.doc) return;
          const pos = findNthTagInDoc(editor.state.doc, tag, occurrence);
          if (pos !== null) {
            try {
              const domInfo = editor.view.domAtPos(pos);
              const node = domInfo.node instanceof HTMLElement ? domInfo.node : domInfo.node.parentElement;
              node?.scrollIntoView({ block: "center" });
            } catch {
              // fallback: just reveal scroll area
            }
          }
          if (scrollAreaRef.current) {
            scrollAreaRef.current.style.opacity = '1';
          }
        });
      } else {
        // Restore scroll position then reveal
        restoreScrollRatio(activeTab.filePath, () => {
          if (scrollAreaRef.current) {
            scrollAreaRef.current.style.opacity = '1';
          }
        });
      }
    }
  }, [activeTab?.id, editor, activeTab, tabs, setScrollPosition, restoreScrollRatio, externalChanges, updateTabContent, clearExternalChange, setScrollToTag]);

  // Scroll to tag when scrollToTag is set on the already-active tab (same-tab jump)
  useEffect(() => {
    if (!editor || !activeTab || !activeTab.scrollToTag) return;
    // Only handle same-tab jumps — tab-switch case is handled above
    if (activeTab.id !== lastLoadedTabId.current) return;
    const { tag, occurrence } = activeTab.scrollToTag;
    setScrollToTag(activeTab.id, undefined);
    requestAnimationFrame(() => {
      if (!editor.state?.doc) return;
      const pos = findNthTagInDoc(editor.state.doc, tag, occurrence);
      if (pos !== null) {
        try {
          const domInfo = editor.view.domAtPos(pos);
          const node = domInfo.node instanceof HTMLElement ? domInfo.node : domInfo.node.parentElement;
          node?.scrollIntoView({ block: "center" });
        } catch {
          // Position not in DOM
        }
      }
    });
  }, [editor, activeTab?.scrollToTag, activeTab?.id, setScrollToTag]);

  // When switching from Source → WYSIWYG, reload editor with current tab content
  const prevViewMode = useRef(activeTab?.viewMode);
  useEffect(() => {
    if (!editor || !activeTab) return;
    const wasSource = prevViewMode.current === "source";
    const isNowWysiwyg = activeTab.viewMode !== "source";
    prevViewMode.current = activeTab.viewMode;

    if (wasSource && isNowWysiwyg) {
      loadRawMarkdownIntoEditor(editor, activeTab.content);
      // Re-set image storage in case it was lost
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imageStorage = (editor.storage as any).image;
      if (imageStorage) {
        imageStorage.documentDir = getDocumentDir(activeTab.filePath);
        imageStorage.openInsertDialog = () => setImageDialogOpen(true);
      }
    }
  }, [editor, activeTab?.viewMode, activeTab?.id]);

  // Initialize source content when entering source mode, switching tabs, or on external change.
  // Skipped when the change came from the user editing in CodeMirror (sourceUserEditRef).
  useEffect(() => {
    if (activeTab?.viewMode !== "source") return;
    if (sourceUserEditRef.current) {
      sourceUserEditRef.current = false;
      return;
    }
    const raw = serializeFrontmatter(activeTab.frontmatter, activeTab.content);
    setSourceContent(raw);
  }, [activeTab?.id, activeTab?.viewMode, activeTab?.content, activeTab?.frontmatter]);

  // Handle view mode toggle — sync content between WYSIWYG and Source
  const handleToggleViewMode = useCallback(() => {
    if (!activeTab || activeTab.fileType !== "markdown") return;
    const isCurrentlySource = activeTab.viewMode === "source";

    if (!isCurrentlySource && editor) {
      // WYSIWYG → Source: serialize current editor state to markdown
      const markdown = getMarkdownFromEditor(editor);
      updateTabContent(activeTab.id, markdown, activeTab.isDirty);
    }
    // Source → WYSIWYG: content is already in tab store (updated by SourceEditor)

    toggleViewMode(activeTab.id);
  }, [activeTab, editor, updateTabContent, toggleViewMode]);

  // Handle Cmd+S to save
  useEffect(() => {
    const handleSave = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activeTab && activeTab.isDirty) {
          try {
            await saveFile(activeTab.filePath, activeTab.content, activeTab.id);
          } catch (error) {
            toast.error(`Failed to save file: ${error}`);
          }
        }
      }
    };

    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [activeTab, saveFile]);

  // Handle Cmd+/ to toggle view mode (Shift+7 = / on Nordic keyboards)
  useEffect(() => {
    const handleToggle = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const isSlash =
        e.key === "/" ||                              // US layout: Cmd+/
        e.key === "?" ||                              // US layout: Cmd+Shift+/
        e.code === "Slash" ||                         // US layout by code
        (e.shiftKey && e.code === "Digit7");          // Nordic layout: / = Shift+7
      if (isSlash) {
        e.preventDefault();
        handleToggleViewMode();
      }
    };
    window.addEventListener("keydown", handleToggle);
    return () => window.removeEventListener("keydown", handleToggle);
  }, [handleToggleViewMode]);

  // Find in document — listen for custom events from App.tsx
  useEffect(() => {
    const handleFindOpen = () => {
      if (!activeTab) return;

      // Source mode: delegate to CodeMirror's built-in search
      if (activeTab.viewMode === "source" && cmView) {
        openSearchPanel(cmView);
        return;
      }

      // WYSIWYG mode: open our FindBar
      if (activeTab.fileType === "markdown" && editor) {
        // Capture selected text as initial query
        const { from, to } = editor.state.selection;
        const selectedText = from !== to ? editor.state.doc.textBetween(from, to) : "";
        setFindInitialQuery(selectedText);
        setFindBarOpen(true);
      }
    };

    const handleFindReplaceOpen = () => {
      if (!activeTab) return;

      if (activeTab.viewMode === "source" && cmView) {
        openSearchPanel(cmView);
        return;
      }

      if (activeTab.fileType === "markdown" && editor) {
        const { from, to } = editor.state.selection;
        const selectedText = from !== to ? editor.state.doc.textBetween(from, to) : "";
        setFindInitialQuery(selectedText);
        setFindReplaceExpanded(true);
        setFindBarOpen(true);
      }
    };

    window.addEventListener("notesage:find-open", handleFindOpen);
    window.addEventListener("notesage:find-replace-open", handleFindReplaceOpen);
    return () => {
      window.removeEventListener("notesage:find-open", handleFindOpen);
      window.removeEventListener("notesage:find-replace-open", handleFindReplaceOpen);
    };
  }, [activeTab, editor, cmView]);

  // Toggle recording via global keyboard shortcut event
  useEffect(() => {
    const handleToggleRecording = () => {
      if (recording.isRecording) {
        recording.stopRecording().then((info) => {
          if (info) {
            setLastBufferInfo(info);
            setTranscriptionDialogOpen(true);
          }
        });
      } else {
        recording.startRecording("microphone");
      }
    };
    window.addEventListener("notesage:toggle-recording", handleToggleRecording);
    return () => window.removeEventListener("notesage:toggle-recording", handleToggleRecording);
  }, [recording]);

  // Clear find state on tab switch
  const prevFindTabId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (activeTab?.id !== prevFindTabId.current) {
      prevFindTabId.current = activeTab?.id;
      if (findBarOpen) {
        if (editor) clearSearch(editor);
        setFindBarOpen(false);
        setFindMatchCount(0);
        setFindCurrentMatch(-1);
        setFindInitialQuery("");
        setFindReplaceExpanded(false);
      }
    }
  }, [activeTab?.id, findBarOpen, editor]);

  // FindBar callbacks
  const handleFindSearch = useCallback((query: string) => {
    if (!editor) return;
    setSearchQuery(editor, query);
    const state = getSearchState(editor);
    setFindMatchCount(state?.matchCount ?? 0);
    setFindCurrentMatch(state?.currentIndex ?? -1);
  }, [editor]);

  const handleFindNext = useCallback(() => {
    if (!editor) return;
    searchNext(editor);
    const state = getSearchState(editor);
    setFindCurrentMatch(state?.currentIndex ?? -1);
  }, [editor]);

  const handleFindPrevious = useCallback(() => {
    if (!editor) return;
    searchPrevious(editor);
    const state = getSearchState(editor);
    setFindCurrentMatch(state?.currentIndex ?? -1);
  }, [editor]);

  const handleFindReplace = useCallback((replacement: string) => {
    if (!editor) return;
    replaceCurrentMatch(editor, replacement);
    // State updates after transaction via rAF
    requestAnimationFrame(() => {
      const state = getSearchState(editor);
      setFindMatchCount(state?.matchCount ?? 0);
      setFindCurrentMatch(state?.currentIndex ?? -1);
    });
  }, [editor]);

  const handleFindReplaceAll = useCallback((replacement: string) => {
    if (!editor) return;
    replaceAllMatches(editor, replacement);
    requestAnimationFrame(() => {
      const state = getSearchState(editor);
      setFindMatchCount(state?.matchCount ?? 0);
      setFindCurrentMatch(state?.currentIndex ?? -1);
    });
  }, [editor]);

  const handleFindClose = useCallback(() => {
    if (editor) clearSearch(editor);
    setFindBarOpen(false);
    setFindMatchCount(0);
    setFindCurrentMatch(-1);
    setFindInitialQuery("");
  }, [editor]);

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

  if (!activeTab) {
    return (
      <div className="h-full overflow-y-auto @container bg-background">
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
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
                      <Command className="h-3 w-3" />
                    </kbd>
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
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
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
                      <Command className="h-3 w-3" />
                    </kbd>
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-sm font-semibold text-foreground/50 leading-none">
                      ⇧
                    </kbd>
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
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
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
                      <Command className="h-3 w-3" />
                    </kbd>
                    <kbd className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-sm border border-border bg-muted text-xs font-semibold text-foreground/50">
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
          <div className="pt-24">
            <p className="text-xs text-muted-foreground/50 max-w-md mx-auto leading-relaxed">
              Your files never leave your computer. Notesage reads and writes directly to your local filesystem — no cloud sync, no accounts, no tracking. AI features connect only when you provide an API key.
            </p>
          </div>
        </div>
        </div>
      </div>
    );
  }

  // Route non-markdown file types to their viewers
  if (activeTab && activeTab.fileType !== "markdown") {
    let viewer: React.ReactNode = null;
    switch (activeTab.fileType) {
      case "image":
        viewer = <ImageViewer filePath={activeTab.filePath} />;
        break;
      case "pdf":
        viewer = <PdfViewer filePath={activeTab.filePath} fileName={activeTab.fileName} />;
        break;
      case "docx":
        viewer = (
          <DocxViewer
            filePath={activeTab.filePath}
            fileName={activeTab.fileName}
            onConvertToMarkdown={async (_html, name) => {
              try {
                const { docxToMarkdown } = await import("@/lib/import-utils");
                const { getBinaryData } = await import("@/lib/binary-cache");
                const data = getBinaryData(activeTab.filePath);
                if (!data) { toast.error("No DOCX data available"); return; }
                const md = await docxToMarkdown(data);
                const mdName = name.replace(/\.docx$/i, ".md");
                const dir = activeTab.filePath.slice(0, activeTab.filePath.lastIndexOf("/"));
                const mdPath = `${dir}/${mdName}`;
                const { tauriApi } = await import("@/lib/tauri");
                await tauriApi.writeFile(mdPath, md);
                onOpenFile?.(mdPath, mdName);
                toast.success(`Saved ${mdName}`);
              } catch (err) {
                toast.error(`Import failed: ${err}`);
              }
            }}
          />
        );
        break;
      case "epub":
        viewer = <EpubViewer filePath={activeTab.filePath} fileName={activeTab.fileName} />;
        break;
      case "other":
        viewer = <PlainTextViewer content={activeTab.content} fileName={activeTab.fileName} />;
        break;
    }
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">{viewer}</div>
        {!focusMode && (
          <StatusBar
            editor={null}
            onShortcutsOpen={onShortcutsOpen}
          />
        )}
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
      {toolbarVisible && !focusMode && (
        <div className="flex items-center border-b border-border shrink-0 bg-background">
          <Toolbar
            editor={editor}
            onImageInsert={() => setImageDialogOpen(true)}
            viewMode={activeTab?.viewMode}
            onToggleViewMode={activeTab?.fileType === "markdown" ? handleToggleViewMode : undefined}
            sourceWordWrap={sourceWordWrap}
            onToggleWordWrap={() => setSourceWordWrap(!sourceWordWrap)}
          />
          {gitEnabled && isGitRepo && projectPath && !reviewActive && (
            <div className="shrink-0 pr-2">
              <BranchDiffSelector projectPath={projectPath} />
            </div>
          )}
        </div>
      )}
      {reviewActive && compareBranch && (
        <DiffReviewBanner
          editor={editor}
          branchName={compareBranch}
          onAcceptAll={handleAcceptAll}
          onRejectAll={handleRejectAll}
        />
      )}
      {activeTab?.viewMode === "source" ? (
        <div className="flex-1 overflow-auto relative">
          <SourceEditor
            content={sourceContent}
            wordWrap={sourceWordWrap}
            onUpdate={(raw) => {
              if (activeTab) {
                sourceUserEditRef.current = true;
                setSourceContent(raw);
                const { frontmatter, content } = parseFrontmatter(raw);
                const bodyChanged = content !== activeTab.content;
                const fmChanged = JSON.stringify(frontmatter) !== JSON.stringify(activeTab.frontmatter);
                updateTabContent(activeTab.id, content, activeTab.isDirty || bodyChanged || fmChanged);
                if (fmChanged) setFrontmatter(activeTab.id, frontmatter);
              }
            }}
            onSave={async () => {
              if (activeTab && activeTab.isDirty) {
                try {
                  await saveFile(activeTab.filePath, activeTab.content, activeTab.id);
                } catch (error) {
                  toast.error(`Failed to save file: ${error}`);
                }
              }
            }}
            onToggleViewMode={handleToggleViewMode}
            onToggleWordWrap={() => setSourceWordWrap(!sourceWordWrap)}
            onViewReady={setCmView}
          />
          {showFloatingToolbar && <SourceBubbleMenu cmView={cmView} />}
        </div>
      ) : (
        <div className="flex-1 overflow-hidden relative">
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
          {recording.isRecording && (
            <RecordingBar
              elapsedTime={recording.elapsedTime}
              source={recording.source}
              micLevel={recording.micLevel}
              onStop={async () => {
                const info = await recording.stopRecording();
                if (info) {
                  setLastBufferInfo(info);
                  setTranscriptionDialogOpen(true);
                }
              }}
            />
          )}
          <div ref={scrollAreaRef} className="h-full overflow-y-auto">
          <div
            className={`min-h-full flex justify-center ${
              contentWidth === "full" ? "py-4 px-4" : "py-10 px-8"
            }`}
          >
            <div
              ref={contentRef}
              className={`w-full ${isPaperMode ? 'paper-mode' : ''}`}
              data-page-breaks={isPaperMode ? pageBreaks : undefined}
              style={{
                maxWidth: maxWidth ? `${maxWidth}px` : undefined,
                '--editor-padding-top': paddingTop,
                '--editor-padding-bottom': paddingBottom,
                '--editor-padding-left': paddingLeft,
                '--editor-padding-right': paddingRight,
                '--editor-font-family': fontFamilyCSS(editorStyles.fontFamily),
                '--editor-font-size': `${editorStyles.fontSize}px`,
                '--editor-line-height': String(editorStyles.lineHeight),
                '--editor-paragraph-spacing': `${editorStyles.paragraphSpacing}em`,
                ...(pageHeight ? { '--page-height': `${pageHeight}px` } : {}),
              } as React.CSSProperties & Record<`--${string}`, string | undefined>}
            >
              {activeTab && (
                <FrontmatterBlock tabId={activeTab.id} frontmatter={activeTab.frontmatter} />
              )}
              <EditorContent editor={editor} />
            </div>
          </div>
          {editor && showFloatingToolbar && <BubbleMenu editor={editor} />}

        </div>
        </div>
      )}
      {!focusMode && (
        <StatusBar
          editor={editor}
          maxWidth={maxWidth}
          renderedWidth={renderedWidth}
          comments={commentOps.comments}
          branchName={repo?.currentBranch ?? ""}
          isGitRepo={gitEnabled && isGitRepo}
          reviewActive={reviewActive}
          compareBranch={compareBranch}
          pageInfo={pageInfo}
          commentListOpen={commentListOpen}
          onCommentListOpenChange={setCommentListOpen}
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
          externalChanges={externalChangesAll}
          activeFilePath={activeTab?.filePath ?? null}
          changeListOpen={changeListOpen}
          onChangeListOpenChange={setChangeListOpen}
          onAcceptAllChanges={handleExternalAcceptAll}
          onRejectAllChanges={handleExternalRejectAll}
          onAcceptHunk={handleExternalAcceptHunk}
          onRejectHunk={handleExternalRejectHunk}
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
          copilotActive={!!copilotConnection}
          copilotDisabledForTab={activeTab?.copilotDisabled ?? false}
          onToggleCopilot={() => { if (activeTabId) toggleCopilotForTab(activeTabId); }}
          updateAvailable={updateAvailable}
          updateVersion={updateVersion}
          onUpdateClick={onUpdateClick}
          onShortcutsOpen={onShortcutsOpen}
          onSelectChange={(change, hunkIndex) => {
            // Switch to the tab that has this file open and scroll to the specific hunk
            const matchingTab = tabs.find((t) => t.filePath === change.filePath);
            if (matchingTab) {
              if (matchingTab.id === activeTabId) {
                // Already on this tab — scroll to the specific hunk
                if (editor) {
                  try {
                    const pmHunks = getInlineDiffHunks(editor);
                    const targetHunk = pmHunks[hunkIndex] ?? pmHunks[0];
                    if (targetHunk) {
                      const dom = editor.view.domAtPos(targetHunk.from);
                      const node = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
                      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  } catch {
                    // Ignore scroll errors
                  }
                }
              } else {
                useEditorStore.getState().setActiveTab(matchingTab.id);
              }
            } else if (onOpenFile) {
              onOpenFile(change.filePath, change.fileName);
            }
          }}
        />
      )}
      <DocumentOutline open={outlineOpen ?? false} onOpenChange={(open) => onOutlineOpenChange?.(open)} editor={editor} />
      <ExportDialog
        open={exportOpen ?? false}
        onOpenChange={(open) => onExportOpenChange?.(open)}
        onExport={async (options) => {
          await exportPdf(options);
          onExportOpenChange?.(false);
        }}
        isExporting={isExporting}
      />
      <TranscriptionDialog
        open={transcriptionDialogOpen}
        onOpenChange={setTranscriptionDialogOpen}
        bufferInfo={lastBufferInfo}
        onSaveAsNote={async (content, title) => {
          if (projectPath) {
            const fileName = `${title.replace(/[^a-zA-Z0-9 —-]/g, '').replace(/ /g, '-').toLowerCase()}.md`;
            const filePath = `${projectPath}/${fileName}`;
            try {
              const { tauriApi: api } = await import('@/lib/tauri');
              await api.writeFile(filePath, content);
              toast.success(`Saved: ${fileName}`);
            } catch (err) {
              toast.error(`Failed to save: ${err}`);
            }
          }
        }}
        onInsertAtCursor={editor ? (text) => {
          editor.chain().focus().insertContent(text).run();
        } : undefined}
      />
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
        onDelegateExisting={async () => {
          if (commentOps.activeComment && commentOps.commentKey && commentStorageRoot) {
            await delegateComment(commentOps.activeComment, commentOps.commentKey, commentStorageRoot, 'delegate');
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
            const tab = useEditorStore.getState().tabs.find((t) => t.id === useEditorStore.getState().activeTabId);
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
              await sendChatMessage(text, conv.messages);
              useSettingsStore.getState().setChatPanelOpen(true);
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
    </div>
  );
}
