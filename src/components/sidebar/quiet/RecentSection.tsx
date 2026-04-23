/**
 * RecentSection — empty shell for the quiet-composer sidebar (task #30).
 *
 * "Recent" is a derived list with no explicit add action — there's nothing
 * for the user to "add" since the list comes from `editor-store` last-touched
 * ordering (task #33). No `+` button is rendered.
 */

export interface RecentSectionProps {
  // Intentionally empty — G2 task #33 will add props (cap, show-more handler).
}

export function RecentSection(_props: RecentSectionProps = {}) {
  void _props;
  return (
    <section
      aria-label="Recent"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Recent
        </h2>
      </header>
      {/* Empty body — G2 task #33 fills this in by reading editor-store. */}
    </section>
  );
}
