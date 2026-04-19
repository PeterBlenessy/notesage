import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ProviderLogo } from '@/components/ProviderLogo';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Lock } from 'lucide-react';

export type ResendProviderChoice = 'original' | 'current';

/**
 * Minimal view of a connection for rendering — intentionally narrow so the
 * dialog doesn't depend on the full `Connection` type and can render historical
 * "this connection was deleted" cases where we only have a snapshot label.
 */
export interface ResendProviderOption {
  /** Connection ID. Null when the original connection was never known (legacy message). */
  id: string | null;
  /** Display label (falls back to provider name or connection id). */
  label: string;
  /** Provider slug for rendering the logo. `null` hides the logo. */
  provider: string | null;
  /** True when the option should be disabled — gone, locked out, or unavailable. */
  disabled: boolean;
  /** Optional tooltip when disabled (e.g. "No longer connected", "Locked by project"). */
  disabledReason?: string;
}

export interface ResendProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  original: ResendProviderOption;
  current: ResendProviderOption;
  /** True when this is an edit-resend (slightly different copy). */
  isEdit?: boolean;
  onConfirm: (choice: ResendProviderChoice) => void;
}

/**
 * Confirmation shown when the user resends (or edits and sends) a message that
 * was originally routed to a different provider than the one currently active.
 * Prevents silent provider bleed: the user must explicitly choose which
 * provider receives the (potentially sensitive) content.
 *
 * Default option is "original" — matches the connectionId recorded on the
 * message. `aiLock` on the current project constrains which options are
 * enabled; see `ChatPanel.tsx` for the resolution logic.
 */
export function ResendProviderDialog({
  open,
  onOpenChange,
  original,
  current,
  isEdit,
  onConfirm,
}: ResendProviderDialogProps) {
  // Default selection: original (matches the message's recorded connection). If
  // original is disabled, defer to current when it's enabled. If both disabled
  // we still track "original" as the default so a keyboard Enter does nothing
  // destructive — the Confirm button will itself be disabled.
  const [choice, setChoice] = useState<ResendProviderChoice>('original');

  // Reset the choice each time the dialog opens so a prior cancel doesn't leak.
  useEffect(() => {
    if (!open) return;
    if (!original.disabled) {
      setChoice('original');
    } else if (!current.disabled) {
      setChoice('current');
    } else {
      setChoice('original');
    }
  }, [open, original.disabled, current.disabled]);

  const handleConfirm = () => {
    // Guard against clicks while the selected option is disabled (e.g. lock
    // mismatch). In practice the Confirm button is disabled in that state, but
    // we keep the check so programmatic triggers can't bypass it.
    if (choice === 'original' && original.disabled) return;
    if (choice === 'current' && current.disabled) return;
    onConfirm(choice);
  };

  const confirmDisabled =
    (choice === 'original' && original.disabled) ||
    (choice === 'current' && current.disabled);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {isEdit ? 'Send edited message to which provider?' : 'Resend to which provider?'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            This message was originally sent to a different provider than the one currently selected.
            Choose which provider should receive it — nothing is sent until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <ProviderOption
            option={original}
            selected={choice === 'original'}
            label="Resend with original"
            onSelect={() => setChoice('original')}
          />
          <ProviderOption
            option={current}
            selected={choice === 'current'}
            label="Resend with current"
            onSelect={() => setChoice('current')}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={confirmDisabled}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderOption({
  option,
  selected,
  label,
  onSelect,
}: {
  option: ResendProviderOption;
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  // The button itself is always rendered; when disabled, clicks do nothing and
  // the tooltip explains why. We still let focus land on it for keyboard users.
  const content = (
    <button
      type="button"
      data-testid={`resend-provider-option-${label.split(' ').pop()?.toLowerCase() ?? 'unknown'}`}
      aria-pressed={selected}
      aria-disabled={option.disabled}
      disabled={option.disabled}
      onClick={option.disabled ? undefined : onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-colors ${
        selected
          ? 'border-foreground/40 bg-accent'
          : 'border-border hover:bg-accent/50'
      } ${option.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {option.provider ? (
        <ProviderLogo provider={option.provider} className="w-5 h-5 shrink-0" />
      ) : (
        <span className="w-5 h-5 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {option.label}
        </div>
      </div>
      {option.disabled && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />}
    </button>
  );

  if (!option.disabled || !option.disabledReason) return content;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Wrap disabled button so hover still fires (disabled buttons don't emit events). */}
          <span className="block">{content}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-64">
          {option.disabledReason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
