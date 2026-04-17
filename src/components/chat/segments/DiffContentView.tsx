import { memo, useMemo, useState } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { computeUnifiedDiff, type DiffLine } from '@/lib/ai/diff-utils';

interface DiffContentViewProps {
  path: string;
  oldText?: string;
  newText: string;
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

async function openPath(path: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { useEditorStore } = await import('@/stores/editor-store');
    const content = await invoke<string>('read_file', { path });
    useEditorStore.getState().openTab(path, basename(path), content);
  } catch (err) {
    console.warn('Failed to open file:', path, err);
  }
}

function renderLine(line: DiffLine, idx: number) {
  if (line.type === 'separator') {
    return (
      <div
        key={`sep-${idx}`}
        className="px-1.5 text-[10px] font-mono text-muted-foreground/50 select-none"
      >
        {line.text}
      </div>
    );
  }
  const prefix = line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  ';
  const bg =
    line.type === 'add'
      ? 'bg-[var(--color-diff-insert-bg)]'
      : line.type === 'remove'
      ? 'bg-[var(--color-diff-delete-bg)]'
      : '';
  return (
    <div
      key={idx}
      className={`px-1.5 text-[10px] font-mono whitespace-pre-wrap break-all ${bg}`}
    >
      <span className="opacity-60 select-none">{prefix}</span>
      {line.text || '\u00a0'}
    </div>
  );
}

export const DiffContentView = memo(function DiffContentView({
  path,
  oldText,
  newText,
}: DiffContentViewProps) {
  const [expanded, setExpanded] = useState(false);

  const diff = useMemo(() => computeUnifiedDiff(oldText, newText), [oldText, newText]);

  const name = basename(path) || path || 'file';
  const { additions, deletions, isNewFile, isDeletion, lines } = diff;

  // Summary: "N additions, M deletions in filename.ext"
  const summary = (() => {
    if (isNewFile) {
      return `${additions} line${additions === 1 ? '' : 's'} added in ${name}`;
    }
    if (isDeletion) {
      return `${deletions} line${deletions === 1 ? '' : 's'} removed in ${name}`;
    }
    const parts: string[] = [];
    if (additions > 0) parts.push(`${additions} addition${additions === 1 ? '' : 's'}`);
    if (deletions > 0) parts.push(`${deletions} deletion${deletions === 1 ? '' : 's'}`);
    if (parts.length === 0) parts.push('no changes');
    return `${parts.join(', ')} in ${name}`;
  })();

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
        <FileText size={10} strokeWidth={1.5} className="opacity-60" />
        <span className="truncate">{summary}</span>
        {isNewFile && (
          <span className="shrink-0 text-[9px] uppercase tracking-wider opacity-60">
            new file
          </span>
        )}
        {isDeletion && (
          <span className="shrink-0 text-[9px] uppercase tracking-wider opacity-60">
            deleted
          </span>
        )}
      </button>
      {expanded && (
        <div className="overflow-auto max-h-[360px] rounded-md bg-muted/50 border border-border/50 mt-0.5">
          <button
            type="button"
            className="block w-full text-left px-1.5 py-1 border-b border-border/50 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:underline underline-offset-2 cursor-pointer truncate"
            title={path}
            onClick={(e) => {
              e.stopPropagation();
              openPath(path);
            }}
          >
            {path}
          </button>
          <div className="py-1">
            {lines.length === 0 ? (
              <div className="px-1.5 text-[10px] font-mono text-muted-foreground/60">
                No changes
              </div>
            ) : (
              lines.map((line, idx) => renderLine(line, idx))
            )}
          </div>
        </div>
      )}
    </div>
  );
});
