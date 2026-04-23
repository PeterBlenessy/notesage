// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { TagsSection } from '../TagsSection';

describe('TagsSection', () => {
  it('renders the uppercase "Tags" heading', () => {
    renderWithProviders(<TagsSection />);
    const heading = screen.getByRole('heading', { level: 2, name: /tags/i });
    expect(heading.textContent).toBe('Tags');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('does NOT render an add-button (tags come from the document index)', () => {
    renderWithProviders(<TagsSection />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders no items in the body (empty shell — G2 task #34 fills it in)', () => {
    renderWithProviders(<TagsSection />);
    const section = screen.getByRole('region', { name: /tags/i });
    expect(section.querySelectorAll('li')).toHaveLength(0);
  });
});
