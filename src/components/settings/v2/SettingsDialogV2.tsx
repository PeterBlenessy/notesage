import * as React from 'react';
import { Sun, Sliders, Sparkles, Blocks, FolderOpen, ShieldCheck, Code, Info } from 'lucide-react';
import { SettingsShell, type SettingsShellNavGroup } from './SettingsShell';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';
import {
  SettingsSearch,
  SettingsSearchContext,
  matchesSettingsQuery,
  useSettingsSearchShortcut,
} from './SettingsSearch';

export interface SettingsDialogV2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional initial active nav item id. Defaults to "appearance". */
  initialActiveItem?: string;
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
 * Internal demo / scaffold for the new settings shell. Not mounted in the
 * app yet — task #63 delivered the shell and primitives, #64 adds the
 * search header (⌘F + nav filter + content-row cooperation via context).
 * Real panel migration happens in #65, #66, #67, at which point the panel
 * components will call `useSettingsSearchQuery()` to hide/highlight rows.
 */
export function SettingsDialogV2({
  open,
  onOpenChange,
  initialActiveItem = 'appearance',
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

  const currentLabel = NAV.flatMap((g) => g.items).find((i) => i.id === active)
    ?.label;

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
        <header className="mb-8 pb-6 border-b border-border">
          <h2 className="text-[24px] font-semibold tracking-tight">
            {currentLabel ?? 'Settings'}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground max-w-[520px] leading-relaxed">
            Panel coming soon. Real content lands in follow-up tasks (#65, #66,
            #67).
          </p>
        </header>

        <SettingsGroup label="Placeholder">
          <SettingsRow
            label="This is a preview"
            description="The real panels are migrated in later tasks. The shell, row, and group primitives are ready."
          />
        </SettingsGroup>
      </SettingsShell>
    </SettingsSearchContext.Provider>
  );
}
