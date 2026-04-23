// @vitest-environment jsdom

/**
 * Tests for QuietSidebar — the flat-list sidebar shell (task #30).
 *
 * The shell should render the four stub sections in a fixed order (Pinned,
 * Projects, Recent, Tags). No data wiring — G2 tasks #31–#34 fill in the
 * bodies. Tests assert the skeleton is stable so parallel G2 work can
 * trust it.
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, within } from '@/test/component-harness';
import { QuietSidebar } from '../QuietSidebar';

describe('QuietSidebar', () => {
  it('renders a nav with an accessible name', () => {
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });
    expect(nav).toBeTruthy();
  });

  it('renders all four sections in fixed order: Pinned, Projects, Recent, Tags', () => {
    renderWithProviders(<QuietSidebar />);
    const sections = screen.getAllByRole('region');
    // Each <section aria-label="..."> shows up as a region.
    expect(sections).toHaveLength(4);
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Pinned',
      'Projects',
      'Recent',
      'Tags',
    ]);
  });

  it('renders each section header as an h2 with the uppercase label', () => {
    renderWithProviders(<QuietSidebar />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Pinned',
      'Projects',
      'Recent',
      'Tags',
    ]);
  });

  it('renders empty section bodies (no items yet — G2 wires data)', () => {
    renderWithProviders(<QuietSidebar />);
    // Each section should contain only its header; no list items exist today.
    for (const section of screen.getAllByRole('region')) {
      expect(within(section).queryAllByRole('listitem')).toHaveLength(0);
    }
  });
});
