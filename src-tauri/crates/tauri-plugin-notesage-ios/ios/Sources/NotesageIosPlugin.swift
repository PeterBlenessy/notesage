import Foundation
import Tauri
import UIKit
import WebKit

// MARK: - Argument types (decoded from the invoke payload)

struct RelPathArgs: Decodable {
  let relPath: String
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
}

@_cdecl("init_plugin_notesage_ios")
func initPlugin() -> Plugin {
  return NotesageIosPlugin()
}
