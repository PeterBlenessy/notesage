import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import { ReactRenderer } from "@tiptap/react";
import { DateHighlightPluginKey } from "./date-highlight";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import tippy, { type Instance } from "tippy.js";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";

interface DateItem {
  label: string;
  date: string;
  showCalendar?: boolean;
}

interface DateListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface DateListProps {
  items: DateItem[];
  command: (item: DateItem) => void;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatLabel(d: Date): string {
  return d.toLocaleDateString("default", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDateItems(query: string): DateItem[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const presets: DateItem[] = [
    { label: `Today — ${formatLabel(today)}`, date: formatDate(today) },
    { label: `Tomorrow — ${formatLabel(tomorrow)}`, date: formatDate(tomorrow) },
    { label: `Yesterday — ${formatLabel(yesterday)}`, date: formatDate(yesterday) },
    { label: `Next week — ${formatLabel(nextWeek)}`, date: formatDate(nextWeek) },
    { label: "Pick a date...", date: "", showCalendar: true },
  ];

  if (!query) return presets;

  const q = query.toLowerCase();
  // If the query looks like a partial date (digits and dashes), filter presets + try direct match
  const filtered = presets.filter(
    (p) => p.showCalendar || p.label.toLowerCase().includes(q) || p.date.includes(q)
  );

  // If query is a complete YYYY-MM-DD, add it as a direct option
  if (/^\d{4}-\d{2}-\d{2}$/.test(query)) {
    const exists = filtered.some((p) => p.date === query);
    if (!exists) {
      filtered.unshift({ label: query, date: query });
    }
  }

  return filtered;
}

const DateList = forwardRef<DateListRef, DateListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showCalendar, setShowCalendar] = useState(false);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
      setSelectedIndex(0);
      setShowCalendar(false);
    }, [items]);

    const setItemRef = useCallback(
      (index: number) => (el: HTMLButtonElement | null) => {
        itemRefs.current[index] = el;
      },
      []
    );

    const selectIndex = useCallback((next: number) => {
      flushSync(() => setSelectedIndex(next));
      itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
    }, []);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (showCalendar) {
          // Let calendar handle its own keys
          if (event.key === "Escape") {
            setShowCalendar(false);
            return true;
          }
          return false;
        }

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
            if (item.showCalendar) {
              setShowCalendar(true);
              return true;
            }
            command(item);
          }
          return true;
        }

        return false;
      },
    }));

    if (showCalendar) {
      return (
        <div className="z-50 rounded-lg border border-border bg-popover shadow-lg">
          <Calendar
            mode="single"
            selected={undefined}
            onSelect={(date) => {
              if (date) {
                command({ label: formatDate(date), date: formatDate(date) });
              }
            }}
          />
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="z-50 min-w-[220px] rounded-lg border border-border bg-popover p-1 shadow-lg">
          <div className="px-3 py-3 text-center text-sm text-muted-foreground">
            No matching dates
          </div>
        </div>
      );
    }

    return (
      <div className="z-50 min-w-[220px] max-h-[280px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg thin-scrollbar">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              ref={setItemRef(index)}
              key={item.showCalendar ? "__calendar__" : item.date}
              onClick={() => {
                if (item.showCalendar) {
                  setShowCalendar(true);
                } else {
                  command(item);
                }
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left",
                isSelected && "bg-[var(--color-accent-primary)]/12"
              )}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-sm text-foreground">{item.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
);

DateList.displayName = "DateList";

export const DateSuggestion = Extension.create({
  name: "dateSuggestion",

  addOptions() {
    return {
      suggestion: {
        char: "//",
        pluginKey: new PluginKey("dateSuggestion"),
        allowSpaces: false,
        startOfLine: false,
        allow: ({ state, range }: { state: EditorState; range: Range }) => {
          const editorState = state;
          const $from = editorState.doc.resolve(range.from);
          // Suppress in code blocks
          if ($from.parent.type.name === "codeBlock") return false;
          // Suppress when cursor overlaps any existing date decoration
          const dateDecos = DateHighlightPluginKey.getState(
            editorState
          ) as DecorationSet | undefined;
          if (dateDecos) {
            const found = dateDecos.find(range.from, range.to);
            if (found.length > 0) return false;
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
          props: DateItem;
        }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(`//${props.date} `)
            .run();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    let lastTxChangedDoc = false;

    const docChangeTracker = new Plugin({
      key: new PluginKey("dateSuggestionDocTracker"),
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
        allow: ({ state, range, isActive }: { state: EditorState; range: Range; isActive?: boolean }) => {
          if (!isActive && !lastTxChangedDoc) return false;

          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name === "codeBlock") return false;

          const dateDecos = DateHighlightPluginKey.getState(state) as
            | DecorationSet
            | undefined;
          if (dateDecos) {
            const found = dateDecos.find(range.from, range.to);
            if (found.length > 0) return false;
          }
          return true;
        },
        items: ({ query }: { query: string }) => {
          return getDateItems(query);
        },
        render: () => {
          let component: ReactRenderer<DateListRef>;
          let popup: Instance[];

          return {
            onStart: (props: SuggestionProps<DateItem>) => {
              component = new ReactRenderer(DateList, {
                props,
                editor: props.editor,
              });

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

              popup = tippy("body", {
                getReferenceClientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },

            onUpdate(props: SuggestionProps<DateItem>) {
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
