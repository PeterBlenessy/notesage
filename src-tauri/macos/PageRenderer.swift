//  PageRenderer.swift
//  Notesage macOS Share Extension
//
//  Render a shared URL in a hidden WKWebView and hand back the SETTLED DOM's
//  HTML, so JavaScript-rendered pages can be captured as readable articles
//  instead of degrading to a link-only note.
//
//  A port of the iOS renderer (`src-tauri/ios/PageRenderer.swift`), which
//  shipped in #611. macOS went without it, so every SPA news site captured as
//  a bare link on the Mac while the phone got the article — one of four
//  behaviours the phone had and the Mac did not. Kept deliberately close to
//  the iOS file, line for line, so the two can be diffed rather than reasoned
//  about separately.
//
//  Why a second attempt rather than the first
//  ------------------------------------------
//  The capture pipeline extracts from the raw HTML a network fetch returns. On
//  an SPA the content is assembled by JavaScript after load, so extraction
//  declines. Rendering gives the extractor the DOM a reader would actually see
//  — but it costs a webview, so pages whose article is already in the HTML
//  never pay for it.
//
//  What differs from iOS, and why
//  ------------------------------
//  - `allowsInlineMediaPlayback` does not exist on macOS; inline playback is
//    not a concept here. `mediaTypesRequiringUserActionForPlayback` does exist
//    and carries the part that matters — nothing autoplays.
//  - A desktop user-agent, matching `ShareCapture.fetch` on this platform.
//    Serving a Mac a phone layout would change what the extractor sees.
//  - A desktop-shaped viewport, for the same reason.
//
//  The memory ceiling that dominates the iOS design is looser here — a macOS
//  app extension is not killed as aggressively — but the teardown discipline
//  is kept regardless. An extension process can be reused across shares, so a
//  leaked webview is a leak per share, not per launch.

import AppKit
import WebKit

/// Loads a URL offscreen and returns the rendered DOM's HTML.
///
/// Retains itself for the duration of the load — the caller gets a completion,
/// not an object to keep alive — and releases on the single completion call.
final class PageRenderer: NSObject, WKNavigationDelegate {
    /// Quiet period with no DOM mutations before the page counts as settled.
    private static let quietPeriodMs = 500
    /// Ceiling on the whole render. Past this we take whatever exists.
    private static let hardTimeout: TimeInterval = 5.0

    private var webView: WKWebView?
    private var completion: ((String?) -> Void)?
    private var timeoutWork: DispatchWorkItem?
    private var selfRef: PageRenderer?

    /// Render `url` and call back with the settled DOM's outer HTML, or nil.
    ///
    /// Never throws and never hangs: on any failure — bad URL, navigation
    /// error, timeout with nothing usable — the completion receives nil and the
    /// caller falls back, preserving the "a share never fails outright"
    /// guarantee.
    static func renderedHTML(url: String, completion: @escaping (String?) -> Void) {
        guard let parsed = URL(string: url),
              parsed.scheme == "https" || parsed.scheme == "http" else {
            completion(nil)
            return
        }
        // WKWebView must be created and driven on the main thread, and every
        // caller here arrives from a URLSession completion — which runs on a
        // private background queue. The caller hops too; this is the guard at
        // the point that actually requires it, so a future call site cannot
        // reintroduce the fault silently.
        //
        // Violating it is not a warning. It is a crash or a hang inside
        // WebKit, and in an app extension that means the share sheet vanishes
        // having saved nothing.
        guard Thread.isMainThread else {
            DispatchQueue.main.async { renderedHTML(url: url, completion: completion) }
            return
        }

        let renderer = PageRenderer()
        renderer.selfRef = renderer
        renderer.completion = completion
        renderer.start(parsed)
    }

    private func start(_ url: URL) {
        let config = WKWebViewConfiguration()
        // Nothing here should ever start playing. Beyond the obvious rudeness,
        // media decoding is a large allocation for no benefit — we want the
        // DOM, not the page's experience.
        config.mediaTypesRequiringUserActionForPlayback = .all
        // Ephemeral: a capture must not read or write the user's cookies.
        config.websiteDataStore = .nonPersistent()

        // Small but not zero — a 0×0 webview can skip layout entirely, and
        // some sites only render content once they believe they are visible.
        let view = WKWebView(
            frame: CGRect(x: 0, y: 0, width: 1280, height: 900), configuration: config)
        view.navigationDelegate = self
        // Matches `ShareCapture.fetch`'s agent: unknown agents are served
        // bot-shells by many sites, and a phone agent would hand the extractor
        // a different page than the one this platform fetched.
        view.customUserAgent =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            + "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        webView = view

        var request = URLRequest(url: url)
        request.timeoutInterval = Self.hardTimeout
        view.load(request)

        // The guarantee. Fires whether or not the page ever settles, and takes
        // whatever the DOM holds at that moment — a half-rendered article still
        // extracts better than a link-only note.
        let work = DispatchWorkItem { [weak self] in self?.captureAndFinish() }
        timeoutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.hardTimeout, execute: work)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // `didFinish` means the initial load completed, NOT that the page is
        // done assembling itself — on an SPA it typically fires before any
        // article exists. Watch for the DOM to go quiet instead.
        let script = """
        new Promise((resolve) => {
          let timer;
          const settle = () => resolve(document.documentElement.outerHTML);
          const bump = () => {
            clearTimeout(timer);
            timer = setTimeout(() => { observer.disconnect(); settle(); }, \(Self.quietPeriodMs));
          };
          const observer = new MutationObserver(bump);
          observer.observe(document.documentElement, {
            childList: true, subtree: true, characterData: true, attributes: true,
          });
          bump();
        })
        """
        webView.callAsyncJavaScript(script, in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            if case .success(let value) = result, let html = value as? String {
                self.finish(html)
            } else {
                // Script failed (CSP, a hostile page, an eval-blocked frame).
                // Fall back to whatever the DOM holds right now.
                self.captureAndFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(nil)
    }

    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        finish(nil)
    }

    /// Take the DOM as it stands. Used by the timeout and by script failure —
    /// a partially rendered page is still worth extracting from.
    private func captureAndFinish() {
        guard let webView else {
            finish(nil)
            return
        }
        webView.evaluateJavaScript("document.documentElement.outerHTML") { [weak self] value, _ in
            self?.finish(value as? String)
        }
    }

    /// Single exit. Idempotent — the timeout and the settle callback race by
    /// design, and whichever arrives first wins.
    private func finish(_ html: String?) {
        guard let completion else { return }
        self.completion = nil
        timeoutWork?.cancel()
        timeoutWork = nil
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView = nil
        completion(html)
        // Release the self-reference last: everything above still needs `self`.
        selfRef = nil
    }
}
