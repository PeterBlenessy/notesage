/**
 * FIFO session queue — serialises concurrent AI sends so at most
 * `maxConcurrent` sends run at the same time. When all slots are taken,
 * sends are queued and drain in FIFO order.
 *
 * KEY INVARIANT: the drain path NEVER calls `setActiveConversation`.
 * The caller captures `targetConversationId` at submit time and threads it
 * through the execute closure — context is always derived from that conversation,
 * regardless of where the user navigates while waiting.
 */

export const DEFAULT_MAX_CONCURRENT_SESSIONS = 4;

interface QueueEntry {
  targetConversationId: string;
  execute: () => Promise<void>;
}

export class SessionRunQueue {
  private _running = 0;
  private readonly _maxConcurrent: number;
  private readonly _queue: QueueEntry[] = [];

  constructor(maxConcurrent = DEFAULT_MAX_CONCURRENT_SESSIONS) {
    this._maxConcurrent = maxConcurrent;
  }

  get activeCount(): number {
    return this._running;
  }

  get queueLength(): number {
    return this._queue.length;
  }

  /**
   * Runs `execute` immediately if under the concurrent cap; otherwise enqueues it.
   *
   * @returns `true` if the entry was queued (deferred), `false` if it ran immediately.
   */
  run(targetConversationId: string, execute: () => Promise<void>): boolean {
    if (this._running < this._maxConcurrent) {
      this._running++;
      void this._exec(targetConversationId, execute);
      return false;
    }
    this._queue.push({ targetConversationId, execute });
    return true;
  }

  private async _exec(_targetConversationId: string, execute: () => Promise<void>): Promise<void> {
    try {
      await execute();
    } catch (err) {
      // Errors from execute() are expected to be handled internally by the send
      // pipeline (setMessageError / setError). Catching here prevents unhandled
      // rejection warnings from leaking into host test suites and the app shell.
      // We do NOT rethrow because the queue has no caller to propagate to — the
      // send is fire-and-forget once it enters the queue.
      console.error('[SessionRunQueue] execute error (handled by send pipeline)', err);
    } finally {
      this._running--;
      this._drain();
    }
  }

  private _drain(): void {
    const next = this._queue.shift();
    if (!next) return;
    this._running++;
    // IMPORTANT: no setActiveConversation here — targetConversationId is carried
    // inside the execute closure, which already has the correct context captured
    // at submit time.
    void this._exec(next.targetConversationId, next.execute);
  }
}

/** Singleton queue used by useAIOperations */
export const sessionRunQueue = new SessionRunQueue();
