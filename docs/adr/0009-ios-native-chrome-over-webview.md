# iOS chrome is native SwiftUI over the webview; content stays web

The iOS app's chrome — corner buttons, their long-press menus, and (next) the
search island — is rendered as **native SwiftUI Liquid Glass controls hosted
in small `UIHostingController`s above the WKWebView**, not as styled HTML.
Document content (folder list, readers, markdown rendering) stays web, sharing
the desktop's Rust rendering pipeline. The two layers talk over the existing
plugin bridge: the page declares chrome as data (`ios_set_chrome` with SF
Symbol names), taps come back as `notesage:chrome` CustomEvents — the same
shape as the keyboard forwarder.

Decided 2026-08-10 after several rounds of CSS recreation reviewed on-device
against native reference screenshots (PR #600; the CSS system remains as the
fallback and the in-content press language).

## Considered Options

- **CSS/JS recreation of Liquid Glass** (what we iterated first). The
  material gets close — WebKit supports the translucent fill + backdrop
  blur/saturate + specular rim + sheen recipe — but three things stay
  permanently out of reach: (1) *interruptible spring physics* — CSS
  transitions/keyframes replay curves, they don't run a live spring you can
  catch mid-flight; (2) *real lensing* — the SVG displacement-map refraction
  demos are Chromium-only (`backdrop-filter: url()` doesn't exist in
  Safari/WKWebView); (3) *system behaviors* — UIMenu long-press, correct
  adaptation to every future iOS design revision. Each new control re-fights
  the same fidelity war; per-round review kept landing on "not quite".
- **Fully native app** (SwiftUI everything). Rejected: throws away the shared
  Rust markdown/preview pipeline that makes a note render identically on
  desktop and phone, and forks the product into two codebases. Chrome is
  where fidelity is non-negotiable; content is where sharing wins.
- **Native chrome over web content** (chosen). ~150 lines of Swift buys the
  real material and physics; the content layer is untouched.

## Consequences

- **Chrome is declared as data.** The web app owns *what* chrome exists
  (ids, SF Symbols, menus) per screen; Swift owns *how* it looks and feels.
  New chrome = a spec change + an action handler, no new Swift per button.
- **The web islands remain as the fallback** (desktop dev, tests, builds
  without the native layer) — `useNativeChrome` reports active/inactive and
  the components render web chrome when inactive, so the app can never end
  up chromeless. Tests exercise exactly the fallback path.
- **Keyboard handling inverts for native chrome.** Native views pin to
  `keyboardLayoutGuide` and avoid the keyboard for free; the
  `notesage:keyboard` bridge stays only for the CSS fallback islands.
- **Hit-testing stays simple** because each host is sized to its control —
  no passthrough-view tricks, and web content around the chrome keeps
  receiving touches.
- **A second, bridge-less WKWebView for untrusted HTML reports** becomes the
  natural next simplification (stronger isolation than the sandboxed iframe,
  native find-in-page); tracked separately.
