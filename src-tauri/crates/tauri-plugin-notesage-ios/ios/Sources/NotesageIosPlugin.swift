import Foundation
import Tauri
import UIKit
import WebKit

// MARK: - Argument types (decoded from the invoke payload)

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

struct TextPromptArgs: Decodable {
  let title: String
  let placeholder: String
  let confirmLabel: String
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
  @objc public override func load(webview: WKWebView) {
    webview.isOpaque = false
    webview.backgroundColor = .systemBackground
    webview.scrollView.backgroundColor = .systemBackground
    webview.underPageBackgroundColor = .systemBackground
  }

  private var keyboardObserversInstalled = false
  private var keyboardObserverTokens: [NSObjectProtocol] = []
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
    installPullToRefresh(on: webView)
    return webView
  }

  /// Native pull-to-refresh over the library listing (issue #620), replacing
  /// the web fallback's tap-to-refresh button. The listing lives in the
  /// page's own overflow-y scroller, not a native page load, so there is no
  /// native "did finish" signal to end the spinner on — it ends on a fixed,
  /// deliberately visible beat instead (the same shape as the removed
  /// button's spin floor, just on the native side).
  private func installPullToRefresh(on webView: WKWebView) {
    let control = UIRefreshControl()
    control.addTarget(self, action: #selector(handlePullToRefresh(_:)), for: .valueChanged)
    webView.scrollView.refreshControl = control
  }

  @objc private func handlePullToRefresh(_ sender: UIRefreshControl) {
    guard let webView = webViewRef else {
      sender.endRefreshing()
      return
    }
    // Reuses the same `notesage:chrome` bridge shape tap events already
    // carry — the web side's `refresh` action handler (kept when the
    // topRight tap button was removed) reacts identically whether the id
    // came from a tapped button or, as here, a pull gesture.
    webView.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('notesage:chrome',{detail:{id:'refresh'}}))"
    )
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
      sender.endRefreshing()
    }
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

  deinit {
    for token in keyboardObserverTokens {
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
        confirm.isEnabled = false
        alert.addTextField { field in
          field.placeholder = args.placeholder
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
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
          removeObserver()
          invoke.resolve([:] as [String: String])
        })
        alert.addAction(confirm)
        presenter.present(alert, animated: true)
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
