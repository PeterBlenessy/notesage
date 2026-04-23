import * as React from 'react';
import { Sun, Sliders, Sparkles, Blocks, FolderOpen, ShieldCheck, Code, Info } from 'lucide-react';
import { SettingsShell, type SettingsShellNavGroup } from './SettingsShell';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

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

/**
 * Internal demo / scaffold for the new settings shell. Not mounted in the
 * app yet — task #63 only delivers the shell and primitives. Real panel
 * migration happens in #65, #66, #67. The component exists so the primitives
 * compile, tree-shake cleanly, and render in isolation for tests and future
 * dev-flag wiring.
 */
export function SettingsDialogV2({
  open,
  onOpenChange,
  initialActiveItem = 'appearance',
}: SettingsDialogV2Props) {
  const [active, setActive] = React.useState(initialActiveItem);

  return (
    <SettingsShell
      open={open}
      onOpenChange={onOpenChange}
      nav={NAV}
      activeItem={active}
      onActiveItemChange={setActive}
    >
      <header className="mb-8 pb-6 border-b border-border">
        <h2 className="text-[24px] font-semibold tracking-tight">
          {NAV.flatMap((g) => g.items).find((i) => i.id === active)?.label ??
            'Settings'}
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
  );
}
