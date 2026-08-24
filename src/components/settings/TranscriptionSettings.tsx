import { useEffect, useMemo } from 'react';
import { Download, Trash2, CheckCircle, X } from 'lucide-react';
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
import { useRecordingStore } from '@/stores/recording-store';
import {
  SPEECH_LANGUAGES,
  speechLanguageLabel,
  isLanguageMismatch,
} from '@/lib/transcription/languages';
import { useModelMetadata } from '@/hooks/useModelMetadata';
import { ModelMetadataTooltip } from './ModelMetadataTooltip';
import { TooltipProvider } from '@/components/ui/tooltip';
import { t } from '@/lib/i18n';


function modelDisplayName(name: string): string {
  // Capitalize and format model names: "tiny" -> "Tiny", "large-v3" -> "Large v3"
  return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function TranscriptionSettings() {
  const {
    defaultModel,
    speechLanguage,
    availableModels: models,
    activeDownloads,
    setDefaultModel,
    setSpeechLanguage,
    refreshModels,
    downloadModel,
    cancelDownload,
    deleteModel,
  } = useRecordingStore();

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  const downloadedModels = models.filter((m) => m.downloaded);
  const hasActiveDownloads = Object.keys(activeDownloads).length > 0;

  // Batch-fetch metadata for all Whisper models
  const modelIds = useMemo(() => models.map((m) => ({ id: m.name })), [models]);
  const { metadataMap } = useModelMetadata(modelIds, 'whisper');

  return (
    <div className="space-y-6">
      {/* Model Management */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t("voice.whisperModels")}</h3>
        <p className="text-xs text-muted-foreground">
          OpenAI Whisper models used to transcribe meeting recordings on-device — your audio never leaves your machine. Models are downloaded from{' '}
          <a
            href="https://huggingface.co/ggerganov/whisper.cpp"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            Hugging Face
          </a>{' '}
          in GGML format (whisper.cpp). Larger models are more accurate but slower.
        </p>

        <div className="space-y-2">
          <TooltipProvider delayDuration={300}>
          {models.map((model) => {
            const download = activeDownloads[model.name];
            return (
              <ModelMetadataTooltip
                key={model.name}
                metadata={metadataMap[model.name]}
                modelType="whisper"
                side="top"
              >
              <div
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{modelDisplayName(model.name)}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatSize(model.size_bytes)}
                      </span>
                      {model.parameters && (
                        <span className="text-xs text-muted-foreground/70">
                          · {model.parameters} params
                        </span>
                      )}
                    </div>
                    {model.description && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{model.description}</p>
                    )}
                    {/* Provenance and the longer story, on demand. The row says
                        what the model is FOR; this says what it actually is and
                        where the file comes from, so "downloads a model" is a
                        claim the user can check rather than take on trust. */}
                    {(model.detail || model.download_url) && (
                      <details className="mt-1 group/detail">
                        <summary className="text-xs text-muted-foreground/60 cursor-pointer list-none hover:text-muted-foreground transition-colors duration-150">
                          <span className="underline decoration-dotted underline-offset-2">
                            About this model
                          </span>
                        </summary>
                        <div className="mt-1.5 space-y-1 text-xs text-muted-foreground/70">
                          {model.detail && <p className="max-w-prose">{model.detail}</p>}
                          <p>
                            {model.author && <>By {model.author}</>}
                            {model.license && <> · {model.license} licence</>}
                            {model.parameters && <> · {model.parameters} parameters</>}
                          </p>
                          {model.download_url && (
                            <p className="break-all">
                              Downloaded from{' '}
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
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {download ? (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 w-28">
                        <Progress value={download.progress} className="h-1.5 flex-1" />
                        <span className="text-xs tabular-nums text-muted-foreground w-8">
                          {Math.round(download.progress)}%
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => cancelDownload(model.name)}
                        title={t("voice.cancelDownload")}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </Button>
                    </div>
                  ) : model.downloaded ? (
                    <>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Downloaded
                      </span>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" disabled={hasActiveDownloads}>
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("voice.deleteModelQuestion")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will delete the '{model.name}' model ({formatSize(model.size_bytes)}).
                              You can download it again later.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("voice.cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteModel(model.name)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => downloadModel(model.name)}
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                      Download
                    </Button>
                  )}
                </div>
              </div>
              </ModelMetadataTooltip>
            );
          })}
          </TooltipProvider>
        </div>
      </div>

      {/* Preferences */}
      <div className="space-y-2">
        <div>
          <Label className="text-sm font-semibold">{t("voice.preferences")}</Label>
        </div>

        {/* Default model */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
          <div>
            <Label className="text-sm font-medium">{t("voice.transcriptionModel")}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Whisper model used to transcribe meeting recordings in the background
            </p>
          </div>
          <Select
            value={defaultModel}
            onValueChange={setDefaultModel}
            disabled={downloadedModels.length === 0}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder={t("voice.selectModel")} />
            </SelectTrigger>
            <SelectContent>
              {downloadedModels.map((m) => (
                <SelectItem key={m.name} value={m.name}>
                  {modelDisplayName(m.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Speech language */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
          <div>
            <Label className="text-sm font-medium">{t("voice.recordingLanguage")}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Spoken language of your recordings. Defaults to your device language —
              auto-detect is reliable for English but often wrong for other languages.
            </p>
          </div>
          <Select value={speechLanguage} onValueChange={setSpeechLanguage}>
            <SelectTrigger className="w-32">
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
            <span className="text-[var(--color-destructive)]">Note:</span>{' '}
            {modelDisplayName(defaultModel)} is accurate in English but weak in other
            languages — roughly one word in four on Swedish. For{' '}
            {speechLanguage === 'auto' ? 'auto-detect' : speechLanguageLabel(speechLanguage)},
            choose the quality model instead.
          </p>
        )}
      </div>
    </div>
  );
}
