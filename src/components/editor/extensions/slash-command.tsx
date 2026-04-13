import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey as PMPluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import tippy, { type Instance } from "tippy.js";
import { ComponentType, forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { cn } from "@/lib/utils";
import { DateHighlightPluginKey } from "./date-highlight";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  CodeSquare,
  Minus,
  Table,
  Image as ImageIcon,
  Info,
  Lightbulb,
  TriangleAlert,
  CircleAlert,
  Pencil,
  BarChart3,
  Workflow,
  Link,
  List as ListIcon,
} from "lucide-react";

interface CommandItem {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  command: (props: { editor: Editor; range: Range }) => void;
}

const commands: CommandItem[] = [
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: Heading1,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 1 })
        .run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: Heading2,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 2 })
        .run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: Heading3,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 3 })
        .run();
    },
  },
  {
    title: "Bullet List",
    description: "Create a simple bullet list",
    icon: List,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Create a list with numbering",
    icon: ListOrdered,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Task List",
    description: "Track tasks with checkboxes",
    icon: ListChecks,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: "Blockquote",
    description: "Capture a quote",
    icon: Quote,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Note Callout",
    description: "Informational callout block",
    icon: Info,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCallout({ type: "note" }).run();
    },
  },
  {
    title: "Tip Callout",
    description: "Helpful tip or suggestion",
    icon: Lightbulb,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCallout({ type: "tip" }).run();
    },
  },
  {
    title: "Warning Callout",
    description: "Warning or caution notice",
    icon: TriangleAlert,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCallout({ type: "warning" }).run();
    },
  },
  {
    title: "Important Callout",
    description: "Critical information callout",
    icon: CircleAlert,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCallout({ type: "important" }).run();
    },
  },
  {
    title: "Code Block",
    description: "Display code with syntax highlighting",
    icon: CodeSquare,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: "Horizontal Rule",
    description: "Insert a horizontal divider",
    icon: Minus,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: "Table",
    description: "Insert a table",
    icon: Table,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
  {
    title: "Image",
    description: "Insert an image",
    icon: ImageIcon,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      // Open the image insert dialog via the LocalImage extension storage callback
      const imageStorage = (editor.storage as unknown as Record<string, Record<string, unknown> | undefined>).image;
      const openDialog = imageStorage?.openInsertDialog;
      if (typeof openDialog === "function") {
        openDialog();
      }
    },
  },
  {
    title: "Drawing",
    description: "Insert an Excalidraw drawing",
    icon: Pencil,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertDrawing().run();
    },
  },
  {
    title: "Chart",
    description: "Insert an inline chart",
    icon: BarChart3,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertChart().run();
    },
  },
  {
    title: "Mermaid",
    description: "Insert a text-based diagram",
    icon: Workflow,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertMermaidBlock()
        .run();
    },
  },
  {
    title: "Embed",
    description: "Embed a link preview card",
    icon: Link,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertLinkPreview({ url: "" }).run();
    },
  },
  {
    title: "Table of Contents",
    description: "Insert a live table of contents",
    icon: ListIcon,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertTableOfContents().run();
    },
  },
];

interface CommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface CommandListProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((selectedIndex + items.length - 1) % items.length);
          return true;
        }

        if (event.key === "ArrowDown") {
          setSelectedIndex((selectedIndex + 1) % items.length);
          return true;
        }

        if (event.key === "Enter") {
          const item = items[selectedIndex];
          if (item) {
            command(item);
          }
          return true;
        }

        return false;
      },
    }));

    return (
      <div className="z-50 min-w-[240px] max-h-[min(360px,50vh)] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
        {items.length > 0 ? (
          items.map((item, index) => {
            const isSelected = index === selectedIndex;
            return (
              <button
                key={item.title}
                onClick={() => command(item)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-accent",
                  isSelected && "bg-accent"
                )}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0 bg-muted">
                  {<item.icon className="h-4 w-4" strokeWidth={1.5} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {item.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.description}
                  </div>
                </div>
              </button>
            );
          })
        ) : (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No results
          </div>
        )}
      </div>
    );
  }
);

CommandList.displayName = "CommandList";

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        pluginKey: new PMPluginKey("slashCommandSuggestion"),
        allow: ({ state, range }: { state: EditorState; range: Range }) => {
          const editorState = state;
          const $from = editorState.doc.resolve(range.from);
          // Suppress in code blocks
          if ($from.parent.type.name === "codeBlock") return false;
          // Suppress when cursor overlaps any existing date decoration
          // (prevents "/" inside "//YYYY-MM-DD" from triggering slash menu)
          const dateDecos = DateHighlightPluginKey.getState(
            editorState
          ) as DecorationSet | undefined;
          if (dateDecos) {
            const found = dateDecos.find(range.from, range.to);
            if (found.length > 0) return false;
          }
          return true;
        },
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: CommandItem }) => {
          props.command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    let lastTxChangedDoc = false;

    const docChangeTracker = new Plugin({
      key: new PMPluginKey("slashCommandDocTracker"),
      state: {
        init() {
          return false;
        },
        apply(tr) {
          lastTxChangedDoc = tr.docChanged;
          return tr.docChanged;
        },
      },
    });

    return [
      docChangeTracker,
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        allow: ({ state, range, isActive }: { editor: unknown; state: EditorState; range: Range; isActive?: boolean }) => {
          // Only require doc change for initial activation, not while already active
          if (!isActive && !lastTxChangedDoc) return false;

          const editorState = state;
          const $from = editorState.doc.resolve(range.from);
          if ($from.parent.type.name === "codeBlock") return false;

          // Dismiss when text becomes "//" — date suggestion takes over
          const text = editorState.doc.textBetween(range.from, range.to, "\0");
          if (text.startsWith("//")) return false;

          const dateDecos = DateHighlightPluginKey.getState(
            editorState
          ) as DecorationSet | undefined;
          if (dateDecos) {
            const found = dateDecos.find(range.from, range.to);
            if (found.length > 0) return false;
          }
          return true;
        },
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return commands.filter((item) =>
            item.title.toLowerCase().startsWith(q) ||
            item.title.toLowerCase().replace(/\s+/g, "").startsWith(q) ||
            item.title.toLowerCase().split(" ").some((word) => word.startsWith(q))
          );
        },
        render: () => {
          let component: ReactRenderer<CommandListRef>;
          let popup: Instance[];

          return {
            onStart: (props: SuggestionProps<CommandItem>) => {
              component = new ReactRenderer(CommandList, {
                props,
                editor: props.editor,
              });

              const getReferenceClientRect = () => {
                // Try decoration node first
                if (props.decorationNode) {
                  const r = props.decorationNode.getBoundingClientRect();
                  if (r.width > 0 || r.height > 0) return r;
                }
                // Try clientRect from Suggestion plugin
                if (props.clientRect) {
                  const r = props.clientRect();
                  if (r && (r.x > 0 || r.y > 0)) return r;
                }
                // Fallback: compute from ProseMirror coordsAtPos
                const coords = props.editor.view.coordsAtPos(props.range.from);
                return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
              };

              popup = tippy("body", {
                getReferenceClientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                popperOptions: {
                  modifiers: [
                    { name: "flip", options: { fallbackPlacements: ["top-start"] } },
                  ],
                },
              });
            },

            onUpdate(props: SuggestionProps<CommandItem>) {
              component.updateProps(props);

              const getReferenceClientRect = () => {
                if (props.decorationNode) {
                  const r = props.decorationNode.getBoundingClientRect();
                  if (r.width > 0 || r.height > 0) return r;
                }
                if (props.clientRect) {
                  const r = props.clientRect();
                  if (r && (r.x > 0 || r.y > 0)) return r;
                }
                const coords = props.editor.view.coordsAtPos(props.range.from);
                return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
              };

              popup?.[0]?.setProps({ getReferenceClientRect });
            },

            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === "Escape") {
                // Return false so the Suggestion plugin handles exit
                // (dispatches exit transaction + calls onExit to destroy popup)
                return false;
              }

              return component.ref?.onKeyDown(props) ?? false;
            },

            onExit() {
              if (popup?.[0] && !popup[0].state.isDestroyed) popup[0].destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
