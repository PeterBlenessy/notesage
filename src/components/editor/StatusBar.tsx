import type { Editor } from "@tiptap/core";

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

  // Average reading speed: 200 words per minute
  const readingTimeMinutes = Math.ceil(words / 200);

  return (
    <div
      className="h-6 border-t border-border px-3 flex items-center gap-3 text-[11px] text-muted-foreground shrink-0 overflow-x-auto overflow-y-hidden whitespace-nowrap"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <span>{words} {words === 1 ? "word" : "words"}</span>
      <span className="w-px h-2.5 bg-border/60" />
      <span>{characters} {characters === 1 ? "char" : "chars"}</span>
      <span className="w-px h-2.5 bg-border/60" />
      <span>{readingTimeMinutes} min read</span>
    </div>
  );
}
