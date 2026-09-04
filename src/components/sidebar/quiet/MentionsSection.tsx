/**
 * MentionsSection — top mentions by usage for the quiet-composer sidebar.
 *
 * Mirrors `TagsSection` feature-for-feature against `@mention` data instead
 * of `#tag` data. Queries the SQLite document index (via
 * `tauriApi.indexMentions`) for every mention in the current workspace's
 * projects and renders the top N rows ordered by `file_count` descending
 * (backend-sorted). Default cap is 5 — anything beyond that is revealed by
 * the "Show more" toggle. Cap and hide-section settings live alongside the
 * Tags equivalents in `settings-store`.
 *
 * Mentions come from the index, so there is no "add a mention" affordance
 * and no `+` button in the header. Clicking a row opens the
 * FloatingCommandBar in reference (`@`) mode via the `cmd-bar-events` bus —
 * same Phase-1 limitation as TagsSection: the bus does not yet carry a seed
 * filter, so the bar opens with a bare `@` prefix and lets the user type to
 * narrow the list.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { tauriApi, type IndexedMention } from "@/lib/tauri";
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
 * Default maximum number of mention rows shown before "Show more" expands
 * the list. Used as a fallback when neither an explicit `cap` prop nor the
 * persisted `sidebarMentionsCap` setting is available. Mirrors
 * `DEFAULT_TAG_CAP` so the two sidebar sections stay symmetric.
 */
export const DEFAULT_MENTION_CAP = 5;

export interface MentionsSectionProps {
  /**
   * Maximum number of mentions shown before the "Show more" toggle.
   * Production callers should rely on the `sidebarMentionsCap` setting; the
   * prop remains for tests and edge cases that need an explicit override.
   */
  cap?: number;
  /**
   * Case-insensitive substring filter applied to mention names. Mirrors the
   * `filter` prop on TagsSection — sidebar type-to-filter from QuietSidebar.
   */
  filter?: string;
}

interface MentionRow {
  name: string;
  usageCount: number;
}

export function MentionsSection({
  cap,
  filter,
}: MentionsSectionProps = {}) {
  const projects = useWorkspaceStore((s) => s.projects);
  const projectPaths = useMemo(
    () => projects.map((p) => p.path),
    [projects],
  );
  // Read cap from settings. Explicit `cap` prop still wins for tests/edge
  // cases. Falls back to DEFAULT_MENTION_CAP if the setting is missing
  // (shouldn't happen in production — the migration backfills it).
  // A cap of 0 hides the section entirely (the slider IS the visibility
  // control — see settings-store v11→v12 migration).
  const settingCap = useSettingsStore((s) => s.sidebarMentionsCap);
  const effectiveCap = cap ?? settingCap ?? DEFAULT_MENTION_CAP;

  const [mentions, setMentions] = useState<MentionRow[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Client-side filter on the cached mention list. Applied BEFORE
  // cap/overflow so "Show more" only surfaces when additional matches exist.
  const filteredMentions = useMemo(() => {
    if (!filter) return mentions;
    const needle = filter.toLowerCase();
    return mentions.filter((m) => m.name.toLowerCase().includes(needle));
  }, [mentions, filter]);

  // Latest-request guard so a stale fetch doesn't overwrite fresh state.
  // Mirrors the pattern used by `TagsSection` and `TagMode.tsx`.
  const reqIdRef = useRef(0);

  // Fetch mentions from the SQLite document index. An empty filter on the
  // backend returns the full set ordered by file_count descending, which is
  // exactly what we want here — the cap is applied client-side below.
  // Re-run whenever the project set changes (add/remove project).
  useEffect(() => {
    const reqId = ++reqIdRef.current;
    tauriApi
      .indexMentions(projectPaths, undefined)
      .then((rows: IndexedMention[]) => {
        if (reqId !== reqIdRef.current) return;
        setMentions(
          rows.map((r) => ({ name: r.mention, usageCount: r.file_count })),
        );
      })
      .catch(() => {
        if (reqId !== reqIdRef.current) return;
        setMentions([]);
      });
    // The stable-array memo (`projectPaths`) keeps this effect honest when
    // `projects` is re-created but paths are unchanged.
  }, [projectPaths]);

  // Auto-collapse when the filtered list shrinks below the cap — avoids a
  // stale "Show fewer" state after a project is removed, the mention count
  // drops, or the user narrows the type-to-filter past the overflow point.
  useEffect(() => {
    if (expanded && filteredMentions.length <= effectiveCap) {
      setExpanded(false);
    }
  }, [filteredMentions.length, effectiveCap, expanded]);

  const visibleMentions = expanded
    ? filteredMentions
    : filteredMentions.slice(0, effectiveCap);
  const hasOverflow = filteredMentions.length > effectiveCap;

  // Roving tabindex for ↑/↓ navigation within the mention list. Mention
  // names are unique within a workspace's index so they make a stable row
  // id. Same shape as TagsSection.
  const rowIds = useMemo(
    () => visibleMentions.map((m) => m.name),
    [visibleMentions],
  );
  const roving = useRovingTabindex({ rowIds });

  /**
   * Open the FloatingCommandBar in reference (@) mode. Same Phase-1
   * limitation as TagsSection: the `cmd-bar-events` bus carries a single
   * optional `prefix` character — there is no channel for seeding the
   * mention filter, so clicking "alice" today opens the bar with an empty
   * `@` prefix and lets the user type to narrow the list. A future
   * enhancement should add a `seed` field to `CmdBarEvent` so we can
   * pre-fill `@alice` on click.
   */
  const handleMentionClick = (mentionName: string) => {
    // Live-test 2026-04-26 (slice 2) — drilldown directly to the level-2
    // occurrences view in ReferenceMode. Mirrors TagsSection's tag click
    // behaviour.
    emitCmdBarEvent({
      type: "focus",
      prefix: "@",
      drilldown: { kind: "mention", name: mentionName },
    });
  };

  const handleRowKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    mentionName: string,
  ) => {
    // ArrowUp / ArrowDown navigation first (cyclic, within section).
    roving.handleKeyDown(event, mentionName);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleMentionClick(mentionName);
    }
  };

  const toggleExpanded = () => setExpanded((v) => !v);

  // Cap of 0 hides the section entirely — the slider is the visibility
  // control. Render nothing so QuietSidebar's region count drops by one.
  if (effectiveCap === 0) return null;

  return (
    <section
      aria-label={t("section.mentions")}
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Mentions
        </h2>
      </header>
      {visibleMentions.length > 0 ? (
        <ul className="flex flex-col">
          {visibleMentions.map((mention) => (
            <li key={mention.name}>
              <div
                role="button"
                ref={(el) => roving.registerRef(mention.name, el)}
                tabIndex={roving.getTabIndex(mention.name)}
                aria-label={`Search for @${mention.name} — ${formatUsageLabel(mention.usageCount)}`}
                onClick={() => handleMentionClick(mention.name)}
                onFocus={() => roving.handleFocus(mention.name)}
                onKeyDown={(e) => handleRowKeyDown(e, mention.name)}
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
                        <span className="text-muted-foreground">@</span>
                        {mention.name}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      @{mention.name}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {mention.usageCount}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {hasOverflow ? (
        // `tabIndex={-1}` per the audit 2026-04-27 finding #11 follow-up
        // — keeps the temporary "Show more" affordance out of the
        // natural Tab order. Mouse users still see and click it; users
        // who want a permanent larger view bump the cap in
        // Settings > Appearance > Sidebar Composition.
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
