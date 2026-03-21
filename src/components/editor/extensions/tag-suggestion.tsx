import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import { TagHighlightPluginKey } from "./tag-highlight";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import tippy, { type Instance } from "tippy.js";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { Hash } from "lucide-react";
import { tauriApi } from "@/lib/tauri";
import { getSearchPaths } from "@/lib/command-palette";

interface TagItem {
  name: string;
}

interface TagListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface TagListProps {
  items: TagItem[];
  command: (item: TagItem) => void;
}

const TagList = forwardRef<TagListRef, TagListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const setItemRef = useCallback((index: number) => (el: HTMLButtonElement | null) => {
      itemRefs.current[index] = el;
    }, []);

    const selectIndex = useCallback((next: number) => {
      // flushSync forces React to synchronously render the new highlight
      // before we scroll, so both update in the same visual frame.
      flushSync(() => setSelectedIndex(next));
      itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
    }, []);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          selectIndex((selectedIndex + items.length - 1) % items.length);
          return true;
        }

        if (event.key === "ArrowDown") {
          selectIndex((selectedIndex + 1) % items.length);
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

    if (items.length === 0) {
      return (
        <div className="z-50 min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-lg">
          <div className="px-3 py-3 text-center text-sm text-muted-foreground">
            No matching tags
          </div>
        </div>
      );
    }

    return (
      <div className="z-50 min-w-[180px] max-h-[280px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg thin-scrollbar">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              ref={setItemRef(index)}
              key={item.name}
              onClick={() => command(item)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left",
                isSelected && "bg-accent"
              )}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <Hash className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-sm text-foreground">{item.name}</span>
            </button>
          );
        })}
      </div>
    );
  }
);

TagList.displayName = "TagList";

export const TagSuggestion = Extension.create({
  name: "tagSuggestion",

  addOptions() {
    return {
      suggestion: {
        char: "#",
        pluginKey: new PluginKey("tagSuggestion"),
        allowSpaces: false,
        allow: ({ state, range }: { state: unknown; range: Range }) => {
          const editorState = state as EditorState;
          const $from = editorState.doc.resolve(range.from);
          // Suppress in code blocks
          if ($from.parent.type.name === "codeBlock") return false;
          // Suppress when cursor is inside an existing tag decoration
          // (i.e. navigating through existing text, not actively typing a new tag).
          // If any tag decoration extends past the cursor, we're mid-tag.
          const tagDecos = TagHighlightPluginKey.getState(editorState);
          if (tagDecos) {
            const found = tagDecos.find(range.from, range.to);
            for (const deco of found) {
              if (deco.to > range.to) return false;
            }
          }
          return true;
        },
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: TagItem;
        }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(`#${props.name} `)
            .run();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    // Track whether the last transaction changed the document (typing)
    // vs only changed the selection (arrow-key navigation).
    // Suggestion plugins must only activate on text input, not cursor movement.
    let lastTxChangedDoc = false;

    const docChangeTracker = new Plugin({
      key: new PluginKey("tagSuggestionDocTracker"),
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
        allow: ({ state, range, isActive }: { state: unknown; range: Range; isActive: boolean }) => {
          // Only require doc change for initial activation, not while already active
          if (!isActive && !lastTxChangedDoc) return false;

          const editorState = state as EditorState;
          const $from = editorState.doc.resolve(range.from);
          if ($from.parent.type.name === "codeBlock") return false;

          // Block if cursor is in the middle of an existing tag decoration
          const tagDecos = TagHighlightPluginKey.getState(editorState);
          if (tagDecos) {
            const found = tagDecos.find(range.from, range.to);
            for (const deco of found) {
              if (deco.to > range.to) return false;
            }
          }
          return true;
        },
        items: async ({ query }: { query: string }): Promise<TagItem[]> => {
          try {
            const paths = getSearchPaths();
            const tags = await tauriApi.indexTags(paths, query || undefined);
            return tags.slice(0, 20).map((t) => ({ name: t.tag }));
          } catch {
            return [];
          }
        },
        render: () => {
          let component: ReactRenderer<TagListRef>;
          let popup: Instance[];

          return {
            onStart: (props: SuggestionProps<TagItem>) => {
              component = new ReactRenderer(TagList, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) {
                return;
              }

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },

            onUpdate(props: SuggestionProps<TagItem>) {
              component.updateProps(props);

              if (!props.clientRect) {
                return;
              }

              popup?.[0]?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },

            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === "Escape") {
                return false;
              }

              return component.ref?.onKeyDown(props) ?? false;
            },

            onExit() {
              popup?.[0]?.destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
