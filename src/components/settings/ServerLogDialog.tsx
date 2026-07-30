import { useCallback, useState } from 'react';
import { tauriApi } from '@/lib/tauri';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollText, RefreshCw, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { log } from '@/lib/logger';

/**
 * Viewer for the inference engine's own log.
 *
 * llama.cpp reports context exhaustion, KV-cache pressure and truncated
 * requests on its stderr. That output used to be buffered until the process
 * exited and then discarded, so when a local agent stopped mid-task the
 * engine's explanation was unreachable without a terminal. The backend now
 * retains a bounded tail; this surfaces it.
 */
export function ServerLogDialog() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLines(await tauriApi.getLocalServerLog());
    } catch (error) {
      // The log is a diagnostic aid — failing to read it must not throw an
      // unhandled rejection into a settings panel.
      log.warn('ai', 'Failed to read local server log', error);
      toast.error('Could not read the server log');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) void load();
    },
    [load],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      log.warn('ai', 'Failed to copy server log', error);
      toast.error('Could not copy the log');
    }
  }, [lines]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5">
          <ScrollText className="h-3 w-3" strokeWidth={1.5} />
          Server log
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Server log</DialogTitle>
          <DialogDescription>
            Recent output from the local inference engine. Useful when a local agent stops
            before finishing — look for messages about context size or the KV cache.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[420px] rounded-md border border-border bg-muted/30">
          {lines.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              {loading
                ? 'Reading…'
                : 'Nothing logged yet. The log is cleared each time the server starts.'}
            </p>
          ) : (
            <pre className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words">
              {lines.join('\n')}
            </pre>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {lines.length > 0 ? `${lines.length} lines` : ''}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleCopy}
              disabled={lines.length === 0}
            >
              {copied ? (
                <Check className="h-3 w-3" strokeWidth={1.5} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.5} />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`}
                strokeWidth={1.5}
              />
              Refresh
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
