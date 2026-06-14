// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
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

// Mock shape mirrors the real skill-store API SkillMode consumes:
//  - `skills` / `enabledOverrides` are selected as stable inputs (2026-04-24
//    fix for a getSnapshot-caching crash — see SkillMode.tsx for context).
//  - `getState()` is called imperatively from a useMemo to derive the active
//    set.
vi.mock('@/stores/skill-store', () => {
  const state = {
    skills: [] as SkillEntry[],
    enabledOverrides: {} as Record<string, boolean>,
    getActiveSkills: () => activeSkills,
  };
  return {
    useSkillStore: Object.assign(
      vi.fn((selector?: (s: typeof state) => unknown) =>
        selector ? selector(state) : state,
      ),
      { getState: () => state },
    ),
  };
});

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

  it('filters by name PREFIX (case-insensitive), not substring', () => {
    renderWithProviders(<SkillMode filter="web" onPick={vi.fn()} />);

    expect(screen.getByText('web-search')).toBeTruthy();
    expect(screen.queryByText('save-research')).toBeNull();
    expect(screen.queryByText('tag-cloud')).toBeNull();
  });

  it('does NOT match a substring that is not a prefix', () => {
    // "search" appears inside "web-search" but is not a prefix → no match.
    renderWithProviders(<SkillMode filter="search" onPick={vi.fn()} />);

    expect(screen.queryByText('web-search')).toBeNull();
    expect(screen.getByText('No skills match')).toBeTruthy();
  });

  it('does NOT match on description (name prefix only)', () => {
    activeSkills = [
      {
        name: 'random-name',
        description: 'Search the web for things',
        path: '/skills/random',
        source: 'notesage-global',
        has_scripts: false,
        has_references: false,
      },
    ];

    renderWithProviders(<SkillMode filter="web" onPick={vi.fn()} />);

    // "web" is in the description but the name doesn't start with it → no match.
    expect(screen.queryByText('random-name')).toBeNull();
    expect(screen.getByText('No skills match')).toBeTruthy();
  });

  it('sorts results alphabetically by name', () => {
    renderWithProviders(<SkillMode filter="" onPick={vi.fn()} />);
    const rendered = screen
      .getAllByRole('option')
      .map((el) => el.querySelector('.font-medium')?.textContent);
    // Source order is web-search, save-research, tag-cloud → sorted A→Z.
    expect(rendered).toEqual(['save-research', 'tag-cloud', 'web-search']);
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
    renderWithProviders(<SkillMode filter="" onPick={onPick} />);

    // #138 — keyboard nav listens at window so the host bar's input keeps
    // focus. We dispatch on `window` to mirror the production wiring. Each
    // dispatch is wrapped in `act` so React commits the activeIndex bump
    // and the keydown handler closes over the new value before Enter fires.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    // Sorted order is [save-research, tag-cloud, web-search]; ArrowDown moves
    // from the first to the second row.
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('tag-cloud');
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

  // -------------------------------------------------------------------------
  // ARIA wiring contract (#78) — the picker exposes a stable listbox id so
  // the parent FloatingCommandBar combobox input can wire `aria-controls` /
  // `aria-activedescendant`. activeIndex changes are reported up via the
  // optional `onActiveOptionChange` callback.
  // -------------------------------------------------------------------------

  it('listbox carries the supplied id (default fallback when omitted)', () => {
    const { container } = renderWithProviders(
      <SkillMode filter="" onPick={vi.fn()} />,
    );
    const list = container.querySelector('[role="listbox"]') as HTMLElement;
    expect(list).toBeTruthy();
    expect(list.id).toBe('cmd-skill-listbox');
  });

  it('listbox honours an explicit listboxId prop', () => {
    const { container } = renderWithProviders(
      <SkillMode filter="" onPick={vi.fn()} listboxId="custom-id" />,
    );
    const list = container.querySelector('[role="listbox"]') as HTMLElement;
    expect(list.id).toBe('custom-id');
  });

  it('each option carries id="${listboxId}-opt-${i}"', () => {
    const { container } = renderWithProviders(
      <SkillMode filter="" onPick={vi.fn()} listboxId="lb" />,
    );
    const rows = container.querySelectorAll<HTMLElement>('[role="option"]');
    rows.forEach((row, i) => {
      expect(row.id).toBe(`lb-opt-${i}`);
    });
  });

  it('reports active option upward via onActiveOptionChange on mount + ↓', () => {
    const onActiveOptionChange = vi.fn();
    renderWithProviders(
      <SkillMode
        filter=""
        onPick={vi.fn()}
        listboxId="lb"
        onActiveOptionChange={onActiveOptionChange}
      />,
    );

    // Initial mount → activeIndex 0.
    expect(onActiveOptionChange).toHaveBeenCalled();
    const lastCall = onActiveOptionChange.mock.calls[onActiveOptionChange.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({
      listboxId: 'lb',
      activeOptionId: 'lb-opt-0',
    });
    expect(lastCall.count).toBeGreaterThan(0);

    // ↓ moves the highlight to index 1 → next callback fires.
    onActiveOptionChange.mockClear();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });

    const afterDown = onActiveOptionChange.mock.calls[onActiveOptionChange.mock.calls.length - 1][0];
    expect(afterDown.activeOptionId).toBe('lb-opt-1');
  });

  it('reports activeOptionId=null when the empty-state ("No skills match") is rendered', () => {
    const onActiveOptionChange = vi.fn();
    renderWithProviders(
      <SkillMode
        filter="zzz-no-match"
        onPick={vi.fn()}
        listboxId="lb"
        onActiveOptionChange={onActiveOptionChange}
      />,
    );

    expect(onActiveOptionChange).toHaveBeenCalled();
    const lastCall = onActiveOptionChange.mock.calls[onActiveOptionChange.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({
      listboxId: 'lb',
      activeOptionId: null,
      count: 0,
    });
  });

  // -------------------------------------------------------------------------
  // #138 regression — SkillMode must NOT steal DOM focus from its host. The
  // FloatingCommandBar input is a `role="combobox"` that mirrors the picker's
  // active option via `aria-activedescendant`; if SkillMode focuses its
  // listbox on mount the user can't keep typing into the input.
  // -------------------------------------------------------------------------

  it('does NOT steal DOM focus from the previously focused element on mount', () => {
    // Set up a focused input that simulates the FloatingCommandBar combobox.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    renderWithProviders(<SkillMode filter="" onPick={vi.fn()} />);

    // The input must STILL hold focus after the picker mounts.
    expect(document.activeElement).toBe(input);

    document.body.removeChild(input);
  });

  // -------------------------------------------------------------------------
  // #88 — active row styling: muted bg + accent border replaces solid fill
  // -------------------------------------------------------------------------

  it('active row uses neutral bg-muted/80 (matches PickerItem) — no accent border, no accent fill', () => {
    const { container } = renderWithProviders(<SkillMode filter="" onPick={vi.fn()} />);
    const activeRow = container.querySelector('[aria-selected="true"]') as HTMLElement;
    expect(activeRow).toBeTruthy();
    // New styling
    expect(activeRow.className).toContain('bg-muted/80');
    expect(activeRow.className).not.toContain('border-[var(--color-accent-primary)]');
    expect(activeRow.classList.contains('text-foreground')).toBe(true);
    // Old solid accent fill must be gone
    expect(activeRow.className).not.toContain('bg-[var(--color-accent-primary)]');
  });
});
