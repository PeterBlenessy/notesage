import { useEffect, useState } from "react";
import { X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useSettingsStore,
  shouldShowRevertInvitation,
} from "@/stores/settings-store";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * RevertInvitation — symmetric counterpart to `PreviewInvitation` (task
 * #107). When the user is in Quiet Composer mode, surface a one-time
 * dismissible banner offering a clear path back to the classic shell
 * without making them dig into Settings.
 *
 * Mounted only inside `QuietLayout`. The eligibility + persistence shape
 * mirrors `PreviewInvitation` exactly — same 30-day cooldown after
 * dismissal, same markShown-on-first-appearance pattern — so the two
 * banners feel like a matched pair.
 */
export function RevertInvitation() {
  const reducedMotion = useReducedMotion();

  const uiPreview = useSettingsStore((s) => s.uiPreview);
  const shownAt = useSettingsStore((s) => s.revertInvitationShownAt);
  const dismissedAt = useSettingsStore((s) => s.revertInvitationDismissedAt);
  const setUiPreview = useSettingsStore((s) => s.setUiPreview);
  const markShown = useSettingsStore((s) => s.markRevertInvitationShown);
  const dismiss = useSettingsStore((s) => s.dismissRevertInvitation);

  // Local "closed for this session" flag — clicking × or "Switch back"
  // should hide the banner immediately even before the persisted
  // timestamps propagate.
  const [closed, setClosed] = useState(false);

  const eligible = shouldShowRevertInvitation(
    {
      uiPreview,
      revertInvitationShownAt: shownAt,
      revertInvitationDismissedAt: dismissedAt,
    },
    Date.now(),
  );
  const visible = eligible && !closed;

  // Mark as shown on first appearance so the 30-day cooldown starts
  // counting. Matches the PreviewInvitation lifecycle exactly.
  useEffect(() => {
    if (visible && shownAt === null) {
      markShown();
    }
  }, [visible, shownAt, markShown]);

  if (!visible) return null;

  const handleSwitchBack = () => {
    setClosed(true);
    setUiPreview("legacy");
  };

  const handleDismiss = () => {
    setClosed(true);
    dismiss();
  };

  const animationClasses = reducedMotion
    ? ""
    : "animate-in fade-in slide-in-from-bottom-2 duration-200";

  return (
    <div
      role="region"
      aria-label="Revert to classic UI invitation"
      data-revert-invitation
      className={`pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 ${animationClasses}`}
    >
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <RotateCcw
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div className="flex-1 text-sm text-foreground">
          <span className="font-medium">Prefer the classic UI?</span>
          <span className="text-muted-foreground"> — switch back any time.</span>
        </div>
        <Button
          size="sm"
          variant="default"
          onClick={handleSwitchBack}
          data-revert-invitation-switch
        >
          Switch back
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={handleDismiss}
          aria-label="Dismiss revert invitation"
          data-revert-invitation-dismiss
        >
          <X strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}
