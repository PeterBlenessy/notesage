import { cn } from "@/lib/utils";

const COMPACT_PLACEHOLDER = "Press ⌘K to ask";

interface CompactContentProps {
  onActivate: () => void;
}

/**
 * CompactContent — the collapsed pill body of the FloatingCommandBar.
 * A pure visual fragment: one full-size button that expands the bar.
 */
export function CompactContent({ onActivate }: CompactContentProps) {
  // Live-test 2026-04-25 — the right-aligned `⌘K` <kbd> hint was
  // removed because COMPACT_PLACEHOLDER ("Press ⌘K to ask") on the
  // left already names the chord. Showing it twice in the same pill
  // was redundant and over-informing — the user explicitly asked us
  // to "focus on simplicity" in this batch. Centering the placeholder
  // also reads better than the previous left-justified + right-kbd
  // layout for a single-line pill.
  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        "flex h-full w-full items-center justify-center px-4",
        "text-left text-sm text-muted-foreground",
        "hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
    >
      <span>{COMPACT_PLACEHOLDER}</span>
    </button>
  );
}

export default CompactContent;
