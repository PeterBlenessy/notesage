import { useEffect } from 'react';
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

const MODEL_DETAILS: Record<string, { label: string; params: string; description: string }> = {
  tiny: { label: 'Tiny', params: '39M', description: 'Fastest, least accurate' },
  base: { label: 'Base', params: '74M', description: 'Good balance for short recordings' },
  small: { label: 'Small', params: '244M', description: 'Accurate for most languages' },
  medium: { label: 'Medium', params: '769M', description: 'High accuracy, slower' },
  'large-v3': { label: 'Large v3', params: '1550M', description: 'Best accuracy, slowest' },
};

function modelDisplayName(name: string): string {
  return MODEL_DETAILS[name]?.label ?? name;
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

  return (
    <div className="space-y-6">
      {/* Model Management */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Whisper Models</h3>
        <p className="text-xs text-muted-foreground">
          OpenAI Whisper models for on-device transcription — your audio never leaves your machine. Models are downloaded from{' '}
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
          {models.map((model) => {
            const details = MODEL_DETAILS[model.name];
            const download = activeDownloads[model.name];
            return (
              <div
                key={model.name}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{modelDisplayName(model.name)}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatSize(model.size_bytes)}
                      </span>
                      {details && (
                        <span className="text-xs text-muted-foreground/70">
                          · {details.params} params
                        </span>
                      )}
                    </div>
                    {details && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{details.description}</p>
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
            );
          })}
        </div>
      </div>

      {/* Preferences */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Preferences</h3>

        {/* Default model */}
        <div className="flex items-center justify-between">
          <Label className="text-sm">Default model</Label>
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
        <div className="flex items-center justify-between">
          <Label className="text-sm">Speech language</Label>
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
