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
  // Speaker identification: nothing installed, nothing stored. A test of the
  // feature itself calls `registerSpeakerHandlers()` for the stateful backend.
  setMockInvokeHandler('speaker_models_status', () => ({ installed: false, models: [] }));
  setMockInvokeHandler('voice_profiles_list', () => ({ profiles: [], quarantined: 0, directory: '' }));
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

// ---------------------------------------------------------------------------
// Speaker identification commands (voice-analysis contract, 2026-11)
// ---------------------------------------------------------------------------

/** A stored voice as `voice_profiles_list` returns it (no embedding). */
export interface MockVoiceProfile {
  id: string;
  name: string;
  is_me: boolean;
  created_at: string;
  updated_at: string;
  sources: Array<{ kind: string; recording: string | null; at: string }>;
  model: string;
  exemplar_count: number;
  usable: boolean;
}

export interface SpeakerMockState {
  /** Every speaker command, with its arguments, in call order. */
  calls: Array<{ cmd: string; args: Record<string, unknown> }>;
  /** Arguments of each call to one command. */
  argsOf: (cmd: string) => Array<Record<string, unknown>>;
  modelInstalled: boolean;
  profiles: MockVoiceProfile[];
  /** What `analyze_speakers` resolves with. Replace to defer, fail or inspect. */
  analyze: (args: Record<string, unknown>) => unknown;
  /** What `voice_profiles_match` resolves with (after the consent check). */
  match: (args: Record<string, unknown>) => unknown;
  /** What `embed_speaker_turns` resolves with. */
  embed: (args: Record<string, unknown>) => unknown;
  /** What `enrol_own_voice` does after the consent check. Throw to fail. */
  enrol: (args: Record<string, unknown>) => void;
  /** What `download_speaker_models` does. Throw to fail; return a promise to hold. */
  download: () => unknown;
}

export const MOCK_VOICE_MODEL = 'wespeaker-voxceleb-resnet34-lm';
const CONSENT_ERROR = 'Voice recognition is not enabled';

/** A unit-length stand-in for a 256-float voiceprint, recognisable in a leak check. */
export function mockEmbedding(seed: number): number[] {
  const raw = Array.from({ length: 256 }, (_, i) => Math.sin(seed * 7.13 + i * 0.37));
  const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0));
  return raw.map((v) => v / norm);
}

/**
 * Register an in-memory voice-analysis backend that behaves like the contract:
 * the consent-gated commands REJECT with the exact backend string unless
 * `consent === true`, profiles never carry an embedding out, and every call is
 * logged with its arguments so a test can assert what was (and was not) sent.
 */
export function registerSpeakerHandlers(
  initial: Partial<Pick<SpeakerMockState, 'modelInstalled' | 'profiles'>> = {},
): SpeakerMockState {
  let nextId = 1;
  const state: SpeakerMockState = {
    calls: [],
    argsOf: (cmd) => state.calls.filter((c) => c.cmd === cmd).map((c) => c.args),
    modelInstalled: initial.modelInstalled ?? true,
    profiles: initial.profiles ? initial.profiles.map((p) => ({ ...p })) : [],
    analyze: (args) => {
      const segments = Array.isArray(args.segments) ? (args.segments as Array<Record<string, unknown>>) : null;
      const tracks = Array.isArray(args.tracks) ? (args.tracks as Array<{ path: string }>) : [];
      const twoTrack = tracks.length === 2 && args.sharedMicrophone !== true;
      const labels = twoTrack ? ['me', 'speaker-1', 'speaker-2'] : ['speaker-1', 'speaker-2'];
      const trackPath = tracks.length > 0 ? String(tracks[tracks.length - 1].path) : String(args.audioPath);
      return {
        turns: labels.map((speaker, i) => ({ start: i * 10, end: i * 10 + 8, speaker })),
        speakers: labels.map((label, i) => ({
          label,
          total_secs: 60 * (labels.length - i),
          sample: { track_path: trackPath, start: i * 10 + 1, end: i * 10 + 7 },
          embedding: mockEmbedding(i + 1),
        })),
        ...(segments
          ? {
              segments: segments.map((s, i) => ({
                start: s.start,
                end: s.end,
                text: s.text,
                speaker: twoTrack && s.speaker === 'me' ? 'me' : `speaker-${(i % 2) + 1}`,
              })),
            }
          : {}),
        duration_secs: 120,
        model: MOCK_VOICE_MODEL,
      };
    },
    match: (args) =>
      (Array.isArray(args.speakers) ? (args.speakers as Array<{ label: string }>) : []).map((s) => ({
        label: s.label,
        candidates: [],
      })),
    embed: (args) => {
      const turns = Array.isArray(args.turns) ? (args.turns as Array<{ speaker: string }>) : [];
      const names = [...new Set(turns.map((turn) => turn.speaker))];
      return {
        speakers: names.map((speaker, i) => ({ speaker, embedding: mockEmbedding(100 + i), total_secs: 30 })),
        skipped: [],
        model: MOCK_VOICE_MODEL,
      };
    },
    enrol: () => undefined,
    download: () => {
      state.modelInstalled = true;
      return null;
    },
  };

  const on = (cmd: string, handler: (args: Record<string, unknown>) => unknown) =>
    setMockInvokeHandler(cmd, (args) => {
      const a = args ?? {};
      state.calls.push({ cmd, args: a });
      return handler(a);
    });
  const requireConsent = (a: Record<string, unknown>) => {
    if (a.consent !== true) throw new Error(CONSENT_ERROR);
  };
  const find = (id: unknown): MockVoiceProfile => {
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) throw new Error(`Voice profile not found: ${String(id)}`);
    return profile;
  };
  const now = () => new Date().toISOString();
  const blank = (name: string, isMe: boolean): MockVoiceProfile => ({
    id: `vp-${nextId++}`,
    name,
    is_me: isMe,
    created_at: now(),
    updated_at: now(),
    sources: [],
    model: MOCK_VOICE_MODEL,
    exemplar_count: 0,
    usable: true,
  });

  on('speaker_models_status', () => ({
    installed: state.modelInstalled,
    models: [
      {
        id: MOCK_VOICE_MODEL,
        name: 'WeSpeaker ResNet34-LM',
        size_bytes: 26_530_550,
        installed: state.modelInstalled,
        licence: 'CC-BY-4.0 (WeSpeaker, trained on VoxCeleb)',
        source: 'wenet-e2e/wespeaker',
        download_url: 'https://example.invalid/wespeaker_en_voxceleb_resnet34_LM.onnx',
      },
    ],
  }));
  on('download_speaker_models', () => state.download());
  on('cancel_speaker_models_download', () => true);
  on('delete_speaker_models', () => {
    state.modelInstalled = false;
    return null;
  });
  on('analyze_speakers', (a) => {
    if (!state.modelInstalled) {
      throw new Error('Voice models are not downloaded. Download them from Settings > Transcription.');
    }
    return state.analyze(a);
  });
  on('embed_speaker_turns', (a) => state.embed(a));
  on('voice_profiles_list', () => ({
    profiles: state.profiles.map((p) => ({ ...p })),
    quarantined: 0,
    directory: '/Users/me/.notesage/voice-profiles',
  }));
  on('voice_profile_save', (a) => {
    requireConsent(a);
    const name = String(a.name ?? '').trim();
    const embedding = Array.isArray(a.embedding) ? a.embedding : [];
    if (embedding.length === 0) throw new Error('The voice embedding is empty or not a number');
    const source = (a.source ?? {}) as { kind?: string; recording?: string | null };
    let profile =
      (typeof a.profileId === 'string' ? find(a.profileId) : undefined) ??
      (a.isMe === true ? state.profiles.find((p) => p.is_me) : undefined) ??
      state.profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const created = !profile;
    if (!profile) {
      if (!name) throw new Error('A voice profile needs a name');
      profile = blank(name, a.isMe === true);
      state.profiles.push(profile);
    }
    if (name) profile.name = name;
    profile.sources.push({ kind: String(source.kind ?? 'manual'), recording: source.recording ?? null, at: now() });
    profile.exemplar_count += 1;
    profile.updated_at = now();
    return { profile: { ...profile }, created };
  });
  on('voice_profile_rename', (a) => {
    const profile = find(a.profileId);
    const name = String(a.name ?? '').trim();
    if (!name) throw new Error('A voice profile needs a name');
    profile.name = name;
    return { ...profile };
  });
  on('voice_profiles_merge', (a) => {
    if (a.intoId === a.fromId) throw new Error('Cannot merge a voice profile with itself');
    const into = find(a.intoId);
    const from = find(a.fromId);
    into.exemplar_count += from.exemplar_count;
    into.sources.push(...from.sources);
    state.profiles = state.profiles.filter((p) => p.id !== from.id);
    return { ...into };
  });
  on('voice_profile_delete', (a) => {
    find(a.profileId);
    state.profiles = state.profiles.filter((p) => p.id !== a.profileId);
    return null;
  });
  on('voice_profiles_delete_all', () => {
    const count = state.profiles.length;
    state.profiles = [];
    return count;
  });
  on('voice_profiles_match', (a) => {
    requireConsent(a);
    return state.match(a);
  });
  on('enrol_own_voice', (a) => {
    requireConsent(a);
    state.enrol(a);
    let profile = state.profiles.find((p) => p.is_me);
    const created = !profile;
    if (!profile) {
      profile = blank(typeof a.name === 'string' && a.name ? a.name : 'Me', true);
      state.profiles.push(profile);
    }
    profile.sources.push({ kind: 'enrolment', recording: null, at: now() });
    profile.exemplar_count += 1;
    return { profile: { ...profile }, created };
  });
  on('extract_audio_clip', (a) => {
    const start = Number(a.start);
    const end = Number(a.end);
    if (!(end > start)) throw new Error('Invalid clip range');
    if (end - start > 30) throw new Error('A clip can be at most 30 seconds long');
    return { path: `/tmp/notesage-speaker-clips/clip-${Math.round(start * 10)}-${Math.round(end * 10)}.wav` };
  });
  return state;
}
