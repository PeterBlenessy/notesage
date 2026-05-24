#!/usr/bin/env node
/**
 * WebDriver-based perf driver for Notesage's editor doc-switch pipeline.
 *
 * Measures click-to-visible time for warm cycles of (BIG ↔ SMALL ↔ BIG …)
 * by driving the running app through tauri-webdriver. Use it to validate
 * that the per-file EditorState cache and parsedDocCache are doing their
 * jobs — the warm-click numbers should be sub-500 ms once the cache is
 * populated.
 *
 * Prerequisites (run in two terminals before invoking this):
 *   1. Start the dev build with the WebDriver plugin:
 *        pnpm tauri:test
 *      Wait until `curl -s http://localhost:4445/status` returns ready.
 *
 *   2. Start the bridge:
 *        tauri-webdriver --port 4444 --native-port 4445
 *
 * Then run this script from the repo root:
 *   node scripts/perf-driver.mjs                       # default 502 KB book fixture
 *   node scripts/perf-driver.mjs --big /path/to/your.md
 *
 * Inspect detailed timings in /tmp/notesage-dev.log (filter `perf:doc-switch`).
 * The console output here shows wall-clock click-to-visible; the
 * `setupMs` / `pipelineMs` / `streamMs` perf-log fields tell the real story.
 *
 * The default BIG_FILE is `tests/fixtures/perf/perf-book-500kb.md` —
 * regenerate it via `node scripts/generate-perf-book.mjs`.
 *
 * A tiny SMALL_FILE for eviction lives at /tmp/perf-driver-workspace/filler.md
 * (auto-created if missing) — opening it evicts the big file from the
 * single-doc shell so the next big-file click exercises the cache path.
 */

import { remote } from 'webdriverio';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BIG = resolve(REPO_ROOT, 'tests/fixtures/perf/perf-book-500kb.md');
const BIG_FILE = flag('--big', DEFAULT_BIG);
const SMALL_DIR = '/tmp/perf-driver-workspace';
const SMALL_FILE = `${SMALL_DIR}/filler.md`;
const BIG_DIR = dirname(BIG_FILE);

if (!existsSync(SMALL_FILE)) {
  mkdirSync(SMALL_DIR, { recursive: true });
  writeFileSync(
    SMALL_FILE,
    '# Filler\n\nUsed to evict the big file from the single-doc shell.\n\nNext click should hit the warm cache.\n',
    'utf8',
  );
}

const stamp = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.log(`[${stamp()}]`, ...a);

const browser = await remote({
  hostname: 'localhost', port: 4444, path: '/',
  capabilities: { browserName: 'webview', 'webdriver:newSessionParameters': { alwaysMatch: {} } },
  logLevel: 'warn',
});

async function waitForStores() {
  await browser.waitUntil(
    () => browser.execute(() => Boolean(window.__E2E_WORKSPACE_STORE__ && window.__E2E_EDITOR_STORE__)),
    { timeout: 30_000, interval: 250, timeoutMsg: 'E2E stores not exposed on window — is the app running with --features e2e-testing?' },
  );
}

async function ensureFolder(path) {
  const res = await browser.executeAsync((p, done) => {
    window.__TAURI_INTERNALS__.invoke('list_directory', { path: p })
      .then((r) => done({ ok: true, value: r }))
      .catch((e) => done({ ok: false, error: String(e) }));
  }, path);
  if (!res.ok) throw new Error(`list_directory ${path}: ${res.error}`);
  await browser.execute((p, ft) => {
    const s = window.__E2E_WORKSPACE_STORE__.getState();
    if (!(s.explorerFolders ?? []).find((f) => f.path === p)) s.addExplorerFolder(p, ft);
  }, path, res.value);
}

async function readFile(path) {
  const res = await browser.executeAsync((p, done) => {
    window.__TAURI_INTERNALS__.invoke('read_file', { path: p })
      .then((r) => done({ ok: true, value: r }))
      .catch((e) => done({ ok: false, error: String(e) }));
  }, path);
  if (!res.ok) throw new Error(`read_file ${path}: ${res.error}`);
  return res.value;
}

async function openFile(filePath) {
  const content = await readFile(filePath);
  await browser.execute((fp, name, body) => {
    window.__E2E_EDITOR_STORE__.getState().openTab(fp, name, body);
  }, filePath, filePath.split('/').pop(), content);
}

async function waitForActive(filePath, timeout = 45_000) {
  await browser.waitUntil(
    () => browser.execute((fp) => {
      const s = window.__E2E_EDITOR_STORE__.getState();
      const t = s.openDocuments.find((d) => d.id === s.activeTabId);
      return t?.filePath === fp;
    }, filePath),
    { timeout, interval: 100, timeoutMsg: `active tab never became ${filePath}` },
  );
}

async function waitForVisible(sentinel, timeout = 45_000) {
  await browser.waitUntil(async () => {
    const el = await browser.$('.ProseMirror');
    if (!(await el.isExisting())) return false;
    return (await el.getText()).includes(sentinel);
  }, { timeout, interval: 100, timeoutMsg: `sentinel "${sentinel}" never appeared in editor text` });
}

// Pull a stable sentinel from the first heading of each file.
async function sentinelFor(filePath, fallback) {
  try {
    const body = await readFile(filePath);
    for (const line of body.split('\n')) {
      const m = line.match(/^#{1,6}\s+(.{3,40}?)(?:\s|$)/);
      if (m) return m[1].split(/[\s—–]/)[0];
    }
  } catch { /* fall through */ }
  return fallback;
}

try {
  log(`BIG  = ${BIG_FILE}`);
  log(`SMALL= ${SMALL_FILE}`);
  log('Session created. Waiting for E2E stores …');
  await waitForStores();
  log('Stores ready. Ensuring explorer folders …');
  await ensureFolder(BIG_DIR);
  await ensureFolder(SMALL_DIR);
  log('Folders ready. Sniffing sentinels from file headings …');
  const bigSentinel = await sentinelFor(BIG_FILE, 'Chapter');
  const smallSentinel = await sentinelFor(SMALL_FILE, 'Filler');
  log(`  big sentinel:   "${bigSentinel}"`);
  log(`  small sentinel: "${smallSentinel}"`);
  log('Beginning measurement runs.');

  const runs = [
    { label: 'COLD-1  (big)',  file: BIG_FILE,   sentinel: bigSentinel },
    { label: 'SMALL-1 (small)', file: SMALL_FILE, sentinel: smallSentinel },
    { label: 'WARM-1  (big)',  file: BIG_FILE,   sentinel: bigSentinel },
    { label: 'SMALL-2 (small)', file: SMALL_FILE, sentinel: smallSentinel },
    { label: 'WARM-2  (big)',  file: BIG_FILE,   sentinel: bigSentinel },
    { label: 'SMALL-3 (small)', file: SMALL_FILE, sentinel: smallSentinel },
    { label: 'WARM-3  (big)',  file: BIG_FILE,   sentinel: bigSentinel },
  ];
  for (const r of runs) {
    log(`---- ${r.label} ----`);
    const t0 = Date.now();
    await openFile(r.file);
    await waitForActive(r.file);
    await waitForVisible(r.sentinel);
    const ms = Date.now() - t0;
    log(`${r.label} :: click→visible ≈ ${ms}ms  (see /tmp/notesage-dev.log perf:doc-switch for setupMs / pipelineMs / streamMs)`);
    await browser.pause(2000);
  }
  log('All runs complete.');
} catch (err) {
  console.error('FATAL:', err);
  process.exitCode = 1;
} finally {
  try { await browser.deleteSession(); } catch {}
}
