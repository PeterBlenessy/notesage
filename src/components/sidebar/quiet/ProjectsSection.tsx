import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ProjectsSection (quiet variant) — empty shell for the quiet-composer
 * sidebar (task #30).
 *
 * Distinct from `src/components/sidebar/ProjectsSection.tsx` — that file
 * powers the legacy expandable sidebar and is untouched by this task. The
 * quiet-composer sidebar is a flat list, wired up by task #32.
 */

export interface ProjectsSectionProps {
  /** Optional click handler for the `+` add button (wired by #32). */
  onAdd?: () => void;
}

export function ProjectsSection({ onAdd }: ProjectsSectionProps) {
  return (
    <section
      aria-label="Projects"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center justify-between gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Projects
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Add project"
          onClick={onAdd}
          className="opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        >
          <Plus strokeWidth={1.5} />
        </Button>
      </header>
      {/* Empty body — G2 task #32 fills this in by reading workspace-store. */}
    </section>
  );
}
