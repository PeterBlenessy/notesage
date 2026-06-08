// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { FrontmatterBlock } from '../FrontmatterBlock';

function openPanel() {
  fireEvent.click(screen.getByText('Frontmatter'));
}

describe('FrontmatterBlock — value rendering', () => {
  it('renders primitive arrays (tags) as a comma list', () => {
    renderWithProviders(
      <FrontmatterBlock tabId="tab-1" frontmatter={{ tags: ['meeting', 'q2'] }} />,
    );
    openPanel();
    expect(screen.getByDisplayValue('meeting, q2')).toBeTruthy();
  });

  /**
   * Regression: arrays of OBJECTS (e.g. a transcript note's `segments`) used
   * to render via `join(", ")` → "[object Object], [object Object]…". They
   * must fall through to JSON like other complex values.
   */
  it('renders arrays of objects as JSON, never "[object Object]"', () => {
    const segments = [
      { start: 0, end: 2.5, text: 'Hello' },
      { start: 2.5, end: 5, text: 'world' },
    ];
    renderWithProviders(<FrontmatterBlock tabId="tab-1" frontmatter={{ segments }} />);
    openPanel();

    const input = screen.getByDisplayValue(JSON.stringify(segments)) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).not.toContain('[object Object]');
    // Complex values are read-only — they can't round-trip through a text field.
    expect(input.readOnly).toBe(true);
  });

  it('renders scalars editable and objects read-only', () => {
    renderWithProviders(
      <FrontmatterBlock
        tabId="tab-1"
        frontmatter={{ title: 'Meeting', meta: { lang: 'en' } }}
      />,
    );
    openPanel();

    const title = screen.getByDisplayValue('Meeting') as HTMLInputElement;
    expect(title.readOnly).toBe(false);
    const meta = screen.getByDisplayValue('{"lang":"en"}') as HTMLInputElement;
    expect(meta.readOnly).toBe(true);
  });
});
