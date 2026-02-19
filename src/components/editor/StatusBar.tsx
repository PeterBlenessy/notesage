import type { Editor } from "@tiptap/core";

interface StatusBarProps {
  editor: Editor | null;
  maxWidth?: number;
  renderedWidth?: number | null;
}

export function StatusBar({ editor, maxWidth, renderedWidth }: StatusBarProps) {
  if (!editor) {
    return null;
  }

  const text = editor.getText();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const characters = text.length;

  // Average reading speed: 200 words per minute
  const readingTimeMinutes = Math.ceil(words / 200);

  // Calculate scale percentage for paper-size modes
  const scalePercent = maxWidth && renderedWidth
    ? Math.round((renderedWidth / maxWidth) * 100)
    : null;

  return (
    <div
      className="h-6 border-t border-border px-3 flex items-center gap-3 text-[11px] shrink-0 overflow-x-auto overflow-y-hidden whitespace-nowrap bg-background text-muted-foreground"
    >
      <span>{words} {words === 1 ? "word" : "words"}</span>
      <span className="w-px h-2.5 bg-border" />
      <span>{characters} {characters === 1 ? "char" : "chars"}</span>
      <span className="w-px h-2.5 bg-border" />
      <span>{readingTimeMinutes} min read</span>
      {scalePercent !== null && (
        <>
          <span className="ml-auto" />
          <span>{scalePercent}%</span>
        </>
      )}
    </div>
  );
}
