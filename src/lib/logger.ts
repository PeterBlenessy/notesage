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

const isDev = import.meta.env.DEV;
const FLUSH_INTERVAL = 500; // ms
const FLUSH_THRESHOLD = 20; // entries

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let debugEnabled = false;

/** Set whether debug-level logging is enabled (toggled from Settings). */
export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

function shouldForward(level: string): boolean {
  if (isDev) return true;
  if (level === 'warn' || level === 'error') return true;
  return debugEnabled;
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
  invoke('log_frontend', { entries }).catch(() => {
    // Backend may be unavailable (e.g., during shutdown) — drop silently
  });
}

function startTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL);
}

function logImpl(level: string, category: string, message: string, data?: unknown): void {
  const timestamp = Date.now();

  // Console output
  const prefix = `[${category}]`;
  const args: unknown[] = data !== undefined ? [prefix, message, data] : [prefix, message];

  switch (level) {
    case 'debug':
      if (isDev || debugEnabled) console.debug(...args);
      break;
    case 'info':
      if (isDev || debugEnabled) console.info(...args);
      break;
    case 'warn':
      console.warn(...args);
      break;
    case 'error':
      console.error(...args);
      break;
  }

  // Backend forwarding
  if (shouldForward(level)) {
    enqueue({ level, category, message, data, timestamp });
  }
}

export const log = {
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
