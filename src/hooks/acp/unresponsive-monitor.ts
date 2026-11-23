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
// single monitor instance per window, resettable for tests by constructing a
// fresh `AcpUnresponsiveMonitor`.
//
// OWNERSHIP. `useAcpLifecycle` is mounted several times at once (once per
// `useAIOperations` caller: the command bar, the editor's comment sync, both
// bubble menus), and each instance holds its own stream cleanups and retry
// context. The monitor therefore keeps a REGISTRY of owners instead of one set
// of callbacks:
//   - every mounted instance registers on mount and unregisters on unmount —
//     an unmount removes only that instance, never another's callbacks;
//   - the instance that SENDS a prompt starts the timer as its owner, so a hung
//     turn is recovered by the instance that holds its listeners;
//   - Retry goes to the instance that holds the failed prompt.
// The previous single-slot callbacks were overwritten by whichever instance
// rendered last and cleared by whichever unmounted first, which silently
// disabled hung-agent detection and the banner's Retry (audit 2026-11-22 §2).
// ---------------------------------------------------------------------------

// 5 minutes — agents can have long gaps between events (thinking, web fetches,
// large file reads). The backend health check confirms aliveness; this timer
// only catches genuinely hung agents, not slow ones.
export const UNRESPONSIVE_TIMEOUT_MS = 300_000;

/** One mounted `useAcpLifecycle` instance, as the monitor sees it. */
export interface UnresponsiveOwner {
  /**
   * Recovery check, invoked when an inactivity timer this owner started fires.
   * `conversationId` is the conversation the timed turn belongs to (`null` =
   * the foreground one).
   */
  onUnresponsive: (conversationId: string | null) => void;
  /** Whether this owner holds a prompt it could retry for the conversation. */
  canRetry: (conversationId?: string | null) => boolean;
  /** Retry the conversation's last prompt (`null`/absent = the foreground one). */
  retry: (conversationId?: string | null) => Promise<void>;
  /** Dismiss the banner and keep waiting for the agent. */
  keepWaiting: () => void;
}

export class AcpUnresponsiveMonitor {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  /** Registered owners, oldest first. */
  private owners: UnresponsiveOwner[] = [];
  /** Owner + conversation of the turn the running (or last) timer watches. */
  private timerOwner: UnresponsiveOwner | null = null;
  private timerConversationId: string | null = null;

  /**
   * Register a mounted lifecycle instance. Returns the matching unregister,
   * which removes ONLY this owner: the timer is cleared only when it was this
   * owner's (its streams are torn down with it), and other instances keep
   * their callbacks.
   */
  register(owner: UnresponsiveOwner): () => void {
    this.owners.push(owner);
    return () => {
      this.owners = this.owners.filter((o) => o !== owner);
      if (this.timerOwner === owner) {
        this.timerOwner = null;
        this.timerConversationId = null;
        this.clear();
      }
    };
  }

  private latestOwner(): UnresponsiveOwner | null {
    return this.owners.length > 0 ? this.owners[this.owners.length - 1] : null;
  }

  /**
   * Retry callback for the banner. Routes to the owner that holds a prompt
   * for the conversation (the one that sent it); with none, to the most
   * recently mounted owner, which reports that there is nothing to retry.
   */
  getRetryCallback(): ((conversationId?: string | null) => Promise<void>) | null {
    if (this.owners.length === 0) return null;
    return (conversationId) => {
      const holder = [...this.owners].reverse().find((o) => o.canRetry(conversationId));
      const target = holder ?? this.latestOwner();
      return target ? target.retry(conversationId) : Promise.resolve();
    };
  }

  /** Keep-waiting callback for the banner. */
  getKeepWaitingCallback(): (() => void) | null {
    const owner = this.timerOwner ?? this.latestOwner();
    return owner ? owner.keepWaiting : null;
  }

  /**
   * Start (or restart) the unresponsiveness timer.
   *
   * A send passes itself as `owner` together with the turn's conversation.
   * Without an owner (keep-waiting, a reset) the previous owner and
   * conversation are kept; failing that, the most recently mounted owner.
   */
  start(owner?: UnresponsiveOwner, conversationId?: string | null): void {
    this.clear();
    if (owner) {
      this.timerOwner = owner;
      this.timerConversationId = conversationId ?? null;
    } else if (!this.timerOwner || !this.owners.includes(this.timerOwner)) {
      this.timerOwner = this.latestOwner();
      this.timerConversationId = null;
    }
    if (!this.timerOwner) return;
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.timerOwner?.onUnresponsive(this.timerConversationId);
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

/** The per-window monitor instance; `useAcpLifecycle` instances register with it. */
export const acpUnresponsiveMonitor = new AcpUnresponsiveMonitor();

// ---------------------------------------------------------------------------
// Thin function wrappers preserving the original `useAcpLifecycle` exports so
// call sites (`useAcpSessionListeners`, `ChatMessageList`) stay mechanical.
// ---------------------------------------------------------------------------

/** Start (or restart) the unresponsiveness timer. */
export function startUnresponsiveTimer(owner?: UnresponsiveOwner, conversationId?: string | null): void {
  acpUnresponsiveMonitor.start(owner, conversationId);
}

/** Reset the timer (called on every acp-session-update event). */
export function resetUnresponsiveTimer(): void {
  acpUnresponsiveMonitor.reset();
}

/** Clear the timer (called on prompt completion, cancel, or unmount). */
export function clearUnresponsiveTimer(): void {
  acpUnresponsiveMonitor.clear();
}

export function getRetryCallback(): ((conversationId?: string | null) => Promise<void>) | null {
  return acpUnresponsiveMonitor.getRetryCallback();
}

export function getKeepWaitingCallback(): (() => void) | null {
  return acpUnresponsiveMonitor.getKeepWaitingCallback();
}
