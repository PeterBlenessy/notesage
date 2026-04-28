import {
  BookOpen,
  CheckSquare,
  FileText,
  Hash,
  MessageSquare,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AttachmentChips — pure presentation strip rendered above the
 * `FloatingCommandBar` input when there are pending attachments.
 *
 * Each chip is a small rounded pill: kind icon (left) + name + remove `×`.
 * The component is stateless: the parent owns the chip array and the remove
 * callback. Returns `null` when `chips` is empty so the strip doesn't take up
 * vertical space when there's nothing attached.
 *
 * Wiring map (PRD `2026-04-21-ui-refresh`, Phase 1):
 *   - #11 (this task) — component + empty-state mount in the bar
 *   - #15 ReferenceMode — pushes file / person / comment chips
 *   - #17 TaskMode      — pushes task chips
 *   - #18 ResearchMode  — pushes research chips
 */

export type AttachmentChipKind =
  | "file"
  | "person"
  | "comment"
  | "tag"
  | "task"
  | "research";

export interface AttachmentChip {
  id: string;
  kind: AttachmentChipKind;
  name: string;
}

interface AttachmentChipsProps {
  chips: AttachmentChip[];
  onRemove: (id: string) => void;
  className?: string;
}

// Icon per chip kind. Keep this map exhaustive so TS catches new kinds.
const KIND_ICONS: Record<AttachmentChipKind, LucideIcon> = {
  file: FileText,
  person: User,
  comment: MessageSquare,
  tag: Hash,
  task: CheckSquare,
  research: BookOpen,
};

function AttachmentChips({ chips, onRemove, className }: AttachmentChipsProps) {
  // No vertical space taken when nothing is attached — the bar's input row
  // stays flush against the context row above it.
  if (chips.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-border",
        className,
      )}
    >
      {chips.map((chip) => {
        const Icon = KIND_ICONS[chip.kind];
        return (
          <div
            key={chip.id}
            data-chip-kind={chip.kind}
            className={cn(
              "group inline-flex items-center gap-1.5 max-w-[200px]",
              "rounded-md border border-border bg-muted/40",
              "pl-1.5 pr-1 py-0.5 text-xs text-foreground",
              "transition-colors hover:bg-muted",
            )}
          >
            <Icon
              className="h-3 w-3 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span data-chip-name="true" className="truncate">
              {chip.name}
            </span>
            <button
              type="button"
              onClick={() => onRemove(chip.id)}
              aria-label={`Remove ${chip.name}`}
              className={cn(
                "shrink-0 rounded-sm p-0.5",
                "text-muted-foreground hover:text-foreground hover:bg-background/60",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              )}
            >
              <X className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default AttachmentChips;
