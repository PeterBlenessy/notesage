/**
 * TableHeaderMenu — column configuration context menu for table header cells.
 *
 * Listens for `notesage:table-header-menu` custom DOM events (dispatched by the
 * ProseMirror plugin in `table-header-menu.ts`) and renders a shadcn/ui
 * DropdownMenu (used instead of ContextMenu because ProseMirror owns the DOM
 * and we cannot wrap `<th>` elements in a ContextMenuTrigger).
 *
 * The DropdownMenu is controlled (`open` prop) with a hidden trigger element
 * positioned at the right-click coordinates.
 *
 * Menu selections dispatch ProseMirror transactions to update the header cell's
 * `colType`, `colCurrency`, and `colAggregation` attributes.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TABLE_HEADER_MENU_EVENT,
  TableHeaderMenuPluginKey,
  type TableHeaderMenuEventDetail,
} from "@/components/editor/extensions/table-header-menu";
import {
  COLUMN_TYPES,
  CURRENCY_CODES,
  AGGREGATION_TYPES,
  type ColumnType,
  type AggregationType,
} from "@/components/editor/extensions/table-column-types";
import { Hash, DollarSign, Percent, Calendar, Type } from "lucide-react";

// ---------------------------------------------------------------------------
// Labels & Icons
// ---------------------------------------------------------------------------

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Text",
  number: "Number",
  currency: "Currency",
  percentage: "Percentage",
  date: "Date",
};

const COLUMN_TYPE_ICONS: Record<ColumnType, React.ReactNode> = {
  text: <Type className="size-3.5 mr-2" strokeWidth={1.5} />,
  number: <Hash className="size-3.5 mr-2" strokeWidth={1.5} />,
  currency: <DollarSign className="size-3.5 mr-2" strokeWidth={1.5} />,
  percentage: <Percent className="size-3.5 mr-2" strokeWidth={1.5} />,
  date: <Calendar className="size-3.5 mr-2" strokeWidth={1.5} />,
};

const AGGREGATION_LABELS: Record<string, string> = {
  none: "None",
  sum: "Sum",
  avg: "Average",
  count: "Count",
  min: "Min",
  max: "Max",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TableHeaderMenuProps {
  editor: Editor;
}

export function TableHeaderMenu({ editor }: TableHeaderMenuProps) {
  const [menuState, setMenuState] = useState<TableHeaderMenuEventDetail | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Listen for the custom DOM event from the ProseMirror plugin
  useEffect(() => {
    function handleEvent(e: Event) {
      const detail = (e as CustomEvent<TableHeaderMenuEventDetail>).detail;
      setMenuState(detail);
      // Open the menu after state is set (next frame so trigger is positioned)
      requestAnimationFrame(() => {
        setOpen(true);
      });
    }

    window.addEventListener(TABLE_HEADER_MENU_EVENT, handleEvent);
    return () =>
      window.removeEventListener(TABLE_HEADER_MENU_EVENT, handleEvent);
  }, []);

  // Update a header cell attribute
  const updateHeaderAttr = useCallback(
    (attr: string, value: unknown) => {
      if (!menuState) return;

      const { state } = editor;
      const node = state.doc.nodeAt(menuState.cellPos);
      if (!node || node.type.name !== "tableHeader") return;

      const tr = state.tr.setNodeMarkup(menuState.cellPos, undefined, {
        ...node.attrs,
        [attr]: value,
      });

      // Signal the decoration plugin to rebuild type badges
      tr.setMeta(TableHeaderMenuPluginKey, { rebuildBadges: true });

      editor.view.dispatch(tr);

      // Update local state for immediate visual feedback in the menu
      setMenuState((prev) => (prev ? { ...prev, [attr]: value } : null));
    },
    [editor, menuState],
  );

  const setColumnType = useCallback(
    (type: ColumnType) => {
      if (!menuState) return;
      const { state } = editor;
      const node = state.doc.nodeAt(menuState.cellPos);
      if (!node || node.type.name !== "tableHeader") return;

      const attrs: Record<string, unknown> = {
        ...node.attrs,
        colType: type,
      };

      // Clear currency when switching away from currency type
      if (type !== "currency") {
        attrs.colCurrency = null;
      }
      // Default to USD when switching to currency without one set
      if (type === "currency" && !node.attrs.colCurrency) {
        attrs.colCurrency = "USD";
      }

      const tr = state.tr.setNodeMarkup(menuState.cellPos, undefined, attrs);
      tr.setMeta(TableHeaderMenuPluginKey, { rebuildBadges: true });
      editor.view.dispatch(tr);

      setMenuState((prev) =>
        prev
          ? {
              ...prev,
              colType: type,
              colCurrency:
                type === "currency" ? (prev.colCurrency ?? "USD") : null,
            }
          : null,
      );
    },
    [editor, menuState],
  );

  const setAggregation = useCallback(
    (agg: AggregationType | null) => {
      updateHeaderAttr("colAggregation", agg);
    },
    [updateHeaderAttr],
  );

  const setCurrency = useCallback(
    (code: string) => {
      updateHeaderAttr("colCurrency", code);
    },
    [updateHeaderAttr],
  );

  const handleOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      // Small delay before clearing state to allow animation
      setTimeout(() => setMenuState(null), 150);
    }
  }, []);

  const currentType = menuState?.colType || "text";
  const currentCurrency = menuState?.colCurrency;
  const currentAggregation = menuState?.colAggregation;

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
      {/* Hidden trigger positioned at the right-click location */}
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          aria-hidden
          tabIndex={-1}
          style={{
            position: "fixed",
            left: menuState?.x ?? -9999,
            top: menuState?.y ?? -9999,
            width: 0,
            height: 0,
            padding: 0,
            margin: 0,
            border: "none",
            opacity: 0,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-56"
        align="start"
        side="bottom"
        sideOffset={0}
      >
        {/* Column Type submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center">
            {COLUMN_TYPE_ICONS[currentType]}
            Column Type
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {COLUMN_TYPES.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={currentType === type}
                onSelect={() => setColumnType(type)}
              >
                <span className="flex items-center">
                  {COLUMN_TYPE_ICONS[type]}
                  {COLUMN_TYPE_LABELS[type]}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Currency submenu — only shown when type is currency */}
        {currentType === "currency" && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="flex items-center">
              <DollarSign className="size-3.5 mr-2" strokeWidth={1.5} />
              Currency ({currentCurrency ?? "USD"})
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36 max-h-64 overflow-y-auto">
              {CURRENCY_CODES.map((code) => (
                <DropdownMenuCheckboxItem
                  key={code}
                  checked={currentCurrency === code}
                  onSelect={() => setCurrency(code)}
                >
                  {code}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Summarize submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center">
            Summarize
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-36">
            <DropdownMenuCheckboxItem
              checked={!currentAggregation || currentAggregation === "none"}
              onSelect={() => setAggregation(null)}
            >
              None
            </DropdownMenuCheckboxItem>
            {AGGREGATION_TYPES.map((agg) => (
              <DropdownMenuCheckboxItem
                key={agg}
                checked={currentAggregation === agg}
                onSelect={() => setAggregation(agg)}
              >
                {AGGREGATION_LABELS[agg]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Existing table operations */}
        <DropdownMenuItem
          onSelect={() => editor.chain().focus().addColumnBefore().run()}
        >
          Insert column left
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => editor.chain().focus().addColumnAfter().run()}
        >
          Insert column right
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => editor.chain().focus().deleteColumn().run()}
        >
          Delete column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
