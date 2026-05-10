import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WIDTH_PRESETS = [25, 50, 75, 100] as const;

interface BlockSizeControlsProps {
  editor: Editor;
  /** ProseMirror position of the block node (resolved with `getPos()` in the
   *  caller — node views expose this). */
  pos: number;
  /** The block node — its `attrs` are spread into the new attribute set so
   *  every value (chartJson, drawingJson, height, …) is preserved. */
  node: ProseMirrorNode;
  blockWidth: number | null;
  align: string | null;
  /** Optional className applied to the outer flex container so the host node
   *  view can position the controls inside its own hover overlay. */
  className?: string;
}

/**
 * Inline width + alignment controls for the chart / drawing / link-preview
 * block nodes. Embedded inside each node view's existing hover-action overlay
 * (the same one that hosts Edit / Copy / Download) so the affordance is
 * discovered through the same hover affordance the user already knows.
 *
 * No portal, no global keyboard listener — just a row of buttons that mutate
 * `node.attrs.blockWidth` / `node.attrs.align` via a ProseMirror transaction.
 */
export function BlockSizeControls({
  editor,
  pos,
  node,
  blockWidth,
  align,
  className,
}: BlockSizeControlsProps) {
  // Use editor.chain().command(...).run() with `setNodeMarkup` — same pattern
  // ChartNodeView's `handleSave` uses to mutate `chartJson`. setNodeMarkup
  // routes through Tiptap's command pipeline (which calls `editor.emit('update', ...)`
  // and integrates with dirty-tracking) more reliably than a bare
  // `tr.setNodeAttribute` + `view.dispatch`.
  const updateAttrs = (next: Record<string, unknown>) => {
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
        return true;
      })
      .run();
  };

  const setBlockWidth = (width: number | null) => updateAttrs({ blockWidth: width });

  // Aligning a full-width block is a no-op visually (the block already fills
  // the column). When the user clicks center / right without first picking a
  // width, default to 75% so the alignment is immediately visible — common
  // pattern in Notion / Google Docs.
  //
  // `textAlign` is the canonical attribute name (provided by the TextAlign
  // extension globally for chart / drawing / image / linkPreview). Writing it
  // here means the toolbar's `Cmd+Shift+L/E/R` and the hover controls share
  // one source of truth.
  const setAlign = (next: string | null) => {
    const patch: Record<string, unknown> = { textAlign: next };
    if (next != null && blockWidth == null) {
      patch.blockWidth = 75;
    }
    updateAttrs(patch);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-md bg-muted/80 px-1 py-0.5 backdrop-blur-sm",
        className,
      )}
      // Don't steal selection focus when interacting with the controls.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {WIDTH_PRESETS.map((w) => {
        const active = blockWidth === w;
        return (
          <button
            key={w}
            type="button"
            aria-label={w === 100 ? "Full width" : `${w}% width`}
            title={w === 100 ? "Full width" : `${w}% width`}
            onClick={() => setBlockWidth(active ? null : w)}
            className={cn(
              "min-w-[28px] text-[10px] font-mono px-1 py-0.5 rounded-sm transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {w}%
          </button>
        );
      })}

      <span aria-hidden="true" className="mx-0.5 h-3 w-px bg-border/60" />

      {(
        [
          { value: "left", icon: AlignLeft, label: "Align left" },
          { value: "center", icon: AlignCenter, label: "Align center" },
          { value: "right", icon: AlignRight, label: "Align right" },
        ] as const
      ).map(({ value, icon: Icon, label }) => {
        const active = align === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            title={label}
            onClick={() => setAlign(active ? null : value)}
            className={cn(
              "h-5 w-5 inline-flex items-center justify-center rounded-sm transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" strokeWidth={1.5} />
          </button>
        );
      })}
    </div>
  );
}
