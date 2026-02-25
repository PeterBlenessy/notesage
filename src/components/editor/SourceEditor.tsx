import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { notesageExtensions } from "./codemirror-theme";

interface SourceEditorProps {
  content: string;
  onUpdate?: (content: string) => void;
  onSave?: () => void;
}

export function SourceEditor({ content, onUpdate, onSave }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const onSaveRef = useRef(onSave);

  // Keep refs in sync
  onUpdateRef.current = onUpdate;
  onSaveRef.current = onSave;

  // Track whether we're programmatically setting content (to avoid feedback loops)
  const settingContent = useRef(false);

  const handleSave = useCallback(() => {
    onSaveRef.current?.();
  }, []);

  // Create editor
  useEffect(() => {
    if (!containerRef.current) return;

    const saveKeymap = keymap.of([
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
        onUpdateRef.current?.(value);
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        saveKeymap,
        ...notesageExtensions,
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
        markdown(),
        cmPlaceholder("Start typing markdown..."),
        keymap.of([
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
        ]),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create once — content updates handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update content when switching tabs (external content change)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

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
  }, [content]);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-[720px] mx-auto py-10 px-8">
        <div ref={containerRef} className="source-editor" />
      </div>
    </div>
  );
}
