# HTML viewer navigation — follow links, and find your way back

**Status:** draft
**Date:** 2026-08-16
**Platforms:** desktop + iOS

## Problem

A folder of linked HTML files — an exported report, a generated site, a
documentation bundle — is not readable in Notesage today. Clicking a link in
the HTML viewer does nothing useful: the sanitised-div path lets the click
navigate the host window, and the iframe paths swallow it entirely. There is
no way back from a document you did open, because the shell holds one document
at a time.

The pieces to fix it mostly exist. They were simply never wired to HTML.

| Capability | Desktop | iOS |
| --- | --- | --- |
| Resolve a relative link to a workspace file | `handleLinkNavigation()` (`link-utils.ts`) | `resolveRelativeLink()` (`Reader.tsx`) |
| Used by | editor, `MarkdownPreview` | markdown reader only |
| Wired into the HTML viewer | **no** | **no** |

## Outcome

Reading a set of linked HTML files feels like reading a small local site:
links go where they point, and a back control returns you to where you were.

## In scope

### 1. Follow links between local HTML files

Both relative (`./page2.html`, `../refs/a.html`) and absolute local paths
resolve and open in the viewer. Reuse each platform's existing resolver rather
than writing a third — the mobile one already refuses to escape the library
root, which is a property worth keeping.

### 2. Clicks from inside the sandboxed frame

The `allow-scripts` iframe (desktop) and the `htmlpreview://` frame (iOS) are
cross-origin by design, so a click listener on the parent never sees the
event. iOS already injects a small agent into the previewed document for
find-in-page and talks to it over `postMessage`; extending that agent to
intercept anchor clicks and post the href out is the same mechanism, already
proven in this codebase. Desktop gets the equivalent.

The agent must post the href only — never let the frame drive navigation
directly. The parent decides what a link means; the document does not.

### 3. Back

- **Desktop:** a floating back affordance over the viewer, appearing only once
  there is somewhere to go back to.
- **iOS:** a back control in the reader chrome, matching the platform's
  existing back behaviour.

Each viewer keeps its own history stack. This is deliberately *not* the global
MRU cycle (`⌃Tab`): "back" here means "the page I came from in this bundle",
which is a different question from "the last document I had open".

### 4. Choosing internal or external per link

Right-click (desktop) and long-press (iOS) offer **Open here** / **Open in
browser** on any link. Plain click keeps the current default: local files
internally, `http(s)` externally.

## Out of scope, pending a decision

### Rendering `http(s)` pages inside the app

This is the one ask that cannot ship as described without weakening the app's
hardening, so it is carved out rather than smuggled in.

The live CSP is:

```
frame-src 'self' blob: data: htmlpreview: http://htmlpreview.localhost
```

No remote origin. A remote page in an iframe is **blocked today**, and
`src/lib/__tests__/tauri-capability-surface.test.ts` asserts that shape as a
regression lock, deliberately.

Allowing it means widening `frame-src` to remote origins. The frame would stay
sandboxed without `allow-same-origin`, so a remote page could not read app
state or local files — but it would be arbitrary third-party code executing
inside the app, able to make its own network requests. That trade is a product
decision, not an implementation detail.

If it is wanted, the shape to consider is a separate opt-in setting (off by
default, beside the existing "Allow scripts (unsafe)"), a narrowed `frame-src`
rather than a blanket `https:`, and an updated regression lock that asserts the
new shape intentionally rather than merely tolerating it.

## Non-goals

- In-page `#anchor` scrolling inside the frame (today's no-op stands)
- Forward navigation beyond back (add only if back proves insufficient)
- Rewriting either platform's link resolver into a shared module — they differ
  because the security models differ (workspace roots vs a single granted
  library root), and merging them would weaken the mobile one

## Acceptance criteria

- [ ] A relative link between two local HTML files opens the target in the viewer, on both platforms
- [ ] An absolute local path does the same
- [ ] Links work in every render path, including the sandboxed frames
- [ ] Back returns to the previous document; the control is absent when there is no history
- [ ] Right-click / long-press offers Open here and Open in browser
- [ ] A link pointing outside the granted library (iOS) or workspace roots (desktop) is refused, with the existing message
- [ ] Remote pages still cannot render in-frame unless the carve-out above is separately decided and implemented
