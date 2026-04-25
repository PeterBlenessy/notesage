// @vitest-environment node

/**
 * Regression-lock for the sidebar context-menu open-state tracker.
 *
 * Backs the live-test 2026-04-25 fixes for two issues:
 *   1. Right-clicking an item INSIDE the FolderPeek preview opened the
 *      context menu, then the cursor leaving the preview triggered the
 *      preview's close timer, which unmounted the Radix Root inside the
 *      preview portal — taking the menu down with it.
 *   2. React's portal-traversing synthetic `onMouseEnter` fired on
 *      FilePreview's trigger when the cursor entered the menu portal
 *      (the menu is a React descendant of the preview's wrapper), which
 *      scheduled a spontaneous open over the menu.
 *
 * The shared counter + subscriber notification is the single coordination
 * point both previews consult before opening or closing themselves.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetOpenContextMenusForTesting,
  decrementOpenContextMenus,
  getOpenContextMenuCount,
  incrementOpenContextMenus,
  isAnyContextMenuOpen,
  subscribeToOpenContextMenus,
} from '../sidebar-context-menu-state';

describe('sidebar-context-menu-state', () => {
  beforeEach(() => {
    __resetOpenContextMenusForTesting();
  });

  it('starts at zero', () => {
    expect(getOpenContextMenuCount()).toBe(0);
    expect(isAnyContextMenuOpen()).toBe(false);
  });

  it('increment / decrement track an open menu', () => {
    incrementOpenContextMenus();
    expect(getOpenContextMenuCount()).toBe(1);
    expect(isAnyContextMenuOpen()).toBe(true);

    decrementOpenContextMenus();
    expect(getOpenContextMenuCount()).toBe(0);
    expect(isAnyContextMenuOpen()).toBe(false);
  });

  it('multiple increments stack so a second menu opening keeps the flag true', () => {
    incrementOpenContextMenus();
    incrementOpenContextMenus();
    expect(getOpenContextMenuCount()).toBe(2);
    expect(isAnyContextMenuOpen()).toBe(true);

    // First menu closes — flag still true (second is open).
    decrementOpenContextMenus();
    expect(getOpenContextMenuCount()).toBe(1);
    expect(isAnyContextMenuOpen()).toBe(true);

    // Second menu closes — flag now false.
    decrementOpenContextMenus();
    expect(getOpenContextMenuCount()).toBe(0);
    expect(isAnyContextMenuOpen()).toBe(false);
  });

  it('decrement clamps at zero (defensive against stray cleanup)', () => {
    decrementOpenContextMenus();
    decrementOpenContextMenus();
    expect(getOpenContextMenuCount()).toBe(0);
  });

  it('notifies subscribers on every open / close transition', () => {
    let calls = 0;
    const unsubscribe = subscribeToOpenContextMenus(() => {
      calls += 1;
    });

    incrementOpenContextMenus(); // 1
    incrementOpenContextMenus(); // 2
    decrementOpenContextMenus(); // 3
    decrementOpenContextMenus(); // 4
    expect(calls).toBe(4);

    unsubscribe();
    incrementOpenContextMenus();
    expect(calls).toBe(4); // unsubscribed, no further calls
  });

  it('subscriber that unsubscribes itself mid-emit does not break the loop', () => {
    let firstCalls = 0;
    let secondCalls = 0;
    const unsubFirst = subscribeToOpenContextMenus(() => {
      firstCalls += 1;
      unsubFirst();
    });
    subscribeToOpenContextMenus(() => {
      secondCalls += 1;
    });

    incrementOpenContextMenus();
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);

    incrementOpenContextMenus();
    expect(firstCalls).toBe(1); // unsubscribed after first call
    expect(secondCalls).toBe(2);
  });
});
