import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  MessageCircle,
  Loader2,
  Check,
  X,
  Slash,
  ChevronDown,
  ChevronRight,
  Square,
  Info,
  AlertCircle,
  BotMessageSquare,
  Brain,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownContent } from '@/components/MarkdownContent';
import type { AgentTask } from '@/stores/activity-store';

function formatElapsed(startedAt: number, completedAt?: number): string {
  const end = completedAt ?? Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

interface ActivityTaskCardProps {
  task: AgentTask;
  onCancel?: (taskId: string) => void;
  onRemove?: (taskId: string) => void;
  onClick?: (task: AgentTask) => void;
}

export function ActivityTaskCard({ task, onCancel, onRemove, onClick }: ActivityTaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);

  // Live elapsed time counter — tick every second while running
  useEffect(() => {
    if (task.status === 'running') {
      intervalRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [task.status]);

  // Auto-scroll streaming output
  useEffect(() => {
    if (task.partialOutput && streamingRef.current) {
      streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
    }
  }, [task.partialOutput]);

  // Auto-scroll thinking output
  useEffect(() => {
    if (task.thinkingOutput && thinkingExpanded && thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [task.thinkingOutput, thinkingExpanded]);

  const isClickable = task.status !== 'running' && onClick;
  const TypeIcon = task.type === 'comment' ? MessageSquare : MessageCircle;

  const hasOutput = task.partialOutput || task.finalOutput;
  const outputText = task.finalOutput ?? task.partialOutput ?? '';
  const isStreaming = task.status === 'running' && !!task.partialOutput;

  return (
    <div
      className={`group/card px-3 py-2.5 space-y-1 min-w-0 overflow-hidden transition-colors duration-150 ${
        isClickable ? 'cursor-pointer hover:bg-muted/50' : ''
      }`}
      onClick={isClickable ? () => onClick(task) : undefined}
    >
      {/* Top row: status icon + label + elapsed time + remove */}
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          {task.status === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : task.status === 'done' ? (
            <Check className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          ) : task.status === 'error' ? (
            <X className="h-3.5 w-3.5 text-destructive" strokeWidth={1.5} />
          ) : (
            <Slash className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate" title={task.label}>
            {task.label}
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {formatElapsed(task.startedAt, task.completedAt)}
        </span>
        {task.status !== 'running' && onRemove && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(task.id); }}
            className="shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
            title="Remove task"
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Source file */}
      {task.sourceFile && (
        <div className="flex items-center gap-2 pl-5.5">
          <TypeIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" strokeWidth={1.5} />
          <span className="text-xs text-muted-foreground truncate">
            {basename(task.sourceFile)}
          </span>
        </div>
      )}

      {/* Thinking / reasoning */}
      {task.thinkingOutput && (
        <div className="pl-5.5 min-w-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setThinkingExpanded(!thinkingExpanded); }}
            className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground active:opacity-75 transition-colors"
          >
            <Brain className="h-3 w-3" strokeWidth={1.5} />
            {thinkingExpanded ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            <span>
              {task.status === 'running' ? 'Thinking...' : 'Thinking'}
            </span>
          </button>
          {thinkingExpanded && (
            <div
              ref={thinkingRef}
              className="mt-1 max-h-60 overflow-y-auto overflow-x-hidden thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5 italic"
            >
              <MarkdownContent content={task.thinkingOutput!} className="text-xs text-muted-foreground/80" />
              {task.status === 'running' && (
                <span className="streaming-cursor">▊</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Agent output — streaming or final */}
      {hasOutput && (
        <div className="pl-5.5 min-w-0">
          {isStreaming ? (
            /* Live streaming preview */
            <div className="mt-1">
              <div className="flex items-center gap-1.5 mb-1">
                <BotMessageSquare className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                <span className="text-[10px] text-muted-foreground">responding...</span>
              </div>
              <div
                ref={streamingRef}
                className="max-h-60 overflow-y-auto overflow-x-hidden thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5"
              >
                <MarkdownContent content={outputText} className="text-xs text-foreground/80" />
                <span className="streaming-cursor">▊</span>
              </div>
            </div>
          ) : task.finalOutput ? (
            /* Completed output — collapsible */
            <div className="mt-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOutputExpanded(!outputExpanded); }}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground active:opacity-75 transition-colors"
              >
                <BotMessageSquare className="h-3 w-3" strokeWidth={1.5} />
                {outputExpanded ? (
                  <ChevronDown className="h-2.5 w-2.5" />
                ) : (
                  <ChevronRight className="h-2.5 w-2.5" />
                )}
                <span>Agent response</span>
              </button>
              {outputExpanded && (
                <div className="mt-1 max-h-80 overflow-y-auto overflow-x-hidden thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5">
                  <MarkdownContent content={task.finalOutput!} className="text-xs text-foreground/80" />
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Activity log toggle + stop button */}
      <div className="flex items-center justify-between pl-5.5">
        {task.activities.length > 0 ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground active:opacity-75 transition-colors"
          >
            {expanded ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            <span>
              {task.activities.length} step{task.activities.length !== 1 ? 's' : ''}
              {task.status !== 'running' ? ' completed' : ''}
            </span>
          </button>
        ) : (
          <span />
        )}
        {task.status === 'running' && onCancel && (
          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}
            className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Square className="h-2.5 w-2.5 mr-0.5" strokeWidth={1.5} />
            Stop
          </Button>
        )}
      </div>

      {/* Expanded activity log */}
      {expanded && task.activities.length > 0 && (
        <div className="pl-5.5 space-y-0.5 max-h-60 overflow-y-auto thin-scrollbar">
          {task.activities.map((a, i) => (
            <div
              key={`${a.timestamp}-${i}`}
              className={`flex items-start gap-1.5 text-[10px] ${
                a.status === 'error' ? 'text-destructive/70' : 'text-muted-foreground/70'
              }`}
            >
              {a.status === 'running' ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0 mt-px" />
              ) : a.status === 'error' ? (
                <AlertCircle className="h-2.5 w-2.5 shrink-0 mt-px" />
              ) : a.status === 'info' ? (
                <Info className="h-2.5 w-2.5 shrink-0 mt-px" />
              ) : (
                <Check className="h-2.5 w-2.5 shrink-0 mt-px" />
              )}
              <div className="min-w-0">
                <span className="truncate block">{a.label}</span>
                {a.detail && (
                  <span
                    className="truncate block text-muted-foreground/50"
                    title={a.detail}
                  >
                    {a.detail.length > 60 ? a.detail.slice(0, 60) + '\u2026' : a.detail}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
