import { useEffect, useCallback, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
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
}

export function useEditorKeyBindings({
  editor,
  activeTab,
  saveFile,
  updateTabContent,
  toggleViewMode,
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

  // Print document: extract editor content into a new window and print that.
  // This avoids all the @media print CSS complexity of hiding app chrome.
  useEffect(() => {
    const handlePrint = () => {
      const prosemirror = document.querySelector(".ProseMirror");
      if (!prosemirror) return;

      // Clone the editor content
      const content = prosemirror.cloneNode(true) as HTMLElement;
      content.removeAttribute("contenteditable");

      // Collect all stylesheets from the current page
      const styles: string[] = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            styles.push(rule.cssText);
          }
        } catch {
          // Cross-origin stylesheets can't be read — skip
        }
      }

      // Create a hidden iframe, write the content, print it
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.left = "-10000px";
      iframe.style.top = "0";
      iframe.style.width = "800px";
      iframe.style.height = "600px";
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument;
      if (!doc) { iframe.remove(); return; }

      doc.open();
      doc.write(`<!DOCTYPE html>
<html><head>
<style>${styles.join("\n")}</style>
<style>
  body { margin: 0; padding: 24px 48px; background: white; color: black; max-width: 720px; margin: 0 auto; }
  @page { margin: 1in; }
  pre, table, .chart-block, .drawing-node-view, .mermaid-block, blockquote {
    break-inside: avoid;
  }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
  p { orphans: 3; widows: 3; }
  img, svg { max-width: 100%; height: auto; }
</style>
</head><body>${content.outerHTML}</body></html>`);
      doc.close();

      // Wait for rendering, then print the iframe
      setTimeout(() => {
        iframe.contentWindow?.print();
        // Clean up after print dialog closes
        setTimeout(() => iframe.remove(), 1000);
      }, 300);
    };
    window.addEventListener("notesage-print", handlePrint);
    // Expose for console testing: window.notesagePrint()
    (window as unknown as Record<string, unknown>).notesagePrint = handlePrint;
    return () => {
      window.removeEventListener("notesage-print", handlePrint);
      delete (window as unknown as Record<string, unknown>).notesagePrint;
    };
  }, []);

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
  };
}
