# Untrusted HTML reports render in their own bridge-less WKWebView

Exported HTML reports (`.html`/`.htm`) opened in the iOS mobile Reader render
in a **second `WKWebView`** — its own instance, its own content process, no
Tauri plugin bridge, no script message handlers, no user scripts — instead of a
`sandbox="allow-scripts"` iframe inside the app's webview served from the
`htmlpreview://` custom scheme. Find-in-page comes from WebKit's own
`UIFindInteraction` rather than a script injected into the report.

Decided 2026-08-26, implementing the follow-up ADR 0009 flagged in its
Consequences ("a second, bridge-less WKWebView … becomes the natural next
simplification; tracked separately"). Issue #606.

**Verification status:** the native path is built and type-checked (the plugin
package compiles against the iOS SDK; CI now type-checks `ReportWebView.swift`
too) but has **not** been exercised on a device or simulator at the time of
writing. A green compile says nothing about whether a report paints, whether
the find bar opens, or whether the app's back button survives being covered by
the new web view. Treat the on-device pass as outstanding until this paragraph
says otherwise.

## Context

A report is the least trusted content the app renders. It is a document with
its own `<script>` blocks, and the whole point of the format is that those
scripts run — charts draw, tabs switch, accordions open.

The previous arrangement put that document inside the app's own webview:

- **Why the custom scheme existed at all.** `srcdoc`, `blob:` and `data:`
  documents all inherit the host window's CSP, and the embedded build's nonce
  injection neutralises `'unsafe-inline'` — so a report's own styles and
  scripts were refused and it rendered bare. A custom-scheme response carries
  its own (empty) policy. The scheme was never wanted; it was the cheapest way
  to escape a CSP the report should never have been subject to.
- **Why find-in-page was an injected agent.** The app cannot reach into a
  cross-origin sandboxed frame's DOM, so search had to run *inside* the
  report, via `html-find-agent.ts` speaking `postMessage` to the parent. The
  same reason produced `html-link-agent.ts` for link taps.

Both workarounds are consequences of the frame, not of the requirement.

## Considered Options

- **Keep the iframe, keep the agents.** Works today. But `allow-scripts`
  without `allow-same-origin` is a *policy* applied to a document that still
  shares the app's web content process, and every future capability the reader
  needs over a report (find, print, text size) has to be re-implemented as
  another injected agent speaking another postMessage protocol. The cost
  compounds per capability.
- **Render reports as sanitised inert HTML** (the desktop viewer's default
  path). Rejected: it defeats the format. A report whose scripts do not run is
  not the report — no charts, no tabs.
- **A second bridge-less WKWebView** (chosen). A separate web view has no
  inherited CSP, so `loadHTMLString` simply works and the custom-scheme
  workaround disappears rather than being ported. It gets its own content
  process, so a WebKit exploit in a report lands in a process holding nothing.
  And `isFindInteractionEnabled` gives native find over a document the app
  cannot read — which is what retires the find agent, rather than
  re-implementing it.

## Consequences

- **The isolation claim is now structural, not configured.** No message
  handlers, no user scripts, no bridge, `baseURL: nil` (unique opaque origin,
  no resolvable relative URLs). There is no `window.webkit.messageHandlers`
  entry to find and no parent window to `postMessage` at.
- **Link taps move from an injected agent to `decidePolicyFor`.** Native
  interception of the navigation WebKit was about to perform — which the
  report's JS can neither forge into something else nor observe. In-document
  fragments still scroll in place; everything else is cancelled and handed to
  the app.
- **One narrow channel remains, and it is one-directional.** Link taps and a
  content-process-crash notice are dispatched onto the APP's webview as
  `notesage:report` CustomEvents. Report-derived bytes (the href) cross here,
  so they are JSON-encoded through a single helper — this is the only place
  untrusted bytes reach the context that still holds the Tauri bridge, and
  therefore the only place that has to be right.
- **Find UX changes shape.** The web search island is replaced, for reports
  only, by WebKit's system find bar (next/previous/match count). Reports are
  the only document kind that gets the system bar; markdown/text keep the
  `dom-search` marker and PDFs keep the viewer's text-layer search.
- **`html-find-agent.ts` is retired, but not yet deleted.** It exists solely to
  serve a frame the native path no longer creates — so its removal is the
  intended end state, and this ADR records that. It is still in the tree
  because deleting it now would take find-in-report away from the *fallback*
  before the native replacement has been confirmed on a device, which is the
  ordering #606's own acceptance criteria ask for. The deletion is the last
  step of that issue, not the first.
- **The `htmlpreview://` scheme stays registered.** The reader also uses it for
  mermaid-diagram SVGs, which is a separate path with its own reason (WebKit
  refuses `<foreignObject>` inside an SVG-as-image). Only the *report* usage
  moves. Removing the scheme is not implied and would break diagrams.
- **The desktop `HtmlViewer` is untouched.** It uses the same iframe mechanism
  for the same CSP reason, and this decision is scoped to iOS — the desktop has
  no `UIFindInteraction` and no equivalent presentation model.
- **A report can now be killed independently of the app.** Its own content
  process means `webViewWebContentProcessDidTerminate` is reachable for a
  report alone; it dismisses and tells the reader, rather than leaving a blank
  rectangle indistinguishable from an empty document.
- **The native layer is now load-bearing for reading reports.** Where chrome
  had a web fallback (ADR 0009), this does not: a build without the native
  plugin cannot present a report webview. The reader keeps the iframe path for
  exactly that case (desktop dev, tests), so the fallback is a real code path
  rather than a claim.
