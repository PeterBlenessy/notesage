import type { Editor } from "@tiptap/core";
import {
  Trash2,
  TableCellsMerge,
  TableCellsSplit,
  TableProperties,
  BetweenVerticalStart,
  BetweenVerticalEnd,
  BetweenHorizontalStart,
  BetweenHorizontalEnd,
  TableRowsSplit,
  TableColumnsSplit,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toggleTableFilter, getTableFilterState } from "@/components/editor/extensions/table-filter";

interface TableToolbarContentProps {
  editor: Editor;
  onClose?: () => void;
}

function TableButton({
  onClick,
  disabled,
  title,
  destructive,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  destructive?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "disabled:opacity-30 active:scale-90",
            destructive
              ? "text-destructive hover:text-destructive hover:bg-destructive/10"
              : active
                ? "text-foreground bg-muted"
                : "text-muted-foreground"
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

function TableSeparator() {
  return <Separator orientation="vertical" className="h-4 mx-0.5" />;
}

/**
 * Table editing controls — rendered inside a Popover from the toolbar.
 * Not a BubbleMenu, so it won't conflict with the AI selection menu.
 */
export function TableToolbarContent({ editor, onClose }: TableToolbarContentProps) {
  const run = (fn: () => void) => {
    fn();
    // Don't close — user likely wants to do multiple table operations
  };

  return (
    <div className="flex items-center gap-0.5 p-1">
      {/* Add rows */}
      <TableButton
        onClick={() => run(() => editor.chain().focus().addRowBefore().run())}
        title="Add row above"
      >
        <BetweenHorizontalStart className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      <TableButton
        onClick={() => run(() => editor.chain().focus().addRowAfter().run())}
        title="Add row below"
      >
        <BetweenHorizontalEnd className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      {/* Add columns */}
      <TableButton
        onClick={() => run(() => editor.chain().focus().addColumnBefore().run())}
        title="Add column left"
      >
        <BetweenVerticalStart className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      <TableButton
        onClick={() => run(() => editor.chain().focus().addColumnAfter().run())}
        title="Add column right"
      >
        <BetweenVerticalEnd className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      <TableSeparator />

      {/* Merge / Split */}
      <TableButton
        onClick={() => run(() => editor.chain().focus().mergeCells().run())}
        disabled={!editor.can().mergeCells()}
        title="Merge cells"
      >
        <TableCellsMerge className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      <TableButton
        onClick={() => run(() => editor.chain().focus().splitCell().run())}
        disabled={!editor.can().splitCell()}
        title="Split cell"
      >
        <TableCellsSplit className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      <TableSeparator />

      {/* Header toggle */}
      <TableButton
        onClick={() => run(() => editor.chain().focus().toggleHeaderRow().run())}
        title="Toggle header row"
      >
        <TableProperties className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      {/* Filter toggle */}
      <TableButton
        onClick={() => run(() => toggleTableFilter(editor))}
        title="Filter rows"
        active={getTableFilterState(editor.state)?.active === true}
      >
        <Filter className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      <TableSeparator />

      {/* Delete operations */}
      <TableButton
        onClick={() => run(() => editor.chain().focus().deleteRow().run())}
        title="Delete row"
        destructive
      >
        <TableRowsSplit className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      <TableButton
        onClick={() => run(() => editor.chain().focus().deleteColumn().run())}
        title="Delete column"
        destructive
      >
        <TableColumnsSplit className="size-3.5" strokeWidth={1.5} />
      </TableButton>

      <TableButton
        onClick={() => {
          editor.chain().focus().deleteTable().run();
          onClose?.();
        }}
        title="Delete table"
        destructive
      >
        <Trash2 className="size-3.5" strokeWidth={1.5} />
      </TableButton>
    </div>
  );
}
