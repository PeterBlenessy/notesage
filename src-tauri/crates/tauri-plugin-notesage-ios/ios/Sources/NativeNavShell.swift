//  NativeNavShell.swift
//  Notesage iOS plugin
//
//  The mobile shell as a real `UINavigationController` (PRD
//  `docs/prds/2026-09-06-ios-native-navigation.md`).
//
//      UINavigationController
//      ├── Home            the folder cards
//      ├── Folder listing  pushed; the Inbox is one of these
//      └── Document        the reader
//
//  Push, pop, the interactive edge-pop, the parallax, the dimming, the
//  spring-back, the back button and its title all come from UIKit. None of it
//  is ours any more — which is the point. Everything expensive about this
//  reader for a month has been navigation: an edge-swipe built by hand in the
//  web layer (#923), found never to receive a touch on a captured article, and
//  built a second time natively (#947); then a leaving-a-document transition
//  (#950) that would have had to be written from nothing.
//
//  One web view, two visible screens
//  --------------------------------
//  A transition shows the outgoing and incoming screens at once, and there is
//  exactly one web view. So each screen is a controller that holds EITHER the
//  live web view or a snapshot of what it last looked like:
//
//  - Pushing: the outgoing screen is frozen as a snapshot first (`prepare`),
//    the web layer then renders the destination into the still-hidden live
//    view, and only then does the push run (`push`). The slide-in therefore
//    shows the destination, not the screen being left.
//  - Popping: the system owns the gesture, so the parent shows the snapshot
//    taken when it was left. On commit, the live web view moves back into the
//    parent, the web layer re-renders it, and the snapshot is removed once it
//    says so (`rendered`) — never before, or the swap is visible.
//
//  This is the same trick ADR 0010 already plays one screen smaller: a report
//  gets its own web view above the app's.
//
//  What is deliberately NOT native here
//  ------------------------------------
//  The screens themselves. The browsing surface is list and gallery views,
//  density, five grouping modes, sort, filter, thumbnails, progress lines,
//  unread weight, swipe actions and long-press menus — some 3,700 lines of
//  TypeScript with 28 test files behind it. The owner's acceptance criterion
//  is "it must have the same features as the current version", and the way to
//  meet that is to keep the code that already implements them. With the stack
//  in place those screens can migrate to SwiftUI one at a time, each with
//  parity on both sides of the change.

import UIKit
import WebKit

/// One level of the stack. Holds the live web view, or a picture of it.
final class ScreenController: UIViewController {
  /// The web layer's id for this screen — `""` for Home, a relative path for
  /// a folder, `doc:<relPath>` for a document.
  let screenId: String
  private weak var webView: WKWebView?
  private var snapshot: UIView?

  init(screenId: String, title: String?) {
    self.screenId = screenId
    super.init(nibName: nil, bundle: nil)
    self.title = title
    // The bar is translucent and content runs under it, which is the iOS
    // norm and keeps the web layer's existing top padding roughly right.
    edgesForExtendedLayout = .all
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
  }

  /// Put the live web view in this controller, beneath any snapshot already
  /// showing — so a pop can settle before the swap becomes visible.
  func attachLive(_ webView: WKWebView) {
    self.webView = webView
    webView.removeFromSuperview()
    // CONSTRAINTS, not a frame copied from `view.bounds`. A pushed controller
    // has not been laid out by the navigation controller yet — its view still
    // carries whatever size it was created with — so copying bounds here sizes
    // the web view from a rectangle that is about to change, and an
    // autoresizing mask then scales that wrong size proportionally. Pinning to
    // the edges is right whenever layout happens, which is the whole point.
    webView.translatesAutoresizingMaskIntoConstraints = false
    if let snapshot {
      view.insertSubview(webView, belowSubview: snapshot)
    } else {
      view.addSubview(webView)
    }
    NSLayoutConstraint.activate([
      webView.topAnchor.constraint(equalTo: view.topAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  /// Freeze what is on screen right now, so this controller keeps showing it
  /// after the live view has moved on.
  func freeze(from webView: WKWebView) {
    // `afterScreenUpdates: false` — the pixels already on screen are exactly
    // what should be frozen. Waiting for updates would capture the NEXT
    // frame, which during a push is the destination: the outgoing screen
    // would flash the incoming one.
    guard let shot = webView.snapshotView(afterScreenUpdates: false) else { return }
    shot.translatesAutoresizingMaskIntoConstraints = false
    snapshot?.removeFromSuperview()
    snapshot = shot
    view.addSubview(shot)
    NSLayoutConstraint.activate([
      shot.topAnchor.constraint(equalTo: view.topAnchor),
      shot.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      shot.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      shot.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  /// Drop the frozen picture, revealing whatever is live underneath.
  func thaw() {
    snapshot?.removeFromSuperview()
    snapshot = nil
  }

  var isShowingSnapshot: Bool { snapshot != nil }
}

/// The stack, and the bridge that keeps the web layer in step with it.
final class NavShellPresenter: NSObject, UINavigationControllerDelegate {
  static let shared = NavShellPresenter()

  private var nav: UINavigationController?
  private weak var webView: WKWebView?
  /// The controller currently holding the live web view.
  private weak var liveHost: ScreenController?
  /// The top-right control, mirrored from the chrome spec the web layer
  /// already builds — icon, tap action and menu together, not just the menu.
  private var action: ChromeItemSpec?

  var isPresenting: Bool { nav != nil }

  /// The screen the web layer should be rendering — the top of the stack.
  var topScreenId: String? { (nav?.topViewController as? ScreenController)?.screenId }

  // MARK: - Lifecycle

  /// Returns false when there is nothing to build the stack in — the caller
  /// rejects, and the web layer keeps its own chrome rather than standing down
  /// for a bar that does not exist.
  @discardableResult
  func present(rootTitle: String?, over webView: WKWebView) -> Bool {
    dispatchPrecondition(condition: .onQueue(.main))
    guard nav == nil else { return true }
    guard let container = webView.superview else { return false }
    // The responder walk finds the controller a VIEW belongs to, which is the
    // ordinary case — but Tauri's web view can be a direct child of the
    // window, whose next responder is the scene rather than a controller. The
    // window's own root controller is the right answer there, and without the
    // fallback the stack silently never presents.
    guard
      let parent = container.parentViewController
        ?? container.window?.rootViewController
        ?? UIApplication.shared.connectedScenes
          .compactMap({ ($0 as? UIWindowScene)?.keyWindow })
          .first?.rootViewController
    else { return false }
    self.webView = webView

    let root = ScreenController(screenId: "", title: rootTitle)
    let nav = UINavigationController(rootViewController: root)
    nav.delegate = self
    nav.navigationBar.prefersLargeTitles = false
    nav.view.translatesAutoresizingMaskIntoConstraints = false

    parent.addChild(nav)
    // ABOVE the web view, BELOW the chrome hosts. The bottom islands — the
    // "+", the player, the recorder, the search pill — are not navigation and
    // must keep floating over the stack; only the top row (back, breadcrumb,
    // "…") is replaced by the navigation bar, and the web layer stops sending
    // those while this is up.
    container.insertSubview(nav.view, aboveSubview: webView)
    NSLayoutConstraint.activate([
      nav.view.topAnchor.constraint(equalTo: container.topAnchor),
      nav.view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
      nav.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      nav.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
    ])
    nav.didMove(toParent: parent)
    self.nav = nav

    root.attachLive(webView)
    liveHost = root
    applyMenu(to: root)
    ChromeManager.shared.bringChromeToFront()
    return true
  }

  func dismiss() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard let nav, let webView, let container = nav.view.superview else {
      self.nav = nil
      return
    }
    // Hand the web view back to the container it came from, beneath the
    // chrome, before the stack goes away with it still inside.
    webView.removeFromSuperview()
    webView.translatesAutoresizingMaskIntoConstraints = true
    webView.frame = container.bounds
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    container.insertSubview(webView, at: 0)

    nav.willMove(toParent: nil)
    nav.view.removeFromSuperview()
    nav.removeFromParent()
    self.nav = nil
    liveHost = nil
    ChromeManager.shared.bringChromeToFront()
  }

  // MARK: - Driving the stack

  /// Freeze the current screen, ahead of the web layer rendering the next one.
  ///
  /// Split from `push` on purpose: between the two calls the web layer swaps
  /// what the live web view is drawing, and the frozen picture is what keeps
  /// the screen being left looking like itself while that happens.
  func prepare() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard let webView, let host = liveHost else { return }
    host.freeze(from: webView)
  }

  func push(screenId: String, title: String?, animated: Bool) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard let nav, let webView else { return }
    let screen = ScreenController(screenId: screenId, title: title)
    applyMenu(to: screen)
    // The web view moves in BEFORE the push, not after: the animator captures
    // the incoming view's layout as the animation starts, and re-parenting a
    // view into it mid-flight is how a screen ends up sliding in with its
    // content a frame behind. `loadViewIfNeeded` because the controller's view
    // does not exist until something asks for it, and `attachLive` reads its
    // bounds.
    screen.loadViewIfNeeded()
    screen.attachLive(webView)
    liveHost = screen
    nav.pushViewController(screen, animated: animated)
  }

  /// Back to the root, in one move and without animation.
  ///
  /// The recovery path for drift. If the web layer's idea of the stack and the
  /// real one ever disagree — a `didPop` for a screen that is no longer
  /// tracked, say — guessing which of the two is right produces a stack that
  /// lies. Collapsing to the root is the one state both sides can agree on
  /// without asking, and the reconcile that follows pushes whatever the store
  /// actually holds.
  func popToRoot() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard let nav, let webView, let root = nav.viewControllers.first as? ScreenController else {
      return
    }
    root.attachLive(webView)
    root.thaw()
    liveHost = root
    nav.popToRootViewController(animated: false)
  }

  /// A pop the web layer asked for (rather than the user's gesture).
  func pop(animated: Bool) {
    dispatchPrecondition(condition: .onQueue(.main))
    nav?.popViewController(animated: animated)
  }

  func setTitle(_ title: String?) {
    dispatchPrecondition(condition: .onQueue(.main))
    (nav?.topViewController as? ScreenController)?.title = title
  }

  /// The web layer has finished drawing the screen it was told to draw, so the
  /// frozen picture over it can go.
  func rendered(screenId: String) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard let top = nav?.topViewController as? ScreenController, top.screenId == screenId else {
      return
    }
    top.thaw()
  }

  /// Mirror the chrome's top-right control onto the navigation bar.
  ///
  /// The whole spec, not just its menu: that slot is a pencil that EDITS on
  /// tap with a menu behind a long-press, a ✓ that saves and has no menu at
  /// all, or an ellipsis whose tap opens the menu — and flattening the three
  /// into "shows a menu" would lose Save entirely and turn tap-to-edit into a
  /// menu nobody asked for. Taps go back on the same `notesage:chrome`
  /// channel the islands use, so every action keeps working with no second
  /// implementation of any of them.
  func setAction(_ item: ChromeItemSpec?) {
    dispatchPrecondition(condition: .onQueue(.main))
    action = item
    if let top = nav?.topViewController as? ScreenController { applyMenu(to: top) }
  }

  private func applyMenu(to screen: ScreenController) {
    guard let action else {
      screen.navigationItem.rightBarButtonItem = nil
      return
    }
    let image = UIImage(systemName: action.icon)
    let menu = (action.menu?.isEmpty == false)
      ? Self.buildMenu(action.menu ?? []) { [weak self] id in self?.emitChrome(id) }
      : nil

    let item: UIBarButtonItem
    if action.menuOnTap == true, let menu {
      // The slot IS the overflow: tapping opens it, and `id` never fires.
      item = UIBarButtonItem(image: image, menu: menu)
    } else {
      let primary = UIAction(image: image) { [weak self] _ in self?.emitChrome(action.id) }
      item = UIBarButtonItem(primaryAction: primary)
      // Both set: UIKit fires the action on a tap and shows the menu on a
      // long press, which is exactly the island's contract.
      item.menu = menu
    }
    screen.navigationItem.rightBarButtonItem = item
  }

  static func buildMenu(_ items: [ChromeMenuItemSpec], onTap: @escaping (String) -> Void) -> UIMenu {
    // Sections are expressed by `sectionBreak` on the item that STARTS one,
    // matching the chrome overlay's own reading of the same spec.
    var sections: [[ChromeMenuItemSpec]] = []
    for item in items {
      if sections.isEmpty || (item.sectionBreak ?? false) {
        sections.append([item])
      } else {
        sections[sections.count - 1].append(item)
      }
    }
    let children: [UIMenuElement] = sections.map { section in
      UIMenu(
        title: "", options: .displayInline,
        children: section.map { spec in
          let action = UIAction(
            title: spec.title,
            image: spec.icon.flatMap { UIImage(systemName: $0) },
            state: (spec.selected ?? false) ? .on : .off
          ) { _ in onTap(spec.id) }
          return action
        })
    }
    return UIMenu(title: "", children: children)
  }

  // MARK: - Talking to the web layer

  private func emitChrome(_ id: String) {
    guard let data = try? JSONSerialization.data(withJSONObject: ["id": id]),
      let json = String(data: data, encoding: .utf8)
    else { return }
    webView?.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('notesage:chrome',{detail:\(json)}))")
  }

  private func dispatch(_ type: String, detail: String) {
    guard let webView else { return }
    webView.evaluateJavaScript(
      """
      window.dispatchEvent(new CustomEvent('notesage:nav-shell', \
      { detail: Object.assign({ type: \(Self.jsonString(type)) }, \(detail)) }))
      """,
      completionHandler: nil)
  }

  static func jsonString(_ value: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [value]),
      let text = String(data: data, encoding: .utf8)
    else { return "\"\"" }
    return String(text.dropFirst().dropLast())
  }

  // MARK: - UINavigationControllerDelegate

  func navigationController(
    _ navigationController: UINavigationController,
    didShow viewController: UIViewController,
    animated: Bool
  ) {
    guard let screen = viewController as? ScreenController, let webView else { return }
    applyMenu(to: screen)
    // Covers all three endings: a completed push (the live view is already
    // here, so this is a no-op), a completed pop, and a CANCELLED pop — where
    // the child is shown again and still holds the live view.
    guard liveHost !== screen else { return }
    screen.attachLive(webView)
    liveHost = screen
    // The screen is showing its snapshot; tell the web layer to draw itself
    // again, and thaw only when it says it has (`rendered`).
    dispatch("didPop", detail: "{ screenId: \(Self.jsonString(screen.screenId)) }")
    // …but never wait forever. If that message is lost, or the web layer
    // throws before answering, the snapshot stays over a live screen and the
    // app is frozen on a picture — taps land on content nobody can see. Two
    // seconds is far longer than a re-render and short enough that the worst
    // case is a stale image, not a dead screen.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self, weak screen] in
      guard let screen, self?.nav?.topViewController === screen else { return }
      screen.thaw()
    }
  }
}

extension UIView {
  /// The controller this view belongs to, walked up the responder chain.
  ///
  /// The stack has to be a CHILD of a real view controller: appearance
  /// callbacks (`viewWillDisappear`, `didShow`) are what the interactive pop
  /// reports through, and a controller with no parent never receives them.
  var parentViewController: UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let controller = next as? UIViewController { return controller }
      responder = next
    }
    return nil
  }
}
