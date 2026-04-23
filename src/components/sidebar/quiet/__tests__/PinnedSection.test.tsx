// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { PinnedSection } from '../PinnedSection';

describe('PinnedSection', () => {
  it('renders the uppercase "Pinned" heading', () => {
    renderWithProviders(<PinnedSection />);
    const heading = screen.getByRole('heading', { level: 2, name: /pinned/i });
    expect(heading.textContent).toBe('Pinned');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('renders an accessible add-button', () => {
    renderWithProviders(<PinnedSection onAdd={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /add pinned/i });
    expect(btn).toBeTruthy();
  });

  it('calls onAdd when the add-button is clicked', () => {
    const onAdd = vi.fn();
    renderWithProviders(<PinnedSection onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /add pinned/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders no items in the body (empty shell — G2 task #31 fills it in)', () => {
    renderWithProviders(<PinnedSection />);
    const section = screen.getByRole('region', { name: /pinned/i });
    expect(section.querySelectorAll('li')).toHaveLength(0);
  });
});
