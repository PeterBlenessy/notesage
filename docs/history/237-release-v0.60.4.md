# Release v0.60.4

**Date:** 2026-09-18
**Previous version:** 0.60.3

Notifications appear again, and the editor's cursor shows up beside images and
tables.

## Changes

### Fixes

- Notifications were not appearing at all. Saving, renaming, exporting — none
  of them confirmed anything had happened. They show up in the bottom-right
  corner again.
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

Sonner turned out to stop injecting altogether: importing the stylesheet makes
Vite prebundle the package and extract its CSS rather than shim it through
`__insertCSS`, so the launch after this release reported **zero** CSP
violations rather than the two predicted.

**The severity was initially described wrong, and the correction is the more
interesting fact.** The first write-up of this entry said the toasts rendered
"without most of their styling — wrong position, wrong spacing", which was
inferred rather than checked. The layout says otherwise: `<Toaster>` is a
sibling that follows `<div className="flex h-screen w-screen overflow-hidden">`,
and sonner's inline `style` sets only CSS custom properties — `position: fixed`
came solely from the refused rule. Without it the toaster is a normal block in
document flow, placed after an element that already fills the viewport, so it
rendered below the fold. Not misplaced. **Off-screen.**

That also explains why nobody reported it. Asked whether toasts had looked
wrong, the answer was "I don't remember them looking wrong" — which is exactly
what you would say about a notification you never saw.

**No test could have caught this, and that is the point.** `tauri dev` serves
over Vite with no CSP header at all, so all of it works perfectly in
development; the same blind spot hid #444. The new guard is therefore a
source-level assertion that the imports and rules exist, not a runtime check —
no CI job in this repo enforces a real CSP.

## Files Changed

- 5 files across 1 commit (#1049, and this release).
