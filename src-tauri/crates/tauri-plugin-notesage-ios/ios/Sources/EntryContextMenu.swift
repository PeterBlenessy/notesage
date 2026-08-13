// EntryContextMenu.swift — long-press preview + action menu (#680).
//
// The Apple Notes shape Peter asked for: the pressed item lifts out of the
// list as a large rounded PREVIEW card over a blurred backdrop, with the
// actions in a panel beneath it — an inline row of icon buttons
// (Share / Pin / Delete) above a list of full-width rows (Rename).
//
// Why this is a hand-built presentation rather than a real `UIContextMenu`:
// a system context menu is driven by `UIContextMenuInteraction`, which must
// be attached to the pressed VIEW and starts tracking at touch-down. The
// pressed item here is web content inside one WKWebView — there is no native
// view per row to attach to, and UIKit exposes no way to raise a context menu
// programmatically at a point. Everything visible is still native (real
// material, real spring physics, real haptics), so it reads as the system
// control it imitates.

import QuartzCore
import SwiftUI
import UIKit

struct EntryMenuItemSpec: Decodable, Identifiable {
  let id: String
  let title: String
  /// SF Symbol name.
  let systemImage: String
  let destructive: Bool?
  /// `true` → the compact icon row at the top; `false`/absent → a list row.
  let inline: Bool?
}

struct EntryMenuRect: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  var cgRect: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}

struct EntryMenuSpec: Decodable {
  let title: String
  let subtitle: String?
  /// File to render into the preview card. Absent for folders.
  let previewRelPath: String?
  let isDirectory: Bool
  /// The pressed item's rect in webview coordinates — the preview grows out
  /// of it, so the card visibly comes from the thing you pressed.
  let sourceRect: EntryMenuRect?
  let items: [EntryMenuItemSpec]
}

/// Presents the menu and reports the chosen item id (`nil` = dismissed).
enum EntryContextMenu {
  @MainActor
  static func present(
    _ spec: EntryMenuSpec,
    over presenter: UIViewController,
    completion: @escaping (String?) -> Void
  ) {
    let controller = EntryContextMenuController(spec: spec, completion: completion)
    controller.modalPresentationStyle = .overFullScreen
    // No system transition: the view animates itself in from the source rect.
    controller.modalTransitionStyle = .crossDissolve
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    presenter.present(controller, animated: false)
  }
}

final class EntryContextMenuController: UIViewController {
  private let spec: EntryMenuSpec
  private let completion: (String?) -> Void
  private var answered = false

  init(spec: EntryMenuSpec, completion: @escaping (String?) -> Void) {
    self.spec = spec
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    let root = EntryContextMenuView(spec: spec) { [weak self] id in
      self?.finish(with: id)
    }
    let host = UIHostingController(rootView: root)
    host.view.backgroundColor = .clear
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)
  }

  /// Resolve exactly once — a tap that lands as the dismiss animation starts
  /// must not deliver a second answer.
  private func finish(with id: String?) {
    guard !answered else { return }
    answered = true
    dismiss(animated: false) { [completion] in completion(id) }
  }
}

// MARK: - SwiftUI

private let CARD_CORNER: CGFloat = 22
private let PANEL_CORNER: CGFloat = 14

struct EntryContextMenuView: View {
  let spec: EntryMenuSpec
  let onChoose: (String?) -> Void

  @State private var shown = false
  /// The preview card's laid-out frame in window coordinates. The open/close
  /// animation is derived from it, so nothing animates until it is known.
  @State private var cardFrame: CGRect = .zero
  /// Downward drag on the preview — Apple dismisses the menu on a swipe down,
  /// and a finger that has just long-pressed is already on the card.
  @State private var dragY: CGFloat = 0
  @State private var preview: UIImage?

  private var inlineItems: [EntryMenuItemSpec] { spec.items.filter { $0.inline == true } }
  private var listItems: [EntryMenuItemSpec] { spec.items.filter { $0.inline != true } }

  /// Where the preview card sits when collapsed: exactly over the pressed
  /// row, at the row's height. Opening interpolates from here, closing back
  /// to it, so the card visibly grows OUT of the item and returns INTO it.
  ///
  /// Webview CSS pixels and window points line up because the webview fills
  /// the window; a wrong or missing rect degrades to a plain centred zoom
  /// rather than flying in from a corner.
  private var collapsed: (scale: CGFloat, offset: CGSize) {
    guard let source = spec.sourceRect?.cgRect, cardFrame.height > 0, source.height > 0 else {
      return (0.86, .zero)
    }
    return (
      max(0.1, min(1, source.height / cardFrame.height)),
      CGSize(
        width: source.midX - cardFrame.midX,
        height: source.midY - cardFrame.midY)
    )
  }

  var body: some View {
    ZStack {
      Rectangle()
        .fill(.ultraThinMaterial)
        .ignoresSafeArea()
        .opacity(shown ? 1 : 0)
        .onTapGesture { dismiss(nil) }

      VStack(spacing: 12) {
        previewCard
          .background(
            GeometryReader { proxy in
              Color.clear.onAppear { cardFrame = proxy.frame(in: .global) }
            }
          )
          .scaleEffect(shown ? 1 : collapsed.scale, anchor: .center)
          .offset(
            x: shown ? 0 : collapsed.offset.width,
            y: shown ? max(0, dragY) : collapsed.offset.height)
          // Never fully transparent while collapsed: the card is meant to BE
          // the row, so it fades the last of the way rather than appearing.
          .opacity(shown ? 1 : 0.35)
        menuPanel
          .scaleEffect(shown ? 1 : 0.92, anchor: .top)
          .opacity(shown ? 1 : 0)
          .offset(y: max(0, dragY))
      }
      .padding(.horizontal, 20)
    }
    .onAppear { loadPreview() }
    .onChange(of: cardFrame) { _ in
      // Open only once the geometry is known, or the first frame would
      // interpolate from a placeholder and the morph would look like a jump.
      guard !shown, cardFrame.height > 0 else { return }
      withAnimation(.spring(response: 0.38, dampingFraction: 0.8)) { shown = true }
    }
  }

  private var previewCard: some View {
    ZStack {
      RoundedRectangle(cornerRadius: CARD_CORNER, style: .continuous)
        .fill(Color(uiColor: .secondarySystemBackground))
      if let preview {
        Image(uiImage: preview)
          .resizable()
          .aspectRatio(contentMode: .fill)
          .clipShape(RoundedRectangle(cornerRadius: CARD_CORNER, style: .continuous))
      } else {
        // Folders, and files QuickLook can't render, get a legible fallback
        // rather than an empty grey plate.
        VStack(spacing: 10) {
          Image(systemName: spec.isDirectory ? "folder.fill" : "doc.text")
            .font(.system(size: 44, weight: .light))
            .foregroundStyle(.secondary)
          Text(spec.title)
            .font(.headline)
            .multilineTextAlignment(.center)
            .lineLimit(2)
          if let subtitle = spec.subtitle {
            Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
          }
        }
        .padding(24)
      }
    }
    .frame(maxWidth: .infinity)
    .frame(height: 320)
    .shadow(color: .black.opacity(0.28), radius: 24, y: 10)
    .gesture(
      DragGesture()
        .onChanged { value in
          // Only downward travel moves the card; an upward drag is inert
          // rather than lifting it off the top of the screen.
          dragY = max(0, value.translation.height)
        }
        .onEnded { value in
          if value.translation.height > 80 || value.predictedEndTranslation.height > 180 {
            dismiss(nil)
          } else {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { dragY = 0 }
          }
        }
    )
  }

  private var menuPanel: some View {
    VStack(spacing: 0) {
      if !inlineItems.isEmpty {
        HStack(spacing: 0) {
          ForEach(inlineItems) { item in
            Button {
              dismiss(item.id)
            } label: {
              VStack(spacing: 6) {
                Image(systemName: item.systemImage).font(.system(size: 20, weight: .regular))
                Text(item.title).font(.footnote)
              }
              .frame(maxWidth: .infinity)
              .padding(.vertical, 12)
              .foregroundStyle(item.destructive == true ? Color.red : Color.primary)
            }
            .buttonStyle(.plain)
          }
        }
        if !listItems.isEmpty {
          Divider().padding(.horizontal, 16)
        }
      }
      ForEach(listItems) { item in
        Button {
          dismiss(item.id)
        } label: {
          HStack(spacing: 14) {
            Image(systemName: item.systemImage).font(.system(size: 17)).frame(width: 24)
            Text(item.title).font(.body)
            Spacer(minLength: 0)
          }
          .padding(.horizontal, 16)
          .padding(.vertical, 13)
          .contentShape(Rectangle())
          .foregroundStyle(item.destructive == true ? Color.red : Color.primary)
        }
        .buttonStyle(.plain)
      }
    }
    .background(
      RoundedRectangle(cornerRadius: PANEL_CORNER, style: .continuous)
        .fill(Color(uiColor: .secondarySystemBackground))
    )
    .frame(maxWidth: 320)
    .shadow(color: .black.opacity(0.22), radius: 18, y: 8)
  }

  private func dismiss(_ id: String?) {
    // Same spring in reverse — the card shrinks back INTO the row it came
    // from instead of fading in place.
    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
      shown = false
      dragY = 0
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) { onChoose(id) }
  }

  private func loadPreview() {
    guard let rel = spec.previewRelPath else { return }
    LibraryAccess.thumbnail(rel, maxPixel: 600) { result in
      guard case .success(let data) = result, let image = UIImage(data: data) else { return }
      DispatchQueue.main.async {
        withAnimation(.easeOut(duration: 0.18)) { preview = image }
      }
    }
  }
}
