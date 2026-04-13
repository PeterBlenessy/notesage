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
      className="my-0.5 flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground bg-background/50"
      title={typeof segment.detail === 'string' ? segment.detail : (segment.detail ? JSON.stringify(segment.detail, null, 2) : undefined)}
    >
      <span className="shrink-0 opacity-60">{getToolIcon(segment.kind)}</span>
      <span className="truncate">{segment.label}</span>
      <span className="shrink-0 opacity-60"><StatusIcon status={segment.status} /></span>
    </div>
  );
});
