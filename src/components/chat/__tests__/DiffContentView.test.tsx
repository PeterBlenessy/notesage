// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { DiffContentView } from '../segments/DiffContentView';

describe('DiffContentView', () => {
  it('renders a collapsed summary by default', () => {
    render(
      <DiffContentView
        path="/src/App.tsx"
        oldText="one\ntwo"
        newText="one\ntwo-updated"
      />,
    );
    // Summary contains the basename
    expect(screen.getByRole('button').textContent).toContain('App.tsx');
    // Body is not rendered while collapsed — the full-path file header is absent
    expect(screen.queryByTitle('/src/App.tsx')).toBeNull();
  });

  it('shows the "new file" badge when oldText is undefined', () => {
    render(<DiffContentView path="/src/new.ts" newText="hello" />);
    expect(screen.getByText(/new file/i)).toBeTruthy();
  });

  it('shows the "deleted" badge when newText is empty', () => {
    render(<DiffContentView path="/src/gone.ts" oldText="bye" newText="" />);
    expect(screen.getByText(/^deleted$/i)).toBeTruthy();
  });

  it('reports addition/deletion counts in the summary', () => {
    render(
      <DiffContentView
        path="/src/App.tsx"
        oldText={'keep\nold-line\nkeep'}
        newText={'keep\nnew-line\nkeep'}
      />,
    );
    const summary = screen.getByRole('button').textContent ?? '';
    expect(summary).toMatch(/1 addition/);
    expect(summary).toMatch(/1 deletion/);
  });

  it('expands on click and shows diff lines', () => {
    render(
      <DiffContentView
        path="/src/App.tsx"
        oldText={'foo\nbar\nbaz'}
        newText={'foo\nbar\nqux'}
      />,
    );
    // Click the toggle button (first button)
    const toggle = screen.getAllByRole('button')[0];
    fireEvent.click(toggle);

    // Full path header appears in expanded state
    expect(screen.getByTitle('/src/App.tsx')).toBeTruthy();
    // The new line should be rendered somewhere in the expanded body
    expect(screen.getByText('qux')).toBeTruthy();
  });

  it('does not crash on identical old and new text', () => {
    render(
      <DiffContentView path="/f.ts" oldText="same" newText="same" />,
    );
    const toggle = screen.getAllByRole('button')[0];
    fireEvent.click(toggle);
    // Empty diff body shows "No changes" — disambiguate from the summary which
    // also includes "no changes".
    expect(screen.getByText('No changes')).toBeTruthy();
  });
});
