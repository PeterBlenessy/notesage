import Foundation
import QuickLook
import Tauri
import UIKit
import WebKit

// MARK: - Argument types (decoded from the invoke payload)

struct SpeechStartArgs: Decodable {
  let text: String
  let title: String
  let startIndex: Int
  let rate: Float
  /// The user's own voice picks, keyed by language subtag ("en" -> id).
  let voiceByLanguage: [String: String]
  /// The article's lead image (JPEG/PNG, base64) for the lock-screen player.
  let artworkBase64: String?
}

struct SpeechVoicesArgs: Decodable {
  let language: String
}

struct SpeechVoiceArgs: Decodable {
  let voiceId: String
}

struct SpeechSkipArgs: Decodable {
  let delta: Int
}

struct SpeechRateArgs: Decodable {
  let rate: Float
}

struct RelPathArgs: Decodable {
  let relPath: String
}

struct WriteFileArgs: Decodable {
  let relPath: String
  let text: String
}

struct RenameArgs: Decodable {
  let relPath: String
  let newName: String
}

struct MoveArgs: Decodable {
  let relPath: String
  /// Destination DIRECTORY, relative to the library root. `""` is the root.
  let destDir: String
}

struct ThumbnailArgs: Decodable {
  let relPath: String
  let maxPixel: Double
}

/// An exported HTML report to show in its own web view (#606, ADR 0010).
///
/// The document travels as a STRING rather than a rel path: the reader has
/// already read and size-checked the file, and handing the native layer a path
/// would give the report webview a reason to touch the library — which is
/// exactly the reach this change removes.
struct PresentReportArgs: Decodable {
  let html: String
  /// The reader's measured safe-area padding, in points. Applied as a scroll
  /// content inset rather than injected into the report's markup.
  let insetTop: Double?
  let insetBottom: Double?
}

struct InlineImagesArgs: Decodable {
  let urls: [String]
  let maxPixel: UInt32
  let jpegQuality: Double
}

struct TextPromptArgs: Decodable {
  let title: String
  let placeholder: String
  let confirmLabel: String
  /// Pre-filled, editable text (rename starts from the current name).
  let value: String?
  /// Select only the filename stem, so typing replaces the name but keeps
  /// the extension — what Files and Finder do.
  let selectStem: Bool?
  /// Supplied by the frontend, which owns the translation table (#705).
  /// Optional so an older frontend keeps working — English is the fallback.
  let cancelLabel: String?
}

struct ContextMenuItemSpec: Decodable {
  let id: String
  let title: String
  /// Rendered in red and sunk to the bottom of the sheet, per iOS.
  let destructive: Bool?
}

struct ContextMenuArgs: Decodable {
  /// Shown as the sheet's title — the file being acted on.
  let title: String?
  let items: [ContextMenuItemSpec]
  /// Where the long press happened, in webview (CSS pixel) coordinates.
  /// Only used to anchor the popover on iPad; iPhone sheets come up from
  /// the bottom edge regardless.
  let x: Double?
  let y: Double?
  /// Supplied by the frontend, which owns the translation table (#705).
  /// Optional so an older frontend keeps working — English is the fallback.
  let cancelLabel: String?
}

// MARK: - Keyboard accessory removal

/// WKWebView shows its own accessory bar (form prev/next arrows + Done) above
/// the keyboard for any focused web input — duplicating the app's chrome
/// (e.g. the search island's own match-navigation arrows). The app's inputs
/// are chrome, not a web form; strip the bar with the standard trick: swap
/// the WKContent view's class for a dynamic subclass whose
/// `inputAccessoryView` returns nil. Idempotent.
private enum KeyboardAccessory {
  static func remove(from webView: WKWebView) {
    guard
      let target = webView.scrollView.subviews.first(where: {
        String(describing: type(of: $0)).hasPrefix("WKContent")
      }),
      let targetClass = object_getClass(target)
    else { return }
    let subclassName = "\(targetClass)_NoInputAccessory"
    if let existing = NSClassFromString(subclassName) {
      object_setClass(target, existing)
      return
    }
    guard let subclass = objc_allocateClassPair(targetClass, subclassName, 0) else { return }
    let selector = #selector(getter: UIResponder.inputAccessoryView)
    let block: @convention(block) (AnyObject) -> UIView? = { _ in nil }
    class_addMethod(subclass, selector, imp_implementationWithBlock(block), "@@:")
    objc_registerClassPair(subclass)
    object_setClass(target, subclass)
  }

  /// Find the app's WKWebView in the key window's hierarchy.
  static func findWebView(in view: UIView) -> WKWebView? {
    if let webView = view as? WKWebView { return webView }
    for sub in view.subviews {
      if let found = findWebView(in: sub) { return found }
    }
    return nil
  }
}

// MARK: - WebContent-process crash recovery

/// iOS kills the WKWebView's WebContent process under memory pressure (large
/// files, background eviction — see #616). Without a handler the app stays a
/// permanently BLANK screen: the native shell is alive but the page is gone,
/// and Apple's crash reporting never sees it (the app process didn't crash).
/// `webViewWebContentProcessDidTerminate` is the delegate hook for exactly
/// this — reload restores the page (#587).
///
/// Tauri/wry owns the navigation delegate, so the handler is injected into
/// the EXISTING delegate's class via the objc runtime (the same trick
/// `KeyboardAccessory` uses): added when the delegate doesn't implement the
/// selector; left alone when it does (upstream handling wins). Idempotent —
/// `class_addMethod` fails harmlessly on the second call.
private enum ContentProcessRecovery {
  static func install(on webView: WKWebView) {
    guard let delegate = webView.navigationDelegate,
      let cls = object_getClass(delegate)
    else { return }
    let selector = #selector(WKNavigationDelegate.webViewWebContentProcessDidTerminate(_:))
    guard !delegate.responds(to: selector) else { return }
    let block: @convention(block) (AnyObject, WKWebView) -> Void = { _, wv in
      NSLog("[notesage] WebContent process terminated — reloading webview")
      wv.reload()
    }
    class_addMethod(cls, selector, imp_implementationWithBlock(block), "v@:@")
  }
}

// MARK: - QuickLook

/// Presents the system QuickLook viewer over a TEMP COPY of a library file
/// (#587 follow-up: videos, audio, DOCX/PPTX/EPUB and friends get the native
/// player/preview instead of an "unsupported" card). The temp copy exists
/// because QuickLook renders out-of-process and cannot read through our
/// security-scoped grant; its per-invocation directory is deleted on dismiss.
private final class QuickLookPresenter: NSObject, QLPreviewControllerDataSource,
  QLPreviewControllerDelegate
{
  /// Retained while presented — QLPreviewController holds its dataSource weakly.
  static var current: QuickLookPresenter?
  private let url: URL
  init(url: URL) { self.url = url }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int)
    -> QLPreviewItem
  {
    url as NSURL
  }
  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    QuickLookPresenter.current = nil
  }
}

// MARK: - Plugin

/// Bridges the mobile reader's library access to iOS.
///
/// Every `relPath` arriving here has already been sanitized by the Rust layer
/// (`ios_library::sanitize_rel_path` rejects absolute paths and `..`), so this
/// side resolves them against the bookmarked root without re-validating.
///
/// Deliberately read-only: there is no capture method here. The Share
/// Extension writes captures in its own process, so exposing a write on the
/// app's plugin would widen its surface for something the app never does.
class NotesageIosPlugin: Plugin {
  /// Runs at webview creation, BEFORE the first composite. Without this the
  /// webview paints its default opaque WHITE canvas for a few frames until
  /// the document parses — a severe white flash on every cold start in dark
  /// mode (the inline `<style>` in index.html cannot help; it only applies
  /// once HTML is parsed). Non-opaque + systemBackground makes those first
  /// frames match the OS theme, so launch-screen → app is seamless.
  /// Kill the white launch flash (#675).
  ///
  /// WKWebView paints WHITE until its document's first paint, in dark mode
  /// too — the well-known iOS behaviour behind every "Tauri flashes white on
  /// startup" report. Making the webview non-opaque with a themed background
  /// is only HALF the fix: a transparent webview reveals whatever is behind
  /// it, and Tauri's container view and the UIWindow are themselves white by
  /// default, so the flash simply moves one layer down (measured: a pure
  /// white frame right after the launch screen).
  ///
  /// So theme the whole stack — webview, its superview chain, and the window
  /// — and re-apply on the next runloop turn because the view hierarchy is
  /// not fully assembled when the plugin loads.
  @objc public override func load(webview: WKWebView) {
    applyLaunchBackground(to: webview)
    DispatchQueue.main.async { [weak webview] in
      guard let webview else { return }
      self.applyLaunchBackground(to: webview)
      self.installLaunchCover(over: webview)
    }
  }

  /// Called by the frontend once it has painted its first frame.
  @objc public func contentReady(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.removeLaunchCover()
      invoke.resolve()
    }
  }

  /// Opaque cover held over the webview until the page has actually painted
  /// (#675, round 2).
  ///
  /// Round 1 themed every native layer AND the document's pre-paint CSS, and
  /// still flashed on device: WKWebView paints WHITE for its own first frames
  /// no matter what the layers beneath say, and the gap is ~20–100 ms — short
  /// enough that polling `simctl io screenshot` missed it, which is why the
  /// earlier verification looked clean. (Lesson: verify a flash with VIDEO.)
  ///
  /// This is the iOS equivalent of the desktop trick of starting the window
  /// hidden and showing it when the frontend is ready: the window can't be
  /// hidden on iOS, so instead a plain `systemBackground` view — visually
  /// identical to the launch storyboard — sits ON TOP until the frontend
  /// signals first paint, making the launch screen appear to continue
  /// seamlessly into the app.
  private var launchCover: UIView?
  private var launchCoverLogo: UIImageView?
  private var launchCoverRemoved = false

  private func installLaunchCover(over webview: WKWebView) {
    guard !launchCoverRemoved, launchCover == nil,
      let window = webview.window ?? UIApplication.shared.connectedScenes
        .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first
    else { return }
    let cover = UIView(frame: window.bounds)
    cover.backgroundColor = .systemBackground
    cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // Never intercept touches: even if something goes wrong and the cover
    // outlives its welcome, the app stays usable underneath.
    cover.isUserInteractionEnabled = false
    // Same 120pt rounded app icon, in the same place, as LaunchScreen.storyboard
    // — so the handoff from launch screen to cover is invisible and the icon
    // simply stays put while the webview loads behind it.
    if let logo = UIImage(named: "LaunchLogo") {
      let view = UIImageView(image: logo)
      view.contentMode = .scaleAspectFit
      view.layer.cornerRadius = 27
      view.layer.cornerCurve = .continuous
      view.clipsToBounds = true
      view.translatesAutoresizingMaskIntoConstraints = false
      cover.addSubview(view)
      NSLayoutConstraint.activate([
        view.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
        view.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
        view.widthAnchor.constraint(equalToConstant: 120),
        view.heightAnchor.constraint(equalToConstant: 120),
      ])
      launchCoverLogo = view
    }
    window.addSubview(cover)
    launchCover = cover
    // Safety net: a frontend that never signals (crash, JS error) must not
    // leave a blank screen. 4 s is far beyond a normal cold start.
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
      self?.removeLaunchCover()
    }
  }

  /// Fade the cover out once content is on screen. Idempotent.
  ///
  /// The icon scales up a touch as it fades, which reads as the app icon
  /// opening INTO the UI rather than a plate being yanked off it — the same
  /// gesture iOS itself uses when an app launches from the Home Screen. The
  /// cover fades slightly faster than the icon so the loaded UI is already
  /// there behind the last frames of the icon.
  func removeLaunchCover() {
    launchCoverRemoved = true
    guard let cover = launchCover else { return }
    launchCover = nil
    let logo = launchCoverLogo
    launchCoverLogo = nil
    UIView.animate(
      withDuration: 0.34, delay: 0, options: [.curveEaseOut],
      animations: {
        logo?.transform = CGAffineTransform(scaleX: 1.35, y: 1.35)
        logo?.alpha = 0
      })
    UIView.animate(
      withDuration: 0.26, delay: 0.04, options: [.curveEaseOut],
      animations: { cover.backgroundColor = cover.backgroundColor?.withAlphaComponent(0) },
      completion: { _ in cover.removeFromSuperview() })
  }

  private func applyLaunchBackground(to webview: WKWebView) {
    webview.isOpaque = false
    webview.backgroundColor = .systemBackground
    webview.scrollView.backgroundColor = .systemBackground
    webview.underPageBackgroundColor = .systemBackground
    // Everything the transparent webview can reveal.
    var view: UIView? = webview.superview
    while let current = view {
      current.backgroundColor = .systemBackground
      view = current.superview
    }
    webview.window?.backgroundColor = .systemBackground
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      for window in windowScene.windows {
        window.backgroundColor = .systemBackground
        window.rootViewController?.view.backgroundColor = .systemBackground
      }
    }
  }

  private var keyboardObserversInstalled = false
  private var keyboardObserverTokens: [NSObjectProtocol] = []
  private var accessibilityObserversInstalled = false
  private var accessibilityObserverTokens: [NSObjectProtocol] = []
  private weak var webViewRef: WKWebView?

  private var topViewController: UIViewController? {
    UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.keyWindow }
      .first?.rootViewController
  }

  /// One-time webview de-webbing, hooked off the first grant resolution
  /// (which the app performs at every mount): strip the keyboard accessory
  /// bar so web-input focus doesn't grow duplicate chrome, and forward
  /// keyboard frame changes to the page. The page CANNOT see the keyboard
  /// itself: in WKWebView neither `window.innerHeight` nor `visualViewport`
  /// reacts to it (verified empirically — zero events, height unchanged), so
  /// bottom-anchored chrome would sit behind the keyboard without this bridge.
  private func configureWebViewOnce() {
    // Re-runs (cheaply) whenever the weak ref has gone nil — WebKit can
    // recreate the content view after a WebContent-process reset, and a
    // one-shot bind would silently kill keyboard forwarding forever.
    guard webViewRef == nil || !keyboardObserversInstalled else { return }
    DispatchQueue.main.async { [weak self] in
      _ = self?.resolveWebView()
      self?.installKeyboardObservers()
      self?.installAccessibilityObservers()
    }
  }

  /// Find (or re-find) the app's webview; idempotently strip its accessory
  /// bar on every (re)bind. Main thread only.
  private func resolveWebView() -> WKWebView? {
    if let live = webViewRef { return live }
    guard
      let window = UIApplication.shared.connectedScenes
        .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first,
      let webView = KeyboardAccessory.findWebView(in: window)
    else { return nil }
    webViewRef = webView
    KeyboardAccessory.remove(from: webView)
    ContentProcessRecovery.install(on: webView)
    return webView
  }

  /// Dispatch a `notesage:keyboard` CustomEvent with the keyboard's overlap
  /// of the webview (in CSS pt) whenever the keyboard frame changes.
  private func installKeyboardObservers() {
    guard !keyboardObserversInstalled else { return }
    keyboardObserversInstalled = true
    let center = NotificationCenter.default
    let forward: (Notification) -> Void = { [weak self] note in
      // Re-resolve on every event: the weak ref survives normal use but goes
      // nil if WebKit recreates the webview — re-binding here restores both
      // the forwarding and the accessory removal.
      guard let webView = self?.resolveWebView() else { return }
      var inset: CGFloat = 0
      if let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?
        .cgRectValue
      {
        let local = webView.convert(frame, from: nil)
        let overlap = webView.bounds.maxY - local.minY
        if overlap.isFinite { inset = max(0, overlap) }
      }
      if note.name == UIResponder.keyboardWillHideNotification { inset = 0 }
      webView.evaluateJavaScript(
        "window.dispatchEvent(new CustomEvent('notesage:keyboard',{detail:{inset:\(Int(inset.rounded()))}}))"
      )
    }
    for name in [
      UIResponder.keyboardWillShowNotification,
      UIResponder.keyboardWillChangeFrameNotification,
      UIResponder.keyboardWillHideNotification,
    ] {
      keyboardObserverTokens.append(
        center.addObserver(forName: name, object: nil, queue: .main, using: forward))
    }
  }

  /// Current Dynamic Type scale as a multiplier around 1.0 (1 = the default
  /// "Large" content size category). `UIFont.preferredFont(forTextStyle:
  /// .body)` already reflects the user's chosen size category, so its point
  /// size relative to the 17pt default gives the scale the web layer needs —
  /// no manual category-to-multiplier table to keep in sync with iOS.
  private func currentA11yScale() -> CGFloat {
    UIFont.preferredFont(forTextStyle: .body).pointSize / 17.0
  }

  /// Dispatch a `notesage:a11y` CustomEvent with the current Dynamic Type
  /// scale and Bold Text state — the folder-view surfaces (Chrome, FileRow,
  /// LibraryBrowser, Onboarding) consume this to scale/weight their own
  /// text. Document/reader content does not listen for this event.
  private func emitA11yPrefs(to webView: WKWebView) {
    let scale = currentA11yScale()
    let bold = UIAccessibility.isBoldTextEnabled
    webView.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('notesage:a11y',{detail:{scale:\(scale),bold:\(bold)}}))"
    )
  }

  /// Observe Dynamic Type and Bold Text changes and re-emit `notesage:a11y`
  /// whenever either flips — plus once immediately on install, so the web
  /// layer isn't stuck at defaults until the user changes a setting.
  private func installAccessibilityObservers() {
    guard !accessibilityObserversInstalled else { return }
    accessibilityObserversInstalled = true
    let center = NotificationCenter.default
    let forward: (Notification) -> Void = { [weak self] _ in
      guard let webView = self?.resolveWebView() else { return }
      self?.emitA11yPrefs(to: webView)
    }
    for name in [
      UIContentSizeCategory.didChangeNotification,
      UIAccessibility.boldTextStatusDidChangeNotification,
    ] {
      accessibilityObserverTokens.append(
        center.addObserver(forName: name, object: nil, queue: .main, using: forward))
    }
    if let webView = resolveWebView() {
      emitA11yPrefs(to: webView)
    }
  }

  deinit {
    for token in keyboardObserverTokens {
      NotificationCenter.default.removeObserver(token)
    }
    for token in accessibilityObserverTokens {
      NotificationCenter.default.removeObserver(token)
    }
  }

  @objc public func pickLibraryFolder(_ invoke: Invoke) {
    DispatchQueue.main.async {
      guard let presenter = self.topViewController else {
        invoke.reject("No view controller to present the folder picker")
        return
      }
      LibraryAccess.pickLibraryFolder(presenter: presenter) { result in
        switch result {
        case .success(let grant):
          invoke.resolve(["displayName": grant.displayName, "granted": grant.granted])
        case .failure(let error):
          invoke.reject(error.localizedDescription)
        }
      }
    }
  }

  @objc public func getLibraryGrant(_ invoke: Invoke) {
    configureWebViewOnce()
    let g = LibraryAccess.getLibraryGrant()
    invoke.resolve(["displayName": g.displayName, "granted": g.granted])
  }

  @objc public func clearLibraryGrant(_ invoke: Invoke) {
    LibraryAccess.clearLibraryGrant()
    invoke.resolve()
  }


  // MARK: - Speech player (#833)
  //
  // The player itself is a singleton (`SpeechPlayer.shared`) rather than
  // per-invoke state: AVAudioSession, the remote-command centre and the
  // now-playing info centre are all process-wide, and a second synthesiser
  // would fight the first for the same audio route.

  @objc public func speechStart(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SpeechStartArgs.self)
      // Language detection is up to 60 recogniser passes on a long article —
      // done here, off the main thread, so Listen never hitches the UI
      // (review finding); the player itself is driven on main below.
      DispatchQueue.global(qos: .userInitiated).async {
        let language = SpeechPlayer.detectLanguage(args.text)
        DispatchQueue.main.async {
        // Wire the callbacks before starting, so the very first paragraph
        // reports its position too.
        SpeechPlayer.shared.onProgress = { [weak self] index, total in
          self?.emitSpeech(["event": "progress", "index": index, "total": total])
        }
        // Play/pause can originate from the LOCK SCREEN, which never touches
        // the frontend — without this the transport shows the wrong icon.
        SpeechPlayer.shared.onPlayingChanged = { [weak self] playing in
          self?.emitSpeech(["event": "playing", "playing": playing])
        }
        SpeechPlayer.shared.onFinished = { [weak self] in
          self?.emitSpeech(["event": "finished"])
        }
        // Decoded here, off the hot path's main-thread work: a thumbnail is
        // small, but decoding is still not something to do between tap and
        // first audio for no reason.
        let artwork = args.artworkBase64
          .flatMap { Data(base64Encoded: $0) }
          .flatMap { UIImage(data: $0) }
        SpeechPlayer.shared.start(
          text: args.text, title: args.title, startIndex: args.startIndex,
          rate: args.rate, voiceByLanguage: args.voiceByLanguage, language: language,
          artwork: artwork)
        // Resolved from INSIDE the dispatch: resolving before the work runs
        // meant a native failure could never reach the JS `.catch`. The
        // detected language comes back so the voice picker knows what to list.
        // Passed as the plain optional — JsonObject's values are `Any?`, so no
        // `as Any` boxing of an Optional (a known footgun) is needed.
        invoke.resolve(["language": language])
        }
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func speechPause(_ invoke: Invoke) {
    DispatchQueue.main.async {
      SpeechPlayer.shared.pause()
      invoke.resolve()
    }
  }

  @objc public func speechResume(_ invoke: Invoke) {
    DispatchQueue.main.async {
      SpeechPlayer.shared.resume()
      invoke.resolve()
    }
  }

  @objc public func speechStop(_ invoke: Invoke) {
    DispatchQueue.main.async {
      SpeechPlayer.shared.stop()
      invoke.resolve()
    }
  }

  @objc public func speechSkip(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SpeechSkipArgs.self)
      DispatchQueue.main.async {
        SpeechPlayer.shared.skip(args.delta)
        invoke.resolve()
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func speechSetRate(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SpeechRateArgs.self)
      DispatchQueue.main.async {
        SpeechPlayer.shared.setRate(args.rate)
        invoke.resolve()
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  /// Installed voices for a language, best first — what the picker lists.
  @objc public func speechVoices(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SpeechVoicesArgs.self)
      DispatchQueue.main.async {
        invoke.resolve(["voices": SpeechPlayer.voices(forLanguageCode: args.language)])
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  /// Switch voice mid-article; the current paragraph is re-spoken.
  @objc public func speechSetVoice(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SpeechVoiceArgs.self)
      DispatchQueue.main.async {
        SpeechPlayer.shared.setVoice(identifier: args.voiceId)
        invoke.resolve()
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func speechState(_ invoke: Invoke) {
    // Read on main: the synthesiser's `isSpeaking`/`isPaused` are UIKit-thread
    // state, and the player mutates its index from the delegate on main.
    DispatchQueue.main.async {
      invoke.resolve([
        "index": SpeechPlayer.shared.currentIndex,
        "total": SpeechPlayer.shared.paragraphCount,
        "playing": SpeechPlayer.shared.isPlaying,
      ])
    }
  }

  /// Same bridge shape as the chrome overlay's `emit` — JSON-serialised so a
  /// title with quotes or emoji cannot break out of the JS string literal.
  private func emitSpeech(_ detail: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: detail),
      let json = String(data: data, encoding: .utf8)
    else { return }
    webViewRef?.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('notesage:speech',{detail:\(json)}))"
    )
  }

  @objc public func listDirectory(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      invoke.resolve(["entries": try LibraryAccess.listDirectory(args.relPath)])
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func readFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      invoke.resolve(["text": try LibraryAccess.readFile(args.relPath)])
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func readBinary(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      // Base64, not [UInt8]: a byte array crosses two JSON hops (Swift→Rust,
      // Rust→JS) as one number per byte — a 10 MB PDF becomes ~40 MB of JSON
      // parsed on the WebView main thread (seconds of frozen UI). Base64 is a
      // single contiguous string; the JS side decodes it natively.
      invoke.resolve(["base64": try LibraryAccess.readBinary(args.relPath).base64EncodedString()])
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func writeFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(WriteFileArgs.self)
      try LibraryAccess.writeFile(args.relPath, text: args.text)
      invoke.resolve()
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func createFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(WriteFileArgs.self)
      invoke.resolve(["relPath": try LibraryAccess.createFile(args.relPath, text: args.text)])
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func createDirectory(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      invoke.resolve(["relPath": try LibraryAccess.createDirectory(args.relPath)])
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func thumbnailFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(ThumbnailArgs.self)
      LibraryAccess.thumbnail(args.relPath, maxPixel: CGFloat(args.maxPixel)) { result in
        switch result {
        case .success(let data):
          invoke.resolve(["base64": data.base64EncodedString()])
        case .failure(let error):
          invoke.reject(String(describing: error))
        }
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  /// Fetch, downsample and encode article images so a captured article becomes
  /// self-contained. Asynchronous by design — `ImageInliner` runs on a
  /// `.utility` queue, so the main thread is never blocked and the OS
  /// deprioritises the work while the user is interacting.
  ///
  /// Never rejects on a failed image. One that was too large, too slow, or
  /// 404'd is simply absent from the result and keeps its remote URL in the
  /// rewritten document — a partial article is a working article.
  @objc public func inlineImages(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(InlineImagesArgs.self)
      var limits = ImageInliner.Limits()
      limits.maxPixel = Int(args.maxPixel)
      limits.jpegQuality = CGFloat(args.jpegQuality)

      ImageInliner.inline(urls: args.urls, limits: limits) { pairs in
        invoke.resolve([
          "images": pairs.map { ["url": $0.0, "dataUri": $0.1] }
        ])
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func quickLook(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      let fileURL = try LibraryAccess.copyForSharing(args.relPath)
      DispatchQueue.main.async {
        guard let presenter = self.topViewController else {
          try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
          invoke.reject("No view controller to present the preview")
          return
        }
        guard presenter.presentedViewController == nil else {
          try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
          invoke.reject("Another sheet is already open")
          return
        }
        let holder = QuickLookPresenter(url: fileURL)
        QuickLookPresenter.current = holder
        let controller = QLPreviewController()
        controller.dataSource = holder
        controller.delegate = holder
        presenter.present(controller, animated: true)
        invoke.resolve()
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func deleteFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      try LibraryAccess.deleteFile(args.relPath)
      invoke.resolve()
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func renameFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RenameArgs.self)
      invoke.resolve(["relPath": try LibraryAccess.renameFile(args.relPath, to: args.newName)])
    } catch { invoke.reject(String(describing: error)) }
  }

  /// Move a file into another folder under the library root (#754). Files
  /// only; the destination must already exist.
  @objc public func moveFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(MoveArgs.self)
      invoke.resolve([
        "relPath": try LibraryAccess.moveFile(args.relPath, toDirectory: args.destDir)
      ])
    } catch { invoke.reject(String(describing: error)) }
  }

  /// Native single-line text prompt (UIAlertController with a text field) —
  /// the name-entry popover for the create flow (#586). Resolves
  /// `{ text: "<entered>" }` on confirm, `{}` on cancel; the confirm button
  /// stays disabled while the field is empty.
  @objc public func textPrompt(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(TextPromptArgs.self)
      DispatchQueue.main.async {
        guard let presenter = self.topViewController else {
          invoke.reject("No view controller to present the prompt")
          return
        }
        guard presenter.presentedViewController == nil else {
          invoke.reject("Another sheet is already open")
          return
        }
        let alert = UIAlertController(title: args.title, message: nil, preferredStyle: .alert)
        // The change observer must be removed on either exit, and the confirm
        // closure must capture the alert weakly — an alert retains its
        // actions, so a strong capture is a retain cycle that leaks the whole
        // controller on every prompt.
        var observer: NSObjectProtocol?
        let removeObserver = {
          if let o = observer { NotificationCenter.default.removeObserver(o) }
          observer = nil
        }
        let confirm = UIAlertAction(title: args.confirmLabel, style: .default) { [weak alert] _ in
          removeObserver()
          invoke.resolve(["text": alert?.textFields?.first?.text ?? ""])
        }
        // A pre-filled field is already valid; an empty one is not.
        confirm.isEnabled = !(args.value ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        alert.addTextField { field in
          field.placeholder = args.placeholder
          field.text = args.value
          field.autocapitalizationType = .sentences
          field.clearButtonMode = .whileEditing
          // Enable the confirm action only once there is real input.
          observer = NotificationCenter.default.addObserver(
            forName: UITextField.textDidChangeNotification, object: field, queue: .main
          ) { [weak field] _ in
            confirm.isEnabled = !(field?.text ?? "")
              .trimmingCharacters(in: .whitespaces).isEmpty
          }
        }
        alert.addAction(UIAlertAction(title: args.cancelLabel ?? "Cancel", style: .cancel) { _ in
          removeObserver()
          invoke.resolve([:] as [String: String])
        })
        alert.addAction(confirm)
        presenter.present(alert, animated: true) {
          // Preselect the stem AFTER presentation — before it, the field has
          // no window and `selectedTextRange` is ignored.
          guard args.selectStem == true, let field = alert.textFields?.first,
            let text = field.text, let dot = text.lastIndex(of: "."), dot != text.startIndex,
            let start = field.position(from: field.beginningOfDocument, offset: 0),
            let end = field.position(
              from: field.beginningOfDocument,
              offset: text.distance(from: text.startIndex, to: dot))
          else { return }
          field.selectedTextRange = field.textRange(from: start, to: end)
        }
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  /// Create a directory at an exact relative path if it doesn't exist yet
  /// (no dedupe) — used for `.notesage/` before writing the shared pins file.
  @objc public func ensureDirectory(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      try LibraryAccess.ensureDirectory(args.relPath)
      invoke.resolve()
    } catch { invoke.reject(String(describing: error)) }
  }

  /// Long-press preview + action menu for a library item (#680) — the Apple
  /// Notes shape: a preview card over a blurred backdrop with the actions
  /// beneath it. See EntryContextMenu.swift for why this is hand-built.
  @objc public func entryMenu(_ invoke: Invoke) {
    do {
      let spec = try invoke.parseArgs(EntryMenuSpec.self)
      DispatchQueue.main.async {
        guard let presenter = self.topViewController else {
          invoke.reject("No view controller to present the menu")
          return
        }
        guard presenter.presentedViewController == nil else {
          invoke.reject("Another sheet is already open")
          return
        }
        EntryContextMenu.present(spec, over: presenter) { id in
          if let id {
            invoke.resolve(["id": id])
          } else {
            invoke.resolve([:] as [String: String])
          }
        }
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  /// Native action sheet for a long-pressed list/gallery item (#680).
  ///
  /// A `UIAlertController(.actionSheet)` rather than a `UIMenu`: a real
  /// context menu needs a `UIContextMenuInteraction` bound to the pressed
  /// VIEW, and the item here is web content — there is no native view to
  /// attach to, and UIKit exposes no way to raise a `UIMenu` at a point.
  /// The action sheet is the standard iOS fallback for exactly this case,
  /// and unlike `UIMenu` it needs no private KVC to carry icons (it simply
  /// has none), so it stays App Store safe.
  ///
  /// Resolves `{ id: "<chosen>" }`, or `{}` when the user cancels.
  @objc public func contextMenu(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(ContextMenuArgs.self)
      DispatchQueue.main.async {
        guard let presenter = self.topViewController else {
          invoke.reject("No view controller to present the menu")
          return
        }
        guard presenter.presentedViewController == nil else {
          invoke.reject("Another sheet is already open")
          return
        }
        let sheet = UIAlertController(
          title: args.title, message: nil, preferredStyle: .actionSheet)
        for item in args.items where item.destructive != true {
          sheet.addAction(
            UIAlertAction(title: item.title, style: .default) { _ in
              invoke.resolve(["id": item.id])
            })
        }
        // Destructive actions last — iOS never puts one above a plain action.
        for item in args.items where item.destructive == true {
          sheet.addAction(
            UIAlertAction(title: item.title, style: .destructive) { _ in
              invoke.resolve(["id": item.id])
            })
        }
        sheet.addAction(
          UIAlertAction(title: args.cancelLabel ?? "Cancel", style: .cancel) { _ in
            invoke.resolve([:] as [String: String])
          })
        // iPad presents an action sheet as a popover and CRASHES without an
        // anchor. Point it at the pressed spot in the webview.
        if let popover = sheet.popoverPresentationController {
          let source = self.webViewRef ?? presenter.view
          popover.sourceView = source
          popover.sourceRect = CGRect(
            x: args.x ?? (source?.bounds.midX ?? 0),
            y: args.y ?? (source?.bounds.midY ?? 0), width: 1, height: 1)
          popover.permittedArrowDirections = [.up, .down]
        }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        presenter.present(sheet, animated: true)
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func setChrome(_ invoke: Invoke) {
    do {
      let spec = try invoke.parseArgs(ChromeSpec.self)
      DispatchQueue.main.async {
        guard let webView = self.resolveWebView() else {
          invoke.reject("No webview to attach chrome to")
          return
        }
        ChromeManager.shared.apply(spec, over: webView)
        invoke.resolve()
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  /// Show an exported HTML report in its own bridge-less web view (#606).
  ///
  /// See `ReportWebView.swift` for why a second web view rather than the
  /// sandboxed `htmlpreview://` iframe it replaces.
  @objc public func presentReport(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(PresentReportArgs.self)
      DispatchQueue.main.async {
        guard let webView = self.resolveWebView() else {
          invoke.reject("No webview to present a report over")
          return
        }
        ReportPresenter.shared.present(
          html: args.html, over: webView,
          insetTop: CGFloat(args.insetTop ?? 0),
          insetBottom: CGFloat(args.insetBottom ?? 0),
          // A WKWebView paints its OWN background before the document's, so
          // leaving this default white reintroduces the dark-report white
          // flash by a different route than the iframe's opaque backing did.
          backgroundColor: .systemBackground)
        invoke.resolve()
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func dismissReport(_ invoke: Invoke) {
    DispatchQueue.main.async {
      ReportPresenter.shared.dismiss()
      invoke.resolve()
    }
  }

  /// Open WebKit's find bar over the presented report.
  ///
  /// Resolves `{ presented: false }` rather than rejecting when no report is
  /// on screen — the caller needs to fall back to the web search island, and a
  /// rejection is indistinguishable from the native layer being absent.
  @objc public func findInReport(_ invoke: Invoke) {
    DispatchQueue.main.async {
      invoke.resolve(["presented": ReportPresenter.shared.presentFind()])
    }
  }

  @objc public func shareFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      let fileURL = try LibraryAccess.copyForSharing(args.relPath)
      DispatchQueue.main.async {
        guard let presenter = self.topViewController else {
          invoke.reject("No view controller to present the share sheet")
          return
        }
        guard presenter.presentedViewController == nil else {
          // A sheet is already up (double-tap). UIKit would refuse the second
          // present silently; reject so the JS side isn't lied to.
          try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
          invoke.reject("A share sheet is already open")
          return
        }
        let sheet = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        // Delete the temp copy (its per-invocation directory) once the share
        // flow completes or is cancelled — share targets read the URL lazily,
        // so cleanup must wait for the completion handler.
        sheet.completionWithItemsHandler = { _, _, _, _ in
          try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
        }
        // iPad requires a popover anchor; on iPhone this is ignored.
        sheet.popoverPresentationController?.sourceView = presenter.view
        sheet.popoverPresentationController?.sourceRect = CGRect(
          x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
        presenter.present(sheet, animated: true)
        invoke.resolve()
      }
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func ensureDownloaded(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      invoke.resolve(["state": try LibraryAccess.ensureDownloaded(args.relPath).rawValue])
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func statFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      invoke.resolve(["sizeBytes": try LibraryAccess.statFile(args.relPath)])
    } catch { invoke.reject(String(describing: error)) }
  }
}

@_cdecl("init_plugin_notesage_ios")
func initPlugin() -> Plugin {
  return NotesageIosPlugin()
}
