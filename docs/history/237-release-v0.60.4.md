# Release v0.60.4

**Date:** 2026-09-18
**Previous version:** 0.60.3

Toasts get their styling back, and the editor's cursor appears where it should.

## Changes

### Fixes

- Notifications in the corner of the window were rendering without most of
  their styling — wrong position, wrong spacing. They look the way they were
  meant to now.
- Clicking in the empty space beside an image or a table showed no cursor, so
  there was no sign of where typing would go. The cursor appears there again.

## Under the hood

Both had the same cause, and it took shipping an instrument to find it. The
CSP reporter added in v0.60.3 named it on its first launch:

```
style-src 'self' 'unsafe-inline' 'nonce-12833584846846472796'
sourceFile: tauri://localhost/assets/index-<hash>.js
violatedDirective: style-src-elem   blockedURI: inline   ×3
```

Tauri appends a nonce to `style-src`, and per the CSP spec a nonce makes
`'unsafe-inline'` inert — so the policy `tauri.conf.json` declares is not the
policy that runs, and every inline `<style>` injected at runtime is refused.
Tracing the three reported positions into the bundle: two are sonner, one is
Tiptap.

Sonner ships its stylesheet as a file *and* injects the same CSS inline.
Nothing imported the file, so the injection was the only route and it was
refused: `data-sonner-toaster` appeared 24 times in `node_modules` and **zero**
times in the built CSS, while `globals.css` carried `[data-sonner-toast]`
overrides written against rules that never arrived. Tiptap's injection carries
the ProseMirror base; `white-space: pre-wrap` was already duplicated in
`editor.css`, but `.ProseMirror-gapcursor` and `img.ProseMirror-separator` were
not.

Both now arrive through the bundler as a hashed stylesheet, which
`style-src 'self'` allows, so the nonce hardening is untouched. Sonner's import
goes before `globals.css` because both are un-layered and globals overrides it;
Tiptap's rules go first in `editor.css` because the rules below are written to
override the base — which is what production already did when `editor.css` was
the only one that loaded. Verified against a real build: 0 → 24
`data-sonner-toaster`, 0 → 3 `ProseMirror-gapcursor`, base preceding override
in the emitted CSS.

Sonner still injects and is still refused — it has no opt-out — but the styles
now come from the bundle, so what remains is log noise rather than a missing
stylesheet.

**No test could have caught this, and that is the point.** `tauri dev` serves
over Vite with no CSP header at all, so all of it works perfectly in
development; the same blind spot hid #444. The new guard is therefore a
source-level assertion that the imports and rules exist, not a runtime check —
no CI job in this repo enforces a real CSP.

## Files Changed

- 5 files across 1 commit (#1049, and this release).
