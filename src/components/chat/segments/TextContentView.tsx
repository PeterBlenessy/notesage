import { memo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface TextContentViewProps {
  text: string;
}

function summarize(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'No output';
  const lines = trimmed.split('\n').length;
  if (lines > 1) return `Output (${lines} lines)`;
  if (trimmed.length > 100) return `Output (${Math.ceil(trimmed.length / 1024)}KB)`;
  return trimmed;
}

export const TextContentView = memo(function TextContentView({ text }: TextContentViewProps) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors duration-150 cursor-pointer"
      >
        <ChevronRight
          size={10}
          strokeWidth={1.5}
          className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <span>{summarize(text)}</span>
      </button>
      {expanded && (
        <div className="overflow-auto max-h-[360px] rounded-md bg-muted/50 border border-border/50 p-2 mt-0.5">
          <pre className="text-[10px] font-mono whitespace-pre-wrap break-all text-muted-foreground">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
});
