/**
 * PasteHandler — Tiptap extension that runs pasted clipboard content
 * through the registered paste rules in `src/lib/editor/paste-rules.ts`
 * before falling back to the default markdown-paste path.
 *
 * Tiptap's default behaviour parses every `text/plain` payload as
 * markdown, which misfires for file paths with `~` (renders as
 * `<sub>`), terminal-rendered tables (loses column alignment),
 * AI-response prose with markdown punctuation, etc. The rules give us
 * a single extensible point to intercept those cases.
 *
 * See `src/lib/editor/paste-rules.ts` for the rule contract and
 * built-in rules. New rules can be added at any time via
 * `registerPasteRule` — this extension does not need to be aware of them.
 *
 * Also binds `Mod-Shift-v` ("paste as plain text") — see
 * `pasteAsPlainText` below. Reads the system clipboard via
 * `navigator.clipboard.readText()` and inserts the result as literal
 * text, fully bypassing both the paste-rule registry AND tiptap-markdown.
 * The user reported this as the most-cited remaining paste annoyance
 * in the 2026-04-25 live test (prose copied from terminals / Slack /
 * AI responses where literal `~text~`, `*foo*`, `_bar_`, or backticks
 * accidentally lit up markdown formatting).
 */

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { getPasteRules } from "@/lib/editor/paste-rules";

export const PasteHandlerPluginKey = new PluginKey("paste-handler");

/**
 * Read the system clipboard and insert its `text/plain` content as
 * literal text at the current selection. Returns `true` when the paste
 * was consumed (i.e. the keyboard shortcut should not fall through),
 * even if the clipboard read failed asynchronously — we always claim
 * the keystroke so the default browser paste doesn't also fire.
 *
 * Exported so unit tests can drive the read+insert path directly
 * without simulating the full editor-keyboard pipeline.
 */
export async function pasteAsPlainText(editor: Editor): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    return false;
  }
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return false;
  }
  if (!text) return true; // nothing to paste, but we claimed the keystroke
  // Use `editor.view.state` (latest) rather than the closure'd state —
  // the user may have moved the cursor while the async read was pending.
  const { view } = editor;
  view.dispatch(view.state.tr.insertText(text));
  return true;
}

export const PasteHandler = Extension.create({
  name: "pasteHandler",

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-v": ({ editor }) => {
        // Fire-and-forget: navigator.clipboard.readText is async, but
        // tiptap keyboard handlers are synchronous. We claim the
        // keystroke immediately (return true) so the default browser
        // paste doesn't also run, then resolve the insert when the
        // clipboard read returns.
        void pasteAsPlainText(editor);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: PasteHandlerPluginKey,
        props: {
          handlePaste(view, event) {
            const clipboardData = (event as ClipboardEvent).clipboardData;
            if (!clipboardData) return false;

            const text = clipboardData.getData("text/plain") ?? "";
            const html = clipboardData.getData("text/html") || null;

            const ctx = {
              clipboardData,
              text,
              html,
              view,
              event: event as ClipboardEvent,
            };

            for (const rule of getPasteRules()) {
              if (!rule.test(ctx)) continue;
              if (rule.handle(ctx)) {
                // Rule consumed the paste. Tiptap will skip its own paste
                // handling (returning `true` from handlePaste tells PM the
                // event was handled).
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

export default PasteHandler;
