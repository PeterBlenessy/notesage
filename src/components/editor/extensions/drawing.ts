import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DrawingPreview } from "../DrawingPreview";
import { deleteDrawing } from "@/lib/drawing-storage";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { toast } from "sonner";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    drawing: {
      insertDrawing: (attrs?: {
        drawingId?: string;
        drawingJson?: string;
        width?: number | null;
        height?: number;
        blockWidth?: number | null;
        align?: string | null;
      }) => ReturnType;
      deleteDrawing: () => ReturnType;
    };
  }
}

const DrawingCleanupPluginKey = new PluginKey("drawingCleanup");

// Pending deletions with timeout IDs — allows cancellation on undo
const pendingCleanups = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Resolve the project root for the currently active file.
 * Uses the workspace store's findOwningProject to match the
 * active tab's file path to a project.
 */
function resolveProjectRoot(): string | undefined {
  const { openDocuments, activeTabId } = useEditorStore.getState();
  const activeTab = openDocuments.find((t) => t.id === activeTabId);
  if (!activeTab) return undefined;

  const ws = useWorkspaceStore.getState();
  const project = ws.findOwningProject(activeTab.filePath);
  return project?.path;
}

function queueDrawingCleanup(drawingId: string) {
  // Cancel any existing timer for this ID
  cancelDrawingCleanup(drawingId);

  // Delay deletion by 5 seconds to allow undo
  const timeoutId = setTimeout(() => {
    pendingCleanups.delete(drawingId);
    const projectRoot = resolveProjectRoot();
    if (projectRoot) {
      deleteDrawing(drawingId, projectRoot);
    }
  }, 5000);

  pendingCleanups.set(drawingId, timeoutId);

  toast("Drawing deleted", {
    description: "Undo to restore",
    duration: 5000,
  });
}

function cancelDrawingCleanup(drawingId: string) {
  const timeoutId = pendingCleanups.get(drawingId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    pendingCleanups.delete(drawingId);
  }
}

export const Drawing = Node.create({
  name: "drawing",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      drawingId: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-drawing-id") || null,
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-drawing-id": attributes.drawingId as string,
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
        default: 600,
        parseHTML: (element: HTMLElement) => {
          const h = element.getAttribute("data-height");
          return h ? Number(h) : 600;
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-height": String(attributes.height),
        }),
      },
      drawingJson: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-drawing-json") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.drawingJson) return {};
          return { "data-drawing-json": attributes.drawingJson as string };
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
      // `textAlign` is provided globally by the TextAlign extension (see
      // useEditor.ts) — toolbar align button writes the same attribute as
      // BlockSizeControls.
    };
  },

  parseHTML() {
    return [
      { tag: "div[data-drawing-json]" },
      { tag: "div[data-drawing-id]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "drawing-block",
        "data-type": "drawing",
      }),
      ["div", { class: "drawing-placeholder" }, "Drawing"],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingPreview, {
      update: ({ oldNode, newNode, updateProps }) => {
        if (oldNode.sameMarkup(newNode)) return true;
        updateProps();
        return true;
      },
    });
  },

  addCommands() {
    return {
      insertDrawing:
        (attrs) =>
        ({ commands }) => {
          const drawingId = attrs?.drawingId || crypto.randomUUID();
          return commands.insertContent({
            type: this.name,
            attrs: {
              drawingId,
              drawingJson: attrs?.drawingJson ?? null,
              width: attrs?.width ?? null,
              height: attrs?.height ?? 600,
              blockWidth: attrs?.blockWidth ?? null,
              align: attrs?.align ?? null,
            },
          });
        },
      deleteDrawing:
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
              drawingId: string | null;
              drawingJson: string | null;
              width: number | null;
              height: number;
              blockWidth: number | null;
              textAlign: string | null;
            };
          };

          if (n.attrs.drawingJson) {
            // Build optional {width=N align=X} suffix
            const parts: string[] = [];
            if (n.attrs.blockWidth != null) parts.push(`width=${n.attrs.blockWidth}`);
            if (n.attrs.textAlign != null) parts.push(`align=${n.attrs.textAlign}`);
            const suffix = parts.length > 0 ? ` {${parts.join(" ")}}` : "";

            // Strip volatile appState fields to prevent dirty-on-open
            try {
              const parsed = JSON.parse(n.attrs.drawingJson);
              if (parsed.appState) {
                delete parsed.appState.scrollX;
                delete parsed.appState.scrollY;
                delete parsed.appState.zoom;
                delete parsed.appState.selectedElementIds;
                delete parsed.appState.cursorButton;
                delete parsed.appState.editingElement;
                delete parsed.appState.resizingElement;
                delete parsed.appState.selectionElement;
                delete parsed.appState.draggingElement;
                delete parsed.appState.editingGroupId;
                delete parsed.appState.editingLinearElement;
                // Remove empty appState
                if (Object.keys(parsed.appState).length === 0) {
                  delete parsed.appState;
                }
              }
              const json = JSON.stringify(parsed, null, 2);
              s.write("```excalidraw" + suffix + "\n" + json + "\n```\n\n");
            } catch {
              s.write("```excalidraw" + suffix + "\n" + n.attrs.drawingJson + "\n```\n\n");
            }
            return;
          }

          // Legacy fallback: sidecar image syntax. Width/align metadata are
          // appended as a trailing HTML comment so the configuration survives
          // even before the auto-migration to inline JSON has run.
          const drawingId = n.attrs.drawingId;
          if (!drawingId) return;

          const metaParts: string[] = [];
          if (n.attrs.blockWidth != null)
            metaParts.push(`blockWidth:${n.attrs.blockWidth}`);
          if (n.attrs.textAlign != null)
            metaParts.push(`align:${n.attrs.textAlign}`);
          const metaSuffix =
            metaParts.length > 0 ? ` <!--${metaParts.join(",")}-->` : "";

          s.write(
            `![drawing](/.notesage/drawings/${drawingId}.excalidraw)${metaSuffix}\n\n`
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
        key: DrawingCleanupPluginKey,
        appendTransaction(transactions, oldState, newState) {
          // Only check when document content changed
          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          // Skip cleanup for full content replacements (tab switches, external reloads)
          // — these have addToHistory: false and replace the entire document
          const isContentSwap = transactions.some(
            (tr) => tr.docChanged && tr.getMeta("addToHistory") === false
          );
          if (isContentSwap) return null;

          // Collect drawingIds in old and new state
          const oldIds = new Set<string>();
          const newIds = new Set<string>();

          oldState.doc.descendants((node) => {
            if (node.type.name === "drawing" && node.attrs.drawingId) {
              oldIds.add(node.attrs.drawingId as string);
            }
          });

          newState.doc.descendants((node) => {
            if (node.type.name === "drawing" && node.attrs.drawingId) {
              newIds.add(node.attrs.drawingId as string);
            }
          });

          // Find removed drawings — queue sidecar cleanup
          for (const id of oldIds) {
            if (!newIds.has(id)) {
              queueDrawingCleanup(id);
            }
          }

          // Find re-added drawings (undo) — cancel pending cleanup
          for (const id of newIds) {
            if (!oldIds.has(id)) {
              cancelDrawingCleanup(id);
            }
          }

          return null;
        },
      }),
    ];
  },
});
