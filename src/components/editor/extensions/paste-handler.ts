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
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { getPasteRules } from "@/lib/editor/paste-rules";

export const PasteHandlerPluginKey = new PluginKey("paste-handler");

export const PasteHandler = Extension.create({
  name: "pasteHandler",

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
