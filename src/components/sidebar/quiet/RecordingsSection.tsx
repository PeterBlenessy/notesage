import { useEffect, type KeyboardEvent } from "react";
import { Mic } from "lucide-react";
import { useRecordingsStore } from "@/stores/recordings-store";
import { useSettingsStore } from "@/stores/settings-store";
import { RECORDINGS_FOLDER_NAME } from "@/lib/notes-root";
import { cn } from "@/lib/utils";

/**
 * The Recordings row, under Inbox.
 *
 * Same rule as the Inbox: a place, shown whether or not it has anything in
 * it, hidden only while the library root is still unknown.
 *
 * The badge counts FAILED bundles, not all of them. The Inbox's badge is
 * unread — things you have not looked at — and the recordings equivalent is
 * not "how many recordings exist" (they transcribe and file themselves; a
 * standing count would never reach zero and so would never mean anything)
 * but "how many need a decision from you". A failed transcription is the only
 * state that does.
 */
export function RecordingsSection({ filter = "" }: { filter?: string }) {
  const open = useRecordingsStore((s) => s.open);
  const dir = useRecordingsStore((s) => s.dir);
  const failed = useRecordingsStore((s) => s.failedCount());
  const load = useRecordingsStore((s) => s.load);
  const openRecordings = useRecordingsStore((s) => s.openRecordings);
  const homeDir = useSettingsStore((s) => s.homeDir);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const icloudNotesagePath = useSettingsStore((s) => s.icloudNotesagePath);

  // One listing once the root resolves, so the badge is right before the
  // place is ever opened.
  useEffect(() => {
    if (homeDir || icloudNotesagePath) void load();
  }, [homeDir, notesRootPath, icloudNotesagePath, load]);

  if (!dir) return null;
  if (filter && !RECORDINGS_FOLDER_NAME.toLowerCase().includes(filter.toLowerCase())) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openRecordings();
    }
  };

  return (
    <section aria-label={RECORDINGS_FOLDER_NAME} className="flex flex-col gap-1">
      <div
        role="button"
        tabIndex={0}
        aria-current={open ? "page" : undefined}
        data-active={open ? "true" : undefined}
        data-testid="recordings-row"
        onClick={openRecordings}
        onKeyDown={onKeyDown}
        className={cn(
          "h-7 px-2 flex items-center gap-2 rounded-sm text-[13px] transition-colors duration-150 cursor-default",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] focus-visible:z-10",
          open
            ? "bg-muted text-foreground font-medium"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <Mic
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            open ? "text-[var(--color-accent-primary)]" : "text-muted-foreground/70",
          )}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="truncate min-w-0 flex-1">{RECORDINGS_FOLDER_NAME}</span>
        {failed > 0 && (
          <span
            data-testid="recordings-failed"
            aria-label={`${failed} failed`}
            className="ml-auto shrink-0 rounded-full bg-destructive px-1.5 text-[11px] font-medium leading-4 tabular-nums text-destructive-foreground"
          >
            {failed}
          </span>
        )}
      </div>
    </section>
  );
}
