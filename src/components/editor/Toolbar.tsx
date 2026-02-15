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
import { cn } from "@/lib/utils";

interface ToolbarProps {
  editor: Editor | null;
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
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "h-7 w-7 inline-flex items-center justify-center rounded-md transition-all duration-150",
        "disabled:opacity-30 disabled:pointer-events-none",
        active
          ? "text-foreground"
          : "text-muted-foreground"
      )}
      style={{
        backgroundColor: active ? 'var(--color-accent)' : undefined,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'var(--color-accent)';
          e.currentTarget.style.color = 'var(--color-foreground)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = '';
          e.currentTarget.style.color = '';
        }
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.9)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = '';
      }}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <div className="w-px h-4 bg-border/60 mx-0.5" />;
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
    <div
      className="h-9 border-b border-border px-2 flex items-center gap-0.5 overflow-x-auto overflow-y-hidden shrink-0"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Cmd+Z)"
      >
        <Undo className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Cmd+Shift+Z)"
      >
        <Redo className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold (Cmd+B)"
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic (Cmd+I)"
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline (Cmd+U)"
      >
        <Underline className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough (Cmd+Shift+X)"
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Code (Cmd+E)"
      >
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet List"
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered List"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={editor.isActive("taskList")}
        title="Task List"
      >
        <ListChecks className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <Quote className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code Block"
      >
        <CodeSquare className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal Rule"
      >
        <Minus className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        onClick={insertTable}
        active={editor.isActive("table")}
        title="Insert Table"
      >
        <Table className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={addImage}
        title="Insert Image"
      >
        <ImageIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}
