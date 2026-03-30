import { useEffect, useCallback, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { ViewMode } from "@/lib/file-utils";
import {
  setSearchQuery,
  searchNext,
  searchPrevious,
  clearSearch,
  replaceCurrentMatch,
  replaceAllMatches,
  getSearchState,
} from "@/components/editor/extensions";
import { getMarkdownFromEditor } from "@/lib/markdown";
import { toast } from "sonner";

interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  fileType: string;
  content: string;
  isDirty: boolean;
  viewMode?: string;
}

interface UseEditorKeyBindingsParams {
  editor: TiptapEditor | null;
  activeTab: Tab | null | undefined;
  saveFile: (filePath: string, content: string, tabId: string) => Promise<unknown>;
  updateTabContent: (tabId: string, content: string, isDirty: boolean) => void;
  toggleViewMode: (tabId: string) => void;
  setViewMode: (tabId: string, mode: ViewMode) => void;
}

export function useEditorKeyBindings({
  editor,
  activeTab,
  saveFile,
  updateTabContent,
  toggleViewMode,
  setViewMode,
}: UseEditorKeyBindingsParams) {
  // Find in document state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findMatchCount, setFindMatchCount] = useState(0);
  const [findCurrentMatch, setFindCurrentMatch] = useState(-1);
  const [findInitialQuery, setFindInitialQuery] = useState("");
  const [findReplaceExpanded, setFindReplaceExpanded] = useState(false);

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

  // Handle HTML preview toggle — switch between html-preview and previous mode
  const handleToggleHtmlPreview = useCallback(() => {
    if (!activeTab || activeTab.fileType !== "markdown") return;
    const isPreview = activeTab.viewMode === "html-preview";

    if (!isPreview && editor) {
      // Serialize current editor state before switching to preview
      const markdown = getMarkdownFromEditor(editor);
      updateTabContent(activeTab.id, markdown, activeTab.isDirty);
    }

    setViewMode(activeTab.id, isPreview ? "wysiwyg" : "html-preview");
  }, [activeTab, editor, updateTabContent, setViewMode]);

  // Handle Cmd+Shift+P to toggle HTML preview
  useEffect(() => {
    const handlePreviewShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handleToggleHtmlPreview();
      }
    };
    window.addEventListener("keydown", handlePreviewShortcut);
    return () => window.removeEventListener("keydown", handlePreviewShortcut);
  }, [handleToggleHtmlPreview]);

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

  // Find in document — listen for custom events from App.tsx (WYSIWYG mode only; source mode handled by SourceModeEditor)
  useEffect(() => {
    const handleFindOpen = () => {
      if (!activeTab || activeTab.viewMode === "source") return;

      if (activeTab.fileType === "markdown" && editor) {
        const { from, to } = editor.state.selection;
        const selectedText = from !== to ? editor.state.doc.textBetween(from, to) : "";
        setFindInitialQuery(selectedText);
        setFindBarOpen(true);
      }
    };

    const handleFindReplaceOpen = () => {
      if (!activeTab || activeTab.viewMode === "source") return;

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
  }, [activeTab, editor]);

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

  return {
    // Find bar state
    findBarOpen,
    findMatchCount,
    findCurrentMatch,
    findInitialQuery,
    findReplaceExpanded,
    setFindReplaceExpanded,
    // Find bar callbacks
    handleFindSearch,
    handleFindNext,
    handleFindPrevious,
    handleFindReplace,
    handleFindReplaceAll,
    handleFindClose,
    // View mode
    handleToggleViewMode,
    handleToggleHtmlPreview,
  };
}
