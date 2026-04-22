/**
 * Unit tests for the command-bar event bus.
 *
 * The bus is a tiny module-scoped pub/sub used to coordinate
 * `useCommandBarShortcuts` (the keyboard listener) with the
 * `FloatingCommandBar` component (the consumer). Keeping it
 * outside the React tree avoids a context provider just for
 * a one-way fire-and-forget signal.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  emitCmdBarEvent,
  subscribeToCmdBarEvents,
} from '@/lib/cmd-bar-events';

describe('cmd-bar-events', () => {
  it('emitCmdBarEvent calls all subscribers', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCmdBarEvents(handler);

    emitCmdBarEvent({ type: 'focus' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: 'focus' });

    unsubscribe();
  });

  it('returned unsubscribe function detaches the handler', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCmdBarEvents(handler);

    unsubscribe();
    emitCmdBarEvent({ type: 'focus', prefix: '#' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple subscribers all receive the same event', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const unsubA = subscribeToCmdBarEvents(a);
    const unsubB = subscribeToCmdBarEvents(b);
    const unsubC = subscribeToCmdBarEvents(c);

    emitCmdBarEvent({ type: 'dismiss' });

    expect(a).toHaveBeenCalledWith({ type: 'dismiss' });
    expect(b).toHaveBeenCalledWith({ type: 'dismiss' });
    expect(c).toHaveBeenCalledWith({ type: 'dismiss' });

    unsubA();
    unsubB();
    unsubC();
  });
});
