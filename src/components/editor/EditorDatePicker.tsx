import type { Editor } from "@tiptap/core";
import { DatePickerPopover } from "./DatePickerPopover";

interface EditorDatePickerProps {
  editor: Editor | null;
}

/**
 * Date-badge edit popover, extracted verbatim from Editor.tsx. Rewrites a
 * `//YYYY-MM-DD` date token in place (or by document search fallback) when the
 * user picks a new date. Renders the same `<DatePickerPopover>` DOM.
 */
export function EditorDatePicker({ editor }: EditorDatePickerProps) {
  return (
    <DatePickerPopover
      onDateChange={(oldDate, newDate, from, to) => {
        if (!editor) return;
        const newText = `//${newDate}`;
        if (from >= 0 && to >= 0) {
          // Use the exact ProseMirror position from the click handler
          editor
            .chain()
            .focus()
            .command(({ tr }) => {
              tr.insertText(newText, from, to);
              return true;
            })
            .run();
        } else {
          // Fallback: search the document for the old date text
          const oldText = `//${oldDate}`;
          const { doc } = editor.state;
          let replaced = false;
          doc.descendants((node, pos) => {
            if (replaced) return false;
            if (!node.isText || !node.text) return;
            const idx = node.text.indexOf(oldText);
            if (idx !== -1) {
              const f = pos + idx;
              const t = f + oldText.length;
              editor
                .chain()
                .focus()
                .command(({ tr }) => {
                  tr.insertText(newText, f, t);
                  return true;
                })
                .run();
              replaced = true;
            }
          });
        }
      }}
    />
  );
}
