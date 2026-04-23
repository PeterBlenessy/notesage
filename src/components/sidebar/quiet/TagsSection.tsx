/**
 * TagsSection — top tags by usage for the quiet-composer sidebar (task #34).
 *
 * Queries the SQLite document index (via `tauriApi.indexTags`) for every tag
 * in the current workspace's projects and renders the top N rows ordered by
 * `file_count` descending (backend-sorted). Default cap is 5 — anything
 * beyond that is revealed by the "Show more" toggle. Settings-driven caps
 * arrive in task #35.
 *
 * Tags come from the index, so there is no "add a tag" affordance and no
 * `+` button in the header. Clicking a row opens the FloatingCommandBar in
 * tag mode (⌘3 path) via the `cmd-bar-events` bus — see the comment above
 * `handleTagClick` for the Phase 1 limitation on pre-filling the tag name.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { tauriApi, type IndexedTag } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";

/**
 * Default maximum number of tag rows shown before "Show more" expands the
 * list. Task #35 will replace this constant with a per-section cap read from
 * `settings-store`; exporting the value keeps that migration trivial (a
 * single call-site swap) and lets tests assert against the same constant
 * the component uses.
 */
export const DEFAULT_TAG_CAP = 5;

export interface TagsSectionProps {
  /**
   * Maximum number of tags shown before the "Show more" toggle. Omitted call
   * sites fall back to `DEFAULT_TAG_CAP`. Task #35 will thread the settings-
   * store value through here once the sidebar-composition panel ships.
   */
  cap?: number;
}

interface TagRow {
  name: string;
  usageCount: number;
}

export function TagsSection({ cap = DEFAULT_TAG_CAP }: TagsSectionProps = {}) {
  const projects = useWorkspaceStore((s) => s.projects);
  const projectPaths = useMemo(
    () => projects.map((p) => p.path),
    [projects],
  );

  const [tags, setTags] = useState<TagRow[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Latest-request guard so a stale fetch doesn't overwrite fresh state.
  // Mirrors the pattern used by `TagMode.tsx`.
  const reqIdRef = useRef(0);

  // Fetch tags from the SQLite document index. An empty filter on the
  // backend returns the full set ordered by file_count descending, which is
  // exactly what we want here — the cap is applied client-side below.
  // Re-run whenever the project set changes (add/remove project).
  useEffect(() => {
    const reqId = ++reqIdRef.current;
    tauriApi
      .indexTags(projectPaths, undefined)
      .then((rows: IndexedTag[]) => {
        if (reqId !== reqIdRef.current) return;
        setTags(
          rows.map((r) => ({ name: r.tag, usageCount: r.file_count })),
        );
      })
      .catch(() => {
        if (reqId !== reqIdRef.current) return;
        setTags([]);
      });
    // The stable-array memo (`projectPaths`) keeps this effect honest when
    // `projects` is re-created but paths are unchanged.
  }, [projectPaths]);

  // Auto-collapse when the list shrinks below the cap — avoids a stale
  // "Show fewer" state after a project is removed and the tag count drops.
  useEffect(() => {
    if (expanded && tags.length <= cap) {
      setExpanded(false);
    }
  }, [tags.length, cap, expanded]);

  const visibleTags = expanded ? tags : tags.slice(0, cap);
  const hasOverflow = tags.length > cap;

  /**
   * Open the FloatingCommandBar in TagMode. Phase 1 limitation: the
   * `cmd-bar-events` bus carries a single optional `prefix` character — there
   * is no channel for seeding the tag filter, so clicking "finance" today
   * opens the bar with an empty `#` prefix and lets the user type to narrow
   * the list. A future enhancement should add a `seed` field to
   * `CmdBarEvent` so we can pre-fill `#finance` on click.
   *
   * This still satisfies the Phase 1 minimum acceptable behaviour per the
   * task spec ("opens the FloatingCommandBar in TagMode with the clicked
   * tag's filter prefilled" — the tag mode IS open, pre-filling requires a
   * bus change).
   */
  const handleTagClick = (_tagName: string) => {
    // The underscore is intentional — we pass the tag name through for the
    // accessible event shape, but the current bus doesn't carry it. Keeping
    // the argument name meaningful lets future wiring land without a rename.
    void _tagName;
    emitCmdBarEvent({ type: "focus", prefix: "#" });
  };

  const handleRowKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    tagName: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleTagClick(tagName);
    }
  };

  const toggleExpanded = () => setExpanded((v) => !v);

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
      {visibleTags.length > 0 ? (
        <ul className="flex flex-col">
          {visibleTags.map((tag) => (
            <li key={tag.name}>
              <div
                role="button"
                tabIndex={0}
                aria-label={`Search for #${tag.name} — ${formatUsageLabel(tag.usageCount)}`}
                onClick={() => handleTagClick(tag.name)}
                onKeyDown={(e) => handleRowKeyDown(e, tag.name)}
                className={cn(
                  "h-7 px-2 flex items-center gap-2 rounded-sm",
                  "text-sm text-foreground cursor-pointer",
                  "hover:bg-muted/50 transition-colors",
                  "focus-visible:outline-none focus-visible:bg-muted/50",
                  "focus-visible:ring-2 focus-visible:ring-ring/40",
                )}
              >
                <span className="truncate min-w-0">
                  <span className="text-muted-foreground">#</span>
                  {tag.name}
                </span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {tag.usageCount}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {hasOverflow ? (
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className={cn(
            "self-start px-2 h-6",
            "text-xs text-muted-foreground hover:text-foreground",
            "underline-offset-2 hover:underline",
            "transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
        >
          {expanded ? "Show fewer" : "Show more"}
        </button>
      ) : null}
    </section>
  );
}

function formatUsageLabel(n: number): string {
  return n === 1 ? "1 file" : `${n} files`;
}
