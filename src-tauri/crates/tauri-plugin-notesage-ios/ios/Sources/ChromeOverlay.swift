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
/// A view whose only content is a vertical alpha gradient of the system
/// background — nearly opaque at the status-bar edge, fully transparent at
/// its lower edge, so the top row reads as a soft band rather than a
/// toolbar (Peter's reference). A UIView subclass (not a bare layer) so the
/// gradient tracks bounds changes automatically.
final class GradientScrimView: UIView {
  override class var layerClass: AnyClass { CAGradientLayer.self }

  override init(frame: CGRect) {
    super.init(frame: frame)
    apply()
  }
  required init?(coder: NSCoder) {
    super.init(coder: coder)
    apply()
  }

  /// Re-resolve on light/dark flips — cgColor snapshots a dynamic UIColor at
  /// assignment time and would otherwise stay stale.
  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    apply()
  }

  private func apply() {
    guard let gradient = layer as? CAGradientLayer else { return }
    let bg = UIColor.systemBackground.resolvedColor(with: traitCollection)
    gradient.colors = [
      bg.withAlphaComponent(0.92).cgColor,
      bg.withAlphaComponent(0.55).cgColor,
      bg.withAlphaComponent(0).cgColor,
    ]
    gradient.locations = [0, 0.55, 1]
  }
}

struct ChromeMenuItemSpec: Decodable, Equatable {
  let id: String
  let title: String
  /// Optional SF Symbol shown beside the title in the UIMenu row.
  let icon: String?
  /// When present, the row renders selection state (checkmark when true) —
  /// used by pick-one menus like the sort control (#632).
  let selected: Bool?
  /// Start a new menu section (divider) before this entry.
  let sectionBreak: Bool?
}

struct ChromeItemSpec: Decodable, Equatable {
  let id: String
  /// SF Symbol name (e.g. "chevron.backward", "arrow.clockwise").
  let icon: String
  /// Native UIMenu. Default: long-press menu (Files' held-back-button
  /// hierarchy) with tap firing `id`. With `menuOnTap`, the TAP opens the
  /// menu and `id` never fires. (The earlier "tap-menu doesn't work" theory
  /// was wrong — the dead taps were the search host swallowing them; the
  /// breadcrumb's pure Menu proves the variant works.)
  let menu: [ChromeMenuItemSpec]?
  /// When true, tapping opens `menu` directly (pick-one control pattern).
  let menuOnTap: Bool?
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

/// Top-center breadcrumb island (#615): the current folder's name on a glass
/// capsule; tapping opens a native UIMenu jumping to the library root or any
/// ancestor. With no menu entries (library root) it renders as a passive
/// label.
struct ChromeBreadcrumbSpec: Decodable, Equatable {
  let title: String
  /// Compact ancestor path shown as a second line ("Notesage › Projects").
  let subtitle: String?
  let menu: [ChromeMenuItemSpec]?
}

/// Bottom-center transport for reading an article aloud (#833).
///
/// Native rather than a React island because the primary listening case is a
/// captured article, and those are presented in a SEPARATE native web view
/// that sits above the app's own (#606/ADR 0010) — a React-rendered bar is
/// simply behind it. The chrome overlay is already the one surface that draws
/// above that view, which is why the back button and find button work there.
struct ChromePlayerSpec: Decodable, Equatable {
  let playing: Bool
  /// Already-formatted "3 / 41" — the position is paragraphs, and formatting
  /// it here would duplicate the frontend's locale handling.
  let position: String
  /// Already-formatted "1.5×".
  let rate: String
}

/// The recording island (recordings PRD): a red dot, the elapsed time,
/// pause/resume and stop. Shown in the browser and the Reader alike while a
/// recording runs, in the player's slot — the two never coexist, since the
/// audio session has one owner.
struct ChromeRecorderSpec: Decodable, Equatable {
  /// Already-formatted "02:14".
  let elapsed: String
  let paused: Bool
  /// 0…1 metered level, drawn as a faint bar so a muted mic reads as a flat line.
  let level: Double
  /// Paused by a call and not resumed: the island says so.
  let interrupted: Bool
  /// Already-localised "Paused — call ended".
  let interruptedLabel: String?
}

struct ChromeSpec: Decodable, Equatable {
  let topLeft: ChromeItemSpec?
  let topRight: ChromeItemSpec?
  let topCenter: ChromeBreadcrumbSpec?
  let bottomRecorder: ChromeRecorderSpec?
  /// Bottom-trailing action button (the folder view's "+"). Pinned to the
  /// bottom safe area — the keyboard covers it while typing, like Notes'
  /// compose button.
  let bottomRight: ChromeItemSpec?
  let bottomCenter: ChromePlayerSpec?
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
  private var playerHost: UIHostingController<AnyView>?
  private weak var webView: WKWebView?

  /// Apply a chrome spec. Main thread only.
  func apply(_ spec: ChromeSpec, over webView: WKWebView) {
    self.webView = webView
    installTopScrim(over: webView)
    setCorner("topLeft", item: spec.topLeft, over: webView, leading: true)
    setCorner("topRight", item: spec.topRight, over: webView, leading: false)
    setCorner("bottomRight", item: spec.bottomRight, over: webView, leading: false, top: false)
    setBreadcrumb(spec.topCenter, over: webView)
    // The recorder takes the slot when both are declared: a recording is
    // never silently displaced by a transport for something not playing.
    setPlayer(spec.bottomRecorder == nil ? spec.bottomCenter : nil, over: webView)
    setRecorder(spec.bottomRecorder, over: webView)
    setSearch(spec.search, over: webView)
    // The recorder and the search island are both bottom-centre, and search
    // is deliberately raised above everything (`bringChromeToFront`), so on a
    // screen that has both, search sat exactly on top of Pause and Stop:
    // a recording could be started and then not stopped (Peter, device,
    // build 50). The player already yields the slot to a recording; search
    // cannot, because filtering a folder while recording is reasonable. So
    // they stack — the recorder rides above the search pill.
    recorderBottom?.constant = spec.search == nil ? -10 : -(10 + searchIslandHeight + 8)
  }

  /// Lift every chrome host back above whatever was just inserted over the
  /// web view.
  ///
  /// `ReportPresenter` puts a second web view directly above the app's, so a
  /// report covers the content — which is the intent — but it would also cover
  /// the back button, and a full-screen report with no way out is not a
  /// reading surface, it is a trap. Ordering is re-asserted rather than
  /// assumed because the chrome hosts were added at various times and their
  /// relative z-order is not something either side should have to track.
  func bringChromeToFront() {
    guard let container = webView?.superview else { return }
    for host in hosts.values {
      container.bringSubviewToFront(host.view)
    }
    if let breadcrumbHost { container.bringSubviewToFront(breadcrumbHost.view) }
    if let searchHost { container.bringSubviewToFront(searchHost.view) }
  }

  private var breadcrumbHost: UIHostingController<AnyView>?
  private var topScrim: UIView?

  /// Soft gradient band behind the top row (Peter's reference): stronger at
  /// the status-bar edge, fading to fully transparent at its lower edge, so
  /// nothing but the corner buttons is opaque and content passes under it
  /// without a visible cut line. Blur is deliberately omitted — a material
  /// here reads as a toolbar, which is exactly what the design avoids.
  private func installTopScrim(over webView: WKWebView) {
    guard let container = webView.superview else { return }
    if let existing = topScrim, existing.superview != nil {
      container.bringSubviewToFront(existing)
      return
    }
    let scrim = GradientScrimView()
    scrim.isUserInteractionEnabled = false
    scrim.translatesAutoresizingMaskIntoConstraints = false
    // Directly above the webview and below every chrome host, so the
    // buttons and title stay crisp while content fades under the band.
    container.insertSubview(scrim, aboveSubview: webView)
    NSLayoutConstraint.activate([
      scrim.topAnchor.constraint(equalTo: container.topAnchor),
      scrim.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      scrim.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      scrim.bottomAnchor.constraint(
        equalTo: container.safeAreaLayoutGuide.topAnchor, constant: 74),
    ])
    topScrim = scrim
  }

  private func setBreadcrumb(_ spec: ChromeBreadcrumbSpec?, over webView: WKWebView) {
    guard let container = webView.superview else { return }
    guard let spec else {
      breadcrumbHost?.view.removeFromSuperview()
      breadcrumbHost = nil
      return
    }
    let view = AnyView(GlassBreadcrumb(spec: spec) { [weak self] id in self?.emit(id, value: nil) })
    if let host = breadcrumbHost, host.view.superview != nil {
      // Title/menu change on navigation — swap the root view in place.
      host.rootView = view
      container.bringSubviewToFront(host.view)
      return
    }
    let host = UIHostingController(rootView: view)
    host.view.backgroundColor = .clear
    host.view.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(host.view)
    // Fixed-frame strip between the two corner buttons (hosting views clip
    // hit-testing to their frame — the corner-button lesson). SwiftUI centers
    // the capsule inside it. NOTE: the strip sits over the top-center of the
    // webview; only non-interactive content (titles) lives under that zone.
    NSLayoutConstraint.activate([
      host.view.topAnchor.constraint(equalTo: container.safeAreaLayoutGuide.topAnchor, constant: 8),
      host.view.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 72),
      host.view.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -72),
      host.view.heightAnchor.constraint(equalToConstant: 46),
    ])
    breadcrumbHost = host
  }

  private func setPlayer(_ spec: ChromePlayerSpec?, over webView: WKWebView) {
    guard let container = webView.superview else { return }
    guard let spec else {
      playerHost?.view.removeFromSuperview()
      playerHost = nil
      return
    }
    let view = AnyView(GlassPlayer(spec: spec) { [weak self] id in self?.emit(id, value: nil) })
    if let host = playerHost, host.view.superview != nil {
      // Position and playing state change constantly — swap the root view in
      // place rather than rebuilding the hosting controller, which would drop
      // the capsule's animation and re-run its appear transition each tick.
      host.rootView = view
      // The strip's width comes from the hosting view's intrinsic size, which
      // a root-view swap does NOT recompute: it stayed sized to the initial
      // "…" placeholder and the real "128 / 178" was squeezed back into "…".
      host.view.invalidateIntrinsicContentSize()
      container.bringSubviewToFront(host.view)
      return
    }
    let host = UIHostingController(rootView: view)
    host.view.backgroundColor = .clear
    host.view.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(host.view)
    // Fixed-frame strip along the bottom safe area. A hosting view clips
    // hit-testing to its own frame, so it must be no taller than the controls
    // or it swallows taps meant for the document beneath (the corner-button
    // lesson, #581).
    NSLayoutConstraint.activate([
      host.view.bottomAnchor.constraint(
        equalTo: container.safeAreaLayoutGuide.bottomAnchor, constant: -10),
      host.view.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      host.view.heightAnchor.constraint(equalToConstant: 66),
      // Never wider than the screen: a strip that overshoots clips its end
      // buttons and loses the capsule's rounded ends off-screen.
      host.view.widthAnchor.constraint(lessThanOrEqualTo: container.widthAnchor, constant: -24),
    ])
    // Intrinsic width: the hosting view must be allowed to be as wide as its
    // content, or SwiftUI squeezes the position label into a wrap.
    // Below `.required`: the screen-width ceiling above must win when the
    // two disagree, and the labels can now shrink to make that possible.
    host.view.setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
    host.view.setContentHuggingPriority(.defaultHigh, for: .horizontal)
    playerHost = host
  }

  /// Height of the collapsed search island, mirrored from its own constraint
  /// below so the recorder can sit clear of it.
  private static let searchIslandHeightValue: CGFloat = 50
  private var searchIslandHeight: CGFloat { Self.searchIslandHeightValue }
  private var recorderBottom: NSLayoutConstraint?
  private var recorderHost: UIHostingController<AnyView>?

  private func setRecorder(_ spec: ChromeRecorderSpec?, over webView: WKWebView) {
    guard let container = webView.superview else { return }
    guard let spec else {
      recorderHost?.view.removeFromSuperview()
      recorderHost = nil
      recorderBottom = nil
      return
    }
    let view = AnyView(GlassRecorder(spec: spec) { [weak self] id in self?.emit(id, value: nil) })
    if let host = recorderHost, host.view.superview != nil {
      host.rootView = view
      host.view.invalidateIntrinsicContentSize()
      container.bringSubviewToFront(host.view)
      return
    }
    let host = UIHostingController(rootView: view)
    host.view.backgroundColor = .clear
    host.view.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(host.view)
    // Against the keyboard guide, like the search island: it rests on the
    // bottom safe area with the keyboard down, so nothing moves in the common
    // case, and neither island ends up under a keyboard in the rare one.
    let bottom = host.view.bottomAnchor.constraint(
      equalTo: container.keyboardLayoutGuide.topAnchor, constant: -10)
    recorderBottom = bottom
    NSLayoutConstraint.activate([
      bottom,
      host.view.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      host.view.heightAnchor.constraint(equalToConstant: 66),
      host.view.widthAnchor.constraint(lessThanOrEqualTo: container.widthAnchor, constant: -24),
    ])
    host.view.setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
    host.view.setContentHuggingPriority(.defaultHigh, for: .horizontal)
    recorderHost = host
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
      host.view.heightAnchor.constraint(equalToConstant: Self.searchIslandHeightValue),
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
    // Settle the initial frame WITHOUT animation — and skip the publisher's
    // immediate first fire below — otherwise the island animates from its
    // default zero frame at the top-left corner on every (re)install (the
    // jumpy flight Peter saw when closing a document).
    UIView.performWithoutAnimation { container.layoutIfNeeded() }
    searchWidthCancellable = searchModel.$expanded
      .removeDuplicates()
      .dropFirst()
      .sink { [weak self, weak container] expanded in
        guard let self, let container else { return }
        let resize = {
          NSLayoutConstraint.deactivate(
            expanded ? self.searchCollapsedConstraints : self.searchExpandedConstraints)
          NSLayoutConstraint.activate(
            expanded ? self.searchExpandedConstraints : self.searchCollapsedConstraints)
          UIView.animate(withDuration: 0.25) { container.layoutIfNeeded() }
        }
        if expanded {
          resize()
        } else {
          // Collapsing: let the expanded content fade out FIRST, in place.
          // The field capsule fills the container and the ✕ rides its
          // trailing edge, so shrinking the container while that content is
          // still visible drags the ✕ inward across the screen — the button
          // appeared to fly to the middle before vanishing (Peter,
          // 2026-08-13). The delay matches SEARCH_FADE below.
          DispatchQueue.main.asyncAfter(deadline: .now() + SEARCH_FADE, execute: resize)
        }
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
      if entry.sectionBreak == true {
        Divider()
      }
      if let selected = entry.selected {
        // Selection row: Toggle inside a Menu renders as a native checkmark
        // row. The EMIT lives in the binding's setter — UIMenu rows never
        // deliver SwiftUI tap gestures, so an .onTapGesture here silently
        // does nothing (the shipped bug: sort/view picks were inert).
        Toggle(isOn: Binding(get: { selected }, set: { _ in emit(entry.id) })) {
          if let icon = entry.icon {
            Label(entry.title, systemImage: icon)
          } else {
            Text(entry.title)
          }
        }
      } else {
        // ACTION row — same Toggle-binding emit as the selection row above,
        // and for the same reason.
        //
        // A `Button` here looked obviously right and was inert: Move and
        // Update from source shipped in build 28 with a menu that OPENED and
        // rows that did nothing when tapped. The comment above already said
        // UIMenu rows never deliver SwiftUI tap gestures — the selection rows
        // were fixed for it, the action rows were never exercised, so the
        // broken path survived because nothing used it.
        //
        // `isOn: false` renders a plain row with no checkmark; the emit lives
        // in the binding's setter, which is the only delivery that works.
        Toggle(isOn: Binding(get: { false }, set: { _ in emit(entry.id) })) {
          if let icon = entry.icon {
            Label(entry.title, systemImage: icon)
          } else {
            Text(entry.title)
          }
        }
      }
    }
  }

  var body: some View {
    Group {
      if let menu = item.menu, !menu.isEmpty, item.menuOnTap == true {
        Menu {
          menuRows(menu)
        } label: {
          label
        }
        .modifier(GlassCircle())
      } else if let menu = item.menu, !menu.isEmpty {
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

/// The top-center breadcrumb capsule (#615). Tap opens the ancestor UIMenu
/// (root first); at the library root (no menu) it is a passive label. Long
/// titles middle-truncate; the container strip already reserves clearance
/// from both corner buttons.
struct GlassBreadcrumb: View {
  let spec: ChromeBreadcrumbSpec
  let emit: (String) -> Void

  private var label: some View {
    HStack(spacing: 5) {
      VStack(spacing: 0) {
        Text(spec.title)
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
          .truncationMode(.middle)
        if let subtitle = spec.subtitle, !subtitle.isEmpty {
          Text(subtitle)
            .font(.caption2)
            .opacity(0.55)
            .lineLimit(1)
            .truncationMode(.middle)
        }
      }
      if !(spec.menu ?? []).isEmpty {
        // The ONLY affordance: a small tinted circle holding the chevron.
        // The title itself sits bare on the band — no capsule, no border,
        // no material (Peter's reference screenshot).
        Image(systemName: "chevron.down")
          .font(.caption2.weight(.bold))
          .frame(width: 22, height: 22)
          .background(Color.primary.opacity(0.14), in: Circle())
      }
    }
    .padding(.horizontal, 6)
    .frame(height: 40)
  }

  var body: some View {
    if let menu = spec.menu, !menu.isEmpty {
      Menu {
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
      } label: {
        label
      }
      // Plain button style: no glass capsule, no bordered shape — the
      // chevron circle is the affordance.
      .buttonStyle(.plain)
    } else {
      label
    }
  }
}

/// Real glass capsule on iOS 26; bordered capsule before that.
struct GlassCapsuleButton: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
    } else {
      content
        .buttonStyle(.bordered)
        .clipShape(Capsule())
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
    // A short LINEAR fade, not the old 0.35 s spring: the container's width
    // animation is choreographed around it (see the `expanded` sink), and a
    // spring's long tail left the expanded content visible — and therefore
    // re-laying out — well into the collapse.
    .animation(.easeOut(duration: SEARCH_FADE), value: model.expanded)
    // Dismissing the keyboard (a tap outside the field) should put the island
    // back too — an expanded bar with no keyboard and nothing typed is just
    // stranded chrome (Peter, 2026-08-13).
    //
    // ONLY when the field is empty: losing focus with a live query is the
    // user tapping away to READ the filtered list, and collapsing there would
    // discard their filter and leave a filtered listing with no visible
    // reason for being filtered. `model.expanded` guards re-entry, since
    // `endSearch` itself drops focus.
    .onChange(of: focused) { isFocused in
      guard !isFocused, model.expanded, model.text.isEmpty else { return }
      endSearch()
    }
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

/// How long the search island's two states cross-fade. The container's width
/// animation waits this long before collapsing, so the expanded content is
/// already invisible by the time it would start sliding.
let SEARCH_FADE: Double = 0.14

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

/// Transport controls for reading aloud (#833).
///
/// Five controls and a position readout, sized for one-handed use while
/// walking — which is the case the whole feature exists for. Position is shown
/// in PARAGRAPHS, not minutes: `AVSpeechSynthesizer` gives no reliable
/// duration up front, and a wrong clock is worse than an honest count.
struct GlassPlayer: View {
  let spec: ChromePlayerSpec
  let emit: (String) -> Void

  var body: some View {
    // Spacing 8 and 48/56pt targets, up from 2 and 44/48: on Peter's phone the
    // first cut was "so close" that a thumb landed on the neighbour. The
    // capsule grows a little; the article behind it is not what a listener is
    // looking at.
    // The ISLAND is the glass surface — the same Liquid Glass the corner
    // buttons and the search island wear — with plain glyphs on it. Peter's
    // first note read as "make each button glass"; he meant the capsule that
    // hosts them: "a bit transparent background and the same colours as the
    // other buttons". `.interactive()` on the effect is what keeps the inner
    // buttons tappable — a non-interactive glass surface wrapping controls
    // swallowed their taps in the search island. Verified by tapping
    // skip-forward on the simulator and watching the position advance.
    // Budget: 402pt (iPhone 17 Pro) minus 24pt margins. Five circles at
    // 46/54 plus the two labels and 6pt gaps come to ~340pt; the first cut at
    // 52/60 with 10pt gaps was ~412pt and clipped both end buttons.
    HStack(spacing: 6) {
      button("player-back", system: "backward.fill")
      button("player-toggle", system: spec.playing ? "pause.fill" : "play.fill", large: true)
      button("player-forward", system: "forward.fill")
      // `.lineLimit(1)` + `.fixedSize()`: without them SwiftUI wrapped
      // "6 / 178" onto two lines inside the fixed-height host and showed
      // "6" over "…" — which read as a mystery control, not a position.
      // `minimumScaleFactor` instead of `fixedSize`: on a 375pt phone with a
      // "128 / 3400" label the fixed budget could not be met, and two
      // `.required` constraints then break arbitrarily. Letting the label
      // shrink a little keeps it on one line AND inside the screen.
      Text(spec.position)
        .font(.footnote.monospacedDigit())
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        // A floor so the capsule does not re-lay out every paragraph as the
        // digits change width; wide enough for "128 / 178" at full size.
        .frame(minWidth: 64)
        .padding(.horizontal, 2)
      Button { emit("player-rate") } label: {
        Text(spec.rate)
          .font(.footnote.weight(.semibold).monospacedDigit())
          .lineLimit(1)
          .minimumScaleFactor(0.75)
          .frame(minWidth: 46, minHeight: 46)
      }
      .buttonStyle(.plain)
      button("player-stop", system: "stop.fill")
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 5)
    .foregroundStyle(.primary)
    .modifier(GlassIslandSurface())
  }

  private func button(_ id: String, system: String, large: Bool = false) -> some View {
    Button { emit(id) } label: {
      Image(systemName: system)
        .font(large ? .title2 : .title3)
        .frame(width: large ? 54 : 46, height: large ? 54 : 46)
    }
    .buttonStyle(.plain)
  }
}

/// Red dot · elapsed · pause/resume · stop, with a faint level bar under the
/// time. Nothing of ours on the lock screen while recording: iOS's own red
/// microphone indicator is the affordance there.
struct GlassRecorder: View {
  let spec: ChromeRecorderSpec
  let emit: (String) -> Void

  var body: some View {
    // Same metrics as `GlassPlayer`: spacing 6, a large 54pt primary and 46pt
    // secondaries, the same padding and the same glass. Recording and
    // listening are the same kind of thing to a thumb, so they are the same
    // shape and the same size (Peter, 2026-09-05).
    HStack(spacing: 6) {
      Circle()
        .fill(Color.red)
        .frame(width: 10, height: 10)
        .opacity(spec.paused ? 0.35 : 1)
        .padding(.leading, 6)
      Text(spec.interrupted && spec.paused ? (spec.interruptedLabel ?? spec.elapsed) : spec.elapsed)
        .font(.footnote.monospacedDigit())
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        // A floor, like the player's position label, so the capsule does not
        // re-lay out every second as the digits change width.
        .frame(minWidth: 52)
      RecordingWave(paused: spec.paused)
      button("rec-toggle", system: spec.paused ? "record.circle" : "pause.fill", large: true)
      button("rec-stop", system: "stop.fill")
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 5)
    .foregroundStyle(.primary)
    .modifier(GlassIslandSurface())
  }

  private func button(_ id: String, system: String, large: Bool = false) -> some View {
    Button { emit(id) } label: {
      Image(systemName: system)
        .font(large ? .title2 : .title3)
        .frame(width: large ? 54 : 46, height: large ? 54 : 46)
    }
    .buttonStyle(.plain)
  }
}

/// The loudness trace: newest sample at the RIGHT, older ones marching left,
/// the way Voice Memos draws a recording in progress.
///
/// It replaces a single bar showing the instantaneous level, which was fed
/// from the recorder's once-a-second tick — at that rate a level bar barely
/// moves, so there was nothing to read and nothing that looked alive (Peter,
/// device, build 51: "during recording I don't get the progress line
/// displayed").
///
/// Sampled HERE, natively, twenty times a second. Pushing that across the JS
/// bridge would be 20 messages a second for decoration, and the bridge is
/// asleep with the screen locked while the recorder is still running.
struct RecordingWave: View {
  let paused: Bool
  private static let height: CGFloat = 22
  // `@StateObject`, so the meter and its timer belong to the VIEW'S LIFETIME
  // rather than to each `init`. The island's hosting controller has its
  // `rootView` reassigned on every chrome push — which is at least once a
  // second while recording, because the elapsed time is part of the spec —
  // and a timer stored as a plain `let` would be rebuilt every one of those,
  // with the old subscription's teardown left to chance. Stacked timers would
  // show as a trace that speeds up the longer you record.
  @StateObject private var meter = WaveMeter()

  var body: some View {
    HStack(alignment: .center, spacing: 2) {
      ForEach(Array(meter.samples.enumerated()), id: \.offset) { _, level in
        Capsule()
          .fill(Color.primary.opacity(paused ? 0.25 : 0.6))
          // A floor of 2pt so silence is a row of dots rather than a gap:
          // the trace should read as "running, and quiet", not as "stopped".
          .frame(width: 2, height: max(2, level * Self.height))
      }
    }
    // Trailing, so a half-filled history hugs the right edge and the newest
    // sample is always in the same place.
    .frame(width: 104, height: Self.height, alignment: .trailing)
    // Keyed on `paused`: SwiftUI cancels and restarts this when it changes,
    // so a paused recording stops sampling entirely instead of waking twenty
    // times a second to do nothing.
    .task(id: paused) { paused ? meter.stop() : meter.start() }
    .onDisappear { meter.stop() }
  }
}

/// Owns the trace's samples and the timer that fills them.
///
/// A class, held by `@StateObject`, because the thing that must survive the
/// island being reconstructed is the TIMER, not just the samples.
final class WaveMeter: ObservableObject {
  /// How many bars fit the strip. Older samples fall off the left.
  private static let capacity = 32
  @Published private(set) var samples: [CGFloat] = []
  private var timer: Timer?

  /// The run loop is named, not inherited. `Timer.scheduledTimer` attaches
  /// to whatever thread's run loop is current AT THE CALL SITE, and
  /// SwiftUI's `.task` closure is `@Sendable () async -> Void` — its
  /// execution context is not part of the type, so scheduling that way would
  /// rest the timer's thread on an inference rather than on a rule. On a
  /// cooperative-pool worker, whose run loop is not spinning, it would
  /// simply never fire: no crash, no log, an empty `samples` array and a
  /// flat trace — which is EXACTLY the symptom this view was written to fix
  /// (Peter, build 51: "during recording I don't get the progress line
  /// displayed"). Naming `RunLoop.main` also keeps `currentLevel()`, and so
  /// `AVAudioRecorder.updateMeters()`, on the one thread the recorder's own
  /// 1 Hz tick already calls it from.
  ///
  /// `.common` rather than `.default`: articles stay readable while
  /// recording, and a default-mode timer stops dead for the whole of a
  /// scroll gesture — the trace would freeze exactly while someone reads.
  func start() {
    guard timer == nil else { return }
    let t = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
      dispatchPrecondition(condition: .onQueue(.main))
      guard let self else { return }
      self.samples.append(CGFloat(Recorder.shared.currentLevel()))
      if self.samples.count > Self.capacity {
        self.samples.removeFirst(self.samples.count - Self.capacity)
      }
    }
    RunLoop.main.add(t, forMode: .common)
    timer = t
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }

  deinit { timer?.invalidate() }
}

/// The player island's surface: real Liquid Glass on iOS 26 — the same
/// material the corner buttons and search island are made of — and the
/// bordered-look fallback (`Color.primary.opacity(0.14)`, as the corner
/// buttons' pre-26 style renders) before that.
struct GlassIslandSurface: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      GlassEffectContainer {
        content.glassEffect(.regular.interactive(), in: Capsule())
      }
    } else {
      content.background {
        Capsule()
          .fill(Color.primary.opacity(0.14))
          .overlay(Capsule().strokeBorder(Color.primary.opacity(0.10), lineWidth: 0.5))
      }
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
