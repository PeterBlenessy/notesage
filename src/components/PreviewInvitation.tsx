import { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore, shouldShowPreviewInvitation } from "@/stores/settings-store";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * PreviewInvitation — one-time dismissible banner that invites legacy-shell
 * users to try the Quiet Composer preview UI.
 *
 * Lifecycle (PRD `2026-04-21-ui-refresh`, task #97):
 *   - Shows on first launch after the Phase 1 release installs (legacy users
 *     only — `uiPreview === "legacy"`).
 *   - "Try it" → flips `uiPreview` to "quiet-composer". Layout swaps on next
 *     render; the banner unmounts.
 *   - "×" → dismisses for 30 days via `previewInvitationDismissedAt`; reappears
 *     once after the cooldown.
 *
 * Mounted at the bottom of the legacy `Layout`. Never mounts inside
 * `QuietLayout` — a user already on the new UI doesn't need an invite.
 */
export function PreviewInvitation() {
  const reducedMotion = useReducedMotion();

  // Subscribe to the three relevant fields. Ref the store directly for the
  // shouldShow decision so we re-evaluate when any of them change.
  const uiPreview = useSettingsStore((s) => s.uiPreview);
  const shownAt = useSettingsStore((s) => s.previewInvitationShownAt);
  const dismissedAt = useSettingsStore((s) => s.previewInvitationDismissedAt);
  const setUiPreview = useSettingsStore((s) => s.setUiPreview);
  const markShown = useSettingsStore((s) => s.markPreviewInvitationShown);
  const dismiss = useSettingsStore((s) => s.dismissPreviewInvitation);

  // Local "closed for this session" flag — clicking × or "Try it" should hide
  // the banner immediately even before the persisted timestamps propagate.
  const [closed, setClosed] = useState(false);

  // Compute eligibility once per render; `Date.now()` only on the read so
  // the helper itself stays pure and testable.
  const eligible = shouldShowPreviewInvitation(
    { uiPreview, previewInvitationShownAt: shownAt, previewInvitationDismissedAt: dismissedAt },
    Date.now(),
  );
  const visible = eligible && !closed;

  // Mark the banner as shown on first appearance so the 30-day cooldown
  // window starts counting (used by `shouldShowPreviewInvitation`'s null
  // check to differentiate "never shown" from "shown, awaiting dismissal").
  useEffect(() => {
    if (visible && shownAt === null) {
      markShown();
    }
  }, [visible, shownAt, markShown]);

  if (!visible) return null;

  const handleTryIt = () => {
    setClosed(true);
    setUiPreview("quiet-composer");
  };

  const handleDismiss = () => {
    setClosed(true);
    dismiss();
  };

  // Skip the entrance animation under prefers-reduced-motion. Tailwind's
  // `animate-in` / `slide-in-from-bottom` would otherwise add motion the
  // user has explicitly opted out of.
  const animationClasses = reducedMotion
    ? ""
    : "animate-in fade-in slide-in-from-bottom-2 duration-200";

  return (
    <div
      role="region"
      aria-label="Preview invitation"
      data-preview-invitation
      className={`pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 ${animationClasses}`}
    >
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <Sparkles
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div className="flex-1 text-sm text-foreground">
          <span className="font-medium">Try the new UI</span>
          <span className="text-muted-foreground"> — a calmer, more focused Notesage.</span>
        </div>
        <Button
          size="sm"
          variant="default"
          onClick={handleTryIt}
          data-preview-invitation-try
        >
          Try it
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={handleDismiss}
          aria-label="Dismiss preview invitation"
          data-preview-invitation-dismiss
        >
          <X strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}
