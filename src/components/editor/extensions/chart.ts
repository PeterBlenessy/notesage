import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ChartNodeView } from "../charts/ChartNodeView";
import { deleteChart } from "@/lib/chart-storage";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { toast } from "sonner";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    chart: {
      insertChart: (attrs?: {
        chartId?: string;
        chartJson?: string;
        width?: number | null;
        height?: number;
        blockWidth?: number | null;
        align?: string | null;
      }) => ReturnType;
      deleteChart: () => ReturnType;
    };
  }
}

const ChartCleanupPluginKey = new PluginKey("chartCleanup");

// Pending deletions with timeout IDs — allows cancellation on undo
const pendingCleanups = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Resolve the project root for the currently active file.
 */
function resolveProjectRoot(): string | undefined {
  const { openDocuments, activeTabId } = useEditorStore.getState();
  const activeTab = openDocuments.find((t) => t.id === activeTabId);
  if (!activeTab) return undefined;

  const ws = useWorkspaceStore.getState();
  const project = ws.findOwningProject(activeTab.filePath);
  return project?.path;
}

function queueChartCleanup(chartId: string) {
  cancelChartCleanup(chartId);

  const timeoutId = setTimeout(() => {
    pendingCleanups.delete(chartId);
    const projectRoot = resolveProjectRoot();
    if (projectRoot) {
      deleteChart(chartId, projectRoot);
    }
  }, 5000);

  pendingCleanups.set(chartId, timeoutId);

  toast("Chart deleted", {
    description: "Undo to restore",
    duration: 5000,
  });
}

function cancelChartCleanup(chartId: string) {
  const timeoutId = pendingCleanups.get(chartId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    pendingCleanups.delete(chartId);
  }
}

export const Chart = Node.create({
  name: "chart",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      chartId: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-chart-id") || null,
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-chart-id": attributes.chartId as string,
        }),
      },
      width: {
        default: null as number | null,
        parseHTML: (element: HTMLElement) => {
          const w = element.getAttribute("data-width");
          return w ? Number(w) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          if (attributes.width == null) return {};
          return { "data-width": String(attributes.width) };
        },
      },
      height: {
        default: 300,
        parseHTML: (element: HTMLElement) => {
          const h = element.getAttribute("data-height");
          return h ? Number(h) : 300;
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-height": String(attributes.height),
        }),
      },
      chartJson: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-chart-json") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.chartJson) return {};
          return { "data-chart-json": attributes.chartJson as string };
        },
      },
      blockWidth: {
        default: null as number | null,
        parseHTML: (element: HTMLElement) => {
          const v = element.getAttribute("data-block-width");
          return v ? Number(v) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          if (attributes.blockWidth == null) return {};
          return { "data-block-width": String(attributes.blockWidth) };
        },
      },
      align: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-align") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.align) return {};
          return { "data-align": attributes.align as string };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-chart-json]",
      },
      {
        tag: "div[data-chart-id]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "chart-block",
        "data-type": "chart",
      }),
      ["div", { class: "chart-placeholder" }, "Chart"],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartNodeView, {
      // Skip React re-render when the chart node itself hasn't changed.
      // Return true = "handled, keep alive"; return false = "destroy & recreate".
      // Call updateProps() only when the node's attributes actually changed.
      update: ({ oldNode, newNode, updateProps }) => {
        if (oldNode.sameMarkup(newNode)) return true; // no change, skip re-render
        updateProps();
        return true;
      },
    });
  },

  addCommands() {
    return {
      insertChart:
        (attrs) =>
        ({ commands }) => {
          const chartId = attrs?.chartId || crypto.randomUUID();
          return commands.insertContent({
            type: this.name,
            attrs: {
              chartId,
              chartJson: attrs?.chartJson ?? null,
              width: attrs?.width ?? null,
              height: attrs?.height ?? 300,
              blockWidth: attrs?.blockWidth ?? null,
              align: attrs?.align ?? null,
            },
          });
        },
      deleteChart:
        () =>
        ({ commands }) => {
          return commands.deleteSelection();
        },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: unknown, node: unknown) {
          const s = state as {
            write: (text: string) => void;
          };
          const n = node as {
            attrs: {
              chartId: string | null;
              chartJson: string | null;
              width: number | null;
              height: number;
              blockWidth: number | null;
              align: string | null;
            };
          };

          if (n.attrs.chartJson) {
            // Build optional {width=N align=X} suffix
            const parts: string[] = [];
            if (n.attrs.blockWidth != null) parts.push(`width=${n.attrs.blockWidth}`);
            if (n.attrs.align != null) parts.push(`align=${n.attrs.align}`);
            const suffix = parts.length > 0 ? ` {${parts.join(" ")}}` : "";

            // Inline format: fenced code block with pretty-printed JSON
            try {
              const parsed = JSON.parse(n.attrs.chartJson);
              const prettyJson = JSON.stringify(parsed, null, 2);
              s.write("```chart" + suffix + "\n" + prettyJson + "\n```\n\n");
            } catch {
              // If JSON is invalid, write raw
              s.write("```chart" + suffix + "\n" + n.attrs.chartJson + "\n```\n\n");
            }
            return;
          }

          // Legacy fallback: sidecar image syntax. Width/align metadata are
          // appended as a trailing HTML comment so the configuration survives
          // even before the auto-migration to inline JSON has run.
          const chartId = n.attrs.chartId;
          if (!chartId) return;

          const metaParts: string[] = [];
          if (n.attrs.blockWidth != null)
            metaParts.push(`blockWidth:${n.attrs.blockWidth}`);
          if (n.attrs.align != null) metaParts.push(`align:${n.attrs.align}`);
          const metaSuffix =
            metaParts.length > 0 ? ` <!--${metaParts.join(",")}-->` : "";

          s.write(
            `![chart](/.notesage/charts/${chartId}.json)${metaSuffix}\n\n`,
          );
        },
        parse: {
          // Parsing is handled by the preprocessor in markdown.ts
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ChartCleanupPluginKey,
        appendTransaction(transactions, oldState, newState) {
          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          const oldIds = new Set<string>();
          const newIds = new Set<string>();

          oldState.doc.descendants((node) => {
            if (node.type.name === "chart" && node.attrs.chartId) {
              oldIds.add(node.attrs.chartId as string);
            }
          });

          newState.doc.descendants((node) => {
            if (node.type.name === "chart" && node.attrs.chartId) {
              newIds.add(node.attrs.chartId as string);
            }
          });

          // Queue cleanup for removed charts
          for (const id of oldIds) {
            if (!newIds.has(id)) {
              queueChartCleanup(id);
            }
          }

          // Cancel pending cleanup for re-added charts (undo)
          for (const id of newIds) {
            if (!oldIds.has(id)) {
              cancelChartCleanup(id);
            }
          }

          return null;
        },
      }),
    ];
  },
});
