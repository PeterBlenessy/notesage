import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PinnedSection — empty shell for the quiet-composer sidebar (task #30).
 *
 * Renders the uppercase "Pinned" header with an optional `+` add-button.
 * No data wiring — task #31 replaces this stub with the real list read from
 * `workspace-store`. Rendering nothing in the body is intentional: we do not
 * want a "No items" placeholder that G2 would immediately rip out.
 */

export interface PinnedSectionProps {
  /**
   * Optional click handler for the `+` add button. When omitted, the button
   * is still rendered so the hover affordance and focus behaviour are exercised
   * by visual regression tests; G2 (#31) will wire the actual pin action.
   */
  onAdd?: () => void;
}

export function PinnedSection({ onAdd }: PinnedSectionProps) {
  return (
    <section
      aria-label="Pinned"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center justify-between gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Pinned
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Add pinned"
          onClick={onAdd}
          className="opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        >
          <Plus strokeWidth={1.5} />
        </Button>
      </header>
      {/* Empty body — G2 task #31 fills this in by reading workspace-store. */}
    </section>
  );
}
