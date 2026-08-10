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

struct ChromeSearchSpec: Decodable, Equatable {
  let placeholder: String
  /// Passive status shown collapsed (item count, page indicator).
  let status: String?
  /// 1-based current match + total, when the search is a find-in-document.
  let current: Int?
  let total: Int?
}

struct ChromeSpec: Decodable, Equatable {
  let topLeft: ChromeItemSpec?
  let topRight: ChromeItemSpec?
  let search: ChromeSearchSpec?
}

/// Live state for the native search island. A plain ObservableObject rather
/// than per-apply rootView swaps: spec updates mutate the model, so the
/// user's in-progress text and expansion state survive re-declarations
/// (which arrive on every match-count change).
final class SearchModel: ObservableObject {
  @Published var placeholder = "Search"
  @Published var status: String?
  @Published var currentMatch = 0
  @Published var totalMatches = 0
  @Published var expanded = false
  @Published var text = ""
  var emit: ((String, String?) -> Void)?
}

final class ChromeManager {
  static let shared = ChromeManager()
  private var hosts: [String: UIHostingController<AnyView>] = [:]
  private var current: [String: ChromeItemSpec] = [:]
  private var searchHost: UIHostingController<AnyView>?
  private let searchModel = SearchModel()
  private weak var webView: WKWebView?

  /// Apply a chrome spec. Main thread only.
  func apply(_ spec: ChromeSpec, over webView: WKWebView) {
    self.webView = webView
    setCorner("topLeft", item: spec.topLeft, over: webView, leading: true)
    setCorner("topRight", item: spec.topRight, over: webView, leading: false)
    setSearch(spec.search, over: webView)
  }

  private func setSearch(_ spec: ChromeSearchSpec?, over webView: WKWebView) {
    guard let container = webView.superview else { return }
    guard let spec else {
      searchHost?.view.removeFromSuperview()
      searchHost = nil
      searchModel.expanded = false
      searchModel.text = ""
      return
    }
    searchModel.placeholder = spec.placeholder
    searchModel.status = spec.status
    searchModel.currentMatch = spec.current ?? 0
    searchModel.totalMatches = spec.total ?? 0
    searchModel.emit = { [weak self] id, value in self?.emit(id, value: value) }
    if let host = searchHost, host.view.superview != nil {
      container.bringSubviewToFront(host.view)
      return
    }
    let host = UIHostingController(rootView: AnyView(GlassSearchIsland(model: searchModel)))
    host.view.backgroundColor = .clear
    host.view.translatesAutoresizingMaskIntoConstraints = false
    host.sizingOptions = [.intrinsicContentSize]
    container.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      // keyboardLayoutGuide rests on the bottom safe area when the keyboard
      // is down and tracks its top edge when up — native keyboard avoidance,
      // no JS bridge involved.
      host.view.bottomAnchor.constraint(
        equalTo: container.keyboardLayoutGuide.topAnchor, constant: -10),
    ])
    searchHost = host
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
      self?.emit(id, value: nil)
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

  private func emit(_ id: String, value: String? = nil) {
    // The value is user-typed text — route it through JSON so quotes,
    // backslashes and emoji can't break out of the JS string literal.
    var detail: [String: String] = ["id": id]
    if let value { detail["value"] = value }
    guard let data = try? JSONSerialization.data(withJSONObject: detail),
      let json = String(data: data, encoding: .utf8)
    else { return }
    webView?.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('notesage:chrome',{detail:\(json)}))"
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


/// The bottom-center search island: collapsed it's a glass capsule with the
/// magnifier + passive status; expanded it's a text field with match
/// navigation. Pinned above the keyboard by the layout guide — expansion,
/// focus, and springs are all system behavior.
struct GlassSearchIsland: View {
  @ObservedObject var model: SearchModel
  @FocusState private var focused: Bool

  var body: some View {
    Group {
      if model.expanded {
        expandedField
      } else {
        collapsedPill
      }
    }
    .animation(.spring(response: 0.35, dampingFraction: 0.7), value: model.expanded)
  }

  private var collapsedPill: some View {
    Button {
      model.expanded = true
      model.emit?("search-open", nil)
      DispatchQueue.main.async { focused = true }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .medium))
        if let status = model.status, !status.isEmpty {
          Text(status).font(.footnote)
        }
      }
      .padding(.horizontal, 14)
      .frame(height: 36)
    }
    .modifier(GlassCapsule())
  }

  private var expandedField: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.secondary)
      TextField(model.placeholder, text: $model.text)
        .focused($focused)
        .textFieldStyle(.plain)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .submitLabel(.search)
        .onChange(of: model.text) { value in
          model.emit?("search-query", value)
        }
      if model.totalMatches > 0 {
        Text("\(model.currentMatch)/\(model.totalMatches)")
          .font(.footnote.monospacedDigit())
          .foregroundStyle(.secondary)
        Button { model.emit?("search-prev", nil) } label: {
          Image(systemName: "chevron.up").font(.system(size: 13, weight: .medium))
        }
        Button { model.emit?("search-next", nil) } label: {
          Image(systemName: "chevron.down").font(.system(size: 13, weight: .medium))
        }
      }
      Button {
        model.text = ""
        model.expanded = false
        focused = false
        model.emit?("search-query", "")
        model.emit?("search-close", nil)
      } label: {
        Image(systemName: "xmark").font(.system(size: 13, weight: .medium))
      }
    }
    .padding(.horizontal, 14)
    .frame(width: UIScreen.main.bounds.width - 24, height: 44)
    .modifier(GlassCapsuleSurface())
  }
}

/// Glass capsule for a tappable pill (button styles).
struct GlassCapsule: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.buttonStyle(.glass).buttonBorderShape(.capsule)
    } else {
      content.buttonStyle(.bordered).clipShape(Capsule())
    }
  }
}

/// Glass surface for a non-button container (the expanded field).
struct GlassCapsuleSurface: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.glassEffect(.regular.interactive(), in: .capsule)
    } else {
      content.background(.ultraThinMaterial, in: Capsule())
    }
  }
}
