// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { getDefaultClassNames } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';

// NOTE: pnpm resolves the package.json from node_modules at runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rdpPkg = require('react-day-picker/package.json') as { version: string };

describe('react-day-picker migration — v9 → v10', () => {
  it('react-day-picker package version is v10 or later', () => {
    const [major] = rdpPkg.version.split('.');
    expect(Number(major)).toBeGreaterThanOrEqual(10);
  });

  it('getDefaultClassNames returns the v10 month_grid key (not the deprecated table key)', () => {
    const classNames = getDefaultClassNames();
    expect(classNames).toHaveProperty('month_grid');
    expect(classNames).not.toHaveProperty('table');
  });

  it('Calendar renders root element with data-slot="calendar"', () => {
    const { container } = render(<Calendar mode="single" />);
    const root = container.querySelector('[data-slot="calendar"]');
    expect(root).not.toBeNull();
  });

  it('Calendar renders in mode="single" without errors', () => {
    expect(() =>
      render(<Calendar mode="single" selected={new Date(2025, 0, 15)} />)
    ).not.toThrow();
  });

  it('Calendar renders navigation buttons (previous/next month)', () => {
    const { container } = render(<Calendar mode="single" />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });
});
