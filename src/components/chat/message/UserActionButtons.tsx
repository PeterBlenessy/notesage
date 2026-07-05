import { Check, Copy, Ellipsis, GitBranch, Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ActionIconButton } from './ActionIconButton';

/** Action buttons for messages. For user messages, collapses into a ⋯ menu when buttons overflow the bubble. */
export function UserActionButtons({ isUser, onEdit, onResend, onBranch, onCopy, copied }: {
  isUser: boolean;
  onEdit?: () => void;
  onResend?: () => void;
  onBranch?: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // For user messages, check if buttons would overflow the bubble
  // +1 for the always-present copy button
  const userButtonCount = [onEdit, onResend, onBranch].filter(Boolean).length + 1;

  useEffect(() => {
    if (!isUser || userButtonCount === 0) return;
    const bubble = bubbleRef.current?.parentElement;
    if (!bubble) return;

    const check = () => {
      const bubbleWidth = bubble.offsetWidth;
      if (bubbleWidth === 0) return; // Not yet laid out
      // Each button is 24px + 4px gap = 28px per button, plus 8px left offset
      const buttonsWidth = userButtonCount * 28 + 8;
      setCollapsed(buttonsWidth > bubbleWidth);
    };
    check();

    const observer = new ResizeObserver(check);
    observer.observe(bubble);
    return () => observer.disconnect();
  }, [isUser, userButtonCount]);

  if (isUser) {

    if (collapsed) {
      return (
        <div ref={bubbleRef} className="absolute -bottom-3 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <DropdownMenu>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="h-6 w-6 rounded-md flex items-center justify-center bg-card border border-border hover:bg-foreground/10 hover:text-foreground transition-colors"
                      aria-label="Message actions"
                    >
                      <Ellipsis className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[220px]">
                  Message actions
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent align="start" side="bottom" className="min-w-[130px] p-0.5">
              {onEdit && (
                <DropdownMenuItem onClick={onEdit} className="text-xs h-7 px-2">
                  <Pencil className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                  Edit
                </DropdownMenuItem>
              )}
              {onResend && (
                <DropdownMenuItem onClick={onResend} className="text-xs h-7 px-2">
                  <RotateCcw className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                  Resend
                </DropdownMenuItem>
              )}
              {onBranch && (
                <DropdownMenuItem onClick={onBranch} className="text-xs h-7 px-2">
                  <GitBranch className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                  Branch
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onCopy} className="text-xs h-7 px-2">
                {copied
                  ? <Check className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                  : <Copy className="h-3 w-3 mr-1.5" strokeWidth={1.5} />}
                {copied ? 'Copied' : 'Copy'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    }

    const actionBtnCls = "h-6 w-6 rounded-md flex items-center justify-center bg-card border border-border hover:bg-foreground/10 hover:text-foreground transition-colors";
    return (
      <div ref={bubbleRef} className="absolute -bottom-3 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        {onEdit && (
          <ActionIconButton label="Edit message" onClick={onEdit} className={actionBtnCls}>
            <Pencil className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          </ActionIconButton>
        )}
        {onResend && (
          <ActionIconButton label="Resend message" onClick={onResend} className={actionBtnCls}>
            <RotateCcw className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          </ActionIconButton>
        )}
        {onBranch && (
          <ActionIconButton label="Branch from here" onClick={onBranch} className={actionBtnCls}>
            <GitBranch className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          </ActionIconButton>
        )}
        <ActionIconButton label={copied ? 'Copied' : 'Copy message'} onClick={onCopy} className={actionBtnCls}>
          {copied ? (
            <Check className="h-3 w-3 text-foreground" strokeWidth={1.5} />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          )}
        </ActionIconButton>
      </div>
    );
  }

  // Assistant messages — always inline
  const actionBtnCls = "h-6 w-6 rounded-md flex items-center justify-center bg-card border border-border hover:bg-foreground/10 hover:text-foreground transition-colors";
  return (
    <div className="absolute -bottom-3 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
      {onBranch && (
        <ActionIconButton label="Branch from here" onClick={onBranch} className={actionBtnCls}>
          <GitBranch className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        </ActionIconButton>
      )}
      <ActionIconButton label={copied ? 'Copied' : 'Copy message'} onClick={onCopy} className={actionBtnCls}>
        {copied ? (
          <Check className="h-3 w-3 text-foreground" strokeWidth={1.5} />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        )}
      </ActionIconButton>
    </div>
  );
}
