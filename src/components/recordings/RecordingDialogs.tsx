import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { transcriptFileOf, readRecordingManifest } from "@/lib/transcription/bundle";
import { compareLabels, namesToStore } from "@/lib/speakers/display-names";
import { speakerDisplayName, speakerLabels, type SpeakerNames } from "@/lib/transcription/segments";
import {
  defaultSpeakerNames,
  readSegments,
  readSpeakers,
  renameSpeakers,
  replaceNamesInTranscript,
} from "@/lib/transcription/transcript-files";
import { useRecordingsStore, type RecordingBundle } from "@/stores/recordings-store";

/**
 * Give a recording a name. The name becomes the transcript note's title; the
 * folder on disk keeps its timestamp.
 */
export function RenameRecordingDialog({
  bundle,
  onClose,
}: {
  bundle: RecordingBundle | null;
  onClose: () => void;
}) {
  const rename = useRecordingsStore((s) => s.rename);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bundle) setValue(bundle.title);
  }, [bundle]);

  const submit = async () => {
    if (!bundle || saving) return;
    setSaving(true);
    try {
      await rename(bundle.dir, value);
      onClose();
    } catch (err) {
      toast.error(t("recordings.renameFailed", { error: String(err) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={bundle !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[480px]" data-testid="rename-recording-dialog">
        <DialogHeader>
          <DialogTitle>{t("recordings.renameTitle")}</DialogTitle>
          <DialogDescription>{t("recordings.renameHint")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="recording-title" className="sr-only">
            {t("recordings.nameLabel")}
          </Label>
          <Input
            id="recording-title"
            autoFocus
            value={value}
            maxLength={120}
            placeholder={bundle?.name}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {t("recordings.rename")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Move ‘Weekly sync’ to the Trash?" — names the recording, and says it can be recovered. */
export function DeleteRecordingDialog({
  bundle,
  onClose,
}: {
  bundle: RecordingBundle | null;
  onClose: () => void;
}) {
  const remove = useRecordingsStore((s) => s.remove);
  return (
    <AlertDialog open={bundle !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="delete-recording-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("recordings.deleteTitle", { title: bundle?.title ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {bundle?.transcriptPath ? t("recordings.deleteBodyWithTranscript") : t("recordings.deleteBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (!bundle) return;
              const title = bundle.title;
              void remove(bundle.dir)
                .then(() => toast.success(t("recordings.deleted", { title })))
                .catch((err) => toast.error(t("recordings.deleteFailed", { error: String(err).replace(/^Error:\s*/, "") })));
              onClose();
            }}
          >
            {t("recordings.moveToTrash")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface SpeakerField {
  label: string;
  /** What the transcript shows for this speaker right now. */
  before: string;
  value: string;
}

/**
 * Rename the speakers of a recording.
 *
 * A transcript nobody has touched is regenerated from its segments with the
 * new names. One that has been edited is not regenerated (that would discard
 * the edits); instead the dialog offers to swap the names where turns begin,
 * and says that is all it will do.
 */
export function SpeakersDialog({
  bundle,
  onClose,
}: {
  bundle: RecordingBundle | null;
  onClose: () => void;
}) {
  const refresh = useRecordingsStore((s) => s.refresh);
  const [fields, setFields] = useState<SpeakerField[] | null>(null);
  const [saving, setSaving] = useState(false);
  /** Set after a save that could not regenerate: the name changes waiting for "Update names in text". */
  const [pending, setPending] = useState<Array<{ from: string; to: string }> | null>(null);

  useEffect(() => {
    setFields(null);
    setPending(null);
    if (!bundle) return;
    let cancelled = false;
    void (async () => {
      const manifest = await readRecordingManifest(bundle.dir);
      const [{ segments }, names] = await Promise.all([
        readSegments(bundle.dir, transcriptFileOf(manifest)),
        readSpeakers(bundle.dir),
      ]);
      if (cancelled) return;
      const defaults = defaultSpeakerNames();
      const labels = [...new Set([...speakerLabels(segments), ...Object.keys(names)])].sort(
        // Voices found by analysis in their own order (Speaker 2 before Speaker 10);
        // everything else stays in order of first appearance.
        (a, b) => (/^speaker-\d+$/.test(a) && /^speaker-\d+$/.test(b) ? compareLabels(a, b) : 0),
      );
      setFields(
        labels.map((label) => {
          const shown = speakerDisplayName(label, names, defaults);
          return { label, before: shown, value: shown };
        }),
      );
    })().catch(() => {
      if (!cancelled) setFields([]);
    });
    return () => {
      cancelled = true;
    };
  }, [bundle]);

  const save = async () => {
    if (!bundle || !fields || saving) return;
    setSaving(true);
    try {
      // A name equal to the built-in default ("Me", "Speaker 2") is not
      // stored, so it keeps following the app language.
      const names: SpeakerNames = namesToStore(fields, defaultSpeakerNames());
      const result = await renameSpeakers(bundle.dir, names);
      refresh();
      const changes = fields
        .map((field) => ({ from: field.before, to: field.value.replace(/\s+/g, " ").trim() || field.before }))
        .filter((change) => change.from !== change.to);
      if (result.edited && changes.length > 0) {
        setPending(changes);
        return;
      }
      toast.success(result.rewritten ? t("recordings.speakersUpdated") : t("recordings.speakersSaved"));
      onClose();
    } catch (err) {
      toast.error(t("recordings.speakersFailed", { error: String(err) }));
    } finally {
      setSaving(false);
    }
  };

  const updateText = async () => {
    if (!bundle || !pending) return;
    setSaving(true);
    try {
      const count = await replaceNamesInTranscript(bundle.dir, pending);
      toast.success(t("recordings.namesReplaced", { count }));
      refresh();
      onClose();
    } catch (err) {
      toast.error(t("recordings.speakersFailed", { error: String(err) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={bundle !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[480px]" data-testid="speakers-dialog">
        <DialogHeader>
          <DialogTitle>{t("recordings.speakersTitle")}</DialogTitle>
          <DialogDescription>
            {pending ? t("recordings.speakersEditedBody") : t("recordings.speakersHint")}
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("recordings.leaveTextAlone")}
            </Button>
            <Button type="button" disabled={saving} onClick={() => void updateText()}>
              {t("recordings.updateNamesInText")}
            </Button>
          </DialogFooter>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {fields === null ? (
              <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : fields.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground" data-testid="speakers-none">
                {t("recordings.speakersNone")}
              </p>
            ) : (
              <div className="flex max-h-72 flex-col gap-3 overflow-y-auto py-1 pr-1">
                {fields.map((field, index) => (
                  <div key={field.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3">
                    <Label htmlFor={`speaker-${index}`} className="truncate text-xs text-muted-foreground" title={field.before}>
                      {field.before}
                    </Label>
                    <Input
                      id={`speaker-${index}`}
                      value={field.value}
                      maxLength={80}
                      aria-label={t("recordings.speakerNameFor", { name: field.before })}
                      onChange={(event) =>
                        setFields((current) =>
                          (current ?? []).map((f) => (f.label === field.label ? { ...f, value: event.target.value } : f)),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            )}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={saving || !fields || fields.length === 0}>
                {t("recordings.saveNames")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
