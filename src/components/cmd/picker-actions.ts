import { type AttachmentChip } from "@/components/cmd/AttachmentChips";
import { type TagPickAction } from "@/components/cmd/modes/TagMode";
import { type TaskAction } from "@/components/cmd/modes/TaskMode";
import { log } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Picker actions — the mode-picker selection handlers that need NO command
// bar state. Each translates a picker's domain-specific selection into a
// window CustomEvent consumed by App.tsx / the editor. They were previously
// empty-deps `useCallback`s inside FloatingCommandBar; module-level
// functions preserve the same referential stability across renders.
// ---------------------------------------------------------------------------

export function handlePickTag(action: TagPickAction): void {
  // Live-test 2026-04-26 (slice 2) — TagMode owns the two-level
  // drilldown (tag list → occurrence list) internally. By the time
  // `onPick` fires, the user has selected a SPECIFIC occurrence;
  // we just dispatch the open-file-at-tag event with the precomputed
  // file/symbol/index. Bar + picker stay open per user direction.
  window.dispatchEvent(
    new CustomEvent("notesage:open-file-at-tag", {
      detail: {
        filePath: action.filePath,
        fileName: action.fileName,
        symbol: action.symbol,
        occurrenceInFile: action.occurrenceInFile,
      },
    }),
  );
}

export function handlePickReference(chip: AttachmentChip): void {
  // Live-test 2026-04-26 (slice 2) — handles file + comment direct
  // picks. `person` kind drills down internally in `ReferenceMode`
  // and reaches us via `handlePickReferenceOccurrence` below.
  if (chip.kind === "file") {
    const filePath = chip.id.startsWith("file:")
      ? chip.id.slice("file:".length)
      : chip.id;
    const fileName = filePath.split("/").pop() || filePath;
    window.dispatchEvent(
      new CustomEvent("notesage:open-file", {
        detail: { filePath, fileName },
      }),
    );
    return;
  }
  // comment kind — no navigation wired yet (the comment store maps
  // document UUIDs to file paths; resolving requires a separate pass
  // that's out of scope for slice 2).
}

export function handlePickReferenceOccurrence(action: {
  filePath: string;
  fileName: string;
  symbol: string;
  occurrenceInFile: number;
}): void {
  // Slice 2 — `@person` drilldown delivered an occurrence pick.
  window.dispatchEvent(
    new CustomEvent("notesage:open-file-at-tag", {
      detail: {
        filePath: action.filePath,
        fileName: action.fileName,
        symbol: action.symbol,
        occurrenceInFile: action.occurrenceInFile,
      },
    }),
  );
}

export function handlePickResearch(chip: AttachmentChip): void {
  // Live-test 2026-04-26 — open the research file in a tab. Bar +
  // picker STAY OPEN per user direction: a wrong selection is one
  // arrow-key + Enter away. Esc dismisses when the user is done.
  const filePath = chip.id;
  const fileName = filePath.split("/").pop() || filePath;
  window.dispatchEvent(
    new CustomEvent("notesage:open-file", {
      detail: { filePath, fileName },
    }),
  );
}

export function handlePickTask(action: TaskAction): void {
  // Live-test 2026-04-26 — open the file at the task's text. Bar +
  // picker STAY OPEN so a wrong pick is one arrow + Enter away.
  // Esc dismisses.
  if (action.kind === "navigate") {
    const fileName =
      action.filePath.split("/").pop() || action.filePath;
    window.dispatchEvent(
      new CustomEvent("notesage:open-file", {
        detail: {
          filePath: action.filePath,
          fileName,
          scrollToText: action.text,
        },
      }),
    );
  }
}

export function handlePickPalette(commandId: string): void {
  // Live-test 2026-04-26 — fire the command via App.tsx's existing
  // listener (same callbacks as `useKeyboardShortcuts`). Bar + picker
  // STAY OPEN per user direction. Esc dismisses.
  window.dispatchEvent(
    new CustomEvent("notesage:palette-command", { detail: { commandId } }),
  );
  log.info("perf:cmdbar", "palette-execute", { commandId });
}
