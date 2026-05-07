/**
 * CodeMirror 6 + @lezer/markdown live-preview editor PoC.
 *
 * Two modes:
 *
 *   - **Standalone** (`?poc=cm6` in URL): full-page takeover with banner,
 *     baked-in sample document, exit button. Used for first-look feel-testing
 *     without touching real files.
 *
 *   - **Embedded** (props provided): mounts inline inside the normal editor
 *     layout, accepts the active tab's content and writes back through
 *     `onChange`/`onSave`. Toggled via the StatusTray "WYSIWYG | Markdown"
 *     segmented picker (settings.editorEngine === "cm6-live-preview").
 *
 * UX (Obsidian-style):
 *   - Cursor OFF a line → markdown markers (#, **, _, `, [, ](url)) hidden,
 *     headings/bold/italic/code/links rendered styled.
 *   - Cursor ON a line → markers reveal so you can edit them.
 *   - Callout blocks (`> [!note]`) render as cards when cursor is outside,
 *     swap to source view when cursor is inside.
 */

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { livePreviewPlugin } from "./live-preview-plugin";
import "./poc-styles.css";

const SAMPLE = `# Live preview PoC

This is a small playground to **feel** the Obsidian-style live preview UX on CodeMirror 6 + Lezer markdown. Click on any line to see the markdown markers reveal.

## What's shown here

Inline marks: regular text, **bold text**, *italic text*, ~~strikethrough~~ (markdown source only — not rendered in PoC), and \`inline code\`. Click into the line and the asterisks/backticks come back so you can edit them. Click anywhere else and they hide again.

Links work the same way: visit [the CodeMirror docs](https://codemirror.net/) — the brackets and URL hide when the cursor is elsewhere.

### Callouts as block widgets

Move your cursor inside the callout below. You should see the source markdown. Click outside, and it renders as a card.

> [!note] This is a Note callout
> Click into this block and you'll see the raw markdown source.
> Move the cursor anywhere outside the block and it renders as a card.
> The same source on disk is what your AI agents and your file watchers see.

> [!tip] Try a tip
> The block widget pattern scales to any rich block — drawings, charts, link
> previews, mermaid, etc. Each becomes one ~150 LOC widget like the callout.

> [!warning] One thing to feel
> Notice that nothing parses on save. Press Cmd+A → Cmd+C and the markdown
> on the clipboard IS the document. No round-trip.

### A typical writing flow

1. Type a heading line — \`# Foo\`. The \`#\` hides as soon as you leave the line.
2. Wrap a word in asterisks — \`**done**\`. Same behavior.
3. Hit Enter, write a paragraph. No flicker, no transitional artifacts.

The cost we're escaping by working at the text layer is the round-trip step that ProseMirror has to do every time content changes shape. The price is what you're seeing now: when your cursor sits on a line with bold, the \`**\` markers appear. Some people love it (they want to see what they're editing). Some people find it jarring (they want the markers to never appear, ever).

This is the exact decision point for the migration recommendation in the research doc.
`;

const cmHighlight = HighlightStyle.define([
  // Fallback styling for nodes our live-preview plugin doesn't decorate
  // (e.g. blockquote text when the cursor is inside the block).
  { tag: t.heading, fontWeight: "600" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "var(--color-accent-primary)" },
  { tag: t.url, color: "var(--color-muted-foreground)" },
  { tag: t.monospace, fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace" },
]);

interface CM6LivePreviewPoCProps {
  /**
   * Document content. When provided, embedded mode is active and the PoC
   * mounts inline (no banner, no exit button). When omitted, standalone
   * mode is active with the baked-in SAMPLE doc.
   */
  content?: string;
  /** Called on every doc change in embedded mode. */
  onChange?: (content: string) => void;
  /** Cmd+S handler in embedded mode. */
  onSave?: () => void;
  /** Optional explicit exit handler for standalone mode. */
  onExit?: () => void;
}

export function CM6LivePreviewPoC({
  content,
  onChange,
  onSave,
  onExit,
}: CM6LivePreviewPoCProps = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const isEmbedded = content !== undefined;

  // Keep callback refs current without re-creating the editor on every prop
  // change (the editor must stay stable so cursor / undo / scroll position
  // survive parent re-renders).
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // Track whether we're programmatically setting content (avoids feedback loops
  // when the parent updates `content` after our own onChange).
  const settingContent = useRef(false);

  // -----------------------------------------------------------------
  // Mount the editor exactly once. Subsequent `content` prop changes
  // are reconciled via a separate effect below so the editor's local
  // state (selection, undo, decorations) is preserved.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!hostRef.current) return;

    const initialDoc = content ?? SAMPLE;

    const appKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (settingContent.current) return;
      if (update.docChanged) {
        const next = update.state.doc.toString();
        onChangeRef.current?.(next);
      }
    });

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        appKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(cmHighlight),
        livePreviewPlugin,
        EditorView.lineWrapping,
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount-only: editor lifecycle is independent of prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------
  // Reconcile content prop in embedded mode (e.g. tab switch).
  // -----------------------------------------------------------------
  useEffect(() => {
    const view = viewRef.current;
    if (!view || content === undefined) return;
    const current = view.state.doc.toString();
    if (current === content) return;
    settingContent.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      });
    } finally {
      settingContent.current = false;
    }
  }, [content]);

  const handleExit = () => {
    if (onExit) {
      onExit();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("poc");
    window.history.replaceState({}, "", url.toString());
    window.location.reload();
  };

  if (isEmbedded) {
    // Embedded: render only the editor host. The surrounding shell (toolbar,
    // status bar, sidebar) belongs to the rest of the app.
    return (
      <div
        ref={hostRef}
        className="cm-poc-editor-host cm-poc-editor-embedded"
        data-poc="cm6-live-preview-embedded"
      />
    );
  }

  return (
    <div className="cm-poc-page" data-poc="cm6-live-preview">
      <div className="cm-poc-banner">
        <div>
          <span className="cm-poc-banner-title">CM6 Live Preview PoC</span>{" "}
          <span className="cm-poc-banner-hint">
            click any line to reveal markdown markers · click outside callouts
            to render them as cards
          </span>
        </div>
        <button
          className="cm-poc-banner-exit"
          onClick={handleExit}
          type="button"
        >
          Exit PoC
        </button>
      </div>
      <div ref={hostRef} className="cm-poc-editor-host" />
    </div>
  );
}
