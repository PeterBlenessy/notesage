import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { useIndexProgressStore } from "@/stores/index-progress-store";

interface IndexingNoteProps {
  className?: string;
}

/**
 * One muted line for a view that reads the document index: while the library
 * is being indexed, what it shows may be only part of what is there. Renders
 * nothing when no indexing is in progress.
 *
 * Deliberately no spinner and no live region. The sidebar footer carries the
 * progress; this only keeps a partial list from being read as a complete one,
 * and several of these can be on screen at once.
 */
export function IndexingNote({ className }: IndexingNoteProps) {
  const indexing = useIndexProgressStore((s) => s.status.active);
  if (!indexing) return null;
  const text = t("indexing.incomplete");
  return (
    // One line wherever it is: in a narrow sidebar it truncates, and the
    // title carries the whole sentence.
    <p
      data-indexing-note
      title={text}
      className={cn("truncate text-[11px] text-muted-foreground", className)}
    >
      {text}
    </p>
  );
}
