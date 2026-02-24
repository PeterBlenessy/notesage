interface PlainTextViewerProps {
  content: string;
  fileName: string;
}

export function PlainTextViewer({ content, fileName }: PlainTextViewerProps) {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-[720px] mx-auto py-10 px-8">
        <div className="text-xs text-muted-foreground mb-4 font-mono">{fileName}</div>
        <pre className="text-sm font-mono whitespace-pre-wrap break-words text-foreground leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
}
