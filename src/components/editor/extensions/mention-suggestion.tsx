import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import { MentionHighlightPluginKey } from "./mention-highlight";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import tippy, { type Instance } from "tippy.js";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { AtSign } from "lucide-react";
import { tauriApi } from "@/lib/tauri";
import { getAllSearchPaths } from "@/lib/command-palette";

interface MentionItem {
  name: string;
}

interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(
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
            No matching mentions
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
                isSelected && "bg-[var(--color-accent-primary)]/12"
              )}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <AtSign className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-sm text-foreground">{item.name}</span>
            </button>
          );
        })}
      </div>
    );
  }
);

MentionList.displayName = "MentionList";

export const MentionSuggestion = Extension.create({
  name: "mentionSuggestion",

  addOptions() {
    return {
      suggestion: {
        char: "@",
        pluginKey: new PluginKey("mentionSuggestion"),
        allowSpaces: false,
        allow: ({ state, range }: { state: unknown; range: Range }) => {
          const editorState = state as EditorState;
          const $from = editorState.doc.resolve(range.from);
          // Suppress in code blocks
          if ($from.parent.type.name === "codeBlock") return false;
          // Suppress when cursor is inside an existing mention decoration
          const mentionDecos = MentionHighlightPluginKey.getState(editorState);
          if (mentionDecos) {
            const found = mentionDecos.find(range.from, range.to);
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
          props: MentionItem;
        }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(`@${props.name} `)
            .run();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    let lastTxChangedDoc = false;

    const docChangeTracker = new Plugin({
      key: new PluginKey("mentionSuggestionDocTracker"),
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
        allow: ({ state, range, isActive }: { state: unknown; range: Range; isActive?: boolean }) => {
          if (!isActive && !lastTxChangedDoc) return false;

          const editorState = state as EditorState;
          const $from = editorState.doc.resolve(range.from);
          if ($from.parent.type.name === "codeBlock") return false;

          const mentionDecos = MentionHighlightPluginKey.getState(editorState);
          if (mentionDecos) {
            const found = mentionDecos.find(range.from, range.to);
            for (const deco of found) {
              if (deco.to > range.to) return false;
            }
          }
          return true;
        },
        items: async ({ query }: { query: string }): Promise<MentionItem[]> => {
          try {
            const paths = getAllSearchPaths();
            const mentions = await tauriApi.indexMentions(paths, query || undefined);
            return mentions.slice(0, 20).map((m) => ({ name: m.mention }));
          } catch {
            return [];
          }
        },
        render: () => {
          let component: ReactRenderer<MentionListRef>;
          let popup: Instance[];

          return {
            onStart: (props: SuggestionProps<MentionItem>) => {
              component = new ReactRenderer(MentionList, {
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

            onUpdate(props: SuggestionProps<MentionItem>) {
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
              if (popup?.[0] && !popup[0].state.isDestroyed) popup[0].destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
