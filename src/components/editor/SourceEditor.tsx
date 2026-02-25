import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "./codemirror-frontmatter";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { notesageExtensions } from "./codemirror-theme";
import { ghostTextExtensionCM } from "./codemirror-ghost-text";

interface SourceEditorProps {
  content: string;
  wordWrap?: boolean;
  onUpdate?: (content: string) => void;
  onSave?: () => void;
  onToggleViewMode?: () => void;
  onToggleWordWrap?: () => void;
  /** Called when the CodeMirror EditorView is created/destroyed. */
  onViewReady?: (view: EditorView | null) => void;
}

export function SourceEditor({ content, wordWrap = true, onUpdate, onSave, onToggleViewMode, onToggleWordWrap, onViewReady }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const onSaveRef = useRef(onSave);
  const onToggleViewModeRef = useRef(onToggleViewMode);
  const onToggleWordWrapRef = useRef(onToggleWordWrap);
  const wrapCompartment = useRef(new Compartment());

  // Keep refs in sync
  onUpdateRef.current = onUpdate;
  onSaveRef.current = onSave;
  onToggleViewModeRef.current = onToggleViewMode;
  onToggleWordWrapRef.current = onToggleWordWrap;

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
        key: "Shift-Mod-/",
        run: () => {
          onToggleViewModeRef.current?.();
          return true;
        },
      },
      {
        key: "Alt-z",
        run: () => {
          onToggleWordWrapRef.current?.();
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
        wrapCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
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

  // Dynamically toggle word wrap via compartment
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.current.reconfigure(
        wordWrap ? EditorView.lineWrapping : []
      ),
    });
  }, [wordWrap]);

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
    <div className="h-full">
      <div ref={containerRef} className="source-editor h-full" />
    </div>
  );
}
