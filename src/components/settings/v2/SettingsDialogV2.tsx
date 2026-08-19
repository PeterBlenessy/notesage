import * as React from 'react';
import {
  Sun,
  Pencil,
  Sparkles,
  Blocks,
  FolderOpen,
  Cog,
  Mic,
  Zap,
  FlaskConical,
} from 'lucide-react';
import { SettingsShell, type SettingsShellNavGroup } from './SettingsShell';
import {
  SettingsSearch,
  SettingsSearchContext,
  matchesSettingsQuery,
  useSettingsSearchShortcut,
} from './SettingsSearch';
import { AppearanceSettings } from './AppearanceSettings';
import { LabsSettings } from './LabsSettings';
import { EditorSettings } from './EditorSettings';
import { AISettings } from './AISettings';
import { SkillsSettings } from './SkillsSettings';
import { ProjectsSettings } from './ProjectsSettings';
import { SystemSettings } from './SystemSettings';
import { VoiceSettings } from './VoiceSettings';
import { AutomationsSettings } from './AutomationsSettings';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { UpdateState } from '@/hooks/useAutoUpdate';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';

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
 * Live-test 2026-04-26 — remember the last-viewed panel across opens.
 *
 * The user's mental model is "I configure something, close, come back
 * later, want to land in the same place." We persist the active panel
 * id in `localStorage` (survives reloads) and consult it on open
 * UNLESS the caller passed a non-default `initialActiveItem` (the
 * deep-link case, e.g. `ExplainLockDialog` opening the `projects`
 * panel directly — the explicit prop wins). Default callers omit the
 * prop or pass `'appearance'`; for them we restore the stash.
 *
 * Stored value is a free-form string so adding new panels later
 * doesn't require a migration. Reads are wrapped in try/catch because
 * Safari private mode + locked-down iframes can throw on
 * `localStorage` access.
 */
const LAST_PANEL_STORAGE_KEY = 'notesage:settings-v2:last-panel';
const DEFAULT_PANEL_ID = 'appearance';

function readLastPanel(): string | null {
  try {
    const v = localStorage.getItem(LAST_PANEL_STORAGE_KEY);
    return v && typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeLastPanel(id: string): void {
  try {
    localStorage.setItem(LAST_PANEL_STORAGE_KEY, id);
  } catch {
    /* noop — storage may be locked down (Safari private mode, etc.) */
  }
}

/**
 * Nav taxonomy after the 2026-04-26 consolidation: 6 panels in a single
 * group. Privacy / Advanced / About panels were folded into the survivors
 * (Approvals → AI; Diagnostics + Show Hidden Files → System; version /
 * Changelog / Updates → System).
 */
/**
 * Built per call, NOT a module-level constant.
 *
 * `t()` reads module state. Evaluated once at import, these labels would keep
 * whichever language was active when the module first loaded — switching
 * language would appear to do nothing, and Settings search (which matches
 * against `item.label`) would go on matching English while the UI showed
 * Swedish. Exported so a test can prove it re-reads.
 */
export function buildSettingsNav(): SettingsShellNavGroup[] {
  return [
  {
    id: 'notesage',
    label: t("settings.groupNotesage"),
    items: [
      { id: 'appearance', label: t("settings.appearance"), icon: Sun },
      { id: 'editor', label: t("settings.writing"), icon: Pencil },
      { id: 'ai', label: t("settings.aiProviders"), icon: Sparkles },
      { id: 'skills', label: t("settings.skillsAgents"), icon: Blocks },
      { id: 'voice', label: t("settings.voice"), icon: Mic },
      { id: 'projects', label: t("settings.projects"), icon: FolderOpen },
      { id: 'automations', label: t("settings.automations"), icon: Zap },
      { id: 'system', label: t("settings.system"), icon: Cog },
      { id: 'labs', label: t("settings.labs"), icon: FlaskConical },
    ],
  },
  ];
}

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

function buildPanels(): PanelEntry[] {
  return [
  { id: 'appearance', label: t("settings.appearance"), render: () => <AppearanceSettings /> },
  { id: 'editor', label: t("settings.writing"), render: () => <EditorSettings /> },
  { id: 'ai', label: t("settings.aiProviders"), render: () => <AISettings /> },
  { id: 'skills', label: t("settings.skillsAgents"), render: () => <SkillsSettings /> },
  { id: 'voice', label: t("settings.voice"), render: () => <VoiceSettings /> },
  { id: 'labs', label: t("settings.labs"), render: () => <LabsSettings /> },
  { id: 'projects', label: t("settings.projects"), render: () => <ProjectsSettings /> },
  { id: 'automations', label: t("settings.automations"), render: () => <AutomationsSettings /> },
  {
    id: 'system',
    label: t("settings.system"),
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
}

/**
 * Settings dialog mounted in App.tsx. Wraps the per-area panel
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
  initialActiveItem = DEFAULT_PANEL_ID,
  updateState,
  onCheckForUpdate,
  onOpenUpdateDialog,
}: SettingsDialogV2Props) {
  // Resolve the panel to land on: callers that explicitly request a
  // non-default panel (deep-link case) win; otherwise we restore the
  // last-viewed panel from `localStorage`, falling back to the default
  // when nothing is stashed yet.
  const resolveInitialPanel = React.useCallback(() => {
    if (initialActiveItem !== DEFAULT_PANEL_ID) return initialActiveItem;
    return readLastPanel() ?? DEFAULT_PANEL_ID;
  }, [initialActiveItem]);

  const [active, setActive] = React.useState(resolveInitialPanel);
  const [query, setQuery] = React.useState('');
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  // Sync `active` with `initialActiveItem` (or the remembered panel)
  // on every open transition so deep-linking from outside the dialog
  // (e.g. the ExplainLockDialog "Project Settings > AI Provider Lock"
  // link) lands on the correct panel even when the dialog has been
  // opened before. Without this, `useState(...)` captured the prop
  // only on first mount and ignored subsequent prop changes — the
  // dead-end the user hit pre-2026-04-26.
  //
  // Live-test 2026-04-26 follow-up: when no caller deep-link is
  // active, we now ALSO consult `readLastPanel()` so the dialog
  // re-opens on the user's last panel — this makes ⌘, feel like
  // "open Settings where I left it." Explicit deep-links still win.
  const prevOpenRef = React.useRef(open);
  React.useEffect(() => {
    if (open && !prevOpenRef.current) setActive(resolveInitialPanel());
    prevOpenRef.current = open;
  }, [open, resolveInitialPanel]);

  useSettingsSearchShortcut(searchInputRef, open);

  // Rebuilt per render so the labels follow the chosen language; `useLocale`
  // is what makes that render happen when the language changes.
  useLocale();
  const nav = buildSettingsNav();
  const panels = buildPanels();

  // Hide the Projects panel from the nav when there are no projects in
  // the workspace — there's nothing to configure (live-test 2026-04-26).
  const hasProjects = useWorkspaceStore((s) => s.projects.length > 0);
  const visibleNav = React.useMemo(
    () =>
      hasProjects
        ? nav
        : nav.map((g) => ({
            ...g,
            items: g.items.filter((i) => i.id !== 'projects'),
          })).filter((g) => g.items.length > 0),
    [hasProjects, nav],
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
          // Live-test 2026-04-26 — stash the picked panel so the next
          // open lands on it (unless the caller deep-links to a
          // specific panel, which wins via `resolveInitialPanel`).
          writeLastPanel(id);
          // Picking a panel from the nav clears the search so the
          // user sees that panel's full content.
          if (isSearching) setQuery('');
        }}
        navHeader={navHeader}
      >
        {isSearching ? (
          <SearchAllPanels panels={panels} helpers={helpers} />
        ) : (
          panels.find((p) => p.id === active)?.render(helpers)
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
