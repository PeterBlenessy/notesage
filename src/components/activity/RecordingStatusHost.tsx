import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useRecordingStore } from '@/stores/recording-store';
import { discardMeetingRecording } from '@/hooks/useMeetingRecording';
import { formatRecordedTime } from '@/lib/recording-time';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';
import { log } from '@/lib/logger';
import { RecordingIndicator } from './RecordingIndicator';

/**
 * The parts of the recording UI that must exist exactly once and must not
 * depend on which surface happens to be mounted: mounted with the orb (always
 * present in the layout, command bar pinned or not).
 *
 *  - The floating indicator chip (see `RecordingIndicator`).
 *  - The live region. Announces STATE CHANGES only — started, paused,
 *    resumed, saving, saved, discarded, and warnings — never the timer.
 *  - The one confirmation: discarding, the only action that deletes audio.
 *    Stopping never asks: it saves.
 */
export function RecordingStatusHost() {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const announcement = useRecordingStore((s) => s.announcement);
  const discardOpen = useRecordingStore((s) => s.discardConfirmOpen);
  // Read when a dialog opens; not subscribed, so the once-a-second tick does
  // not re-render this host.
  const recorded = () => formatRecordedTime(useRecordingStore.getState().recordedSeconds);

  return (
    <>
      <RecordingIndicator variant="floating" />

      <div role="status" aria-live="polite" data-recording-announcer className="sr-only">
        {/* A zero-width space on every other announcement, so the same
            sentence twice in a row (pause, resume, pause) is still a change. */}
        {announcement.text ? `${announcement.text}${announcement.seq % 2 === 0 ? '' : '​'}` : ''}
      </div>

      <AlertDialog
        open={discardOpen}
        onOpenChange={(open) => useRecordingStore.getState().setDiscardConfirmOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("recording.discardConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {discardOpen ? t("recording.discardConfirm.body", { time: recorded() }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("recording.discardConfirm.keep")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void discardMeetingRecording().catch((err) =>
                  log.warn('recording', 'Discard failed', err),
                );
              }}
            >
              {t("recording.discardRecording")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
