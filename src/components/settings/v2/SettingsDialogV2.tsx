import * as React from 'react';
import {
  Sun,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  Blocks,
  FolderOpen,
  ShieldCheck,
  Code,
  Info,
} from 'lucide-react';
import { SettingsShell, type SettingsShellNavGroup } from './SettingsShell';
import {
  SettingsSearch,
  SettingsSearchContext,
  matchesSettingsQuery,
  useSettingsSearchShortcut,
} from './SettingsSearch';
import { AppearanceSettings } from './AppearanceSettings';
import { GeneralSettings } from './GeneralSettings';
import { EditorSettings } from './EditorSettings';
import { AISettings } from './AISettings';
import { SkillsSettings } from './SkillsSettings';
import { ProjectsSettings } from './ProjectsSettings';
import { PrivacySettings } from './PrivacySettings';
import { AdvancedSettings } from './AdvancedSettings';
import { AboutSettings } from './AboutSettings';
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
 * Nav taxonomy per Mockup E. Each downstream task (#65 Appearance, #66 the
 * other non-AI panels, #67 AI & Agents) will replace the placeholder body
 * below with its migrated panel component.
 */
const NAV: SettingsShellNavGroup[] = [
  {
    id: 'notesage',
    label: 'Notesage',
    items: [
      { id: 'appearance', label: 'Appearance', icon: Sun },
      { id: 'general', label: 'General', icon: SettingsIcon },
      { id: 'editor', label: 'Editor', icon: Sliders },
      { id: 'ai', label: 'AI & Agents', icon: Sparkles },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'skills', label: 'Skills', icon: Blocks },
      { id: 'projects', label: 'Projects', icon: FolderOpen },
      { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
      { id: 'advanced', label: 'Advanced', icon: Code },
    ],
  },
  {
    id: 'about',
    label: 'About',
    items: [{ id: 'about', label: 'About', icon: Info }],
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
 * New settings dialog mounted in App.tsx under the Quiet Composer
 * preview (`uiPreview === 'quiet-composer'`). Wraps the per-area panel
 * components delivered by tasks #65 / #66 / #67 in the shared
 * `SettingsShell` + `SettingsSearch` chrome.
 *
 * The search ⌘F header narrows both the nav list (via `filterNav`) and
 * individual rows inside each panel (via `SettingsSearchContext`).
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

  const filteredNav = React.useMemo(() => filterNav(NAV, query), [query]);
  const totalItems = React.useMemo(
    () => NAV.reduce((acc, g) => acc + g.items.length, 0),
    [],
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

  return (
    <SettingsSearchContext.Provider value={{ query }}>
      <SettingsShell
        open={open}
        onOpenChange={onOpenChange}
        nav={filteredNav}
        activeItem={active}
        onActiveItemChange={setActive}
        navHeader={navHeader}
      >
        {active === 'appearance' && <AppearanceSettings />}
        {active === 'general' && <GeneralSettings />}
        {active === 'editor' && <EditorSettings />}
        {active === 'ai' && <AISettings />}
        {active === 'skills' && <SkillsSettings />}
        {active === 'projects' && <ProjectsSettings />}
        {active === 'privacy' && <PrivacySettings />}
        {active === 'advanced' && <AdvancedSettings />}
        {active === 'about' && (
          <AboutSettings
            updateState={updateState}
            onCheckForUpdate={onCheckForUpdate}
            onOpenUpdateDialog={onOpenUpdateDialog}
            onDismissSettings={() => onOpenChange(false)}
          />
        )}
      </SettingsShell>
    </SettingsSearchContext.Provider>
  );
}
