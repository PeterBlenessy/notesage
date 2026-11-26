import { useEffect, useMemo } from 'react';
import { Download, Trash2, CheckCircle, RotateCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { useRecordingStore, type DownloadState, type ModelInfo } from '@/stores/recording-store';
import {
  SPEECH_LANGUAGES,
  speechLanguageLabel,
  isLanguageMismatch,
} from '@/lib/transcription/languages';
import { useModelMetadata } from '@/hooks/useModelMetadata';
import type { ModelMetadata } from '@/lib/tauri';
import { RecordingSourcePicker } from '@/components/activity/RecordingSourcePicker';
import { VoiceProfilesSettings } from '@/components/recordings/VoiceProfilesSettings';
import { ModelMetadataTooltip } from './ModelMetadataTooltip';
import { TooltipProvider } from '@/components/ui/tooltip';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';


function modelDisplayName(name: string): string {
  // Capitalize and format model names: "tiny" -> "Tiny", "large-v3" -> "Large v3"
  return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function wholeMB(bytes: number): string {
  return String(Math.max(0, Math.round(bytes / (1024 * 1024))));
}

/** "3 MB/s", or with one decimal below 10 MB/s. */
function formatSpeed(bytesPerSec: number): string {
  const mb = bytesPerSec / (1024 * 1024);
  return mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
}

function formatEta(seconds: number): string {
  if (seconds < 60) return t("settings.transcription.etaSeconds", { secs: Math.max(1, Math.round(seconds)) });
  return t("settings.transcription.etaMinutes", { mins: Math.round(seconds / 60) });
}

/**
 * "212 of 547 MB · 4.1 MB/s · 2 min left". Without a total from the server
 * there is no percent and no estimate, but there is still proof of movement:
 * "212 MB · 4.1 MB/s".
 */
export function downloadProgressText(download: DownloadState): string {
  const done = download.downloadedBytes ?? 0;
  const total = download.totalBytes ?? 0;
  const parts = [
    total > 0
      ? t("settings.transcription.mbOfTotal", { done: wholeMB(done), total: wholeMB(total) })
      : t("settings.transcription.mbDone", { done: wholeMB(done) }),
  ];
  if ((download.bytesPerSec ?? 0) > 0) {
    parts.push(t("settings.transcription.speed", { speed: formatSpeed(download.bytesPerSec ?? 0) }));
  }
  if (download.etaSecs !== null && download.etaSecs !== undefined) {
    parts.push(formatEta(download.etaSecs));
  }
  return parts.join(' · ');
}

/**
 * One model. Subscribes to ITS download only, so a download in progress
 * re-renders one row (at most once per percent), not the page.
 */
function ModelRow({ model, metadata }: { model: ModelInfo; metadata?: ModelMetadata | null }) {
  const download = useRecordingStore((s) => s.activeDownloads[model.name]);
  const error = useRecordingStore((s) => s.downloadErrors[model.name]);
  const anyDownload = useRecordingStore((s) => Object.keys(s.activeDownloads).length > 0);
  const downloadModel = useRecordingStore((s) => s.downloadModel);
  const cancelDownload = useRecordingStore((s) => s.cancelDownload);
  const deleteModel = useRecordingStore((s) => s.deleteModel);
  const name = modelDisplayName(model.name);
  const totalKnown = (download?.totalBytes ?? 0) > 0;

  return (
    <ModelMetadataTooltip metadata={metadata} modelType="whisper" side="top">
      <div
        data-model-row={model.name}
        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">
                {formatSize(model.size_bytes)}
              </span>
              {model.parameters && (
                <span className="text-xs text-muted-foreground">
                  · {t("settings.transcription.paramsShort", { params: model.parameters })}
                </span>
              )}
            </div>
            {model.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
            )}
            {/* Provenance and the longer story, on demand. The row says
                what the model is FOR; this says what it actually is and
                where the file comes from, so "downloads a model" is a
                claim the user can check rather than take on trust. */}
            {(model.detail || model.download_url) && (
              <details className="mt-1 group/detail">
                <summary className="text-xs text-muted-foreground cursor-pointer list-none hover:text-foreground transition-colors duration-150">
                  <span className="underline decoration-dotted underline-offset-2">
                    {t("trans.aboutModel")}
                  </span>
                </summary>
                <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                  {model.detail && <p className="max-w-prose">{model.detail}</p>}
                  <p>
                    {[
                      model.author ? t("settings.transcription.by", { author: model.author }) : null,
                      model.license ? t("settings.transcription.licence", { licence: model.license }) : null,
                      model.parameters
                        ? t("settings.transcription.parameters", { params: model.parameters })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {model.download_url && (
                    <p className="break-all">
                      {t("trans.downloadedFrom")}{' '}
                      <a
                        href={model.download_url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted underline-offset-2 hover:text-foreground transition-colors duration-150"
                      >
                        {model.download_url}
                      </a>
                    </p>
                  )}
                </div>
              </details>
            )}
            {error && !download ? (
              <p role="alert" data-model-error className="mt-1 text-xs text-[var(--color-destructive)]">
                {t("settings.transcription.failedRow", { error })}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {download ? (
            <div className="flex items-center gap-2">
              <div className="flex w-44 flex-col gap-1">
                <Progress
                  // No total from the server: an honest indeterminate bar
                  // rather than one stuck at 0%.
                  value={totalKnown ? download.progress : null}
                  aria-label={t("settings.transcription.downloading", { model: name })}
                  className="h-1.5"
                />
                <span data-download-progress className="text-[11px] tabular-nums text-muted-foreground">
                  {totalKnown ? `${download.progress}% · ` : ''}
                  {downloadProgressText(download)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => cancelDownload(model.name)}
                title={t("voice.cancelDownload")}
                aria-label={t("settings.transcription.cancelDownloadOf", { model: name })}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              </Button>
            </div>
          ) : model.downloaded ? (
            <>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                {t("trans.downloaded")}
              </span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={anyDownload}
                    aria-label={t("settings.transcription.deleteModel", { model: name })}
                    title={t("settings.transcription.deleteModel", { model: name })}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("voice.deleteModelQuestion")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("trans.deleteModelBody", { name: model.name, size: formatSize(model.size_bytes) })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("voice.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteModel(model.name)}>
                      {t("skills.delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">{t("settings.transcription.notDownloaded")}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => downloadModel(model.name)}
                aria-label={
                  error
                    ? t("settings.transcription.retryModel", { model: name })
                    : t("settings.transcription.downloadModel", { model: name })
                }
              >
                {error ? (
                  <RotateCw className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} aria-hidden="true" />
                )}
                {error ? t("settings.transcription.retry") : t("trans.download")}
              </Button>
            </>
          )}
        </div>
      </div>
    </ModelMetadataTooltip>
  );
}

export function TranscriptionSettings() {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  // One selector per field. A bare `useRecordingStore()` re-rendered the whole
  // page on every store write — including each download-progress update and,
  // while recording, the once-a-second timer.
  const defaultModel = useRecordingStore((s) => s.defaultModel);
  const speechLanguage = useRecordingStore((s) => s.speechLanguage);
  const models = useRecordingStore((s) => s.availableModels);
  const modelsLoaded = useRecordingStore((s) => s.modelsLoaded);
  const setDefaultModel = useRecordingStore((s) => s.setDefaultModel);
  const setSpeechLanguage = useRecordingStore((s) => s.setSpeechLanguage);
  const refreshModels = useRecordingStore((s) => s.refreshModels);
  const downloadModel = useRecordingStore((s) => s.downloadModel);
  const selectedDownloading = useRecordingStore((s) => s.activeDownloads[s.defaultModel] !== undefined);
  const recordingLive = useRecordingStore((s) => s.phase !== 'idle');

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const downloadedModels = models.filter((m) => m.downloaded);
  const selected = models.find((m) => m.name === defaultModel);
  // The selected model is not on disk: recordings can be made but not
  // transcribed. Only claimed once the list has actually been read.
  const selectedMissing = modelsLoaded && !selected?.downloaded;
  // The select always shows the selected model, downloaded or not — it used
  // to go blank when the default was missing, which hid the whole problem.
  const selectable = selectedMissing
    ? [{ name: defaultModel, downloaded: false }, ...downloadedModels]
    : downloadedModels;

  // Batch-fetch metadata for all Whisper models
  const modelIds = useMemo(() => models.map((m) => ({ id: m.name })), [models]);
  const { metadataMap } = useModelMetadata(modelIds, 'whisper');

  return (
    <div className="space-y-6">
      {/* Model Management */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t("voice.whisperModels")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("trans.whisperIntro")}{' '}
          <a
            href="https://huggingface.co/ggerganov/whisper.cpp"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            Hugging Face
          </a>{' '}
          {t("trans.ggmlHint")}
        </p>

        <div className="space-y-2">
          <TooltipProvider delayDuration={300}>
            {models.map((model) => (
              <ModelRow key={model.name} model={model} metadata={metadataMap[model.name]} />
            ))}
          </TooltipProvider>
        </div>
      </div>

      {/* Preferences */}
      <div className="space-y-2">
        <div>
          <Label className="text-sm font-semibold">{t("voice.preferences")}</Label>
        </div>

        {/* What a recording captures */}
        <div className="flex flex-col gap-2 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
          <div>
            <Label className="text-sm font-medium">{t("settings.transcription.source")}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("settings.transcription.sourceHint")}
            </p>
          </div>
          <RecordingSourcePicker disabled={recordingLive} className="max-w-md" />
        </div>

        {/* Default model */}
        <div className="flex flex-col gap-2 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">{t("voice.transcriptionModel")}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("trans.modelHint")}
              </p>
            </div>
            <Select value={defaultModel} onValueChange={setDefaultModel}>
              <SelectTrigger
                // Wide enough for "<model> (not downloaded)" to be read whole.
                className={selectedMissing ? "w-80 shrink-0" : "w-56 shrink-0"}
                aria-label={t("voice.transcriptionModel")}
              >
                <SelectValue placeholder={t("voice.selectModel")} />
              </SelectTrigger>
              <SelectContent>
                {selectable.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.downloaded
                      ? modelDisplayName(m.name)
                      : t("settings.transcription.modelNotDownloaded", { model: modelDisplayName(m.name) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedMissing ? (
            <div
              role="status"
              data-selected-model-missing
              className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2"
            >
              <p className="text-xs text-foreground">
                {t("settings.transcription.selectedMissing", { model: modelDisplayName(defaultModel) })}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                disabled={selectedDownloading || !selected}
                onClick={() => downloadModel(defaultModel)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} aria-hidden="true" />
                {selectedDownloading
                  ? t("settings.transcription.downloadingShort")
                  : t("settings.transcription.downloadModel", { model: modelDisplayName(defaultModel) })}
              </Button>
            </div>
          ) : null}
        </div>

        {/* Speech language */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
          <div>
            <Label className="text-sm font-medium">{t("voice.recordingLanguage")}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("trans.languageHint")} {t("settings.transcription.languageLastUsed")}
            </p>
          </div>
          <Select value={speechLanguage} onValueChange={setSpeechLanguage}>
            <SelectTrigger className="w-32" aria-label={t("voice.recordingLanguage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEECH_LANGUAGES.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* The one model/language pair that quietly produces bad output. */}
        {isLanguageMismatch(defaultModel, speechLanguage) && (
          <p className="text-xs text-muted-foreground px-4 -mt-1">
            <span className="text-[var(--color-destructive)]">{t("trans.note")}</span>{' '}
            {t("trans.mismatchWarning", {
              model: modelDisplayName(defaultModel),
              language: speechLanguage === 'auto' ? t("trans.autoDetect") : speechLanguageLabel(speechLanguage),
            })}
          </p>
        )}
      </div>

      {/* Speakers: the voice model, remembered voices (opt-in), my voice. */}
      <VoiceProfilesSettings />
    </div>
  );
}
