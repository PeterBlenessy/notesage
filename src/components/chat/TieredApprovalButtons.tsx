import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ApprovalTier } from '@/lib/ai/permission-resolve';
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

interface TieredApprovalButtonsProps {
  /** Resolve the request at the chosen tier. */
  onDecide: (tier: ApprovalTier) => void;
  /** Appended to the Deny label, e.g. a countdown ` (12s)`. */
  denySuffix?: string;
}

/**
 * Shared Allow (split-button: once / for session / always) + Deny control for
 * tool-call permission surfaces (PRD `2026-06-14-command-bar-session-multitasking`,
 * task #10). Used by the inline history-row card and the in-stream
 * `ToolCallPermissionCard` so the approval form never drifts between them.
 */
export const TieredApprovalButtons = forwardRef<HTMLButtonElement, TieredApprovalButtonsProps>(
  function TieredApprovalButtons({ onDecide, denySuffix = '' }, allowRef) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
    return (
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="xs" onClick={() => onDecide('deny')}>
          Deny{denySuffix}
        </Button>
        <div className="flex items-center">
          <Button
            ref={allowRef}
            variant="default"
            size="xs"
            className="rounded-r-none"
            onClick={() => onDecide('allow')}
          >
            Allow
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                size="xs"
                className="rounded-l-none border-l border-l-primary-foreground/20 px-1"
                aria-label={t("chat.moreAllowOptions")}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onDecide('session')}>
                Allow for session
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDecide('always')}>
                Allow always
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  },
);
