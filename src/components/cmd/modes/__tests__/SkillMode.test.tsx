// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import type { SkillEntry } from '@/stores/skill-store';

// ---------------------------------------------------------------------------
// SkillMode — picker dropdown for the `/skill-name` prefix mode in the
// FloatingCommandBar. Pure presentation: parent (FloatingCommandBar) wires
// dispatch in a follow-up commit after all 6 mode pickers (#14–#19) land.
// ---------------------------------------------------------------------------

const mockSkills: SkillEntry[] = [
  {
    name: 'web-search',
    description: 'Search the web for current information',
    path: '/skills/web-search',
    source: 'notesage-global',
    has_scripts: true,
    has_references: false,
  },
  {
    name: 'save-research',
    description: 'Persist a research note with metadata',
    path: '/skills/save-research',
    source: 'notesage-global',
    has_scripts: true,
    has_references: false,
  },
  {
    name: 'tag-cloud',
    description: 'Build a tag frequency view',
    path: '/skills/tag-cloud',
    source: 'notesage-global',
    has_scripts: false,
    has_references: false,
  },
];

let activeSkills: SkillEntry[] = [];

vi.mock('@/stores/skill-store', () => ({
  useSkillStore: vi.fn((selector?: (state: unknown) => unknown) => {
    const state = {
      getActiveSkills: () => activeSkills,
    };
    return selector ? selector(state) : state;
  }),
}));

import SkillMode from '@/components/cmd/modes/SkillMode';

beforeEach(() => {
  activeSkills = [...mockSkills];
  vi.clearAllMocks();
});

describe('SkillMode', () => {
  it('renders all skills when filter is empty', () => {
    renderWithProviders(<SkillMode filter="" onPick={vi.fn()} />);

    expect(screen.getByText('web-search')).toBeTruthy();
    expect(screen.getByText('save-research')).toBeTruthy();
    expect(screen.getByText('tag-cloud')).toBeTruthy();
  });

  it('filters by name (case-insensitive substring)', () => {
    renderWithProviders(<SkillMode filter="web" onPick={vi.fn()} />);

    expect(screen.getByText('web-search')).toBeTruthy();
    expect(screen.queryByText('save-research')).toBeNull();
    expect(screen.queryByText('tag-cloud')).toBeNull();
  });

  it('filters by description when name does not match', () => {
    activeSkills = [
      {
        name: 'random-name',
        description: 'Search the web for things',
        path: '/skills/random',
        source: 'notesage-global',
        has_scripts: false,
        has_references: false,
      },
      {
        name: 'other-thing',
        description: 'Something unrelated',
        path: '/skills/other',
        source: 'notesage-global',
        has_scripts: false,
        has_references: false,
      },
    ];

    renderWithProviders(<SkillMode filter="web" onPick={vi.fn()} />);

    expect(screen.getByText('random-name')).toBeTruthy();
    expect(screen.queryByText('other-thing')).toBeNull();
  });

  it('calls onPick exactly once with the right name when a result is clicked', () => {
    const onPick = vi.fn();
    renderWithProviders(<SkillMode filter="" onPick={onPick} />);

    fireEvent.click(screen.getByText('save-research'));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('save-research');
  });

  it('selects second item with ArrowDown then fires onPick on Enter', () => {
    const onPick = vi.fn();
    const { container } = renderWithProviders(
      <SkillMode filter="" onPick={onPick} />,
    );

    const list = container.querySelector<HTMLElement>('[role="listbox"]');
    expect(list).toBeTruthy();

    fireEvent.keyDown(list!, { key: 'ArrowDown' });
    fireEvent.keyDown(list!, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('save-research');
  });

  it('shows "No skills match" when filter matches nothing', () => {
    renderWithProviders(<SkillMode filter="zzz-no-match" onPick={vi.fn()} />);

    expect(screen.getByText('No skills match')).toBeTruthy();
    expect(screen.queryByText('web-search')).toBeNull();
  });

  it('auto-highlights the first result on mount', () => {
    const { container } = renderWithProviders(
      <SkillMode filter="" onPick={vi.fn()} />,
    );

    const rows = container.querySelectorAll<HTMLElement>('[role="option"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    // Other rows should not be selected.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].getAttribute('aria-selected')).toBe('false');
    }
  });
});
