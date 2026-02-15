import type { Editor } from "@tiptap/core";
import { Separator } from "@/components/ui/separator";

interface StatusBarProps {
  editor: Editor | null;
}

export function StatusBar({ editor }: StatusBarProps) {
  if (!editor) {
    return null;
  }

  const text = editor.getText();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, "").length;

  // Average reading speed: 200 words per minute
  const readingTimeMinutes = Math.ceil(words / 200);

  return (
    <div className="h-7 border-t border-border px-4 flex items-center gap-4 text-xs text-muted-foreground shrink-0 overflow-x-auto overflow-y-hidden whitespace-nowrap" style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="flex items-center gap-1">
        <span className="font-medium">{words}</span>
        <span>{words === 1 ? "word" : "words"}</span>
      </div>

      <Separator orientation="vertical" className="h-3" />

      <div className="flex items-center gap-1">
        <span className="font-medium">{characters}</span>
        <span>{characters === 1 ? "character" : "characters"}</span>
      </div>

      <Separator orientation="vertical" className="h-3" />

      <div className="flex items-center gap-1">
        <span className="font-medium">{charactersNoSpaces}</span>
        <span>characters (no spaces)</span>
      </div>

      <Separator orientation="vertical" className="h-3" />

      <div className="flex items-center gap-1">
        <span className="font-medium">{readingTimeMinutes}</span>
        <span>{readingTimeMinutes === 1 ? "min" : "mins"} read</span>
      </div>
    </div>
  );
}
