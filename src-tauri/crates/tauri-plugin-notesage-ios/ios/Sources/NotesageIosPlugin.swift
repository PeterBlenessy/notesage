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
  private var accessoryRemoved = false
  private var keyboardObserversInstalled = false
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
    guard !accessoryRemoved || !keyboardObserversInstalled else { return }
    DispatchQueue.main.async { [weak self] in
      guard
        let self,
        let window = UIApplication.shared.connectedScenes
          .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first,
        let webView = KeyboardAccessory.findWebView(in: window)
      else { return }
      self.webViewRef = webView
      if !self.accessoryRemoved {
        KeyboardAccessory.remove(from: webView)
        self.accessoryRemoved = true
      }
      self.installKeyboardObservers()
    }
  }

  /// Dispatch a `notesage:keyboard` CustomEvent with the keyboard's overlap
  /// of the webview (in CSS pt) whenever the keyboard frame changes.
  private func installKeyboardObservers() {
    guard !keyboardObserversInstalled else { return }
    keyboardObserversInstalled = true
    let center = NotificationCenter.default
    let forward: (Notification) -> Void = { [weak self] note in
      guard let webView = self?.webViewRef else { return }
      var inset: CGFloat = 0
      if let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?
        .cgRectValue
      {
        let local = webView.convert(frame, from: nil)
        inset = max(0, webView.bounds.maxY - local.minY)
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
      center.addObserver(forName: name, object: nil, queue: .main, using: forward)
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

  @objc public func shareFile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      let fileURL = try LibraryAccess.copyForSharing(args.relPath)
      DispatchQueue.main.async {
        guard let presenter = self.topViewController else {
          invoke.reject("No view controller to present the share sheet")
          return
        }
        let sheet = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
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
