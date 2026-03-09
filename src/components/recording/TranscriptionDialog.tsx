import { useState, useEffect, useCallback } from 'react';
import { Loader2, Mic, Copy, FileText, Type } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownContent } from '@/components/MarkdownContent';
import { useTranscription } from '@/hooks/useTranscription';
import { useRecordingStore } from '@/stores/recording-store';
import { formatTranscript, type TranscriptionResult } from '@/lib/transcript-formatter';
import type { AudioBufferInfo } from '@/lib/tauri';
import { toast } from 'sonner';

interface TranscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bufferInfo: AudioBufferInfo | null;
  onSaveAsNote?: (content: string, title: string) => void;
  onInsertAtCursor?: (text: string) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function TranscriptionDialog({
  open,
  onOpenChange,
  bufferInfo,
  onSaveAsNote,
  onInsertAtCursor,
}: TranscriptionDialogProps) {
  const { defaultModel } = useRecordingStore();
  const {
    transcribe,
    isTranscribing,
    progress,
    progressSegment,
    result,
    availableModels,
    refreshModels,
  } = useTranscription();

  const [selectedModel, setSelectedModel] = useState(defaultModel);
  const [formattedMarkdown, setFormattedMarkdown] = useState('');

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedModel(defaultModel);
      setFormattedMarkdown('');
      refreshModels();
    }
  }, [open, defaultModel, refreshModels]);

  // Format result when it arrives
  useEffect(() => {
    if (result) {
      const r: TranscriptionResult = {
        segments: result.segments,
        duration_secs: result.duration_secs,
        language: result.language,
      };
      const md = formatTranscript(r, '');
      setFormattedMarkdown(md);
    }
  }, [result]);

  const downloadedModels = availableModels.filter((m) => m.downloaded);

  const handleTranscribe = useCallback(async () => {
    await transcribe(selectedModel);
  }, [transcribe, selectedModel]);

  const handleCopyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formattedMarkdown);
      toast.success('Transcript copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, [formattedMarkdown]);

  const handleSaveAsNote = useCallback(() => {
    if (onSaveAsNote && formattedMarkdown) {
      const date = new Date().toISOString().split('T')[0];
      const title = `Meeting Transcript — ${date}`;
      onSaveAsNote(formattedMarkdown, title);
      onOpenChange(false);
    }
  }, [formattedMarkdown, onSaveAsNote, onOpenChange]);

  const handleInsertAtCursor = useCallback(() => {
    if (onInsertAtCursor && formattedMarkdown) {
      onInsertAtCursor(formattedMarkdown);
      onOpenChange(false);
    }
  }, [formattedMarkdown, onInsertAtCursor, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4" strokeWidth={1.5} />
            Transcribe Recording
          </DialogTitle>
          <DialogDescription className="sr-only">
            Transcribe recorded audio to text
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recording summary */}
          {bufferInfo && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Duration: {formatDuration(bufferInfo.duration_secs)}</span>
              <span>Source: {bufferInfo.source}</span>
            </div>
          )}

          {/* Model selector */}
          {!result && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Model</label>
              {downloadedModels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No models downloaded. Go to Settings &gt; Transcription to download a model.
                </p>
              ) : (
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {downloadedModels.map((model) => (
                      <SelectItem key={model.name} value={model.name}>
                        {model.name} ({formatSize(model.size_bytes)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Progress */}
          {isTranscribing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground truncate">
                {progressSegment || 'Processing...'}
              </p>
            </div>
          )}

          {/* Transcript preview */}
          {result && formattedMarkdown && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Transcript</label>
              <ScrollArea className="h-[300px] rounded-md border border-border p-3">
                <MarkdownContent content={formattedMarkdown} />
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleTranscribe}
                disabled={isTranscribing || downloadedModels.length === 0}
              >
                {isTranscribing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Transcribing...
                  </>
                ) : (
                  'Transcribe'
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopyToClipboard}>
                  <Copy className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                  Copy
                </Button>
                {onInsertAtCursor && (
                  <Button variant="outline" size="sm" onClick={handleInsertAtCursor}>
                    <Type className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                    Insert
                  </Button>
                )}
                {onSaveAsNote && (
                  <Button size="sm" onClick={handleSaveAsNote}>
                    <FileText className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                    Save as Note
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
