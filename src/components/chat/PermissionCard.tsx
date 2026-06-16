import { useEffect, useId, useRef } from 'react';
import { FileEdit, Pencil, Terminal, Shield, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type PermissionRequest } from '@/stores/permission-store';
import { resolveAcpPermission } from '@/lib/ai/permission-resolve';
import { formatAcpToolName } from '@/hooks/useAIOperations';

function getToolIcon(kind: string) {
  switch (kind) {
    case 'write':
    case 'write_file':
      return FileEdit;
    case 'edit':
      return Pencil;
    case 'bash':
    case 'terminal':
      return Terminal;
    default:
      return Shield;
  }
}

/**
 * Truncate a long `toolInput` string for use inside an `aria-label`. Screen
 * readers read the entire label on focus, so we cap it at a readable length.
 */
function truncateForLabel(input: string, max = 80): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Build a full-intent verb phrase for the Allow / Deny button aria-labels.
 * Example: `"Allow write_file to /path/to/file.md"`, `"Deny read_file of
 * /path/to/file.md"`, `"Allow bash command git push"`. Falls back to the
 * formatted tool-name label (e.g. "Allow Reading file") when no arguments
 * are available.
 */
function buildActionLabel(
  verb: 'Allow' | 'Deny',
  toolKind: string,
  toolInput: string,
  fallbackLabel: string,
): string {
  const kind = toolKind.toLowerCase();
  const target = toolInput.trim();

  if (!target) {
    return `${verb} ${fallbackLabel}`;
  }

  const safeTarget = truncateForLabel(target);

  switch (kind) {
    case 'write':
    case 'write_file':
    case 'edit':
      return `${verb} write_file to ${safeTarget}`;
    case 'read':
    case 'read_file':
      return `${verb} read_file of ${safeTarget}`;
    case 'bash':
    case 'terminal':
    case 'execute':
      return `${verb} bash command ${safeTarget}`;
    case 'glob':
    case 'list':
    case 'list_directory':
      return `${verb} list_directory of ${safeTarget}`;
    case 'grep':
    case 'search':
      return `${verb} search for ${safeTarget}`;
    case 'fetch':
    case 'webfetch':
    case 'web_fetch':
      return `${verb} fetch ${safeTarget}`;
    case 'web_search':
    case 'websearch':
      return `${verb} web search for ${safeTarget}`;
    case 'execute_skill_script':
      return `${verb} skill script ${safeTarget}`;
    default:
      // Unknown tool kinds: use the raw kind token + input so assistive tech
      // still hears "Allow <tool> <path>" rather than just "Allow".
      return `${verb} ${toolKind} ${safeTarget}`;
  }
}

interface PermissionCardProps {
  request: PermissionRequest;
}

export function PermissionCard({ request }: PermissionCardProps) {
  const Icon = getToolIcon(request.toolKind);
  const label = formatAcpToolName(request.toolKind, request.toolTitle);
  const labelId = useId();
  const countdownId = useId();
  const allowButtonRef = useRef<HTMLButtonElement>(null);

  const allowAriaLabel = buildActionLabel('Allow', request.toolKind, request.toolInput, label);
  const denyAriaLabel = buildActionLabel('Deny', request.toolKind, request.toolInput, label);

  // Move focus to the Allow button when the card appears. This is the a11y
  // requirement in the PRD (#83): "Focus moves to Allow when card appears".
  // We focus on mount only — not on prop changes — so later re-renders don't
  // steal focus from any dropdown item the user has opened.
  useEffect(() => {
    allowButtonRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown live region. Today the direct-API / ACP permission flow has no
  // auto-deny timer (only the network domain-approval flow does), so this
  // region exists as a forward-compatible hook: the moment a timeout is wired
  // up on `PermissionRequest`, we can feed deadline updates into
  // `countdownRef.current.textContent` at appearance / 10s / 5s without
  // further a11y work.
  //
  // See docs/features/ai-providers.md → "Permission model" (no auto-deny today)
  // and docs/tasks/2026-04-21-ui-refresh-phase1-tasks.md #83.

  // Resolution is shared with the inline history-row card (task #10) via
  // `permission-resolve` so the two approval surfaces never drift.
  const handleAllow = () => resolveAcpPermission(request, 'allow', label);
  const handleAllowSession = () => resolveAcpPermission(request, 'session', label);
  const handleAllowAlways = () => resolveAcpPermission(request, 'always', label);
  const handleDeny = () => resolveAcpPermission(request, 'deny', label);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-labelledby={labelId}
      className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-start gap-2.5"
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <div className="flex-1 min-w-0">
        <p id={labelId} className="text-xs font-medium text-foreground">
          {label}
        </p>
        {request.toolInput && (
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{request.toolInput}</p>
        )}
      </div>
      {/*
        Visually-hidden countdown announcer. Lives inside the card so it
        shares the same implicit parent as the label. Empty today — will be
        populated by a future auto-deny timer (throttled: appearance, 10s,
        5s) without needing any structural change.
      */}
      <span
        id={countdownId}
        role="status"
        aria-live="polite"
        data-permission-countdown=""
        className="sr-only"
      />
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          variant="ghost"
          size="xs"
          onClick={handleDeny}
          aria-label={denyAriaLabel}
        >
          Deny
        </Button>
        <div className="flex items-center">
          <Button
            ref={allowButtonRef}
            variant="default"
            size="xs"
            className="rounded-r-none"
            onClick={handleAllow}
            aria-label={allowAriaLabel}
          >
            Allow
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                size="xs"
                className="rounded-l-none border-l border-l-primary-foreground/20 px-1"
                aria-label="More approval options"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={handleAllow}>
                Allow once
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAllowSession}>
                Allow for this session
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAllowAlways}>
                Allow always
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
