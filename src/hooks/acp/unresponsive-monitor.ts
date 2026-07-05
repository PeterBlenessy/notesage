// ---------------------------------------------------------------------------
// ACP unresponsive-agent recovery runtime.
//
// Owns the inactivity timer that flags a hung agent, plus the recovery
// callbacks (retry / keep-waiting) that UI components invoke from the
// AgentStatusBanner flow. These used to live as bare module-scope `let`s
// inside `useAcpLifecycle` with free-function mutators — hidden globals that
// only worked because the hook mounts once, broke under StrictMode
// double-invoke / any future multi-window, and defeated isolated testing.
//
// This is deliberately NOT a Zustand store: nothing renders from these values
// (the banner renders from `agent-status-store`; `ChatMessageList` reads the
// callbacks imperatively on click), and timer handles + closures don't belong
// in a store. The repo convention for non-persisted runtime state offers
// either a plain non-persisted store or a module singleton with a documented
// owner (see `src/hooks/agent-task/task-registry.ts`) — this is the latter: a
// single monitor instance per window, owned by `useAcpLifecycle` (which
// registers the callbacks on mount and clears them on unmount), resettable
// for tests by constructing a fresh `AcpUnresponsiveMonitor`.
// ---------------------------------------------------------------------------

// 5 minutes — agents can have long gaps between events (thinking, web fetches,
// large file reads). The backend health check confirms aliveness; this timer
// only catches genuinely hung agents, not slow ones.
export const UNRESPONSIVE_TIMEOUT_MS = 300_000;

export class AcpUnresponsiveMonitor {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private onUnresponsive: (() => void) | null = null;
  private retryCallback: (() => Promise<void>) | null = null;
  private keepWaitingCallback: (() => void) | null = null;

  /** Register the recovery check invoked when the timer fires. Set by the hook. */
  setOnUnresponsive(cb: (() => void) | null): void {
    this.onUnresponsive = cb;
  }

  /** Retry callback — set by the hook, callable from UI components. */
  setRetryCallback(cb: (() => Promise<void>) | null): void {
    this.retryCallback = cb;
  }

  getRetryCallback(): (() => Promise<void>) | null {
    return this.retryCallback;
  }

  /** Keep-waiting callback — set by the hook, callable from UI components. */
  setKeepWaitingCallback(cb: (() => void) | null): void {
    this.keepWaitingCallback = cb;
  }

  getKeepWaitingCallback(): (() => void) | null {
    return this.keepWaitingCallback;
  }

  /** Start (or restart) the unresponsiveness timer. */
  start(): void {
    this.clear();
    if (!this.onUnresponsive) return;
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.onUnresponsive?.();
    }, UNRESPONSIVE_TIMEOUT_MS);
  }

  /** Reset the timer (called on every acp-session-update event). */
  reset(): void {
    if (this.timerId !== null) {
      this.start();
    }
  }

  /** Clear the timer (called on prompt completion, cancel, or unmount). */
  clear(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

/** The per-window monitor instance, owned by `useAcpLifecycle`. */
export const acpUnresponsiveMonitor = new AcpUnresponsiveMonitor();

// ---------------------------------------------------------------------------
// Thin function wrappers preserving the original `useAcpLifecycle` exports so
// call sites (`useAcpSessionListeners`, `ChatMessageList`) stay mechanical.
// ---------------------------------------------------------------------------

/** Start (or restart) the unresponsiveness timer. */
export function startUnresponsiveTimer(): void {
  acpUnresponsiveMonitor.start();
}

/** Reset the timer (called on every acp-session-update event). */
export function resetUnresponsiveTimer(): void {
  acpUnresponsiveMonitor.reset();
}

/** Clear the timer (called on prompt completion, cancel, or unmount). */
export function clearUnresponsiveTimer(): void {
  acpUnresponsiveMonitor.clear();
}

export function getRetryCallback(): (() => Promise<void>) | null {
  return acpUnresponsiveMonitor.getRetryCallback();
}

export function getKeepWaitingCallback(): (() => void) | null {
  return acpUnresponsiveMonitor.getKeepWaitingCallback();
}
