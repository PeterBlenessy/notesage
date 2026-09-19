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
  /// Flattened for the diffable data source: rows address components by index
  /// into this, so a filter is a re-snapshot rather than a re-decode.
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
    let matching = LicenseCatalog.filter(catalog.components, query: query)
    let sections = LicenseCatalog.sections(of: matching)

    // Flatten in display order so a row's index addresses the right component.
    visible = sections.flatMap(\.components)

    var snapshot = NSDiffableDataSourceSnapshot<String, Row>()
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
    guard case .component(let index) = dataSource.itemIdentifier(for: indexPath),
      let component = visible[safe: index], let catalog
    else { return }
    navigationController?.pushViewController(
      LicenceTextScreen(component: component, text: catalog.text(for: component)),
      animated: true)
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
