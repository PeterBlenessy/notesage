import SwiftUI
import UIKit
import WebKit

/// Native chrome overlay — REAL Liquid Glass buttons floating over the
/// webview (issue #581 follow-up: CSS can approximate the material but not
/// the interruptible spring physics; these are genuine `.buttonStyle(.glass)`
/// controls on iOS 26, with a bordered fallback on older systems).
///
/// Architecture: the web app declares what chrome it wants
/// (`setChrome` plugin call → `ChromeSpec`), this manager hosts one small
/// `UIHostingController` per corner pinned to the safe area ABOVE the
/// webview, and button taps are forwarded back into the page as
/// `notesage:chrome` CustomEvents — the same bridge shape as the keyboard
/// forwarder. Each host is sized to its button, so the web content around
/// the chrome keeps receiving touches untouched.
struct ChromeMenuItemSpec: Decodable, Equatable {
  let id: String
  let title: String
}

struct ChromeItemSpec: Decodable, Equatable {
  let id: String
  /// SF Symbol name (e.g. "chevron.backward", "arrow.clockwise").
  let icon: String
  /// Long-press menu (Files' held-back-button hierarchy). Tap still fires
  /// `id`; holding presents these as a native UIMenu.
  let menu: [ChromeMenuItemSpec]?
}

struct ChromeSpec: Decodable, Equatable {
  let topLeft: ChromeItemSpec?
  let topRight: ChromeItemSpec?
}

final class ChromeManager {
  static let shared = ChromeManager()
  private var hosts: [String: UIHostingController<AnyView>] = [:]
  private var current: [String: ChromeItemSpec] = [:]
  private weak var webView: WKWebView?

  /// Apply a chrome spec. Main thread only.
  func apply(_ spec: ChromeSpec, over webView: WKWebView) {
    self.webView = webView
    setCorner("topLeft", item: spec.topLeft, over: webView, leading: true)
    setCorner("topRight", item: spec.topRight, over: webView, leading: false)
  }

  private func setCorner(
    _ key: String, item: ChromeItemSpec?, over webView: WKWebView, leading: Bool
  ) {
    guard let container = webView.superview else { return }
    guard let item else {
      hosts[key]?.view.removeFromSuperview()
      hosts[key] = nil
      current[key] = nil
      return
    }
    if current[key] == item, hosts[key]?.view.superview != nil { return }
    current[key] = item

    let button = GlassChromeButton(item: item) { [weak self] id in
      self?.emit(id)
    }
    if let host = hosts[key] {
      host.rootView = AnyView(button)
      container.bringSubviewToFront(host.view)
      return
    }
    let host = UIHostingController(rootView: AnyView(button))
    host.view.backgroundColor = .clear
    host.view.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(host.view)
    let guide = container.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      host.view.topAnchor.constraint(equalTo: guide.topAnchor, constant: 8),
      leading
        ? host.view.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12)
        : host.view.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12),
      host.view.widthAnchor.constraint(equalToConstant: 46),
      host.view.heightAnchor.constraint(equalToConstant: 46),
    ])
    hosts[key] = host
  }

  private func emit(_ id: String) {
    webView?.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('notesage:chrome',{detail:{id:'\(id)'}}))"
    )
  }
}

/// A single circular Liquid Glass icon button. On iOS 26 this is the real
/// material with the real interaction physics — swell, illumination,
/// interruptible springs — all from the system. When the spec carries a
/// menu, this renders as `Menu(primaryAction:)`: tap fires the button's own
/// id, holding presents the native UIMenu (Files' back-button pattern).
struct GlassChromeButton: View {
  let item: ChromeItemSpec
  let emit: (String) -> Void

  private var label: some View {
    Image(systemName: item.icon)
      .font(.system(size: 15, weight: .medium))
      // 36pt label + the glass style's own padding lands on the ~40pt
      // circle native bars use (measured against the Files reference).
      .frame(width: 36, height: 36)
  }

  var body: some View {
    Group {
      if let menu = item.menu, !menu.isEmpty {
        Menu {
          ForEach(menu, id: \.id) { entry in
            Button(entry.title) { emit(entry.id) }
          }
        } label: {
          label
        } primaryAction: {
          emit(item.id)
        }
        .modifier(GlassCircle())
      } else {
        Button(action: { emit(item.id) }) { label }
          .modifier(GlassCircle())
      }
    }
  }
}

/// Real glass on iOS 26; bordered circle before that.
struct GlassCircle: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
    } else {
      content
        .buttonStyle(.bordered)
        .clipShape(Circle())
    }
  }
}
