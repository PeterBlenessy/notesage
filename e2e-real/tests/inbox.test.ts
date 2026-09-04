import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The desktop Inbox (docs/features/inbox.md), end to end against the real
 * app: the sidebar row and its badge, the view's rows with the capture
 * header, filing with `e`, opening with the reader controls, and trashing.
 *
 * Runs on a throw-away library under the OS temp dir — never the user's
 * own — seeded with one capture (the masthead the crate writes, plus an
 * inlined lead image) and one PDF, and one project to file into.
 */

const ONE_PIXEL_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

function capture(title: string, standfirst: string, minutes: number, site: string, url: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body><header><h1>${title}</h1><p class="standfirst">${standfirst}</p>
<p class="byline">By Someone · ${minutes} min read · ${site}</p></header>
<p><img src="${ONE_PIXEL_JPEG}" alt=""></p>
${Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i + 1} of the article body, long enough to scroll.</p>`).join('\n')}
<footer><p class="source">Clipped from <a href="${url}">${url}</a></p></footer></body></html>`;
}

const MINIMAL_PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF
`;

let root = '';
let inbox = '';
let project = '';

async function exec<T>(fn: (...args: never[]) => T, ...args: unknown[]): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return browser.execute(fn as any, ...args) as Promise<T>;
}

async function inboxState() {
  return exec(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__E2E_INBOX_STORE__.getState();
    return { open: s.open, items: s.items.map((i: { name: string }) => i.name), unread: s.unreadCount(), activeItem: s.activeItem, dir: s.dir };
  });
}

describe('Inbox (desktop)', () => {
  before(async function () {
    // A cold app on a loaded machine (or a CI runner) can take longer than
    // mocha's default 30 s to expose its stores.
    this.timeout(120_000);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'notesage-inbox-e2e-'));
    inbox = path.join(root, 'Inbox');
    project = path.join(root, 'Research');
    fs.mkdirSync(inbox);
    fs.mkdirSync(project);
    fs.writeFileSync(
      path.join(inbox, 'Fences, not Sandboxes.html'),
      capture('Fences, not Sandboxes', 'Why the walls we build for agents matter.', 7, 'steve-yegge.medium.com', 'https://steve-yegge.medium.com/x'),
    );
    fs.writeFileSync(path.join(inbox, 'Report.pdf'), MINIMAL_PDF);

    const rootEl = await browser.$('#root');
    await rootEl.waitForExist({ timeout: 10_000 });
    await browser.waitUntil(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => exec(() => Boolean((window as any).__E2E_INBOX_STORE__ && (window as any).__E2E_SETTINGS_STORE__)),
      { timeout: 90_000, timeoutMsg: 'the app never exposed its stores' },
    );
    // Point the app at the throw-away library and register the project.
    await exec(
      (r: string, p: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const settings = w.__E2E_SETTINGS_STORE__.getState();
        if (settings.setSidebarPinned) settings.setSidebarPinned(true);
        // The override beats the iCloud root startup resolves on its own
        // schedule — settings alone raced it and listed the real library.
        // `e` repeats the last File to…; the spec chooses it up front.
        w.__E2E_INBOX_STORE__.setState({ rootOverride: r, lastDestination: p });
        const ws = w.__E2E_WORKSPACE_STORE__.getState();
        if (!ws.projects.some((x: { path: string }) => x.path === p)) ws.addProject(p, []);
        w.__E2E_INBOX_STORE__.getState().closeInbox();
      },
      root,
      project,
    );
    await exec(() => (window as any).__E2E_INBOX_STORE__.getState().load()); // eslint-disable-line @typescript-eslint/no-explicit-any
    await browser.waitUntil(async () => (await inboxState()).dir === inbox, {
      timeout: 10_000,
      timeoutMsg: 'the Inbox did not resolve to the temp library — refusing to run against a real one',
    });
  });

  /** Every destructive step re-checks the root: this spec must never file or
   *  trash anything outside the throw-away library. */
  async function assertTempLibrary(): Promise<void> {
    const s = await inboxState();
    if (s.dir !== inbox) throw new Error(`Inbox resolved to ${s.dir}, not the temp library — aborting`);
  }

  let failed = false;
  afterEach(function () {
    if (this.currentTest?.state === 'failed') failed = true;
  });

  after(async () => {
    await exec(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.__E2E_INBOX_STORE__.getState().closeInbox();
      w.__E2E_INBOX_STORE__.setState({ rootOverride: null, lastDestination: null, items: [], dir: null, activeItem: null });
    });
    if (failed) console.log('KEEPING temp library for inspection:', root);
    else fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the library Inbox with an unread badge in the sidebar', async () => {
    const row = await browser.$('[data-testid="inbox-row"]');
    await row.waitForExist({ timeout: 10_000 });
    const badge = await browser.$('[data-testid="inbox-unread"]');
    await badge.waitForExist({ timeout: 5_000 });
    expect(await badge.getText()).toBe('2');
    const s = await inboxState();
    expect(s.dir).toBe(inbox);
    expect(s.items.sort()).toEqual(['Fences, not Sandboxes.html', 'Report.pdf']);
  });

  it('opens the view with date groups, the capture header and a PDF row', async () => {
    await (await browser.$('[data-testid="inbox-row"]')).click();
    const view = await browser.$('[data-inbox-view]');
    await view.waitForExist({ timeout: 5_000 });
    const rows = await browser.$$('[data-testid="inbox-row"]');
    // The sidebar row shares the test id; the view's rows are inside the view.
    const viewRows = await view.$$('[data-testid="inbox-row"]');
    expect(viewRows.length).toBe(2);
    expect(rows.length).toBe(3);
    await browser.waitUntil(async () => (await view.getText()).includes('steve-yegge.medium.com'), { timeout: 10_000 });
    const text = await view.getText();
    expect(text).toContain('Fences, not Sandboxes');
    expect(text).toContain('7 min');
    expect(text).toContain('PDF');
    expect(text).toContain('2 items · 2 unread');
    expect(text).toContain('Today');
  });

  it('opens an item on Enter, shows the reader controls, and returns with ⌘⇧I', async () => {
    await assertTempLibrary();
    const view = await browser.$('[data-inbox-view]');
    const article = await view.$('[data-path$=".html"]');
    await article.click();
    await browser.keys(['Enter']);
    await browser.waitUntil(async () => !(await inboxState()).open, { timeout: 10_000 });
    const controls = await browser.$('[data-inbox-reader-controls]');
    await controls.waitForExist({ timeout: 10_000 });
    expect(await controls.getText()).toContain('1 / 2');
    const s = await inboxState();
    expect(s.activeItem).toBe(path.join(inbox, 'Fences, not Sandboxes.html'));
    expect(s.unread).toBe(1); // opened → no longer unread
    await browser.keys(['Meta', 'Shift', 'i', 'Shift', 'Meta']);
    await browser.waitUntil(async () => (await inboxState()).open, { timeout: 5_000 });
  });

  it('files the cursor row into the project with `e`, carrying its state', async () => {
    await assertTempLibrary();
    const view = await browser.$('[data-inbox-view]');
    const article = await view.$('[data-path$=".html"]');
    await article.click();
    await browser.keys(['e']);
    await browser.waitUntil(async () => (await inboxState()).items.length === 1, { timeout: 10_000 });
    expect(fs.existsSync(path.join(project, 'Fences, not Sandboxes.html'))).toBe(true);
    expect(fs.existsSync(path.join(inbox, 'Fences, not Sandboxes.html'))).toBe(false);
    await browser.waitUntil(() => fs.existsSync(path.join(project, '.notesage', 'reading-progress.json')), { timeout: 5_000 });
    const carried = JSON.parse(fs.readFileSync(path.join(project, '.notesage', 'reading-progress.json'), 'utf8'));
    expect(carried.items['Fences, not Sandboxes.html'].openedAt).not.toBeNull();
  });

  it('moves the remaining item to the Trash with the delete key', async () => {
    await assertTempLibrary();
    const view = await browser.$('[data-inbox-view]');
    const pdf = await view.$('[data-path$=".pdf"]');
    await pdf.click();
    // WebDriver cannot hold ⌘ across a Backspace reliably in WKWebView; the
    // handler accepts Delete (fn-⌫) without a modifier, which exercises the
    // same code path.
    await browser.keys(['Delete']);
    await browser.waitUntil(async () => (await inboxState()).items.length === 0, { timeout: 10_000 });
    expect(fs.existsSync(path.join(inbox, 'Report.pdf'))).toBe(false);
    await browser.waitUntil(async () => (await view.getText()).includes('Nothing in the Inbox'), { timeout: 5_000 });
  });
});
