import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { tauriApi } from "@/lib/tauri";
import { t } from "@/lib/i18n";
import { getPreparedAnalysis, segmentsFingerprint, type PreparedAnalysis } from "@/lib/speakers/analysis-cache";
import {
  applyNamesOnly,
  confirmIdentification,
  loadIdentifyContext,
  namesKeptFromBefore,
  rememberVoices,
  safeNameChanges,
  segmentsFromAnalysis,
  type IdentifyContext,
  type VoiceToRemember,
} from "@/lib/speakers/apply";
import { cleanName, isGenericLabel, namesToStore, sameName, unnamedSpeakerName } from "@/lib/speakers/display-names";
import { describeSpeakerError } from "@/lib/speakers/errors";
import { findIntroductions } from "@/lib/speakers/introductions";
import { SAME_SPEAKER_SHARE, matchLabels } from "@/lib/speakers/match-labels";
import {
  cancelSpeakerAnalysis,
  discardPreparedAnalysis,
  isAnalysisCancellation,
  matchRememberedVoices,
  runSpeakerAnalysis,
} from "@/lib/speakers/run-analysis";
import {
  formatParticipants,
  parseParticipants,
  rankSuggestions,
  type NameSuggestion,
} from "@/lib/speakers/suggestions";
import { SPEAKER_ME, speakerLabels, type Segment } from "@/lib/transcription/segments";
import { defaultSpeakerNames, writeSpeakers, type TranscriptWriteMode } from "@/lib/transcription/transcript-files";
import { useRecordingsStore, type RecordingBundle } from "@/stores/recordings-store";
import { openSpeakerSettings, useSpeakersStore, type SpeakerJob } from "@/stores/speakers-store";
import { ReplaceTranscriptDialog, type PendingTranscriptWrite } from "./ReplaceTranscriptDialog";
import { SpeakerRow } from "./SpeakerRow";

/** The backend accepts a hint of 1 to 30 voices (not counting the user's own microphone). */
export const MAX_EXPECTED_SPEAKERS = 30;

interface Field {
  value: string;
  /** The stored voice behind the suggestion that was clicked, while the name is still that suggestion's. */
  profileId?: string;
  /** `null` until the user touches the box: it then follows "has a name". */
  remember: boolean | null;
}

function openTranscript(path: string): void {
  const name = path.slice(path.lastIndexOf("/") + 1);
  window.dispatchEvent(new CustomEvent("notesage:open-file", { detail: { filePath: path, fileName: name } }));
}

function jobText(job: SpeakerJob): string {
  if (job.phase === "waiting") return t("speakers.waitingForTranscription");
  if (job.phase === "starting") return t("activity.starting");
  switch (job.stage) {
    case "loading":
      return t("speakers.stageLoading");
    case "finishing":
      return t("transcription.stageFinishing");
    default:
      return t("speakers.stageAnalyzing", { percent: job.percent });
  }
}

/**
 * "Identify speakers…": find the distinct voices in a recording, hear each,
 * and say who they are.
 *
 * Three screens, chosen by what exists for the recording rather than by a
 * step counter, so closing and reopening the dialog lands where things are:
 *  - no analysis yet: who was in the meeting (optional), how many voices
 *    (optional), then "Find voices";
 *  - an analysis is waiting or running: progress, and Cancel;
 *  - an analysis is done: the voices, each with a sample, its speaking time,
 *    a name field and suggestions.
 *
 * Nothing in the recording changes before "Save names". A suggestion is only
 * ever a chip; a voice is only remembered when its box is ticked and voices
 * are remembered at all. Voiceprints stay in memory and go to the backend's
 * profile store, never into the bundle.
 */
export function IdentifySpeakersDialog({
  bundle,
  onClose,
}: {
  bundle: RecordingBundle | null;
  onClose: () => void;
}) {
  const dir = bundle?.dir ?? null;
  const refresh = useRecordingsStore((s) => s.refresh);
  const job = useSpeakersStore((s) => (dir ? s.jobs[dir] : undefined));
  const jobError = useSpeakersStore((s) => (dir ? s.jobErrors[dir] : undefined));
  const preparedSummary = useSpeakersStore((s) => (dir ? s.prepared[dir] : undefined));
  const remember = useSpeakersStore((s) => s.rememberVoices);
  const modelsInstalled = useSpeakersStore((s) => s.modelsInstalled);
  const profiles = useSpeakersStore((s) => s.profiles);

  const [context, setContext] = useState<IdentifyContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [participantsText, setParticipantsText] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [sharedMicrophone, setSharedMicrophone] = useState(false);
  const [fields, setFields] = useState<Record<string, Field>>({});
  const [matches, setMatches] = useState<PreparedAnalysis["matches"]>(null);
  const [saving, setSaving] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<PendingTranscriptWrite | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clips = useRef(new Map<string, string>());
  const initialisedFor = useRef<number | null>(null);

  const twoTrack = bundle?.tracks !== null && bundle?.tracks !== undefined;
  // Read fresh on every render: the cache is not reactive, the summary in the store is.
  const analysis = dir && preparedSummary ? (getPreparedAnalysis(dir) ?? null) : null;

  // Opening: what the recording holds now, and whether the voice model is there.
  useEffect(() => {
    setContext(null);
    setLoadError(null);
    setFields({});
    setMatches(null);
    setPendingWrite(null);
    setPlaying(null);
    setLoadingSample(null);
    clips.current.clear();
    initialisedFor.current = null;
    if (!dir) return;
    let cancelled = false;
    void useSpeakersStore.getState().refreshModels();
    if (useSpeakersStore.getState().rememberVoices) void useSpeakersStore.getState().refreshProfiles();
    loadIdentifyContext(dir)
      .then((loaded) => {
        if (cancelled) return;
        setContext(loaded);
        const stored =
          loaded.participants.length > 0
            ? loaded.participants
            : // A Teams transcript's labels are the people who were there.
              speakerLabels(loaded.segments)
                .filter((label) => !isGenericLabel(label))
                .map((label) => loaded.names[label] ?? label);
        setParticipantsText(formatParticipants(stored));
        setExpectedText("");
        setSharedMicrophone(false);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeSpeakerError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [dir]);

  const newSegments = useMemo<Segment[]>(
    () => (analysis ? segmentsFromAnalysis(analysis.result.segments ?? []) : []),
    [analysis],
  );
  const kept = useMemo(
    () => (context && analysis ? namesKeptFromBefore(context.segments, newSegments, context.names).names : {}),
    [context, analysis, newSegments],
  );
  const introductions = useMemo(() => findIntroductions(newSegments), [newSegments]);

  // A finished analysis arrives (now, or it was waiting when the dialog opened):
  // set up the name fields ONCE for it. Only names the user gave before are
  // filled in; suggestions stay chips.
  useEffect(() => {
    if (!analysis || !context || !dir) return;
    if (initialisedFor.current === analysis.at) return;
    // Made for a transcript that has since been replaced (transcribed again,
    // here or on another Mac): its segments are not this transcript's.
    if (analysis.source !== segmentsFingerprint(context.segments)) {
      discardPreparedAnalysis(dir);
      return;
    }
    initialisedFor.current = analysis.at;
    const next: Record<string, Field> = {};
    for (const speaker of analysis.result.speakers) {
      next[speaker.label] = { value: kept[speaker.label] ?? "", remember: null };
    }
    setFields(next);
    setMatches(analysis.matches);
    setParticipantsText(formatParticipants(analysis.participants));
    // Voices were not remembered when it ran (or it ran in the background):
    // ask now, if the user has opted in since.
    if (analysis.matches === null && useSpeakersStore.getState().rememberVoices) {
      void matchRememberedVoices(analysis.result, analysis.participants).then((found) => {
        if (initialisedFor.current === analysis.at) setMatches(found);
      });
    }
  }, [analysis, context, kept, dir]);

  // Leaving the dialog stops the sample.
  useEffect(() => {
    if (!dir) audioRef.current?.pause();
  }, [dir]);

  const defaults = defaultSpeakerNames();
  const displayOf = useCallback(
    (label: string) => unnamedSpeakerName(label, defaultSpeakerNames()),
    [],
  );

  const run = () => {
    if (!bundle || !context || !bundle.audioPath) return;
    const participants = parseParticipants(participantsText);
    const expected = Number.parseInt(expectedText, 10);
    const expectedSpeakers =
      Number.isFinite(expected) && expected >= 1 ? Math.min(MAX_EXPECTED_SPEAKERS, expected) : null;
    const start = async () => {
      // Remembered per recording. This writes names and participants only;
      // the transcript and its segments are untouched.
      if (participants.length > 0 || context.participants.length > 0) {
        await writeSpeakers(bundle.dir, context.names, { participants });
      }
      await runSpeakerAnalysis({
        bundleDir: bundle.dir,
        audioPath: bundle.audioPath ?? "",
        tracks: bundle.tracks,
        segments: context.segments,
        participants,
        expectedSpeakers,
        sharedMicrophone: twoTrack && sharedMicrophone,
      });
    };
    void start().catch((err) => {
      // A cancel is the user's own doing; any other failure is shown in the
      // dialog from the store, and here only if it never reached the job.
      if (!isAnalysisCancellation(err) && !useSpeakersStore.getState().jobErrors[bundle.dir]) {
        useSpeakersStore.getState().setJobError(bundle.dir, String(err).replace(/^Error:\s*/, ""));
      }
    });
  };

  const cancel = () => {
    if (!dir) return;
    void cancelSpeakerAnalysis(dir).catch((err) =>
      toast.error(t("speakers.cancelFailed", { error: describeSpeakerError(err) })),
    );
  };

  const analyseAgain = () => {
    if (!dir) return;
    audioRef.current?.pause();
    discardPreparedAnalysis(dir);
    initialisedFor.current = null;
    setFields({});
  };

  const toggleSample = async (label: string) => {
    const audio = audioRef.current;
    const speaker = analysis?.result.speakers.find((s) => s.label === label);
    if (!audio || !speaker) return;
    if (playing === label) {
      audio.pause();
      setPlaying(null);
      return;
    }
    audio.pause();
    setPlaying(null);
    try {
      let src = clips.current.get(label);
      if (!src) {
        setLoadingSample(label);
        const clip = await tauriApi.extractAudioClip(speaker.sample.track_path, speaker.sample.start, speaker.sample.end);
        src = convertFileSrc(clip.path);
        clips.current.set(label, src);
      }
      audio.src = src;
      setLoadingSample(null);
      setPlaying(label);
      await audio.play();
    } catch (err) {
      setLoadingSample(null);
      setPlaying(null);
      toast.error(t("speakers.sampleFailed", { error: describeSpeakerError(err) }));
    }
  };

  const setValue = (label: string, value: string) =>
    setFields((current) => {
      const field = current[label] ?? { value: "", remember: null };
      // Typing something else lets go of the stored voice a clicked suggestion pointed at.
      return { ...current, [label]: { ...field, value, profileId: undefined } };
    });

  const pick = (label: string, suggestion: NameSuggestion) =>
    setFields((current) => {
      const field = current[label] ?? { value: "", remember: null };
      return { ...current, [label]: { ...field, value: suggestion.name, profileId: suggestion.profileId } };
    });

  const namedLabels = analysis?.result.speakers.map((s) => s.label) ?? [];
  const typed = namedLabels.map((label) => ({ label, value: fields[label]?.value ?? "" }));
  const names = namesToStore(typed, defaults);

  const isRemembered = (label: string): boolean => {
    const field = fields[label];
    if (!field) return false;
    return field.remember ?? Boolean(names[label]);
  };

  const rememberDisabledReason = (label: string, hasVoiceprint: boolean): string | null => {
    if (!hasVoiceprint) return t("speakers.rememberTooLittle");
    if (label !== SPEAKER_ME && !names[label]) return t("speakers.rememberNeedsName");
    return null;
  };

  // The fallback for an edited transcript: name changes that can be made in
  // its text without regenerating it.
  const namesOnly = useMemo(() => {
    if (!context || !analysis || !context.transcript || context.transcript.edited === false) return null;
    const strict = matchLabels(context.segments, newSegments, SAME_SPEAKER_SHARE);
    const safe = safeNameChanges(strict, context.names, names);
    return safe.changes.length > 0 ? safe : null;
    // `names` is derived from `fields`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, analysis, newSegments, fields]);

  const finish = async (toastText: string, transcriptPath: string | null) => {
    if (!bundle || !analysis) return;
    let text = toastText;
    if (useSpeakersStore.getState().rememberVoices) {
      const voices: VoiceToRemember[] = [];
      for (const speaker of analysis.result.speakers) {
        if (!isRemembered(speaker.label)) continue;
        if (rememberDisabledReason(speaker.label, speaker.embedding.length > 0) !== null) continue;
        voices.push({ speaker, name: names[speaker.label] ?? "", profileId: fields[speaker.label]?.profileId });
      }
      if (voices.length > 0) {
        const outcome = await rememberVoices(voices, {
          bundleDir: bundle.dir,
          model: analysis.result.model,
          knownProfiles: profiles,
        });
        if (outcome.saved.length > 0) {
          text = `${text} ${t("speakers.remembered", { count: outcome.saved.length })}`;
        }
        for (const failure of outcome.failed) {
          toast.error(t("speakers.rememberFailed", { name: failure.name, error: describeSpeakerError(failure.error) }));
        }
        void useSpeakersStore.getState().refreshProfiles();
      }
    }
    // The voiceprints have done their work: drop them from memory.
    discardPreparedAnalysis(bundle.dir);
    refresh();
    toast.success(
      text,
      transcriptPath
        ? { action: { label: t("recordings.openTranscript"), onClick: () => openTranscript(transcriptPath) } }
        : undefined,
    );
    onClose();
  };

  const write = async (mode?: TranscriptWriteMode) => {
    if (!bundle || !analysis || saving) return;
    setSaving(true);
    try {
      const written = await confirmIdentification({
        bundleDir: bundle.dir,
        segments: newSegments,
        names,
        participants: analysis.participants,
        mode,
      });
      await finish(written.keptBoth ? t("speakers.savedBeside") : t("speakers.saved"), written.path);
    } catch (err) {
      toast.error(t("recordings.speakersFailed", { error: describeSpeakerError(err) }));
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!bundle || !context || !analysis || saving) return;
    const transcript = context.transcript;
    if (!transcript) {
      void write(undefined);
    } else if (transcript.edited === false) {
      // Nobody has typed in it: regenerating loses nothing.
      void write("replace");
    } else {
      // Edited by hand, or cannot be known: the user decides.
      setPendingWrite({ title: bundle.title, edited: transcript.edited, run: (mode) => void write(mode) });
    }
  };

  const saveNamesOnly = async () => {
    if (!bundle || !analysis || !namesOnly || saving) return;
    setSaving(true);
    try {
      const count = await applyNamesOnly(bundle.dir, namesOnly.names, namesOnly.changes, analysis.participants);
      await finish(t("recordings.namesReplaced", { count }), context?.transcript?.path ?? null);
    } catch (err) {
      toast.error(t("recordings.speakersFailed", { error: describeSpeakerError(err) }));
    } finally {
      setSaving(false);
    }
  };

  const view: "loading" | "error" | "no-segments" | "model" | "running" | "results" | "setup" = !context
    ? loadError
      ? "error"
      : "loading"
    : job
      ? "running"
      : analysis
        ? "results"
        : context.segments.length === 0
          ? "no-segments"
          : modelsInstalled === false
            ? "model"
            : "setup";

  const takenBy = (label: string): string[] =>
    typed.filter((field) => field.label !== label).map((field) => cleanName(field.value)).filter(Boolean);

  return (
    <>
      <Dialog open={bundle !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-[640px]" data-testid="identify-speakers-dialog" data-view={view}>
          <DialogHeader>
            <DialogTitle>{t("speakers.identifyTitle")}</DialogTitle>
            <DialogDescription>
              {view === "results"
                ? t("speakers.resultsHint", { title: bundle?.title ?? "" })
                : t("speakers.identifyHint", { title: bundle?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>

          {/* One polite live region: the state of the job, never its ticking percent. */}
          <p className="sr-only" role="status" aria-live="polite" data-testid="identify-live">
            {view === "running" && job
              ? job.phase === "waiting"
                ? t("speakers.waitingForTranscription")
                : t("speakers.analysing")
              : view === "results" && analysis
                ? t("speakers.voicesFound", { count: analysis.result.speakers.length })
                : ""}
          </p>

          {view === "loading" && <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>}

          {view === "error" && (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              {loadError}
            </p>
          )}

          {view === "no-segments" && (
            <p className="py-2 text-sm text-muted-foreground" data-testid="identify-no-segments">
              {t("speakers.noSegments")}
            </p>
          )}

          {view === "model" && (
            <div className="flex flex-col gap-3 text-sm" data-testid="identify-model-missing">
              <p>{t("speakers.modelNeeded")}</p>
              <div>
                <Button
                  type="button"
                  onClick={() => {
                    openSpeakerSettings();
                    onClose();
                  }}
                >
                  {t("speakers.openSettings")}
                </Button>
              </div>
            </div>
          )}

          {view === "setup" && (
            <form
              id="identify-setup"
              // The number is clamped here; the browser's own validation bubble
              // would be in the system's language, not the app's.
              noValidate
              className="flex flex-col gap-4 text-sm"
              onSubmit={(event) => {
                event.preventDefault();
                run();
              }}
            >
              {jobError && (
                <p role="alert" className="flex items-start gap-2 text-destructive" data-testid="identify-error">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  <span className="break-words">{describeSpeakerError(jobError)}</span>
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="identify-participants">{t("speakers.participants")}</Label>
                <Textarea
                  id="identify-participants"
                  rows={2}
                  value={participantsText}
                  placeholder={t("speakers.participantsPlaceholder")}
                  aria-describedby="identify-participants-hint"
                  onChange={(event) => setParticipantsText(event.target.value)}
                />
                <p id="identify-participants-hint" className="text-xs text-muted-foreground">
                  {t("speakers.participantsHint")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Label htmlFor="identify-expected">{t("speakers.expected")}</Label>
                <Input
                  id="identify-expected"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_EXPECTED_SPEAKERS}
                  value={expectedText}
                  placeholder={t("speakers.expectedPlaceholder")}
                  aria-describedby="identify-expected-hint"
                  className="h-8 w-28 tabular-nums"
                  onChange={(event) => setExpectedText(event.target.value)}
                />
                <p id="identify-expected-hint" className="basis-full text-xs text-muted-foreground">
                  {twoTrack ? t("speakers.expectedHintTwoTrack") : t("speakers.expectedHint")}
                </p>
              </div>
              {twoTrack && (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="identify-shared-mic"
                    checked={sharedMicrophone}
                    onCheckedChange={(state) => setSharedMicrophone(state === true)}
                    aria-describedby="identify-shared-mic-hint"
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <Label htmlFor="identify-shared-mic" className="font-normal">
                      {t("speakers.sharedMicrophone")}
                    </Label>
                    <p id="identify-shared-mic-hint" className="text-xs text-muted-foreground">
                      {t("speakers.sharedMicrophoneHint")}
                    </p>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t("speakers.timeHint")}</p>
            </form>
          )}

          {view === "running" && job && (
            <div className="flex flex-col gap-2 py-2 text-sm" data-testid="identify-progress" data-phase={job.phase}>
              <div className="flex items-center gap-2 text-muted-foreground">
                {job.phase !== "running" && (
                  <Loader2
                    className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                )}
                <span className="tabular-nums">{jobText(job)}</span>
              </div>
              <Progress
                value={job.phase === "running" ? job.percent : null}
                className="h-1.5"
                aria-label={t("speakers.progressLabel", { title: bundle?.title ?? "" })}
              />
              <p className="text-xs text-muted-foreground">{t("speakers.runsInBackground")}</p>
            </div>
          )}

          {view === "results" && analysis && (
            <div className="flex min-h-0 flex-col gap-3 text-sm">
              {analysis.result.speakers.length === 0 ? (
                <p className="py-2 text-muted-foreground" data-testid="identify-none">
                  {t("speakers.noVoices")}
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground" data-testid="identify-count">
                    {t("speakers.voicesFound", { count: analysis.result.speakers.length })}
                    {twoTrack && !analysis.sharedMicrophone ? ` ${t("speakers.meIsMicrophone")}` : ""}
                  </p>
                  <ul
                    className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1"
                    aria-label={t("speakers.voicesList")}
                    data-testid="identify-voices"
                  >
                    {analysis.result.speakers.map((speaker, index) => {
                      const label = speaker.label;
                      const displayName = displayOf(label);
                      const field = fields[label] ?? { value: "", remember: null };
                      const suggestions = rankSuggestions({
                        candidates: remember ? (matches?.find((m) => m.label === label)?.candidates ?? []) : [],
                        introductions: introductions.filter((intro) => intro.speaker === label),
                        participants: analysis.participants,
                        takenNames: takenBy(label),
                      });
                      const canPlay = speaker.sample.end > speaker.sample.start && Boolean(speaker.sample.track_path);
                      return (
                        <SpeakerRow
                          key={label}
                          index={index}
                          displayName={displayName}
                          totalSecs={speaker.total_secs}
                          value={field.value}
                          kept={Boolean(kept[label]) && sameName(field.value, kept[label] ?? "")}
                          onValueChange={(value) => setValue(label, value)}
                          suggestions={suggestions}
                          onPick={(suggestion) => pick(label, suggestion)}
                          sample={
                            !canPlay
                              ? "unavailable"
                              : loadingSample === label
                                ? "loading"
                                : playing === label
                                  ? "playing"
                                  : "idle"
                          }
                          onToggleSample={() => void toggleSample(label)}
                          remember={
                            remember
                              ? {
                                  checked: isRemembered(label),
                                  disabledReason: rememberDisabledReason(label, speaker.embedding.length > 0),
                                  onChange: (checked) =>
                                    setFields((current) => ({
                                      ...current,
                                      [label]: { ...(current[label] ?? { value: "" }), remember: checked },
                                    })),
                                }
                              : undefined
                          }
                        />
                      );
                    })}
                  </ul>
                  <p className="text-xs text-muted-foreground" data-testid="identify-privacy">
                    {remember ? t("speakers.resultsPrivacyOn") : t("speakers.resultsPrivacyOff")}
                  </p>
                  {namesOnly && (
                    <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground" data-testid="identify-edited">
                      {t("speakers.editedHint")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Plays the sample clips. Rendered always so the ref is there; it has no controls and no visible box. */}
          <audio
            ref={audioRef}
            className="hidden"
            preload="none"
            onEnded={() => setPlaying(null)}
            onError={() => setPlaying(null)}
            data-testid="speaker-audio"
          />

          <DialogFooter className="flex-wrap gap-y-2">
            {view === "results" && (
              <Button type="button" variant="ghost" className="sm:mr-auto" disabled={saving} onClick={analyseAgain}>
                {t("speakers.analyseAgain")}
              </Button>
            )}
            {view === "running" ? (
              <>
                <Button type="button" variant="outline" onClick={onClose} data-testid="identify-close">
                  {t("common.close")}
                </Button>
                <Button type="button" variant="outline" onClick={cancel} data-testid="identify-cancel">
                  {t("speakers.cancelAnalysis")}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={onClose}>
                {view === "setup" || view === "results" ? t("common.cancel") : t("common.close")}
              </Button>
            )}
            {view === "setup" && (
              <Button type="submit" form="identify-setup" data-testid="identify-run">
                {t("speakers.findVoices")}
              </Button>
            )}
            {view === "results" && namesOnly && (
              <Button type="button" variant="outline" disabled={saving} onClick={() => void saveNamesOnly()}>
                {t("recordings.updateNamesInText")}
              </Button>
            )}
            {view === "results" && analysis && analysis.result.speakers.length > 0 && (
              <Button type="button" disabled={saving} onClick={save} data-testid="identify-save">
                {t("recordings.saveNames")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReplaceTranscriptDialog pending={pendingWrite} onClose={() => setPendingWrite(null)} />
    </>
  );
}
