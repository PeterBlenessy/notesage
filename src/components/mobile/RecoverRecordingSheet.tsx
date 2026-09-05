import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { recoverRecording } from "@/lib/recording-controller";
import { useMobileStore } from "@/stores/mobile-store";

/**
 * A force-quit mid-recording leaves a staging folder behind. Offered once at
 * launch: keep (finalise into the library) or discard. Never decided for the
 * user — a recoverable meeting silently dropped, or a broken one silently
 * filed, would both be worse than a question.
 */
export function RecoverRecordingSheet() {
  const orphan = useMobileStore((s) => s.recording.orphan);
  if (!orphan) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-background/60 p-4 backdrop-blur-sm" role="dialog" aria-label={t("recording.recoverTitle")}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-popover p-5 shadow-lg">
        <div className="flex items-start gap-3">
          <Mic strokeWidth={1.5} className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-[length:calc(1rem*var(--ns-a11y-scale,1))] text-foreground" style={{ fontWeight: "max(500, var(--ns-a11y-weight, 400))" }}>
              {t("recording.recoverTitle")}
            </p>
            <p className="mt-1 text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-muted-foreground">
              {orphan.readable ? t("recording.recoverBody") : t("recording.recoverUnreadable")}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="ios-press-row" onClick={() => void recoverRecording("discard")}>
            {t("recording.discard")}
          </Button>
          {orphan.readable && (
            <Button size="sm" className="ios-press-row" onClick={() => void recoverRecording("keep")}>
              {t("recording.keep")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
