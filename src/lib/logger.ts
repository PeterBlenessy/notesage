import { invoke } from '@tauri-apps/api/core';

/**
 * Structured frontend logger with backend forwarding.
 *
 * - Dev: always logs to console + forwards to backend
 * - Prod: warn/error always forwarded; info/debug only when debug logging is enabled
 * - Batching: flushes every 500ms or 20 entries, whichever comes first
 */

interface LogEntry {
  level: string;
  category: string;
  message: string;
  data?: unknown;
  timestamp: number;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Centralised perf-log category names. Reference these constants instead of
 * raw `'perf:foo'` string literals at call sites — prevents typos, keeps the
 * canonical list in one place, and lets IDE find-all-references locate every
 * emit site for a given category.
 */
export const PERF = {
  startup: 'perf:startup',
  save: 'perf:save',
  tree: 'perf:tree',
  find: 'perf:find',
  typing: 'perf:typing',
  palette: 'perf:palette',
  docLoad: 'perf:doc-load',
  docSwitch: 'perf:doc-switch',
  skills: 'perf:skills',
  aiChat: 'perf:ai-chat',
  index: 'perf:index',
  cmdbar: 'perf:cmdbar',
  orb: 'perf:orb',
  status: 'perf:status',
  peek: 'perf:peek',
  treeOverlay: 'perf:tree-overlay',
  sidebar: 'perf:sidebar',
  focus: 'perf:focus',
  context: 'perf:context',
} as const;

export type PerfCategory = typeof PERF[keyof typeof PERF];

const LOG_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const isDev = import.meta.env.DEV;
const FLUSH_INTERVAL = 500; // ms
const FLUSH_THRESHOLD = 20; // entries

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let minLevel: LogLevel = 'warn';

/** Set the minimum log level for forwarding and console output. */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldForward(level: string): boolean {
  if (isDev) return true;
  const priority = LOG_PRIORITY[level as LogLevel];
  if (priority === undefined) return true;
  return priority <= LOG_PRIORITY[minLevel];
}

function enqueue(entry: LogEntry): void {
  buffer.push(entry);
  if (buffer.length >= FLUSH_THRESHOLD) {
    flush();
  }
}

function flush(): void {
  if (buffer.length === 0) return;
  const entries = buffer;
  buffer = [];
  try {
    invoke('log_frontend', { entries }).catch(() => {
      // Backend may be unavailable (e.g., during shutdown) — drop silently
    });
  } catch {
    // `invoke` can throw SYNCHRONOUSLY when there is no Tauri IPC to talk to —
    // under test, in a browser preview — and a synchronous throw walks past
    // the `.catch` above. That turns a log call into an exception raised in
    // whatever code happened to log, and `enqueue` flushes on a threshold, so
    // it lands on an arbitrary caller rather than a reproducible one. Logging
    // must never be able to break the thing being logged.
  }
}

function startTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL);
}

function logImpl(level: string, category: string, message: string, data?: unknown): void {
  const timestamp = Date.now();

  // Console output — gated by min level (dev always shows all)
  const priority = LOG_PRIORITY[level as LogLevel];
  const show = isDev || (priority !== undefined && priority <= LOG_PRIORITY[minLevel]);

  if (show) {
    const prefix = `[${category}]`;
    const args: unknown[] = data !== undefined ? [prefix, message, data] : [prefix, message];

    switch (level) {
      case 'debug':
        console.debug(...args);
        break;
      case 'info':
        // Perf measurements keep the plain `console.log` they have always
        // used: they are read as a stream in the Inspector, and console.info
        // puts them in a different filter bucket with an icon in front.
        if (category.startsWith('perf:')) console.log(...args);
        else console.info(...args);
        break;
      case 'warn':
        console.warn(...args);
        break;
      case 'error':
        console.error(...args);
        break;
    }
  }

  // Backend forwarding
  if (shouldForward(level)) {
    enqueue({ level, category, message, data, timestamp });
  }
}

export const log = {
  /**
   * A measurement, not an event.
   *
   * Perf call sites used raw `console.log('[perf:x]', {...})`, which reaches
   * the Web Inspector and nowhere else — so reading a startup profile meant
   * expanding collapsed objects in a console by hand and pasting them
   * somewhere. 25 call sites were invisible to `notesage.log`, including every
   * `perf:skills` and `perf:tree` one, which are the two this project has
   * spent the most time trying to read.
   *
   * Console output keeps the exact shape it had — `[perf:skills] phase1-ready
   * {…}` — so anyone reading the Inspector sees no change. The difference is
   * that it now also forwards, at `info`, landing in the log file whenever
   * debug logging is on and staying out of the way when it is not.
   */
  perf(category: PerfCategory, message: string, data?: unknown): void {
    logImpl('info', category, message, data);
  },
  debug(category: string, message: string, data?: unknown): void {
    logImpl('debug', category, message, data);
  },
  info(category: string, message: string, data?: unknown): void {
    logImpl('info', category, message, data);
  },
  warn(category: string, message: string, data?: unknown): void {
    logImpl('warn', category, message, data);
  },
  error(category: string, message: string, data?: unknown): void {
    logImpl('error', category, message, data);
  },
};

// Start the flush timer
startTimer();

// Flush on unload to avoid losing entries on quit
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flush();
  });
}
