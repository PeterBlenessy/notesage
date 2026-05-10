import { useEffect, useState, useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const BLOCK_NODE_TYPES = new Set(["chart", "drawing", "linkPreview"]);
const WIDTH_PRESETS = [25, 50, 75, 100] as const;

interface ToolbarState {
  pos: number;
  blockWidth: number | null;
  align: string | null;
  rect: DOMRect;
}

interface BlockSizeToolbarProps {
  editor: Editor;
}

export function BlockSizeToolbar({ editor }: BlockSizeToolbarProps) {
  const [state, setState] = useState<ToolbarState | null>(null);

  useEffect(() => {
    const update = () => {
      const { selection } = editor.state;
      if (!(selection instanceof NodeSelection)) {
        setState(null);
        return;
      }
      const { node } = selection;
      if (!BLOCK_NODE_TYPES.has(node.type.name)) {
        setState(null);
        return;
      }
      const dom = editor.view.nodeDOM(selection.from) as HTMLElement | null;
      if (!dom) {
        setState(null);
        return;
      }
      const rect = dom.getBoundingClientRect();
      setState({
        pos: selection.from,
        blockWidth: (node.attrs.blockWidth as number | null) ?? null,
        align: (node.attrs.align as string | null) ?? null,
        rect,
      });
    };

    editor.on("selectionUpdate", update);
    editor.on("update", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
    };
  }, [editor]);

  const setBlockWidth = useCallback(
    (width: number | null) => {
      if (!state) return;
      const { tr } = editor.state;
      tr.setNodeAttribute(state.pos, "blockWidth", width);
      editor.view.dispatch(tr);
    },
    [editor, state],
  );

  const setAlign = useCallback(
    (align: string | null) => {
      if (!state) return;
      const { tr } = editor.state;
      tr.setNodeAttribute(state.pos, "align", align);
      editor.view.dispatch(tr);
    },
    [editor, state],
  );

  if (!state) return null;

  const { blockWidth, align, rect } = state;

  return (
    <div
      style={{
        position: "fixed",
        left: rect.left,
        top: Math.max(rect.top - 40, 4),
        zIndex: 50,
      }}
      className={cn(
        "flex items-center gap-0.5 p-1",
        "bg-popover text-popover-foreground",
        "border border-border rounded-lg shadow-md",
        "backdrop-blur-sm",
      )}
      onMouseDown={(e) => e.preventDefault()}
    >
      {WIDTH_PRESETS.map((w) => (
        <Tooltip key={w}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setBlockWidth(blockWidth === w ? null : w)}
              className={cn(
                "min-w-[28px] text-xs font-mono",
                blockWidth === w
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {w}%
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {w === 100 ? "Full width" : `${w}% width`}
          </TooltipContent>
        </Tooltip>
      ))}

      <Separator orientation="vertical" className="h-4 mx-0.5" />

      {(
        [
          {
            value: "left",
            icon: <AlignLeft className="size-3.5" strokeWidth={1.5} />,
            label: "Align left",
          },
          {
            value: "center",
            icon: <AlignCenter className="size-3.5" strokeWidth={1.5} />,
            label: "Align center",
          },
          {
            value: "right",
            icon: <AlignRight className="size-3.5" strokeWidth={1.5} />,
            label: "Align right",
          },
        ] as const
      ).map(({ value, icon, label }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setAlign(align === value ? null : value)}
              className={cn(
                align === value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
