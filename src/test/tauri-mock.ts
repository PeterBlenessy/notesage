/**
 * Tauri IPC mocking infrastructure for vitest.
 *
 * Mocks `@tauri-apps/api/core` (invoke) and `@tauri-apps/api/event` (listen/emit)
 * so that tests can run without a Tauri backend. Each test should configure
 * `mockInvoke` to return the desired responses for the commands it exercises.
 */
import { vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Polyfill: localStorage for Zustand persist middleware in jsdom
// ---------------------------------------------------------------------------

// Ensure localStorage is available for Zustand persist middleware.
// jsdom may provide a Storage object but some versions return a
// non-functional stub. We polyfill unconditionally when setItem is missing.
{
  const existing = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  if (!existing || typeof existing.setItem !== 'function') {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      get length() { return store.size; },
      key: (index: number) => [...store.keys()][index] ?? null,
    };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true });
    // Also ensure window.localStorage is set in jsdom
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'localStorage', { value: storage, writable: true, configurable: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

/**
 * Map of Tauri command name → mock implementation.
 * Tests call `setMockInvokeHandler(name, fn)` to register handlers.
 */
const invokeHandlers = new Map<string, (args?: Record<string, unknown>) => unknown>();

/**
 * Register a mock handler for a specific Tauri invoke command.
 * The handler receives the args object and should return the resolved value
 * (or throw to simulate an error).
 */
export function setMockInvokeHandler(
  command: string,
  handler: (args?: Record<string, unknown>) => unknown,
): void {
  invokeHandlers.set(command, handler);
}

/** Clear all registered invoke handlers. Called automatically in beforeEach. */
export function clearMockInvokeHandlers(): void {
  invokeHandlers.clear();
}

// ---------------------------------------------------------------------------
// Mock: @tauri-apps/api/core
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const handler = invokeHandlers.get(command);
    if (handler) {
      return handler(args);
    }
    throw new Error(`[tauri-mock] No handler registered for command: ${command}`);
  }),
}));

// ---------------------------------------------------------------------------
// Mock: @tauri-apps/api/event
// ---------------------------------------------------------------------------

const eventListeners = new Map<string, Set<(event: unknown) => void>>();

export function emitMockEvent(eventName: string, payload: unknown): void {
  const listeners = eventListeners.get(eventName);
  if (listeners) {
    for (const listener of listeners) {
      listener({ payload, event: eventName, id: 0 });
    }
  }
}

/** Returns the number of listeners registered for a given event name. */
export function getListenerCount(eventName: string): number {
  return eventListeners.get(eventName)?.size ?? 0;
}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (event: unknown) => void) => {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set());
    }
    eventListeners.get(event)!.add(handler);
    // Return unlisten function
    return () => {
      eventListeners.get(event)?.delete(handler);
    };
  }),
  emit: vi.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// Mock: sonner (toast)
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Default handlers for common commands
// ---------------------------------------------------------------------------

/**
 * Register default no-op/success handlers for commonly invoked Tauri commands.
 * Call this in beforeEach or at the top of a test file to avoid
 * "No handler registered" errors for background commands.
 */
export function registerDefaultHandlers(): void {
  setMockInvokeHandler('list_directory', () => []);
  setMockInvokeHandler('read_file', () => '');
  setMockInvokeHandler('write_file', () => undefined);
  setMockInvokeHandler('path_exists', () => true);
  setMockInvokeHandler('watch_directory', () => undefined);
  setMockInvokeHandler('unwatch_directory', () => undefined);
  setMockInvokeHandler('mark_self_write', () => undefined);
  setMockInvokeHandler('clear_self_write', () => undefined);
  setMockInvokeHandler('open_folder_dialog', () => null);
  setMockInvokeHandler('get_credential', () => null);
  setMockInvokeHandler('store_credential', () => undefined);
  setMockInvokeHandler('health_check', () => undefined);
  setMockInvokeHandler('get_store_value', () => null);
  setMockInvokeHandler('set_store_value', () => undefined);
  setMockInvokeHandler('store_read', () => null);
  setMockInvokeHandler('store_write', () => undefined);
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearMockInvokeHandlers();
  eventListeners.clear();
});
