/**
 * Speaker identification in a real browser: the opt-in in Settings →
 * Transcription → Speakers, and "Identify speakers…" on a recording.
 *
 * jsdom has already pinned the logic (what is sent, what is written, that a
 * suggestion is never applied without a click). What only a browser can say
 * is whether the dialog and the settings section LAY OUT: nothing pushed
 * outside its box, every control inside the dialog, at the narrowest window
 * the app supports, in both themes and in Swedish.
 *
 * The backend is the shared Tauri mock's in-page voice backend
 * (`window.__SPEAKER_MOCK__`: it refuses consent-gated commands without
 * consent, like the real one) plus a small Recordings folder installed here.
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import { setupTauriMock, emitTauriEvent } from '../../fixtures/tauri-mock';
import { SAMPLE_FILE_TREE, SAMPLE_PROJECT_PATH } from '../../fixtures/sample-data';

const HOME = '/tmp/notesage-e2e-home';
const RECORDINGS = `${HOME}/Notesage/Recordings`;
const NAME = 'Recording 2026-11-20 09-00-00';
const DIR = `${RECORDINGS}/${NAME}`;
const TITLE = 'Weekly sync';
const SHOTS = process.env.SPEAKERS_SHOTS_DIR;

const SEGMENTS = [
  { start: 0, end: 5, text: 'Okay, shall we start? This is Anna from marketing.' },
  { start: 6, end: 11, text: 'Hej, jag heter Erik Lund.' },
  { start: 12, end: 18, text: 'Great. First point is the budget.' },
  { start: 19, end: 24, text: 'I think we should wait for the numbers.' },
];
const TRANSCRIPT = `---\ntype: meeting-transcript\ntitle: ${TITLE}\nlanguage: en\n---\n\n# ${TITLE}\n\n[00:00:00] ${SEGMENTS.map((s) => s.text).join(' ')}\n`;
const MANIFEST = {
  version: 1,
  createdBy: { device: 'E2E Mac', app: 'notesage-macos', appVersion: '0.65.0' },
  startedAt: '2026-11-20T09:00:00+01:00',
  durationSecs: 1834,
  source: 'microphone',
  language: 'en',
  audio: { file: 'audio.m4a', bytes: 14_703_112, codec: 'aac', sampleRate: 48000, channels: 1 },
  transcription: { status: 'done', device: 'E2E Mac', updatedAt: '2026-11-20T10:20:00+01:00', model: 'large-v3-turbo-q5_0', language: 'en' },
  title: TITLE,
  transcript: { file: 'Weekly sync.md' },
};

interface Options {
  settings?: Record<string, unknown>;
  /** The persisted speaker settings (`notesage-speakers`). Absent = a fresh install. */
  speakers?: { rememberVoices?: boolean; learnFromTeams?: boolean; autoIdentify?: boolean };
  /** Stored voices the mock backend starts with. */
  profiles?: Array<{ id: string; name: string; kind?: string; isMe?: boolean; samples?: number }>;
  /** `voice_profiles_match` candidates by label. */
  candidates?: Record<string, unknown[]>;
  holdAnalysis?: boolean;
}

async function openApp(page: Page, options: Options = {}): Promise<void> {
  await setupTauriMock(page);
  await page.addInitScript(
    ({ projectPath, fileTree, settings, speakers }) => {
      localStorage.setItem(
        'notesage-workspace',
        JSON.stringify({
          state: { explorerFolders: [], projects: [{ path: projectPath, fileTree }], recentProjects: [], notesTree: [], pinnedFiles: [], expandedFolders: [projectPath] },
          version: 0,
        }),
      );
      localStorage.setItem(
        'notesage-settings',
        JSON.stringify({ state: { notesRootPath: '/tmp/notesage-e2e-home/Notesage', ...(settings ?? {}) }, version: 29 }),
      );
      if (speakers) localStorage.setItem('notesage-speakers', JSON.stringify({ state: speakers, version: 1 }));
    },
    { projectPath: SAMPLE_PROJECT_PATH, fileTree: SAMPLE_FILE_TREE, settings: options.settings ?? null, speakers: options.speakers ?? null },
  );
  await page.addInitScript(
    ({ files, RECORDINGS, profiles, candidates, holdAnalysis }) => {
      type Args = Record<string, unknown> | undefined;
      const state = { files: { ...files } as Record<string, string> };
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
        list_whisper_models: () => [{ name: 'large-v3-turbo-q5_0', size_bytes: 574_000_000, downloaded: true }],
      };
      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Args) => Promise<unknown> } })
        .__TAURI_INTERNALS__;
      const original = internals.invoke;
      internals.invoke = async (cmd: string, args?: Args) => {
        const handler = handlers[cmd];
        if (handler) {
          const result = handler(args);
          if (result !== undefined) return result;
        }
        return original(cmd, args);
      };

      // The voice backend the shared mock installed: seed it.
      const mock = (window as unknown as { __SPEAKER_MOCK__: Record<string, unknown> }).__SPEAKER_MOCK__;
      mock.holdAnalysis = holdAnalysis;
      mock.candidates = candidates;
      mock.profiles = profiles.map((p) => ({
        id: p.id,
        name: p.name,
        is_me: p.isMe === true,
        created_at: '2026-11-18T09:00:00Z',
        updated_at: '2026-11-19T09:00:00Z',
        sources: [{ kind: p.kind ?? 'manual', recording: null, at: '2026-11-18T09:00:00Z' }],
        model: 'wespeaker-voxceleb-resnet34-lm',
        exemplar_count: p.samples ?? 1,
        usable: true,
      }));
      // No real audio behind the asset URL here: playing is a no-op that succeeds.
      HTMLMediaElement.prototype.play = async () => undefined;
    },
    {
      files: {
        [`${DIR}/audio.m4a`]: '<audio>',
        [`${DIR}/recording.json`]: `${JSON.stringify(MANIFEST, null, 2)}\n`,
        [`${DIR}/Weekly sync.md`]: TRANSCRIPT,
        [`${DIR}/segments.json`]: `${JSON.stringify({ version: 1, segments: SEGMENTS }, null, 2)}\n`,
      },
      RECORDINGS,
      profiles: options.profiles ?? [],
      candidates: options.candidates ?? {},
      holdAnalysis: options.holdAnalysis ?? false,
    },
  );
  await page.goto('/');
  await expect(page.getByTestId('recordings-row')).toBeVisible({ timeout: 20_000 });
}

async function speakerCalls(page: Page, cmd: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (c) =>
      (window as unknown as { __SPEAKER_MOCK__: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__SPEAKER_MOCK__.calls
        .filter((call) => call.cmd === c)
        .map((call) => call.args ?? {}),
    cmd,
  );
}
async function fakeFiles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => (window as unknown as { __REC__: { files: Record<string, string> } }).__REC__.files);
}
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function openSpeakerSettings(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('notesage:open-settings', { detail: { tab: 'voice' } })));
  const section = page.getByTestId('speakers-settings');
  await expect(section).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  return section;
}

async function openIdentify(page: Page, menuName: string, itemName: string) {
  await page.getByTestId('recordings-row').click();
  await expect(page.getByTestId('recordings-view')).toBeVisible();
  await page.getByRole('button', { name: menuName }).click();
  await page.getByRole('menuitem', { name: itemName }).click();
  const dialog = page.getByTestId('identify-speakers-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-view', 'loading');
  return dialog;
}

/**
 * Nothing sticks out: every element with text or a control inside `root` lies
 * within `root`'s box, and no two sibling controls in a row overlap.
 */
async function expectNoOverflow(page: Page, testId: string): Promise<void> {
  const problems = await page.getByTestId(testId).evaluate((root) => {
    const box = root.getBoundingClientRect();
    const out: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    for (const el of root.querySelectorAll('button, input, textarea, label, p, h2, h3, h4, [role="switch"], [role="checkbox"]')) {
      if (!visible(el) || el.closest('.sr-only')) continue;
      const r = el.getBoundingClientRect();
      if (r.left < box.left - 1 || r.right > box.right + 1) {
        out.push(`outside horizontally: <${el.tagName.toLowerCase()}> "${(el.textContent ?? '').slice(0, 40)}"`);
      }
    }
    // Controls that share a line must not sit on top of each other.
    const controls = [...root.querySelectorAll('button, input, textarea, [role="switch"], [role="checkbox"]')].filter(
      (el) => visible(el) && !el.closest('.sr-only'),
    );
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
        const a = controls[i].getBoundingClientRect();
        const b = controls[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 2 && h > 2) {
          out.push(`overlap: "${(controls[i].getAttribute('aria-label') ?? controls[i].textContent ?? '').slice(0, 30)}" / "${(controls[j].getAttribute('aria-label') ?? controls[j].textContent ?? '').slice(0, 30)}"`);
        }
      }
    }
    if (root.scrollWidth > root.clientWidth + 1) out.push(`scrolls sideways: ${root.scrollWidth} > ${root.clientWidth}`);
    return out;
  });
  expect(problems).toEqual([]);
}

const KNOWN = [
  { id: 'vp-anna', name: 'Anna Berg', samples: 3 },
  { id: 'vp-erik', name: 'Erik Lund', kind: 'teams', samples: 1 },
  { id: 'vp-me', name: 'Peter', isMe: true, kind: 'enrolment', samples: 2 },
];
const CANDIDATES = {
  'speaker-1': [
    { profile_id: 'vp-anna', name: 'Anna Berg', is_me: false, score: 0.71, confidence: 'likely', participant: true },
    { profile_id: 'vp-sara', name: 'Sara Ek', is_me: false, score: 0.45, confidence: 'possible', participant: false },
  ],
};

// ---------------------------------------------------------------------------
// Settings → Transcription → Speakers
// ---------------------------------------------------------------------------

test.describe('Speakers settings — the opt-in', () => {
  test('remembering voices is off until the user turns it on, having read what it means', async ({ page }) => {
    await openApp(page);
    const section = await openSpeakerSettings(page);

    const remember = section.getByRole('switch', { name: 'Remember voices on this Mac' });
    await expect(remember).toHaveAttribute('aria-checked', 'false');
    await expect(section.getByRole('switch', { name: 'Learn voices from Teams transcripts' })).toHaveCount(0);
    await expect(section.getByRole('switch', { name: 'Identify speakers automatically after transcription' })).toHaveAttribute('aria-checked', 'false');
    // Enrolling is not possible while it is off, and the page says why.
    await expect(section.getByRole('button', { name: 'Record my voice' })).toBeDisabled();
    await expect(section.getByTestId('my-voice-blocked')).toHaveText('Turn on “Remember voices on this Mac” first.');
    // The model's licence line, as the backend gives it.
    await expect(section.getByTestId('voice-model-licence')).toContainText('CC-BY-4.0 (WeSpeaker, trained on VoxCeleb)');

    await remember.click();
    const explanation = page.getByTestId('remember-voices-explanation');
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText('biometric data');
    await expect(explanation).toContainText('only on this Mac');
    await expect(explanation).toContainText('consent of the people you record');
    // Asking is not deciding.
    expect(await page.evaluate(() => localStorage.getItem('notesage-speakers'))).not.toContain('"rememberVoices":true');

    await explanation.getByRole('button', { name: 'Cancel' }).click();
    await expect(remember).toHaveAttribute('aria-checked', 'false');

    await remember.click();
    await page.getByTestId('remember-voices-explanation').getByRole('button', { name: 'Remember voices' }).click();
    await expect(remember).toHaveAttribute('aria-checked', 'true');
    await expect(section.getByRole('switch', { name: 'Learn voices from Teams transcripts' })).toHaveAttribute('aria-checked', 'false');
    await expect(section.getByRole('button', { name: 'Record my voice' })).toBeEnabled();

    // Saved: three booleans, nothing else.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('notesage-speakers') ?? '{}'));
    expect(saved.state).toEqual({ rememberVoices: true, learnFromTeams: false, autoIdentify: false });
    // Nothing was sent with consent by merely turning the setting on.
    const calls = await page.evaluate(() =>
      (window as unknown as { __SPEAKER_MOCK__: { calls: Array<{ cmd: string; args?: { consent?: unknown } }> } }).__SPEAKER_MOCK__.calls
        .filter((c) => c.args?.consent === true)
        .map((c) => c.cmd),
    );
    expect(calls).toEqual([]);
  });

  test('turning it off with voices stored offers to delete them, and “delete all” empties the list', async ({ page }) => {
    await openApp(page, { speakers: { rememberVoices: true, learnFromTeams: true }, profiles: KNOWN });
    const section = await openSpeakerSettings(page);
    await expect(section.getByTestId('known-voice')).toHaveCount(2);
    await expect(section.getByTestId('my-voice-status')).toContainText('Set up from 2 samples');

    await section.getByRole('switch', { name: 'Remember voices on this Mac' }).click();
    const off = page.getByTestId('remember-voices-off');
    await expect(off).toContainText('3 voices are stored on this Mac');
    await off.getByRole('button', { name: 'Turn off, keep voices' }).click();
    await expect(section.getByRole('switch', { name: 'Remember voices on this Mac' })).toHaveAttribute('aria-checked', 'false');
    // Still listed, still deletable, after opting out.
    await expect(section.getByTestId('known-voice')).toHaveCount(2);

    await section.getByRole('button', { name: 'Delete all voices…' }).click();
    await page.getByTestId('delete-all-voices-dialog').getByRole('button', { name: 'Delete all voices…' }).click();
    await expect(section.getByTestId('known-voice')).toHaveCount(0);
    await expect(section.getByTestId('my-voice-status')).toHaveText('Not set up.');
    expect(await speakerCalls(page, 'voice_profiles_delete_all')).toHaveLength(1);
  });

  for (const variant of [
    { name: 'light', settings: {}, remember: 'Remember voices on this Mac' },
    { name: 'dark', settings: { theme: 'dark' }, remember: 'Remember voices on this Mac' },
    { name: 'sv', settings: { locale: 'sv' }, remember: 'Kom ihåg röster på den här datorn' },
  ]) {
    test(`lays out without overlap at 820px (${variant.name})`, async ({ page }) => {
      await page.setViewportSize({ width: 820, height: 900 });
      await openApp(page, { settings: variant.settings, speakers: { rememberVoices: true, learnFromTeams: true }, profiles: KNOWN });
      const section = await openSpeakerSettings(page);
      await expect(section.getByRole('switch', { name: variant.remember })).toHaveAttribute('aria-checked', 'true');
      await expect(section.getByTestId('known-voice')).toHaveCount(2);
      await expectNoOverflow(page, 'speakers-settings');
      await shot(page, `settings-${variant.name}-top`);
      await section.getByTestId('known-voices').scrollIntoViewIfNeeded();
      await shot(page, `settings-${variant.name}-voices`);
    });
  }
});

// ---------------------------------------------------------------------------
// Identify speakers
// ---------------------------------------------------------------------------

test.describe('Identify speakers — on a recording', () => {
  test('find the voices, hear one, name them from suggestions, and save', async ({ page }) => {
    // The clip's asset URL does not exist in a browser. WebKit fails the
    // load at once (and the dialog rightly leaves the "playing" state);
    // Chromium leaves play() pending. Make playback itself succeed, so the
    // test is about the button and the command it sends in every engine.
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function play() {
        return Promise.resolve();
      };
    });
    await openApp(page, { speakers: { rememberVoices: true }, profiles: KNOWN, candidates: CANDIDATES, holdAnalysis: true });
    const dialog = await openIdentify(page, `More actions: ${TITLE}`, 'Identify speakers…');
    await expect(dialog).toHaveAttribute('data-view', 'setup');

    await dialog.getByLabel('Who was in the meeting? (optional)').fill('Anna Berg, Erik Lund');
    await dialog.getByRole('button', { name: 'Find voices' }).click();
    const progress = dialog.getByTestId('identify-progress');
    await expect(progress).toBeVisible();

    const sent = (await speakerCalls(page, 'analyze_speakers'))[0];
    expect(typeof sent.jobId).toBe('string');
    expect(sent.audioPath).toBe(`${DIR}/audio.m4a`);
    expect((sent.segments as unknown[]).length).toBe(SEGMENTS.length);

    await emitTauriEvent(page, 'speaker-analysis-progress', { job_id: sent.jobId, audio_path: sent.audioPath, stage: 'analyzing', percent: 42 });
    await expect(progress).toContainText('Listening for voices 42%');
    // The row behind the dialog says the same.
    await expect(page.getByTestId('recording-speaker-job')).toHaveText('Identifying speakers 42%');

    await page.evaluate(() => (window as unknown as { __SPEAKER_MOCK__: { releaseAnalysis: () => void } }).__SPEAKER_MOCK__.releaseAnalysis());
    await expect(dialog).toHaveAttribute('data-view', 'results');

    const rows = dialog.getByTestId('speaker-row');
    await expect(rows).toHaveCount(2);
    const name1 = dialog.getByLabel('Name for Speaker 1');
    const name2 = dialog.getByLabel('Name for Speaker 2');
    // Suggested, not applied.
    await expect(name1).toHaveValue('');
    await expect(name2).toHaveValue('');
    await expect(rows.nth(0).getByTestId('speaker-suggestion')).toHaveText(['Likely Anna Berg', 'Possibly Sara Ek', 'Erik Lund']);
    await expect(rows.nth(1).getByTestId('speaker-suggestion').first()).toContainText('Erik Lund');
    await expect(rows.nth(1).getByTestId('speaker-suggestion').first()).toContainText('from the transcript');

    // Hear a voice: a real button with a pressed state.
    const play = dialog.getByRole('button', { name: 'Play sample of Speaker 2' });
    await play.click();
    await expect(dialog.getByRole('button', { name: 'Stop sample of Speaker 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(await speakerCalls(page, 'extract_audio_clip')).toEqual([{ audioPath: `${DIR}/audio.m4a`, start: 11, end: 17 }]);
    await dialog.getByRole('button', { name: 'Stop sample of Speaker 2' }).click();

    // Keyboard: the chip is a button reachable with Tab and pressed with Enter.
    await name1.focus();
    await page.keyboard.press('Tab');
    await expect(rows.nth(0).getByTestId('speaker-suggestion').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(name1).toHaveValue('Anna Berg');
    await rows.nth(1).getByTestId('speaker-suggestion').first().click();
    await expect(name2).toHaveValue('Erik Lund');
    // Named voices are ticked to be remembered; untick Erik.
    const boxes = dialog.getByRole('checkbox', { name: 'Remember this voice' });
    await expect(boxes.nth(0)).toHaveAttribute('aria-checked', 'true');
    await boxes.nth(1).click();

    await dialog.getByRole('button', { name: 'Save names' }).click();
    // The transcript in this fixture has no recorded hash, so it may have been edited: the app asks.
    await page.getByTestId('replace-transcript-dialog').getByRole('button', { name: 'Replace' }).click();
    await expect(dialog).toHaveCount(0);

    const files = await fakeFiles(page);
    const segments = JSON.parse(files[`${DIR}/segments.json`]).segments as Array<{ speaker: string }>;
    expect(segments.map((s) => s.speaker)).toEqual(['speaker-1', 'speaker-2', 'speaker-1', 'speaker-2']);
    expect(JSON.parse(files[`${DIR}/speakers.json`])).toEqual({
      version: 1,
      names: { 'speaker-1': 'Anna Berg', 'speaker-2': 'Erik Lund' },
      labels: ['speaker-1', 'speaker-2'],
      participants: ['Anna Berg', 'Erik Lund'],
    });
    expect(files[`${DIR}/Weekly sync.md`]).toContain('**Anna Berg** [00:00:00]');
    expect(files[`${DIR}/Weekly sync.md`]).toContain('**Erik Lund** [00:00:06]');
    // No voiceprint in anything written, or in what the browser keeps.
    for (const [file, content] of Object.entries(files)) expect(content, file).not.toContain('embedding');
    const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '').join('\n'));
    expect(stored).not.toContain('embedding');

    // One voice remembered: the ticked one, to the stored voice that was confirmed, with consent.
    const saved = await speakerCalls(page, 'voice_profile_save');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ consent: true, name: 'Anna Berg', profileId: 'vp-anna', source: { kind: 'manual', recording: DIR } });
    expect((saved[0].embedding as number[]).length).toBe(256);
    await expect(page.getByTestId('recording-speakers')).toHaveText('Speakers: Anna Berg, Erik Lund');
  });

  test('with voices not remembered there is no checkbox, no comparison, and nothing sent with consent', async ({ page }) => {
    await openApp(page, { profiles: KNOWN, candidates: CANDIDATES });
    const dialog = await openIdentify(page, `More actions: ${TITLE}`, 'Identify speakers…');
    await dialog.getByRole('button', { name: 'Find voices' }).click();
    await expect(dialog).toHaveAttribute('data-view', 'results');
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expect(dialog.getByTestId('speaker-suggestion').filter({ hasText: 'Likely' })).toHaveCount(0);
    await expect(dialog.getByTestId('identify-privacy')).toHaveText('Voices are not remembered: these names apply to this recording only.');
    expect(await speakerCalls(page, 'voice_profiles_match')).toHaveLength(0);
  });

  test('offers to download the voice model when it is missing, and opens the Speakers settings', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      (window as unknown as { __SPEAKER_MOCK__: { modelInstalled: boolean } }).__SPEAKER_MOCK__.modelInstalled = false;
    });
    const dialog = await openIdentify(page, `More actions: ${TITLE}`, 'Identify speakers…');
    await expect(dialog).toHaveAttribute('data-view', 'model');
    await dialog.getByRole('button', { name: 'Download in Settings…' }).click();
    const section = page.getByTestId('speakers-settings');
    await expect(section).toBeVisible();
    await expect(section).toBeInViewport();
    await section.getByRole('button', { name: 'Download the voice model' }).click();
    await expect(section.getByTestId('voice-model')).toContainText('Downloaded');
  });

  for (const variant of [
    { name: 'light', settings: {}, menu: `More actions: ${TITLE}`, item: 'Identify speakers…', find: 'Find voices', chip: 'Likely Anna Berg' },
    { name: 'dark', settings: { theme: 'dark' }, menu: `More actions: ${TITLE}`, item: 'Identify speakers…', find: 'Find voices', chip: 'Likely Anna Berg' },
    { name: 'sv', settings: { locale: 'sv' }, menu: `Fler åtgärder: ${TITLE}`, item: 'Identifiera talare…', find: 'Hitta röster', chip: 'Troligen Anna Berg' },
  ]) {
    test(`the dialog lays out without overlap at 820px (${variant.name})`, async ({ page }) => {
      await page.setViewportSize({ width: 820, height: 900 });
      await openApp(page, { settings: variant.settings, speakers: { rememberVoices: true }, profiles: KNOWN, candidates: CANDIDATES });
      const dialog = await openIdentify(page, variant.menu, variant.item);
      await dialog.locator('textarea').fill('Anna Berg, Erik Lund, Sara Ek, Johan Persson');
      await expectNoOverflow(page, 'identify-speakers-dialog');
      await shot(page, `identify-setup-${variant.name}`);

      await dialog.getByRole('button', { name: variant.find }).click();
      await expect(dialog).toHaveAttribute('data-view', 'results');
      await expect(dialog.getByTestId('speaker-suggestion').first()).toHaveText(variant.chip);
      await dialog.getByTestId('speaker-suggestion').first().click();
      await expectNoOverflow(page, 'identify-speakers-dialog');
      // Every voice row is inside the dialog, and each chip inside its row.
      const inside = await dialog.evaluate((root) => {
        const outer = root.getBoundingClientRect();
        return [...root.querySelectorAll('[data-testid="speaker-row"]')].every((row) => {
          const r = row.getBoundingClientRect();
          const chipsInside = [...row.querySelectorAll('[data-testid="speaker-suggestion"]')].every((chip) => {
            const c = chip.getBoundingClientRect();
            return c.left >= r.left - 1 && c.right <= r.right + 1 && c.top >= r.top - 1 && c.bottom <= r.bottom + 1;
          });
          return chipsInside && r.left >= outer.left && r.right <= outer.right;
        });
      });
      expect(inside).toBe(true);
      await shot(page, `identify-voices-${variant.name}`);
    });
  }
});
