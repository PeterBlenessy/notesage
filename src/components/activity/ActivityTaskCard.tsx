import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
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
  User,
  ScrollText,
  Mic,
  FolderInput,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownContent } from '@/components/MarkdownContent';
import { ProviderLogo } from '@/components/ProviderLogo';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DiffContentView } from '@/components/chat/segments/DiffContentView';
import { TextContentView } from '@/components/chat/segments/TextContentView';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRoutingStore } from '@/stores/routing-store';
import { useCommentStore } from '@/stores/comment-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useActivityStore } from '@/stores/activity-store';
import type { AgentTask } from '@/stores/activity-store';
import type { ActivityApprovalMode } from '@/lib/ai/types';
import { dirname, basename as pathBasename, moveBundleToProject, transcriptPathForAudio } from '@/lib/transcription/bundle';

/**
 * Small badge next to each activity row signalling *how* the tool call was
 * authorized. Strictly neutral palette: muted grey for auto, solid foreground
 * for user-approved, destructive red for denied. Hover tooltip explains.
 */
function ApprovalBadge({ mode }: { mode: ActivityApprovalMode }) {
  const label = mode === 'auto' ? 'Auto' : mode === 'user' ? 'Approved' : 'Denied';
  const tooltip =
    mode === 'auto'
      ? 'Auto-approved — this tool is on the auto-allow list'
      : mode === 'user'
        ? 'You approved this tool call'
        : 'This tool call was denied (out of scope or rejected)';
  const cls =
    mode === 'auto'
      ? 'bg-muted/60 text-muted-foreground'
      : mode === 'user'
        ? 'bg-foreground/10 text-foreground'
        : 'bg-destructive/15 text-destructive';
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-[1px] text-[10px] font-medium leading-none transition-colors duration-150 ${cls}`}
          >
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={4}>
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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

/** Stopwatch format (`MM:SS`) for the live recording elapsed time. */
function formatStopwatch(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Display name for a project root — the trailing path component. */
function projectDisplayName(projectRoot: string): string {
  return pathBasename(projectRoot) || projectRoot;
}

/**
 * "Move to project" action shown on a completed transcription job. Lists the
 * open projects from `workspace-store`; picking one relocates the whole bundle
 * (audio + transcript) into that project via `moveBundleToProject`, toasts
 * success, and records the move in the store (which hides this action).
 */
function MoveToProjectMenu({ task }: { task: AgentTask }) {
  const projects = useWorkspaceStore((s) => s.projects);
  const setTranscriptionMoved = useActivityStore((s) => s.setTranscriptionMoved);
  const [moving, setMoving] = useState(false);

  // The bundle dir is the folder holding the transcript/audio.
  const anchorPath = task.transcriptPath ?? task.audioPath;
  if (!anchorPath) return null;
  const bundleDir = dirname(anchorPath);

  const handleMove = async (projectRoot: string) => {
    setMoving(true);
    try {
      const newBundleDir = await moveBundleToProject(bundleDir, projectRoot);
      // The transcript keeps its filename inside the relocated bundle folder;
      // derive the new note path from the audio filename convention.
      const movedAudio = `${newBundleDir}/${basename(task.audioPath ?? '')}`;
      const newTranscriptPath = task.audioPath
        ? transcriptPathForAudio(movedAudio)
        : `${newBundleDir}/${basename(task.transcriptPath ?? '')}`;
      setTranscriptionMoved(task.id, newTranscriptPath);
      toast.success(`Moved to ${projectDisplayName(projectRoot)}`);
    } catch (err) {
      toast.error(`Failed to move recording: ${err}`);
    } finally {
      setMoving(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={moving || projects.length === 0}
          onClick={(e) => e.stopPropagation()}
          className="h-5 px-1.5 gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {moving ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <FolderInput className="h-2.5 w-2.5" strokeWidth={1.5} />
          )}
          Move to project
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {projects.length === 0 ? (
          <DropdownMenuItem disabled>No open projects</DropdownMenuItem>
        ) : (
          projects.map((p) => (
            <DropdownMenuItem
              key={p.path}
              onSelect={() => { void handleMove(p.path); }}
            >
              {projectDisplayName(p.path)}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Transcription-job card (kind === 'transcription'). Distinct ScrollText icon
 * + label; a shadcn `Progress` bar while running (a spinner stands in when
 * progress is 0/unknown); a "Move to project" action on completion; the shared
 * error treatment on failure.
 */
function TranscriptionCard({ task, onRemove }: { task: AgentTask; onRemove?: (id: string) => void }) {
  const isRunning = task.status === 'running';
  const progress = task.progress ?? 0;
  const showSpinner = isRunning && progress === 0;

  return (
    <div className="group/card px-3 py-2.5 space-y-1.5 min-w-0 overflow-hidden">
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          {task.status === 'error' ? (
            <X className="h-3.5 w-3.5 text-destructive" strokeWidth={1.5} />
          ) : task.status === 'done' ? (
            <Check className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          ) : (
            <ScrollText className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate" title={task.label}>
            {task.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {task.status === 'error'
              ? 'Transcription failed — re-runnable from the inbox'
              : task.status === 'done'
                ? 'Transcript ready'
                : 'Transcribing…'}
          </p>
        </div>
        {!isRunning && onRemove && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e) => { e.stopPropagation(); onRemove(task.id); }}
            className="shrink-0 h-4 w-4 opacity-0 group-hover/card:opacity-100 transition-[opacity,color] duration-150 text-muted-foreground hover:text-foreground"
            title="Remove task"
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </Button>
        )}
      </div>

      {/* Progress affordance while running */}
      {isRunning && (
        <div className="pl-5">
          {showSpinner ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
              <span>Starting…</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Progress value={progress} className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {Math.round(progress)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Move-to-project action on completion (hidden once moved) */}
      {task.status === 'done' && !task.moved && (
        <div className="pl-5">
          <MoveToProjectMenu task={task} />
        </div>
      )}
    </div>
  );
}

/**
 * Live-recording card (kind === 'recording'). Recording glyph + a stopwatch
 * elapsed time driven by a 1 s interval. No cancel affordance — capture is
 * stopped from the StatusTray mic button.
 */
function RecordingCard({ task }: { task: AgentTask }) {
  const startedAt = task.recordingStartedAt ?? task.startedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (task.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [task.status]);

  return (
    <div className="group/card px-3 py-2.5 min-w-0 overflow-hidden">
      <div className="flex items-center gap-2">
        <Mic
          className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent-primary)]"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate" title={task.label}>
            {task.label}
          </p>
          <p className="text-xs text-muted-foreground">Recording…</p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatStopwatch(startedAt, now)}
        </span>
      </div>
      {/* Stopping happens from the mic button in the status bar, not here —
          tell users so the orb-only path isn't a dead end. */}
      <p className="mt-1 pl-[1.375rem] text-[11px] text-muted-foreground/80">
        Stop from the mic in the status bar.
      </p>
    </div>
  );
}

interface ActivityTaskCardProps {
  task: AgentTask;
  onCancel?: (taskId: string) => void;
  onRemove?: (taskId: string) => void;
  onClick?: (task: AgentTask) => void;
}

export function ActivityTaskCard(props: ActivityTaskCardProps) {
  // Branch by kind. Transcription + recording have their own self-contained
  // cards (each manages its own hooks); the `agent` path below is unchanged.
  if (props.task.kind === 'transcription') {
    return <TranscriptionCard task={props.task} onRemove={props.onRemove} />;
  }
  if (props.task.kind === 'recording') {
    return <RecordingCard task={props.task} />;
  }
  return <AgentTaskCardInner {...props} />;
}

function AgentTaskCardInner({ task, onCancel, onRemove, onClick }: ActivityTaskCardProps) {
  // Provider logo: stored on task, or fall back to current agent_tasks routing
  const routedAgentConnection = useRoutingStore((s) => s.getConnectionForUseCase('agent_tasks'));
  const providerForLogo = task.connectionProvider ?? routedAgentConnection?.provider;

  // For comment-type tasks, read the conversation thread from comment-store
  const commentReplies = useCommentStore((s) => {
    if (task.type !== 'comment' || !task.documentId || !task.commentId) return undefined;
    const comments = s.commentsByDocument[task.documentId] ?? [];
    const comment = comments.find((c) => c.id === task.commentId);
    return comment?.replies;
  });
  const isConversation = task.type === 'comment' && commentReplies && commentReplies.length > 0;

  const [expanded, setExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const outputWasExpandedRef = useRef(false);
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

  // Sticky output expansion — once expanded, stay expanded across turns
  useEffect(() => {
    if (outputExpanded) outputWasExpandedRef.current = true;
  }, [outputExpanded]);
  useEffect(() => {
    if (task.finalOutput && outputWasExpandedRef.current && !outputExpanded) {
      setOutputExpanded(true);
    }
  }, [task.finalOutput]); // eslint-disable-line react-hooks/exhaustive-deps

  const isClickable = task.status !== 'running' && onClick;
  const TypeIcon = task.type === 'comment' ? BotMessageSquare : MessageCircle;

  const hasOutput = task.partialOutput || task.finalOutput;
  const isStreaming = task.status === 'running' && !!task.partialOutput;

  return (
    <div
      className={`group/card px-3 py-2.5 space-y-1 min-w-0 overflow-hidden transition-colors duration-150 ${
        isClickable ? 'cursor-pointer hover:bg-muted/50 active:bg-muted/70' : ''
      }`}
      onClick={isClickable ? () => onClick(task) : undefined}
    >
      {/* Top row: status icon + label + elapsed time + remove */}
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          {task.status === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" strokeWidth={1.5} />
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
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatElapsed(task.startedAt, task.completedAt)}
        </span>
        {task.status !== 'running' && onRemove && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e) => { e.stopPropagation(); onRemove(task.id); }}
            className="shrink-0 h-4 w-4 opacity-0 group-hover/card:opacity-100 transition-[opacity,color] duration-150 text-muted-foreground hover:text-foreground"
            title="Remove task"
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </Button>
        )}
      </div>

      {/* Source file */}
      {task.sourceFile && (
        <div className="flex items-center gap-2 pl-5">
          <TypeIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" strokeWidth={1.5} />
          <span className="text-xs text-muted-foreground truncate">
            {basename(task.sourceFile)}
          </span>
        </div>
      )}

      {/* Thinking / reasoning */}
      {task.thinkingOutput && (
        <div className="pl-5 min-w-0">
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onClick={(e) => { e.stopPropagation(); setThinkingExpanded(!thinkingExpanded); }}
            className="h-auto px-0 py-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
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
          </Button>
          {thinkingExpanded && (
            <div
              ref={thinkingRef}
              className="mt-1 max-h-60 overflow-y-auto overflow-x-hidden thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5 italic"
            >
              <MarkdownContent content={task.thinkingOutput!} className="text-xs text-muted-foreground" />
              {task.status === 'running' && (
                <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse motion-reduce:animate-none bg-muted-foreground" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Output — streaming, conversation thread, or single response */}
      {isStreaming && (
        <div className="pl-5 min-w-0">
          <div className="mt-1">
            <div className="flex items-center gap-1.5 mb-1">
              {providerForLogo ? (
                <ProviderLogo provider={providerForLogo} className="h-3 w-3" />
              ) : (
                <BotMessageSquare className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
              )}
              <span className="text-xs text-muted-foreground">responding...</span>
            </div>
            <div
              ref={streamingRef}
              className="max-h-60 overflow-y-auto overflow-x-hidden thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5"
            >
              <MarkdownContent content={task.partialOutput!} className="text-xs" />
              <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse motion-reduce:animate-none bg-muted-foreground" />
            </div>
          </div>
        </div>
      )}
      {!isStreaming && isConversation && (
        <div className="pl-5 min-w-0">
          <div className="mt-1">
            <Button
              variant="ghost"
              size="xs"
              type="button"
              onClick={(e) => { e.stopPropagation(); setOutputExpanded(!outputExpanded); }}
              className="h-auto px-0 py-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
            >
              {outputExpanded ? (
                <ChevronDown className="h-2.5 w-2.5" />
              ) : (
                <ChevronRight className="h-2.5 w-2.5" />
              )}
              <span>Conversation ({commentReplies.length} message{commentReplies.length !== 1 ? 's' : ''})</span>
            </Button>
            {outputExpanded && (
              <div className="mt-1 max-h-80 overflow-y-auto overflow-x-hidden thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5 space-y-2">
                {commentReplies.map((reply) => {
                  const isUserReply = reply.author === 'You';
                  return (
                    <div key={reply.id}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {isUserReply ? (
                          <User className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                        ) : providerForLogo ? (
                          <ProviderLogo provider={providerForLogo} className="h-3 w-3" />
                        ) : (
                          <BotMessageSquare className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                        )}
                        <span className="text-[10px] font-medium text-muted-foreground">{reply.author}</span>
                      </div>
                      <MarkdownContent content={reply.body} className="text-xs" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {!isStreaming && !isConversation && hasOutput && task.finalOutput && (
        <div className="pl-5 min-w-0">
          <div className="mt-1">
            <Button
              variant="ghost"
              size="xs"
              type="button"
              onClick={(e) => { e.stopPropagation(); setOutputExpanded(!outputExpanded); }}
              className="h-auto px-0 py-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
            >
              {task.connectionProvider ? (
                <ProviderLogo provider={task.connectionProvider} className="h-3 w-3" />
              ) : (
                <BotMessageSquare className="h-3 w-3" strokeWidth={1.5} />
              )}
              {outputExpanded ? (
                <ChevronDown className="h-2.5 w-2.5" />
              ) : (
                <ChevronRight className="h-2.5 w-2.5" />
              )}
              <span>Agent response</span>
            </Button>
            {outputExpanded && (
              <div className="mt-1 max-h-80 overflow-y-auto overflow-x-hidden thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5">
                <MarkdownContent content={task.finalOutput} className="text-xs" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activity log toggle + stop button */}
      <div className="flex items-center justify-between pl-5">
        {task.activities.length > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="h-auto px-0 py-0 gap-1 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
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
          </Button>
        ) : (
          <span />
        )}
        {task.status === 'running' && onCancel && (
          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}
            className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Square className="h-2.5 w-2.5 mr-0.5" strokeWidth={1.5} />
            Stop
          </Button>
        )}
      </div>

      {/* Expanded activity log */}
      {expanded && task.activities.length > 0 && (
        <TooltipProvider delayDuration={300}>
        <div className="pl-5 space-y-0.5 max-h-60 overflow-y-auto thin-scrollbar">
          {task.activities.map((a, i) => {
            // If the task itself is finished, no activity should show a spinner
            const effectiveStatus = a.status === 'running' && task.status !== 'running' ? 'done' : a.status;
            return (
            <div
              key={`${a.timestamp}-${i}`}
              className={`flex items-start gap-1.5 text-xs ${
                effectiveStatus === 'error' ? 'text-destructive/70' : 'text-muted-foreground/70'
              }`}
            >
              {effectiveStatus === 'running' ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0 mt-px" strokeWidth={1.5} />
              ) : effectiveStatus === 'error' ? (
                <AlertCircle className="h-2.5 w-2.5 shrink-0 mt-px" strokeWidth={1.5} />
              ) : effectiveStatus === 'info' ? (
                <Info className="h-2.5 w-2.5 shrink-0 mt-px" strokeWidth={1.5} />
              ) : (
                <Check className="h-2.5 w-2.5 shrink-0 mt-px" strokeWidth={1.5} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate min-w-0 flex-1">{a.label}</span>
                  {a.approvalMode && <ApprovalBadge mode={a.approvalMode} />}
                </div>
                {a.detail && (
                  // Tooltip exposes the full argument (path/query/etc) on hover.
                  // `truncate block` renders a shortened visual line.
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate block text-muted-foreground/50 cursor-help">
                        {a.detail.length > 60 ? a.detail.slice(0, 60) + '\u2026' : a.detail}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left" sideOffset={4} className="max-w-md">
                      <p className="text-xs break-all whitespace-pre-wrap">{a.detail}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {a.content && a.content.length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    {a.content.map((item, idx) => {
                      if (item.type === 'diff') {
                        return (
                          <DiffContentView
                            key={`diff-${idx}`}
                            path={item.path}
                            oldText={item.oldText}
                            newText={item.newText}
                          />
                        );
                      }
                      if (item.type === 'text') {
                        return <TextContentView key={`text-${idx}`} text={item.text} />;
                      }
                      return (
                        <div
                          key={`terminal-${idx}`}
                          className="px-1 text-[11px] text-muted-foreground/50 italic"
                        >
                          Terminal output (not yet supported)
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
        </TooltipProvider>
      )}
    </div>
  );
}
