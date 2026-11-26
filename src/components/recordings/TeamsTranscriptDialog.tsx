import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Minus, Plus } from "lucide-react";

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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { t } from "@/lib/i18n";
import { basename, readRecordingManifest, transcriptFileOf } from "@/lib/transcription/bundle";
import { formatTimestamp, type Segment } from "@/lib/transcription/segments";
import {
  cueSpeakers,
  estimateOffset,
  previewAlignment,
  type Cue,
} from "@/lib/transcription/teams-transcript";
import {
  attachTeamsTranscript,
  readSegments,
  readTeamsTranscript,
} from "@/lib/transcription/transcript-files";
import { useRecordingsStore, type RecordingBundle } from "@/stores/recordings-store";
import {
  ReplaceTranscriptDialog,
  guardTranscriptWrite,
  type PendingTranscriptWrite,
} from "./ReplaceTranscriptDialog";

/** Below this the estimate is shown as uncertain and the offset controls open by default. */
export const LOW_CONFIDENCE = 0.5;

export interface TeamsRequest {
  bundle: RecordingBundle;
  /** The `.vtt` / `.docx` the user picked. */
  sourcePath: string;
}

interface Loaded {
  cues: Cue[];
  ours: Segment[];
  estimatedOffset: number;
  confidence: number;
}

function openTranscript(path: string): void {
  window.dispatchEvent(
    new CustomEvent("notesage:open-file", { detail: { filePath: path, fileName: basename(path) } }),
  );
}

/** `37` → "0:37", `-95.5` → "1:35" (the sign is carried by the sentence around it). */
function clock(secs: number): string {
  const total = Math.round(Math.abs(secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The confirmation shown after picking a Teams transcript for a recording:
 * who Teams heard, how the two transcripts line up in time and how sure that
 * is, and whose text to keep.
 *
 * When the alignment is uncertain the offset can be nudged by the second,
 * with a few lines of the two transcripts side by side that move as it does:
 * if the lines say the same thing, the offset is right.
 */
export function TeamsTranscriptDialog({
  request,
  onClose,
}: {
  request: TeamsRequest | null;
  onClose: () => void;
}) {
  const refresh = useRecordingsStore((s) => s.refresh);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [use, setUse] = useState<"names" | "text">("names");
  const [adjusting, setAdjusting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<PendingTranscriptWrite | null>(null);

  useEffect(() => {
    setLoaded(null);
    setError(null);
    setPendingWrite(null);
    if (!request) return;
    let cancelled = false;
    void (async () => {
      const manifest = await readRecordingManifest(request.bundle.dir);
      const [cues, { segments }] = await Promise.all([
        readTeamsTranscript(request.sourcePath),
        readSegments(request.bundle.dir, transcriptFileOf(manifest)),
      ]);
      if (cancelled) return;
      if (cues.length === 0) {
        setError(t("recordings.teamsEmpty"));
        return;
      }
      const estimate = segments.length > 0 ? estimateOffset(segments, cues) : { offsetSecs: 0, confidence: 0 };
      setLoaded({ cues, ours: segments, estimatedOffset: estimate.offsetSecs, confidence: estimate.confidence });
      setOffset(estimate.offsetSecs);
      setUse(segments.length > 0 ? "names" : "text");
      setAdjusting(segments.length > 0 && estimate.confidence < LOW_CONFIDENCE);
    })().catch((err) => {
      if (!cancelled) setError(t("recordings.teamsReadFailed", { error: String(err).replace(/^Error:\s*/, "") }));
    });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const speakers = useMemo(() => (loaded ? cueSpeakers(loaded.cues) : []), [loaded]);
  const preview = useMemo(
    () => (loaded && loaded.ours.length > 0 ? previewAlignment(loaded.ours, loaded.cues, offset, 3) : []),
    [loaded, offset],
  );
  const hasOurs = (loaded?.ours.length ?? 0) > 0;
  const low = hasOurs && (loaded?.confidence ?? 0) < LOW_CONFIDENCE;

  const add = async () => {
    if (!request || !loaded || saving) return;
    const { bundle, sourcePath } = request;
    const write = async (mode?: "replace" | "keep-both") => {
      setSaving(true);
      try {
        const written = await attachTeamsTranscript({
          bundleDir: bundle.dir,
          sourcePath,
          cues: loaded.cues,
          offsetSecs: offset,
          use,
          mode,
        });
        refresh();
        toast.success(t("recordings.teamsAdded", { title: bundle.title }), {
          action: { label: t("recordings.openTranscript"), onClick: () => openTranscript(written.path) },
        });
        onClose();
      } catch (err) {
        toast.error(t("recordings.teamsFailed", { error: String(err).replace(/^Error:\s*/, "") }));
      } finally {
        setSaving(false);
      }
    };
    setPendingWrite(await guardTranscriptWrite(bundle.dir, bundle.title, (mode) => void write(mode)));
  };

  const nudge = (delta: number) => setOffset((current) => Math.round((current + delta) * 10) / 10);

  return (
    <>
      <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-[520px]" data-testid="teams-dialog">
          <DialogHeader>
            <DialogTitle>{t("recordings.teamsTitle")}</DialogTitle>
            <DialogDescription>
              {request ? t("recordings.teamsFor", { file: basename(request.sourcePath), title: request.bundle.title }) : ""}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive" data-testid="teams-error">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              {error}
            </p>
          ) : !loaded ? (
            <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                <dt className="text-muted-foreground">{t("recordings.speakers")}</dt>
                <dd data-testid="teams-speakers">
                  {speakers.length > 0 ? speakers.join(", ") : t("recordings.teamsNoSpeakers")}
                </dd>
                {hasOurs && (
                  <>
                    <dt className="text-muted-foreground">{t("recordings.teamsAlignment")}</dt>
                    <dd data-testid="teams-offset">
                      {Math.abs(offset) < 0.5
                        ? t("recordings.teamsOffsetNone")
                        : offset > 0
                          ? t("recordings.teamsOffsetLater", { time: clock(offset) })
                          : t("recordings.teamsOffsetEarlier", { time: clock(offset) })}
                      <span className={low ? "ml-2 text-destructive" : "ml-2 text-muted-foreground"} data-testid="teams-confidence">
                        {low
                          ? t("recordings.teamsConfidenceLow")
                          : t("recordings.teamsConfidence", { percent: Math.round(loaded.confidence * 100) })}
                      </span>
                    </dd>
                  </>
                )}
              </dl>

              {!hasOurs && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {t("recordings.teamsNoOwnTranscript")}
                </p>
              )}
              {speakers.length === 0 && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {t("recordings.teamsNoSpeakersHint")}
                </p>
              )}

              {hasOurs && (
                <RadioGroup value={use} onValueChange={(value) => setUse(value === "text" ? "text" : "names")} className="gap-2">
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="names" id="teams-use-names" className="mt-0.5" />
                    <Label htmlFor="teams-use-names" className="font-normal leading-snug">
                      {t("recordings.teamsUseNames")}
                    </Label>
                  </div>
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="text" id="teams-use-text" className="mt-0.5" />
                    <Label htmlFor="teams-use-text" className="font-normal leading-snug">
                      {t("recordings.teamsUseText")}
                    </Label>
                  </div>
                </RadioGroup>
              )}

              {hasOurs && (
                <div className="flex flex-col gap-2">
                  {low && (
                    <p className="text-xs text-muted-foreground">{t("recordings.teamsLowHint")}</p>
                  )}
                  {adjusting ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="teams-offset-input" className="text-xs text-muted-foreground">
                          {t("recordings.teamsOffsetLabel")}
                        </Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          className="h-7 w-7"
                          aria-label={t("recordings.teamsOffsetMinus")}
                          onClick={() => nudge(-1)}
                        >
                          <Minus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                        </Button>
                        <Input
                          id="teams-offset-input"
                          type="number"
                          step={0.5}
                          value={offset}
                          className="h-7 w-24 tabular-nums"
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (Number.isFinite(next)) setOffset(next);
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          className="h-7 w-7"
                          aria-label={t("recordings.teamsOffsetPlus")}
                          onClick={() => nudge(1)}
                        >
                          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                        </Button>
                        {offset !== loaded.estimatedOffset && (
                          <Button type="button" variant="ghost" size="xs" onClick={() => setOffset(loaded.estimatedOffset)}>
                            {t("recordings.teamsOffsetReset")}
                          </Button>
                        )}
                      </div>
                      <ul
                        className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-md border border-border p-2 text-xs"
                        aria-label={t("recordings.teamsPreview")}
                        data-testid="teams-preview"
                      >
                        {preview.map((line, i) => (
                          <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                            <span className="row-span-2 font-mono text-muted-foreground tabular-nums">
                              {formatTimestamp(line.at)}
                            </span>
                            <span>
                              <span className="text-muted-foreground">{t("recordings.teamsPreviewTeams")} </span>
                              {line.speaker ? `${line.speaker}: ` : ""}
                              {line.teams}
                            </span>
                            <span>
                              <span className="text-muted-foreground">{t("recordings.teamsPreviewOurs")} </span>
                              {line.ours || t("recordings.teamsPreviewNothing")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <Button type="button" variant="ghost" size="xs" className="self-start" onClick={() => setAdjusting(true)}>
                      {t("recordings.teamsAdjust")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {error ? t("common.close") : t("common.cancel")}
            </Button>
            {!error && (
              <Button type="button" disabled={!loaded || saving} onClick={() => void add()}>
                {t("recordings.teamsAdd")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReplaceTranscriptDialog pending={pendingWrite} onClose={() => setPendingWrite(null)} />
    </>
  );
}
