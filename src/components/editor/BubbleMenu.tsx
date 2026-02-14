import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { useAIStore } from "@/stores/ai-store";
import { useAIOperations } from "@/hooks/useAIOperations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface BubbleMenuProps {
  editor: Editor;
}

export function BubbleMenu({ editor }: BubbleMenuProps) {
  const [isAILoading, setIsAILoading] = useState(false);
  const { provider } = useAIStore();
  const { generateText } = useAIOperations();

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);

    if (url === null) {
      return;
    }

    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const handleAIAction = async (action: 'improve' | 'summarize' | 'expand') => {
    if (!provider) {
      alert('Please configure an AI provider in Settings first.');
      return;
    }

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, '\n');

    if (!selectedText.trim()) {
      return;
    }

    setIsAILoading(true);

    try {
      let prompt = '';
      switch (action) {
        case 'improve':
          prompt = `Improve the following text while keeping the same meaning and tone:\n\n${selectedText}\n\nProvide only the improved text without any explanation.`;
          break;
        case 'summarize':
          prompt = `Summarize the following text concisely:\n\n${selectedText}\n\nProvide only the summary without any explanation.`;
          break;
        case 'expand':
          prompt = `Expand on the following text with more detail:\n\n${selectedText}\n\nProvide only the expanded text without any explanation.`;
          break;
      }

      const result = await generateText(prompt);

      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent(result.trim())
        .run();
    } catch (error) {
      console.error('AI action failed:', error);
      alert(`AI ${action} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAILoading(false);
    }
  };

  return (
    <TiptapBubbleMenu
      editor={editor}
      className="flex items-center gap-1 rounded-lg border border-border bg-background/95 backdrop-blur-md p-1.5 shadow-xl ring-1 ring-border/50"
    >
      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn(
          "h-8 w-8 p-0 hover:bg-accent hover:text-accent-foreground",
          editor.isActive("bold") && "bg-accent text-accent-foreground"
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

      <Separator orientation="vertical" className="h-6" />

      <Button
        size="sm"
        variant="ghost"
        onClick={setLink}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive("link") && "bg-accent"
        )}
        title="Link (Cmd+K)"
      >
        <Link className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-6" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-sm font-medium"
          >
            {editor.isActive("heading", { level: 1 })
              ? "H1"
              : editor.isActive("heading", { level: 2 })
              ? "H2"
              : editor.isActive("heading", { level: 3 })
              ? "H3"
              : "¶"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
          >
            Heading 1
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            Heading 2
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            Heading 3
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => editor.chain().focus().setParagraph().run()}
          >
            Paragraph
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-6" />

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive({ textAlign: "left" }) && "bg-accent"
        )}
        title="Align Left"
      >
        <AlignLeft className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive({ textAlign: "center" }) && "bg-accent"
        )}
        title="Align Center"
      >
        <AlignCenter className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        className={cn(
          "h-8 w-8 p-0",
          editor.isActive({ textAlign: "right" }) && "bg-accent"
        )}
        title="Align Right"
      >
        <AlignRight className="h-4 w-4" />
      </Button>

      {provider && (
        <>
          <Separator orientation="vertical" className="h-6" />

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAIAction('improve')}
            disabled={isAILoading}
            className="h-8 px-2 text-sm"
            title="Improve with AI"
          >
            {isAILoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                Improve
              </>
            )}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAIAction('summarize')}
            disabled={isAILoading}
            className="h-8 px-2 text-sm"
            title="Summarize with AI"
          >
            Summarize
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAIAction('expand')}
            disabled={isAILoading}
            className="h-8 px-2 text-sm"
            title="Expand with AI"
          >
            Expand
          </Button>
        </>
      )}
    </TiptapBubbleMenu>
  );
}
