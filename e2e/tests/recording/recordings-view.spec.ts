/**
 * The Recordings place in a real browser (recording review U1, U15, U26, U27,
 * U35; N2; N3).
 *
 * What jsdom cannot see is what this spec is for: whether the list still
 * covers the document after "Open transcript", and whether the last row's
 * buttons are reachable or sit underneath the floating command bar and the
 * orb. Those are answered by asking the browser what is on top.
 *
 * The backend is a small stateful fake installed over the shared Tauri mock:
 * a Recordings folder that can be listed, read, written, renamed and trashed,
 * so a rename or a delete is something the next listing actually shows.
 */
import { test as base, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { setupTauriMock, emitTauriEvent } from '../../fixtures/tauri-mock';
import { SAMPLE_FILE_TREE, SAMPLE_PROJECT_PATH } from '../../fixtures/sample-data';

const HOME = '/tmp/notesage-e2e-home';
const RECORDINGS = `${HOME}/Notesage/Recordings`;
// Playwright runs specs from the repository root.
const FIXTURES = path.resolve('src/lib/transcription/__tests__/fixtures');
const TEAMS_VTT = fs.readFileSync(path.join(FIXTURES, 'teams-meeting.vtt'), 'utf8');
const TEAMS_SEGMENTS = fs.readFileSync(path.join(FIXTURES, 'teams-meeting.segments.json'), 'utf8');
const SHOTS = process.env.RECORDINGS_SHOTS_DIR;

interface BundleSeed {
  name: string;
  title?: string;
  startedAt: string;
  durationSecs?: number;
  source?: string;
  language?: string;
  device?: string;
  transcription?: Record<string, unknown> | null;
  /** Transcript file name → content. */
  transcript?: [string, string];
  files?: Record<string, string>;
  originalFile?: { name: string; path: string };
  noManifest?: boolean;
  notLocal?: boolean;
  bytes?: number;
  /**
   * The user cancelled its transcription once (`autoTranscribe: false`), so
   * the scanner leaves it alone. Without this the app would transcribe a
   * pending recording by itself as soon as it starts, as it should.
   */
  manual?: boolean;
}

function manifestOf(seed: BundleSeed): string {
  const manifest: Record<string, unknown> = {
    version: 1,
    createdBy: { device: seed.device ?? 'E2E Mac', app: 'notesage-macos', appVersion: '0.64.0' },
    startedAt: seed.startedAt,
    durationSecs: seed.durationSecs ?? 1834,
    source: seed.source ?? 'microphone',
    ...(seed.language ? { language: seed.language } : {}),
    audio: { file: 'audio.m4a', bytes: seed.bytes ?? 14_703_112, codec: 'aac', sampleRate: 48000, channels: 1 },
    transcription: seed.transcription ?? null,
    ...(seed.title ? { title: seed.title } : {}),
    ...(seed.originalFile ? { originalFile: seed.originalFile } : {}),
    ...(seed.transcript ? { transcript: { file: seed.transcript[0] } } : {}),
    ...(seed.manual ? { autoTranscribe: false } : {}),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function filesOf(seeds: BundleSeed[]): { files: Record<string, string>; notLocal: string[] } {
  const files: Record<string, string> = {};
  const notLocal: string[] = [];
  for (const seed of seeds) {
    const dir = `${RECORDINGS}/${seed.name}`;
    files[`${dir}/audio.m4a`] = '<audio>';
    if (!seed.noManifest) files[`${dir}/recording.json`] = manifestOf(seed);
    if (seed.transcript) files[`${dir}/${seed.transcript[0]}`] = seed.transcript[1];
    for (const [name, content] of Object.entries(seed.files ?? {})) files[`${dir}/${name}`] = content;
    if (seed.notLocal) notLocal.push(`${dir}/audio.m4a`);
  }
  return { files, notLocal };
}

const TRANSCRIPT = (title: string) =>
  `---\ntype: meeting-transcript\ntitle: ${title}\nlanguage: sv\n---\n\n# ${title}\n\n**Me** [00:00:03] Then we start the weekly sync.\n\n**Others** [00:00:09] Sounds good, go ahead.\n`;

const WEEKLY: BundleSeed = {
  name: 'Recording 2026-11-20 09-00-00',
  title: 'Weekly sync',
  startedAt: '2026-11-20T09:00:00+01:00',
  durationSecs: 4503,
  source: 'both',
  language: 'sv',
  transcription: { status: 'done', device: 'E2E Mac', updatedAt: '2026-11-20T10:20:00+01:00', model: 'large-v3-turbo-q5_0', language: 'sv' },
  transcript: ['Weekly sync.md', TRANSCRIPT('Weekly sync')],
};

/** One recording in every state a row can honestly be in. */
const EVERY_STATUS: BundleSeed[] = [
  WEEKLY,
  { name: 'Recording 2026-11-19 14-30-00', title: 'Design review', startedAt: '2026-11-19T14:30:00+01:00', durationSecs: 2710, language: 'en', manual: true },
  {
    name: 'Recording 2026-11-18 10-15-00',
    title: 'Customer call',
    startedAt: '2026-11-18T10:15:00+01:00',
    device: "Peter's iPhone",
    transcription: { status: 'failed', device: 'E2E Mac', updatedAt: '2026-11-18T11:00:00+01:00', error: "Model 'large-v3-turbo-q5_0' not downloaded. Download it from Settings > Transcription." },
  },
  { name: 'Recording 2026-11-17 16-00-00', title: 'Planning', startedAt: '2026-11-17T16:00:00+01:00', notLocal: true },
  {
    name: 'Import Kickoff 2026-11-16 120000',
    title: 'Kickoff',
    startedAt: '2026-11-16T12:00:00+01:00',
    source: 'import',
    originalFile: { name: 'Kickoff.mp4', path: '/Users/peter/Downloads/Kickoff.mp4' },
    transcription: { status: 'running', device: "Peter's iMac", updatedAt: new Date().toISOString() },
  },
  { name: 'Recording 2026-11-15 08-05-00', startedAt: '2026-11-15T08:05:00+01:00', noManifest: true },
];

interface FakeOptions {
  seeds: BundleSeed[];
  settings?: Record<string, unknown>;
  extraFiles?: Record<string, string>;
  /** `transcribe_file` never resolves, so a job stays visibly running. */
  holdTranscription?: boolean;
}

/**
 * Open the app with a Recordings folder holding `seeds`. Must run before the
 * first navigation: everything is installed as init scripts.
 */
async function openApp(page: Page, options: FakeOptions): Promise<void> {
  const { files, notLocal } = filesOf(options.seeds);
  Object.assign(files, options.extraFiles ?? {});
  await setupTauriMock(page);
  await page.addInitScript(
    ({ projectPath, fileTree, settings }) => {
      localStorage.setItem(
        'notesage-workspace',
        JSON.stringify({
          state: {
            explorerFolders: [],
            projects: [{ path: projectPath, fileTree }],
            recentProjects: [],
            notesTree: [],
            pinnedFiles: [],
            expandedFolders: [projectPath],
          },
          version: 0,
        }),
      );
      // An absolute library root: creating a note refuses a root that still starts with `~`.
      localStorage.setItem(
        'notesage-settings',
        JSON.stringify({ state: { notesRootPath: '/tmp/notesage-e2e-home/Notesage', ...(settings ?? {}) }, version: 29 }),
      );
    },
    { projectPath: SAMPLE_PROJECT_PATH, fileTree: SAMPLE_FILE_TREE, settings: options.settings ?? null },
  );
  await page.addInitScript(
    ({ files, notLocal, RECORDINGS, holdTranscription }) => {
      type Args = Record<string, unknown> | undefined;
      const state = {
        files: { ...files } as Record<string, string>,
        notLocal: new Set<string>(notLocal),
        pick: null as string | null,
        calls: [] as Array<{ cmd: string; args: Args }>,
      };
      (window as unknown as Record<string, unknown>).__REC__ = state;

      const under = (p: string) => p === RECORDINGS || p.startsWith(`${RECORDINGS}/`);
      const isDir = (p: string) => Object.keys(state.files).some((f) => f.startsWith(`${p}/`));
      const list = (dir: string, depth: number, maxDepth: number): unknown[] => {
        const names = new Set<string>();
        for (const f of Object.keys(state.files)) if (f.startsWith(`${dir}/`)) names.add(f.slice(dir.length + 1).split('/')[0]);
        return [...names].sort().map((name) => {
          const full = `${dir}/${name}`;
          const directory = !(full in state.files);
          return {
            name,
            path: full,
            is_directory: directory,
            hidden: false,
            ...(directory ? (depth < maxDepth ? { children: list(full, depth + 1, maxDepth) } : { children: [], truncated: true }) : {}),
          };
        });
      };
      const movePrefix = (from: string, to: string) => {
        for (const f of Object.keys(state.files)) {
          if (f === from || f.startsWith(`${from}/`)) {
            state.files[to + f.slice(from.length)] = state.files[f];
            delete state.files[f];
          }
        }
      };

      const handlers: Record<string, (args: Args) => unknown> = {
        list_directory: (a) => (under(String(a?.path)) ? list(String(a?.path), 0, Number(a?.maxDepth ?? 50)) : undefined),
        read_file: (a) => {
          const p = String(a?.path);
          if (p in state.files) return state.files[p];
          if (under(p)) throw new Error(`Failed to read file ${p}: No such file`);
          return undefined;
        },
        write_file: (a) => {
          const p = String(a?.path);
          if (!under(p)) return undefined;
          state.files[p] = String(a?.content);
          return null;
        },
        path_exists: (a) => {
          const p = String(a?.path);
          if (p in state.files) return true;
          return under(p) ? p === RECORDINGS || isDir(p) : undefined;
        },
        audio_file_status: (a) => {
          const p = String(a?.path);
          return { exists: p in state.files, size: 14_703_112, local: p in state.files && !state.notLocal.has(p) };
        },
        icloud_ensure_downloaded: (a) => (state.notLocal.has(String(a?.path)) ? 'downloading' : 'ready'),
        rename_path: (a) => {
          if (!under(String(a?.oldPath))) return undefined;
          movePrefix(String(a?.oldPath), String(a?.newPath));
          return null;
        },
        trash_path: (a) => {
          const p = String(a?.path);
          for (const f of Object.keys(state.files)) if (f === p || f.startsWith(`${p}/`)) delete state.files[f];
          return null;
        },
        copy_file: (a) => {
          state.files[String(a?.destination)] = state.files[String(a?.source)] ?? '';
          return null;
        },
        open_file_dialog: () => state.pick,
        reveal_in_finder: () => null,
        import_media: (a) => {
          const source = String(a?.sourcePath);
          const name = source.slice(source.lastIndexOf('/') + 1);
          const dir = `${String(a?.destRecordingsDir)}/Import ${name.replace(/\.[^.]+$/, '')} 2026-11-25 101500`;
          state.files[`${dir}/audio.m4a`] = '<audio>';
          return { bundle_dir: dir, audio_path: `${dir}/audio.m4a`, duration_secs: 95, original_name: name };
        },
        transcribe_file: () =>
          holdTranscription
            ? new Promise(() => {})
            : {
                segments: [
                  { start: 0, end: 4, text: 'This is what was said in the imported file.', speaker_id: null, speaker_name: null },
                ],
                duration_secs: 95,
                language: 'en',
                decoder: 'mock',
              },
        list_whisper_models: () => [
          { name: 'large-v3-turbo-q5_0', size_bytes: 574_000_000, downloaded: true },
          { name: 'small', size_bytes: 488_000_000, downloaded: true },
          { name: 'medium', size_bytes: 1_500_000_000, downloaded: false },
        ],
      };

      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Args) => Promise<unknown> } })
        .__TAURI_INTERNALS__;
      const original = internals.invoke;
      internals.invoke = async (cmd: string, args?: Args) => {
        const handler = handlers[cmd];
        if (handler) {
          const result = handler(args);
          if (result !== undefined) {
            state.calls.push({ cmd, args });
            return result;
          }
        }
        return original(cmd, args);
      };
    },
    { files, notLocal, RECORDINGS, holdTranscription: options.holdTranscription ?? false },
  );
  await page.goto('/');
  await expect(page.getByTestId('recordings-row')).toBeVisible({ timeout: 20_000 });
}

async function openRecordings(page: Page): Promise<void> {
  await page.getByTestId('recordings-row').click();
  await expect(page.getByTestId('recordings-view')).toBeVisible();
}

/** Open `welcome.md` from the project in the sidebar. */
async function openSampleFile(page: Page): Promise<void> {
  const fileRow = page.getByRole('treeitem', { name: 'Open file welcome.md' });
  if (!(await fileRow.isVisible())) {
    await page.getByRole('treeitem', { name: /Open project notesage-e2e-project/i }).click();
  }
  await fileRow.click();
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toContainText('Welcome to Notesage', { timeout: 10_000 });
}

function row(page: Page, title: string) {
  return page.getByTestId('recording-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

async function setFake(page: Page, change: { addFiles?: Record<string, string>; pick?: string | null }): Promise<void> {
  await page.evaluate((c) => {
    const state = (window as unknown as { __REC__: { files: Record<string, string>; pick: string | null } }).__REC__;
    Object.assign(state.files, c.addFiles ?? {});
    if (c.pick !== undefined) state.pick = c.pick;
  }, change);
}

async function fakeFiles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => (window as unknown as { __REC__: { files: Record<string, string> } }).__REC__.files);
}

async function fakeCalls(page: Page, cmd: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (c) =>
      (window as unknown as { __REC__: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__REC__.calls
        .filter((call) => call.cmd === c)
        .map((call) => call.args),
    cmd,
  );
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const test = base;

// ---------------------------------------------------------------------------
// U1 — the view is not a trap
// ---------------------------------------------------------------------------

test.describe('Recordings view — leaving it (U1)', () => {
  test('Open transcript shows the transcript, not the list', async ({ page }) => {
    await openApp(page, { seeds: EVERY_STATUS });
    await openRecordings(page);

    await page.getByRole('button', { name: 'Open transcript: Weekly sync' }).click();

    await expect(page.getByTestId('recordings-view')).toHaveCount(0);
    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('Then we start the weekly sync.');
    // And it really is on top: the middle of the document column is the editor.
    const onTop = await editor.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 120));
      return hit !== null && el.contains(hit);
    });
    expect(onTop).toBe(true);
  });

  test('clicking the Recordings row again leaves the view', async ({ page }) => {
    await openApp(page, { seeds: EVERY_STATUS });
    await openRecordings(page);
    await page.getByTestId('recordings-row').click();
    await expect(page.getByTestId('recordings-view')).toHaveCount(0);
    // And once more opens it again.
    await page.getByTestId('recordings-row').click();
    await expect(page.getByTestId('recordings-view')).toBeVisible();
  });

  test('Esc leaves the view', async ({ page }) => {
    await openApp(page, { seeds: EVERY_STATUS });
    await openRecordings(page);
    await page.getByRole('heading', { name: 'Recordings', level: 1 }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('recordings-view')).toHaveCount(0);
  });

  test('opening a document from the sidebar leaves the view', async ({ page }) => {
    await openApp(page, { seeds: EVERY_STATUS });
    await openRecordings(page);
    await openSampleFile(page);
    await expect(page.getByTestId('recordings-view')).toHaveCount(0);
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toContainText('Welcome to Notesage');
  });

  test('re-opening the document that was already open behind the list leaves the view', async ({ page }) => {
    await openApp(page, { seeds: EVERY_STATUS });
    await openSampleFile(page);
    await openRecordings(page);
    // The same file again: no document changes, and the list must still go.
    await page.getByRole('treeitem', { name: 'Open file welcome.md' }).click();
    await expect(page.getByTestId('recordings-view')).toHaveCount(0);
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toContainText('Welcome to Notesage');
  });

  test('creating a note leaves the view', async ({ page }) => {
    await openApp(page, { seeds: EVERY_STATUS });
    // ⌘N creates beside the active document, so there has to be one.
    await openSampleFile(page);
    await openRecordings(page);

    await page.getByRole('treeitem', { name: /Open project notesage-e2e-project/i }).focus();
    await page.keyboard.press('Meta+n');
    const createInput = page.getByRole('textbox', { name: 'Create' });
    await expect(createInput).toBeVisible();
    // Naming the note is not leaving yet…
    await expect(page.getByTestId('recordings-view')).toBeVisible();
    await createInput.fill('notes-from-the-meeting');
    await createInput.press('Enter');
    // …the new note becoming the document is.
    await expect(page.getByTestId('recordings-view')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// U26 — the last row is reachable
// ---------------------------------------------------------------------------

test.describe('Recordings view — layout (U26)', () => {
  const MANY: BundleSeed[] = Array.from({ length: 14 }, (_, i) => ({
    name: `Recording 2026-10-${String(i + 1).padStart(2, '0')} 09-00-00`,
    title: `Meeting ${String(i + 1).padStart(2, '0')}`,
    startedAt: `2026-10-${String(i + 1).padStart(2, '0')}T09:00:00+02:00`,
    transcript: ['transcript.md', TRANSCRIPT(`Meeting ${i + 1}`)] as [string, string],
  }));

  for (const size of [
    { width: 820, height: 640 },
    { width: 1280, height: 800 },
  ]) {
    test(`the last row's buttons are not under the command bar or the orb at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await openApp(page, { seeds: MANY });
      await openRecordings(page);
      await expect(page.getByTestId('recording-row')).toHaveCount(14);

      // The floating chrome this is about is really there.
      await expect(page.locator('[data-cmd-bar]')).toBeVisible();
      await expect(page.getByTestId('agent-orb')).toBeVisible();

      // Scroll to the very end, as a person would to reach the oldest recording.
      await page.locator('[data-testid="recordings-view"] [data-doc-scroll]').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });

      const result = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="recording-row"]')];
        const last = rows[rows.length - 1];
        const buttons = [...last.querySelectorAll<HTMLElement>('button')];
        const rects = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].map((el) => el.getBoundingClientRect());
        const chrome = [...rects('[data-cmd-bar]'), ...rects('[data-testid="agent-orb"]')];
        const rowRect = last.getBoundingClientRect();
        return {
          title: last.querySelector('h3')?.textContent,
          buttons: buttons.map((button) => {
            const r = button.getBoundingClientRect();
            const points: Array<[number, number]> = [
              [r.left + 3, r.top + r.height / 2],
              [r.left + r.width / 2, r.top + r.height / 2],
              [r.right - 3, r.top + r.height / 2],
            ];
            return {
              name: button.getAttribute('aria-label') ?? button.textContent,
              onTop: points.every(([x, y]) => {
                const hit = document.elementFromPoint(x, y);
                return hit !== null && button.contains(hit);
              }),
              inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
            };
          }),
          overlapsChrome: chrome.some(
            (c) => c.width > 0 && c.left < rowRect.right && c.right > rowRect.left && c.top < rowRect.bottom && c.bottom > rowRect.top,
          ),
        };
      });

      expect(result.title).toBe('Meeting 01');
      expect(result.buttons.length).toBeGreaterThanOrEqual(3);
      for (const button of result.buttons) {
        expect(button, `${button.name} at ${size.width}px`).toMatchObject({ onTop: true, inViewport: true });
      }
      // Not merely "clickable through a gap": the whole row clears the floating chrome.
      expect(result.overlapsChrome).toBe(false);
      await shot(page, `last-row-${size.width}`);
    });
  }
});

// ---------------------------------------------------------------------------
// The list and its actions
// ---------------------------------------------------------------------------

test.describe('Recordings view — the list', () => {
  test('shows each recording with what it is and an honest status', async ({ page }) => {
    await openApp(page, { seeds: EVERY_STATUS });
    await openRecordings(page);
    await expect(page.getByTestId('recording-row')).toHaveCount(6);

    await expect(row(page, 'Weekly sync')).toContainText('1:15:03');
    await expect(row(page, 'Weekly sync')).toContainText('Microphone and system audio');
    await expect(row(page, 'Weekly sync')).toContainText('Swedish');
    await expect(row(page, 'Weekly sync').getByTestId('recording-status')).toHaveText('Transcribed');
    await expect(row(page, 'Design review').getByTestId('recording-status')).toHaveText('Not transcribed');
    await expect(row(page, 'Customer call').getByTestId('recording-status')).toHaveText(
      'Transcription failed: The model “large-v3-turbo-q5_0” is not downloaded.',
    );
    await expect(row(page, 'Customer call')).toContainText("from Peter's iPhone");
    await expect(row(page, 'Planning').getByTestId('recording-status')).toHaveText('Downloading from iCloud…');
    await expect(row(page, 'Planning').getByRole('button', { name: /^Transcribe/ })).toHaveCount(0);
    await expect(row(page, 'Kickoff').getByTestId('recording-status')).toHaveText("Transcribing on Peter's iMac…");
    await expect(row(page, 'Kickoff')).toContainText('Imported from Kickoff.mp4');
    // The bundle with no manifest is listed and can be transcribed.
    await expect(row(page, 'Recording 2026-11-15 08-05-00').getByTestId('recording-status')).toHaveText('Not transcribed');
    await expect(row(page, 'Recording 2026-11-15 08-05-00').getByRole('button', { name: /^Transcribe:/ })).toBeVisible();
    await shot(page, 'list-light');
  });

  test('a recording that lands while the view is open appears by itself (U15)', async ({ page }) => {
    await openApp(page, { seeds: [WEEKLY] });
    await openRecordings(page);
    await expect(page.getByTestId('recording-row')).toHaveCount(1);

    const fresh: BundleSeed = { name: 'Recording 2026-11-25 08-00-00', title: 'Standup', startedAt: '2026-11-25T08:00:00+01:00' };
    await setFake(page, { addFiles: filesOf([fresh]).files });
    await emitTauriEvent(page, 'file-changed-batch', [
      { path: `${RECORDINGS}/${fresh.name}/recording.json`, kind: 'create' },
    ]);

    await expect(page.getByTestId('recording-row')).toHaveCount(2);
    // Newest first.
    await expect(page.getByTestId('recording-row').first().getByRole('heading')).toHaveText('Standup');
  });

  test('a running job shows its progress on the row, with Cancel', async ({ page }) => {
    await openApp(page, { seeds: [{ ...EVERY_STATUS[1] }], holdTranscription: true });
    await openRecordings(page);
    await row(page, 'Design review').getByRole('button', { name: 'Transcribe: Design review' }).click();
    await page.getByRole('menuitem', { name: /^Small/ }).click();

    await expect(row(page, 'Design review')).toHaveAttribute('data-status', 'running');
    const audio = `${RECORDINGS}/${EVERY_STATUS[1].name}/audio.m4a`;
    await emitTauriEvent(page, 'transcription-progress', { job_id: null, audio_path: audio, stage: 'transcribing', percent: 42 });
    await expect(row(page, 'Design review').getByTestId('recording-status')).toContainText('Transcribing 42%');
    await expect(row(page, 'Design review').getByRole('button', { name: 'Cancel transcription: Design review' })).toBeVisible();
    await shot(page, 'row-running');
  });

  test('rename gives the recording a name that survives a reload of the list', async ({ page }) => {
    await openApp(page, { seeds: [EVERY_STATUS[1]] });
    await openRecordings(page);

    await page.getByRole('button', { name: 'More actions: Design review' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const dialog = page.getByTestId('rename-recording-dialog');
    await expect(dialog).toBeVisible();
    await shot(page, 'dialog-rename');
    await dialog.getByRole('textbox').fill('Design review, round two');
    await dialog.getByRole('button', { name: 'Rename' }).click();

    await expect(row(page, 'Design review, round two')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    const manifest = JSON.parse((await fakeFiles(page))[`${RECORDINGS}/${EVERY_STATUS[1].name}/recording.json`]) as { title: string };
    expect(manifest.title).toBe('Design review, round two');
  });

  test('delete asks first, names the recording, and moves it to the Trash', async ({ page }) => {
    await openApp(page, { seeds: [WEEKLY, EVERY_STATUS[1]] });
    await openRecordings(page);

    await page.getByRole('button', { name: 'More actions: Weekly sync' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    const dialog = page.getByTestId('delete-recording-dialog');
    await expect(dialog).toContainText('Move “Weekly sync” to the Trash?');
    await shot(page, 'dialog-delete');
    // Nothing has happened yet.
    expect(await fakeCalls(page, 'trash_path')).toEqual([]);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('recording-row')).toHaveCount(2);

    await page.getByRole('button', { name: 'More actions: Weekly sync' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByTestId('delete-recording-dialog').getByRole('button', { name: 'Move to Trash' }).click();

    await expect(page.getByTestId('recording-row')).toHaveCount(1);
    expect(await fakeCalls(page, 'trash_path')).toEqual([{ path: `${RECORDINGS}/${WEEKLY.name}` }]);
  });

  test('Transcribe again asks before replacing a transcript (U23)', async ({ page }) => {
    await openApp(page, { seeds: [WEEKLY], holdTranscription: true });
    await openRecordings(page);
    await page.getByRole('button', { name: 'Transcribe again: Weekly sync' }).click();
    await page.getByRole('menuitem', { name: /^Small/ }).click();
    const dialog = page.getByTestId('replace-transcript-dialog');
    await expect(dialog).toContainText('already has a transcript');
    await expect(dialog.getByRole('button', { name: 'Keep both' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Replace' })).toBeVisible();
    await shot(page, 'dialog-replace');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await fakeCalls(page, 'transcribe_file')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// N2 — import
// ---------------------------------------------------------------------------

test.describe('Recordings view — import (N2)', () => {
  test('importing a file adds a recording and transcribes it', async ({ page }) => {
    await openApp(page, { seeds: [] });
    await openRecordings(page);
    // The empty state offers both ways in.
    const empty = page.getByTestId('recordings-empty');
    await expect(empty.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
    await shot(page, 'empty');

    await setFake(page, { pick: '/Users/peter/Downloads/Quarterly review.mp4' });
    await empty.getByRole('button', { name: 'Import recording…' }).click();

    await expect(row(page, 'Quarterly review')).toBeVisible();
    await expect(row(page, 'Quarterly review')).toContainText('Imported from Quarterly review.mp4');
    expect(await fakeCalls(page, 'import_media')).toEqual([
      { sourcePath: '/Users/peter/Downloads/Quarterly review.mp4', destRecordingsDir: RECORDINGS },
    ]);
    // Transcribed like any other recording, into a note named after it.
    await expect(row(page, 'Quarterly review').getByTestId('recording-status')).toHaveText('Transcribed');
    const files = await fakeFiles(page);
    const dir = `${RECORDINGS}/Import Quarterly review 2026-11-25 101500`;
    expect(files[`${dir}/Quarterly review.md`]).toContain('This is what was said in the imported file.');
    expect(JSON.parse(files[`${dir}/recording.json`])).toMatchObject({
      source: 'import',
      originalFile: { name: 'Quarterly review.mp4', path: '/Users/peter/Downloads/Quarterly review.mp4' },
    });
    // The video itself is not in the library.
    expect(Object.keys(files).some((f) => f.endsWith('.mp4'))).toBe(false);

    await row(page, 'Quarterly review').getByRole('button', { name: 'Open transcript: Quarterly review' }).click();
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toContainText('This is what was said in the imported file.');
  });
});

// ---------------------------------------------------------------------------
// N3 — Teams transcript
// ---------------------------------------------------------------------------

test.describe('Recordings view — Teams transcript (N3)', () => {
  const MEETING: BundleSeed = {
    name: 'Recording 2026-11-21 13-00-00',
    title: 'Leveransplan',
    startedAt: '2026-11-21T13:00:00+01:00',
    durationSecs: 176,
    language: 'sv',
    transcript: ['Leveransplan.md', '---\ntype: meeting-transcript\ntitle: Leveransplan\nlanguage: sv\nmodel: large-v3-turbo-q5_0\n---\n\n# Leveransplan\n\n[00:00:02] Hör ni mig?\n'],
    files: { 'segments.json': TEAMS_SEGMENTS },
  };
  const VTT_PATH = '/Users/peter/Downloads/Leveransplan.vtt';

  test('the dialog shows the speakers and the 37-second offset, and adds the names', async ({ page }) => {
    await openApp(page, { seeds: [MEETING], extraFiles: { [VTT_PATH]: TEAMS_VTT } });
    // `read_file` for a path outside Recordings goes to the shared mock, which
    // knows nothing of it: serve the picked file from the fake as well.
    await page.evaluate(
      ({ p, text }) => {
        const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> } })
          .__TAURI_INTERNALS__;
        const next = internals.invoke;
        internals.invoke = async (cmd, args) => (cmd === 'read_file' && args?.path === p ? text : next(cmd, args));
      },
      { p: VTT_PATH, text: TEAMS_VTT },
    );
    await openRecordings(page);
    await setFake(page, { pick: VTT_PATH });

    await page.getByRole('button', { name: 'More actions: Leveransplan' }).click();
    await page.getByRole('menuitem', { name: 'Add Teams transcript…' }).click();

    const dialog = page.getByTestId('teams-dialog');
    await expect(dialog.getByTestId('teams-speakers')).toHaveText('Anna Svensson, Peter Lindberg, James Carter');
    await expect(dialog.getByTestId('teams-offset')).toContainText('Starts 0:37 into the recording');
    await expect(dialog.getByTestId('teams-confidence')).toHaveText(/^\d+% sure$/);
    await expect(dialog.getByRole('radio', { name: /recommended/ })).toBeChecked();
    await shot(page, 'dialog-teams');

    // The offset can be inspected and nudged; the preview follows.
    await dialog.getByRole('button', { name: 'Adjust timing…' }).click();
    await expect(dialog.getByTestId('teams-preview')).toBeVisible();
    await shot(page, 'dialog-teams-adjust');

    await dialog.getByRole('button', { name: 'Add to recording' }).click();
    await page.getByTestId('replace-transcript-dialog').getByRole('button', { name: 'Replace' }).click();

    await expect(row(page, 'Leveransplan').getByTestId('recording-speakers')).toHaveText(
      'Speakers: Anna Svensson, Peter Lindberg, James Carter',
    );
    const files = await fakeFiles(page);
    const dir = `${RECORDINGS}/${MEETING.name}`;
    expect(files[`${dir}/teams-transcript.vtt`]).toBe(TEAMS_VTT);
    expect(files[`${dir}/Leveransplan.md`]).toContain('**Anna Svensson** [00:01:00] Okej då har jag startat transkriberingen också');
    expect(files[`${dir}/Leveransplan.md`]).toContain('**James Carter** [00:01:36] Great, and the remaining 20 percent');
    expect(JSON.parse(files[`${dir}/speakers.json`]).names).toHaveProperty('Peter Lindberg');
  });
});

// ---------------------------------------------------------------------------
// Dark, and Swedish
// ---------------------------------------------------------------------------

test.describe('Recordings view — dark theme and Swedish', () => {
  test('the list in the dark theme', async ({ page }) => {
    await openApp(page, { seeds: EVERY_STATUS, settings: { theme: 'dark' } });
    await openRecordings(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByTestId('recording-row')).toHaveCount(6);
    await shot(page, 'list-dark');
    await page.getByRole('button', { name: 'More actions: Weekly sync' }).click();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await shot(page, 'menu-dark');
  });

  test('the view in Swedish has no English left in it (U33)', async ({ page }) => {
    await openApp(page, { seeds: EVERY_STATUS, settings: { locale: 'sv' } });
    await page.getByTestId('recordings-row').click();
    const view = page.getByTestId('recordings-view');
    await expect(view).toBeVisible();

    await expect(view.getByTestId('recordings-record')).toHaveText('Spela in');
    await expect(view.getByTestId('recordings-import')).toHaveText('Importera inspelning…');
    await expect(row(page, 'Weekly sync').getByTestId('recording-status')).toHaveText('Transkriberad');
    await expect(row(page, 'Weekly sync')).toContainText('Mikrofon och systemljud');
    await expect(row(page, 'Weekly sync')).toContainText('Svenska');
    await expect(row(page, 'Design review').getByTestId('recording-status')).toHaveText('Inte transkriberad');
    await expect(row(page, 'Planning').getByTestId('recording-status')).toHaveText('Hämtas från iCloud…');
    await expect(row(page, 'Customer call').getByTestId('recording-status')).toHaveText(
      'Transkriberingen misslyckades: Modellen ”large-v3-turbo-q5_0” är inte nedladdad.',
    );
    await shot(page, 'list-sv');

    // None of the English this view used to hard-code. (The place is called
    // "Recordings" in every language, like the Inbox: it is the folder's name.)
    const text = await view.innerText();
    for (const english of [
      'Transcrib',
      'Open transcript',
      'Try again',
      'Move to project',
      'Reveal',
      'Waiting',
      'Not transcribed',
      'Downloading',
      'Microphone',
      'Swedish',
      'failed',
      'Meetings recorded',
    ]) {
      expect(text, `"${english}" in the Swedish view`).not.toContain(english);
    }

    await page.getByRole('button', { name: 'Fler åtgärder: Weekly sync' }).click();
    await expect(page.getByRole('menuitem', { name: 'Byt namn' })).toBeVisible();
    await shot(page, 'menu-sv');
    await page.getByRole('menuitem', { name: 'Radera…' }).click();
    await expect(page.getByTestId('delete-recording-dialog')).toContainText('Flytta ”Weekly sync” till papperskorgen?');
    await shot(page, 'dialog-delete-sv');
  });
});
