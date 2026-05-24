import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  CodeSquare,
  Minus,
  Image as ImageIcon,
  Undo,
  Redo,
  FileCode,
  FileText,
  WrapText,
  AlignLeft,
  AlignCenter,
  AlignRight,
  IndentIncrease,
  IndentDecrease,
  Pencil,
  BarChart3,
  Subscript,
  Superscript,
  MoreHorizontal,
  Link as LinkIcon,
  BetweenHorizontalStart,
  BetweenHorizontalEnd,
  BetweenVerticalStart,
  BetweenVerticalEnd,
  TableProperties,
  TableCellsMerge,
  TableCellsSplit,
  TableRowsSplit,
  TableColumnsSplit,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/file-utils";
import {
  HeadingPicker,
  LinkButton,
  TextColorPopover,
  HighlightPopover,
  TypographyPopover,
  MicButton,
  TableGridPicker,
  TableToolsPopover,
  CalloutPicker,
} from "./toolbar/index";

interface ToolbarProps {
  editor: Editor | null;
  onImageInsert?: () => void;
  viewMode?: ViewMode;
  onToggleViewMode?: () => void;
  sourceWordWrap?: boolean;
  onToggleWordWrap?: () => void;
  /**
   * Visual variant. The app exclusively uses `"pill"`; the `"inline"`
   * variant is retained as a fallback for direct callers / regression
   * tests and could be removed in a follow-up cleanup PR.
   * - `"inline"` (default): flat bar, relies on the parent wrapper for
   *   the bottom border. Byte-identical to pre-#49 rendering.
   * - `"pill"`: self-contained rounded pill with `backdrop-blur`,
   *   subtle border + shadow. Positioning is the caller's
   *   responsibility (e.g. `QuietLayout` absolutely positions at
   *   top-centre). Tagged with `data-quiet-toolbar` so the `.typing`
   *   fade-on-type class (#50) can target it without coupling to
   *   Tailwind classnames.
   */
  variant?: "inline" | "pill";
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
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
            "disabled:opacity-50 active:scale-90",
            active
              ? "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
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

function ToolbarSeparator() {
  return <Separator orientation="vertical" className="h-4 mx-0.5" />;
}

// --- Main Toolbar ---

export function Toolbar({ editor, onImageInsert, viewMode = "wysiwyg", onToggleViewMode, sourceWordWrap, onToggleWordWrap, variant = "inline" }: ToolbarProps) {
  const isSource = viewMode === "source";
  const isPill = variant === "pill";

  // Force re-render on editor transactions so active state (heading level, bold, etc.) stays current
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const onTransaction = () => setTick((t) => t + 1);
    editor.on("transaction", onTransaction);
    return () => { editor.off("transaction", onTransaction); };
  }, [editor]);

  const isInList = editor
    ? editor.isActive("bulletList") || editor.isActive("orderedList") || editor.isActive("taskList")
    : false;

  // Inline (legacy) variant: byte-identical to pre-#49 behaviour — flat bar
  // that relies on the parent for the bottom border, fills available width.
  // Pill (quiet-composer) variant: self-contained floating chrome — rounded,
  // bordered, backdrop-blurred, subtle shadow. Inner row keeps the scroll
  // fallback for narrow widths but the pill itself sits at its natural size.
  const wrapperClassName = isPill
    ? cn(
        "inline-flex items-center gap-0.5 px-1.5 py-1 min-w-0",
        "rounded-full border border-border bg-background/70 shadow-sm",
        "backdrop-blur-[14px]",
        // #86 reduced-motion sweep: the typing-fade pulse is decorative —
        // disable the opacity transition entirely under reduce, don't shorten.
        "transition-opacity duration-[340ms] ease-in-out",
        "motion-reduce:transition-none",
      )
    : "h-9 px-2 flex items-center gap-0.5 overflow-x-auto overflow-y-hidden flex-1 min-w-0";

  // Pill (quiet-composer) variant: reduced 8-button set per task #110.
  // Inline (legacy) variant: full button set, byte-identical to pre-#110.
  // Source mode in pill is handled in the StatusTray's source-mode toggle —
  // the pill itself never renders for source mode (Editor short-circuits).
  if (isPill) {
    return (
      <TooltipProvider delayDuration={300}>
        <div
          data-quiet-toolbar=""
          className={wrapperClassName}
        >
          {!isSource && editor && (
            <>
              {/* Heading */}
              <HeadingPicker editor={editor} />

              {/* Quote */}
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                active={editor.isActive("blockquote")}
                title="Blockquote"
              >
                <Quote className="size-4" strokeWidth={1.5} />
              </ToolbarButton>

              {/* Task list */}
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleTaskList().run()}
                active={editor.isActive("taskList")}
                title="Task List"
              >
                <ListChecks className="size-4" strokeWidth={1.5} />
              </ToolbarButton>

              <ToolbarSeparator />

              {/* Text color & Highlight */}
              <TextColorPopover editor={editor} />
              <HighlightPopover editor={editor} />

              <ToolbarSeparator />

              {/* Callout */}
              <CalloutPicker editor={editor} />

              {/* Table */}
              <TableGridPicker editor={editor} />

              {/* Typography */}
              <TypographyPopover editor={editor} />

              <ToolbarSeparator />

              {/* Overflow menu — power-user actions kept off the pill (#112).
                  Fixed order, no auto-sort (see followup F13): muscle memory
                  matters more than usage frequency for a 7-item list. */}
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground"
                        title="More"
                      >
                        <MoreHorizontal className="size-4" strokeWidth={1.5} />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    More
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-48 max-h-[70vh] overflow-y-auto">
                  {/*
                    Inline marks. Bold / Italic / Underline / Sub / Super
                    were missing from the pill entirely (visible AND
                    overflow) before the 2026-04-26 parity restoration —
                    every canonical formatting action listed in
                    `docs/keyboard-shortcuts.md` "Toolbar Controls (Mouse)"
                    is now reachable from the pill, either as a first-class
                    button or through this menu.
                  */}
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("bold") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                  >
                    <Bold className="size-4 shrink-0" strokeWidth={1.5} />
                    Bold
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("italic") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                  >
                    <Italic className="size-4 shrink-0" strokeWidth={1.5} />
                    Italic
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("underline") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                  >
                    <Underline className="size-4 shrink-0" strokeWidth={1.5} />
                    Underline
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("strike") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                  >
                    <Strikethrough className="size-4 shrink-0" strokeWidth={1.5} />
                    Strikethrough
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("code") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleCode().run()}
                  >
                    <Code className="size-4 shrink-0" strokeWidth={1.5} />
                    Inline code
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("subscript") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleSubscript().run()}
                  >
                    <Subscript className="size-4 shrink-0" strokeWidth={1.5} />
                    Subscript
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("superscript") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleSuperscript().run()}
                  >
                    <Superscript className="size-4 shrink-0" strokeWidth={1.5} />
                    Superscript
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    onClick={() => {
                      // The toolbar's polished LinkButton is a Popover — it
                      // can't be nested inside DropdownMenuItem without
                      // fighting Radix focus management. Fall back to a
                      // native prompt for the overflow path; selection-based
                      // link insertion still goes through the BubbleMenu.
                      const current = editor.getAttributes("link").href ?? "";
                      const href = window.prompt("Link URL", current);
                      if (href === null) return;
                      const trimmed = href.trim();
                      if (trimmed === "") {
                        editor.chain().focus().unsetLink().run();
                        return;
                      }
                      editor.chain().focus().setLink({ href: trimmed }).run();
                    }}
                  >
                    <LinkIcon className="size-4 shrink-0" strokeWidth={1.5} />
                    Link
                  </DropdownMenuItem>

                  {/* Lists + indent / outdent — also missing entirely
                      before parity restoration. */}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("bulletList") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                  >
                    <List className="size-4 shrink-0" strokeWidth={1.5} />
                    Bullet list
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("orderedList") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  >
                    <ListOrdered className="size-4 shrink-0" strokeWidth={1.5} />
                    Numbered list
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!isInList}
                    className="cursor-pointer gap-2 text-xs"
                    onClick={() => {
                      if (editor.isActive("taskList")) {
                        editor.chain().focus().sinkListItem("taskItem").run();
                      } else {
                        editor.chain().focus().sinkListItem("listItem").run();
                      }
                    }}
                  >
                    <IndentIncrease className="size-4 shrink-0" strokeWidth={1.5} />
                    Indent
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!isInList}
                    className="cursor-pointer gap-2 text-xs"
                    onClick={() => {
                      if (editor.isActive("taskList")) {
                        editor.chain().focus().liftListItem("taskItem").run();
                      } else {
                        editor.chain().focus().liftListItem("listItem").run();
                      }
                    }}
                  >
                    <IndentDecrease className="size-4 shrink-0" strokeWidth={1.5} />
                    Outdent
                  </DropdownMenuItem>

                  {/* Alignment */}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive({ textAlign: "left" }) && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().setTextAlign("left").run()}
                  >
                    <AlignLeft className="size-4 shrink-0" strokeWidth={1.5} />
                    Align left
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive({ textAlign: "center" }) && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().setTextAlign("center").run()}
                  >
                    <AlignCenter className="size-4 shrink-0" strokeWidth={1.5} />
                    Align center
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive({ textAlign: "right" }) && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().setTextAlign("right").run()}
                  >
                    <AlignRight className="size-4 shrink-0" strokeWidth={1.5} />
                    Align right
                  </DropdownMenuItem>

                  {/* Inserts */}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    onClick={() => onImageInsert?.()}
                  >
                    <ImageIcon className="size-4 shrink-0" strokeWidth={1.5} />
                    Image
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    onClick={() => editor.chain().focus().insertDrawing().run()}
                  >
                    <Pencil className="size-4 shrink-0" strokeWidth={1.5} />
                    Drawing
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    onClick={() => editor.chain().focus().insertChart().run()}
                  >
                    <BarChart3 className="size-4 shrink-0" strokeWidth={1.5} />
                    Chart
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer gap-2 text-xs",
                      editor.isActive("codeBlock") && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                    )}
                    onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                  >
                    <CodeSquare className="size-4 shrink-0" strokeWidth={1.5} />
                    Code block
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    onClick={() => editor.chain().focus().setHorizontalRule().run()}
                  >
                    <Minus className="size-4 shrink-0" strokeWidth={1.5} />
                    Horizontal rule
                  </DropdownMenuItem>

                  {/* Table editing — only enabled when cursor is inside a table */}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    disabled={!editor.isActive("table")}
                    onClick={() => editor.chain().focus().addRowBefore().run()}
                  >
                    <BetweenHorizontalStart className="size-4 shrink-0" strokeWidth={1.5} />
                    Add row above
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    disabled={!editor.isActive("table")}
                    onClick={() => editor.chain().focus().addRowAfter().run()}
                  >
                    <BetweenHorizontalEnd className="size-4 shrink-0" strokeWidth={1.5} />
                    Add row below
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    disabled={!editor.isActive("table")}
                    onClick={() => editor.chain().focus().addColumnBefore().run()}
                  >
                    <BetweenVerticalStart className="size-4 shrink-0" strokeWidth={1.5} />
                    Add column left
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    disabled={!editor.isActive("table")}
                    onClick={() => editor.chain().focus().addColumnAfter().run()}
                  >
                    <BetweenVerticalEnd className="size-4 shrink-0" strokeWidth={1.5} />
                    Add column right
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    disabled={!editor.isActive("table")}
                    onClick={() => editor.chain().focus().toggleHeaderRow().run()}
                  >
                    <TableProperties className="size-4 shrink-0" strokeWidth={1.5} />
                    Toggle header row
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    disabled={!editor.isActive("table") || !editor.can().mergeCells()}
                    onClick={() => editor.chain().focus().mergeCells().run()}
                  >
                    <TableCellsMerge className="size-4 shrink-0" strokeWidth={1.5} />
                    Merge cells
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    disabled={!editor.isActive("table") || !editor.can().splitCell()}
                    onClick={() => editor.chain().focus().splitCell().run()}
                  >
                    <TableCellsSplit className="size-4 shrink-0" strokeWidth={1.5} />
                    Split cell
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs text-destructive"
                    disabled={!editor.isActive("table")}
                    onClick={() => editor.chain().focus().deleteRow().run()}
                  >
                    <TableRowsSplit className="size-4 shrink-0" strokeWidth={1.5} />
                    Delete row
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs text-destructive"
                    disabled={!editor.isActive("table")}
                    onClick={() => editor.chain().focus().deleteColumn().run()}
                  >
                    <TableColumnsSplit className="size-4 shrink-0" strokeWidth={1.5} />
                    Delete column
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs text-destructive"
                    disabled={!editor.isActive("table")}
                    onClick={() => editor.chain().focus().deleteTable().run()}
                  >
                    <Trash2 className="size-4 shrink-0" strokeWidth={1.5} />
                    Delete table
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div
      className={wrapperClassName}
    >
      {!isSource && editor && (
        <>
          {/* Heading Level Picker */}
          <HeadingPicker editor={editor} />

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo (Cmd+Z)"
          >
            <Undo className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold (Cmd+B)"
          >
            <Bold className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic (Cmd+I)"
          >
            <Italic className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            title="Underline (Cmd+U)"
          >
            <Underline className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title="Strikethrough (Cmd+Shift+X)"
          >
            <Strikethrough className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive("code")}
            title="Code (Cmd+E)"
          >
            <Code className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            active={editor.isActive("subscript")}
            title="Subscript"
          >
            <Subscript className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            active={editor.isActive("superscript")}
            title="Superscript"
          >
            <Superscript className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <LinkButton editor={editor} />

          {/* Text Color & Highlight */}
          <TextColorPopover editor={editor} />
          <HighlightPopover editor={editor} />

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bullet List"
          >
            <List className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Numbered List"
          >
            <ListOrdered className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            active={editor.isActive("taskList")}
            title="Task List"
          >
            <ListChecks className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          {/* Indent / Outdent */}
          <ToolbarButton
            onClick={() => {
              if (editor.isActive("taskList")) {
                editor.chain().focus().sinkListItem("taskItem").run();
              } else {
                editor.chain().focus().sinkListItem("listItem").run();
              }
            }}
            disabled={!isInList}
            title="Indent (Tab)"
          >
            <IndentIncrease className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => {
              if (editor.isActive("taskList")) {
                editor.chain().focus().liftListItem("taskItem").run();
              } else {
                editor.chain().focus().liftListItem("listItem").run();
              }
            }}
            disabled={!isInList}
            title="Outdent (Shift+Tab)"
          >
            <IndentDecrease className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            title="Blockquote"
          >
            <Quote className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <CalloutPicker editor={editor} />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive("codeBlock")}
            title="Code Block"
          >
            <CodeSquare className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Rule"
          >
            <Minus className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          {/* Alignment */}
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            active={editor.isActive({ textAlign: "left" })}
            title="Align left"
          >
            <AlignLeft className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            active={editor.isActive({ textAlign: "center" })}
            title="Align center"
          >
            <AlignCenter className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            active={editor.isActive({ textAlign: "right" })}
            title="Align right"
          >
            <AlignRight className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          <TableGridPicker editor={editor} />

          {/* Table editing tools — only visible when cursor is inside a table */}
          {editor.isActive("table") && (
            // #86 reduced-motion sweep: disable entrance fade entirely under
            // reduce — `motion-reduce:` maps to `prefers-reduced-motion: reduce`.
            <div className="animate-in fade-in duration-150 motion-reduce:!animate-none motion-reduce:!duration-0">
              <TableToolsPopover editor={editor} />
            </div>
          )}

          <ToolbarButton
            onClick={() => onImageInsert?.()}
            title="Insert Image"
          >
            <ImageIcon className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().insertDrawing().run()}
            title="Insert Drawing"
          >
            <Pencil className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().insertChart().run()}
            title="Insert Chart"
          >
            <BarChart3 className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          <TypographyPopover editor={editor} />

          <ToolbarSeparator />

          <MicButton editor={editor} />
        </>
      )}
      {isSource && onToggleWordWrap && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onToggleWordWrap}
              className={cn(
                sourceWordWrap
                  ? "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
                  : "text-muted-foreground"
              )}
            >
              <WrapText className="size-4" strokeWidth={1.5} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Word Wrap (Alt+Z)
          </TooltipContent>
        </Tooltip>
      )}

      {/* Spacer pushes toggle to the right */}
      <span className="flex-1" />

      {/* View mode toggle */}
      {onToggleViewMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onToggleViewMode}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                isSource && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
              )}
            >
              {isSource ? (
                <FileText className="size-4" strokeWidth={1.5} />
              ) : (
                <FileCode className="size-4" strokeWidth={1.5} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {isSource ? "Switch to Rich text (Cmd+Shift+/)" : "Switch to Raw (Cmd+Shift+/)"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
    </TooltipProvider>
  );
}
