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
  Eye,
  Subscript,
  Superscript,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  onToggleHtmlPreview?: () => void;
  sourceWordWrap?: boolean;
  onToggleWordWrap?: () => void;
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
              ? "bg-accent text-foreground"
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

export function Toolbar({ editor, onImageInsert, viewMode = "wysiwyg", onToggleViewMode, onToggleHtmlPreview, sourceWordWrap, onToggleWordWrap }: ToolbarProps) {
  const isSource = viewMode === "source";
  const isPreview = viewMode === "html-preview";

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

  return (
    <TooltipProvider delayDuration={300}>
    <div
      className="h-9 px-2 flex items-center gap-0.5 overflow-x-auto overflow-y-hidden flex-1 min-w-0"
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
            <div className="animate-in fade-in duration-150">
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
                  ? "bg-accent text-foreground"
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

      {/* HTML preview toggle */}
      {onToggleHtmlPreview && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onToggleHtmlPreview}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                isPreview && "bg-accent text-foreground"
              )}
            >
              <Eye className="size-4" strokeWidth={1.5} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {isPreview ? "Exit Preview (Cmd+Shift+P)" : "Preview as HTML (Cmd+Shift+P)"}
          </TooltipContent>
        </Tooltip>
      )}

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
                isSource && "bg-accent text-foreground"
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
