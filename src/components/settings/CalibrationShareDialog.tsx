import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { buildCalibrationShare } from '@/lib/ai/calibration-share';
import { useModelFitMeasurementStore } from '@/stores/model-fit-measurement-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useSettingsStore } from '@/stores/settings-store';
import { t } from '@/lib/i18n';

interface CalibrationShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Opt-in community-calibration share dialog (task #10, model-fit calibration).
 *
 * Lets a user contribute their measured local-model performance to the public
 * calibration corpus so model recommendations improve for everyone. The
 * submission is a PUBLIC GitHub issue posted under the user's own GitHub
 * account (so it carries their handle — pseudonymous, NOT anonymous). The
 * exact payload is rendered verbatim in a scrollable code block BEFORE any
 * action, so the user reviews precisely what will be shared.
 *
 * The app never posts directly — "Open GitHub to share" opens a prefilled
 * issue-form URL in the browser, and the user submits manually.
 *
 * Chrome mirrors LocalAIModelsDialog (v2 dialog aesthetic). Neutral palette
 * only — no chromatic accents.
 */
export function CalibrationShareDialog({
  open,
  onOpenChange,
}: CalibrationShareDialogProps) {
  const profile = useLocalAIStore((s) => s.hardwareProfile);
  const measurements = useModelFitMeasurementStore((s) => s.measurements);
  const dismissCalibrationShare = useSettingsStore(
    (s) => s.dismissCalibrationShare,
  );

  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {
        // Non-Tauri context or resolution failure — leave version blank.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const measurementList = useMemo(
    () => Object.values(measurements),
    [measurements],
  );

  const hasData = profile !== null && measurementList.length > 0;

  // Build the share exactly once per open over (profile, measurements, version).
  const share = useMemo(() => {
    if (!profile) return null;
    return buildCalibrationShare(profile, measurementList, appVersion);
  }, [profile, measurementList, appVersion]);

  const handleOpenGithub = () => {
    if (!share) return;
    openUrl(share.issueUrl).catch(() => window.open(share.issueUrl, '_blank'));
    onOpenChange(false);
  };

  const handleCopy = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.markdown);
      toast.success(t("calibration.copied"));
    } catch {
      toast.error(t("calibration.copyFailed"));
    }
  };

  const handleDontAskAgain = () => {
    dismissCalibrationShare();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-48px)] sm:max-w-[640px] max-h-[min(720px,calc(100vh-48px))] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-7 pt-7 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-[20px] font-semibold tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5" strokeWidth={1.5} />
            Share with the community
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
            Contributing your measurements helps improve model recommendations
            for everyone running local AI.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="px-7 py-5 space-y-4">
              {hasData && share ? (
                <>
                  <div className="space-y-3 text-[13px] text-muted-foreground leading-relaxed">
                    <p>
                      Your submission is a{' '}
                      <span className="font-medium text-foreground">
                        public GitHub issue posted under your own GitHub
                        account
                      </span>
                      , so it carries your GitHub handle. It is pseudonymous,
                      not anonymous.
                    </p>
                    <p>
                      It contains{' '}
                      <span className="font-medium text-foreground">
                        only the data shown below
                      </span>{' '}
                      — your hardware specs, the model names you ran, and two
                      performance numbers per model. No file paths, prompts,
                      document content, or anything else is included.
                    </p>
                    <p>
                      Review the exact payload, then open GitHub to submit it
                      yourself. Notesage never posts on your behalf.
                    </p>
                  </div>

                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                      Exactly what will be shared
                    </div>
                    <ScrollArea className="max-h-64 rounded-md border border-border bg-muted">
                      <pre className="px-3 py-2.5 text-[12px] font-mono text-foreground whitespace-pre overflow-x-auto">
                        {share.markdown}
                      </pre>
                    </ScrollArea>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-[13px] text-muted-foreground">
                  No measurements yet. Run a local model a few times to gather
                  calibration data, then come back to share it.
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="px-7 py-4 border-t border-border shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            onClick={handleDontAskAgain}
            className="text-muted-foreground"
          >
            Don&apos;t ask again
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Maybe later
            </Button>
            <Button
              variant="outline"
              onClick={handleCopy}
              disabled={!hasData}
            >
              Copy as markdown
            </Button>
            <Button onClick={handleOpenGithub} disabled={!hasData}>
              Open GitHub to share
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
