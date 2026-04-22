/**
 * Unit tests for accent.ts.
 *
 * Covers: setAccent class toggling on documentElement (orange/blue/system/default)
 * and setSystemAccentValue setting/removing the --accent-system-value CSS property.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { setAccent, setSystemAccentValue } from '../accent';

beforeEach(() => {
  // Reset documentElement classes and inline styles between tests
  document.documentElement.className = '';
  document.documentElement.style.removeProperty('--accent-system-value');
});

describe('setAccent', () => {
  it('adds accent-orange class for "orange"', () => {
    setAccent('orange');
    expect(document.documentElement.classList.contains('accent-orange')).toBe(true);
    expect(document.documentElement.classList.contains('accent-blue')).toBe(false);
    expect(document.documentElement.classList.contains('accent-system')).toBe(false);
  });

  it('swaps from orange to blue, removing the previous class', () => {
    setAccent('orange');
    expect(document.documentElement.classList.contains('accent-orange')).toBe(true);

    setAccent('blue');
    expect(document.documentElement.classList.contains('accent-blue')).toBe(true);
    expect(document.documentElement.classList.contains('accent-orange')).toBe(false);
    expect(document.documentElement.classList.contains('accent-system')).toBe(false);
  });

  it('adds accent-system class for "system"', () => {
    setAccent('system');
    expect(document.documentElement.classList.contains('accent-system')).toBe(true);
    expect(document.documentElement.classList.contains('accent-orange')).toBe(false);
    expect(document.documentElement.classList.contains('accent-blue')).toBe(false);
  });

  it('removes all accent classes for "default"', () => {
    setAccent('blue');
    expect(document.documentElement.classList.contains('accent-blue')).toBe(true);

    setAccent('default');
    expect(document.documentElement.classList.contains('accent-blue')).toBe(false);
    expect(document.documentElement.classList.contains('accent-orange')).toBe(false);
    expect(document.documentElement.classList.contains('accent-system')).toBe(false);
  });

  it('preserves unrelated classes (does not clobber existing classList)', () => {
    document.documentElement.classList.add('dark', 'soft');
    setAccent('orange');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('soft')).toBe(true);
    expect(document.documentElement.classList.contains('accent-orange')).toBe(true);

    setAccent('default');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('soft')).toBe(true);
    expect(document.documentElement.classList.contains('accent-orange')).toBe(false);
  });
});

describe('setSystemAccentValue', () => {
  it('sets --accent-system-value style property when given an oklch string', () => {
    setSystemAccentValue('oklch(60% 0.18 250)');
    expect(document.documentElement.style.getPropertyValue('--accent-system-value')).toBe(
      'oklch(60% 0.18 250)',
    );
  });

  it('removes --accent-system-value when given null', () => {
    setSystemAccentValue('oklch(60% 0.18 250)');
    expect(document.documentElement.style.getPropertyValue('--accent-system-value')).toBe(
      'oklch(60% 0.18 250)',
    );

    setSystemAccentValue(null);
    expect(document.documentElement.style.getPropertyValue('--accent-system-value')).toBe('');
  });

  it('overwrites a previously-set value', () => {
    setSystemAccentValue('oklch(60% 0.18 250)');
    setSystemAccentValue('oklch(58% 0.18 50)');
    expect(document.documentElement.style.getPropertyValue('--accent-system-value')).toBe(
      'oklch(58% 0.18 50)',
    );
  });
});
