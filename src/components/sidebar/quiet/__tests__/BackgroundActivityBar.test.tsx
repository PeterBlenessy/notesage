// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BackgroundActivityBar } from '../BackgroundActivityBar';

const LABEL = 'Indexing your library, 1,200 of 3,000 files';

describe('BackgroundActivityBar', () => {
  it('is a determinate progressbar named by its label, with aria values from the fraction', () => {
    render(<BackgroundActivityBar label={LABEL} fraction={0.4} />);
    const bar = screen.getByRole('progressbar', { name: LABEL });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('data-state')).toBe('loading');

    const indicator = bar.querySelector<HTMLElement>('[data-slot="progress-indicator"]');
    expect(indicator?.style.transform).toBe('translateX(-60%)');
  });

  it('is indeterminate, with no aria-valuenow, while the total is not known', () => {
    render(<BackgroundActivityBar label="Indexing your library…" fraction={null} />);
    const bar = screen.getByRole('progressbar', { name: 'Indexing your library…' });
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    // The sweep in globals.css keys off this state.
    expect(bar.getAttribute('data-state')).toBe('indeterminate');
    expect(bar.hasAttribute('data-activity-bar')).toBe(true);
  });

  it('is 2px, out of the flow, and takes no pointer events', () => {
    render(<BackgroundActivityBar label={LABEL} fraction={1} />);
    const bar = screen.getByRole('progressbar');
    for (const cls of ['absolute', 'inset-x-0', 'h-0.5', 'pointer-events-none']) {
      expect(bar.className).toContain(cls);
    }
    // The shadcn default height must not survive next to ours.
    expect(bar.className).not.toMatch(/\bh-2\b/);
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('clamps a fraction outside 0–1', () => {
    render(<BackgroundActivityBar label={LABEL} fraction={1.7} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});
