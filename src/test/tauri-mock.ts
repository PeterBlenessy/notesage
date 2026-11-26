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
  // The asset protocol's URL mapper — a pure string transform in production
  // too, so the mock keeps the shape callers can assert on.
  convertFileSrc: (filePath: string, protocol = 'asset') => `${protocol}://localhost/${encodeURIComponent(filePath)}`,
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
  setMockInvokeHandler('allow_asset_dir', () => undefined);
  setMockInvokeHandler('mark_self_write', () => undefined);
  setMockInvokeHandler('clear_self_write', () => undefined);
  setMockInvokeHandler('trash_paths', () => []);
  setMockInvokeHandler('open_folder_dialog', () => null);
  setMockInvokeHandler('get_credential', () => null);
  setMockInvokeHandler('store_credential', () => undefined);
  setMockInvokeHandler('health_check', () => undefined);
  setMockInvokeHandler('get_store_value', () => null);
  setMockInvokeHandler('set_store_value', () => undefined);
  setMockInvokeHandler('store_read', () => null);
  setMockInvokeHandler('store_read_batch', () => ({}));
  setMockInvokeHandler('store_write', () => undefined);
  // Link graph (OKF wiki-navigation) — empty by default so mounting the
  // RelationsPanel / hover preview in component tests doesn't throw.
  setMockInvokeHandler('get_backlinks', () => []);
  setMockInvokeHandler('get_outlinks', () => []);
  setMockInvokeHandler('get_broken_links', () => []);
  setMockInvokeHandler('resolve_wikilink', () => []);
  // MCP: no config entries failed to load.
  setMockInvokeHandler('mcp_config_problems', () => []);
  // Transcription and import: a backend that has one short recording's worth
  // to say, with every file on this disk.
  setMockInvokeHandler('transcribe_file', () => ({
    segments: [{ start: 0, end: 2, text: 'Hello.', speaker: null }],
    duration_secs: 2,
    language: 'en',
    decoder: 'mock',
  }));
  setMockInvokeHandler('cancel_transcription', () => true);
  setMockInvokeHandler('audio_file_status', () => ({ exists: true, size: 1024, local: true }));
  setMockInvokeHandler('import_media', (args) => {
    const source = String(args?.sourcePath ?? '');
    const name = source.slice(source.lastIndexOf('/') + 1);
    const dir = `${String(args?.destRecordingsDir ?? '')}/Import ${name.replace(/\.[^.]+$/, '')} 2026-01-01 000000`;
    return { bundle_dir: dir, audio_path: `${dir}/audio.m4a`, duration_secs: 60, original_name: name };
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearMockInvokeHandlers();
  eventListeners.clear();
});

// ---------------------------------------------------------------------------
// Recording commands (recording contract, 2026-11)
// ---------------------------------------------------------------------------

/** What `registerRecordingHandlers` recorded, in call order. */
export interface RecordingMockLog {
  /** Command names, in the order they were invoked. */
  calls: string[];
  /** Every `write_file`, in order. */
  written: Array<{ path: string; content: string }>;
  /** Arguments of every `finalize_recording_bundle`. */
  finalized: Array<{ stagingDir: string; destRecordingsDir: string }>;
}

/**
 * Register a small in-memory recorder behind the recording commands: a
 * capture that can be started, paused, stopped into a LOCAL staging bundle,
 * finalised into a library folder, or discarded. Call it in `beforeEach`
 * (handlers are cleared between tests) and override single commands with
 * `setMockInvokeHandler` afterwards.
 *
 * Returns a log of what was invoked, so a test can assert ORDER (the manifest
 * is written into staging before the bundle is finalised).
 */
export function registerRecordingHandlers(): RecordingMockLog {
  const log: RecordingMockLog = { calls: [], written: [], finalized: [] };
  const STAGING = '/Users/me/.notesage/recordings-staging/Recording 2026-11-25 101500';
  let recording = false;
  let paused = false;
  let source: string | null = null;
  const on = (command: string, handler: (args?: Record<string, unknown>) => unknown) =>
    setMockInvokeHandler(command, (args) => {
      log.calls.push(command);
      return handler(args);
    });

  on('recording_preflight', () => ({
    microphone: 'granted',
    system_audio: 'available',
    input_device: 'MacBook Pro Microphone',
    output_device: 'MacBook Pro Speakers',
    free_bytes: 50_000_000_000,
  }));
  on('start_recording', (args) => {
    recording = true;
    paused = false;
    source = String(args?.source ?? 'microphone');
  });
  on('pause_recording', () => {
    paused = true;
  });
  on('resume_recording', () => {
    paused = false;
  });
  on('stop_recording', () => {
    const both = source === 'both';
    recording = false;
    paused = false;
    return {
      bundle_dir: STAGING,
      audio_path: `${STAGING}/audio.m4a`,
      tracks: both
        ? [
            { role: 'mic', path: `${STAGING}/mic.m4a` },
            { role: 'system', path: `${STAGING}/system.m4a` },
          ]
        : [],
      duration_secs: 4503,
      peak: 0.4,
      sample_rate: 48_000,
      dropped_frames: 0,
      warnings: [],
    };
  });
  on('discard_recording', () => {
    recording = false;
    paused = false;
  });
  on('finalize_recording_bundle', (args) => {
    const stagingDir = String(args?.stagingDir);
    const destRecordingsDir = String(args?.destRecordingsDir);
    log.finalized.push({ stagingDir, destRecordingsDir });
    const name = stagingDir.split('/').pop() ?? 'Recording';
    const dir = `${destRecordingsDir}/${name}`;
    const both = source === 'both';
    return {
      bundle_dir: dir,
      audio_path: `${dir}/audio.m4a`,
      tracks: both
        ? [
            { role: 'mic', path: `${dir}/mic.m4a` },
            { role: 'system', path: `${dir}/system.m4a` },
          ]
        : [],
    };
  });
  on('recover_orphan_recordings', () => []);
  on('get_recording_state', () => ({
    recording,
    paused,
    source,
    started_at_ms: recording ? Date.now() : null,
    elapsed_recorded_ms: 0,
  }));
  on('list_whisper_models', () => [
    { name: 'large-v3-turbo-q5_0', size_bytes: 574_000_000, downloaded: true },
  ]);
  on('file_size', () => 1_234_567);
  on('get_device_name', () => "Peter's Mac");
  on('write_file', (args) => {
    log.written.push({ path: String(args?.path), content: String(args?.content) });
  });
  return log;
}
