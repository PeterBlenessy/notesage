import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "./codemirror-frontmatter";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { notesageExtensions } from "./codemirror-theme";
import { ghostTextExtensionCM } from "./codemirror-ghost-text";

interface SourceEditorProps {
  content: string;
  onUpdate?: (content: string) => void;
  onSave?: () => void;
  onToggleViewMode?: () => void;
  /** Called when the CodeMirror EditorView is created/destroyed. */
  onViewReady?: (view: EditorView | null) => void;
}

export function SourceEditor({ content, onUpdate, onSave, onToggleViewMode, onViewReady }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const onSaveRef = useRef(onSave);
  const onToggleViewModeRef = useRef(onToggleViewMode);

  // Keep refs in sync
  onUpdateRef.current = onUpdate;
  onSaveRef.current = onSave;
  onToggleViewModeRef.current = onToggleViewMode;

  // Track whether we're programmatically setting content (to avoid feedback loops)
  const settingContent = useRef(false);

  const handleSave = useCallback(() => {
    onSaveRef.current?.();
  }, []);

  // Create editor
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
      {
        key: "Mod-/",
        run: () => {
          onToggleViewModeRef.current?.();
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
        appKeymap,
        ...ghostTextExtensionCM,
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
        markdown({ extensions: [yamlFrontmatter] }),
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
    onViewReady?.(view);

    return () => {
      view.destroy();
      viewRef.current = null;
      onViewReady?.(null);
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
    <div className="min-h-full">
      <div className="max-w-[720px] mx-auto py-10 px-8">
        <div ref={containerRef} className="source-editor" />
      </div>
    </div>
  );
}
