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
import { useSettingsStore } from "@/stores/settings-store";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { useRovingTabindex } from "@/components/sidebar/quiet/useRovingTabindex";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "@/lib/i18n";

/**
 * Default maximum number of tag rows shown before "Show more" expands the
 * list. Used as a fallback when neither an explicit `cap` prop nor the
 * persisted `sidebarTagsCap` setting is available. Task #35 threaded the
 * setting through; this constant remains exported for tests that want to
 * assert against the same value the store starts from.
 */
export const DEFAULT_TAG_CAP = 5;

export interface TagsSectionProps {
  /**
   * Maximum number of tags shown before the "Show more" toggle. Production
   * callers should rely on the `sidebarTagsCap` setting (task #35); the prop
   * remains for tests and edge cases that need an explicit override.
   */
  cap?: number;
  /**
   * Case-insensitive substring filter applied to tag names. Task #43 —
   * sidebar type-to-filter. Matching is client-side; no re-fetch of the
   * SQLite index. Empty / undefined = no filter.
   */
  filter?: string;
}

interface TagRow {
  name: string;
  usageCount: number;
}

export function TagsSection({
  cap,
  filter,
}: TagsSectionProps = {}) {
  const projects = useWorkspaceStore((s) => s.projects);
  const projectPaths = useMemo(
    () => projects.map((p) => p.path),
    [projects],
  );
  // Task #35 — read cap from settings. Explicit `cap` prop still wins for
  // tests/edge cases. Falls back to DEFAULT_TAG_CAP if the setting is missing
  // (shouldn't happen in production — the migration backfills it).
  // A cap of 0 hides the section entirely (the slider IS the visibility
  // control — see settings-store v11→v12 migration).
  const settingCap = useSettingsStore((s) => s.sidebarTagsCap);
  const effectiveCap = cap ?? settingCap ?? DEFAULT_TAG_CAP;

  const [tags, setTags] = useState<TagRow[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Client-side filter on the cached tag list. Applied BEFORE cap/overflow
  // so "Show more" only surfaces when additional matches exist.
  const filteredTags = useMemo(() => {
    if (!filter) return tags;
    const needle = filter.toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tags, filter]);

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

  // Auto-collapse when the filtered list shrinks below the cap — avoids a
  // stale "Show fewer" state after a project is removed, the tag count
  // drops, or the user narrows the type-to-filter past the overflow point.
  useEffect(() => {
    if (expanded && filteredTags.length <= effectiveCap) {
      setExpanded(false);
    }
  }, [filteredTags.length, effectiveCap, expanded]);

  const visibleTags = expanded ? filteredTags : filteredTags.slice(0, effectiveCap);
  const hasOverflow = filteredTags.length > effectiveCap;

  // #80 — roving tabindex for ↑/↓ navigation within the tag list. Tag names
  // are unique within a workspace's index, so they make a stable row id. No
  // rename / context menu / hover-peek primitives apply to tags — this hook
  // is the only #80 wiring TagsSection needs.
  const rowIds = useMemo(() => visibleTags.map((t) => t.name), [visibleTags]);
  const roving = useRovingTabindex({ rowIds });

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
  const handleTagClick = (tagName: string) => {
    // Live-test 2026-04-26 (slice 2) — emit a `drilldown` payload so the
    // cmd bar mounts directly at TagMode's level-2 view (occurrences for
    // this tag) instead of the level-1 list. Saves one click.
    emitCmdBarEvent({
      type: "focus",
      prefix: "#",
      drilldown: { kind: "tag", name: tagName },
    });
  };

  const handleRowKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    tagName: string,
  ) => {
    // ArrowUp / ArrowDown navigation first (cyclic, within section).
    roving.handleKeyDown(event, tagName);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleTagClick(tagName);
    }
  };

  const toggleExpanded = () => setExpanded((v) => !v);

  // Cap of 0 hides the section entirely — the slider is the visibility
  // control. Render nothing so QuietSidebar's region count drops by one.
  if (effectiveCap === 0) return null;

  return (
    <section
      aria-label={t("section.tags")}
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
                ref={(el) => roving.registerRef(tag.name, el)}
                tabIndex={roving.getTabIndex(tag.name)}
                aria-label={`Search for #${tag.name} — ${formatUsageLabel(tag.usageCount)}`}
                onClick={() => handleTagClick(tag.name)}
                onFocus={() => roving.handleFocus(tag.name)}
                onKeyDown={(e) => handleRowKeyDown(e, tag.name)}
                className={cn(
                  "relative h-7 px-2 flex items-center gap-2 rounded-sm",
                  "text-[13px] text-foreground cursor-default",
                  "hover:bg-muted/50 transition-colors",
                  "focus-visible:outline-none focus-visible:bg-muted/50",
                  "focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] focus-visible:z-10",
                )}
              >
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate min-w-0">
                        <span className="text-muted-foreground">#</span>
                        {tag.name}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      #{tag.name}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {tag.usageCount}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {hasOverflow ? (
        // `tabIndex={-1}` keeps the temporary "Show more" affordance out
        // of the natural Tab order so Tab from a tag row jumps straight
        // to the next section's first row (audit 2026-04-27 finding #11
        // follow-up — same philosophy as the section-header `+` and the
        // per-row `+`). Users who want a permanent larger view bump the
        // cap in Settings > Appearance > Sidebar Composition.
        <button
          type="button"
          tabIndex={-1}
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className={cn(
            "self-start px-2 h-6",
            "text-xs text-muted-foreground hover:text-foreground",
            "underline-offset-2 hover:underline",
            "transition-colors",
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
