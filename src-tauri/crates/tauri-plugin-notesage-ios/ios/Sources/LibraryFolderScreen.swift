//
//  One folder, drawn natively.
//
//  The second piece of the native browsing surface (PRD
//  `2026-09-11-native-browsing-surface.md`, #1000), and the one that makes the
//  four bugs of 2026-09-11 impossible rather than fixed:
//
//    * #994's blink — this controller is pushed onto the stack and stays
//      there. Opening a document does not unmount it, so coming back reveals
//      a screen that was never taken down. There is nothing to re-render and
//      nothing to blank.
//    * #995's occlusion — the chrome islands and this screen are both native
//      and both laid out by the same process. No second layer draws here.
//    * the blank tiles — `UICollectionView` prefetch and cell reuse, instead
//      of an `IntersectionObserver` over a promise cache that could not be
//      read synchronously.
//    * the "bump or zoom" and the black swipe-back — no `WKWebView` moves
//      between controllers, so none of the freeze/thaw handoff applies. UIKit
//      animates the transition, alone.
//
//  What this file does NOT own: the order of the entries (`LibraryOrdering`,
//  which is UIKit-free and tested on macOS), the menu (`EntryContextMenu`,
//  already native), thumbnail generation (`LibraryAccess.thumbnail` +
//  `ThumbnailCache`, already native), or the reader.
//

import UIKit

// MARK: - What the screen needs from its host

/// Everything the screen cannot work out for itself. Injected rather than
/// reached for, so the screen can be driven from a test harness or a preview
/// without a granted library.
protocol LibraryFolderHost: AnyObject {
    /// Push another folder.
    func openFolder(_ rel: String, title: String)
    /// Hand a document to the reader — the one thing still rendered by the
    /// web layer.
    func openDocument(_ rel: String)
    /// Paths pinned in `.notesage/pins.json`.
    func pinnedPaths() -> Set<String>
    /// Paths read recently on this device.
    func recentlyRead() -> Set<String>
    /// Reading progress, 0…1, from the shared sidecar.
    func progress(for rel: String) -> Double
    /// Resolve a section title key against the localisation table.
    func localized(_ key: String) -> String
}

/// How this folder is displayed. Per folder, remembered by the host.
struct LibraryViewSettings: Equatable {
    enum Layout: String, Codable { case list, gallery }
    var layout: Layout = .list
    var condensed = false
    var sort: LibrarySortMode = .name
    var group: LibraryGroupMode = .none
}

// MARK: - The screen

final class LibraryFolderScreen: UIViewController {
    /// Relative to the library root; `""` is the root itself.
    let relPath: String
    private weak var host: LibraryFolderHost?
    private var settings: LibraryViewSettings
    /// The filter typed into the search island, or empty.
    private var filter = ""

    private var sections: [LibrarySection] = []
    private var entries: [LibraryEntry] = []

    private var collectionView: UICollectionView!
    private var dataSource: UICollectionViewDiffableDataSource<String, String>!
    /// Entries by path — the diffable data source carries identifiers only, so
    /// a re-list that changes a file's date does not have to invalidate the
    /// identity that keeps its cell in place.
    private var byPath: [String: LibraryEntry] = [:]
    private let refreshControl = UIRefreshControl()

    private let thumbnails = ThumbnailLoader()

    init(relPath: String, title: String, settings: LibraryViewSettings, host: LibraryFolderHost) {
        self.relPath = relPath
        self.settings = settings
        self.host = host
        super.init(nibName: nil, bundle: nil)
        self.title = title
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    // MARK: Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        collectionView = UICollectionView(frame: .zero, collectionViewLayout: makeLayout())
        collectionView.translatesAutoresizingMaskIntoConstraints = false
        collectionView.backgroundColor = .clear
        collectionView.delegate = self
        collectionView.prefetchDataSource = self
        collectionView.alwaysBounceVertical = true
        // The bottom islands float over the content, so the last row has to be
        // able to scroll clear of them. The top is the navigation bar's, which
        // UIKit already accounts for.
        collectionView.contentInset.bottom = 96
        collectionView.refreshControl = refreshControl
        refreshControl.addTarget(self, action: #selector(pulled), for: .valueChanged)
        view.addSubview(collectionView)
        NSLayoutConstraint.activate([
            collectionView.topAnchor.constraint(equalTo: view.topAnchor),
            collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        configureDataSource()
        reload()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Returning from a document: the listing may have changed under us —
        // a capture swept, a file renamed, progress advanced. Re-read, but do
        // NOT blank first. The rows on screen stay until new ones replace
        // them, which is the whole point of not being a web view that
        // remounts (#994).
        reload()
    }

    // MARK: Settings and filter, pushed in by the host

    func apply(settings next: LibraryViewSettings) {
        guard next != settings else { return }
        let layoutChanged = next.layout != settings.layout || next.condensed != settings.condensed
        settings = next
        if layoutChanged {
            collectionView.setCollectionViewLayout(makeLayout(), animated: true)
        }
        rebuildSections(animated: true)
    }

    func apply(filter next: String) {
        guard next != filter else { return }
        filter = next
        rebuildSections(animated: true)
    }

    // MARK: Loading

    @objc private func pulled() {
        reload()
    }

    /// Re-read the folder. Off the main thread, because a directory of several
    /// hundred entries on an iCloud path is not instant and this runs on every
    /// return from a document.
    private func reload() {
        let rel = relPath
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let listed = (try? LibraryAccess.listDirectory(rel)) ?? []
            // Hidden entries are excluded outright — internal machinery and
            // comment sidecars must not be one tap away in the browser.
            let visible =
                listed
                .filter { !$0.hidden && !$0.name.hasPrefix(".") }
                .map {
                    LibraryEntry(
                        name: $0.name, path: $0.path, isDirectory: $0.is_directory,
                        modified: $0.modified)
                }
            DispatchQueue.main.async {
                guard let self else { return }
                self.refreshControl.endRefreshing()
                self.entries = visible
                self.byPath = Dictionary(visible.map { ($0.path, $0) }, uniquingKeysWith: { a, _ in a })
                self.rebuildSections(animated: true)
            }
        }
    }

    private func rebuildSections(animated: Bool) {
        guard let host else { return }
        let matched =
            filter.isEmpty
            ? entries
            : entries.filter { $0.name.range(of: filter, options: .caseInsensitive) != nil }

        let sorted = sortLibraryEntries(matched, by: settings.sort)
        let context = LibraryOrderingContext(
            sort: settings.sort, group: settings.group,
            pinned: host.pinnedPaths(), recentlyRead: host.recentlyRead())
        sections = groupLibraryEntries(sorted, context: context, monthTitle: Self.monthTitle)

        var snapshot = NSDiffableDataSourceSnapshot<String, String>()
        for section in sections {
            snapshot.appendSections([section.key])
            snapshot.appendItems(section.items.map(\.path), toSection: section.key)
        }
        dataSource.apply(snapshot, animatingDifferences: animated)
    }

    /// A month header, in the device's language, with the year dropped inside
    /// the current year — "August" reads better than "August 2026" in 2026.
    private static func monthTitle(_ timestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: timestamp)
        let calendar = Calendar.current
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate(
            calendar.component(.year, from: date) == calendar.component(.year, from: Date())
                ? "MMMM" : "MMMM y")
        return formatter.string(from: date)
    }

    // MARK: Layout

    private func makeLayout() -> UICollectionViewLayout {
        let header = NSCollectionLayoutBoundarySupplementaryItem(
            layoutSize: .init(widthDimension: .fractionalWidth(1), heightDimension: .estimated(34)),
            elementKind: UICollectionView.elementKindSectionHeader,
            alignment: .top)
        // Sticky, like the web layer's — a header that scrolls away leaves a
        // long section with nothing saying what it is.
        header.pinToVisibleBounds = true

        let section: NSCollectionLayoutSection
        switch settings.layout {
        case .list:
            let height: CGFloat = settings.condensed ? 56 : 88
            let item = NSCollectionLayoutItem(
                layoutSize: .init(widthDimension: .fractionalWidth(1), heightDimension: .absolute(height)))
            let group = NSCollectionLayoutGroup.horizontal(
                layoutSize: .init(
                    widthDimension: .fractionalWidth(1), heightDimension: .absolute(height)),
                subitems: [item])
            section = NSCollectionLayoutSection(group: group)

        case .gallery:
            let columns = settings.condensed ? 4 : 3
            let spacing: CGFloat = settings.condensed ? 8 : 12
            let item = NSCollectionLayoutItem(
                layoutSize: .init(
                    widthDimension: .fractionalWidth(1.0 / CGFloat(columns)),
                    heightDimension: .fractionalHeight(1)))
            item.contentInsets = .init(
                top: 0, leading: spacing / 2, bottom: 0, trailing: spacing / 2)
            // Estimated, not absolute: a card is a square picture plus one or
            // two lines of caption, and the caption's height follows the
            // device's text size.
            let group = NSCollectionLayoutGroup.horizontal(
                layoutSize: .init(
                    widthDimension: .fractionalWidth(1),
                    heightDimension: .estimated(settings.condensed ? 120 : 168)),
                subitems: Array(repeating: item, count: columns))
            section = NSCollectionLayoutSection(group: group)
            section.interGroupSpacing = settings.condensed ? 12 : 20
            section.contentInsets = .init(
                top: 0, leading: 12 - spacing / 2, bottom: 0, trailing: 12 - spacing / 2)
        }
        section.boundarySupplementaryItems = [header]
        return UICollectionViewCompositionalLayout(section: section)
    }

    // MARK: Cells

    private func configureDataSource() {
        let listCell = UICollectionView.CellRegistration<LibraryListCell, String> {
            [weak self] cell, _, path in
            guard let self, let entry = self.byPath[path] else { return }
            cell.configure(
                entry, condensed: self.settings.condensed,
                progress: self.host?.progress(for: path) ?? 0,
                recentlyRead: self.host?.recentlyRead().contains(path) ?? false)
            self.thumbnails.load(entry, into: cell)
        }
        let gridCell = UICollectionView.CellRegistration<LibraryGridCell, String> {
            [weak self] cell, _, path in
            guard let self, let entry = self.byPath[path] else { return }
            cell.configure(
                entry, condensed: self.settings.condensed,
                progress: self.host?.progress(for: path) ?? 0,
                recentlyRead: self.host?.recentlyRead().contains(path) ?? false)
            self.thumbnails.load(entry, into: cell)
        }

        dataSource = UICollectionViewDiffableDataSource<String, String>(
            collectionView: collectionView
        ) { [weak self] collectionView, indexPath, path in
            guard let self else { return UICollectionViewCell() }
            switch self.settings.layout {
            case .list:
                return collectionView.dequeueConfiguredReusableCell(
                    using: listCell, for: indexPath, item: path)
            case .gallery:
                return collectionView.dequeueConfiguredReusableCell(
                    using: gridCell, for: indexPath, item: path)
            }
        }

        let headerReg = UICollectionView.SupplementaryRegistration<LibrarySectionHeader>(
            elementKind: UICollectionView.elementKindSectionHeader
        ) { [weak self] header, _, indexPath in
            guard let self, indexPath.section < self.sections.count else { return }
            let section = self.sections[indexPath.section]
            let title =
                section.titleLiteral ?? section.titleKey.map { self.host?.localized($0) ?? $0 }
            header.setTitle(title)
        }
        dataSource.supplementaryViewProvider = { collectionView, kind, indexPath in
            collectionView.dequeueConfiguredReusableSupplementary(using: headerReg, for: indexPath)
        }
    }

    private func entry(at indexPath: IndexPath) -> LibraryEntry? {
        dataSource.itemIdentifier(for: indexPath).flatMap { byPath[$0] }
    }
}

// MARK: - Selection, menus, prefetch

extension LibraryFolderScreen: UICollectionViewDelegate {
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: true)
        guard let entry = entry(at: indexPath) else { return }
        if entry.isDirectory {
            host?.openFolder(entry.path, title: entry.name)
        } else {
            host?.openDocument(entry.path)
        }
    }

    /// Long press — the same menu the web rows used, which was already native.
    func collectionView(
        _ collectionView: UICollectionView,
        contextMenuConfigurationForItemsAt indexPaths: [IndexPath],
        point: CGPoint
    ) -> UIContextMenuConfiguration? {
        guard let indexPath = indexPaths.first, entry(at: indexPath) != nil else { return nil }
        // Handled by `EntryContextMenu`'s own presentation, which is a
        // full-screen controller rather than a `UIContextMenu` — keeping one
        // menu implementation matters more than using the system affordance
        // here, since the same menu is reached from three places.
        return nil
    }
}

extension LibraryFolderScreen: UICollectionViewDataSourcePrefetching {
    /// The lead that makes this a prefetch rather than a lazy load. UIKit
    /// decides how far ahead; there is no margin to get wrong, and no root to
    /// pick — the two mistakes the web version made in one afternoon.
    func collectionView(_ collectionView: UICollectionView, prefetchItemsAt indexPaths: [IndexPath]) {
        for path in indexPaths.compactMap({ entry(at: $0) }) where !path.isDirectory {
            thumbnails.prefetch(path)
        }
    }

    func collectionView(
        _ collectionView: UICollectionView, cancelPrefetchingForItemsAt indexPaths: [IndexPath]
    ) {
        for path in indexPaths.compactMap({ entry(at: $0) }) {
            thumbnails.cancel(path.path)
        }
    }
}
