import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { runAutomationNow } from '@/lib/automations/run-bridge';
import { notifyAutomation } from '@/lib/notifications';
import type { AutomationsMissedPayload, MissedEntry } from '@/lib/automations/types';

/**
 * Catch-up chooser. Mounted once at the App root. The scheduler emits
 * `automations-missed` on the first reload per launch (runs that came due while
 * Notesage was closed); this surfaces them for the user to pick — they are
 * NEVER auto-fired (per the catch-up decision).
 */
export function MissedRunsDialog() {
  const [entries, setEntries] = useState<MissedEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<AutomationsMissedPayload>('automations-missed', (event) => {
      const { entries: missed } = event.payload;
      if (missed.length === 0) return;
      setEntries(missed);
      setSelected(new Set(missed.map((m) => m.sourcePath)));
      // Fires even when the window is hidden-to-tray (the only signal then).
      void notifyAutomation(
        'Automations to catch up',
        `${missed.length} automation${missed.length === 1 ? '' : 's'} missed runs while Notesage was closed.`,
      );
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, []);

  const close = () => setEntries([]);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const run = (paths: string[]) => {
    paths.forEach((p) => runAutomationNow(p));
    close();
  };

  return (
    <AlertDialog open={entries.length > 0} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Catch up missed runs?</AlertDialogTitle>
          <AlertDialogDescription>
            These automations came due while Notesage was closed. Choose which to run now — nothing
            runs unless you pick it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-64 space-y-1 overflow-auto py-1">
          {entries.map((e) => (
            <label
              key={e.sourcePath}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
            >
              <Checkbox
                checked={selected.has(e.sourcePath)}
                onCheckedChange={() => toggle(e.sourcePath)}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {e.missedCount} missed
              </span>
            </label>
          ))}
        </div>

        <AlertDialogFooter>
          <Button variant="ghost" onClick={close}>
            Skip
          </Button>
          <Button
            variant="outline"
            disabled={selected.size === 0}
            onClick={() => run(entries.filter((e) => selected.has(e.sourcePath)).map((e) => e.sourcePath))}
          >
            Run selected
          </Button>
          <Button onClick={() => run(entries.map((e) => e.sourcePath))}>Run all</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
