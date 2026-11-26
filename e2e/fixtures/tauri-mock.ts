/**
 * Tauri IPC mock for Playwright E2E tests.
 *
 * Injects `window.__TAURI_INTERNALS__` via page.addInitScript() so the app
 * runs without a real Tauri backend. Provides default handlers for common
 * commands and allows per-test overrides.
 */
import type { Page } from '@playwright/test';
import {
  SAMPLE_FILE_TREE,
  SAMPLE_FILES,
  SAMPLE_PROJECT_PATH,
  SAMPLE_TAGS,
  SAMPLE_TAG_OCCURRENCES,
  SAMPLE_MENTIONS,
  SAMPLE_MENTION_OCCURRENCES,
  SAMPLE_RESEARCH,
  SAMPLE_FILENAME_RESULTS,
} from './sample-data';

export interface TauriMockOptions {
  /** Override default command handlers. Key = command name, value = return value or function body string. */
  overrides?: Record<string, unknown>;
  /** File contents map — path → content. Merged with SAMPLE_FILES defaults. */
  files?: Record<string, string>;
  /** File tree to return from list_directory. Defaults to SAMPLE_FILE_TREE. */
  fileTree?: unknown[];
}

/**
 * Sets up the Tauri IPC mock on a Playwright page.
 *
 * Must be called BEFORE page.goto() so the init script runs before the app boots.
 */
export async function setupTauriMock(page: Page, options: TauriMockOptions = {}): Promise<void> {
  const fileTree = options.fileTree ?? SAMPLE_FILE_TREE;

  // Build a path→content map from sample data + overrides
  const fileContents: Record<string, string> = {};
  for (const [name, content] of Object.entries(SAMPLE_FILES)) {
    fileContents[`${SAMPLE_PROJECT_PATH}/${name}`] = content;
    fileContents[`${SAMPLE_PROJECT_PATH}/subfolder/${name}`] = content;
  }
  if (options.files) {
    Object.assign(fileContents, options.files);
  }

  const overrides = options.overrides ?? {};

  // Document-index sample data, passed into the page context so the index
  // handlers below can return realistic shapes for the command-bar modes.
  const indexData = {
    tags: SAMPLE_TAGS,
    tagOccurrences: SAMPLE_TAG_OCCURRENCES,
    mentions: SAMPLE_MENTIONS,
    mentionOccurrences: SAMPLE_MENTION_OCCURRENCES,
    research: SAMPLE_RESEARCH,
    filenames: SAMPLE_FILENAME_RESULTS,
  };

  await page.addInitScript(
    ({ fileTree, fileContents, overrides, projectPath, indexData }) => {
      // ---------------------------------------------------------------------------
      // Callback registry — implements transformCallback for @tauri-apps/api
      // ---------------------------------------------------------------------------
      const callbacks: Record<number, (response: unknown) => void> = {};
      let callbackId = 0;

      function transformCallback(callback: (response: unknown) => void, once = false): number {
        const id = callbackId++;
        const wrapped = once
          ? (response: unknown) => {
              callback(response);
              delete callbacks[id];
            }
          : callback;
        callbacks[id] = wrapped;
        return id;
      }

      // ---------------------------------------------------------------------------
      // Event listener registry for mock listen/emit
      // ---------------------------------------------------------------------------
      const eventListeners: Record<string, Array<(event: { payload: unknown; event: string; id: number }) => void>> = {};
      let listenerId = 0;

      // ---------------------------------------------------------------------------
      // Mock invoke handlers
      // ---------------------------------------------------------------------------
      const HOME_DIR = '/tmp/notesage-e2e-home';
      const NOTESAGE_LIB = `${HOME_DIR}/Notesage`;

      // State behind the recording command handlers below. Exposed on
      // `window.__RECORDING_MOCK__` so a spec can change the preflight answer
      // or pretend an hour has been recorded.
      const RECORDING_STAGING = `${HOME_DIR}/.notesage/recordings-staging/Recording 2026-11-25 101500`;
      const recordingMock = {
        recording: false,
        paused: false,
        source: 'microphone',
        startedAt: 0,
        pausedAt: 0,
        pausedTotal: 0,
        /** When set, the recorded time reported, whatever the clock says. */
        elapsedMs: null as number | null,
        preflight: {
          microphone: 'granted',
          system_audio: 'available',
          input_device: 'MacBook Pro Microphone',
          output_device: 'MacBook Pro Speakers',
          free_bytes: 50_000_000_000,
        } as Record<string, unknown>,
      };
      const recordingMockElapsed = (): number => {
        if (recordingMock.elapsedMs !== null) return recordingMock.elapsedMs;
        const end = recordingMock.paused ? recordingMock.pausedAt : Date.now();
        return Math.max(0, end - recordingMock.startedAt - recordingMock.pausedTotal);
      };
      (window as Record<string, unknown>).__RECORDING_MOCK__ = recordingMock;

      const defaultHandlers: Record<string, (args?: Record<string, unknown>) => unknown> = {
        // File operations
        list_directory: () => fileTree,
        list_files_shallow: () => [],
        read_file: (args) => {
          const path = args?.path as string;
          if (path && path in fileContents) return fileContents[path];
          return '';
        },
        write_file: () => null,
        path_exists: (args) => {
          const path = args?.path as string;
          // The Notesage library dir should "exist"
          if (path === NOTESAGE_LIB || path === HOME_DIR) return true;
          if (path && path in fileContents) return true;
          return false;
        },
        watch_directory: () => null,
        mark_self_write: () => null,
        clear_self_write: () => null,
        open_folder_dialog: () => projectPath,
        create_file: () => null,
        create_directory: () => null,
        rename_path: () => null,
        delete_path: () => null,
        trash_paths: () => [],
        copy_directory: () => null,

        // System / paths
        get_home_dir: () => HOME_DIR,
        get_icloud_path: () => null,

        // Credential operations
        get_credential: () => null,
        store_credential: () => null,
        delete_credential: () => null,
        migrate_credentials: () => 0,

        // Store operations
        health_check: () => null,
        get_store_value: () => null,
        set_store_value: () => null,
        store_read: () => null,
        store_read_batch: () => ({}),
        store_write: () => null,

        // Logging
        set_log_level: () => null,
        get_debug_logging: () => false,

        // Research
        search_research: () => [],

        // Transcription
        list_whisper_models: () => [],
        transcribe_file: () => ({
          segments: [{ start: 0, end: 2, text: 'Hello from the mock.', speaker: null }],
          duration_secs: 2,
          language: 'en',
          decoder: 'mock',
        }),
        cancel_transcription: () => true,
        audio_file_status: () => ({ exists: true, size: 1024, local: true }),
        file_size: () => 1024,
        icloud_ensure_downloaded: () => 'ready',
        get_device_name: () => 'E2E Mac',
        // Import: a new bundle named after the picked file, as `import_media` makes one.
        import_media: (args) => {
          const source = String(args?.sourcePath ?? '');
          const name = source.slice(source.lastIndexOf('/') + 1);
          const dir = `${String(args?.destRecordingsDir ?? '')}/Import ${name.replace(/\.[^.]+$/, '')} 2026-01-01 000000`;
          return { bundle_dir: dir, audio_path: `${dir}/audio.m4a`, duration_secs: 60, original_name: name };
        },

        // Recording (recording contract, 2026-11): a small in-page recorder so
        // a spec can start, pause, stop and discard. The clock is the wall
        // clock minus paused time; a spec that needs a long recording sets
        // `window.__RECORDING_MOCK__.elapsedMs`. Levels and warnings are not
        // produced here: a spec emits `recording-level` / `recording-warning`.
        recording_preflight: () => recordingMock.preflight,
        start_recording: (args) => {
          recordingMock.recording = true;
          recordingMock.paused = false;
          recordingMock.source = String(args?.source ?? 'microphone');
          recordingMock.startedAt = Date.now();
          recordingMock.pausedAt = 0;
          recordingMock.pausedTotal = 0;
          recordingMock.elapsedMs = null;
          return null;
        },
        pause_recording: () => {
          recordingMock.paused = true;
          recordingMock.pausedAt = Date.now();
          return null;
        },
        resume_recording: () => {
          if (recordingMock.paused) recordingMock.pausedTotal += Date.now() - recordingMock.pausedAt;
          recordingMock.paused = false;
          return null;
        },
        stop_recording: () => {
          const durationSecs = recordingMockElapsed() / 1000;
          const both = recordingMock.source === 'both';
          recordingMock.recording = false;
          recordingMock.paused = false;
          return {
            bundle_dir: RECORDING_STAGING,
            audio_path: `${RECORDING_STAGING}/audio.m4a`,
            tracks: both
              ? [
                  { role: 'mic', path: `${RECORDING_STAGING}/mic.m4a` },
                  { role: 'system', path: `${RECORDING_STAGING}/system.m4a` },
                ]
              : [],
            duration_secs: durationSecs,
            peak: 0.4,
            sample_rate: 48000,
            dropped_frames: 0,
            warnings: [],
          };
        },
        discard_recording: () => {
          recordingMock.recording = false;
          recordingMock.paused = false;
          return null;
        },
        finalize_recording_bundle: (args) => {
          const dir = `${String(args?.destRecordingsDir)}/Recording 2026-11-25 101500`;
          return { bundle_dir: dir, audio_path: `${dir}/audio.m4a`, tracks: [] };
        },
        recover_orphan_recordings: () => [],
        get_recording_state: () => ({
          recording: recordingMock.recording,
          paused: recordingMock.paused,
          source: recordingMock.recording ? recordingMock.source : null,
          started_at_ms: recordingMock.recording ? recordingMock.startedAt : null,
          elapsed_recorded_ms: recordingMock.recording ? recordingMockElapsed() : 0,
        }),

        // Skills / Agents
        discover_skills: () => [],
        extract_skill_tools: () => [],
        discover_agents: () => [],
        scan_agent_instructions: () => [],
        read_agent_instructions: () => [],
        // Shape matters: the frontend reads `changed`/`removed` to decide
        // whether to rescan. Zero/zero is the steady state — nothing changed.
        extract_bundled_skills: () => ({ dir: '/tmp/notesage-e2e-home/.notesage/skills', changed: 0, removed: 0 }),
        cleanup_bundled_agents: () => 0,

        // MCP
        mcp_list_servers: () => [],
        mcp_discover_configs: () => [],
        mcp_config_problems: () => [],

        // Local AI
        local_inference_status: () => ({ running: false, port: null, model: null }),
        network_proxy_status: () => [],
        stop_local_server: () => null,
        list_local_models: () => [],
        get_system_memory: () => ({ total_bytes: 16_000_000_000, available_bytes: 8_000_000_000 }),

        // Sync
        get_sync_settings: () => ({ version: 1, icloudEnabled: false, syncQuickNotes: false, syncedProjects: [] }),

        // Automations
        list_automations: () => [],
        set_automations_enabled: () => null,
        reload_automation_schedule: () => null,

        // Git
        git_status: () => ({ branch: 'main', files: [], is_repo: false }),
        git_branch_list: () => [],

        // Document index
        index_init: () => null,
        index_open: () => null,
        // Legacy mock entries (command names the app does NOT actually invoke).
        // Kept so existing callers don't regress; the real commands below are
        // what TagMode/ReferenceMode/ResearchMode/FileMode call.
        index_query_tags: () => [],
        index_query_mentions: () => [],
        index_query_headings: () => [],
        index_query_tasks: () => [],
        index_search_content: () => [],
        index_reindex_directory: () => null,
        index_tasks: () => [],
        index_goals: () => [],

        // ---- Real document-index commands (the ones the app invokes) ----
        // `index_tags` → IndexedTag[] `{ tag, file_count }`, file_count desc.
        // Optional `query` substring-filters the tag name (mirrors Rust).
        index_tags: (args) => {
          const q = ((args?.query as string | null) ?? '').trim().toLowerCase();
          const rows = indexData.tags;
          return q ? rows.filter((r) => r.tag.toLowerCase().includes(q)) : rows;
        },
        // `index_tag_occurrences` → IndexTagOccurrence[]
        // `{ path, file_name, context_before, context_after }`, keyed by `tag`.
        index_tag_occurrences: (args) => {
          const tag = (args?.tag as string) ?? '';
          return indexData.tagOccurrences[tag] ?? [];
        },
        // `index_mentions` → IndexedMention[] `{ mention, file_count }`.
        index_mentions: (args) => {
          const q = ((args?.query as string | null) ?? '').trim().toLowerCase();
          const rows = indexData.mentions;
          return q
            ? rows.filter((r) => r.mention.toLowerCase().includes(q))
            : rows;
        },
        // `index_mention_occurrences` → IndexTagOccurrence[], keyed by `mention`.
        index_mention_occurrences: (args) => {
          const mention = (args?.mention as string) ?? '';
          return indexData.mentionOccurrences[mention] ?? [];
        },
        // `index_search_research` → IndexResearchResult[]. Substring-filters
        // title/snippet/tags by `query`; `tag` exact-matches a tag if present.
        index_search_research: (args) => {
          const q = ((args?.query as string | null) ?? '').trim().toLowerCase();
          const tag = ((args?.tag as string | null) ?? '').trim().toLowerCase();
          let rows = indexData.research;
          if (q) {
            rows = rows.filter(
              (r) =>
                r.title.toLowerCase().includes(q) ||
                r.snippet.toLowerCase().includes(q) ||
                r.tags.some((t) => t.toLowerCase().includes(q)),
            );
          }
          if (tag) {
            rows = rows.filter((r) =>
              r.tags.some((t) => t.toLowerCase() === tag),
            );
          }
          return rows;
        },
        // `index_search_filenames` → IndexFilenameSearchResult[]
        // `{ path, file_name, parent_dir, project_root }`. Substring-filters
        // the basename by the required `query`.
        index_search_filenames: (args) => {
          const q = ((args?.query as string) ?? '').trim().toLowerCase();
          const rows = indexData.filenames;
          return q
            ? rows.filter((r) => r.file_name.toLowerCase().includes(q))
            : rows;
        },

        // ---- Link-graph commands (OKF wiki-navigation) ----
        // Default empty so the Relations panel self-hides; a spec can supply
        // non-empty relations via `overrides` (e.g. { get_backlinks: [...],
        // get_outlinks: [...] }) to exercise the panel.
        get_backlinks: () => [],
        get_outlinks: () => [],
        get_broken_links: () => [],
        resolve_wikilink: () => [],

        // Actions
        scan_actions: () => [],

        // AI
        ai_chat_stream: () => null,
        copilot_lsp_start: () => null,

        // Editor styles
        read_editor_styles: () => null,
        list_fonts: () => [],
      };

      // Apply overrides
      for (const [cmd, value] of Object.entries(overrides)) {
        if (typeof value === 'function') {
          defaultHandlers[cmd] = value as (args?: Record<string, unknown>) => unknown;
        } else {
          defaultHandlers[cmd] = () => value;
        }
      }

      // ---------------------------------------------------------------------------
      // __TAURI_INTERNALS__
      // ---------------------------------------------------------------------------
      const internals = {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          // Intercept event plugin commands
          if (cmd === 'plugin:event|listen') {
            const event = args?.event as string;
            const handlerId = args?.handler as number;
            if (!eventListeners[event]) eventListeners[event] = [];
            const id = listenerId++;
            // The handler ID references a transformCallback-registered function
            const handlerFn = callbacks[handlerId];
            if (handlerFn) {
              eventListeners[event].push(handlerFn as (event: { payload: unknown; event: string; id: number }) => void);
            }
            return id;
          }
          if (cmd === 'plugin:event|unlisten') {
            return null;
          }

          const handler = defaultHandlers[cmd];
          if (handler) {
            return handler(args);
          }
          console.warn(`[tauri-mock] Unhandled command: ${cmd}`, args);
          return null;
        },
        transformCallback,
        callbacks,
        metadata: {
          currentWebview: { label: 'main', windowLabel: 'main' },
          currentWindow: { label: 'main' },
          windows: [{ label: 'main' }],
          webviews: [{ label: 'main', windowLabel: 'main' }],
        },
        convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
      };

      (window as Record<string, unknown>).__TAURI_INTERNALS__ = internals;

      // Tauri event plugin internals — required for listen() unlisten cleanup
      (window as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (_event: string, _eventId: number) => {
          // No-op in mock — listeners cleaned up naturally
        },
      };

      // ---------------------------------------------------------------------------
      // Helper for tests to emit mock events
      // ---------------------------------------------------------------------------
      (window as Record<string, unknown>).__TAURI_MOCK_EMIT__ = (eventName: string, payload: unknown) => {
        const listeners = eventListeners[eventName];
        if (listeners) {
          for (const listener of listeners) {
            if (typeof listener === 'function') {
              listener({ payload, event: eventName, id: 0 });
            }
          }
        }
      };
    },
    { fileTree, fileContents, overrides, projectPath: SAMPLE_PROJECT_PATH, indexData },
  );
}

/**
 * Emit a mock Tauri event from the test to the page.
 * Useful for simulating streaming AI responses, file change events, etc.
 */
export async function emitTauriEvent(page: Page, eventName: string, payload: unknown): Promise<void> {
  await page.evaluate(
    ({ eventName, payload }) => {
      const emit = (window as Record<string, unknown>).__TAURI_MOCK_EMIT__ as
        | ((event: string, payload: unknown) => void)
        | undefined;
      if (emit) emit(eventName, payload);
    },
    { eventName, payload },
  );
}

/**
 * Track invoke calls made by the app. Returns a function to get captured calls.
 */
export async function trackInvokeCalls(page: Page): Promise<() => Promise<Array<{ cmd: string; args: unknown }>>> {
  await page.evaluate(() => {
    (window as Record<string, unknown>).__TAURI_INVOKE_LOG__ = [] as Array<{ cmd: string; args: unknown }>;
    const internals = (window as Record<string, unknown>).__TAURI_INTERNALS__ as {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    const original = internals.invoke;
    internals.invoke = async (cmd: string, args?: Record<string, unknown>) => {
      ((window as Record<string, unknown>).__TAURI_INVOKE_LOG__ as Array<{ cmd: string; args: unknown }>).push({ cmd, args: args ?? {} });
      return original(cmd, args);
    };
  });

  return async () => {
    return page.evaluate(() => {
      return (window as Record<string, unknown>).__TAURI_INVOKE_LOG__ as Array<{ cmd: string; args: unknown }>;
    });
  };
}
