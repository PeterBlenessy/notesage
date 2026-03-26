import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { useEditorStore, type Tab } from "@/stores/editor-store";
import {
  AISuggestionPluginKey,
  setSuggestion,
} from "@/components/editor/extensions";
import { findNthTagInDoc, scrollPosToCenter, scrollToTextInEditor, PX_PER_CM } from "@/components/editor/editor-utils";
import { loadRawMarkdownIntoEditor } from "@/lib/markdown";
import { getDocumentDir } from "@/lib/image-utils";
import { getEditorStorage, type EditorStorageImage } from "@/lib/editor-storage";
import { toast } from "sonner";

interface AISuggestion {
  from: number;
  to: number;
  originalText: string;
  suggestedText: string;
}

interface UseEditorTabSwitchOptions {
  editor: TiptapEditor | null;
  activeTab: Tab | null;
  cachedEditorStatesRef: MutableRefObject<Map<string, EditorState>>;
  savedSuggestionsRef: MutableRefObject<Map<string, AISuggestion>>;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  isProgrammaticScroll: MutableRefObject<boolean>;
  lastLoadedTabId: MutableRefObject<string | null>;
  saveOutgoingTabScroll: () => void;
  restoreScrollRatio: (filePath: string, onComplete?: () => void) => void;
  externalChanges: Record<string, string>;
  updateTabContent: (id: string, content: string, isDirty: boolean) => void;
  clearExternalChange: (filePath: string) => void;
  setImageDialogOpen: (open: boolean) => void;
  isPaperMode: boolean;
  marginTop: number;
  marginBottom: number;
  pageHeight: number | undefined;
}

interface PageInfo {
  current: number;
  total: number;
}

export function useEditorTabSwitch({
  editor,
  activeTab,
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
}: UseEditorTabSwitchOptions) {
  const setScrollToTag = useEditorStore((s) => s.setScrollToTag);
  const setScrollToText = useEditorStore((s) => s.setScrollToText);

  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);

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
      const imageStorage = getEditorStorage<EditorStorageImage>(editor, 'image');
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
      const imgStorage = getEditorStorage<EditorStorageImage>(editor, 'image');
      if (imgStorage) {
        imgStorage.documentDir = getDocumentDir(activeTab.filePath);
        imgStorage.openInsertDialog = () => setImageDialogOpen(true);
      }
    }
  }, [editor, activeTab?.viewMode, activeTab?.id]);

  // Page position: calculate from editor content height and page geometry
  const marginTopPx = marginTop * PX_PER_CM;
  const marginBottomPx = marginBottom * PX_PER_CM;
  const usableHeight = pageHeight ? pageHeight - marginTopPx - marginBottomPx : 0;

  useEffect(() => {
    if (!editor || !isPaperMode || !usableHeight || !activeTab) {
      setPageInfo(null);
      return;
    }

    const updatePageInfo = () => {
      const el = scrollAreaRef.current;
      if (!el) return;

      // Total content height from the ProseMirror DOM
      const contentHeight = editor.view.dom.scrollHeight;
      const totalPages = Math.max(1, Math.ceil(contentHeight / usableHeight));

      // Current page: which page is at the viewport center
      const viewportCenter = el.scrollTop + el.clientHeight / 2;
      const contentOffsetTop =
        editor.view.dom.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      const posInContent = viewportCenter - contentOffsetTop;
      const currentPage = Math.min(
        totalPages,
        Math.max(1, Math.ceil(posInContent / usableHeight))
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
  }, [editor, isPaperMode, usableHeight, activeTab?.id]);

  return { pageInfo };
}
