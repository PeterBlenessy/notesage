import { useEffect, useCallback, useRef, useState, lazy, Suspense, type MutableRefObject } from "react";
import { useScrollPersistence } from "@/hooks/useScrollPersistence";
import { useEditorResize } from "@/hooks/useEditorResize";
import { EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, TextSelection } from "@tiptap/pm/state";
import { Command, File, FolderDot, Folder, Clock } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { useRoutingStore } from "@/stores/routing-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore, type ContentWidth } from "@/stores/settings-store";
import { useEditorStylesStore, fontFamilyCSS } from "@/stores/editor-styles-store";
import { useEditor } from "@/hooks/useEditor";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useExportOperations } from "@/hooks/useExportOperations";
import { useDiffReview } from "@/hooks/useDiffReview";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useCommentEditorSync } from "@/hooks/useCommentEditorSync";
import { useCopilotCompletion } from "@/hooks/useCopilotCompletion";
import { useCopilotCompletionCM } from "@/hooks/useCopilotCompletionCM";
import { useLocalCompletion } from "@/hooks/useLocalCompletion";
import { useEditorKeyBindings } from "@/hooks/useEditorKeyBindings";
import { useFileWatcherIntegration } from "@/hooks/useFileWatcherIntegration";
import type { EditorView as CMEditorView } from "@codemirror/view";
import { useCommentStore } from "@/stores/comment-store";
import { useChatStore } from "@/stores/chat-store";
import {
  setPendingCommentRange as setPendingRangeDecoration,
  getInlineDiffHunks,
  setSuggestion,
  hasActiveSuggestion,
  AISuggestionPluginKey,
} from "@/components/editor/extensions";
import { extractReplacementText, resolveAnchorRange } from "@/lib/pm-replace";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useGitStore } from "@/stores/git-store";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
const ExportDialog = lazy(() => import("@/components/ExportDialog").then(m => ({ default: m.ExportDialog })));
import { Toolbar } from "./Toolbar";
import { SourceModeEditor } from "./SourceModeEditor";
import { ImageInsertDialog } from "./ImageInsertDialog";
import { tauriApi } from "@/lib/tauri";
import { isBinaryFileType } from "@/lib/file-utils";
import { parseFrontmatter } from "@/lib/frontmatter";
import { setBinaryData } from "@/lib/binary-cache";

import { EditorViewerContainer } from "./EditorViewerContainer";
import { BubbleMenu } from "./BubbleMenu";

import { FindBar } from "./FindBar";
import { TranscriptionOverlay } from "./TranscriptionOverlay";
import { DiffReviewBanner } from "./DiffReviewBanner";
import { BranchDiffSelector } from "./BranchDiffSelector";
import { CommentPopover } from "./CommentPopover";
import { DatePickerPopover } from "./DatePickerPopover";
import { StatusBar } from "./StatusBar";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { DocumentOutline } from "@/components/DocumentOutline";
import { loadRawMarkdownIntoEditor } from "@/lib/markdown";
import { getDocumentDir } from "@/lib/image-utils";
import { toast } from "sonner";
import "@/styles/editor.css";

// 1 CSS px = 1/96 inch, 1 inch = 2.54 cm
const PX_PER_CM = 96 / 2.54;


/**
 * Find the ProseMirror position of `searchText` in the document.
 *
 * Uses `doc.textContent` (which concatenates text across all node boundaries)
 * so it correctly finds text that spans multiple ProseMirror text nodes
 * (e.g. "Buy #groceries" where "Buy " and "#groceries" are separate nodes).
 *
 * Returns the PM position of the match, or null if not found.
 */
/**
 * Strip common markdown inline formatting markers from text.
 * Converts raw markdown like `Buy **groceries** and \`code\`` into
 * plain text like `Buy groceries and code` to match ProseMirror's textContent.
 */
function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/__(.+?)__/g, '$1')         // __bold__
    .replace(/\*(.+?)\*/g, '$1')         // *italic*
    .replace(/_(.+?)_/g, '$1')           // _italic_
    .replace(/~~(.+?)~~/g, '$1')         // ~~strikethrough~~
    .replace(/`(.+?)`/g, '$1')           // `code`
    .replace(/\[(.+?)\]\(.+?\)/g, '$1'); // [link](url)
}

/**
 * Find the ProseMirror position of `searchText` in the document.
 *
 * Builds the full text and position map in a SINGLE PASS through the document
 * tree, so they're always in sync. This correctly handles non-text leaf nodes
 * (e.g. hardBreak → "\n") that contribute to textContent but aren't text nodes.
 */
function findTextPositionInDoc(
  doc: PMNode,
  searchText: string,
): number | null {
  let fullText = '';
  const posMap: number[] = []; // posMap[i] = PM position of the i-th character in fullText

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i);
        fullText += node.text[i];
      }
    } else if (node.isLeaf && !node.isText) {
      // Non-text leaves (hardBreak, image, etc.) may contribute to textContent
      const leafText = node.type.spec.leafText?.(node) ?? '';
      for (let i = 0; i < leafText.length; i++) {
        posMap.push(pos);
        fullText += leafText[i];
      }
    }
  });

  // Parse occurrence index if encoded as "searchText\0N"
  let needle: string;
  let nth = 0;
  const nullIdx = searchText.indexOf('\0');
  if (nullIdx !== -1) {
    needle = searchText.slice(0, nullIdx).toLowerCase();
    nth = parseInt(searchText.slice(nullIdx + 1), 10) || 0;
  } else {
    needle = searchText.toLowerCase();
  }

  const lowerText = fullText.toLowerCase();
  let strippedNeedle: string | null = null;

  // Find the Nth occurrence
  let found = 0;
  let startFrom = 0;
  while (startFrom < lowerText.length) {
    let textOffset = lowerText.indexOf(needle, startFrom);
    // Fallback: try stripped markdown
    if (textOffset === -1 && !strippedNeedle) {
      strippedNeedle = stripMarkdownInline(needle);
      if (strippedNeedle !== needle) {
        textOffset = lowerText.indexOf(strippedNeedle, startFrom);
      }
    }
    if (textOffset === -1) return null;

    if (found === nth) {
      return posMap[textOffset] ?? null;
    }
    found++;
    startFrom = textOffset + 1;
  }

  return null;
}

/**
 * Scroll the editor so that the given ProseMirror position is vertically
 * centered in the scroll container, and move the cursor there.
 *
 * Key: sets the selection via a raw transaction WITHOUT scrollIntoView.
 * Tiptap's `editor.commands.setTextSelection()` chains `.scrollIntoView()`,
 * which pre-scrolls the container and invalidates our centering math.
 *
 * `programmaticScrollRef` is set to true during the scroll to prevent the
 * ResizeObserver and scroll-save listeners from interfering.
 */
/**
 * Scroll a ProseMirror position to the vertical center of the scroll container
 * and place the cursor there.
 *
 * Uses the simplest reliable approach:
 * 1. Get the DOM element at the position via view.domAtPos
 * 2. Call scrollIntoView({ block: "center" }) — lets the browser handle the math
 * 3. Set the ProseMirror selection (element is already in view, no auto-scroll)
 */
function scrollPosToCenter(editor: TiptapEditor, pos: number, _scrollContainer: HTMLElement, programmaticScrollRef?: MutableRefObject<boolean>) {
  // Guard: prevent ResizeObserver and scroll-save from interfering
  if (programmaticScrollRef) programmaticScrollRef.current = true;

  try {
    // 1. Find the DOM element at this position
    const domInfo = editor.view.domAtPos(pos);
    const el: Element | null = domInfo.node instanceof Element
      ? domInfo.node
      : domInfo.node.parentElement;

    // 2. Scroll into view — browser handles all the container math
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "instant" });
    }
  } catch {
    // Position not in DOM
  }

  // 3. Set cursor AFTER scroll — element is visible, browser won't fight us
  try {
    const tr = editor.view.state.tr.setSelection(
      TextSelection.create(editor.view.state.doc, pos)
    );
    editor.view.dispatch(tr);
  } catch {
    // Invalid position
  }

  // Clear guard after scroll settles
  if (programmaticScrollRef) {
    setTimeout(() => { programmaticScrollRef.current = false; }, 500);
  }
}

/**
 * Find text in the ProseMirror document, move the cursor there, and scroll to center it.
 */
function scrollToTextInEditor(editor: TiptapEditor, searchText: string, scrollContainer?: HTMLElement | null, programmaticScrollRef?: MutableRefObject<boolean>) {
  const pos = findTextPositionInDoc(editor.state.doc, searchText);
  if (pos !== null && scrollContainer) {
    scrollPosToCenter(editor, pos, scrollContainer, programmaticScrollRef);
  }
}

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
  onOpenActions?: () => void;
}

export function Editor({ onNewNote, onNewProject, onOpenFolder, onOpenProject, onOpenFile, exportOpen, onExportOpenChange, focusMode, outlineOpen, onOutlineOpenChange, updateAvailable, updateVersion, onUpdateClick, onShortcutsOpen, onOpenActions }: EditorProps) {
  const { tabs, activeTabId, updateTabContent, setFrontmatter, recentFiles, externalChanges, clearExternalChange, toggleViewMode, setScrollToTag, setScrollToText } = useEditorStore();
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
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // On-demand content loading: when a placeholder tab becomes active, load its content from disk.
  useEffect(() => {
    if (!activeTab || activeTab.contentLoaded !== false) return;
    const { id, filePath, fileType } = activeTab;
    (async () => {
      try {
        if (fileType === "image") {
          useEditorStore.getState().loadTabContent(id, "");
          return;
        }
        if (isBinaryFileType(fileType)) {
          const bytes = await tauriApi.readBinaryFile(filePath);
          setBinaryData(filePath, new Uint8Array(bytes));
          useEditorStore.getState().loadTabContent(id, "");
          return;
        }
        const raw = await tauriApi.readFile(filePath);
        if (fileType === "markdown") {
          const { frontmatter, content } = parseFrontmatter(raw);
          useEditorStore.getState().loadTabContent(id, content, frontmatter);
        } else {
          useEditorStore.getState().loadTabContent(id, raw);
        }
      } catch (err) {
        console.warn("Failed to load tab content:", filePath, err);
      }
    })();
  }, [activeTab?.id, activeTab?.contentLoaded]);

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

  const { renderedWidth } = useEditorResize({
    contentRef,
    scrollAreaRef,
    isProgrammaticScroll,
    isResizing,
    activeTabId,
    activeTabFilePath: activeTab?.filePath,
    restoreScrollRatio,
  });
  const [pageInfo, setPageInfo] = useState<{ current: number; total: number } | null>(null);
  const [commentListOpen, setCommentListOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [cmView, setCmView] = useState<CMEditorView | null>(null);

  // Convert cm margins to px
  const paddingTop = `${marginTop * PX_PER_CM}px`;
  const paddingBottom = `${marginBottom * PX_PER_CM}px`;
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

  const { exportPdf, isExporting } = useExportOperations(editor);
  const { reviewActive, compareBranch, handleAcceptAll, handleRejectAll } = useDiffReview(editor);
  useFileWatcher();
  useCopilotCompletion(editor);
  useCopilotCompletionCM(cmView);
  useLocalCompletion(editor);

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
  /** Per-tab ProseMirror EditorState cache — preserves undo/redo, selection, and plugin state across tab switches. */
  const cachedEditorStatesRef = useRef<Map<string, EditorState>>(new Map());

  // External change detection + inline diff review
  const {
    externalChangesAll,
    changeListOpen,
    setChangeListOpen,
    handleExternalAcceptAll,
    handleExternalRejectAll,
    handleExternalAcceptHunk,
    handleExternalRejectHunk,
  } = useFileWatcherIntegration({
    editor,
    activeTab: activeTab ?? null,
    cachedEditorStatesRef,
    updateTabContent,
    clearExternalChange,
    saveFile,
    externalChanges,
  });

  // Update editor content when switching tabs or when placeholder content finishes loading.
  useEffect(() => {
    if (!editor || !activeTab || activeTab.contentLoaded === false) return;
    if (activeTab.id === lastLoadedTabId.current) return;
      // Save full editor state of the tab we're LEAVING (preserves undo/redo, selection, decorations)
      const prevTabId = lastLoadedTabId.current;
      if (prevTabId) {
        cachedEditorStatesRef.current.set(prevTabId, editor.state);
        // Also save AI suggestion separately (for explicit position validation on restore)
        const pluginState = AISuggestionPluginKey.getState(editor.state);
        if (pluginState?.suggestion) {
          savedSuggestionsRef.current.set(prevTabId, pluginState.suggestion);
        } else {
          savedSuggestionsRef.current.delete(prevTabId);
        }
      }

      // Save scroll position of the tab we're LEAVING
      saveOutgoingTabScroll();

      // Hide scroll area to prevent flicker (content renders at top before scroll restores)
      const el = scrollAreaRef.current;
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
      let restoredFromCache = false;
      const pendingExternal = externalChanges[activeTab.filePath];
      if (pendingExternal !== undefined && !activeTab.isDirty) {
        cachedEditorStatesRef.current.delete(activeTab.id);
        loadRawMarkdownIntoEditor(editor, pendingExternal);
        updateTabContent(activeTab.id, pendingExternal, false);
        clearExternalChange(activeTab.filePath);
        toast("File updated from disk", { id: "external-change", description: activeTab.fileName });
      } else {
        // Restore cached EditorState if available — preserves undo/redo, selection, decorations
        const cachedState = cachedEditorStatesRef.current.get(activeTab.id);
        if (cachedState) {
          editor.view.updateState(cachedState);
          cachedEditorStatesRef.current.delete(activeTab.id);
          restoredFromCache = true;
        } else {
          loadRawMarkdownIntoEditor(editor, activeTab.content);
        }
      }

      editor.commands.blur();

      // Restore AI suggestion only for fresh loads — cached state already includes plugin state
      if (!restoredFromCache) {
        const savedSuggestion = savedSuggestionsRef.current.get(activeTab.id);
        if (savedSuggestion) {
          requestAnimationFrame(() => {
            // Verify positions are still valid in the new document
            if (savedSuggestion.from >= 0 && savedSuggestion.to <= editor.state.doc.content.size) {
              setSuggestion(editor, savedSuggestion.from, savedSuggestion.to, savedSuggestion.originalText, savedSuggestion.suggestedText);
            }
            savedSuggestionsRef.current.delete(activeTab.id);
          });
        }
      }

      // If scrollToTag is set, scroll to that tag instead of restoring saved position
      if (activeTab.scrollToTag) {
        const { tag, occurrence } = activeTab.scrollToTag;
        setScrollToTag(activeTab.id, undefined);
        // Double-rAF: first frame ProseMirror updates DOM, second frame browser completes layout
        requestAnimationFrame(() => { requestAnimationFrame(() => {
          if (!editor.state?.doc) { if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1'; return; }
          const pos = findNthTagInDoc(editor.state.doc, tag, occurrence);
          if (pos !== null && scrollAreaRef.current) {
            scrollPosToCenter(editor, pos, scrollAreaRef.current, isProgrammaticScroll);
          }
          if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1';
        }); });
      } else if (activeTab.scrollToText) {
        const text = activeTab.scrollToText;
        setScrollToText(activeTab.id, undefined);
        requestAnimationFrame(() => { requestAnimationFrame(() => {
          scrollToTextInEditor(editor, text, scrollAreaRef.current, isProgrammaticScroll);
          if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1';
        }); });
      } else {
        // Restore scroll position then reveal
        restoreScrollRatio(activeTab.filePath, () => {
          if (scrollAreaRef.current) {
            scrollAreaRef.current.style.opacity = '1';
          }
        });
      }
  }, [activeTab?.id, editor, activeTab, saveOutgoingTabScroll, restoreScrollRatio, externalChanges, updateTabContent, clearExternalChange, setScrollToTag, setScrollToText]);

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
      if (pos !== null && scrollAreaRef.current) {
        scrollPosToCenter(editor, pos, scrollAreaRef.current, isProgrammaticScroll);
      }
    });
  }, [editor, activeTab?.scrollToTag, activeTab?.id, setScrollToTag]);

  // Scroll to text when scrollToText is set on the already-active tab (same-tab jump)
  useEffect(() => {
    if (!editor || !activeTab || !activeTab.scrollToText) return;
    if (activeTab.id !== lastLoadedTabId.current) return;
    const text = activeTab.scrollToText;
    setScrollToText(activeTab.id, undefined);
    // Single rAF is enough — content is already rendered for same-tab jumps
    requestAnimationFrame(() => {
      scrollToTextInEditor(editor, text, scrollAreaRef.current, isProgrammaticScroll);
    });
  }, [editor, activeTab?.scrollToText, activeTab?.id, setScrollToText]);

  // When switching from Source → WYSIWYG, reload editor with current tab content
  const prevViewMode = useRef(activeTab?.viewMode);
  useEffect(() => {
    if (!editor || !activeTab) return;
    const wasSource = prevViewMode.current === "source";
    const isNowWysiwyg = activeTab.viewMode !== "source";
    prevViewMode.current = activeTab.viewMode;

    if (wasSource && isNowWysiwyg) {
      cachedEditorStatesRef.current.delete(activeTab.id);
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
          updateAvailable={updateAvailable}
          updateVersion={updateVersion}
          onUpdateClick={onUpdateClick}
          onShortcutsOpen={onShortcutsOpen}
          onOpenActions={onOpenActions}
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
            await exportPdf(options);
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
