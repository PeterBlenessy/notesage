// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { RefinementCard } from '../RefinementCard';
import { useRefinementStore } from '@/stores/refinement-store';
import type { RefinementEntry, RefinementVerdict } from '@/lib/ai/refinement';

function makeEntry(over: Partial<RefinementEntry> = {}): RefinementEntry {
  return {
    id: 'r1',
    docPath: '/d.md',
    anchor: { from: 2, to: 8 },
    srcHash: 'h',
    originalText: 'follow up with the team',
    result: {
      verdict: 'sharpen' as RefinementVerdict,
      outcome: 'Email the team Friday re: launch checklist',
      steps: [{ text: 'draft email' }],
      rationale: 'no owner/date',
    },
    status: 'pending',
    createdAt: 1,
    ...over,
  };
}

describe('RefinementCard', () => {
  beforeEach(() => {
    useRefinementStore.setState({
      entries: [makeEntry()],
      seen: new Set<string>(),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders verdict badge, struck original, outcome, and step count', () => {
    renderWithProviders(<RefinementCard entry={makeEntry()} />);
    expect(screen.getByText('Sharpen')).toBeTruthy();
    expect(screen.getByText('follow up with the team')).toBeTruthy();
    expect(screen.getByText('Email the team Friday re: launch checklist')).toBeTruthy();
    expect(screen.getByText('1 sub-step')).toBeTruthy();
  });

  it('Apply dispatches notesage:apply-refinement with the id', () => {
    const spy = vi.fn();
    window.addEventListener('notesage:apply-refinement', spy);
    renderWithProviders(<RefinementCard entry={makeEntry()} />);
    fireEvent.click(screen.getByLabelText('Apply suggestion'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'r1' });
    window.removeEventListener('notesage:apply-refinement', spy);
  });

  it('Jump dispatches notesage:jump-to-refinement with the id', () => {
    const spy = vi.fn();
    window.addEventListener('notesage:jump-to-refinement', spy);
    renderWithProviders(<RefinementCard entry={makeEntry()} />);
    fireEvent.click(screen.getByLabelText('Jump to line'));
    expect((spy.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'r1' });
    window.removeEventListener('notesage:jump-to-refinement', spy);
  });

  it('Dismiss removes the entry from the store', () => {
    renderWithProviders(<RefinementCard entry={makeEntry()} />);
    expect(useRefinementStore.getState().entries).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(useRefinementStore.getState().entries).toHaveLength(0);
  });

  it('shows the error state instead of the outcome when entry.error is set', () => {
    renderWithProviders(<RefinementCard entry={makeEntry({ error: 'boom' })} />);
    expect(screen.getByText("Couldn't refine this line")).toBeTruthy();
    expect(screen.queryByText('Email the team Friday re: launch checklist')).toBeNull();
  });
});
