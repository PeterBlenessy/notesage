import { PinnedSection } from "./PinnedSection";
import { ProjectsSection } from "./ProjectsSection";
import { RecentSection } from "./RecentSection";
import { TagsSection } from "./TagsSection";

/**
 * QuietSidebar — flat-list sidebar shell for the quiet-composer UI refresh
 * (PRD `2026-04-21-ui-refresh`, task #30).
 *
 * Renders four stacked sections in fixed order: Pinned, Projects, Recent,
 * Tags. Sections are empty stubs — G2 tasks #31–#34 wire them to the
 * workspace-store, editor-store, and SQLite index respectively.
 *
 * Only mounted when `settings.uiPreview === "quiet-composer"`. That gate
 * lives on `QuietLayout`, so this component does not need its own flag check.
 */

export function QuietSidebar() {
  return (
    <nav
      aria-label="Workspace sidebar"
      className="flex flex-col gap-4 overflow-y-auto p-2 h-full min-h-0"
    >
      <PinnedSection />
      <ProjectsSection />
      <RecentSection />
      <TagsSection />
    </nav>
  );
}
