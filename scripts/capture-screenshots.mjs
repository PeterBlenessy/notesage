/**
 * Marketing screenshot capture — standalone WebDriver driver (openscans pattern:
 * a plain `remote()` script, NOT the wdio+mocha runner). Drives the REAL app
 * over the demo workspace (content/demo) and writes PNGs into
 * content/screenshots/. Prereqs set up by scripts/capture-screenshots.sh.
 *
 * READ THE MEMORY `project_screenshot_capture_raf_occlusion` BEFORE EDITING.
 * The load-bearing fact: the editor hydration is rAF-driven and WebKit pauses
 * rAF while the app window is occluded — so we keep the window frontmost
 * (activateApp) or the editor renders BLANK with no error.
 *
 * Demo is opened as a PROJECT (not explorer folder) + the index is rebuilt, so
 * the sidebar Tags/Mentions sections and command-bar #/@/! modes have data.
 *
 * Every pose is wrapped in `pose()` (best-effort) so one flaky state never
 * aborts the whole run — a failed pose still leaves a screenshot to inspect.
 */
import { remote } from 'webdriverio';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const REPO = process.cwd();
const DEMO = path.join(REPO, 'content', 'demo');
const OUT = path.join(REPO, 'content', 'screenshots');
mkdirSync(OUT, { recursive: true });

const KEYS = { Meta: '\uE03D', Shift: '\uE008', Escape: '\uE00C', Enter: '\uE007', ArrowDown: '\uE015', ArrowRight: '\uE014' };

/** Keep the app window frontmost so rAF (editor hydration) keeps firing. */
function activateApp() {
  try {
    execSync(
      `osascript -e 'tell application "System Events" to set frontmost of (first process whose name contains "notesage") to true'`,
      { stdio: 'ignore' },
    );
  } catch { /* best-effort */ }
}

const browser = await remote({
  hostname: 'localhost',
  port: 4444,
  path: '/',
  capabilities: { browserName: 'webview', 'webdriver:newSessionParameters': { alwaysMatch: {} } },
  logLevel: 'error',
  connectionRetryTimeout: 120000,
});

async function invoke(cmd, args) {
  const r = await browser.executeAsync(
    (c, a, done) => {
      window.__TAURI_INTERNALS__.invoke(c, a).then((v) => done({ ok: true, v })).catch((e) => done({ ok: false, e: String(e) }));
    },
    cmd,
    args,
  );
  if (!r.ok) throw new Error(`invoke ${cmd}: ${r.e}`);
  return r.v;
}

async function press(keys) {
  const mods = keys.slice(0, -1).map((k) => KEYS[k] || k);
  const final = KEYS[keys[keys.length - 1]] || keys[keys.length - 1];
  let chain = browser.action('key');
  for (const m of mods) chain = chain.down(m);
  chain = chain.down(final).pause(10).up(final);
  for (let i = mods.length - 1; i >= 0; i--) chain = chain.up(mods[i]);
  await chain.perform();
}

async function setTheme(t) {
  await browser.execute((x) => window.__E2E_SETTINGS_STORE__?.getState().setTheme(x), t);
  await browser.pause(500);
}
async function setSidebar(pinned) {
  await browser.execute((p) => {
    const s = window.__E2E_SETTINGS_STORE__?.getState();
    if (s && s.sidebarPinned !== p) s.setSidebarPinned(p);
  }, pinned);
  await browser.pause(350);
}
async function setCmdBarPinned(p) {
  await browser.execute((v) => {
    const s = window.__E2E_SETTINGS_STORE__?.getState();
    if (s?.setCmdBarPinned) s.setCmdBarPinned(v);
  }, p);
  await browser.pause(500);
}
async function stripTransient() {
  await browser.execute(() => {
    document.querySelectorAll('[role="tooltip"],[data-radix-popper-content-wrapper]').forEach((e) => e.remove());
  });
}
/** Dismiss any open editor tippy menu (slash/tag/mention suggestion OR the
 *  bubble menu) cleanly, then let it settle. CRITICAL: do NOT remove
 *  [data-tippy-root] from the DOM — a live tippy instance whose box was yanked
 *  throws `box.children`/`clientRect.left` on its next async reposition and
 *  crashes the whole <Editor> (cascading blank editors). Instead: Escape closes
 *  suggestion menus, collapsing the editor selection hides the bubble menu, and
 *  the pause lets tippy's scheduled reposition run WHILE the editor is still
 *  mounted (so it can't throw during a later doc switch). */
async function killTippy() {
  await press(['Escape']);
  await browser.execute(() => {
    // Collapse the ProseMirror selection so @tiptap/react BubbleMenu hides.
    const pm = document.querySelector('.ProseMirror');
    if (pm) {
      pm.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount) sel.collapseToEnd();
    }
  });
  await press(['ArrowRight']); // nudge PM selection empty → bubble menu hides
  await browser.pause(900);     // let tippy's async forceUpdate settle, mounted
}
async function shot(name) {
  await stripTransient();
  await browser.pause(150);
  await browser.saveScreenshot(path.join(OUT, name));
  console.log('[shot]', name);
}
/** Best-effort pose: run the setup fn, screenshot, never throw. */
async function pose(name, fn) {
  try {
    await fn();
    await shot(name);
  } catch (e) {
    console.log(`[pose] ${name} FAILED: ${String(e?.message || e).slice(0, 120)}`);
    try { await shot(name); } catch { /* ignore */ }
  }
}

// Sidebar tree helpers — expansion is LOCAL component state, so we CLICK rows.
async function expandRow(text) {
  const el = await browser.$(`[role="treeitem"]*=${text}`);
  if (!(await el.isExisting().catch(() => false))) return false;
  const expanded = await el.getAttribute('aria-expanded').catch(() => null);
  if (expanded !== 'true') { await el.click(); await browser.pause(450); }
  return true;
}
async function openFileRow(nameMatch) {
  const el = await browser.$(`[role="treeitem"][aria-label*="${nameMatch}"]`);
  await el.waitForExist({ timeout: 10000, timeoutMsg: `file row not found: ${nameMatch}` });
  await el.click();
  await browser.pause(600);
}
/** Open a demo doc: expand its folder(s) under the project, click the file.
 *  Re-activates the window on every poll — the editor's hydration is rAF-driven
 *  and stalls the instant the window is occluded, so once it's frontmost the
 *  parse-result applies and the content appears. */
async function openDoc(folder, fileMatch, waitSel = '.ProseMirror', waitText = null) {
  activateApp();
  await killTippy(); // never switch docs with a live suggestion tippy open
  await expandRow('demo');
  if (folder) await expandRow(folder);
  await openFileRow(fileMatch);
  let rendered = false;
  for (let i = 0; i < 30 && !rendered; i++) {
    activateApp(); // keep frontmost so rAF keeps firing
    rendered = await browser.execute((sel, txt) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const t = (el.innerText || '').trim();
      if (txt) return t.includes(txt);
      return sel === '.ProseMirror' ? (el.querySelector('h1,h2,p') !== null && t.length > 20) : t.length > 5;
    }, waitSel, waitText).catch(() => false);
    if (!rendered) await browser.pause(1000);
  }
  // Report crashes/failures with the actual error so we know content-crash vs
  // occlusion vs external reset.
  const st = await browser.execute(() => ({
    crashed: document.body.innerText.includes('Something went wrong'),
    errs: (window.__CAP_ERRORS__ || []).slice(-3),
  })).catch(() => ({ crashed: false, errs: [] }));
  if (!rendered || st.crashed) {
    console.log(`[openDoc] ${fileMatch} rendered=${rendered} crashed=${st.crashed} errs=${JSON.stringify(st.errs)}`);
  }
  await browser.pause(700);
}

let code = 1;
try {
  await browser.setTimeout({ script: 60000 });

  // 1) App + stores + startupReady.
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          !!document.querySelector('#root') &&
          !!window.__E2E_WORKSPACE_STORE__ &&
          !!window.__E2E_EDITOR_STORE__ &&
          !!window.__E2E_SETTINGS_STORE__ &&
          window.__E2E_SETTINGS_STORE__.getState().startupReady === true,
      ),
    { timeout: 60000, interval: 500, timeoutMsg: 'app / stores / startupReady not ready' },
  );
  await browser.pause(1200);

  // 1b) Page-level error collector (WKWebView can't read the console directly).
  await browser.execute(() => {
    window.__CAP_ERRORS__ = [];
    const push = (t, a) => window.__CAP_ERRORS__.push(`${t}: ${a}`.slice(0, 300));
    const oe = console.error;
    console.error = (...a) => { push('console.error', a.map(String).join(' ')); oe(...a); };
    window.addEventListener('error', (e) => push('window.error', `${e.message || ''} @ ${e.filename || ''}`));
    window.addEventListener('unhandledrejection', (e) => push('unhandledrejection', String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
  });

  // 2) Clean persisted state (real app data dir): close tabs, clear chat.
  await browser.execute(() => {
    const s = window.__E2E_EDITOR_STORE__.getState();
    for (const t of [...s.openDocuments]) s.closeTab(t.id);
    try { window.__E2E_CHAT_STORE__.setState({ conversations: [], activeConversationId: null }); } catch { /* ignore */ }
  });
  await browser.waitUntil(
    async () => browser.execute(() => window.__E2E_EDITOR_STORE__.getState().openDocuments.length === 0),
    { timeout: 5000, interval: 200, timeoutMsg: 'tabs did not clear' },
  );

  // 3) Open demo as a PROJECT (index-eligible) + rebuild the index so the
  //    sidebar Tags/Mentions + command-bar #/@/! modes have data.
  const tree = await invoke('list_directory', { path: DEMO });
  await browser.execute(
    (p, t) => {
      const w = window.__E2E_WORKSPACE_STORE__.getState();
      w.addProject(p, t);
      const set = window.__E2E_SETTINGS_STORE__.getState();
      if (!set.sidebarPinned) set.setSidebarPinned(true);
    },
    DEMO,
    tree,
  );
  try {
    // index_init both creates the project DB AND reindexes the directory
    // (tags/mentions/tasks/FTS) — no separate rebuild needed (rebuild trips a
    // contentless-FTS5 delete on a fresh DB).
    const stats = await invoke('index_init', { projectPath: DEMO });
    console.log('[index] initialized:', JSON.stringify(stats));
  } catch (e) {
    console.log('[index] init failed (productivity shots may be empty):', String(e).slice(0, 120));
  }
  await browser.pause(1500);

  // 4) Open the hero doc + dismiss the alpha telemetry toast.
  await openDoc('Essays', 'On Attention.md', '.ProseMirror', 'On Attention');
  await browser.execute(() => {
    const b = document.querySelector('[data-sonner-toast] [data-close-button]');
    if (b) b.click();
  });
  await browser.pause(400);

  // =========================================================================
  // STORYBOARD — deliberate, video-friendly beats. Each pose settles before the
  // next so transitions read smoothly (no rapid flashing). Data lives in the
  // isolated .dev-home, so the tags/mentions/tasks shown below are the demo's
  // own — never personal data.
  // =========================================================================
  const beat = (ms = 900) => browser.pause(ms);

  // BEAT 1 — The writing surface (hero essay), light then dark.
  await pose('editor-light.png', async () => { await setTheme('light'); await beat(); });
  await pose('editor-dark.png', async () => { await setTheme('dark'); await beat(); });
  await setTheme('light'); await beat();

  // BEAT 2 — Quiet Composer: distraction-free, left sidebar hidden.
  await pose('quiet-composer-light.png', async () => { await setSidebar(false); await beat(); });
  await pose('quiet-composer-dark.png', async () => { await setTheme('dark'); await beat(); });
  await setTheme('light'); await setSidebar(true); await beat();

  // BEAT 3 — Focus mode (⌘.): all but the current block dims.
  await pose('focus-mode.png', async () => { activateApp(); await press(['Meta', '.']); await beat(1300); });
  await press(['Meta', '.']); await beat(600); await setSidebar(true);

  // BEAT 4 — Rich formatting: callouts, task list, highlighted code.
  await openDoc('Guides', 'Formatting.md', '.ProseMirror', 'field guide');
  await pose('rich-formatting.png', async () => { await beat(); });

  // BEAT 5 — Data in the document: dynamic table (currency + sum footer +
  // sparklines) at the top, then the inline chart below.
  await openDoc('Data', 'Quarterly review.md', '.ProseMirror', 'Quarterly review');
  await browser.execute(() => {
    const sc = document.querySelector('[data-radix-scroll-area-viewport]') || document.scrollingElement;
    if (sc) sc.scrollTop = 0;
  });
  await pose('dynamic-table.png', async () => { await beat(); });
  await pose('chart-block.png', async () => {
    await browser.execute(() => {
      const sc = document.querySelector('[data-radix-scroll-area-viewport]') || document.scrollingElement;
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
    await beat(1000);
  });

  // BEAT 6 — Slide viewer (PPTX).
  await openDoc('Slides', 'Sample deck.pptx', 'body');
  await pose('pptx-viewer.png', async () => { await beat(2800); });

  // BEAT 7 — Interactive editor flows on the hero doc. These open tippy menus
  // (slash / bubble); killTippy dismisses + settles them (no DOM removal) so
  // they never crash the editor on the next doc switch.
  await openDoc('Essays', 'On Attention.md', '.ProseMirror', 'On Attention');

  // 7a — Find & replace WITH a real query -> highlighted matches (full flow).
  await pose('find-replace.png', async () => {
    activateApp();
    await press(['Meta', 'Shift', 'h']);
    await beat(800);
    await browser.execute(() => {
      const inp = document.querySelector('input[placeholder*="ind"], input[placeholder*="earch"]');
      if (inp) { inp.focus(); document.execCommand('insertText', false, 'attention'); }
    });
    await beat(1300); // let all matches highlight
  });
  await press(['Escape']); await beat(600);

  // 7b — Slash command menu (block inserter).
  await pose('slash-menu.png', async () => {
    await browser.execute(() => document.querySelector('.ProseMirror')?.focus());
    await press(['Meta', 'ArrowDown']);
    await browser.execute(() => document.execCommand('insertText', false, '\n'));
    await beat(400);
    await browser.execute(() => document.execCommand('insertText', false, '/'));
    await beat(1300);
  });
  await browser.execute(() => document.execCommand('delete', false)); // remove the "/"
  await killTippy();

  // 7c — Bubble menu (select text -> inline AI actions).
  await openDoc('Essays', 'On Attention.md', '.ProseMirror', 'On Attention');
  await pose('bubble-menu.png', async () => {
    await browser.execute(() => {
      const pm = document.querySelector('.ProseMirror');
      const el = pm && (pm.querySelector('p') || pm.querySelector('h1'));
      if (!el) return;
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      pm.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await beat(1500);
  });
  await killTippy(); // collapse selection -> hide bubble menu, settle

  // BEAT 8 — The sidebar: Projects, Recent, and the demo's OWN Tags / Mentions.
  await openDoc('Essays', 'On Attention.md', '.ProseMirror', 'On Attention');
  await pose('sidebar-sections.png', async () => { await setSidebar(true); await beat(900); });

  // BEAT 9 — Command bar (floating), light then dark.
  const barInputPresent = async () =>
    browser.execute(() => !!document.querySelector('[data-cmd-bar] textarea, [data-cmd-bar] input, [data-cmd-bar] [contenteditable]'));
  const ensureBarOpen = async () => {
    for (let i = 0; i < 4; i++) { if (await barInputPresent()) return; activateApp(); await press(['Meta', 'k']); await beat(1000); }
  };
  await pose('command-bar-light.png', async () => { await ensureBarOpen(); await beat(1000); });
  await pose('command-bar-dark.png', async () => { await setTheme('dark'); await beat(800); });
  await setTheme('light'); await beat(500);

  // BEAT 10 — Command bar prefix modes, each showing REAL demo content.
  const setBar = async (t) => {
    await ensureBarOpen();
    await browser.execute((text) => {
      const inp = document.querySelector('[data-cmd-bar] textarea, [data-cmd-bar] input, [data-cmd-bar] [contenteditable]');
      if (!inp) return;
      inp.focus(); document.execCommand('selectAll', false); document.execCommand('delete', false);
      if (text) document.execCommand('insertText', false, text);
    }, t);
    await beat(1600); // slow — let the mode picker query the index and render
  };
  await pose('command-bar-skills.png', async () => { await setBar('/'); });
  await pose('command-bar-tags.png', async () => { await setBar('#'); });
  await pose('command-bar-references.png', async () => { await setBar('@'); });
  await pose('command-bar-tasks.png', async () => { await setBar('!'); });
  await setBar(''); await press(['Escape']); await press(['Escape']); await beat(500);

  // BEAT 11 — Command bar PINNED as a right-edge panel (left sidebar hidden so
  // the editor isn't squeezed), light then dark.
  await pose('command-bar-pinned-light.png', async () => { await setSidebar(false); await setCmdBarPinned(true); await beat(1300); });
  await pose('command-bar-pinned-dark.png', async () => { await setTheme('dark'); await beat(800); });
  await setTheme('light'); await setCmdBarPinned(false); await setSidebar(true); await beat(700);

  // BEAT 12 — Settings (open once, switch panels by nav-item text).
  const gotoSettingsPanel = async (label) => {
    activateApp();
    const open = await browser.execute(() => !!document.querySelector('[role="dialog"]'));
    if (!open) { await press(['Meta', ',']); await beat(1500); }
    const clicked = await browser.execute((lbl) => {
      const els = Array.from(document.querySelectorAll('button, [role="tab"], a, [role="button"], [role="menuitem"]'));
      const hit = els.find((e) => (e.textContent || '').trim().toLowerCase() === lbl.toLowerCase());
      if (hit) { hit.click(); return true; } return false;
    }, label);
    console.log(`[settings] nav "${label}" clicked=${clicked}`);
    await beat(1300);
  };
  await pose('settings-appearance.png', async () => { await gotoSettingsPanel('Appearance'); });
  await pose('settings-ai.png', async () => { await gotoSettingsPanel('AI Providers'); });
  await pose('automations.png', async () => { await gotoSettingsPanel('Automations'); });
  await press(['Escape']); await beat(600);

  // BEAT 13 — Export dialog.
  await openDoc('Essays', 'On Attention.md', '.ProseMirror', 'On Attention');
  await pose('export-dialog.png', async () => { activateApp(); await press(['Meta', 'Shift', 'e']); await beat(1400); });
  await press(['Escape']);


    console.log('\n✅ capture pass complete → content/screenshots/');
  code = 0;
} catch (e) {
  console.error('[capture] fatal:', e?.stack || e?.message || e);
  try {
    const diag = await browser.execute(() => ({
      docs: (window.__E2E_EDITOR_STORE__?.getState?.().openDocuments || []).map((t) => t.fileName),
      errors: window.__CAP_ERRORS__ || [],
      body: document.body.innerText.slice(0, 200),
    }));
    console.log('[DIAG]', JSON.stringify(diag));
    await browser.saveScreenshot(path.join(OUT, '_diag.png'));
  } catch { /* ignore */ }
} finally {
  await browser.deleteSession().catch(() => {});
}
process.exit(code);
