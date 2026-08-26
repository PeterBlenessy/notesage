//  PageRenderer.swift
//  Notesage Share Extension
//
//  Render a shared URL in a hidden WKWebView and hand back the SETTLED DOM's
//  HTML, so JavaScript-rendered pages can be captured as readable articles
//  instead of degrading to a link-only note (#611).
//
//  Why this exists
//  ---------------
//  The capture pipeline extracts from the raw HTML a network fetch returns.
//  On an SPA news site that HTML contains no article — the content is assembled
//  by JavaScript after load — so extraction declines and the share falls back
//  to a bare link. Rendering the page first gives the extractor the DOM a
//  reader would actually see.
//
//  This is used ONLY as a second attempt, after raw-HTML extraction has
//  declined. Pages whose article is already in the HTML never pay for it.
//
//  Two constraints shape everything here
//  -------------------------------------
//  **The extension's memory ceiling (~120 MB).** A share extension gets a
//  fraction of an app's budget, and exceeding it is not an error you can catch
//  — iOS kills the extension and the sheet vanishes under the user. So the
//  webview is deliberately small, media is blocked from autoplaying, the
//  result is copied out as a string, and the webview is torn down the moment
//  it has produced one.
//
//  **"Settled" has no exact answer.** A fixed delay either wastes time on a
//  simple page or truncates a slow one. Pure mutation-quiescence never fires on
//  the many sites that mutate forever (ad rotators, analytics beacons, live
//  tickers). So: quiescence as the signal, a hard ceiling as the guarantee.
//  The constants are starting points that want verifying against real sites,
//  not measured truths — see `docs/features/mobile.md`.

import UIKit
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

    /// Budget for the lazy-image walk, inside the hard timeout.
    private static let scrollWalkMs = 1800

    private var webView: WKWebView?
    private var completion: ((String?) -> Void)?
    private var timeoutWork: DispatchWorkItem?
    private var selfRef: PageRenderer?

    /// Settle, then hand back the rendered DOM.
    ///
    /// **The `return` is load-bearing and its absence was a shipped bug.**
    /// `callAsyncJavaScript` treats the script as a FUNCTION BODY, so an
    /// expression statement evaluates and is discarded — the call resolved
    /// `.success(nil)`, `nil` failed the `as? String` cast, and the completion
    /// took its "script failed (CSP, a hostile page)" branch into
    /// `captureAndFinish()`. Which grabbed the DOM immediately at `didFinish`.
    ///
    /// So the mutation-quiescence heuristic this file is largely about had
    /// never run, on either platform. Nothing errored; captures just contained
    /// whatever happened to have loaded at an arbitrary early moment, which is
    /// why the same article yielded a different number of images each time.
    /// Verified against `callAsyncJavaScript` directly: without `return` →
    /// `success(nil)`, with it → the value.
    ///
    /// **The scroll walk is the other half.** Lazy images load when they enter
    /// the viewport, and this webview never scrolls, so everything below the
    /// fold stayed a placeholder. Walking the document once takes a Medium
    /// article from 9 loaded images to 31. Bounded by `scrollWalkMs` so a long
    /// page cannot eat the whole budget, and wrapped in try/catch because a
    /// page that throws on scroll is not a reason to capture nothing.
    ///
    /// Memory note for iOS specifically: the walk loads more images, which is
    /// the point, but they are decoded into the extension's ~120 MB budget.
    /// The viewport stays phone-sized and the webview is torn down the moment
    /// it yields a string, so the peak is bounded by one screenful of decoded
    /// images rather than the whole document.
    private static var settleScript: String {
        """
        return new Promise(async (resolve) => {
          const done = () => resolve(document.documentElement.outerHTML);
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          try {
            for (const img of document.images) img.loading = 'eager';
            const deadline = Date.now() + \(scrollWalkMs);
            const step = Math.max(240, window.innerHeight * 0.8);
            for (let y = 0; y < document.body.scrollHeight && Date.now() < deadline; y += step) {
              window.scrollTo(0, y);
              await sleep(50);
            }
            window.scrollTo(0, 0);
          } catch (e) { /* keep going — a partial page still extracts */ }
          let timer;
          const bump = () => {
            clearTimeout(timer);
            timer = setTimeout(() => { observer.disconnect(); done(); }, \(quietPeriodMs));
          };
          const observer = new MutationObserver(bump);
          observer.observe(document.documentElement, {
            childList: true, subtree: true, characterData: true, attributes: true,
          });
          bump();
        })
        """
    }

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
        // WKWebView must be created and driven on the main thread. Every call
        // site here reaches this from a `fetch` completion that already hops to
        // main, so this guard is dormant — but the macOS port added it and iOS
        // did not, and an invariant that holds by accident is one edit away
        // from a hang inside WebKit with the share sheet gone.
        //
        // Violating it in an app extension is not a warning: the sheet vanishes
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
        // media decoding is exactly the kind of allocation that pushes an
        // extension past its ceiling.
        config.allowsInlineMediaPlayback = false
        config.mediaTypesRequiringUserActionForPlayback = .all
        // Ephemeral: a capture must not read or write the user's cookies.
        config.websiteDataStore = .nonPersistent()

        // Small but not zero — a 0×0 webview can skip layout entirely, and
        // some sites only render content once they believe they are visible.
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        view.navigationDelegate = self
        // Desktop-ish UA is deliberate: the same reason `fetch` uses a Safari
        // agent — unknown agents are served bot-shells by many sites.
        view.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
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
        let script = Self.settleScript
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

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
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
