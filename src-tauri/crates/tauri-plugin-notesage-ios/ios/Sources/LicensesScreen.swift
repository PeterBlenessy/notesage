import UIKit

/// The acknowledgements list: everything Notesage bundles, and its notice.
///
/// Why a screen at all, in an app whose every other preference is a UIMenu row
/// (see the note in `LibraryBrowser.tsx`): 1,510 components do not fit in a
/// menu, and the licences require the notice itself to be readable, not a
/// summary. This is the one place the "no settings screen" rule bends, and it
/// bends for an obligation rather than a preference.
///
/// The catalogue is decoded off the main thread — it is ~1.8 MB of JSON, and
/// decoding it inline would hitch the push animation on the frame the screen
/// appears.
///
/// All of the logic worth being wrong about — sectioning, ordering, search —
/// lives in `LicenseCatalog.swift`, which is UIKit-free so
/// `scripts/check-license-catalog.sh` can exercise it on macOS. This file is
/// the part that needs a device to judge.
final class LicensesScreen: UIViewController {
  private enum Row: Hashable {
    /// A licence, with everything under it. The default view.
    case licence(index: Int)
    /// A single package. Only while searching — someone typing a package name
    /// wants that package, not the licence it happens to share with 642 others.
    case component(index: Int)
    /// Shown while the catalogue decodes, and replaced when it arrives.
    case loading
    /// Shown when the catalogue is missing or will not decode — a packaging
    /// fault, and one the user should see rather than meet an empty list.
    case failure(String)
  }

  /// `UITableViewDiffableDataSource` ignores section identifiers for display —
  /// appending them groups the rows and titles nothing. Verified on the
  /// simulator: the sections separated correctly and had no headings at all.
  private final class SectionedDataSource: UITableViewDiffableDataSource<String, Row> {
    override func tableView(_ table: UITableView, titleForHeaderInSection index: Int) -> String? {
      let title = snapshot().sectionIdentifiers[index]
      return title.isEmpty ? nil : title
    }
  }

  private var tableView: UITableView!
  private var dataSource: SectionedDataSource!
  private let searchBar = UISearchBar()
  private var catalog: LicenseCatalog.Catalog?
  /// The default view: one row per licence rather than per package. 1,510
  /// components over 42 licences — the obligation is per copyright holder, and
  /// every notice is still reproduced one level down, but the list a person
  /// scrolls should not be 1,510 near-identical rows.
  private var groups: [LicenseCatalog.LicenceGroup] = []
  /// Flattened for the diffable data source while SEARCHING: rows address
  /// components by index into this, so a filter is a re-snapshot rather than a
  /// re-decode.
  private var visible: [LicenseCatalog.Component] = []

  override func viewDidLoad() {
    super.viewDidLoad()
    title = Self.localized("acknowledgements.title", "Acknowledgements")
    view.backgroundColor = .systemBackground
    navigationItem.largeTitleDisplayMode = .never

    tableView = UITableView(frame: .zero, style: .insetGrouped)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    tableView.delegate = self
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
    tableView.keyboardDismissMode = .onDrag
    view.addSubview(tableView)
    NSLayoutConstraint.activate([
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])

    // A search bar in the table header, NOT `navigationItem.searchController`.
    // `NativeNavShell.attachNative` installs this controller as a CHILD of the
    // shell's `ScreenController`, so the navigation bar reads THAT one's
    // `navigationItem` and never this one's — the search field simply did not
    // appear. Caught on the simulator; nothing in the type system or the tests
    // knows which controller owns the bar.
    searchBar.placeholder = Self.localized(
      "acknowledgements.search", "Search packages and licences")
    searchBar.delegate = self
    searchBar.searchBarStyle = .minimal
    searchBar.sizeToFit()
    tableView.tableHeaderView = searchBar

    configureDataSource()
    showPlaceholder(.loading)
    load()
  }

  // MARK: - Data

  private func configureDataSource() {
    dataSource = SectionedDataSource(tableView: tableView) {
      [weak self] table, indexPath, row in
      let cell = table.dequeueReusableCell(withIdentifier: "row", for: indexPath)
      var content = cell.defaultContentConfiguration()
      switch row {
      case .loading:
        content.text = Self.localized("acknowledgements.loading", "Loading…")
        content.textProperties.color = .secondaryLabel
        cell.accessoryType = .none
        cell.selectionStyle = .none
      case .failure(let message):
        content.text = message
        content.textProperties.color = .secondaryLabel
        content.textProperties.numberOfLines = 0
        cell.accessoryType = .none
        cell.selectionStyle = .none
      case .licence(let index):
        guard let group = self?.groups[safe: index] else { break }
        content.text = group.licence
        content.secondaryText = LicenseCatalog.subtitle(for: group)
        content.secondaryTextProperties.color = .secondaryLabel
        cell.accessoryType = .disclosureIndicator
        cell.selectionStyle = .default
      case .component(let index):
        guard let component = self?.visible[safe: index] else { break }
        content.text = component.name
        content.secondaryText = LicenseCatalog.subtitle(for: component)
        content.secondaryTextProperties.color = .secondaryLabel
        cell.accessoryType = .disclosureIndicator
        cell.selectionStyle = .default
      }
      cell.contentConfiguration = content
      return cell
    }
    dataSource.defaultRowAnimation = .fade
  }

  private func load() {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let result = Self.loadCatalog()
      DispatchQueue.main.async {
        guard let self else { return }
        switch result {
        case .success(let catalog):
          self.catalog = catalog
          self.apply(query: "")
        case .failure(let fault):
          self.showPlaceholder(.failure(fault.message))
        }
      }
    }
  }

  /// Read the generated catalogue out of the app bundle.
  ///
  /// A missing or unreadable file is a packaging fault — the resource is wired
  /// into the Xcode project by `src-tauri/ios/integrate-share-extension.py` —
  /// and it surfaces on screen rather than as an empty list, because an empty
  /// list looks like "nothing to acknowledge", which is the opposite of true.
  /// A packaging fault, carrying the sentence shown on screen.
  struct LoadFailure: Error {
    let message: String
  }

  private static func loadCatalog() -> Result<LicenseCatalog.Catalog, LoadFailure> {
    guard let url = Bundle.main.url(forResource: "third-party-licenses", withExtension: "json")
    else {
      return .failure(
        LoadFailure(
          message: localized(
            "acknowledgements.missing",
            "The licence notices are missing from this build. This is a packaging fault — please report it.")))
    }
    do {
      return .success(try LicenseCatalog.decode(Data(contentsOf: url)))
    } catch {
      return .failure(
        LoadFailure(
          message: localized(
            "acknowledgements.unreadable", "The licence notices could not be read: ")
            + "\(error)"))
    }
  }

  private func showPlaceholder(_ row: Row) {
    var snapshot = NSDiffableDataSourceSnapshot<String, Row>()
    snapshot.appendSections([""])
    snapshot.appendItems([row], toSection: "")
    dataSource.apply(snapshot, animatingDifferences: false)
  }

  private func apply(query: String) {
    guard let catalog else { return }
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    var snapshot = NSDiffableDataSourceSnapshot<String, Row>()

    if needle.isEmpty {
      // Default: one row per licence.
      groups = LicenseCatalog.licenceGroups(of: catalog.components)
      visible = []
      snapshot.appendSections([""])
      snapshot.appendItems((0..<groups.count).map { .licence(index: $0) }, toSection: "")
    } else {
      // Searching: the packages themselves, still sectioned by ecosystem.
      // Someone typing a package name wants that package, not the licence it
      // shares with hundreds of others.
      groups = []
      let sections = LicenseCatalog.sections(
        of: LicenseCatalog.filter(catalog.components, query: needle))
      visible = sections.flatMap(\.components)
      var cursor = 0
      for section in sections {
        snapshot.appendSections([section.title])
        snapshot.appendItems(
          (0..<section.components.count).map { .component(index: cursor + $0) },
          toSection: section.title)
        cursor += section.components.count
      }
      if sections.isEmpty {
        snapshot.appendSections([""])
        snapshot.appendItems(
          [.failure(Self.localized("acknowledgements.noMatches", "Nothing matches that."))],
          toSection: "")
      }
    }
    dataSource.apply(snapshot, animatingDifferences: false)
  }

  /// InfoPlist-style lookup with an English fallback, matching how the rest of
  /// the native shell localises: `AppResources/*.lproj` carries the strings.
  fileprivate static func localized(_ key: String, _ fallback: String) -> String {
    let value = NSLocalizedString(key, comment: "")
    return value == key ? fallback : value
  }
}

extension LicensesScreen: UITableViewDelegate {
  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    guard let catalog, let row = dataSource.itemIdentifier(for: indexPath) else { return }
    switch row {
    case .licence(let index):
      guard let group = groups[safe: index] else { return }
      presentDetail(LicenceGroupScreen(group: group, catalog: catalog))
    case .component(let index):
      guard let component = visible[safe: index] else { return }
      presentDetail(LicenceTextScreen(component: component, text: catalog.text(for: component)))
    case .loading, .failure:
      return
    }
  }

  /// Show a detail screen as a sheet, NOT by pushing it.
  ///
  /// `NativeNavShell` owns the navigation stack and reconciles it against the
  /// web side's store on every change — a controller pushed straight onto
  /// `navigationController` is a screen that store has never heard of, and the
  /// next reconcile diffs it away. Verified on the simulator: the tap did
  /// nothing at all, because the push and the pop raced inside one run loop
  /// turn.
  ///
  /// A sheet sidesteps the whole question. These are leaves — a notice you
  /// read and dismiss — so they do not need to be in the app's navigation
  /// history, and putting them there would mean teaching the store about
  /// screens that are nobody else's business.
  private func presentDetail(_ controller: UIViewController) {
    let wrapper = UINavigationController(rootViewController: controller)
    controller.navigationItem.rightBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .done, target: self, action: #selector(dismissDetail))
    present(wrapper, animated: true)
  }

  @objc private func dismissDetail() {
    presentedViewController?.dismiss(animated: true)
  }
}

extension LicensesScreen: UISearchBarDelegate {
  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    apply(query: searchText)
  }

  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
    searchBar.resignFirstResponder()
  }
}

/// One licence: its notices verbatim, and the packages they cover.
///
/// This is where the obligation is actually discharged. The list a level up
/// shows 42 rows instead of 1,510, but nothing is summarised away — every
/// distinct notice under a licence is reproduced here in full, and every
/// package it covers is named. Grouping changes how many rows a person
/// scrolls, not what the app carries.
final class LicenceGroupScreen: UIViewController {
  private let group: LicenseCatalog.LicenceGroup
  private let catalog: LicenseCatalog.Catalog

  init(group: LicenseCatalog.LicenceGroup, catalog: LicenseCatalog.Catalog) {
    self.group = group
    self.catalog = catalog
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = group.licence
    view.backgroundColor = .systemBackground

    let scroll = UIScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scroll)

    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 20
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)

    stack.addArrangedSubview(
      caption(LicenseCatalog.subtitle(for: group), style: .subheadline, colour: .label))

    // The packages first: the question this screen answers is usually "what is
    // under this licence", and the notice below is the same text repeated for
    // all of them.
    stack.addArrangedSubview(
      caption(
        group.components.map { component in
          let version = component.version.map { " \($0)" } ?? ""
          return "• \(component.name)\(version)"
        }.joined(separator: "\n"),
        style: .footnote, colour: .secondaryLabel))

    // Then every distinct notice under it, verbatim. Usually one; more where
    // packages ship their own copyright line.
    for textId in group.textIds {
      guard let text = catalog.texts[textId], !text.isEmpty else { continue }
      let label = UILabel()
      label.numberOfLines = 0
      label.adjustsFontForContentSizeCategory = true
      label.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
      label.textColor = .secondaryLabel
      label.text = text
      stack.addArrangedSubview(label)
    }

    if group.textIds.isEmpty {
      stack.addArrangedSubview(
        caption(
          LicensesScreen.localized(
            "acknowledgements.noText",
            "This package declares its licence but does not ship the licence text, so there is none to reproduce here."),
          style: .footnote, colour: .tertiaryLabel))
    }

    NSLayoutConstraint.activate([
      scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -40),
      stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -20),
    ])
  }

  private func caption(_ text: String, style: UIFont.TextStyle, colour: UIColor) -> UILabel {
    let label = UILabel()
    label.numberOfLines = 0
    label.adjustsFontForContentSizeCategory = true
    label.font = .preferredFont(forTextStyle: style)
    label.textColor = colour
    label.text = text
    return label
  }
}

/// One component's notice, verbatim.
///
/// Monospaced and selectable: these are legal texts, and someone checking a
/// specific clause wants to copy it. A component whose licence file was never
/// shipped says so — 167 of 1,510 are in that position, all of them declaring
/// a licence without carrying its text, which is recorded in
/// `scripts/license-catalog-check/main.swift` rather than hidden here.
final class LicenceTextScreen: UIViewController {
  private let component: LicenseCatalog.Component
  private let text: String?

  init(component: LicenseCatalog.Component, text: String?) {
    self.component = component
    self.text = text
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = component.name
    view.backgroundColor = .systemBackground
    navigationItem.largeTitleDisplayMode = .never

    let scroll = UIScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scroll)

    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 16
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)

    stack.addArrangedSubview(header())
    stack.addArrangedSubview(body())

    NSLayoutConstraint.activate([
      scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -40),
      stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -20),
    ])
  }

  private func header() -> UIView {
    let label = UILabel()
    label.numberOfLines = 0
    label.font = .preferredFont(forTextStyle: .footnote)
    label.textColor = .secondaryLabel
    label.adjustsFontForContentSizeCategory = true
    var lines = [LicenseCatalog.subtitle(for: component)]
    if let publisher = component.publisher, !publisher.isEmpty { lines.append(publisher) }
    if let url = component.url, !url.isEmpty { lines.append(url) }
    label.text = lines.joined(separator: "\n")
    return label
  }

  private func body() -> UIView {
    let label = UILabel()
    label.numberOfLines = 0
    label.adjustsFontForContentSizeCategory = true
    if let text, !text.isEmpty {
      label.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
      label.textColor = .secondaryLabel
      label.text = text
    } else {
      // Visible rather than blank: the package declares a licence but ships no
      // file for it, so there is no verbatim notice to reproduce. Saying that
      // is more honest than an empty screen, and the SPDX identifier in the
      // header above is what we do know.
      label.font = .preferredFont(forTextStyle: .footnote)
      label.textColor = .tertiaryLabel
      label.text = LicensesScreen.localized(
        "acknowledgements.noText",
        "This package declares its licence but does not ship the licence text, so there is none to reproduce here.")
    }
    return label
  }
}

private extension Array {
  /// Index access that returns nil rather than trapping. The data source and
  /// the flattened list are applied on the same run loop turn, but a snapshot
  /// applied while a search is in flight could otherwise index past the end.
  subscript(safe index: Int) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
