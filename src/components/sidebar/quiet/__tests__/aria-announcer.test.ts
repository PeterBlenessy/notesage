// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { announce } from '../aria-announcer';

describe('announce', () => {
  beforeEach(() => {
    // Wipe any leftover announcer nodes between tests.
    document.querySelectorAll('[data-sidebar-announcer]').forEach((n) => n.remove());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends a visually-hidden aria-live="assertive" node with the message', () => {
    announce('hello');
    const node = document.querySelector(
      '[data-sidebar-announcer]',
    ) as HTMLElement | null;
    expect(node).toBeTruthy();
    expect(node?.getAttribute('aria-live')).toBe('assertive');
    expect(node?.getAttribute('role')).toBe('status');
    expect(node?.textContent).toBe('hello');
    // Sanity check: visually-hidden positioning.
    expect(node?.style.position).toBe('absolute');
    expect(node?.style.width).toBe('1px');
  });

  it('removes the node after the default ttl (2000ms)', () => {
    announce('temporary');
    expect(document.querySelector('[data-sidebar-announcer]')).toBeTruthy();
    vi.advanceTimersByTime(2000);
    expect(document.querySelector('[data-sidebar-announcer]')).toBeNull();
  });

  it('respects a custom ttl', () => {
    announce('quick', 500);
    vi.advanceTimersByTime(499);
    expect(document.querySelector('[data-sidebar-announcer]')).toBeTruthy();
    vi.advanceTimersByTime(1);
    expect(document.querySelector('[data-sidebar-announcer]')).toBeNull();
  });
});
