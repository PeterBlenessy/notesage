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
//  - URLS/pages: Article (Markdown, readable extraction in Rust) /
//    Link note / Page (HTML). Article extraction falls back to the link
//    note — a capture never fails outright.
//
// Reuses the shared grant (App Group bookmark) and the Rust
// `notesage-capture` C ABI. Wired by integrate-share-extension.py.

import LinkPresentation
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private static let appGroup = "group.com.notesage.app"
    private static let formatKey = "capture-format"

    private enum CaptureFormat: String, CaseIterable {
        case article
        case link
        case html

        var label: String {
            switch self {
            case .article: return "Article (Markdown)"
            case .link: return "Link note"
            case .html: return "Page (HTML)"
            }
        }

        var fileExtension: String {
            self == .html ? "html" : "md"
        }
    }

    private var format: CaptureFormat =
        UserDefaults(suiteName: ShareViewController.appGroup)?
            .string(forKey: ShareViewController.formatKey)
            .flatMap(CaptureFormat.init(rawValue:)) ?? .article

    private var sharedUrl: String?
    private var sharedTitle: String?
    private var documentProviders: [NSItemProvider] = []

    private let previewLabel = UILabel()
    private var previewCard: UIView?
    private var linkView: LPLinkView?
    private let metadataProvider = LPMetadataProvider()
    private let filenameLabel = UILabel()
    private let formatRow = UIView()
    private var formatButton: UIButton?
    private var saveButton: UIBarButtonItem?

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
        let item = UINavigationItem(title: "Notesage")
        item.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel, target: self, action: #selector(cancelTapped))
        let save = UIBarButtonItem(
            title: "Save", style: .done, target: self, action: #selector(saveTapped))
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
        previewLabel.text = "Loading…"
        previewLabel.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(previewLabel)

        // Format row: label + native pull-down dropdown.
        formatRow.backgroundColor = .secondarySystemGroupedBackground
        formatRow.layer.cornerRadius = 12
        formatRow.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(formatRow)

        let formatTitle = UILabel()
        formatTitle.text = "Format"
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
        UIMenu(children: CaptureFormat.allCases.map { f in
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
            filenameLabel.text = "Saves to Inbox in your Notesage library, keeping the original filename."
            return
        }
        guard let url = sharedUrl else {
            filenameLabel.text = "Saves to Inbox in your Notesage library."
            return
        }
        if let rel = LibraryAccess.previewRelPath(url: url, title: sharedTitle) {
            let stem = ((rel as NSString).lastPathComponent as NSString).deletingPathExtension
            filenameLabel.text = "Saves to Inbox in your Notesage library as\n\(stem).\(format.fileExtension)"
        } else {
            filenameLabel.text = "Saves to Inbox in your Notesage library."
        }
    }

    // MARK: - Shared item loading

    private func loadSharedItem() {
        guard LibraryAccess.getLibraryGrant().granted else {
            previewLabel.text = "Open Notesage to set up before sharing."
            return
        }
        guard let item = (extensionContext?.inputItems.first as? NSExtensionItem),
              let attachments = item.attachments else {
            previewLabel.text = "Nothing to save."
            return
        }
        sharedTitle = item.attributedContentText?.string

        documentProviders = attachments.filter { p in
            if p.hasItemConformingToTypeIdentifier(UTType.image.identifier) { return false }
            return p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
                || p.hasItemConformingToTypeIdentifier("org.idpf.epub-container")
                || p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
        }
        if !documentProviders.isEmpty {
            let count = documentProviders.count
            previewLabel.text = count == 1 ? "1 document" : "\(count) documents"
            formatRow.isHidden = true
            saveButton?.isEnabled = true
            updateFilenamePreview()
            return
        }

        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                let url = (data as? URL)?.absoluteString ?? (data as? String)
                DispatchQueue.main.async { self?.showUrl(url) }
            }
        } else if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
                let text = data as? String
                let url = text.flatMap { Self.firstURL(in: $0) }
                DispatchQueue.main.async { self?.showUrl(url ?? text) }
            }
        } else {
            previewLabel.text = "Nothing to save."
        }
    }

    private func showUrl(_ url: String?) {
        guard let url, !url.isEmpty else {
            previewLabel.text = "Nothing to save."
            return
        }
        sharedUrl = url
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
        extensionContext?.cancelRequest(withError: NSError(domain: "Notesage", code: 0))
    }

    @objc private func saveTapped() {
        saveButton?.isEnabled = false
        if !documentProviders.isEmpty {
            saveDocuments(documentProviders)
            return
        }
        guard let url = sharedUrl else { finish(); return }
        switch format {
        case .link:
            saveLink(url: url)
        case .article, .html:
            fetch(url: url) { [weak self] html in
                guard let self else { return }
                guard let html else {
                    self.saveLink(url: url)
                    return
                }
                if self.format == .html {
                    _ = try? LibraryAccess.writeRawHtml(url: url, title: self.sharedTitle, html: html)
                    self.finish()
                    return
                }
                if let rel = try? LibraryAccess.writeArticleCapture(
                    url: url, title: self.sharedTitle, selectionText: nil, tags: [], html: html),
                   rel != nil {
                    self.finish()
                } else {
                    // No readable article — the link note never fails.
                    self.saveLink(url: url)
                }
            }
        }
    }

    /// Fetch the page (10 s budget, 5 MB cap, Safari UA — unknown agents get
    /// bot-shells from many sites). nil on any failure.
    private func fetch(url: String, completion: @escaping (String?) -> Void) {
        guard let parsed = URL(string: url), parsed.scheme == "https" || parsed.scheme == "http" else {
            completion(nil)
            return
        }
        var request = URLRequest(url: parsed)
        request.timeoutInterval = 10
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
            forHTTPHeaderField: "User-Agent")
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        URLSession(configuration: .ephemeral).dataTask(with: request) { data, response, _ in
            let contentType =
                (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
            let maxBytes = 5 * 1024 * 1024
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

    private func saveLink(url: String) {
        _ = try? LibraryAccess.writeCapture(
            url: url, title: sharedTitle, selectionText: nil, tags: [])
        finish()
    }

    /// Copy up to three shared documents into Inbox/ (streamed via temp-file
    /// representations — a large PDF never lives in extension memory).
    private func saveDocuments(_ providers: [NSItemProvider]) {
        let group = DispatchGroup()
        for provider in providers.prefix(3) {
            let typeId =
                provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
                ? UTType.pdf.identifier
                : provider.hasItemConformingToTypeIdentifier("org.idpf.epub-container")
                    ? "org.idpf.epub-container"
                    : UTType.data.identifier
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: typeId) { url, _ in
                defer { group.leave() }
                guard let url else { return }
                _ = try? LibraryAccess.writeDocument(from: url, suggestedName: url.lastPathComponent)
            }
        }
        group.notify(queue: .main) { self.finish() }
    }

    private static func firstURL(in text: String) -> String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        return detector?.firstMatch(in: text, options: [], range: range)?.url?.absoluteString
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
