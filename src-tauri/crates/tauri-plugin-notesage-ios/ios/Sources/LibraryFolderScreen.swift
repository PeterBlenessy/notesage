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
    /// Open a document. `title` is what the row displayed — a capture's own
    /// title, where the file name is a timestamp and a slug — so the reader's
    /// nav bar says the same thing the row did. `nil` for anything whose row
    /// showed its file name.
    func openDocument(_ rel: String, title: String?)
    /// Raise the entry menu. The rows and what they do are assembled by
    /// `mobile-entry-actions.ts`, so this asks rather than rebuilds them.
    func presentMenu(for rel: String)
    /// Run a swipe action. `id` is `share` or `delete`; what each DOES —
    /// including the delete confirmation — lives in `entrySwipeActions`, and
    /// is asked for rather than reimplemented.
    func swipeAction(_ id: String, for rel: String)
    /// Paths pinned in `.notesage/pins.json`.
    func pinnedPaths() -> Set<String>
    /// Paths read recently on this device.
    func recentlyRead() -> Set<String>
    /// Reading progress, 0…1, from the shared sidecar.
    func progress(for rel: String) -> Double
    /// Resolve a section title key against the localisation table.
    func localized(_ key: String) -> String
    /// The reading-time templates, with their placeholders intact. `nil`
    /// while the string table has not arrived, which is the cue to draw the
    /// plain row rather than one with `{total} min` showing.
    func articleTemplates() -> ArticleMeta.Templates?
    /// Start, pause or resume reading a document aloud (#833). The host asks
    /// the web controller rather than playing anything itself.
    func toggleListen(for rel: String)
    /// What read-aloud is doing right now.
    func speechState() -> LibrarySpeechState
    /// Ask to be told when that changes.
    func observeSpeech(_ observer: LibrarySpeechObserver)
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

final class LibraryFolderScreen: UIViewController, LibrarySpeechObserver {
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
    /// Generation counter. `viewWillAppear` reloads on every return from a
    /// document, and a pull-to-refresh can land on top of one — two reads of
    /// the same folder resolving out of order would put the older listing on
    /// screen. The web version carries the same counter for the same reason.
    private var loadGeneration = 0

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

        let longPress = UILongPressGestureRecognizer(
            target: self, action: #selector(longPressed))
        collectionView.addGestureRecognizer(longPress)

        configureDataSource()
        // Weakly held by the host, so popping this screen unsubscribes it.
        host?.observeSpeech(self)
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
        let refresh = libraryRefreshKind(
            layoutChanged: next.layout != settings.layout,
            densityChanged: next.condensed != settings.condensed)
        settings = next
        if refresh != .none {
            collectionView.setCollectionViewLayout(makeLayout(), animated: true)
        }
        // Sort and group change WHICH items are where, and the snapshot says
        // that on its own — but apply it WITHOUT animation when a layout
        // change follows, so the diff does not animate old-shaped cells into
        // the new metrics before the reload below replaces them.
        rebuildSections(animated: refresh == .none)

        guard let dataSource else { return }
        var snapshot = dataSource.snapshot()
        guard !snapshot.itemIdentifiers.isEmpty else { return }
        switch refresh {
        case .none:
            break
        case .reconfigure:
            // Same cell class, different contents: a 40pt tile instead of 72,
            // no date line. A diffable data source will not redraw an item
            // whose identity did not move, so this is what makes condensed
            // actually look condensed.
            snapshot.reconfigureItems(snapshot.itemIdentifiers)
            dataSource.apply(snapshot, animatingDifferences: false)
        case .reload:
            // A DIFFERENT cell class. Reconfiguring here is the crash quoted
            // in `libraryRefreshKind`; the cells have to be built afresh.
            dataSource.applySnapshotUsingReloadData(snapshot)
        }
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
    /// Re-read this folder because something outside changed it. Named apart
    /// from `reload()` so the host is not reaching into a private.
    func reloadFromHost() { reload() }

    private func reload() {
        let rel = relPath
        loadGeneration += 1
        let generation = loadGeneration
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
                guard let self, generation == self.loadGeneration else { return }
                self.refreshControl.endRefreshing()
                self.entries = visible
                self.byPath = Dictionary(visible.map { ($0.path, $0) }, uniquingKeysWith: { a, _ in a })
                self.warmArticleTitles(visible)
                self.rebuildSections(animated: true)
            }
        }
    }

    private func rebuildSections(animated: Bool) {
        guard let host else { return }
        let matched =
            filter.isEmpty
            ? entries
            : entries.filter { entry in
                // Match what the ROW SHOWS. For a saved article that is its
                // title, site and standfirst — searching the filename alone
                // made typing a visible word hide everything.
                let meta = ArticleMeta.peek(entry.path, modified: entry.modified) ?? nil
                return libraryMatchesFilter(
                    filter,
                    LibrarySearchable(
                        name: entry.name, title: meta?.title, site: meta?.site,
                        excerpt: meta?.excerpt))
            }

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
        // What a row SAYS lives in sidecar files — reading progress, pins,
        // the read state — not in the entry list, and the identifiers here
        // are file paths. So when only a sidecar moved, this snapshot is
        // identical to the last one, `apply` is a no-op, and every row keeps
        // whatever it last drew.
        //
        // That is the whole reason reading an article to the end and coming
        // straight back left the row still saying "8 min": the number was
        // already correct on disk, and the only thing that ever redrew the
        // row was a relaunch. `viewWillAppear` calls this on every return
        // from the reader, which is exactly the moment the progress is new.
        //
        // Only items the data source already holds: reconfiguring one it has
        // never seen is not a reconfiguration.
        let carried = Set(dataSource?.snapshot().itemIdentifiers ?? [])
        let again = snapshot.itemIdentifiers.filter(carried.contains)
        if !again.isEmpty { snapshot.reconfigureItems(again) }
        dataSource?.apply(snapshot, animatingDifferences: animated)
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

    /// The list is built by `NSCollectionLayoutSection.list(using:)` and NOT
    /// by a hand-rolled group, for one reason: swipe actions.
    ///
    /// On a collection view they come from `UICollectionLayoutListConfiguration`'s
    /// providers. `collectionView(_:trailingSwipeActionsConfigurationForItemAt:)`
    /// — which is what this screen had — is a UITableView API; UIKit never
    /// calls it on a collection view, so it sat there looking implemented
    /// while no swipe did anything and the horizontal drag fell through to
    /// selection. Swiping a row OPENED it (Peter, build 65), and build 63's
    /// notes claimed "swipe a row for Share and Delete", which was never true.
    private func makeLayout() -> UICollectionViewLayout {
        UICollectionViewCompositionalLayout { [weak self] _, environment in
            guard let self else { return nil }
            return self.settings.layout == .list
                ? self.makeListSection(environment)
                : self.makeGallerySection()
        }
    }

    private func makeListSection(_ environment: NSCollectionLayoutEnvironment)
        -> NSCollectionLayoutSection
    {
        var config = UICollectionLayoutListConfiguration(appearance: .plain)
        // The cell draws its own hairline, inset past the thumbnail, and its
        // own background; the list's would sit under the tile and double up.
        config.showsSeparators = false
        config.backgroundColor = .clear
        // The header is added below, as before, so it keeps `pinToVisibleBounds`.
        config.headerMode = .none
        config.trailingSwipeActionsConfigurationProvider = { [weak self] indexPath in
            self?.trailingSwipeActions(at: indexPath)
        }
        let section = NSCollectionLayoutSection.list(
            using: config, layoutEnvironment: environment)
        section.boundarySupplementaryItems = [Self.stickyHeader()]
        return section
    }

    private static func stickyHeader() -> NSCollectionLayoutBoundarySupplementaryItem {
        let header = NSCollectionLayoutBoundarySupplementaryItem(
            layoutSize: .init(widthDimension: .fractionalWidth(1), heightDimension: .estimated(34)),
            elementKind: UICollectionView.elementKindSectionHeader,
            alignment: .top)
        // Sticky, like the web layer's — a header that scrolls away leaves a
        // long section with nothing saying what it is.
        header.pinToVisibleBounds = true
        return header
    }

    private func makeGallerySection() -> NSCollectionLayoutSection {
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
        let section = NSCollectionLayoutSection(group: group)
        section.interGroupSpacing = settings.condensed ? 12 : 20
        section.contentInsets = .init(
            top: 0, leading: 12 - spacing / 2, bottom: 0, trailing: spacing / 2)
        section.boundarySupplementaryItems = [Self.stickyHeader()]
        return section
    }

    // MARK: Read aloud

    /// The disc's accessibility label, which is also its state in words:
    /// "Listen" to start, then Pause / Resume for the document being read.
    private func listenLabel(for entry: LibraryEntry) -> String {
        guard let host else { return "" }
        if host.speechState().recording { return host.localized("recording.inProgress") }
        guard host.speechState().relPath == entry.path else { return host.localized("action.listen") }
        return host.localized(
            host.speechState().playing ? "reader.listenPause" : "reader.listenResume")
    }

    @objc private func listenTapped(_ sender: ListenDisc) {
        // Walk up to the cell rather than trusting an index: the disc is a
        // subview of a REUSED cell, and a stored index path goes stale the
        // moment the list re-sorts.
        var view: UIView? = sender
        while let current = view,
            !(current is LibraryListCell), !(current is LibraryGridCell)
        {
            view = current.superview
        }
        let path =
            (view as? LibraryListCell)?.listenPath ?? (view as? LibraryGridCell)?.listenPath
        guard let path else { return }
        host?.toggleListen(for: path)
    }

    /// Redraw only the rows whose control actually changed — the one that was
    /// playing and the one that now is. Reconfiguring the whole list on every
    /// paragraph would be a full pass per progress event.
    func speechChanged(from previous: LibrarySpeechState, to current: LibrarySpeechState) {
        guard let dataSource else { return }
        var snapshot = dataSource.snapshot()
        // A change to `recording` disables every control at once, so that one
        // really does touch all of them.
        let affected: [String]
        if previous.recording != current.recording {
            affected = snapshot.itemIdentifiers
        } else {
            // Deduplicated, and that is the whole point rather than
            // tidiness — see `rowsNeedingRedraw`, which is where the rule and
            // its regression test live. Build 64 crashed here.
            affected = ArticleMeta.rowsNeedingRedraw(
                previous: previous.relPath, current: current.relPath,
                present: { snapshot.indexOfItem($0) != nil })
        }
        guard !affected.isEmpty else { return }
        snapshot.reconfigureItems(affected)
        dataSource.apply(snapshot, animatingDifferences: false)
    }

    // MARK: Article rows

    /// The article lines for a row, from whatever is already known — never a
    /// disk read, because this runs during cell configuration.
    ///
    /// `nil` for anything that is not a saved article, which is the plain
    /// file row. A candidate whose read has not landed yet still gets article
    /// text (titled from the filename) so the row never changes shape.
    private func articleText(for entry: LibraryEntry) -> ArticleRowText? {
        guard !entry.isDirectory, ArticleMeta.isCandidate(entry.path),
            let templates = host?.articleTemplates()
        else { return nil }
        let known = ArticleMeta.peek(entry.path, modified: entry.modified)
        // Read, and definitively not a capture: an exported report, a plain
        // `.html`. That row is the ordinary one.
        if case .some(.none) = known { return nil }
        return ArticleMeta.rowText(
            name: entry.name, meta: known ?? nil,
            progress: host?.progress(for: entry.path) ?? 0, templates: templates)
    }

    /// Read the capture headers for this folder up front, so SEARCH can match
    /// an article by its title.
    ///
    /// A row's header is otherwise read when its cell is configured, i.e. only
    /// for rows that have been on screen. An article scrolled past — or never
    /// reached — would then be unfindable by the very title it displays, and
    /// filtering hides it before its cell can ever load it. The reads are
    /// backgrounded, deduplicated by `ArticleMeta`'s in-flight set and cached
    /// by path@mtime, so this costs the same reads the cells would do anyway,
    /// just sooner. Bounded so a folder of thousands does not queue thousands.
    private func warmArticleTitles(_ entries: [LibraryEntry]) {
        let candidates = entries.filter { !$0.isDirectory && ArticleMeta.isCandidate($0.path) }
        for entry in candidates.prefix(Self.searchWarmCap) {
            // No completion: the cell redraws itself when it configures, and a
            // reconfigure per row here would be a snapshot apply per row.
            ArticleMeta.load(entry.path, modified: entry.modified) { _ in }
        }
    }

    /// How many capture headers to read up front for search. Generous for a
    /// real Inbox, small enough that a pathological folder does not stall.
    private static let searchWarmCap = 300

    /// Ask for the header if it is not already known, and redraw the one row
    /// when it lands. Reconfiguring rather than reloading: the item is
    /// unchanged, only what it draws is, so the cell keeps its place and no
    /// animation runs.
    private func loadArticleMeta(for entry: LibraryEntry) {
        guard !entry.isDirectory, ArticleMeta.isCandidate(entry.path),
            ArticleMeta.peek(entry.path, modified: entry.modified) == nil
        else { return }
        let path = entry.path
        ArticleMeta.load(path, modified: entry.modified) { [weak self] _ in
            guard let self, let dataSource = self.dataSource else { return }
            var snapshot = dataSource.snapshot()
            guard snapshot.indexOfItem(path) != nil else { return }
            snapshot.reconfigureItems([path])
            dataSource.apply(snapshot, animatingDifferences: false)
        }
    }

    // MARK: Cells

    private func configureDataSource() {
        let listCell = UICollectionView.CellRegistration<LibraryListCell, String> {
            [weak self] cell, _, path in
            guard let self, let entry = self.byPath[path] else { return }
            cell.configure(
                entry, condensed: self.settings.condensed,
                progress: self.host?.progress(for: path) ?? 0,
                recentlyRead: self.host?.recentlyRead().contains(path) ?? false,
                article: self.articleText(for: entry))
            cell.configureListen(
                entry, speech: self.host?.speechState() ?? LibrarySpeechState(),
                label: self.listenLabel(for: entry))
            // Re-registered on every configuration: a reused cell would
            // otherwise still be wired to the row it used to show.
            cell.listen.removeTarget(self, action: nil, for: .touchUpInside)
            cell.listen.addTarget(self, action: #selector(self.listenTapped(_:)), for: .touchUpInside)
            self.thumbnails.load(entry, into: cell)
            self.loadArticleMeta(for: entry)
        }
        let gridCell = UICollectionView.CellRegistration<LibraryGridCell, String> {
            [weak self] cell, _, path in
            guard let self, let entry = self.byPath[path] else { return }
            cell.configure(
                entry, condensed: self.settings.condensed,
                progress: self.host?.progress(for: path) ?? 0,
                recentlyRead: self.host?.recentlyRead().contains(path) ?? false,
                article: self.articleText(for: entry))
            cell.configureListen(
                entry, speech: self.host?.speechState() ?? LibrarySpeechState(),
                label: self.listenLabel(for: entry))
            cell.listen.removeTarget(self, action: nil, for: .touchUpInside)
            cell.listen.addTarget(self, action: #selector(self.listenTapped(_:)), for: .touchUpInside)
            self.thumbnails.load(entry, into: cell)
            // Same read as the list cell's: without it a card would show its
            // filename until some list pass happened to warm the header.
            self.loadArticleMeta(for: entry)
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

    /// The entry a row is showing, or `nil` when the index path no longer
    /// names one — after a re-list, or before the data source exists.
    private func entry(at indexPath: IndexPath) -> LibraryEntry? {
        // Guarded like every other use: `dataSource` is implicitly unwrapped
        // and only assigned in `viewDidLoad`, and this is reachable from a
        // gesture and from the prefetcher.
        guard let dataSource else { return nil }
        return dataSource.itemIdentifier(for: indexPath).flatMap { byPath[$0] }
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
            host?.openDocument(entry.path, title: articleText(for: entry)?.title)
        }
    }

    /// Long press.
    ///
    /// NOT a `UIContextMenuConfiguration`: the app's menu is
    /// `EntryContextMenu`, a full-screen controller with its own morph-from-
    /// the-row animation, and it is already reached from the list rows and the
    /// gallery cards. Building a second, system-shaped menu here would be two
    /// menus for one gesture — the mistake this whole surface exists to stop.
    ///
    /// It is raised through the web layer rather than called directly because
    /// the ROWS of the menu (Share, Pin, Delete, Rename, and which apply to
    /// this entry) are assembled by `mobile-entry-actions.ts`, along with what
    /// each one does. Duplicating that here would be a second source of truth
    /// for the menu's contents.
    func collectionView(
        _ collectionView: UICollectionView,
        contextMenuConfigurationForItemsAt indexPaths: [IndexPath],
        point: CGPoint
    ) -> UIContextMenuConfiguration? {
        nil
    }

    @objc private func longPressed(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began else { return }
        let point = gesture.location(in: collectionView)
        guard
            let indexPath = collectionView.indexPathForItem(at: point),
            let entry = entry(at: indexPath)
        else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        host?.presentMenu(for: entry.path)
    }
}

extension LibraryFolderScreen {
    /// Swipe to Share or Delete.
    ///
    /// `UISwipeActionsConfiguration` gives the gesture, the rubber-banding and
    /// the full-swipe commit for free — the web layer needed 414 lines
    /// (`SwipeRevealRow.tsx`) to approximate them. What it does NOT give is
    /// what the actions mean: Share copies to a temp file first, Delete
    /// confirms before committing because a full swipe is easy to trigger by
    /// accident (#680). Both live in `entrySwipeActions`, so both are asked
    /// for here rather than written twice.
    ///
    /// `performsFirstActionWithFullSwipe` is FALSE for exactly that reason: a
    /// full swipe would otherwise fire Share without the row ever being read.
    func trailingSwipeActions(at indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard let entry = entry(at: indexPath), !entry.isDirectory else { return nil }
        let host = self.host

        let share = UIContextualAction(style: .normal, title: host?.localized("action.share")) {
            _, _, done in
            host?.swipeAction("share", for: entry.path)
            done(true)
        }
        share.image = UIImage(systemName: "square.and.arrow.up")

        let remove = UIContextualAction(
            style: .destructive, title: host?.localized("action.delete")
        ) { _, _, done in
            host?.swipeAction("delete", for: entry.path)
            // `false`: the row stays until the web layer confirms and the
            // listing is re-read. Reporting success here would animate the row
            // away before the confirmation dialog had even been answered.
            done(false)
        }
        remove.image = UIImage(systemName: "trash")

        let config = UISwipeActionsConfiguration(actions: [remove, share])
        config.performsFirstActionWithFullSwipe = false
        return config
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
