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
import { useModelMetadata } from '@/hooks/useModelMetadata';
import { ModelMetadataTooltip } from './ModelMetadataTooltip';
import { TooltipProvider } from '@/components/ui/tooltip';

const LANGUAGES = [
  { value: 'ar', label: 'Arabic' },
  { value: 'zh', label: 'Chinese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'es', label: 'Spanish' },
  { value: 'sv', label: 'Swedish' },
];

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
        <h3 className="text-sm font-medium">Whisper Models</h3>
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
                        title="Cancel download"
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
                            <AlertDialogTitle>Delete model?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will delete the '{model.name}' model ({formatSize(model.size_bytes)}).
                              You can download it again later.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
          <Label className="text-sm font-semibold">Preferences</Label>
        </div>

        {/* Default model */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
          <div>
            <Label className="text-sm font-medium">Transcription model</Label>
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
              <SelectValue placeholder="Select model" />
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
            <Label className="text-sm font-medium">Recording language</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Spoken language of your recordings (leave on auto-detect if unsure)
            </p>
          </div>
          <Select value={speechLanguage} onValueChange={setSpeechLanguage}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
