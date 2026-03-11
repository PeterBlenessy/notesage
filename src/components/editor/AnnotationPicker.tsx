/**
 * AnnotationPicker — emoji picker popover for list item annotations.
 *
 * Rendered inside Editor.tsx alongside BubbleMenu. It listens to the
 * `notesage:annotation-click` window CustomEvent dispatched by the
 * ItemAnnotation ProseMirror plugin and opens a Radix Popover anchored
 * to the clicked widget's position.
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  setItemAnnotation,
} from "@/components/editor/extensions/item-annotation";
import type { AnnotationClickDetail } from "@/components/editor/extensions/item-annotation";

// ---------------------------------------------------------------------------
// Emoji palette
// ---------------------------------------------------------------------------

const EMOJI_ROWS: { label: string; emojis: string[] }[] = [
  {
    label: "Colored dots",
    emojis: ["🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚪"],
  },
  {
    label: "Category icons",
    emojis: ["📞", "📧", "📅", "💬", "🧠", "💡", "❓", "⭐", "🔥", "✅"],
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnnotationPickerProps {
  editor: Editor;
}

interface PickerState {
  open: boolean;
  nodePos: number;
  /** Viewport-relative top/left for the invisible anchor element */
  anchorTop: number;
  anchorLeft: number;
}

const CLOSED: PickerState = {
  open: false,
  nodePos: -1,
  anchorTop: -9999,
  anchorLeft: -9999,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnnotationPicker({ editor }: AnnotationPickerProps) {
  const [state, setState] = useState<PickerState>(CLOSED);
  // Invisible div used as the Radix PopoverAnchor
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onAnnotationClick = (e: Event) => {
      const detail = (e as CustomEvent<AnnotationClickDetail>).detail;
      if (!detail) return;

      setState({
        open: true,
        nodePos: detail.nodePos,
        anchorTop: detail.rect.bottom,
        anchorLeft: detail.rect.left,
      });
    };

    window.addEventListener("notesage:annotation-click", onAnnotationClick);
    return () => {
      window.removeEventListener("notesage:annotation-click", onAnnotationClick);
    };
  }, []);

  const handleSelect = (icon: string) => {
    if (state.nodePos < 0) return;
    setItemAnnotation(editor, state.nodePos, icon);
    setState(CLOSED);
    editor.view.focus();
  };

  const handleRemove = () => {
    if (state.nodePos < 0) return;
    setItemAnnotation(editor, state.nodePos, null);
    setState(CLOSED);
    editor.view.focus();
  };

  return (
    <Popover
      open={state.open}
      onOpenChange={(open) => {
        if (!open) setState(CLOSED);
      }}
    >
      {/*
       * Invisible fixed-position anchor div. We position it at the bottom-left
       * of the clicked annotation badge so the PopoverContent appears nearby.
       */}
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          aria-hidden="true"
          style={{
            position: "fixed",
            top: state.anchorTop,
            left: state.anchorLeft,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        />
      </PopoverAnchor>

      <PopoverContent
        className="w-auto p-2"
        align="start"
        side="bottom"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        avoidCollisions
      >
        <div className="space-y-1">
          {EMOJI_ROWS.map((row) => (
            <div key={row.label}>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 pb-0.5">
                {row.label}
              </p>
              <div className="flex flex-wrap gap-0.5">
                {row.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleSelect(emoji)}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted transition-colors duration-100 text-base leading-none cursor-pointer"
                    title={emoji}
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <Separator className="my-1" />

          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs text-muted-foreground hover:text-foreground h-7"
            onClick={handleRemove}
          >
            Remove annotation
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
