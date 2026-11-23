import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AcpUnresponsiveMonitor,
  UNRESPONSIVE_TIMEOUT_MS,
  type UnresponsiveOwner,
} from '@/hooks/acp/unresponsive-monitor';

// `useAcpLifecycle` is mounted once per `useAIOperations` caller, so several
// instances share this monitor. It used to hold ONE set of callbacks: the last
// instance to render owned Retry, and the first to unmount disabled hung-agent
// detection for all of them (audit 2026-11-22 §2).

function makeOwner(retryable: string[] = []) {
  const owner = {
    onUnresponsive: vi.fn<(conversationId: string | null) => void>(),
    canRetry: vi.fn((conversationId?: string | null) => retryable.includes(conversationId ?? '')),
    retry: vi.fn(async (_conversationId?: string | null) => {}),
    keepWaiting: vi.fn(),
  };
  return owner satisfies UnresponsiveOwner;
}

describe('AcpUnresponsiveMonitor — owner registry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires the check of the owner that started the timer, with its conversation', () => {
    const monitor = new AcpUnresponsiveMonitor();
    const commandBar = makeOwner();
    const bubbleMenu = makeOwner();
    monitor.register(commandBar);
    monitor.register(bubbleMenu);

    monitor.start(commandBar, 'conv-a');
    vi.advanceTimersByTime(UNRESPONSIVE_TIMEOUT_MS);

    expect(commandBar.onUnresponsive).toHaveBeenCalledExactlyOnceWith('conv-a');
    expect(bubbleMenu.onUnresponsive).not.toHaveBeenCalled();
  });

  it('unregistering one owner does not disable the others', () => {
    const monitor = new AcpUnresponsiveMonitor();
    const commandBar = makeOwner();
    const bubbleMenu = makeOwner();
    monitor.register(commandBar);
    const unregisterBubbleMenu = monitor.register(bubbleMenu);

    monitor.start(commandBar, 'conv-a');
    unregisterBubbleMenu();
    // The running timer belonged to the command bar — it must survive.
    vi.advanceTimersByTime(UNRESPONSIVE_TIMEOUT_MS);
    expect(commandBar.onUnresponsive).toHaveBeenCalledTimes(1);

    // And later timers still start.
    monitor.start(commandBar, 'conv-a');
    vi.advanceTimersByTime(UNRESPONSIVE_TIMEOUT_MS);
    expect(commandBar.onUnresponsive).toHaveBeenCalledTimes(2);
    expect(monitor.getRetryCallback()).not.toBeNull();
  });

  it('clears the timer when its own owner unregisters', () => {
    const monitor = new AcpUnresponsiveMonitor();
    const owner = makeOwner();
    const unregister = monitor.register(owner);

    monitor.start(owner, 'conv-a');
    unregister();
    vi.advanceTimersByTime(UNRESPONSIVE_TIMEOUT_MS * 2);

    expect(owner.onUnresponsive).not.toHaveBeenCalled();
    expect(monitor.getRetryCallback()).toBeNull();
    expect(monitor.getKeepWaitingCallback()).toBeNull();
  });

  it('a reset keeps the owner and conversation of the running timer', () => {
    const monitor = new AcpUnresponsiveMonitor();
    const sender = makeOwner();
    const later = makeOwner();
    monitor.register(sender);
    monitor.register(later);

    monitor.start(sender, 'conv-a');
    vi.advanceTimersByTime(UNRESPONSIVE_TIMEOUT_MS - 1);
    monitor.reset();
    vi.advanceTimersByTime(UNRESPONSIVE_TIMEOUT_MS - 1);
    expect(sender.onUnresponsive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(sender.onUnresponsive).toHaveBeenCalledExactlyOnceWith('conv-a');
    expect(later.onUnresponsive).not.toHaveBeenCalled();
  });

  it('a reset does nothing when no timer is running', () => {
    const monitor = new AcpUnresponsiveMonitor();
    const owner = makeOwner();
    monitor.register(owner);

    monitor.reset();
    vi.advanceTimersByTime(UNRESPONSIVE_TIMEOUT_MS * 2);

    expect(owner.onUnresponsive).not.toHaveBeenCalled();
  });

  it('routes Retry to the owner that holds the conversation\'s prompt', async () => {
    const monitor = new AcpUnresponsiveMonitor();
    const commandBar = makeOwner(['conv-a']);
    const bubbleMenu = makeOwner();
    monitor.register(commandBar);
    // Registered (and rendered) last — it used to win.
    monitor.register(bubbleMenu);

    await monitor.getRetryCallback()?.('conv-a');

    expect(commandBar.retry).toHaveBeenCalledExactlyOnceWith('conv-a');
    expect(bubbleMenu.retry).not.toHaveBeenCalled();
  });

  it('falls back to the most recent owner when nobody holds a prompt', async () => {
    const monitor = new AcpUnresponsiveMonitor();
    const first = makeOwner();
    const second = makeOwner();
    monitor.register(first);
    monitor.register(second);

    await monitor.getRetryCallback()?.();

    expect(second.retry).toHaveBeenCalledTimes(1);
    expect(first.retry).not.toHaveBeenCalled();
  });

  it('does not start a timer with no registered owner', () => {
    const monitor = new AcpUnresponsiveMonitor();
    monitor.start();
    // Nothing to assert on directly — the point is that nothing throws when
    // the (absent) timer would fire.
    expect(() => vi.advanceTimersByTime(UNRESPONSIVE_TIMEOUT_MS)).not.toThrow();
  });
});
