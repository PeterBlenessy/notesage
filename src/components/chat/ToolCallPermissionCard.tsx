import { useState, useEffect, useRef } from 'react';
import { Wrench, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PendingToolPermission } from '@/stores/tool-permission-store';
import { useIsRequestForeground } from '@/hooks/useSessionManager';

interface ToolCallPermissionCardProps {
  request: PendingToolPermission;
  onResolved?: (id: string) => void;
}

/**
 * Permission card for local AI tool calls (direct API path).
 * Follows the same pattern as PermissionCard (ACP) and DomainApprovalCard.
 * Rendered inline in the chat stream when the tool execution loop
 * (useDirectApiChat) encounters a tool call that needs user approval.
 */
export function ToolCallPermissionCard({ request, onResolved }: ToolCallPermissionCardProps) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);
  const resolvedRef = useRef(false);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  // Foreground-aware auto-deny (task #7): only count down while this request's
  // session is the one being watched. A backgrounded request never auto-denies
  // — the desktop notification (task #15) is its time-sensitive signal.
  const isForeground = useIsRequestForeground(request.conversationId);

  // Auto-deny after 30 seconds — only while foreground.
  useEffect(() => {
    if (!isForeground) {
      setCountdown(30); // frozen while backgrounded; restarts on foreground
      return;
    }
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (!resolvedRef.current) {
            resolvedRef.current = true;
            request.resolve('deny');
            setResolved(`Tool call "${request.name}" timed out — denied.`);
            setTimeout(() => onResolvedRef.current?.(request.id), 1500);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, isForeground]);

  const handleAllow = () => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    request.resolve('allow');
    setResolved(`Allowed "${request.name}" once`);
    setTimeout(() => onResolved?.(request.id), 1500);
  };

  const handleAllowSession = () => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    request.resolve('session');
    setResolved(`Allowed "${request.name}" for session`);
    setTimeout(() => onResolved?.(request.id), 1500);
  };

  const handleAllowAlways = () => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    request.resolve('always');
    setResolved(`Allowed "${request.name}" always`);
    setTimeout(() => onResolved?.(request.id), 1500);
  };

  const handleDeny = () => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    request.resolve('deny');
    setResolved(`Denied "${request.name}"`);
    setTimeout(() => onResolved?.(request.id), 1500);
  };

  const formatArgs = (args: Record<string, unknown>): string | null => {
    const entries = Object.entries(args);
    if (entries.length === 0) return null;
    return entries
      .map(([key, val]) => {
        const strVal = typeof val === 'string' ? val : JSON.stringify(val);
        const truncated = strVal.length > 80 ? strVal.slice(0, 80) + '\u2026' : strVal;
        return `${key}: ${truncated}`;
      })
      .join('\n');
  };

  if (resolved) {
    return (
      <div className="rounded-lg border border-border bg-card/50 px-3 py-2 flex items-center gap-2.5">
        <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-[11px] text-muted-foreground">{resolved}</p>
      </div>
    );
  }

  const formattedArgs = formatArgs(request.arguments);

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <Wrench className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground">Tool call: {request.name}</p>
          {formattedArgs && (
            <pre className="mt-1 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">
              {formattedArgs}
            </pre>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 ml-[26px]">
        <Button variant="ghost" size="xs" onClick={handleDeny}>
          Deny{countdown < 30 ? ` (${countdown}s)` : ''}
        </Button>
        <div className="flex items-center">
          <Button
            variant="default"
            size="xs"
            className="rounded-r-none"
            onClick={handleAllow}
          >
            Allow
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                size="xs"
                className="rounded-l-none border-l border-l-primary-foreground/20 px-1"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              <DropdownMenuItem onClick={handleAllow}>
                Allow once
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAllowSession}>
                Allow for this session
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAllowAlways}>
                Always allow
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
