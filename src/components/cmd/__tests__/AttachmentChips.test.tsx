// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import AttachmentChips, {
  type AttachmentChip,
} from '@/components/cmd/AttachmentChips';

// ---------------------------------------------------------------------------
// AttachmentChips — pure presentation tests
// ---------------------------------------------------------------------------

const noop = () => {};

describe('AttachmentChips', () => {
  it('renders nothing when chips array is empty', () => {
    const { container } = renderWithProviders(
      <AttachmentChips chips={[]} onRemove={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one chip per item with the correct visible name', () => {
    const chips: AttachmentChip[] = [
      { id: '1', kind: 'file', name: 'README.md' },
      { id: '2', kind: 'person', name: 'Alice' },
      { id: '3', kind: 'comment', name: 'Discussion thread' },
    ];

    renderWithProviders(<AttachmentChips chips={chips} onRemove={noop} />);

    expect(screen.getByText('README.md')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Discussion thread')).toBeTruthy();
  });

  it('renders a remove button per chip with an aria-label that includes the name', () => {
    const chips: AttachmentChip[] = [
      { id: '1', kind: 'file', name: 'README.md' },
      { id: '2', kind: 'tag', name: 'important' },
    ];

    renderWithProviders(<AttachmentChips chips={chips} onRemove={noop} />);

    expect(screen.getByLabelText('Remove README.md')).toBeTruthy();
    expect(screen.getByLabelText('Remove important')).toBeTruthy();
  });

  it('calls onRemove with the chip id exactly once when × is clicked', () => {
    const chips: AttachmentChip[] = [
      { id: 'chip-A', kind: 'file', name: 'a.md' },
      { id: 'chip-B', kind: 'file', name: 'b.md' },
    ];
    const onRemove = vi.fn();

    renderWithProviders(<AttachmentChips chips={chips} onRemove={onRemove} />);

    fireEvent.click(screen.getByLabelText('Remove a.md'));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('chip-A');
  });

  it('renders an icon per chip — distinct icons across kinds', () => {
    const chips: AttachmentChip[] = [
      { id: '1', kind: 'file', name: 'doc.md' },
      { id: '2', kind: 'person', name: 'Bob' },
      { id: '3', kind: 'comment', name: 'thread' },
      { id: '4', kind: 'tag', name: 'work' },
      { id: '5', kind: 'task', name: 'fix bug' },
      { id: '6', kind: 'research', name: 'paper' },
    ];

    const { container } = renderWithProviders(
      <AttachmentChips chips={chips} onRemove={noop} />,
    );

    // Each chip carries a `data-chip-kind` marker we can count and inspect.
    const renderedKinds = Array.from(
      container.querySelectorAll<HTMLElement>('[data-chip-kind]'),
    ).map((el) => el.dataset.chipKind);

    expect(renderedKinds).toEqual([
      'file',
      'person',
      'comment',
      'tag',
      'task',
      'research',
    ]);

    // Each chip must contain at least one SVG (the lucide icon).
    container.querySelectorAll('[data-chip-kind]').forEach((chip) => {
      expect(chip.querySelector('svg')).toBeTruthy();
    });
  });

  it('truncates long names visually via the truncate utility class', () => {
    const longName =
      'this-is-a-deliberately-very-long-attachment-name-that-overflows.md';
    const chips: AttachmentChip[] = [
      { id: '1', kind: 'file', name: longName },
    ];

    const { container } = renderWithProviders(
      <AttachmentChips chips={chips} onRemove={noop} />,
    );

    const nameSpan = container.querySelector<HTMLElement>(
      '[data-chip-name="true"]',
    );
    expect(nameSpan).toBeTruthy();
    expect(nameSpan!.className).toMatch(/truncate/);
  });
});
