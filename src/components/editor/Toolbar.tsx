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
  Table,
  Image as ImageIcon,
  Undo,
  Redo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  editor: Editor | null;
  onImageInsert?: () => void;
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
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "disabled:opacity-30 active:scale-90",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground"
      )}
    >
      {children}
    </Button>
  );
}

function ToolbarSeparator() {
  return <Separator orientation="vertical" className="h-4 mx-0.5" />;
}

export function Toolbar({ editor, onImageInsert }: ToolbarProps) {
  if (!editor) {
    return null;
  }

  const insertTable = () => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  return (
    <div
      className="h-9 px-2 flex items-center gap-0.5 overflow-x-auto overflow-y-hidden flex-1 min-w-0"
    >
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Cmd+Z)"
      >
        <Undo className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Cmd+Shift+Z)"
      >
        <Redo className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold (Cmd+B)"
      >
        <Bold className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic (Cmd+I)"
      >
        <Italic className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline (Cmd+U)"
      >
        <Underline className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough (Cmd+Shift+X)"
      >
        <Strikethrough className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Code (Cmd+E)"
      >
        <Code className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet List"
      >
        <List className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered List"
      >
        <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={editor.isActive("taskList")}
        title="Task List"
      >
        <ListChecks className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <Quote className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code Block"
      >
        <CodeSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal Rule"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        onClick={insertTable}
        active={editor.isActive("table")}
        title="Insert Table"
      >
        <Table className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => onImageInsert?.()}
        title="Insert Image"
      >
        <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToolbarButton>
    </div>
  );
}
