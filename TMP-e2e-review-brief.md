# TMP — review & test brief for the laptop agent (DELETE WHEN DONE)

> Disposable. Not for merge. Delete this file before any PR. Do not commit it.

## Context

Branch: `claude/tauri-e2e-mac-testing-oD2vp`. A prior session researched Tauri
E2E on macOS and added real-E2E (`e2e-real/`) work building on an input-fidelity
finding: on macOS/WKWebView with `tauri-plugin-webdriver` **0.2.1** (already the
latest), the WebDriver **send-keys** endpoint delivers *trusted*
`beforeinput`/`input` to ProseMirror (text lands + input rules fire), while the
**Actions API** does not. The old harness comment had generalized "WebDriver
keys don't work in WKWebView," which was only ever true of the Actions API.

**This all runs on macOS only** (WKWebView doesn't exist on Linux), so it was
authored but never executed. Your job: run it and report.

## What changed on the branch (commits `1d0a1d0`, `778e6f4`)

- `e2e-real/helpers/actions.ts` — added `typeViaSendKeys()` (send-keys/`addValue`)
  and `clearEditor()`; corrected `typeInEditor`'s comment (Actions vs send-keys).
- `e2e-real/tests/input-rules.test.ts` — NEW functional spec: `## `→heading,
  `- `→bullet, `/`→slash menu, all via the real send-keys path.
- `e2e-real/tests/input-fidelity-spike.test.ts` — diagnostic; hygiene fixed
  (removes leftover plain input before the find-bar probe; clears editor between
  the C cells). Prints an INPUT-FIDELITY RESULT MATRIX.
- `e2e-real/README.md` — stack, run flow, typing-method matrix.

## Prereqs

```bash
git fetch && git checkout claude/tauri-e2e-mac-testing-oD2vp && git pull
pnpm install
command -v tauri-webdriver || cargo install tauri-webdriver
```

First real-E2E run does a cold Tauri build (5–10 min) — expected.

## Run

Prefer scoping to the two new/changed specs (edit `wdio.conf.ts` `specs` to the
two paths below, run, then revert the edit):

- `./e2e-real/tests/input-rules.test.ts`
- `./e2e-real/tests/input-fidelity-spike.test.ts`

```bash
pnpm test:e2e-real-full        # full lifecycle (build + bridge + specs + cleanup)
```

Then run the **existing** suite unscoped to confirm no regression from the
`actions.ts` changes (only the comment changed in `typeInEditor`, but verify):

- at least `editor.test.ts` and `startup.test.ts` still pass.

## What to confirm / report (verbatim where noted)

1. **`input-rules.test.ts` — all 3 pass?** This is the highest-risk addition. It
   assumes a single `typeViaSendKeys('## ')` (trailing space) triggers
   ProseMirror's heading input rule, and likewise `- `. If any fail, paste the
   failure message — it dumps the editor `innerHTML` so the cause is visible
   (e.g. rule didn't fire, or the trigger char was swallowed). Don't "fix" the
   app — report the HTML and which assertion failed.
2. **`input-fidelity-spike.test.ts` — paste the full RESULT MATRIX and every
   `[spike]` line verbatim.** Confirm:
   - C3 execCommand control = LANDED/trusted (else the run is invalid — say so).
   - C1 send-keys still LANDED/trusted on **this** WebKit.
   - B1 now reports a real find-bar result OR a clean `n/a (find input not
     found)` — NOT a value containing leftover plain-input text like `"xyz…"`.
3. **WebKit version.** Report `safaridriver --version` / the WebKit build. CI
   pins **26.4**; the earlier spike ran on 26.5. If you're on 26.5, note it —
   we specifically need a 26.4 datapoint to trust send-keys in CI.
4. **No-regression:** `editor.test.ts` + `startup.test.ts` still green?

## Rules

- Diagnostic-first: failing/`synthetic`/`no`/`n/a` cells in the spike are valid
  DATA, not bugs to fix. Report, don't patch.
- Do not modify app code or commit anything. Revert any temporary `wdio.conf.ts`
  edit. **Delete this `TMP-e2e-review-brief.md` when finished.**
- Report back: the matrix, the raw `[spike]` lines, input-rules pass/fail (+ HTML
  on any failure), WebKit version, and the no-regression result. Nothing else.
