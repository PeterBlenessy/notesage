import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { foldNodeProp } from "@codemirror/language";

/**
 * CodeMirror/Lezer Markdown extension that recognizes YAML frontmatter
 * blocks at the start of a document (--- delimited).
 *
 * Provides syntax highlighting (muted, meta-style) and fold support.
 */
export const yamlFrontmatter: MarkdownConfig = {
  defineNodes: [
    { name: "YAMLFrontmatter", block: true, style: tags.meta },
    { name: "YAMLFrontmatterMark", style: tags.processingInstruction },
    { name: "YAMLFrontmatterContent", style: tags.meta },
  ],
  props: [
    // Allow folding the frontmatter block (collapse everything between the --- delimiters)
    foldNodeProp.add({
      YAMLFrontmatter(node, state) {
        // Fold from end of first line (opening ---) to start of last line (closing ---)
        const firstLine = state.doc.lineAt(node.from);
        const lastLine = state.doc.lineAt(node.to);
        // Only fold if there are at least 3 lines (opening, content, closing)
        if (firstLine.number >= lastLine.number - 1) return null;
        return { from: firstLine.to, to: lastLine.from };
      },
    }),
  ],
  parseBlock: [
    {
      name: "YAMLFrontmatter",
      parse(cx, line) {
        // Only match at the very start of the document
        if (cx.lineStart !== 0) return false;

        // Must start with exactly "---" (optionally followed by whitespace)
        const trimmed = line.text.trimEnd();
        if (trimmed !== "---") return false;

        const from = cx.lineStart;
        const children = [
          cx.elt("YAMLFrontmatterMark", from, from + line.text.length),
        ];

        // Advance through lines looking for closing ---
        let foundClose = false;
        while (cx.nextLine()) {
          const closeTrimmed = line.text.trimEnd();
          if (closeTrimmed === "---" || closeTrimmed === "...") {
            // Closing delimiter
            children.push(
              cx.elt(
                "YAMLFrontmatterMark",
                cx.lineStart,
                cx.lineStart + line.text.length,
              ),
            );
            cx.nextLine();
            foundClose = true;
            break;
          }
          // YAML content line
          if (line.text.length > 0) {
            children.push(
              cx.elt(
                "YAMLFrontmatterContent",
                cx.lineStart,
                cx.lineStart + line.text.length,
              ),
            );
          }
        }

        // If we hit EOF without closing, still treat it as frontmatter
        // (better to highlight it as frontmatter than to leave it unstyled)
        cx.addElement(
          cx.elt(
            "YAMLFrontmatter",
            from,
            foundClose ? cx.prevLineEnd() : cx.lineStart,
            children,
          ),
        );
        return true;
      },
      before: "HorizontalRule",
    },
  ],
};
