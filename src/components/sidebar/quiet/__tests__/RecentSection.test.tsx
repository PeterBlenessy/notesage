// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { RecentSection } from '../RecentSection';

describe('RecentSection', () => {
  it('renders the uppercase "Recent" heading', () => {
    renderWithProviders(<RecentSection />);
    const heading = screen.getByRole('heading', { level: 2, name: /recent/i });
    expect(heading.textContent).toBe('Recent');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('does NOT render an add-button (derived list)', () => {
    renderWithProviders(<RecentSection />);
    // Recent is derived from last-touched order — no user "add" action.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders no items in the body (empty shell — G2 task #33 fills it in)', () => {
    renderWithProviders(<RecentSection />);
    const section = screen.getByRole('region', { name: /recent/i });
    expect(section.querySelectorAll('li')).toHaveLength(0);
  });
});
