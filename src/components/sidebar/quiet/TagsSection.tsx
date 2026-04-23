/**
 * TagsSection — empty shell for the quiet-composer sidebar (task #30).
 *
 * Tags come from the SQLite document index (usage count) — there is no "add
 * a tag" affordance, so no `+` button is rendered. Task #34 queries the top
 * N tags and wires click-through to the composer with `#tagname` prefilled.
 */

export interface TagsSectionProps {
  // Intentionally empty — G2 task #34 will add props (cap, show-more handler).
}

export function TagsSection(_props: TagsSectionProps = {}) {
  void _props;
  return (
    <section
      aria-label="Tags"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Tags
        </h2>
      </header>
      {/* Empty body — G2 task #34 fills this in by querying the SQLite index. */}
    </section>
  );
}
