import { useEffect, useRef, useCallback } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { notesageCodeExtensions } from "../codemirror-theme";
import { loadLanguage, getLanguageName, getExtension } from "@/lib/codemirror-languages";
import { ViewerToolbarPill } from "./ViewerToolbarPill";

interface CodeEditorProps {
  content: string;
  fileName: string;
  filePath: string;
  tabId: string;
  isDirty: boolean;
  updateTabContent: (content: string) => void;
  /** Save with explicit content — called with the current editor content */
  saveFileWithContent: (content: string) => void;
}

export function CodeEditor({
  content,
  fileName,
  tabId,
  isDirty,
  updateTabContent,
  saveFileWithContent,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onUpdateRef = useRef(updateTabContent);
  const onSaveRef = useRef(saveFileWithContent);
  const settingContent = useRef(false);
  const languageCompartment = useRef(new Compartment());
  const currentTabId = useRef(tabId);

  // Keep refs in sync
  onUpdateRef.current = updateTabContent;
  onSaveRef.current = saveFileWithContent;

  const handleSave = useCallback(() => {
    const view = viewRef.current;
    if (view) {
      onSaveRef.current(view.state.doc.toString());
    }
  }, []);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const appKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          handleSave();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !settingContent.current) {
        const value = update.state.doc.toString();
        onUpdateRef.current(value);
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        appKeymap,
        ...notesageCodeExtensions,
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        rectangularSelection(),
        bracketMatching(),
        indentOnInput(),
        foldGutter(),
        history(),
        highlightSelectionMatches(),
        languageCompartment.current.of([]),
        keymap.of([
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
        ]),
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Load language asynchronously
    const ext = getExtension(fileName);
    if (ext) {
      loadLanguage(ext).then((lang) => {
        if (lang && viewRef.current) {
          viewRef.current.dispatch({
            effects: languageCompartment.current.reconfigure(lang),
          });
        }
      });
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create once — content/tab updates handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for find-open events and delegate to CodeMirror search
  useEffect(() => {
    const handleFindOpen = () => {
      if (viewRef.current) openSearchPanel(viewRef.current);
    };
    const handleFindReplaceOpen = () => {
      if (viewRef.current) openSearchPanel(viewRef.current);
    };
    window.addEventListener("notesage:find-open", handleFindOpen);
    window.addEventListener("notesage:find-replace-open", handleFindReplaceOpen);
    return () => {
      window.removeEventListener("notesage:find-open", handleFindOpen);
      window.removeEventListener("notesage:find-replace-open", handleFindReplaceOpen);
    };
  }, []);

  // Update content when switching tabs or on external change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // If the tab changed, reload the language
    if (currentTabId.current !== tabId) {
      currentTabId.current = tabId;
      const ext = getExtension(fileName);
      if (ext) {
        loadLanguage(ext).then((lang) => {
          if (lang && viewRef.current) {
            viewRef.current.dispatch({
              effects: languageCompartment.current.reconfigure(lang),
            });
          }
        });
      }
    }

    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      settingContent.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      });
      settingContent.current = false;
    }
  }, [content, tabId, fileName]);

  // Resolve language display name
  const ext = getExtension(fileName);
  const languageName = ext ? getLanguageName(ext) : null;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar — file name + dirty indicator (the Tiptap editor surface
          for markdown has its own toolbar; this is the code-file-specific
          variant and is shared across both layouts). */}
      <div className="h-9 border-b border-border px-3 flex items-center shrink-0 bg-background">
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {fileName}
        </span>
        {isDirty && (
          <span className="ml-1.5 text-xs text-muted-foreground">●</span>
        )}
      </div>

      {/*
        Floating language-indicator pill — same visual family as the PDF/EPUB/
        DOCX/PPTX viewer pills (PRD 2026-04-21-ui-refresh task #62). Positioned
        top-right rather than top-centre so it does not collide with the pill
        toolbar (quiet composer) or the tab bar (classic layout).
      */}
      {languageName && (
        <ViewerToolbarPill
          viewerId="code"
          className="top-4 right-4 left-auto translate-x-0"
        >
          <span className="tabular-nums text-xs font-medium px-1">
            {languageName}
          </span>
        </ViewerToolbarPill>
      )}

      {/* CodeMirror container — full width, no max-width */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div ref={containerRef} className="h-full" />
      </div>
    </div>
  );
}
