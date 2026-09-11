//
//  The cells a folder is drawn with, and the loader that fills their pictures.
//
//  Part of the native browsing surface (#1000). Two cells — a list row and a
//  gallery card — and one loader shared by both.
//
//  The loader is the piece worth reading. Its web predecessor
//  (`mobile-thumbnails.ts` plus `useVisibleSoon`) needed a concurrency
//  limiter, a promise cache, a separate synchronous cache, an
//  `IntersectionObserver` with a hand-picked root margin, and a scroll-parent
//  walk to find the right root — and still produced two bugs in one afternoon
//  (blank tiles on remount, a lead that could not apply). Almost all of that
//  was reimplementing what `UICollectionView` does: cell reuse decides what is
//  worth drawing, prefetching decides what is worth starting, and a cached
//  image is just an image.
//
//  What remains here is the part that is genuinely ours: a disk cache that
//  survives launches, and cancelling work for a cell that has been reused.
//

import UIKit

// MARK: - Thumbnails

/// Loads a cell's picture, and gets out of the way when the cell is reused.
///
/// One per screen. Cancellation is by path rather than by token because the
/// caller that cancels — `cancelPrefetchingForItemsAt` — knows the entry, not
/// whatever handle a request returned.
final class ThumbnailLoader {
    /// Longest edge in points. A card is roughly 120pt wide at 3-across; the
    /// generator is asked for twice that so it stays sharp on a 3x screen
    /// without holding a press photo in memory per row.
    private static let maxPixel: CGFloat = 240

    private var inFlight: Set<String> = []
    /// Kept in memory for the life of the screen so a scroll back up does not
    /// re-read the disk cache. Bounded by `NSCache`, which evicts under
    /// pressure rather than growing until the app is killed.
    private let memory = NSCache<NSString, UIImage>()

    init() {
        // A few hundred thumbnails at 240pt is tens of megabytes; the count
        // limit is the cheap guard, and NSCache drops the rest under pressure.
        memory.countLimit = 300
    }

    /// What is already known, WITHOUT waiting — read during cell
    /// configuration, so a reused cell showing a file it has drawn before
    /// never blanks first. That exact omission is what made the blink worse
    /// rather than better on the web side (build 61).
    func cached(_ rel: String) -> UIImage? {
        let key = Self.cacheKey(rel, dark: Self.isDark)
        if let image = memory.object(forKey: key as NSString) { return image }
        guard let data = ThumbnailCache.get(key), let image = UIImage(data: data) else {
            return nil
        }
        memory.setObject(image, forKey: key as NSString)
        return image
    }

    /// Whether the app is in dark mode right now. Read per request rather than
    /// captured: a note preview is drawn in these colours, and one cached
    /// under the wrong theme lasts the whole session.
    private static var isDark: Bool {
        UITraitCollection.current.userInterfaceStyle == .dark
    }

    private static func cacheKey(_ rel: String, dark: Bool) -> String {
        isNote(rel) ? noteKey(rel, dark: dark) : key(rel)
    }

    /// Which pipeline a file goes through. A note is DRAWN by us; everything
    /// else QuickLook renders better than we could.
    private static func isNote(_ rel: String) -> Bool {
        let kind = LibraryFileKind.of(rel)
        return kind == .markdown || kind == .text
    }

    func prefetch(_ entry: LibraryEntry) {
        guard cached(entry.path) == nil else { return }
        start(entry.path)
    }

    func cancel(_ rel: String) {
        inFlight.remove(rel)
    }

    /// Fill a cell, now if possible and later if not.
    func load(_ entry: LibraryEntry, into cell: LibraryThumbnailCell) {
        guard !entry.isDirectory else {
            cell.showIcon(for: entry)
            return
        }
        if let image = cached(entry.path) {
            cell.showThumbnail(image)
            return
        }
        cell.showIcon(for: entry)
        start(entry.path) { [weak cell] image in
            // The cell may have been reused for another file while this ran —
            // `representedPath` is the check that stops a picture landing on
            // the wrong row.
            guard let cell, cell.representedPath == entry.path else { return }
            cell.showThumbnail(image)
        }
    }

    private static func key(_ rel: String) -> String {
        // A QuickLook picture is theme-independent; a note preview is DRAWN in
        // the app's colours, so it carries the theme. Same reasoning as the
        // web cache's `theme:path` key, and the same failure if it is left
        // out: a light preview cached in a dark app for the whole session.
        "ql:\(rel)"
    }

    private static func noteKey(_ rel: String, dark: Bool) -> String {
        "note:\(dark ? "dark" : "light"):\(rel)"
    }

    /// How many lines of a note its preview shows. The same ten the web
    /// pipeline used — enough to recognise the note, cheap to draw.
    private static let previewLines = 10

    /// Draw a note's first lines, in the app's colours.
    ///
    /// NOT QuickLook. QuickLook renders a `.md` file as a white page of raw
    /// text, which in a dark app is a stack of glaring white tiles — and the
    /// web pipeline did not do that either: it rendered the source through
    /// comrak in the app's theme.
    ///
    /// This draws the SOURCE rather than rendered markdown, which is the one
    /// place the native surface is currently poorer than the web one. Going
    /// through comrak means an HTML render per cell, and a `WKWebView` per
    /// cell at three-across is the obvious wrong answer; doing it properly
    /// needs an offscreen renderer and a measurement, and that is a follow-up
    /// rather than a guess. Source text in the right colours beats a white
    /// rectangle today.
    private func drawNotePreview(_ rel: String, size: CGSize, dark: Bool) -> UIImage? {
        guard let raw = try? LibraryAccess.readFile(rel) else { return nil }
        var body = raw
        // Strip a leading YAML frontmatter block, mirroring the web preview.
        if body.hasPrefix("---\n"), let end = body.range(of: "\n---", range: body.index(body.startIndex, offsetBy: 3)..<body.endIndex) {
            body = String(body[end.upperBound...])
        }
        let text = body.split(separator: "\n", omittingEmptySubsequences: false)
            .prefix(Self.previewLines)
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        let traits = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { context in
            UIColor.secondarySystemBackground.resolvedColor(with: traits).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byTruncatingTail
            // Sized against the IMAGE, not the tile. The preview is rendered
            // at `maxPixel` (240) and shown at 40–72pt, so a font chosen for
            // the tile arrives about a third of its intended size — the first
            // attempt used 7pt and landed at roughly 2pt, a grey smudge. Ten
            // lines across 240px is ~24px a line, so ~17px is the size that
            // fills the tile the way the web preview did.
            let inset: CGFloat = size.width / 16
            (text as NSString).draw(
                in: CGRect(
                    x: inset, y: inset,
                    width: size.width - inset * 2, height: size.height - inset * 2),
                withAttributes: [
                    .font: UIFont.systemFont(ofSize: size.width / 14),
                    .foregroundColor: UIColor.label.resolvedColor(with: traits),
                    .paragraphStyle: paragraph,
                ])
        }
    }

    private func start(_ rel: String, completion: ((UIImage) -> Void)? = nil) {
        guard !inFlight.contains(rel) else { return }
        inFlight.insert(rel)

        if Self.isNote(rel) {
            let dark = Self.isDark
            let size = CGSize(width: Self.maxPixel, height: Self.maxPixel)
            // Off the main thread: it is a file read plus a text render, and
            // this runs for every note in the folder.
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let image = self?.drawNotePreview(rel, size: size, dark: dark)
                DispatchQueue.main.async {
                    guard let self else { return }
                    let wasCancelled = !self.inFlight.contains(rel)
                    self.inFlight.remove(rel)
                    guard let image else { return }
                    let key = Self.cacheKey(rel, dark: dark)
                    self.memory.setObject(image, forKey: key as NSString)
                    if let data = image.pngData() { ThumbnailCache.put(key, data) }
                    if !wasCancelled { completion?(image) }
                }
            }
            return
        }

        LibraryAccess.thumbnail(rel, maxPixel: Self.maxPixel) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                // Cancelled while it ran: the work is finished anyway, so the
                // result is still worth caching — it is the CELL that must not
                // be touched.
                let wasCancelled = !self.inFlight.contains(rel)
                self.inFlight.remove(rel)
                guard case .success(let data) = result, let image = UIImage(data: data) else {
                    return
                }
                let key = Self.cacheKey(rel, dark: Self.isDark)
                self.memory.setObject(image, forKey: key as NSString)
                ThumbnailCache.put(key, data)
                if !wasCancelled { completion?(image) }
            }
        }
    }
}

// MARK: - Shared cell surface

/// What `ThumbnailLoader` needs of a cell, so the two cells share one loader.
protocol LibraryThumbnailCell: AnyObject {
    /// The entry this cell is currently drawing — the guard against a slow
    /// picture landing on a reused cell.
    var representedPath: String? { get }
    func showThumbnail(_ image: UIImage)
    func showIcon(for entry: LibraryEntry)
}

/// The SF Symbol that stands in for a file with no picture.
func librarySymbol(for entry: LibraryEntry) -> String {
    if entry.isDirectory { return "folder" }
    switch LibraryFileKind.of(entry.name) {
    case .markdown: return "doc.text"
    case .text: return "chevron.left.forwardslash.chevron.right"
    case .pdf: return "doc.richtext"
    case .image: return "photo"
    case .media: return "play.rectangle"
    case .doc: return "doc"
    case .html: return "safari"
    case .other: return "doc"
    }
}

// MARK: - List row

final class LibraryListCell: UICollectionViewCell, LibraryThumbnailCell {
    private(set) var representedPath: String?

    private let tile = UIImageView()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let progressBar = UIProgressView(progressViewStyle: .default)
    private let separator = UIView()
    private var tileSize: NSLayoutConstraint!

    override init(frame: CGRect) {
        super.init(frame: frame)

        tile.contentMode = .scaleAspectFill
        tile.clipsToBounds = true
        tile.layer.cornerRadius = 8
        tile.backgroundColor = .secondarySystemFill
        tile.tintColor = .secondaryLabel

        titleLabel.font = .preferredFont(forTextStyle: .body)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.numberOfLines = 1

        subtitleLabel.font = .preferredFont(forTextStyle: .footnote)
        subtitleLabel.adjustsFontForContentSizeCategory = true
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.numberOfLines = 1

        progressBar.progressTintColor = .label
        progressBar.trackTintColor = .quaternaryLabel

        separator.backgroundColor = .separator

        let text = UIStackView(arrangedSubviews: [titleLabel, subtitleLabel, progressBar])
        text.axis = .vertical
        text.spacing = 2
        text.alignment = .fill

        let row = UIStackView(arrangedSubviews: [tile, text])
        row.axis = .horizontal
        row.spacing = 12
        row.alignment = .center
        row.translatesAutoresizingMaskIntoConstraints = false
        separator.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(row)
        contentView.addSubview(separator)

        tileSize = tile.widthAnchor.constraint(equalToConstant: 72)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            row.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            row.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            tileSize,
            tile.heightAnchor.constraint(equalTo: tile.widthAnchor),
            separator.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            separator.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            separator.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            separator.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func prepareForReuse() {
        super.prepareForReuse()
        representedPath = nil
        tile.image = nil
    }

    func configure(
        _ entry: LibraryEntry, condensed: Bool, progress: Double, recentlyRead: Bool
    ) {
        representedPath = entry.path

        titleLabel.text = entry.name
        // Unread weight — 600 against 400, the Mail convention minus the
        // ornament. A dot beside every row was clutter (2026-09-05).
        let unread = !entry.isDirectory && progress <= 0 && !recentlyRead
        titleLabel.font =
            unread
            ? .preferredFont(forTextStyle: .body).withWeight(.semibold)
            : .preferredFont(forTextStyle: .body)
        subtitleLabel.text = entry.isDirectory ? nil : Self.dateText(entry.modified)
        subtitleLabel.isHidden = entry.isDirectory || condensed
        progressBar.isHidden = progress <= 0 || progress >= 1
        progressBar.progress = Float(progress)
        // The slot is FIXED, so a late picture never reflows the row.
        tileSize.constant = condensed ? 40 : 72
    }

    func showThumbnail(_ image: UIImage) {
        tile.contentMode = .scaleAspectFill
        tile.image = image
    }

    func showIcon(for entry: LibraryEntry) {
        tile.contentMode = .center
        tile.image = UIImage(systemName: librarySymbol(for: entry))
    }

    private static func dateText(_ modified: Double?) -> String? {
        guard let modified else { return nil }
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: Date(timeIntervalSince1970: modified))
    }
}

// MARK: - Gallery card

final class LibraryGridCell: UICollectionViewCell, LibraryThumbnailCell {
    private(set) var representedPath: String?

    private let picture = UIImageView()
    private let titleLabel = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)

        picture.contentMode = .scaleAspectFill
        picture.clipsToBounds = true
        picture.layer.cornerRadius = 10
        picture.backgroundColor = .secondarySystemFill
        picture.tintColor = .secondaryLabel
        picture.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .preferredFont(forTextStyle: .caption1)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 2

        let stack = UIStackView(arrangedSubviews: [picture, titleLabel])
        stack.axis = .vertical
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: contentView.topAnchor),
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor),
            // Square picture, so a grid of mixed content reads as a grid.
            picture.heightAnchor.constraint(equalTo: picture.widthAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func prepareForReuse() {
        super.prepareForReuse()
        representedPath = nil
        picture.image = nil
    }

    func configure(
        _ entry: LibraryEntry, condensed: Bool, progress: Double, recentlyRead: Bool
    ) {
        representedPath = entry.path
        titleLabel.text = entry.name
        titleLabel.numberOfLines = condensed ? 1 : 2
        let unread = !entry.isDirectory && progress <= 0 && !recentlyRead
        titleLabel.font =
            unread
            ? .preferredFont(forTextStyle: .caption1).withWeight(.semibold)
            : .preferredFont(forTextStyle: .caption1)
    }

    func showThumbnail(_ image: UIImage) {
        picture.contentMode = .scaleAspectFill
        picture.image = image
    }

    func showIcon(for entry: LibraryEntry) {
        picture.contentMode = .center
        picture.image = UIImage(systemName: librarySymbol(for: entry))
    }
}

// MARK: - Section header

final class LibrarySectionHeader: UICollectionReusableView {
    private let label = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        // Matches the web layer's sticky header: a translucent band so the
        // content scrolling under it stays legible.
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
        blur.translatesAutoresizingMaskIntoConstraints = false
        addSubview(blur)

        label.font = .preferredFont(forTextStyle: .footnote).withWeight(.semibold)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)

        NSLayoutConstraint.activate([
            blur.topAnchor.constraint(equalTo: topAnchor),
            blur.bottomAnchor.constraint(equalTo: bottomAnchor),
            blur.leadingAnchor.constraint(equalTo: leadingAnchor),
            blur.trailingAnchor.constraint(equalTo: trailingAnchor),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -16),
            label.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            label.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func setTitle(_ title: String?) {
        label.text = title?.uppercased()
        isHidden = title == nil
    }
}

extension UIFont {
    /// A weight variant that keeps the Dynamic Type size it was given.
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        let descriptor = fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.weight: weight]
        ])
        return UIFont(descriptor: descriptor, size: 0)
    }
}
