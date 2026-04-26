import * as React from 'react';
import {
  Sun,
  Pencil,
  Sparkles,
  Blocks,
  FolderOpen,
  Cog,
} from 'lucide-react';
import { SettingsShell, type SettingsShellNavGroup } from './SettingsShell';
import {
  SettingsSearch,
  SettingsSearchContext,
  matchesSettingsQuery,
  useSettingsSearchShortcut,
} from './SettingsSearch';
import { AppearanceSettings } from './AppearanceSettings';
import { EditorSettings } from './EditorSettings';
import { AISettings } from './AISettings';
import { SkillsSettings } from './SkillsSettings';
import { ProjectsSettings } from './ProjectsSettings';
import { SystemSettings } from './SystemSettings';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { UpdateState } from '@/hooks/useAutoUpdate';

export interface SettingsDialogV2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional initial active nav item id. Defaults to "appearance". */
  initialActiveItem?: string;
  /** Auto-update hook state + callbacks forwarded to the About panel. */
  updateState?: UpdateState;
  onCheckForUpdate?: () => Promise<void>;
  onOpenUpdateDialog?: () => void;
}

/**
 * Nav taxonomy after the 2026-04-26 consolidation: 6 panels in a single
 * group. Privacy / Advanced / About panels were folded into the survivors
 * (Approvals → AI; Diagnostics + Show Hidden Files → System; version /
 * Changelog / Updates → System).
 */
const NAV: SettingsShellNavGroup[] = [
  {
    id: 'notesage',
    label: 'Notesage',
    items: [
      { id: 'appearance', label: 'Appearance', icon: Sun },
      { id: 'editor', label: 'Writing', icon: Pencil },
      { id: 'ai', label: 'AI & Agents', icon: Sparkles },
      { id: 'skills', label: 'Skills', icon: Blocks },
      { id: 'projects', label: 'Projects', icon: FolderOpen },
      { id: 'system', label: 'System', icon: Cog },
    ],
  },
];

function filterNav(
  nav: SettingsShellNavGroup[],
  query: string,
): SettingsShellNavGroup[] {
  if (!query) return nav;
  return nav
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        matchesSettingsQuery(item.label, query),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Panels keyed by nav id. Used by the global-leaf-search mode (live-test
 * 2026-04-25 #9) to render every panel at once when the search query is
 * non-empty. The existing `SettingsRow` / `SettingsGroup` self-filtering
 * (live-test #147) handles hiding non-matching rows + empty groups, so
 * the user effectively sees a leaf-level result list grouped by panel.
 */
type PanelEntry = {
  id: string;
  label: string;
  render: (helpers: {
    updateState?: UpdateState;
    onCheckForUpdate?: () => Promise<void>;
    onOpenUpdateDialog?: () => void;
    onDismissSettings: () => void;
  }) => React.ReactNode;
};

const PANELS: PanelEntry[] = [
  { id: 'appearance', label: 'Appearance', render: () => <AppearanceSettings /> },
  { id: 'editor', label: 'Writing', render: () => <EditorSettings /> },
  { id: 'ai', label: 'AI & Agents', render: () => <AISettings /> },
  { id: 'skills', label: 'Skills', render: () => <SkillsSettings /> },
  { id: 'projects', label: 'Projects', render: () => <ProjectsSettings /> },
  {
    id: 'system',
    label: 'System',
    render: ({ updateState, onCheckForUpdate, onOpenUpdateDialog, onDismissSettings }) => (
      <SystemSettings
        updateState={updateState}
        onCheckForUpdate={onCheckForUpdate}
        onOpenUpdateDialog={onOpenUpdateDialog}
        onDismissSettings={onDismissSettings}
      />
    ),
  },
];

/**
 * New settings dialog mounted in App.tsx under the Quiet Composer
 * preview (`uiPreview === 'quiet-composer'`). Wraps the per-area panel
 * components delivered by tasks #65 / #66 / #67 in the shared
 * `SettingsShell` + `SettingsSearch` chrome.
 *
 * Search behaviour:
 * - Empty query: only the active panel renders (default browse mode).
 * - Non-empty query (live-test 2026-04-25 #9): EVERY panel renders in
 *   a single scrollable column, each prefixed with its panel name.
 *   `SettingsRow` self-hides non-matching rows (#147), `SettingsGroup`
 *   self-hides empty groups (#147), and we also hide a panel section
 *   entirely when none of its rows survived the filter — by tagging
 *   the wrapper with a `:has(...)` selector. The user gets leaf-level
 *   results grouped by panel without us building a separate registry.
 *
 * The nav still highlights matching panels so the user can use the
 * sidebar as a jump target alongside the global result list.
 */
export function SettingsDialogV2({
  open,
  onOpenChange,
  initialActiveItem = 'appearance',
  updateState,
  onCheckForUpdate,
  onOpenUpdateDialog,
}: SettingsDialogV2Props) {
  const [active, setActive] = React.useState(initialActiveItem);
  const [query, setQuery] = React.useState('');
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  useSettingsSearchShortcut(searchInputRef, open);

  // Hide the Projects panel from the nav when there are no projects in
  // the workspace — there's nothing to configure (live-test 2026-04-26).
  const hasProjects = useWorkspaceStore((s) => s.projects.length > 0);
  const visibleNav = React.useMemo(
    () =>
      hasProjects
        ? NAV
        : NAV.map((g) => ({
            ...g,
            items: g.items.filter((i) => i.id !== 'projects'),
          })).filter((g) => g.items.length > 0),
    [hasProjects],
  );

  const filteredNav = React.useMemo(
    () => filterNav(visibleNav, query),
    [visibleNav, query],
  );
  const totalItems = React.useMemo(
    () => visibleNav.reduce((acc, g) => acc + g.items.length, 0),
    [visibleNav],
  );
  const matchCount = React.useMemo(
    () => filteredNav.reduce((acc, g) => acc + g.items.length, 0),
    [filteredNav],
  );

  const navHeader = (
    <SettingsSearch
      ref={searchInputRef}
      value={query}
      onChange={setQuery}
      matchCount={matchCount}
      totalCount={totalItems}
    />
  );

  const helpers = {
    updateState,
    onCheckForUpdate,
    onOpenUpdateDialog,
    onDismissSettings: () => onOpenChange(false),
  };

  const isSearching = query.trim().length > 0;

  return (
    <SettingsSearchContext.Provider value={{ query }}>
      <SettingsShell
        open={open}
        onOpenChange={onOpenChange}
        // When searching, don't filter the nav by panel-label match —
        // the global results below cover that need, and dimming
        // unmatched panels in the nav while results show in the body
        // would feel inconsistent. Still respects the no-projects hide
        // (`visibleNav`) so an empty workspace doesn't show Projects.
        nav={isSearching ? visibleNav : filteredNav}
        activeItem={active}
        onActiveItemChange={(id) => {
          setActive(id);
          // Picking a panel from the nav clears the search so the
          // user sees that panel's full content.
          if (isSearching) setQuery('');
        }}
        navHeader={navHeader}
      >
        {isSearching ? (
          <SearchAllPanels panels={PANELS} helpers={helpers} />
        ) : (
          PANELS.find((p) => p.id === active)?.render(helpers)
        )}
      </SettingsShell>
    </SettingsSearchContext.Provider>
  );
}

/**
 * Renders every panel in sequence with a small "from <panel>" header
 * above each. The panels' own `SettingsRow` / `SettingsGroup`
 * self-filtering hides non-matching rows + empty groups; the
 * `:has(*)` selector here additionally hides any panel section that
 * ended up with zero visible content, so the user only sees panels
 * that actually contain a match.
 */
function SearchAllPanels({
  panels,
  helpers,
}: {
  panels: PanelEntry[];
  helpers: {
    updateState?: UpdateState;
    onCheckForUpdate?: () => Promise<void>;
    onOpenUpdateDialog?: () => void;
    onDismissSettings: () => void;
  };
}) {
  return (
    <div className="space-y-8">
      {panels.map((panel) => (
        // `:has(section, header, [data-settings-row])` keeps the
        // wrapper visible only when the panel still rendered some
        // content under the active query. Panels that filter to zero
        // rows collapse out entirely.
        <div
          key={panel.id}
          className="empty:hidden [&:not(:has(*))]:hidden"
          data-search-panel={panel.id}
        >
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {panel.label}
          </h2>
          {panel.render(helpers)}
        </div>
      ))}
    </div>
  );
}
