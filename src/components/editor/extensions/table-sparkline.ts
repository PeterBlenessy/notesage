import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import { renderSparkline } from "@/lib/sparkline";
import { createDecorationPlugin } from "./decoration-factory";

const SPARKLINE_RE = /\{\{spark:([\d.,\s-]+)\}\}/g;

export const TableSparklinePluginKey = new PluginKey("tableSparkline");

let sparklineCounter = 0;

/**
 * Parse a comma-separated string of numbers into an array.
 * Returns an empty array if no valid numbers are found.
 */
function parseSparklineData(dataStr: string): number[] {
  return dataStr
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));
}

/**
 * Check whether the selection cursor is within the given range.
 * If so, we show the raw text instead of the sparkline decoration
 * to allow editing.
 */
function selectionOverlaps(
  selection: Selection,
  from: number,
  to: number,
): boolean {
  return selection.from <= to && selection.to >= from;
}

function buildSparklineDecorations(
  doc: PMNode,
  selection: Selection,
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    // Skip code blocks entirely
    if (node.type.name === "codeBlock") return false;

    if (!node.isText || !node.text) return;

    // Skip text nodes with a code mark
    if (node.marks.some((m) => m.type.name === "code")) return;

    const text = node.text;
    SPARKLINE_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = SPARKLINE_RE.exec(text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      const dataStr = match[1];

      // When cursor is inside this sparkline range, show raw text for editing
      if (selectionOverlaps(selection, from, to)) {
        continue;
      }

      const data = parseSparklineData(dataStr);
      if (data.length === 0) continue;

      // Widget decoration: renders the sparkline SVG at the start of the range
      decorations.push(
        Decoration.widget(
          from,
          () => {
            const svg = renderSparkline(data, 60, 20);
            const wrapper = document.createElement("span");
            wrapper.className = "sparkline-widget";
            wrapper.setAttribute("data-sparkline", dataStr);
            wrapper.setAttribute("aria-label", `sparkline: ${dataStr}`);
            wrapper.appendChild(svg);
            return wrapper;
          },
          { side: 0 },
        ),
      );

      // Inline decoration: hides the raw text visually
      decorations.push(
        Decoration.inline(from, to, {
          class: "sparkline-raw-text",
        }),
      );
    }
  });

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

export const TableSparkline = Extension.create({
  name: "tableSparkline",

  addProseMirrorPlugins() {
    return [
      createDecorationPlugin({
        key: TableSparklinePluginKey,
        buildDecorations: (state) =>
          buildSparklineDecorations(state.doc, state.selection),
        rebuildOnSelectionChange: true,
        onRebuild({ docNodeSize, decorationCount, elapsedMs }) {
          sparklineCounter++;
          if (sparklineCounter % 10 === 0) {
            console.log("[perf:typing]", {
              plugin: "TableSparkline",
              docNodes: docNodeSize,
              decorationCount,
              ms: elapsedMs,
            });
          }
        },
      }),
    ];
  },
});
