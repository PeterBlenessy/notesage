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
  /// The transparent leading-edge strip that owns the swipe-back touch.
  private var edgeStrip: UIView?
  /// The APP's web view. Held weakly and used for exactly one thing:
  /// dispatching link taps back to the web layer. Never the other direction —
  /// nothing the report contains is ever evaluated against this.
  private weak var appWebView: WKWebView?
  // Reading-progress observer state (#836) — see `observeScroll`.
  private var scrollObservation: NSKeyValueObservation?
  private var lastEmittedFraction: Double = -1
  private var lastEmitAt: TimeInterval = 0
  /// Set while `loadHTMLString`'s own navigation is in flight, so the
  /// navigation policy handler can tell it apart from a link tap. Without it
  /// the initial load cancels itself and the report never appears.
  private var isLoadingInitialDocument = false
  /// Messages for the read-aloud agent arrive from the app as soon as the
  /// report is presented — before `loadHTMLString` has produced a document
  /// for them to land in. Held until the navigation finishes, then flushed
  /// in order; the agent is in the page by then.
  private var documentReady = false
  private var pendingPosts: [String] = []

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
    observeScroll(of: view)

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
    attachEdgeBack(to: view, in: container)
    // Chrome LAST: the back button, share and search island must stay above
    // both the report and the swipe strip.
    ChromeManager.shared.bringChromeToFront()

    isLoadingInitialDocument = true
    documentReady = false
    pendingPosts = []
    // Base the document on the page it was CLIPPED FROM.
    //
    // This was `baseURL: nil` — a unique opaque origin, chosen because reports
    // were "self-contained by construction". That stopped being true when
    // captures started carrying a hero image (#828): a remote `https://` src on
    // an opaque origin cannot load, so a saved article rendered a broken-image
    // placeholder where its lead picture should be, and every inline article
    // image with it.
    //
    // The source origin is the narrowest base that fixes it. What the nil base
    // protected against is unchanged: an `https://` origin cannot reach the
    // library, `file://`, or the app's custom schemes — those need a local or
    // custom-scheme base, which this is not. It grants the document exactly the
    // origin it was captured from and nothing else.
    //
    // Read from the document rather than plumbed through the command: the
    // capture footer already records where it came from, and threading a second
    // argument through TypeScript, the Rust command, the bridge and the plugin
    // would be four more places to keep in step for a value the report is
    // already carrying. `nil` when there is no footer — a non-capture document
    // keeps exactly today's isolation.
    view.loadHTMLString(html, baseURL: Self.clippedFromURL(html))
    reportView = view
  }

  /// The page a captured article was clipped from, read out of its footer.
  ///
  /// Matches what `notesage-capture` writes:
  /// `<p class="source">Clipped from <a href="URL">`. Returns nil for anything
  /// else, so a document that is not one of our captures gets no origin at all.
  static func clippedFromURL(_ html: String) -> URL? {
    guard let marker = html.range(of: "class=\"source\">Clipped from <a href=\"") else {
      return nil
    }
    let rest = html[marker.upperBound...]
    guard let close = rest.range(of: "\"") else { return nil }
    // The footer HTML-escapes ampersands; a query string has to come back usable.
    let raw = String(rest[..<close.lowerBound]).replacingOccurrences(of: "&amp;", with: "&")
    guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https"
    else { return nil }
    return url
  }

  /// Tear the report down. Idempotent.
  func dismiss() {
    // The KVO token retains the observed scroll view — and with it the whole
    // dismissed web view and its document — until it is invalidated. Without
    // this the last report stayed alive in the singleton for the rest of the
    // session (review finding).
    scrollObservation?.invalidate()
    scrollObservation = nil
    lastEmittedFraction = -1
    dispatchPrecondition(condition: .onQueue(.main))
    guard let view = reportView else { return }
    reportView = nil
    isLoadingInitialDocument = false
    documentReady = false
    pendingPosts = []
    // Order matters: drop the delegate BEFORE stopping, or `stopLoading`
    // delivers a `didFail` into a presenter that has already moved on.
    view.navigationDelegate = nil
    view.stopLoading()
    // The view is going away, but it is only ever released once the container
    // drops it — leaving a half-dragged transform on a view that could be
    // reused reads as a report stuck off-centre.
    view.transform = .identity
    view.removeFromSuperview()
    edgeStrip?.removeFromSuperview()
    edgeStrip = nil
  }

  // MARK: - Swipe back

  /// Swipe in from the left edge to leave a report.
  ///
  /// It has to live HERE, natively, and that is the whole point of this
  /// section. The reader's own `useEdgeSwipeBack` puts a 24 pt strip over the
  /// document and works for everything the app itself renders — but a report
  /// is a separate web view sitting ABOVE the app's, so no element in the app
  /// can be under the finger. Instrumenting the strip on a presented report
  /// logged not one `pointerdown`: the gesture was not failing, it was never
  /// arriving (Peter, build 54: swipe right does not close an article).
  ///
  /// A transparent 24 pt strip laid OVER the report's leading edge, owning the
  /// touch by hit-testing, rather than a recogniser on the web view competing
  /// for it. Tried the competing way first: a
  /// `UIScreenEdgePanGestureRecognizer` on the report never fired, because
  /// WebKit's own recognisers claimed the drag and turned it into a text
  /// selection. A view that is simply in front has nothing to arbitrate — the
  /// touch begins in the strip, so UIKit delivers the whole drag there even
  /// once the finger is over the document.
  ///
  /// The cost is the one the web strip already documents (#931): a stationary
  /// tap in that 24 pt band does not reach the report. Reports carry body
  /// padding, so the band is nearly always margin, and iOS reserves its own
  /// leading edge for the interactive pop for the same reason.
  private func attachEdgeBack(to view: WKWebView, in container: UIView) {
    let strip = UIView()
    strip.backgroundColor = .clear
    strip.translatesAutoresizingMaskIntoConstraints = false
    container.insertSubview(strip, aboveSubview: view)
    NSLayoutConstraint.activate([
      strip.topAnchor.constraint(equalTo: view.topAnchor),
      strip.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      strip.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      strip.widthAnchor.constraint(equalToConstant: Self.edgeStripWidth),
    ])
    strip.addGestureRecognizer(
      UIPanGestureRecognizer(target: self, action: #selector(handleEdgeBack(_:))))
    edgeStrip = strip
  }

  /// Matches `EDGE_WIDTH` in `useEdgeSwipeBack.ts` — one gesture, one size,
  /// whichever kind of document is open.
  private static let edgeStripWidth: CGFloat = 24

  /// Travel that commits the back, in points, and the flick that does it in
  /// less. Deliberately the same numbers as `useEdgeSwipeBack`'s
  /// `COMMIT_DISTANCE` / `COMMIT_VELOCITY` (96 pt, 0.5 pt/ms = 500 pt/s): a
  /// reader should not need a different-sized gesture depending on which kind
  /// of document happens to be open.
  private static let backCommitDistance: CGFloat = 96
  private static let backCommitVelocity: CGFloat = 500

  @objc private func handleEdgeBack(_ gesture: UIPanGestureRecognizer) {
    guard let view = reportView else { return }
    let dx = max(0, gesture.translation(in: view).x)
    switch gesture.state {
    case .changed:
      // The page follows the finger, resisted past the commit point — without
      // it a swipe that does not commit gives no sign it was seen at all.
      // Same curve as the web strip's.
      let shown = dx <= Self.backCommitDistance
        ? dx
        : Self.backCommitDistance + (dx - Self.backCommitDistance) * 0.3
      view.transform = CGAffineTransform(translationX: shown, y: 0)
    case .ended:
      let fast = gesture.velocity(in: view).x >= Self.backCommitVelocity
      if dx >= Self.backCommitDistance || fast {
        // The app decides what "back" means (an unsaved draft, a folder to
        // return to), so this reports the gesture and does not dismiss itself.
        // The reader takes the report down as part of leaving, exactly as it
        // does for the back button.
        emitBack()
        return
      }
      fallthrough
    case .cancelled, .failed:
      UIView.animate(withDuration: 0.2) { view.transform = .identity }
    default:
      break
    }
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

  /// Deliver a JSON message INTO the report, as a `notesage:speech-agent`
  /// event the read-aloud agent listens for. This is the one thing evaluated
  /// in the report's context, and it only ever carries data the app produced
  /// (paragraph texts and positions) — the document still has no channel
  /// back, so the bridge-less claim in this file's header stands.
  ///
  /// `json` must be a JSON document: it is spliced in as a literal, and JSON
  /// is a subset of a JS expression, so a title with quotes or a U+2028 in
  /// an article cannot break out of it.
  @discardableResult
  func post(_ json: String) -> Bool {
    dispatchPrecondition(condition: .onQueue(.main))
    guard reportView != nil,
      let data = json.data(using: .utf8),
      (try? JSONSerialization.jsonObject(with: data)) != nil
    else { return false }
    if !documentReady {
      pendingPosts.append(json)
      return true
    }
    deliver(json)
    return true
  }

  private func deliver(_ json: String) {
    reportView?.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('notesage:speech-agent',{detail:\(json)}))",
      completionHandler: nil)
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

    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }

    // In-document anchors are navigation the report SHOULD do — a table of
    // contents in a long report is the common case — so let WebKit scroll
    // rather than handing the fragment to the app as if it were an outbound
    // link.
    //
    // Detected by comparing against the document's OWN url, because
    // `request.url` is the RESOLVED absolute url, never the raw `href`. The
    // first version of this tested `url.scheme == nil || hasPrefix("#")`,
    // which describes the href in the markup and nothing that ever arrives
    // here: `loadHTMLString(baseURL: nil)` bases the document on
    // `about:blank`, so `href="#top"` reaches this method as
    // `about:blank#top` — scheme "about", no leading "#". Every anchor
    // therefore missed this branch and was emitted as an outbound link, which
    // the app could resolve as neither a remote url nor a library path, so a
    // tap did nothing at all.
    if url.fragment != nil, isSameDocument(url, as: webView.url) {
      // `.allow`, not a scripted `location.hash`: WebKit performs
      // same-document navigation natively, including the scroll and the
      // back-forward entry, and it cannot leave the document.
      decisionHandler(.allow)
      return
    }

    decisionHandler(.cancel)
    emitLinkTap(url.absoluteString)
  }

  /// Same document, ignoring the fragment.
  ///
  /// Compared as components rather than by string prefix so that
  /// `about:blank` vs `about:blank#a` resolves correctly and a url that merely
  /// STARTS with the document's url (a sibling path sharing a prefix) does
  /// not read as the same document.
  private func isSameDocument(_ url: URL, as current: URL?) -> Bool {
    guard let current,
      var a = URLComponents(url: url, resolvingAgainstBaseURL: false),
      var b = URLComponents(url: current, resolvingAgainstBaseURL: false)
    else { return false }
    a.fragment = nil
    b.fragment = nil
    return a.url == b.url
  }

  /// Reveal once the document has painted.
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    isLoadingInitialDocument = false
    UIView.animate(withDuration: 0.15) { webView.alpha = 1 }
    flushPosts()
  }

  func webView(
    _ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error
  ) {
    // Show it anyway. A partially rendered report beats a blank pane, and the
    // failure modes here are sub-resource errors on a document that is already
    // self-contained.
    webView.alpha = 1
    flushPosts()
  }

  /// The document is on screen: deliver what the app sent while it loaded.
  private func flushPosts() {
    documentReady = true
    let queued = pendingPosts
    pendingPosts = []
    for json in queued { deliver(json) }
  }

  /// A report is untrusted content in its own process, so it can be killed
  /// independently of the app. Say so rather than leaving a blank rectangle
  /// the user cannot distinguish from an empty document.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    dismiss()
    emitCrashed()
  }

  // MARK: - Events to the web layer

  /// One-directional, and only ever these messages.
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

  /// The left-edge swipe finished far enough to mean "leave this document".
  private func emitBack() {
    dispatch("back", detail: "{}")
  }

  /// Reading progress (#836): how far down the report the user has scrolled,
  /// 0…1, throttled — a list row shows "2 of 4 min left" from it. The report
  /// cannot observe or trigger this; it is read off the scroll view we own.

  func observeScroll(of webView: WKWebView) {
    scrollObservation = webView.scrollView.observe(\.contentOffset, options: [.new]) { [weak self] sv, _ in
      guard let self else { return }
      // The scrollable range runs from -insetTop to (contentHeight - bounds +
      // insetBottom); both insets belong in the denominator or the fraction
      // reaches 1.0 before the true bottom and marks an article read with
      // content still on screen (review finding).
      let insets = sv.adjustedContentInset
      let span = sv.contentSize.height - sv.bounds.height + insets.top + insets.bottom
      guard span > 1 else { return }
      let fraction = min(1, max(0, (sv.contentOffset.y + insets.top) / span))
      let now = Date().timeIntervalSince1970
      // Coalesce: one message per ~300 ms unless the change is large. A scroll
      // is hundreds of offsets a second and each dispatch is a JS evaluation
      // on the app's web view.
      if abs(fraction - self.lastEmittedFraction) < 0.02 && now - self.lastEmitAt < 0.3 { return }
      self.lastEmittedFraction = fraction
      self.lastEmitAt = now
      self.dispatch("scroll", detail: "{ fraction: \(String(format: "%.3f", fraction)) }")
    }
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
