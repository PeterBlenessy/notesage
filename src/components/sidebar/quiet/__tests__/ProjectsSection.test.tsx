// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { ProjectsSection } from '../ProjectsSection';

describe('ProjectsSection (quiet variant)', () => {
  it('renders the uppercase "Projects" heading', () => {
    renderWithProviders(<ProjectsSection />);
    const heading = screen.getByRole('heading', { level: 2, name: /projects/i });
    expect(heading.textContent).toBe('Projects');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('renders an accessible add-button', () => {
    renderWithProviders(<ProjectsSection onAdd={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /add project/i });
    expect(btn).toBeTruthy();
  });

  it('calls onAdd when the add-button is clicked', () => {
    const onAdd = vi.fn();
    renderWithProviders(<ProjectsSection onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /add project/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders no items in the body (empty shell — G2 task #32 fills it in)', () => {
    renderWithProviders(<ProjectsSection />);
    const section = screen.getByRole('region', { name: /projects/i });
    expect(section.querySelectorAll('li')).toHaveLength(0);
  });
});
