import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { inspectTranscript, type TranscriptWriteMode } from "@/lib/transcription/transcript-files";

/** A write that is waiting for the user to say what happens to the transcript already there. */
export interface PendingTranscriptWrite {
  /** The recording's name, for the dialog's title. */
  title: string;
  /**
   * Has the existing transcript been edited since it was generated? `null`
   * when that cannot be known (it predates the record of it).
   */
  edited: boolean | null;
  run: (mode: TranscriptWriteMode) => void;
}

/**
 * Run `run` now if the bundle has no transcript; otherwise hand back what the
 * dialog needs to ask first. Nothing that produces a transcript calls its
 * writer without going through this.
 */
export async function guardTranscriptWrite(
  bundleDir: string,
  title: string,
  run: (mode?: TranscriptWriteMode) => void,
): Promise<PendingTranscriptWrite | null> {
  const existing = await inspectTranscript(bundleDir).catch(() => null);
  if (!existing) {
    run(undefined);
    return null;
  }
  return { title, edited: existing.edited, run };
}

/**
 * "This recording already has a transcript": Replace, Keep both, or Cancel.
 * Says so when the existing one has been edited by hand, because that is the
 * case where Replace loses work.
 */
export function ReplaceTranscriptDialog({
  pending,
  onClose,
}: {
  pending: PendingTranscriptWrite | null;
  onClose: () => void;
}) {
  const choose = (mode: TranscriptWriteMode) => {
    pending?.run(mode);
    onClose();
  };
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="replace-transcript-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("transcription.replaceTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("transcription.replaceBody", { title: pending?.title ?? "" })}
            {pending?.edited === true && (
              <span className="mt-2 block font-medium text-foreground" data-testid="replace-transcript-edited">
                {t("transcription.replaceEdited")}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <Button variant="outline" onClick={() => choose("keep-both")}>
            {t("transcription.keepBoth")}
          </Button>
          <AlertDialogAction
            variant={pending?.edited === true ? "destructive" : "default"}
            onClick={() => choose("replace")}
          >
            {t("transcription.replace")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
