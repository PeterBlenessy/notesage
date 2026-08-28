//  ReportWebView.swift
//  Notesage iOS plugin
//
//  A SECOND, bridge-less WKWebView for exported HTML reports (#606, ADR 0010,
//  following ADR 0009's native-chrome decision which flagged this as the next
//  simplification).
//
//  What it replaces, and why that needed replacing
//  -----------------------------------------------
//  Reports used to render in a `sandbox="allow-scripts"` iframe inside the
//  APP's webview, served from the `htmlpreview://` custom scheme. The scheme
//  existed for one reason: `srcdoc`, `blob:` and `data:` documents all INHERIT
//  the host window's CSP, and the embedded build's nonce injection neutralises
//  `'unsafe-inline'`, so a report's own <style>/<script> were refused and it
//  rendered bare.
//
//  A separate WKWebView has no such problem. It is a different web view with
//  its own default policy, so `loadHTMLString` just works — the whole
//  custom-scheme workaround exists only because the document was a frame
//  inside a CSP-bearing page. Removing the frame removes the reason.
//
//  Three things follow, and they are the point:
//
//  1. STRONGER ISOLATION. `allow-scripts` without `allow-same-origin` puts a
//     frame on an opaque origin, which is real but is still a policy applied
//     to a document sharing the app's web content process. A separate
//     WKWebView gets its OWN content process. A WebKit exploit in a report now
//     has to escape a process that holds nothing, rather than one that holds
//     the app.
//
//  2. NO REACHABLE CHANNEL. This configuration registers no script message
//     handlers, no user scripts, and no Tauri plugin bridge. There is no
//     `window.webkit.messageHandlers` entry for the report's JS to find and no
//     parent window to `postMessage` at. The iframe had a parent, which is why
//     find-in-page had to be an injected agent speaking postMessage.
//
//  3. NATIVE FIND. `isFindInteractionEnabled` gives WebKit's own find-in-page
//     — the system bar with next/previous and a match count — over a document
//     the app cannot read. That is what retires `html-find-agent.ts`: search
//     no longer needs to run inside the report because WebKit runs it for us,
//     below the JS layer entirely.
//
//  What is deliberately NOT here
//  -----------------------------
//  The `htmlpreview://` scheme itself stays registered: the mobile reader also
//  uses it for mermaid-diagram SVGs, which is a separate path with its own
//  reasons (WebKit refuses `<foreignObject>` in an SVG-as-image). Only the
//  REPORT usage moves.

import UIKit
import WebKit

/// Presents an exported HTML report in its own web view.
///
/// A singleton because there is exactly one reader on screen and at most one
/// report in it. Presenting a second replaces the first rather than stacking —
/// the reader opens documents, it does not push a navigation stack.
final class ReportPresenter: NSObject {
  static let shared = ReportPresenter()

  private var reportView: WKWebView?
  /// The APP's web view. Held weakly and used for exactly one thing:
  /// dispatching link taps back to the web layer. Never the other direction —
  /// nothing the report contains is ever evaluated against this.
  private weak var appWebView: WKWebView?
  /// Set while `loadHTMLString`'s own navigation is in flight, so the
  /// navigation policy handler can tell it apart from a link tap. Without it
  /// the initial load cancels itself and the report never appears.
  private var isLoadingInitialDocument = false

  var isPresenting: Bool { reportView != nil }

  // MARK: - Presentation

  /// Show `html`. Main thread only.
  ///
  /// `insetTop`/`insetBottom` are the reader's measured safe-area padding, in
  /// CSS pixels. They are applied as a scroll-view content inset rather than
  /// injected into the document: the app can legitimately touch its OWN web
  /// view's scroll view, and rewriting the report's markup to position it is
  /// exactly the kind of reach-in this change exists to stop.
  func present(
    html: String, over appWebView: WKWebView, insetTop: CGFloat, insetBottom: CGFloat,
    backgroundColor: UIColor
  ) {
    dispatchPrecondition(condition: .onQueue(.main))
    self.appWebView = appWebView
    dismiss()

    guard let container = appWebView.superview else { return }

    let config = WKWebViewConfiguration()
    // A FRESH content controller, and nothing added to it. Stating it rather
    // than relying on the default being empty: the isolation claim in this
    // file's header is only true for as long as nobody adds a handler here,
    // and an explicit empty object is where a reviewer looks.
    config.userContentController = WKUserContentController()
    // Carried over from the iframe path this replaced, where it rode in via
    // `withReaderInsets`. That helper injected THREE things: body padding,
    // box-sizing, and this. The padding became a scroll content inset — a
    // better mechanism, and the reason the rewrite looked complete. But there
    // is no native equivalent for text-size-adjust, so it was dropped in the
    // migration rather than translated, and nothing failed loudly when it was.
    //
    // Without it WebKit may inflate a document's text on its own. A captured
    // article is exactly the shape that invites it: many are parsed in quirks
    // mode (#805), where autosizing is more eager, and the reader stylesheet
    // sets a fixed 17px body — so any inflation is visibly not what the
    // document asked for.
    //
    // A user SCRIPT is not a message handler: it adds no channel from the
    // document back to the app, so the bridge-less claim above is unchanged.
    // It is also the only lever WebKit offers here — the setting exists in
    // CSS and nowhere in `WKWebViewConfiguration`.
    config.userContentController.addUserScript(
      WKUserScript(
        source: """
          var s = document.createElement('style');
          s.textContent = 'html{-webkit-text-size-adjust:100%}';
          document.documentElement.appendChild(s);
          """,
        injectionTime: .atDocumentEnd,
        forMainFrameOnly: true))
    // Reports are self-contained documents that draw charts and run tabs;
    // scripts are the point.
    config.defaultWebpagePreferences.allowsContentJavaScript = true
    // Nothing a report does should outlive the reading of it — no cookies, no
    // local storage, no cache shared with anything else.
    config.websiteDataStore = .nonPersistent()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = .all

    let view = WKWebView(frame: container.bounds, configuration: config)
    view.navigationDelegate = self
    view.translatesAutoresizingMaskIntoConstraints = false
    // WebKit's own find-in-page (iOS 16+, and `Package.swift` pins `.iOS(.v16)`
    // — exactly this floor). Replaces the injected agent.
    view.isFindInteractionEnabled = true
    // The app's background, not white. A sandboxed iframe had an opaque white
    // backing that no styling inside the document could change, so a dark
    // report flashed white on open. A real web view has no such backing, but
    // it does paint its own background before the document's — so set it, or
    // the same flash returns by a different route.
    view.backgroundColor = backgroundColor
    view.isOpaque = false
    view.scrollView.backgroundColor = backgroundColor
    // Padding is OURS to apply, not the document's to be rewritten with.
    view.scrollView.contentInsetAdjustmentBehavior = .never
    view.scrollView.contentInset = UIEdgeInsets(
      top: insetTop, left: 0, bottom: insetBottom, right: 0)
    view.scrollView.verticalScrollIndicatorInsets = view.scrollView.contentInset
    // Invisible until the document has painted, for the same reason the iframe
    // was: a blank frame reads as a broken document.
    view.alpha = 0

    // Directly above the app's web view, so the native chrome hosts (back
    // button, share, search island) stay on top and the user can still leave.
    container.insertSubview(view, aboveSubview: appWebView)
    NSLayoutConstraint.activate([
      view.topAnchor.constraint(equalTo: container.topAnchor),
      view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
      view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
    ])
    ChromeManager.shared.bringChromeToFront()

    isLoadingInitialDocument = true
    // `baseURL: nil` leaves the document on a unique opaque origin with no
    // resolvable relative URLs — it cannot reach the library, the app's
    // custom schemes, or anything on disk. Reports are self-contained by
    // construction (that is what the exporter produces), so there is nothing
    // for a base URL to resolve.
    view.loadHTMLString(html, baseURL: nil)
    reportView = view
  }

  /// Tear the report down. Idempotent.
  func dismiss() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard let view = reportView else { return }
    reportView = nil
    isLoadingInitialDocument = false
    // Order matters: drop the delegate BEFORE stopping, or `stopLoading`
    // delivers a `didFail` into a presenter that has already moved on.
    view.navigationDelegate = nil
    view.stopLoading()
    view.removeFromSuperview()
  }

  // MARK: - Find

  /// Open WebKit's find bar over the report.
  ///
  /// Returns false when there is no report on screen, so the caller can fall
  /// back to the web search island rather than silently doing nothing.
  @discardableResult
  func presentFind() -> Bool {
    dispatchPrecondition(condition: .onQueue(.main))
    guard let interaction = reportView?.findInteraction else { return false }
    interaction.presentFindNavigator(showingReplace: false)
    return true
  }

  func dismissFind() {
    dispatchPrecondition(condition: .onQueue(.main))
    reportView?.findInteraction?.dismissFindNavigator()
  }
}

// MARK: - Navigation

extension ReportPresenter: WKNavigationDelegate {
  /// Link taps are intercepted HERE, natively, rather than by a script
  /// injected into the report.
  ///
  /// That is the whole difference from `html-link-agent.ts`. The old agent had
  /// to live inside the document and speak `postMessage` to a parent window;
  /// this reads the navigation WebKit is about to perform, which the report's
  /// JS cannot forge into something else and cannot listen in on.
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    // Our own `loadHTMLString`. Anything else is the document trying to
    // navigate, which a report has no business doing in place.
    if isLoadingInitialDocument, navigationAction.navigationType == .other {
      isLoadingInitialDocument = false
      decisionHandler(.allow)
      return
    }

    decisionHandler(.cancel)
    guard let url = navigationAction.request.url else { return }

    // In-document anchors are navigation the report SHOULD do — a table of
    // contents in a long report is the common case — so scroll rather than
    // hand the fragment to the app as if it were an outbound link.
    if url.fragment != nil, url.scheme == nil || url.absoluteString.hasPrefix("#") {
      webView.evaluateJavaScript(
        "location.hash = \(jsString(url.absoluteString))", completionHandler: nil)
      return
    }

    emitLinkTap(url.absoluteString)
  }

  /// Reveal once the document has painted.
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    isLoadingInitialDocument = false
    UIView.animate(withDuration: 0.15) { webView.alpha = 1 }
  }

  func webView(
    _ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error
  ) {
    // Show it anyway. A partially rendered report beats a blank pane, and the
    // failure modes here are sub-resource errors on a document that is already
    // self-contained.
    webView.alpha = 1
  }

  /// A report is untrusted content in its own process, so it can be killed
  /// independently of the app. Say so rather than leaving a blank rectangle
  /// the user cannot distinguish from an empty document.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    dismiss()
    emitCrashed()
  }

  // MARK: - Events to the web layer

  /// One-directional, and only ever these two messages.
  ///
  /// Dispatched onto the APP's web view, never the report's. The report has no
  /// way to trigger this beyond the navigation WebKit already decided to
  /// report, and no way to observe it.
  private func emitLinkTap(_ href: String) {
    dispatch("link", detail: "{ href: \(jsString(href)) }")
  }

  private func emitCrashed() {
    dispatch("crashed", detail: "{}")
  }

  private func dispatch(_ type: String, detail: String) {
    guard let app = appWebView else { return }
    app.evaluateJavaScript(
      """
      window.dispatchEvent(new CustomEvent('notesage:report', \
      { detail: Object.assign({ type: \(jsString(type)) }, \(detail)) }))
      """,
      completionHandler: nil)
  }
}

/// JSON-encode a string for embedding in evaluated JavaScript.
///
/// Not string interpolation with quotes around it: a report can put anything
/// in an href — quotes, backslashes, newlines, `</script>` — and a hand-rolled
/// escape is an injection into the APP's web view, which is the one context
/// that still holds the Tauri bridge. This is the single place report-derived
/// bytes reach the app at all, so it is the single place that has to be right.
private func jsString(_ value: String) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: [value]),
    let array = String(data: data, encoding: .utf8),
    array.count >= 2
  else {
    return "\"\""
  }
  // `["…"]` → `"…"`. JSONSerialization will not encode a bare string at the
  // top level, hence the one-element array.
  return String(array.dropFirst().dropLast())
}
