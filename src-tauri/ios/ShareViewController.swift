// ShareViewController.swift — Notesage Share Extension (reference source).
//
// A COMPOSE-PAGE share sheet in the modern iOS idiom (Apple Notes' share
// card): Cancel / Notesage / **Save** nav row (Save top-right), a preview of
// what's being shared, a native pull-down **Format** dropdown (last choice
// remembered via App Group defaults), and small-print showing the save
// location and the exact generated filename.
//
// History: a floating "transparent card" was tried first — iOS 26 hosts
// share extensions in an OPAQUE sheet container, so minimal chrome floats in
// a black void; SLComposeServiceViewController fixed the backdrop but hides
// the format options and looks dated. The answer is embracing the sheet:
// an opaque surface is fine when it's laid out as a real compose page.
//
// Capture shapes:
//  - DOCUMENTS (Safari-viewed PDFs, Files shares, EPUBs): saved on Save,
//    format dropdown hidden, filenames listed.
//  - URLS/pages: Article (Markdown) / Article (HTML) / Link note. Both
//    article formats run ONE readable extraction in Rust and differ only in
//    output shape. There is deliberately no full-page capture — the point of
//    capturing an article is to get the article, not the ads.
//
//    Fallback chain, shared by both: raw fetched HTML -> rendered DOM
//    (PageRenderer, for JS-rendered pages) -> link note. A capture never
//    fails outright.
//
// Reuses the shared grant (App Group bookmark) and the Rust
// `notesage-capture` C ABI. Wired by integrate-share-extension.py.

import LinkPresentation
import UIKit

/// Short helper so call sites stay readable. Table is the extension bundle's
/// own Localizable.strings (en/sv today, #653).
private func L(_ key: String, _ args: CVarArg...) -> String {
    let format = NSLocalizedString(key, comment: "")
    return args.isEmpty ? format : String(format: format, arguments: args)
}
import UniformTypeIdentifiers

/// Whether the user has cancelled this share.
///
/// A `Bool` would not do. The save chain crosses at least four queues — main,
/// two URLSession delegate queues, and the background write queue — while
/// Cancel is tapped on main, so an unsynchronised flag is a genuine data race
/// on the one value that decides whether anything reaches disk.
///
/// Shared with the macOS extension by shape, not by code: the two extensions
/// cannot link each other, so `ShareViewController.swift` on macOS carries the
/// same eight lines. Divergence there is the failure this project keeps
/// having, so both are asserted by `pipeline_contract.rs`.
final class CancelFlag {
    private let lock = NSLock()
    private var flag = false

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return flag
    }

    func cancel() {
        lock.lock()
        flag = true
        lock.unlock()
    }
}

final class ShareViewController: UIViewController {
    private static let appGroup = "group.com.notesage.app"
    private static let formatKey = "capture-format"

    private enum CaptureFormat: String, CaseIterable {
        case video
        case article
        case link
        case html

        var label: String {
            switch self {
            case .video: return L("share.formatVideo")
            case .article: return L("share.formatArticle")
            case .link: return L("share.formatLink")
            case .html: return L("share.formatHtml")
            }
        }

        var fileExtension: String {
            self == .html ? "html" : "md"
        }
    }

    /// Formats worth offering for THIS url. A video page has no article to
    /// extract and its saved HTML is a player that cannot play (#682), so
    /// those two are hidden there and Video is offered instead — and only
    /// there, since it needs a provider oEmbed endpoint to describe.
    private var availableFormats: [CaptureFormat] {
        guard let url = sharedUrl, LibraryAccess.oembedEndpoint(for: url) != nil else {
            return CaptureFormat.allCases.filter { $0 != .video }
        }
        return [.video, .link]
    }

    private var format: CaptureFormat =
        UserDefaults(suiteName: ShareViewController.appGroup)?
            .string(forKey: ShareViewController.formatKey)
            .flatMap(CaptureFormat.init(rawValue:)) ?? .article

    private var sharedUrl: String?
    private var sharedTitle: String?
    /// The page's RENDERED html, when Safari's preprocessing supplied it.
    ///
    /// Present only for shares that came from a real page. `nil` for a bare
    /// URL (Messages, Mail, in-app browsers), which is what keeps the fetch
    /// path alive rather than vestigial.
    private var renderedHtml: String?
    private var documentProviders: [NSItemProvider] = []

    /// X's embed-data JSON for this share, fetched once before the article
    /// chain runs. nil when the URL is not an X status, or when the endpoint
    /// declined — it is undocumented and unversioned, so every path below has
    /// to work without it.
    private var xJson: String?

    /// Is this share an X status URL? Decided by the capture crate, so Swift
    /// carries no second opinion about which hosts and path shapes count.
    private var isXStatus: Bool {
        guard let url = sharedUrl else { return false }
        return LibraryAccess.xMetadataEndpoint(for: url) != nil
    }

    private let previewLabel = UILabel()
    private var previewCard: UIView?
    private var linkView: LPLinkView?
    private let metadataProvider = LPMetadataProvider()
    private let filenameLabel = UILabel()
    private let formatRow = UIView()
    private var formatButton: UIButton?
    private var saveButton: UIBarButtonItem?

    /// Raised by Cancel, read from every queue the save chain touches.
    ///
    /// The save chain is up to 20 seconds long (X metadata ≤5 s, page fetch
    /// ≤10 s, render ≤5 s, then a coordinated iCloud write) and none of it was
    /// tied to the extension context's lifecycle. Cancel dismissed the sheet
    /// and the chain kept running, so an explicitly cancelled share still
    /// appeared in the library — and `finish()` then called `completeRequest`
    /// on a context that had already been cancelled, which
    /// `NSExtensionContext` leaves undefined.
    private let cancelled = CancelFlag()

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        buildLayout()
        loadSharedItem()
    }

    // MARK: - Layout (compose page)

    private func buildLayout() {
        // Nav row: Cancel · Notesage · Save (top-right, like Notes).
        let navBar = UINavigationBar()
        navBar.translatesAutoresizingMaskIntoConstraints = false
        let item = UINavigationItem(title: L("share.title"))
        item.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel, target: self, action: #selector(cancelTapped))
        let save = UIBarButtonItem(
            title: L("share.save"), style: .done, target: self, action: #selector(saveTapped))
        item.rightBarButtonItem = save
        saveButton = save
        save.isEnabled = false
        navBar.setItems([item], animated: false)
        navBar.isTranslucent = true
        view.addSubview(navBar)

        // Content card: what's being shared.
        let card = UIView()
        card.backgroundColor = .secondarySystemGroupedBackground
        card.layer.cornerRadius = 12
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)
        previewCard = card

        previewLabel.font = .preferredFont(forTextStyle: .subheadline)
        previewLabel.textColor = .label
        previewLabel.numberOfLines = 3
        previewLabel.text = L("share.loading")
        previewLabel.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(previewLabel)

        // Format row: label + native pull-down dropdown.
        formatRow.backgroundColor = .secondarySystemGroupedBackground
        formatRow.layer.cornerRadius = 12
        formatRow.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(formatRow)

        let formatTitle = UILabel()
        formatTitle.text = L("share.format")
        formatTitle.font = .preferredFont(forTextStyle: .body)
        formatTitle.translatesAutoresizingMaskIntoConstraints = false
        formatRow.addSubview(formatTitle)

        var config = UIButton.Configuration.plain()
        config.indicator = .popup
        let button = UIButton(configuration: config)
        button.menu = makeFormatMenu()
        button.showsMenuAsPrimaryAction = true
        button.changesSelectionAsPrimaryAction = true
        button.translatesAutoresizingMaskIntoConstraints = false
        formatRow.addSubview(button)
        formatButton = button

        // Small print: save location + the exact filename to be created.
        filenameLabel.font = .preferredFont(forTextStyle: .footnote)
        filenameLabel.textColor = .secondaryLabel
        // Never truncate the generated filename — wrap it (char-wrap: file
        // names contain no spaces for word wrapping to use).
        filenameLabel.numberOfLines = 0
        filenameLabel.lineBreakMode = .byCharWrapping
        filenameLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(filenameLabel)

        NSLayoutConstraint.activate([
            navBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            navBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            navBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            card.topAnchor.constraint(equalTo: navBar.bottomAnchor, constant: 16),
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),

            previewLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            previewLabel.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
            previewLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            previewLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),

            formatRow.topAnchor.constraint(equalTo: card.bottomAnchor, constant: 16),
            formatRow.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            formatRow.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            formatRow.heightAnchor.constraint(equalToConstant: 48),

            formatTitle.leadingAnchor.constraint(equalTo: formatRow.leadingAnchor, constant: 14),
            formatTitle.centerYAnchor.constraint(equalTo: formatRow.centerYAnchor),
            button.trailingAnchor.constraint(equalTo: formatRow.trailingAnchor, constant: -6),
            button.centerYAnchor.constraint(equalTo: formatRow.centerYAnchor),

            filenameLabel.topAnchor.constraint(equalTo: formatRow.bottomAnchor, constant: 12),
            filenameLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            filenameLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
        ])
    }

    private func makeFormatMenu() -> UIMenu {
        UIMenu(children: availableFormats.map { f in
            UIAction(title: f.label, state: f == format ? .on : .off) { [weak self] _ in
                guard let self else { return }
                self.format = f
                UserDefaults(suiteName: Self.appGroup)?.set(f.rawValue, forKey: Self.formatKey)
                self.updateFilenamePreview()
            }
        })
    }

    private func updateFilenamePreview() {
        if !documentProviders.isEmpty {
            filenameLabel.text = L("share.savesToInboxKeepName")
            return
        }
        // A viewer URL stores the document it names, under that document's
        // own name — promising `FY27ExternalKPIs.pptx.md` here was the
        // article prediction leaking into a path that never writes one.
        if let url = sharedUrl, LibraryAccess.viewerDocumentURL(for: url) != nil {
            filenameLabel.text = L("share.savesToInboxKeepName")
            return
        }
        guard let url = sharedUrl else {
            filenameLabel.text = L("share.savesToInbox")
            return
        }
        if let rel = LibraryAccess.previewRelPath(url: url, title: sharedTitle) {
            let stem = ((rel as NSString).lastPathComponent as NSString).deletingPathExtension
            let name = "\(stem).\(format.fileExtension)"
            // This is a PREDICTION, and it used to be printed as a fact.
            //
            // An article format only produces its extension if an article is
            // actually found; when extraction declines, the chain falls back to
            // a link note and writes `.md` instead. So the sheet could promise
            // `secure.ubs.com.html` and deliver `secure.ubs.com.md` holding
            // nothing but the URL — which is precisely what was reported.
            //
            // Linked PDFs and other documents now take their own path and keep
            // their real name, so the remaining gap is narrower: a page with no
            // extractable article. Saying so is cheaper than pretending the
            // name is certain.
            filenameLabel.text = (format == .article || format == .html)
                ? L("share.savesToInboxAsOrLink", name)
                : L("share.savesToInboxAs", name)
        } else {
            filenameLabel.text = L("share.savesToInbox")
        }
    }

    // MARK: - Shared item loading

    private func loadSharedItem() {
        guard LibraryAccess.getLibraryGrant().granted else {
            previewLabel.text = L("share.setUpFirst")
            return
        }
        guard let item = (extensionContext?.inputItems.first as? NSExtensionItem),
              let attachments = item.attachments else {
            previewLabel.text = L("share.nothingToSave")
            return
        }
        sharedTitle = item.attributedContentText?.string

        // Media joined the accepted set on Peter's request (2026-08-12):
        // screenshots and other images, screen/voice recordings and videos
        // all save into Inbox/ like documents. Everything goes through the
        // same streamed temp-file copy, so a large video never lives in the
        // extension's ~120 MB memory budget.
        documentProviders = attachments.filter { p in
            p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
                || p.hasItemConformingToTypeIdentifier("org.idpf.epub-container")
                || p.hasItemConformingToTypeIdentifier(UTType.image.identifier)
                || p.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
                || p.hasItemConformingToTypeIdentifier(UTType.audio.identifier)
                || p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
        }
        if !documentProviders.isEmpty {
            let count = documentProviders.count
            // NAME the files (#794). The sheet previously said only "1 file",
            // so it gave no confirmation of WHICH file was about to be saved —
            // which is how a share that silently wrote nothing still looked
            // plausible. `suggestedName` is synchronous and free; the count
            // string stays as the fallback for a provider that has none.
            let names = documentProviders.compactMap { $0.suggestedName }
            previewLabel.text = names.isEmpty
                ? (count == 1 ? L("share.oneFile") : L("share.manyFiles", count))
                : names.joined(separator: "\n")
            formatRow.isHidden = true
            saveButton?.isEnabled = true
            updateFilenamePreview()
            return
        }

        // Safari's preprocessing payload FIRST, when there is one.
        //
        // This is the page as the browser rendered it, which is a different
        // artefact from the page a fetch receives. On any site with lazy-loaded
        // images the fetched markup carries a placeholder — Aftonbladet's lead
        // photo is a literal 40px image inside an `<img width="8256">` — and
        // the real URL exists nowhere in it, because JavaScript builds it at
        // runtime. Asking the browser is not an optimisation over fetching; it
        // is the only way to get the real thing.
        //
        // Falls through to the URL path when absent, which is every non-Safari
        // source: Messages, Mail, in-app browsers.
        if let provider = attachments.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier)
        }) {
            provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier, options: nil) {
                [weak self] data, _ in
                let results = (data as? NSDictionary)?[NSExtensionJavaScriptPreprocessingResultsKey]
                let payload = results as? NSDictionary
                let url = payload?["url"] as? String
                let html = payload?["html"] as? String
                let title = payload?["title"] as? String
                DispatchQueue.main.async {
                    guard let self else { return }
                    if let title, !title.isEmpty, self.sharedTitle == nil {
                        self.sharedTitle = title
                    }
                    // Empty html means the script hit an error on the page. The
                    // URL alone still works — it just costs a fetch.
                    if let html, !html.isEmpty {
                        self.renderedHtml = html
                    }
                    // A payload with no usable url is NOT a dead end. Safari
                    // supplies `public.url` alongside the plist, so fall back
                    // to it rather than telling the user there is nothing to
                    // save — which is what a script error on the page used to
                    // produce: a share that worked in build 6 failing outright.
                    if let url, !url.isEmpty {
                        self.showUrl(url)
                    } else {
                        self.loadUrlOrText(from: attachments)
                    }
                }
            }
        } else {
            loadUrlOrText(from: attachments)
        }
    }

    /// The pre-payload path: a bare URL, or text containing one.
    ///
    /// Extracted so the preprocessing branch can fall back INTO it. Every
    /// non-Safari source lands here (Messages, Mail, in-app browsers), as does
    /// a Safari share whose preprocessing produced nothing usable.
    private func loadUrlOrText(from attachments: [NSItemProvider]) {
        if let provider = attachments.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.url.identifier)
        }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                let url = (data as? URL)?.absoluteString ?? (data as? String)
                DispatchQueue.main.async { self?.showUrl(url) }
            }
        } else if let provider = attachments.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
        }) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
                let text = data as? String
                let url = text.flatMap { Self.firstURL(in: $0) }
                DispatchQueue.main.async { self?.showUrl(url ?? text) }
            }
        } else {
            previewLabel.text = L("share.nothingToSave")
        }
    }

    private func showUrl(_ url: String?) {
        guard let url, !url.isEmpty else {
            previewLabel.text = L("share.nothingToSave")
            return
        }
        sharedUrl = url
        // An Office web-viewer URL IS a document (#868): the page is a loading
        // shell, and both capture paths saved that shell — spinner and all —
        // as an article. Show the file that will actually be stored and hide
        // the format picker, exactly as a shared PDF is presented.
        if let document = LibraryAccess.viewerDocumentURL(for: url) {
            let name = URL(string: document)?.lastPathComponent ?? document
            previewLabel.text = "\(name)\n\(document)"
            formatRow.isHidden = true
            saveButton?.isEnabled = true
            updateFilenamePreview()
            return
        }
        // The remembered format may not apply to THIS url — a video page
        // offers only Video and Link. Fall to the first available rather than
        // showing a selection the save path would not honour.
        if !availableFormats.contains(format) {
            format = availableFormats.first ?? .link
        }
        formatButton?.menu = makeFormatMenu()
        let title = sharedTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        previewLabel.text = (title?.isEmpty == false) ? "\(title!)\n\(url)" : url
        saveButton?.isEnabled = true
        updateFilenamePreview()
        loadRichPreview(url)
    }

    /// The rich link card with thumbnail (LinkPresentation — the same card
    /// the system compose sheet shows). The plain text preview stays until
    /// metadata arrives and remains the fallback when it never does.
    private func loadRichPreview(_ urlString: String) {
        guard let url = URL(string: urlString), let card = previewCard else { return }
        metadataProvider.timeout = 6
        metadataProvider.startFetchingMetadata(for: url) { [weak self] metadata, _ in
            guard let self, let metadata else { return }
            DispatchQueue.main.async {
                guard self.linkView == nil else { return }
                let link = LPLinkView(metadata: metadata)
                link.translatesAutoresizingMaskIntoConstraints = false
                self.previewLabel.isHidden = true
                card.addSubview(link)
                NSLayoutConstraint.activate([
                    link.topAnchor.constraint(equalTo: card.topAnchor, constant: 8),
                    link.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -8),
                    link.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 8),
                    link.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -8),
                    link.heightAnchor.constraint(lessThanOrEqualToConstant: 220),
                ])
                self.linkView = link
            }
        }
    }

    // MARK: - Actions

    @objc private func cancelTapped() {
        // Raise the flag BEFORE dismissing. Every step of the save chain
        // checks it immediately before it writes, so a save already in flight
        // when Cancel lands leaves nothing behind — which is what Cancel means.
        //
        // Cancel deliberately stays enabled after Save is tapped. Disabling it
        // would also have closed this bug, but a 15-second sheet with no way
        // out is its own bug.
        cancelled.cancel()
        saveButton?.isEnabled = false
        extensionContext?.cancelRequest(
            withError: NSError(domain: "Notesage", code: NSUserCancelledError))
    }

    @objc private func saveTapped() {
        saveButton?.isEnabled = false
        if !documentProviders.isEmpty {
            saveDocuments(documentProviders)
            return
        }
        guard let url = sharedUrl else { finish(); return }
        // An Office web-viewer URL (#868): fetch the document it names. `fetch`
        // already recognises a document content type and stores the file
        // (`saveLinkedDocument`), then finishes. This deliberately skips
        // Safari's rendered-DOM payload — for a viewer that payload IS the
        // loading shell. If the document cannot be fetched, a link note to the
        // viewer is still honest, where the spinner article was not.
        if let document = LibraryAccess.viewerDocumentURL(for: url) {
            fetch(url: document) { [weak self] _ in
                // Only reached when the response was NOT a document.
                self?.saveLink(url: url)
            }
            return
        }
        switch format {
        case .link:
            saveLink(url: url)
        case .video:
            // Metadata only, from the provider's own public oEmbed endpoint —
            // see `oembed_url` in the capture crate for why we do not fetch
            // the video itself.
            fetchOembed(url: url) { [weak self] json in
                guard let self else { return }
                // Off main: same coordinated iCloud write as every other
                // capture writer. `fetchOembed` delivers on main, so without
                // this hop the video note was a third write running on the
                // thread the sheet draws on.
                let title = self.sharedTitle
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    guard let self, !self.cancelled.isCancelled else { return }
                    let ok = (try? LibraryAccess.writeVideoCapture(
                        url: url, title: title, tags: [], oembedJson: json)) != nil
                    DispatchQueue.main.async {
                        guard !self.cancelled.isCancelled else { return }
                        if ok {
                            self.finish()
                        } else {
                            self.saveLink(url: url)
                        }
                    }
                }
            }
        case .article, .html:
            // An X status needs its metadata BEFORE the article chain runs:
            // the real title names the file, and the cover image has to be in
            // the document before it is written, not patched in afterwards.
            // Best-effort — `saveArticle` works with `xJson` still nil.
            if isXStatus {
                fetchXMetadata(url: url) { [weak self] json in
                    guard let self else { return }
                    self.xJson = json
                    self.saveArticle(url: url)
                }
                return
            }
            saveArticle(url: url)
        }
    }

    /// The article chain, shared by both article formats and by X.
    ///
    ///   rendered DOM -> fetched HTML -> rendered fetch -> fallback note
    ///
    /// Split out of `saveTapped` so the X branch can run the identical chain
    /// after its metadata fetch rather than duplicating it.
    private func saveArticle(url: String) {
        // Safari already gave us the RENDERED page — use it and skip the
        // network entirely.
        //
        // This is not a shortcut for the same data. A fetch runs no
        // JavaScript, so on any lazy-loading site it returns placeholder
        // image URLs and the real ones exist nowhere in the markup. The
        // rendered DOM carries `currentSrc` for every image: the exact URL
        // the browser chose after srcset, sizes and DPR. No parsing of ours
        // can reconstruct that, because it is the outcome of decisions only
        // the browser made.
        // Snapshot every piece of view state the write needs, ON MAIN, before
        // any of it can be read from a background queue.
        //
        // `writeArticle` used to read `self.format` live. Once the write moved
        // off main that became an unsynchronised cross-thread read: the format
        // picker's menu stays enabled after Save is tapped, and the render
        // window is seconds long, so the user can change `format` on main
        // while a background write reads it. A snapshot also makes the
        // captured intent unambiguous — what was on screen when Save was
        // pressed.
        let snapshot = CaptureSnapshot(
            format: format, title: sharedTitle, xJson: xJson, isX: isXStatus)

        // ALL THREE attempts go through `writeOffMain`.
        //
        // The previous fix hopped only the rendered-DOM attempt, leaving the
        // other two on main — including the raw-HTML one, which is the common
        // path: every page whose article is already in the fetched markup.
        // Fixing the rarest of three call sites and describing it as fixed is
        // how this file has repeatedly looked correct while not being.
        writeOffMain(url: url, html: renderedHtml, snapshot: snapshot) { [weak self] ok in
            guard let self else { return }
            if ok {
                self.finish()
                return
            }
            // No payload (a bare URL from Messages/Mail), or the rendered DOM
            // held no extractable article. Fall back to fetching.
            self.fetch(url: url) { [weak self] html in
                guard let self else { return }
                guard let html else {
                    self.saveArticleFallback(url: url)
                    return
                }
                // Both article formats share one fallback chain (#611):
                //   raw HTML -> rendered DOM -> link note.
                // The render is a SECOND attempt only. A page whose article is
                // already in the fetched HTML never pays for a webview.
                self.writeOffMain(url: url, html: html, snapshot: snapshot) { [weak self] ok in
                    guard let self else { return }
                    if ok {
                        self.finish()
                        return
                    }
                    // A plain X post has no long-form article by definition,
                    // so rendering one spends up to five seconds to reach the
                    // same metadata note it would reach immediately. Only an X
                    // Article is worth the render, and the CRATE decides which
                    // this is — `parse_x_post`, not a substring check here.
                    if snapshot.isX, let json = snapshot.xJson,
                       json.withCString({ notesage_capture_x_is_article($0) == 0 }) {
                        self.saveArticleFallback(url: url)
                        return
                    }
                    PageRenderer.renderedHTML(url: url) { [weak self] rendered in
                        guard let self else { return }
                        self.writeOffMain(url: url, html: rendered, snapshot: snapshot) { ok in
                            if ok {
                                self.finish()
                                return
                            }
                            // No article anywhere — but the page still told us
                            // its title, summary and lead image, which is what
                            // the share sheet showed before Save was tapped.
                            // Saving a bare URL while holding all three is a
                            // worse outcome than the user can see we were
                            // capable of (#839).
                            //
                            // `rendered` rather than the fetched markup on
                            // purpose: a page that blocks server-side fetches —
                            // ubs.com answers one with 509 bytes — still reaches
                            // us here with its og: tags intact.
                            self.saveCardOrLink(url: url, html: rendered, snapshot: snapshot)
                        }
                    }
                }
            }
        }
    }

    /// What a capture needs from the view, taken once on main.
    private struct CaptureSnapshot {
        let format: CaptureFormat
        let title: String?
        let xJson: String?
        let isX: Bool
    }

    /// Extract and write OFF the main thread, then call back ON it.
    ///
    /// A readability parse over up to 5 MB plus a coordinated write against
    /// what is usually an iCloud folder. Run on main it freezes the share
    /// sheet whenever the file coordinator stalls — and every caller here
    /// arrives on main, either directly or from `fetch`/`PageRenderer`, both
    /// of which deliver there.
    ///
    /// A nil `html` is "nothing to try", not a failure to report.
    private func writeOffMain(
        url: String, html: String?, snapshot: CaptureSnapshot,
        completion: @escaping (Bool) -> Void
    ) {
        guard let html else {
            completion(false)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            // Last gate before the bytes land. The fetch and the render above
            // are seconds long, and Cancel can arrive anywhere in them.
            //
            // Abandoning the completion rather than reporting failure is
            // deliberate: `false` means "try the next source", which would
            // walk a cancelled share all the way down to the link note that
            // never fails. Silence stops the chain.
            guard !self.cancelled.isCancelled else { return }
            let ok = self.writeArticle(url: url, html: html, snapshot: snapshot)
            DispatchQueue.main.async {
                guard !self.cancelled.isCancelled else { return }
                completion(ok)
            }
        }
    }

    /// The rung between an article and a bare link (#839).
    ///
    /// HTML format only, because the card IS an html document and that is what
    /// the user picked. The markdown and link formats keep their own fallback —
    /// writing an `.html` for someone who asked for a note would be the app
    /// second-guessing them.
    ///
    /// Falls through to `saveArticleFallback` when the page declares no title,
    /// which is the genuine last resort.
    private func saveCardOrLink(url: String, html: String?, snapshot: CaptureSnapshot) {
        guard snapshot.format == .html, let html else {
            saveArticleFallback(url: url)
            return
        }
        // OFF MAIN, like every other capture write.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self, !self.cancelled.isCancelled else { return }
            let written = try? LibraryAccess.writeCardHtml(url: url, html: html)
            let ok = written.flatMap { $0 } != nil
            DispatchQueue.main.async {
                guard !self.cancelled.isCancelled else { return }
                if ok {
                    self.finish()
                } else {
                    self.saveArticleFallback(url: url)
                }
            }
        }
    }

    /// Last resort when no source yielded an article.
    ///
    /// For an X status this is NOT the link note. Syndication still knows the
    /// title, author and cover, so the metadata note is strictly better — and
    /// a plain post (nothing long-form to extract) reaches here every time, by
    /// design rather than by failure.
    ///
    /// It writes markdown even when the user picked HTML. Both fallbacks write
    /// `.md` — `saveLink` does too — so the choice here is between a metadata
    /// note and a bare link, not between formats.
    ///
    /// Everything else, and X when the metadata is missing too, gets the link
    /// note. That one never fails, which is what keeps a share from ever
    /// ending in nothing.
    private func saveArticleFallback(url: String) {
        guard isXStatus, let json = xJson else {
            saveLink(url: url)
            return
        }
        // OFF MAIN, like every other capture write.
        //
        // `writeOffMain` covered `writeArticle` only, so the metadata-note
        // branch — the one a plain X post reaches EVERY time, by design —
        // still ran its coordinated iCloud write on the thread the share sheet
        // draws on. Three review rounds fixed this freeze for articles while
        // it stayed live on the commonest X path.
        let title = sharedTitle
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self, !self.cancelled.isCancelled else { return }
            let written = try? LibraryAccess.writeXCapture(
                url: url, title: title, tags: [], html: nil,
                xJson: json, asHtml: false)
            // `try?` on a throwing function that also returns an optional
            // yields String?? — flatten before testing, or a thrown error and
            // a declined build become indistinguishable.
            let ok = written.flatMap { $0 } != nil
            DispatchQueue.main.async {
                guard !self.cancelled.isCancelled else { return }
                if ok {
                    self.finish()
                } else {
                    self.saveLink(url: url)
                }
            }
        }
    }

    /// Write the active article format from `html`. Returns false when
    /// extraction declines, so the caller can try the next source in the chain.
    ///
    /// Shared by both article formats because the SPA problem is not
    /// format-specific: if the article is not in the fetched HTML, neither the
    /// markdown nor the HTML rendering can find it.
    /// Reads ONLY the snapshot, never `self`'s mutable view state.
    ///
    /// This runs on a background queue. `format` in particular is mutated on
    /// main by the format picker, whose menu stays live after Save is tapped —
    /// so reading it here was an unsynchronised cross-thread read introduced
    /// by moving the write off main. The snapshot also pins the user's intent
    /// to the moment they pressed Save.
    private func writeArticle(url: String, html: String, snapshot: CaptureSnapshot) -> Bool {
        // X routes through its own writer at EVERY link in the chain, not just
        // the first. Enrichment has to travel with the extraction — a capture
        // that succeeded on the second attempt is exactly as entitled to its
        // real title and cover image as one that succeeded on the first.
        if snapshot.isX {
            // Demand a genuine extraction here: this is one of the "try
            // harder" attempts (raw HTML, then rendered DOM). The metadata-only
            // note is reached deliberately by `saveArticleFallback`, not by an
            // attempt silently succeeding.
            let written = try? LibraryAccess.writeXCapture(
                url: url, title: snapshot.title, tags: [], html: html,
                xJson: snapshot.xJson, asHtml: snapshot.format == .html, requireArticle: true)
            return written.flatMap { $0 } != nil
        }
        if snapshot.format == .html {
            return (try? LibraryAccess.writeArticleHtml(
                url: url, title: snapshot.title, html: html)) != nil
        }
        return (try? LibraryAccess.writeArticleCapture(
            url: url, title: snapshot.title, selectionText: nil, tags: [], html: html)) != nil
    }

    /// Fetch the page (10 s budget, 5 MB cap, Safari UA — unknown agents get
    /// bot-shells from many sites). nil on any failure.

    /// Extension for a `Content-Type` that serves a storable document, or nil
    /// for a page to extract. Decided by the CRATE so both extensions agree —
    /// a second opinion in Swift is how the two platforms drift.
    private static func linkedDocumentExtension(_ contentType: String) -> String? {
        contentType.withCString { ct in
            guard let raw = notesage_capture_linked_document_extension(ct) else { return nil }
            defer { notesage_capture_string_free(raw) }
            return String(cString: raw)
        }
    }

    /// The server's suggested filename, basename only, or nil.
    private static func dispositionFilename(_ header: String) -> String? {
        header.withCString { h in
            guard let raw = notesage_capture_disposition_filename(h) else { return nil }
            defer { notesage_capture_string_free(raw) }
            return String(cString: raw)
        }
    }

    /// Download a URL that serves a document and store it in `Inbox/`.
    ///
    /// Streamed to disk with `downloadTask` rather than held in memory: the
    /// extension has a ~120 MB ceiling and a linked video or deck can be large.
    /// Named from `Content-Disposition` when the server offers one — the URL's
    /// last segment is frequently an opaque id, which is how a shared PDF would
    /// otherwise land as `secure.ubs.com`.
    private func saveLinkedDocument(
        from parsed: URL, response: HTTPURLResponse, ext: String, completion: @escaping (Bool) -> Void
    ) {
        let disposition = response.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let suggested = Self.dispositionFilename(disposition)
            ?? response.suggestedFilename
            ?? "\(parsed.lastPathComponent).\(ext)"
        // Ensure the extension is right even when the server's name lacks one —
        // the file type is what decides whether the library can open it.
        let name = (suggested as NSString).pathExtension.isEmpty
            ? "\(suggested).\(ext)" : suggested

        var request = URLRequest(url: parsed)
        request.timeoutInterval = 60
        request.setValue(Self.safariUserAgent, forHTTPHeaderField: "User-Agent")
        URLSession(configuration: .ephemeral).downloadTask(with: request) { [weak self] temp, _, _ in
            guard let temp else {
                DispatchQueue.main.async { completion(false) }
                return
            }
            // Already off main, and `writeDocument` is a coordinated iCloud
            // write — do it here rather than hopping back.
            if let self, self.cancelled.isCancelled {
                DispatchQueue.main.async { completion(false) }
                return
            }
            let ok = (try? LibraryAccess.writeDocument(from: temp, suggestedName: name)) != nil
            DispatchQueue.main.async { completion(ok) }
        }.resume()
    }

    private static let safariUserAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 "
        + "(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"

    private func fetch(url: String, completion: @escaping (String?) -> Void) {
        guard let parsed = URL(string: url), parsed.scheme == "https" || parsed.scheme == "http" else {
            completion(nil)
            return
        }
        var request = URLRequest(url: parsed)
        request.timeoutInterval = 10
        request.setValue(Self.safariUserAgent, forHTTPHeaderField: "User-Agent")
        // Accept documents too — a link does not always lead to a page, and
        // sending an HTML-only Accept invited a 406 for the very responses this
        // now handles.
        request.setValue("text/html,application/xhtml+xml,*/*;q=0.8", forHTTPHeaderField: "Accept")
        URLSession(configuration: .ephemeral).dataTask(with: request) { [weak self] data, response, _ in
            let http = response as? HTTPURLResponse
            let contentType = http?.value(forHTTPHeaderField: "Content-Type") ?? ""
            let maxBytes = 5 * 1024 * 1024

            // The bytes ARE the document. A link to a PDF, EPUB, deck, image,
            // video or audio file used to fail the `text/html` check below and
            // fall through to a link note — a `.md` holding only the URL, after
            // the sheet had promised otherwise. Store the file instead.
            if let http, let ext = Self.linkedDocumentExtension(contentType) {
                guard let self else {
                    DispatchQueue.main.async { completion(nil) }
                    return
                }
                self.saveLinkedDocument(from: parsed, response: http, ext: ext) { ok in
                    if ok {
                        self.finish()
                    } else {
                        // Could not store it — the link note is still better
                        // than nothing, and is what the chain does anyway.
                        completion(nil)
                    }
                }
                return
            }

            DispatchQueue.main.async {
                if let data, data.count <= maxBytes,
                   contentType.lowercased().contains("text/html"),
                   let html = String(data: data, encoding: .utf8) {
                    completion(html)
                } else {
                    completion(nil)
                }
            }
        }.resume()
    }

    /// Fetch X's embed-data JSON (5 s, 512 KB — an Article's entry carries a
    /// teaser and media block, so a little larger than oEmbed's five fields).
    ///
    /// nil on ANY failure, and every caller must cope: this endpoint is
    /// undocumented, unversioned, and rate-limits. A capture whose enrichment
    /// is missing is a worse capture; a capture that fails because enrichment
    /// was unavailable would be a bug.
    private func fetchXMetadata(url: String, completion: @escaping (String?) -> Void) {
        guard let endpoint = LibraryAccess.xMetadataEndpoint(for: url),
              let parsed = URL(string: endpoint)
        else {
            completion(nil)
            return
        }
        var request = URLRequest(url: parsed)
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        URLSession(configuration: .ephemeral).dataTask(with: request) { data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                guard ok, let data, data.count <= 512 * 1024,
                      let json = String(data: data, encoding: .utf8)
                else {
                    completion(nil)
                    return
                }
                completion(json)
            }
        }.resume()
    }

    /// Fetch the provider's oEmbed JSON (5 s, 256 KB — the payload is five
    /// short fields). nil on any failure; the note still builds without it.
    private func fetchOembed(url: String, completion: @escaping (String?) -> Void) {
        guard let endpoint = LibraryAccess.oembedEndpoint(for: url),
              let parsed = URL(string: endpoint)
        else {
            completion(nil)
            return
        }
        var request = URLRequest(url: parsed)
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        URLSession(configuration: .ephemeral).dataTask(with: request) { data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                guard ok, let data, data.count <= 256 * 1024,
                      let json = String(data: data, encoding: .utf8)
                else {
                    completion(nil)
                    return
                }
                completion(json)
            }
        }.resume()
    }

    /// The link note — the one write that never declines, and so the one every
    /// other path falls through to.
    ///
    /// Off main for the same reason the article write is: `writeCapture` runs a
    /// coordinated write against what is usually an iCloud folder, and a
    /// stalled file coordinator freezes the share sheet. This is the SIMPLEST
    /// save path and it was the last one still on main.
    private func saveLink(url: String) {
        let title = sharedTitle
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self, !self.cancelled.isCancelled else { return }
            _ = try? LibraryAccess.writeCapture(
                url: url, title: title, selectionText: nil, tags: [])
            DispatchQueue.main.async { self.finish() }
        }
    }

    /// Copy shared files into Inbox/ (streamed via temp-file representations
    /// — a large PDF or video never lives in extension memory). Ten matches
    /// the image activation cap; other kinds are capped lower by their own
    /// activation rules.
    private func saveDocuments(_ providers: [NSItemProvider]) {
        // Bounded at the activation rule's largest count.
        let attempted = Array(providers.prefix(10))
        let group = DispatchGroup()
        // `loadFileRepresentation` calls back on an arbitrary queue and these
        // run concurrently, so the counter needs a lock — same reasoning, and
        // now the same shape, as the macOS side.
        let lock = NSLock()
        var failures = 0
        func recordFailure(_ reason: String) {
            NSLog("[notesage-share] document save failed: %@", reason)
            lock.lock()
            failures += 1
            lock.unlock()
        }

        // Capture the FLAG, not `self` (#794).
        //
        // #779 added `[weak self]` here to reach the cancellation flag, on a
        // path that until then wrote unconditionally. That made the write
        // conditional on the view controller still being alive — and it fails
        // SILENTLY when it is not, which is exactly the reported symptom: a
        // shared PDF that never reaches Inbox while the sheet closes as though
        // it had.
        //
        // `CancelFlag` is a lock-guarded class, so capturing it strongly is
        // both safe from any queue and independent of the controller's
        // lifetime. Nothing about cancellation ever needed `self`.
        let cancelled = self.cancelled

        for provider in attempted {
            // Most specific conforming type first — the provider hands the
            // richest file representation for it (a screenshot shared as
            // UIImage still yields a PNG file via UTType.image).
            let candidates = [
                UTType.pdf.identifier,
                "org.idpf.epub-container",
                UTType.image.identifier,
                UTType.movie.identifier,
                UTType.audio.identifier,
            ]
            let typeId =
                candidates.first(where: provider.hasItemConformingToTypeIdentifier)
                ?? UTType.data.identifier
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: typeId) { url, error in
                defer { group.leave() }
                // A ten-file batch off an iCloud volume is seconds of copying,
                // so Cancel is checked per item rather than only at the end.
                if cancelled.isCancelled { return }
                guard let url else {
                    recordFailure("could not load \(typeId): \(String(describing: error))")
                    return
                }
                do {
                    _ = try LibraryAccess.writeDocument(
                        from: url, suggestedName: url.lastPathComponent)
                } catch {
                    // NOT `try?`. Swallowing this is why a failed share looked
                    // identical to a successful one, and why there was nothing
                    // in the log to read when one was reported.
                    recordFailure("write failed: \(String(describing: error))")
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self, !cancelled.isCancelled else { return }
            if failures == 0 {
                self.finish()
                return
            }
            // Never close on failure. A sheet that vanishes having saved
            // nothing is indistinguishable from one that worked — the user
            // finds out days later, if ever. macOS already refused to close
            // here; iOS closed regardless.
            self.saveButton?.isEnabled = true
            self.previewLabel.isHidden = false
            self.previewLabel.text = failures == attempted.count
                ? L("share.couldNotSaveFiles")
                : L("share.someFilesFailed", failures)
        }
    }

    private static func firstURL(in text: String) -> String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        return detector?.firstMatch(in: text, options: [], range: range)?.url?.absoluteString
    }

    private func finish() {
        // Completing an already-cancelled context is undefined per
        // `NSExtensionContext`. Every terminal path in this file funnels
        // through here, so this one guard covers all of them.
        guard !cancelled.isCancelled else { return }
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
