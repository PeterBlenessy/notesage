import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, Download, MoreHorizontal, RotateCw, Trash2, X } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { getFormatLocale, t } from "@/lib/i18n";
import { tauriApi, type VoiceProfileSummary } from "@/lib/tauri";
import { useLocale } from "@/lib/useLocale";
import { describeSpeakerError } from "@/lib/speakers/errors";
import { formatBytes } from "@/lib/transcription/format";
import { IMPORT_EXTENSIONS } from "@/stores/recordings-store";
import { useRecordingStore, type DownloadState } from "@/stores/recording-store";
import { SPEAKERS_SETTINGS_SECTION_ID, useSpeakersStore } from "@/stores/speakers-store";

/** How long the "record my voice" sample runs before it stops by itself. */
export const ENROL_RECORD_SECS = 15;

const CARD = "rounded-lg border border-border px-4 py-3";

/**
 * "12 of 25 MB · 4.1 MB/s", in the words the transcription models' rows use.
 * (Not imported from `TranscriptionSettings`: that file mounts this one.)
 */
function downloadProgressText(download: DownloadState): string {
  const mb = (bytes: number) => String(Math.max(0, Math.round(bytes / (1024 * 1024))));
  const done = download.downloadedBytes ?? 0;
  const total = download.totalBytes ?? 0;
  const parts = [
    total > 0
      ? t("settings.transcription.mbOfTotal", { done: mb(done), total: mb(total) })
      : t("settings.transcription.mbDone", { done: mb(done) }),
  ];
  const speed = (download.bytesPerSec ?? 0) / (1024 * 1024);
  if (speed > 0) {
    parts.push(t("settings.transcription.speed", { speed: speed >= 10 ? speed.toFixed(0) : speed.toFixed(1) }));
  }
  return parts.join(" · ");
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(getFormatLocale(), { dateStyle: "medium" });
}

function sourceText(profile: VoiceProfileSummary): string {
  const kinds = [...new Set(profile.sources.map((source) => source.kind))];
  const words = kinds.map((kind) =>
    kind === "teams"
      ? t("speakers.settings.sourceTeams")
      : kind === "enrolment"
        ? t("speakers.settings.sourceEnrolment")
        : t("speakers.settings.sourceManual"),
  );
  return words.join(", ");
}

/** The voice model: what it is, its licence, and download / cancel / retry / delete. */
function VoiceModel() {
  const models = useSpeakersStore((s) => s.models);
  const installed = useSpeakersStore((s) => s.modelsInstalled);
  const download = useSpeakersStore((s) => s.download);
  const error = useSpeakersStore((s) => s.downloadError);
  const downloadModels = useSpeakersStore((s) => s.downloadModels);
  const cancelDownload = useSpeakersStore((s) => s.cancelDownload);
  const deleteModels = useSpeakersStore((s) => s.deleteModels);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (installed === null) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!models || models.models.length === 0) {
    return (
      <p className={`${CARD} text-xs text-muted-foreground`} data-testid="voice-model-unavailable">
        {t("speakers.settings.unavailable")}
      </p>
    );
  }
  const totalBytes = models.models.reduce((sum, model) => sum + model.size_bytes, 0);
  const totalKnown = (download?.totalBytes ?? 0) > 0;
  const size = formatBytes(totalBytes, getFormatLocale()) ?? "";

  return (
    <div className={`${CARD} flex flex-wrap items-start justify-between gap-x-4 gap-y-2`} data-testid="voice-model">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{t("speakers.settings.voiceModel")}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{size}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("speakers.settings.voiceModelHint")}</p>
        {models.models.map((model) => (
          <p key={model.id} className="mt-1 break-words text-xs text-muted-foreground" data-testid="voice-model-licence">
            {model.name} · {t("speakers.settings.licence", { licence: model.licence })}
          </p>
        ))}
        {error && !download ? (
          <p role="alert" className="mt-1 text-xs text-[var(--color-destructive)]" data-testid="voice-model-error">
            {t("settings.transcription.failedRow", { error: describeSpeakerError(error) })}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {download ? (
          <>
            <div className="flex w-44 flex-col gap-1">
              <Progress
                value={totalKnown ? download.progress : null}
                aria-label={t("speakers.settings.downloadingModel")}
                className="h-1.5"
              />
              <span className="text-[11px] tabular-nums text-muted-foreground" data-testid="voice-model-progress">
                {totalKnown ? `${download.progress}% · ` : ""}
                {downloadProgressText(download)}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-destructive"
              onClick={cancelDownload}
              aria-label={t("speakers.settings.cancelModelDownload")}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </>
        ) : installed ? (
          <>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              {t("trans.downloaded")}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-destructive"
              aria-label={t("speakers.settings.deleteModel")}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">{t("settings.transcription.notDownloaded")}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={downloadModels}
              aria-label={error ? t("speakers.settings.retryModel") : t("speakers.settings.downloadModel")}
            >
              {error ? (
                <RotateCw className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              )}
              {error ? t("settings.transcription.retry") : t("trans.download")}
            </Button>
          </>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("speakers.settings.deleteModelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("speakers.settings.deleteModelBody", { size })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void deleteModels().catch((err) =>
                  toast.error(t("settings.transcription.deleteFailed", { error: describeSpeakerError(err) })),
                )
              }
            >
              {t("skills.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** "Remember voices on this Mac", its sub-switch, and "identify automatically". */
function OptIns() {
  const remember = useSpeakersStore((s) => s.rememberVoices);
  const learnFromTeams = useSpeakersStore((s) => s.learnFromTeams);
  const autoIdentify = useSpeakersStore((s) => s.autoIdentify);
  const storedCount = useSpeakersStore((s) => s.profiles.length);
  const [explaining, setExplaining] = useState(false);
  const [turningOff, setTurningOff] = useState(false);

  const turnOff = (alsoDelete: boolean) => {
    useSpeakersStore.getState().setRememberVoices(false);
    setTurningOff(false);
    if (!alsoDelete) return;
    void useSpeakersStore
      .getState()
      .deleteAllProfiles()
      .then(() => toast.success(t("speakers.settings.deletedAll")))
      .catch((err) => toast.error(t("speakers.settings.deleteFailed", { error: describeSpeakerError(err) })));
  };

  return (
    <>
      <div className={`${CARD} flex flex-col gap-3`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="speakers-remember" className="text-sm font-medium">
              {t("speakers.settings.remember")}
            </Label>
            <p id="speakers-remember-hint" className="mt-0.5 text-xs text-muted-foreground">
              {t("speakers.settings.rememberHint")}
            </p>
          </div>
          <Switch
            id="speakers-remember"
            checked={remember}
            aria-describedby="speakers-remember-hint"
            onCheckedChange={(on) => {
              // Turning it ON is a decision about other people's biometric
              // data: it happens in the dialog, after the explanation.
              if (on) setExplaining(true);
              else if (storedCount > 0) setTurningOff(true);
              else useSpeakersStore.getState().setRememberVoices(false);
            }}
          />
        </div>

        {remember && (
          <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
            <div className="min-w-0">
              <Label htmlFor="speakers-learn-teams" className="text-sm font-medium">
                {t("speakers.settings.learnTeams")}
              </Label>
              <p id="speakers-learn-teams-hint" className="mt-0.5 text-xs text-muted-foreground">
                {t("speakers.settings.learnTeamsHint")}
              </p>
            </div>
            <Switch
              id="speakers-learn-teams"
              checked={learnFromTeams}
              aria-describedby="speakers-learn-teams-hint"
              onCheckedChange={(on) => useSpeakersStore.getState().setLearnFromTeams(on)}
            />
          </div>
        )}
      </div>

      <div className={`${CARD} flex items-start justify-between gap-4`}>
        <div className="min-w-0">
          <Label htmlFor="speakers-auto" className="text-sm font-medium">
            {t("speakers.settings.auto")}
          </Label>
          <p id="speakers-auto-hint" className="mt-0.5 text-xs text-muted-foreground">
            {t("speakers.settings.autoHint")}
          </p>
        </div>
        <Switch
          id="speakers-auto"
          checked={autoIdentify}
          aria-describedby="speakers-auto-hint"
          onCheckedChange={(on) => useSpeakersStore.getState().setAutoIdentify(on)}
        />
      </div>

      <AlertDialog open={explaining} onOpenChange={setExplaining}>
        <AlertDialogContent data-testid="remember-voices-explanation">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("speakers.settings.explainTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                <p>{t("speakers.settings.explainWhat")}</p>
                <p>{t("speakers.settings.explainWhere")}</p>
                <p>{t("speakers.settings.explainConsent")}</p>
                <p>{t("speakers.settings.explainDelete")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => useSpeakersStore.getState().setRememberVoices(true)}>
              {t("speakers.settings.explainConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={turningOff} onOpenChange={setTurningOff}>
        <AlertDialogContent data-testid="remember-voices-off">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("speakers.settings.offTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("speakers.settings.offBody", { count: storedCount })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button variant="outline" onClick={() => turnOff(false)}>
              {t("speakers.settings.offKeep")}
            </Button>
            <AlertDialogAction variant="destructive" onClick={() => turnOff(true)}>
              {t("speakers.settings.offDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type EnrolState = { kind: "idle" } | { kind: "recording"; secs: number } | { kind: "working" };

/** "My voice": record a short sample or pick a file, re-enrol, remove. */
function MyVoice() {
  const remember = useSpeakersStore((s) => s.rememberVoices);
  const installed = useSpeakersStore((s) => s.modelsInstalled);
  const mine = useSpeakersStore((s) => s.profiles.find((profile) => profile.is_me));
  const meetingLive = useRecordingStore((s) => s.phase !== "idle");
  const [state, setState] = useState<EnrolState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const stopping = useRef(false);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const enrol = useCallback(async (audioPath: string) => {
    // The setting itself is the consent: with it off the backend refuses.
    const consent = useSpeakersStore.getState().rememberVoices;
    const saved = await tauriApi.enrolOwnVoice(consent, audioPath);
    await useSpeakersStore.getState().refreshProfiles();
    toast.success(saved.created ? t("speakers.settings.enrolled") : t("speakers.settings.enrolledAgain"));
  }, []);

  const finishRecording = useCallback(async () => {
    if (stopping.current) return;
    stopping.current = true;
    clearTimer();
    setState({ kind: "working" });
    let stagingDir: string | null = null;
    try {
      const stopped = await tauriApi.stopRecording();
      stagingDir = stopped.bundle_dir || null;
      await enrol(stopped.audio_path);
    } catch (err) {
      setError(describeSpeakerError(err));
    } finally {
      // The sample was only ever for making the voiceprint: it is not kept.
      if (stagingDir) {
        await tauriApi.discardRecording(stagingDir).catch((err) => {
          toast.warning(t("speakers.settings.sampleNotDeleted", { path: stagingDir ?? "", error: String(err) }));
        });
      }
      stopping.current = false;
      setState({ kind: "idle" });
    }
  }, [enrol]);

  const record = async () => {
    setError(null);
    try {
      await tauriApi.startRecording("microphone");
    } catch (err) {
      setError(describeSpeakerError(err));
      return;
    }
    startedAt.current = Date.now();
    setState({ kind: "recording", secs: 0 });
    timer.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt.current) / 1000);
      if (secs >= ENROL_RECORD_SECS) void finishRecording();
      else setState((current) => (current.kind === "recording" && current.secs !== secs ? { kind: "recording", secs } : current));
    }, 250);
  };

  const pickFile = async () => {
    setError(null);
    try {
      const path = await tauriApi.openFileDialog(t("speakers.settings.audioFilter"), [...IMPORT_EXTENSIONS]);
      if (!path) return;
      setState({ kind: "working" });
      await enrol(path);
    } catch (err) {
      setError(describeSpeakerError(err));
    } finally {
      setState({ kind: "idle" });
    }
  };

  // Leaving Settings mid-sample: stop the microphone and throw the sample away.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimer();
        void tauriApi.discardRecording().catch(() => undefined);
      }
    },
    [],
  );

  const blocked = !remember
    ? t("speakers.settings.needsRemember")
    : !installed
      ? t("speakers.settings.needsModel")
      : meetingLive
        ? t("speakers.settings.needsNoRecording")
        : null;
  const busy = state.kind !== "idle";

  return (
    <div className={`${CARD} flex flex-col gap-2`} data-testid="my-voice">
      <div>
        <h4 className="text-sm font-medium">{t("speakers.settings.myVoice")}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("speakers.settings.myVoiceHint")}</p>
      </div>
      <p className="text-xs" data-testid="my-voice-status">
        {mine
          ? t("speakers.settings.myVoiceSet", { count: mine.exemplar_count, date: formatDate(mine.updated_at) })
          : t("speakers.settings.myVoiceNone")}
      </p>

      {state.kind === "recording" && (
        <div className="flex flex-col gap-1" data-testid="my-voice-recording">
          <p className="text-xs text-foreground" role="status">
            {t("speakers.settings.recordingNow", { secs: state.secs, total: ENROL_RECORD_SECS })}
          </p>
          <Progress
            value={Math.min(100, Math.round((state.secs / ENROL_RECORD_SECS) * 100))}
            className="h-1.5 max-w-xs"
            aria-label={t("speakers.settings.recordingProgress")}
          />
        </div>
      )}
      {state.kind === "working" && (
        <p className="text-xs text-muted-foreground" role="status">
          {t("speakers.settings.learning")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--color-destructive)]" data-testid="my-voice-error">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {state.kind === "recording" ? (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void finishRecording()}>
            {t("speakers.settings.stopAndUse")}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={blocked !== null || busy}
            aria-describedby={blocked ? "my-voice-blocked" : undefined}
            onClick={() => void record()}
          >
            {mine ? t("speakers.settings.recordAgain") : t("speakers.settings.record")}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={blocked !== null || busy}
          aria-describedby={blocked ? "my-voice-blocked" : undefined}
          onClick={() => void pickFile()}
        >
          {t("speakers.settings.chooseFile")}
        </Button>
        {mine && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            {t("speakers.settings.removeMyVoice")}
          </Button>
        )}
      </div>
      {blocked && (
        <p id="my-voice-blocked" className="text-[11px] text-muted-foreground" data-testid="my-voice-blocked">
          {blocked}
        </p>
      )}

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("speakers.settings.removeMyVoiceTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("speakers.settings.removeMyVoiceBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!mine) return;
                void tauriApi
                  .voiceProfileDelete(mine.id)
                  .then(() => useSpeakersStore.getState().refreshProfiles())
                  .catch((err) => toast.error(t("speakers.settings.deleteFailed", { error: describeSpeakerError(err) })));
              }}
            >
              {t("speakers.settings.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Everyone else whose voice is stored: rename, merge two, delete one, delete all. */
function KnownVoices() {
  const profiles = useSpeakersStore((s) => s.profiles);
  const loaded = useSpeakersStore((s) => s.profilesLoaded);
  const quarantined = useSpeakersStore((s) => s.quarantined);
  const remember = useSpeakersStore((s) => s.rememberVoices);
  const [renaming, setRenaming] = useState<VoiceProfileSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<VoiceProfileSummary | null>(null);
  const [merging, setMerging] = useState<{ from: VoiceProfileSummary; into: VoiceProfileSummary } | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const others = profiles.filter((profile) => !profile.is_me);
  const reload = () => useSpeakersStore.getState().refreshProfiles();
  const failed = (err: unknown) =>
    toast.error(t("speakers.settings.changeFailed", { error: describeSpeakerError(err) }));

  const submitRename = () => {
    if (!renaming) return;
    const target = renaming;
    setRenaming(null);
    void tauriApi.voiceProfileRename(target.id, renameValue.replace(/\s+/g, " ").trim()).then(reload).catch(failed);
  };

  return (
    <div className={`${CARD} flex flex-col gap-2`} data-testid="known-voices">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h4 className="text-sm font-medium">{t("speakers.settings.knownVoices")}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("speakers.settings.knownVoicesHint")}</p>
        </div>
        {(profiles.length > 0 || quarantined > 0) && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-xs text-[var(--color-destructive)]"
            onClick={() => setDeletingAll(true)}
          >
            {t("speakers.settings.deleteAll")}
          </Button>
        )}
      </div>

      {!loaded ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : others.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="known-voices-empty">
          {remember ? t("speakers.settings.knownVoicesEmpty") : t("speakers.settings.knownVoicesEmptyOff")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border" aria-label={t("speakers.settings.knownVoices")}>
          {others.map((profile) => (
            <li key={profile.id} className="flex items-center gap-3 py-2" data-testid="known-voice">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={profile.name}>
                  {profile.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    t("speakers.settings.added", { date: formatDate(profile.created_at) }),
                    sourceText(profile),
                    t("speakers.settings.samples", { count: profile.exemplar_count }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {!profile.usable && (
                  <p className="text-[11px] text-muted-foreground">{t("speakers.settings.notUsable")}</p>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 shrink-0"
                    aria-label={t("speakers.settings.actionsFor", { name: profile.name })}
                  >
                    <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setRenameValue(profile.name);
                      setRenaming(profile);
                    }}
                  >
                    {t("recordings.rename")}
                  </DropdownMenuItem>
                  {others.length > 1 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>{t("speakers.settings.mergeInto")}</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {others
                          .filter((other) => other.id !== profile.id)
                          .map((other) => (
                            <DropdownMenuItem key={other.id} onSelect={() => setMerging({ from: profile, into: other })}>
                              {other.name}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(profile)}>
                    {t("recordings.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      {quarantined > 0 && (
        <p className="text-[11px] text-muted-foreground" data-testid="known-voices-quarantined">
          {t("speakers.settings.quarantined", { count: quarantined })}
        </p>
      )}

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-[420px]" data-testid="rename-voice-dialog">
          <DialogHeader>
            <DialogTitle>{t("speakers.settings.renameTitle")}</DialogTitle>
            <DialogDescription>{t("speakers.settings.renameHint")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
          >
            <Label htmlFor="voice-name" className="sr-only">
              {t("speakers.settings.nameLabel")}
            </Label>
            <Input
              id="voice-name"
              autoFocus
              value={renameValue}
              maxLength={120}
              onChange={(event) => setRenameValue(event.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={renameValue.trim().length === 0}>
                {t("recordings.rename")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={merging !== null} onOpenChange={(open) => !open && setMerging(null)}>
        <AlertDialogContent data-testid="merge-voice-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("speakers.settings.mergeTitle", { from: merging?.from.name ?? "", into: merging?.into.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("speakers.settings.mergeBody", { from: merging?.from.name ?? "", into: merging?.into.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!merging) return;
                void tauriApi.voiceProfilesMerge(merging.into.id, merging.from.id).then(reload).catch(failed);
              }}
            >
              {t("speakers.settings.merge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent data-testid="delete-voice-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("speakers.settings.deleteOneTitle", { name: deleting?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("speakers.settings.deleteOneBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                void tauriApi.voiceProfileDelete(deleting.id).then(reload).catch(failed);
              }}
            >
              {t("skills.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deletingAll} onOpenChange={setDeletingAll}>
        <AlertDialogContent data-testid="delete-all-voices-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("speakers.settings.deleteAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("speakers.settings.deleteAllBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                void useSpeakersStore
                  .getState()
                  .deleteAllProfiles()
                  .then(() => toast.success(t("speakers.settings.deletedAll")))
                  .catch((err) => toast.error(t("speakers.settings.deleteFailed", { error: describeSpeakerError(err) })))
              }
            >
              {t("speakers.settings.deleteAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Settings → Transcription → Speakers.
 *
 * Telling voices apart needs a small model. Recognising a voice in a LATER
 * recording needs a stored voiceprint, which is biometric data about another
 * person: that is off until the user turns it on, having read what it means,
 * and everything stored can be listed and deleted here, also after turning
 * it off again.
 */
export function VoiceProfilesSettings() {
  useLocale();
  const sectionRef = useRef<HTMLElement>(null);
  const focus = useSpeakersStore((s) => s.focusSettingsSection);

  useEffect(() => {
    void useSpeakersStore.getState().refreshModels();
    void useSpeakersStore.getState().refreshProfiles();
  }, []);

  // Opened from "Identify speakers…": bring this section into view.
  useEffect(() => {
    if (!focus) return;
    useSpeakersStore.getState().setFocusSettingsSection(false);
    const element = sectionRef.current;
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "start" });
    }
  }, [focus]);

  return (
    <section
      ref={sectionRef}
      id={SPEAKERS_SETTINGS_SECTION_ID}
      aria-labelledby="settings-speakers-heading"
      className="space-y-2 scroll-mt-4"
      data-testid="speakers-settings"
    >
      <div>
        <h3 id="settings-speakers-heading" className="text-sm font-semibold">
          {t("speakers.settings.title")}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("speakers.settings.intro")}</p>
      </div>
      <VoiceModel />
      <OptIns />
      <MyVoice />
      <KnownVoices />
    </section>
  );
}
