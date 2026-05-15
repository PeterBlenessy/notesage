// @vitest-environment jsdom

/**
 * Regression tests for the Calendar component across the react-day-picker
 * v9 → v10 migration. The component must render correctly with both the
 * default (no-selection) and mode="single" configurations, and must carry
 * the expected data-slot attribute that lets call sites target it in CSS.
 */

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/component-harness';
import { Calendar } from '@/components/ui/calendar';

describe('Calendar — react-day-picker v10 migration', () => {
  it('renders the root element with data-slot="calendar"', () => {
    renderWithProviders(<Calendar />);
    const root = document.querySelector('[data-slot="calendar"]');
    expect(root, 'Calendar root must carry data-slot="calendar"').not.toBeNull();
  });

  it('renders in mode="single" without errors', () => {
    let error: unknown = null;
    try {
      renderWithProviders(
        <Calendar
          mode="single"
          selected={new Date(2024, 0, 15)}
          onSelect={() => {}}
        />
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });

  it('renders navigation buttons (previous/next month)', () => {
    renderWithProviders(<Calendar />);
    // Navigation uses button_previous / button_next class names from v10 UI enum
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('imports DayPicker and getDefaultClassNames from react-day-picker without error', async () => {
    let exports: Record<string, unknown> = {};
    let error: unknown = null;
    try {
      exports = await import('react-day-picker');
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
    expect(typeof exports.DayPicker).toBe('function');
    expect(typeof exports.getDefaultClassNames).toBe('function');
  });

  it('getDefaultClassNames returns an object with the v10 UI class name keys', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDefaultClassNames } = require('react-day-picker');
    const classNames = getDefaultClassNames();
    // Keys present in v10 (and v9.x) classNames schema
    expect(classNames).toHaveProperty('root');
    expect(classNames).toHaveProperty('month_caption');
    expect(classNames).toHaveProperty('button_previous');
    expect(classNames).toHaveProperty('button_next');
    expect(classNames).toHaveProperty('day');
    expect(classNames).toHaveProperty('today');
    expect(classNames).toHaveProperty('outside');
    expect(classNames).toHaveProperty('disabled');
  });
});
