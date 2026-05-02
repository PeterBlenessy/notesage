// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
} from '@/test/component-harness';
import PaletteMode, {
  PALETTE_COMMANDS,
} from '@/components/cmd/modes/PaletteMode';

// ---------------------------------------------------------------------------
// PaletteMode — `>` prefix picker (Phase 1, task #19)
// ---------------------------------------------------------------------------

const noop = () => {};

describe('PaletteMode', () => {
  it('renders all commands when filter is empty', () => {
    const onPick = vi.fn();
    renderWithProviders(
      <PaletteMode filter="" onPick={onPick} />,
    );

    // Every command from the registry must surface a row.
    for (const cmd of PALETTE_COMMANDS) {
      expect(screen.getByText(cmd.label)).toBeTruthy();
    }
  });

  it('filters by case-insensitive substring on label', () => {
    renderWithProviders(<PaletteMode filter="new" onPick={noop} />);

    // "New note" (and "New project") match — both contain "new".
    expect(screen.getByText('New note')).toBeTruthy();
    expect(screen.getByText('New project')).toBeTruthy();

    // Unrelated entries are filtered out.
    expect(screen.queryByText('Toggle theme')).toBeNull();
    expect(screen.queryByText('Open settings')).toBeNull();
  });

  it('calls onPick with the command id exactly once when a row is clicked', () => {
    const onPick = vi.fn();
    renderWithProviders(<PaletteMode filter="" onPick={onPick} />);

    const newNote = PALETTE_COMMANDS.find((c) => c.label === 'New note');
    expect(newNote).toBeTruthy();

    // Rows expose role="option"; the row label is rendered inside.
    fireEvent.click(screen.getByRole('option', { name: /new note/i }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(newNote!.id);
  });

  it('renders a shortcut hint for each command that defines one', () => {
    renderWithProviders(<PaletteMode filter="" onPick={noop} />);

    for (const cmd of PALETTE_COMMANDS) {
      if (cmd.shortcut) {
        // Shortcut hints surface as text. Use a regex with the literal — the
        // strings include glyphs like ⌘ which RTL handles fine.
        expect(screen.getAllByText(cmd.shortcut).length).toBeGreaterThan(0);
      }
    }
  });

  it('selects the second result on ↓ + Enter', () => {
    const onPick = vi.fn();
    const { container } = renderWithProviders(
      <PaletteMode filter="" onPick={onPick} />,
    );

    // ArrowDown moves the highlight from the first row (index 0) to the
    // second row (index 1). Enter then picks it.
    const list = container.querySelector('[data-palette-list="true"]');
    expect(list).toBeTruthy();
    fireEvent.keyDown(list!, { key: 'ArrowDown' });
    fireEvent.keyDown(list!, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(PALETTE_COMMANDS[1].id);
  });

  it('shows an empty-state message when no commands match the filter', () => {
    renderWithProviders(
      <PaletteMode filter="zzznopecommand" onPick={noop} />,
    );

    expect(screen.getByText('No commands match')).toBeTruthy();
  });

  it('does not include any "Preview HTML" command in the registry', () => {
    // Hard guarantee — task #72 removes Preview HTML, so #19 must not bring
    // it back through the side door.
    for (const cmd of PALETTE_COMMANDS) {
      expect(cmd.label).not.toMatch(/preview.*html/i);
      expect(cmd.id).not.toMatch(/preview.*html/i);
    }

    renderWithProviders(<PaletteMode filter="preview" onPick={noop} />);
    expect(screen.queryByText(/preview.*html/i)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // #88 — active row styling: muted bg + accent border replaces solid fill
  // -------------------------------------------------------------------------

  it('active row uses neutral bg-muted/80 (matches PickerItem) — no accent border, no accent fill', () => {
    const { container } = renderWithProviders(<PaletteMode filter="" onPick={noop} />);
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
