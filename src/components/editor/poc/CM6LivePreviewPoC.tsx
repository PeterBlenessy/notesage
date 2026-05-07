/**
 * Standalone PoC: CodeMirror 6 + @lezer/markdown live-preview editor.
 *
 * Activated by appending `?poc=cm6` to the URL. Bypasses the rest of the
 * Notesage shell and renders a single full-screen editor with a baked-in
 * sample document so you can feel the live-preview UX (Obsidian-style):
 *
 *   - Cursor OFF a line → markdown markers (#, **, _, `, [, ](url)) hidden,
 *     headings/bold/italic/code/links rendered styled.
 *   - Cursor ON a line → markers reveal so you can edit them.
 *   - Callout blocks (`> [!note]`) render as cards when cursor is outside,
 *     swap to source view when cursor is inside.
 *
 * No file IO, no persistence, no AI integration. Reload the page to reset.
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
  // We mostly style via our live-preview plugin; this fallback covers
  // anything we don't decorate (e.g. blockquote markers when cursor is inside).
  { tag: t.heading, fontWeight: "600" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "var(--color-accent-primary)" },
  { tag: t.url, color: "var(--color-muted-foreground)" },
  { tag: t.monospace, fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace" },
]);

export function CM6LivePreviewPoC({ onExit }: { onExit?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: SAMPLE,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(cmHighlight),
        livePreviewPlugin,
        EditorView.lineWrapping,
        // No line numbers in PoC — feels more like a writing surface.
        // Uncomment to enable: lineNumbers(),
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
    // Intentionally empty deps — we want one editor for the lifetime of the PoC
  }, []);

  const handleExit = () => {
    if (onExit) {
      onExit();
      return;
    }
    // Strip ?poc=cm6 from the URL and reload so the user lands back in the app
    const url = new URL(window.location.href);
    url.searchParams.delete("poc");
    window.history.replaceState({}, "", url.toString());
    window.location.reload();
  };

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
