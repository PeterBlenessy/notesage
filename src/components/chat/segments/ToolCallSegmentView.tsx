import { memo } from 'react';
import {
  FileText,
  Pencil,
  Terminal,
  Search,
  Globe,
  FolderSearch,
  Wrench,
  BookOpen,
  Loader2,
  Check,
  X,
} from 'lucide-react';
import type { ToolCallSegment } from '@/lib/ai/types';
import { DiffContentView } from './DiffContentView';
import { TextContentView } from './TextContentView';

interface ToolCallSegmentViewProps {
  segment: ToolCallSegment;
}

const ICON_SIZE = 14;
const ICON_STROKE = 1.5;

function getToolIcon(kind: string) {
  switch (kind.toLowerCase()) {
    case 'read':
    case 'read_file':
      return <FileText size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case 'write':
    case 'write_file':
    case 'edit':
      return <Pencil size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case 'bash':
    case 'terminal':
      return <Terminal size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case 'grep':
      return <Search size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case 'web_search':
    case 'websearch':
    case 'fetch':
    case 'webfetch':
    case 'web_fetch':
      return <Globe size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case 'glob':
    case 'list':
    case 'list_directory':
    case 'toolsearch':
    case 'tool_search':
      return <FolderSearch size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case 'execute_skill_script':
      return <Terminal size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    case 'read_skill_content':
      return <BookOpen size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
    default:
      return <Wrench size={ICON_SIZE} strokeWidth={ICON_STROKE} />;
  }
}

function StatusIcon({ status }: { status: ToolCallSegment['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="animate-spin text-muted-foreground" />;
    case 'done':
      return <Check size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-muted-foreground" />;
    case 'error':
      return <X size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-destructive" />;
  }
}

export const ToolCallSegmentView = memo(function ToolCallSegmentView({ segment }: ToolCallSegmentViewProps) {
  return (
    <div
      className="my-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground bg-background/50"
      title={typeof segment.detail === 'string' ? segment.detail : (segment.detail ? JSON.stringify(segment.detail, null, 2) : undefined)}
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 opacity-60">{getToolIcon(segment.kind)}</span>
        <span className="truncate">{segment.label}</span>
        <span className="shrink-0 opacity-60"><StatusIcon status={segment.status} /></span>
      </div>
      {segment.locations && segment.locations.length > 0 && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {segment.locations.map((loc, i) => {
            const fileName = loc.path.split('/').pop() || loc.path;
            const display = loc.line ? `${fileName}:${loc.line}` : fileName;
            return (
              <button
                key={i}
                className="block text-[10px] text-muted-foreground/60 hover:text-foreground hover:underline underline-offset-2 transition-colors truncate max-w-full cursor-pointer"
                title={loc.path}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const { useEditorStore } = await import('@/stores/editor-store');
                    const content = await invoke<string>('read_file', { path: loc.path });
                    const name = loc.path.split('/').pop() || loc.path;
                    useEditorStore.getState().openTab(loc.path, name, content);
                  } catch (err) {
                    console.warn('Failed to open file:', loc.path, err);
                  }
                }}
              >
                {display}
              </button>
            );
          })}
        </div>
      )}
      {segment.content && segment.content.length > 0 && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {segment.content.map((item, i) => {
            if (item.type === 'diff') {
              return (
                <DiffContentView
                  key={`diff-${i}`}
                  path={item.path}
                  oldText={item.oldText}
                  newText={item.newText}
                />
              );
            }
            if (item.type === 'text') {
              return <TextContentView key={`text-${i}`} text={item.text} />;
            }
            // Terminal variant: we don't own the terminal, render a muted placeholder
            // so users see *something* was emitted rather than silently dropping it.
            return (
              <div
                key={`terminal-${i}`}
                className="px-1 text-[11px] text-muted-foreground/50 italic"
              >
                Terminal output (not yet supported)
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
