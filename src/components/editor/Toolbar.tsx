import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import { cn } from "@/lib/utils";

interface ToolbarProps {
  editor: Editor | null;
}

export function Toolbar({ editor }: ToolbarProps) {
  if (!editor) {
    return null;
  }

  const addImage = () => {
    const url = window.prompt("Image URL");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  const insertTable = () => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  return (
    <div className="h-10 border-b border-border px-2 flex items-center gap-1 overflow-x-auto overflow-y-hidden shrink-0" style={{ backgroundColor: 'var(--color-background)' }}>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        className="h-8 w-8 p-0"
        title="Undo (Cmd+Z)"
      >
        <Undo className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        className="h-8 w-8 p-0"
        title="Redo (Cmd+Shift+Z)"
      >
        <Redo className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("bold") && "bg-accent"
        )}
        title="Bold (Cmd+B)"
      >
        <Bold className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("italic") && "bg-accent"
        )}
        title="Italic (Cmd+I)"
      >
        <Italic className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("underline") && "bg-accent"
        )}
        title="Underline (Cmd+U)"
      >
        <Underline className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("strike") && "bg-accent"
        )}
        title="Strikethrough (Cmd+Shift+X)"
      >
        <Strikethrough className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("code") && "bg-accent"
        )}
        title="Code (Cmd+E)"
      >
        <Code className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("bulletList") && "bg-accent"
        )}
        title="Bullet List"
      >
        <List className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("orderedList") && "bg-accent"
        )}
        title="Numbered List"
      >
        <ListOrdered className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("taskList") && "bg-accent"
        )}
        title="Task List"
      >
        <ListChecks className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("blockquote") && "bg-accent"
        )}
        title="Blockquote"
      >
        <Quote className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("codeBlock") && "bg-accent"
        )}
        title="Code Block"
      >
        <CodeSquare className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className="h-8 w-8 p-0"
        title="Horizontal Rule"
      >
        <Minus className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button
        size="sm"
        variant="ghost"
        onClick={insertTable}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("table") && "bg-accent"
        )}
        title="Insert Table"
      >
        <Table className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={addImage}
        className="h-8 w-8 p-0"
        title="Insert Image"
      >
        <ImageIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
