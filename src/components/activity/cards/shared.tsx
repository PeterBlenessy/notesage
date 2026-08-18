import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ActivityApprovalMode } from '@/lib/ai/types';
import { getFormatLocale } from '@/lib/i18n';

/**
 * Small badge next to each activity row signalling *how* the tool call was
 * authorized. Strictly neutral palette: muted grey for auto, solid foreground
 * for user-approved, destructive red for denied. Hover tooltip explains.
 */
export function ApprovalBadge({ mode }: { mode: ActivityApprovalMode }) {
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

/**
 * Icon button with the app-standard Radix tooltip (TooltipProvider is
 * mandatory — see design-system.md). All hover hints on orb-panel controls go
 * through this so they match tooltips everywhere else in the app instead of
 * the native browser `title` bubble.
 */
export function IconActionButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className={className}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

/** Wall-clock 24-hour `HH:MM` for a recording start/stop time. */
export function formatClock(ms?: number): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleTimeString(getFormatLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
