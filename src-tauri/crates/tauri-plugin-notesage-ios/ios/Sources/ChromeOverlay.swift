import Combine
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
  /// Optional SF Symbol shown beside the title in the UIMenu row.
  let icon: String?
}

struct ChromeItemSpec: Decodable, Equatable {
  let id: String
  /// SF Symbol name (e.g. "chevron.backward", "arrow.clockwise").
  let icon: String
  /// Long-press menu (Files' held-back-button hierarchy). Tap fires `id`;
  /// holding presents these as a native UIMenu. (A tap-opens-menu variant
  /// was tried and reverted: a plain SwiftUI `Menu` label never received
  /// the tap inside our fixed-frame hosting setup — only the
  /// `Menu(primaryAction:)` shape below is proven to work.)
  let menu: [ChromeMenuItemSpec]?
  /// True while the action behind this button is in flight (e.g. a refresh
  /// reload) — the button spins its SF Symbol for the duration, mirroring
  /// the web-fallback island's `animate-spin` treatment.
  let busy: Bool?
}

struct ChromeSearchSpec: Decodable, Equatable {
  let placeholder: String
  /// Passive status shown collapsed (item count, page indicator).
  let status: String?
  /// 1-based current match + total, when the search is a find-in-document.
  let current: Int?
  let total: Int?
  /// "filter" (folder search: capsule + outer ✕) or "find" (in-document:
  /// ✓-done circle left, nav-chevron capsule right — Apple Notes anatomy).
  let kind: String?
}

struct ChromeSpec: Decodable, Equatable {
  let topLeft: ChromeItemSpec?
  let topRight: ChromeItemSpec?
  /// Bottom-trailing action button (the folder view's "+"). Pinned to the
  /// bottom safe area — the keyboard covers it while typing, like Notes'
  /// compose button.
  let bottomRight: ChromeItemSpec?
  let search: ChromeSearchSpec?
}

/// Live state for the native search island. A plain ObservableObject rather
/// than per-apply rootView swaps: spec updates mutate the model, so the
/// user's in-progress text and expansion state survive re-declarations
/// (which arrive on every match-count change).
final class SearchModel: ObservableObject {
  @Published var kind = "filter"
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
  private var searchWidthCancellable: AnyCancellable?
  private var searchCollapsedConstraints: [NSLayoutConstraint] = []
  private var searchExpandedConstraints: [NSLayoutConstraint] = []
  private weak var webView: WKWebView?

  /// Apply a chrome spec. Main thread only.
  func apply(_ spec: ChromeSpec, over webView: WKWebView) {
    self.webView = webView
    setCorner("topLeft", item: spec.topLeft, over: webView, leading: true)
    setCorner("topRight", item: spec.topRight, over: webView, leading: false)
    setCorner("bottomRight", item: spec.bottomRight, over: webView, leading: false, top: false)
    setSearch(spec.search, over: webView)
  }

  private func setSearch(_ spec: ChromeSearchSpec?, over webView: WKWebView) {
    guard let container = webView.superview else { return }
    guard let spec else {
      searchHost?.view.removeFromSuperview()
      searchHost = nil
      searchWidthCancellable = nil
      searchCollapsedConstraints = []
      searchExpandedConstraints = []
      searchModel.expanded = false
      searchModel.text = ""
      return
    }
    searchModel.kind = spec.kind ?? "filter"
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
    container.addSubview(host.view)
    // Fixed-height host (intrinsic sizing does not reliably grow the hosting
    // view when the SwiftUI content expands, and UIKit clips hit-testing to
    // the FRAME — the expanded bar drew full-width while only the
    // collapsed-pill strip stayed tappable).
    //
    // WIDTH IS STATE-DRIVEN, not static full-width: the hosting view does
    // NOT pass touches through its empty regions (the earlier comment
    // claiming it does was never verified) — a full-width collapsed host
    // silently swallowed every tap aimed at the bottom-right "+" beneath it
    // (#586's dead create button). Collapsed: a centered 260pt strip that
    // hugs the pill and leaves both bottom corners tappable. Expanded:
    // full-width for the text field + nav controls, when the corner buttons
    // are behind the keyboard anyway.
    NSLayoutConstraint.activate([
      // keyboardLayoutGuide rests on the bottom safe area when the keyboard
      // is down and tracks its top edge when up — native keyboard avoidance,
      // no JS bridge involved.
      host.view.bottomAnchor.constraint(
        equalTo: container.keyboardLayoutGuide.topAnchor, constant: -10),
      host.view.heightAnchor.constraint(equalToConstant: 50),
    ])
    searchCollapsedConstraints = [
      host.view.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      host.view.widthAnchor.constraint(equalToConstant: 260),
    ]
    searchExpandedConstraints = [
      host.view.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
      host.view.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12),
    ]
    NSLayoutConstraint.activate(searchCollapsedConstraints)
    searchWidthCancellable = searchModel.$expanded
      .removeDuplicates()
      .sink { [weak self, weak container] expanded in
        guard let self, let container else { return }
        NSLayoutConstraint.deactivate(
          expanded ? self.searchCollapsedConstraints : self.searchExpandedConstraints)
        NSLayoutConstraint.activate(
          expanded ? self.searchExpandedConstraints : self.searchCollapsedConstraints)
        UIView.animate(withDuration: 0.25) { container.layoutIfNeeded() }
      }
    searchHost = host
  }

  private func setCorner(
    _ key: String, item: ChromeItemSpec?, over webView: WKWebView, leading: Bool,
    top: Bool = true
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
      top
        ? host.view.topAnchor.constraint(equalTo: guide.topAnchor, constant: 8)
        : host.view.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -10),
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
  // Continuous rotation while `item.busy` is true — mirrors the web
  // fallback's `animate-spin` (CSS keeps spinning until the state flips).
  // Manual rotation rather than `.symbolEffect(.rotate)` keeps this working
  // on the iOS 16 deployment target instead of gating on iOS 17+.
  @State private var spinning = false

  private var label: some View {
    Image(systemName: item.icon)
      .font(.system(size: 15, weight: .medium))
      // 36pt label + the glass style's own padding lands on the ~40pt
      // circle native bars use (measured against the Files reference).
      .frame(width: 36, height: 36)
      .rotationEffect(.degrees(spinning ? 360 : 0))
      .animation(
        spinning
          ? .linear(duration: 0.8).repeatForever(autoreverses: false)
          : .default,
        value: spinning
      )
      .onAppear { spinning = item.busy == true }
      .onChange(of: item.busy) { busy in spinning = busy == true }
  }

  @ViewBuilder
  private func menuRows(_ menu: [ChromeMenuItemSpec]) -> some View {
    ForEach(menu, id: \.id) { entry in
      Button {
        emit(entry.id)
      } label: {
        if let icon = entry.icon {
          Label(entry.title, systemImage: icon)
        } else {
          Text(entry.title)
        }
      }
    }
  }

  var body: some View {
    Group {
      if let menu = item.menu, !menu.isEmpty {
        Menu {
          menuRows(menu)
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
    // Both states stay MOUNTED (ZStack + opacity/allowsHitTesting) rather
    // than an animated if/else branch swap: swapping the tree left the
    // hosting view's hit-testing stuck on the removed branch — the expanded
    // bar rendered but every control in it (field included) was untappable.
    ZStack {
      collapsedPill
        .opacity(model.expanded ? 0 : 1)
        .allowsHitTesting(!model.expanded)
      expandedField
        .opacity(model.expanded ? 1 : 0)
        .allowsHitTesting(model.expanded)
    }
    .animation(.spring(response: 0.35, dampingFraction: 0.7), value: model.expanded)
  }

  private var collapsedPill: some View {
    HStack {
      Spacer(minLength: 0)
      collapsedButton
      Spacer(minLength: 0)
    }
  }

  private var collapsedButton: some View {
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

  private func endSearch() {
    model.text = ""
    model.expanded = false
    focused = false
    model.emit?("search-query", "")
    model.emit?("search-close", nil)
  }

  /// The shared field capsule: magnifier, text, counter (find mode), and the
  /// ⊗ clear that appears once there is text.
  private var fieldCapsule: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 15, weight: .medium))
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
      if model.kind == "find", model.totalMatches > 0 {
        Text("\(model.currentMatch)/\(model.totalMatches)")
          .font(.subheadline.monospacedDigit())
          .foregroundStyle(.secondary)
      }
      if !model.text.isEmpty {
        Button {
          model.text = ""
          // onChange fires the empty query; keep focus for a new search.
        } label: {
          Image(systemName: "xmark.circle.fill")
            .font(.system(size: 16))
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 14)
    .frame(height: 46)
    .frame(maxWidth: .infinity)
    .modifier(GlassCapsuleSurface())
  }

  /// Folder search (Apple Notes list-search anatomy): field capsule + a
  /// separate circular ✕ glass button.
  /// In-document find (Notes note-search anatomy): ✓-done prominent circle
  /// on the LEFT, field capsule, and the ∧∨ nav pair in its own capsule.
  private var expandedField: some View {
    HStack(spacing: 10) {
      if model.kind == "find" {
        Button(action: endSearch) {
          Image(systemName: "checkmark")
            .font(.system(size: 15, weight: .semibold))
            .frame(width: 40, height: 40)
        }
        .modifier(GlassCircleProminent())

        fieldCapsule

        HStack(spacing: 0) {
          Button { model.emit?("search-prev", nil) } label: {
            Image(systemName: "chevron.up")
              .font(.system(size: 15, weight: .medium))
              .frame(width: 36, height: 40)
          }
          .buttonStyle(.plain)
          .disabled(model.totalMatches == 0)
          Button { model.emit?("search-next", nil) } label: {
            Image(systemName: "chevron.down")
              .font(.system(size: 15, weight: .medium))
              .frame(width: 36, height: 40)
          }
          .buttonStyle(.plain)
          .disabled(model.totalMatches == 0)
        }
        .padding(.horizontal, 4)
        .modifier(GlassCapsuleSurface())
      } else {
        fieldCapsule

        Button(action: endSearch) {
          Image(systemName: "xmark")
            .font(.system(size: 15, weight: .semibold))
            .frame(width: 40, height: 40)
        }
        .modifier(GlassCircle())
      }
    }
    .frame(maxWidth: .infinity)
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

/// Prominent (tinted) glass circle — the find bar's ✓ done button.
struct GlassCircleProminent: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.buttonStyle(.glassProminent).buttonBorderShape(.circle)
    } else {
      content.buttonStyle(.borderedProminent).clipShape(Circle())
    }
  }
}

/// Glass surface for a non-button container (the expanded field).
/// NOTE: deliberately NOT glassEffect — a glass surface WRAPPING interactive
/// controls swallowed every tap inside it (iOS 26 renders the effect on its
/// own layer); material background keeps normal hit-testing.
struct GlassCapsuleSurface: ViewModifier {
  func body(content: Content) -> some View {
    content.background(.ultraThinMaterial, in: Capsule())
  }
}
