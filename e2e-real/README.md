# Real E2E (`e2e-real/`)

End-to-end tests that drive the **real** Notesage app — real Rust backend, real
filesystem, real WKWebView — via WebDriver. This is the integration layer that
the mocked Playwright suite (`e2e/`) can't be: Playwright drives Chromium with a
mocked Tauri IPC, so it proves UI logic; this suite proves the app actually
works against its native backend.

## Stack

| Piece | What it does |
| --- | --- |
| `tauri-plugin-webdriver` **0.2.1** | Embeds a W3C WebDriver server inside the app. Gated behind the `e2e-testing` cargo feature (`src-tauri/Cargo.toml`). Compiled in by `pnpm tauri:test`. |
| `tauri-webdriver` (bridge) | Intermediary node: proxies W3C WebDriver requests to the embedded plugin. `cargo install tauri-webdriver`. |
| WebDriverIO 9 + Mocha | The test runner (`wdio.conf.ts`, specs in `tests/`). |

`0.2.1` is the latest published plugin version — there is no newer release to
upgrade to (all releases shipped Feb 2026).

## Running

```bash
# Full lifecycle (build app + start bridge + run specs + clean up)
pnpm test:e2e-real-full

# Or manually, three terminals:
#   1) pnpm tauri:test      # app with the embedded WebDriver server
#   2) tauri-webdriver      # the bridge
#   3) pnpm test:e2e-real   # the specs
```

**macOS only.** WKWebView does not exist on Linux, so these specs cannot run in
the Linux CI container. CI runs them on macOS and deliberately pins WebKit
**26.4** (the 26.5 line carries the #334 render regression).

## Typing into the editor — which helper to use

WKWebView's WebDriver implementation behaves differently across the two input
endpoints, and ProseMirror's contenteditable only honours some of them. The
matrix below was measured by `tests/input-fidelity-spike.test.ts` on
**macOS 26.5 / WebKit 26.5, plugin 0.2.1** (re-confirm on 26.4 before relying on
it in CI):

| Method | WebDriver endpoint | Emits | ProseMirror result |
| --- | --- | --- | --- |
| `pressShortcut()` / `browser.keys()` | Actions API (`/actions`) | synthetic `keydown` | text does **not** land in contenteditable; fine for app/keymap **shortcuts** |
| `typeViaSendKeys()` (`element.addValue`) | send keys (`/element/{id}/value`) | trusted `beforeinput`+`input`, **no** `keydown` | text lands; **input rules fire** (slash menu, markdown autoformat) |
| `typeInEditor()` (`execCommand('insertText')`) | in-page JS shim | trusted `beforeinput`+`input`, no `keydown` | text lands; bulk insert |

Guidance:

- **Bulk text, realism irrelevant** → `typeInEditor()`. Reliable and
  WebKit-version-independent.
- **Need real WebDriver typing / need input rules** (`## ` → heading, `- ` →
  list, `/` → slash menu) → `typeViaSendKeys()`. Send a trailing trigger char in
  its own call so the rule matches: `typeViaSendKeys('## ')` then
  `typeViaSendKeys('Heading')`. See `tests/input-rules.test.ts`.
- **Keymap behaviour** (Enter to split, Tab to nest, `Mod-B`) → `pressShortcut()`.
  Neither text path emits `keydown`, so keymaps only fire through the Actions API.
- **Reset between assertions** → `clearEditor()`. Fixture `empty.md` ships as
  `# Empty Note`, and the per-tab EditorState cache can restore a prior doc on
  reopen.

The historical "WebDriver keys don't work in WKWebView" note was only ever true
of the **Actions API**, not the send-keys endpoint — see the corrected comment
in `helpers/actions.ts`.

## Specs

| Spec | Proves |
| --- | --- |
| `spike.test.ts` | Harness connectivity (plugin + bridge + wdio reach the app). |
| `startup.test.ts` | Bootstrap, project open, markdown render. |
| `editor.test.ts` | Typing, save-to-disk, watcher reload, find. |
| `external-changes.test.ts` | Filesystem watcher auto-reload / dirty-tab prompt. |
| `navigation.test.ts` | Command bar, menu navigation. |
| `performance.test.ts` | Large-doc load, keystroke latency (informational). |
| `input-rules.test.ts` | Markdown input rules + slash menu via real send-keys. |
| `input-fidelity-spike.test.ts` | **Diagnostic** — the matrix above. Prints a `landed / isTrusted` table. Re-run when bumping the plugin or the macOS/WebKit version to confirm send-keys still delivers trusted input. |
