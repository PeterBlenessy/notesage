//  ShareViewController.swift
//  Notesage macOS Share Extension
//
//  Phase 2 of `docs/prds/2026-08-22-macos-share-extension.md`.
//
//  The iOS controller is UIKit and cannot be ported, so this is a rewrite —
//  but a deliberately small one. Everything worth getting right (extraction,
//  note format, dedupe, the X path) lives in `notesage-capture` and is shared;
//  what is here is a preview, a format picker and two buttons.
//
//  Built programmatically rather than from a xib: there is no Xcode project to
//  edit. Tauri produces the `.app` directly, so every interface file would
//  have to be compiled and embedded by hand anyway, and a xib is harder to
//  review in a diff than the code that would load it.
//
//  What this CANNOT do, and it matters
//  -----------------------------------
//  macOS share extensions have no `NSExtensionJavaScriptPreprocessingFile`.
//  On iOS that hands us the DOM Safari rendered, which is how build 7 fixed
//  lazy-loaded images. Here there is no such handoff, so capture falls back to
//  fetching the URL and inherits the placeholder problem iOS escaped. That is
//  a property of the platform; the only route to parity is a Safari extension.

import AppKit
import Foundation

/// Localized string lookup, same helper as the iOS extension.
///
/// The strings themselves are SHARED — `src-tauri/ios/ShareResources/*.lproj`,
/// copied into this bundle by `scripts/build-macos-share-extension.sh`. Both
/// extensions show the same words, so a second copy would be a second thing to
/// forget updating.
///
/// A hardcoded literal here ships an English word into a Swedish share sheet,
/// which is precisely what this extension did until now: 17 `L()` calls on
/// iOS, zero on macOS.
private func L(_ key: String, _ args: CVarArg...) -> String {
    let format = NSLocalizedString(key, comment: "")
    return args.isEmpty ? format : String(format: format, arguments: args)
}

/// Whether the user has cancelled this share.
///
/// The same eight lines as the iOS extension's `CancelFlag`, and deliberately
/// so — the two extensions cannot link each other, and the identical defect
/// existed on both. `pipeline_contract.rs` asserts both copies exist rather
/// than trusting the discipline that has already failed here repeatedly.
///
/// A plain `Bool` will not do: the save chain crosses main, two URLSession
/// delegate queues and a background write queue, and Cancel is tapped on main.
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

final class ShareViewController: NSViewController {
    private enum Format: Int, CaseIterable {
        case articleHtml, articleMarkdown, link

        var label: String {
            switch self {
            case .articleHtml: return L("share.formatHtml")
            case .articleMarkdown: return L("share.formatArticle")
            case .link: return L("share.formatLink")
            }
        }

        var captureFormat: ShareCapture.Format {
            switch self {
            case .articleHtml: return .articleHtml
            case .articleMarkdown: return .articleMarkdown
            case .link: return .link
            }
        }
    }

    /// Remembered across shares, because the answer is almost always the same
    /// one as last time.
    private static let formatKey = "notesage.share.lastFormat"

    private var sharedUrl: String?
    private var sharedTitle: String?

    private let titleLabel = NSTextField(labelWithString: "")
    private let urlLabel = NSTextField(labelWithString: "")
    private let statusLabel = NSTextField(labelWithString: "")
    private let formatPopup = NSPopUpButton()
    private let saveButton = NSButton()
    private let grantButton = NSButton()

    /// Raised by Cancel, read from every queue the save chain touches.
    ///
    /// Cancel dismissed the sheet and left the fetch/render/write chain
    /// running, so an explicitly cancelled share still landed in the library
    /// and `completeRequest` was then called on an already-cancelled context.
    private let cancelled = CancelFlag()

    /// Attachments that are FILES rather than links (PDF, EPUB, image, …).
    /// Non-empty means this share is a document drop, which skips the format
    /// picker entirely — there is no article to extract from a PDF.
    private var documentProviders: [NSItemProvider] = []

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 380, height: 210))
        buildUI()
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        loadSharedItem()
        refreshGrantState()
    }

    // MARK: - UI

    private func buildUI() {
        titleLabel.font = .boldSystemFont(ofSize: 13)
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.maximumNumberOfLines = 2

        urlLabel.font = .systemFont(ofSize: 11)
        urlLabel.textColor = .secondaryLabelColor
        urlLabel.lineBreakMode = .byTruncatingMiddle

        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.maximumNumberOfLines = 2

        for format in Format.allCases {
            formatPopup.addItem(withTitle: format.label)
        }
        formatPopup.selectItem(at: UserDefaults.standard.integer(forKey: Self.formatKey))

        saveButton.title = L("share.save")
        saveButton.bezelStyle = .rounded
        saveButton.keyEquivalent = "\r"
        saveButton.target = self
        saveButton.action = #selector(save)

        let cancelButton = NSButton()
        cancelButton.title = L("share.cancel")
        cancelButton.bezelStyle = .rounded
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.target = self
        cancelButton.action = #selector(cancel)

        grantButton.title = L("share.chooseLibrary")
        grantButton.bezelStyle = .rounded
        grantButton.target = self
        grantButton.action = #selector(chooseLibrary)
        grantButton.isHidden = true

        let buttons = NSStackView(views: [cancelButton, saveButton])
        buttons.orientation = .horizontal
        buttons.spacing = 8

        let stack = NSStackView(views: [
            titleLabel, urlLabel, formatPopup, grantButton, statusLabel, buttons,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -20),
        ])
    }

    // MARK: - Input

    /// Type identifiers a shared link can arrive as, in preference order.
    ///
    /// `public.url` is the normal one. The others are fallbacks: Safari and
    /// several apps hand a link over as plain text, and some deliver it inside
    /// the property-list attachment that the web-page activation rule
    /// produces. Accepting only `public.url` made every one of those look like
    /// an empty share.
    private static let urlTypeIdentifiers = [
        "public.url",
        "public.file-url",
        "public.plain-text",
        "com.apple.property-list",
    ]

    /// Types that mean "this is a file to store", not "this is a link to
    /// capture". Mirrors the iOS list so the two platforms accept the same
    /// drops.
    ///
    /// The file check still has to run BEFORE the link check: a shared PDF
    /// also advertises `public.file-url`, which IS in `urlTypeIdentifiers`, so
    /// checking for a link first would route every document down the article
    /// path and try to extract prose from a PDF.
    ///
    /// `public.file-url` is deliberately absent from THIS list. It says
    /// nothing about what the file is, so treating it as a document marker
    /// would swallow link shares that happen to carry a file URL.
    private static let documentTypeIdentifiers = [
        "com.adobe.pdf",
        "org.idpf.epub-container",
        "public.image",
        "public.movie",
        "public.audio",
    ]

    /// Copy each shared file into `Inbox/` under its own name.
    ///
    /// Bounded at 10, matching the activation rule — a share of a whole folder
    /// should not silently turn into an unbounded copy loop inside an
    /// extension.
    private func saveDocuments(_ providers: [NSItemProvider]) {
        saveButton.isEnabled = false
        statusLabel.stringValue = L("share.saving")

        // Bounded at the activation rule's LARGEST count (File/Image are 10;
        // Movie is 3, so a >3-movie batch never reaches us at all). Anything
        // beyond would be dropped silently, so the count the summary compares
        // against must be the count actually ATTEMPTED, not the count offered.
        let attempted = Array(providers.prefix(10))
        let group = DispatchGroup()
        // `loadFileRepresentation` calls back on an arbitrary queue and these
        // run concurrently, so the counter needs a lock. Unsynchronised `+= 1`
        // from several queues is a genuine race, and the failure it produces —
        // an occasional wrong count — is exactly the kind that never
        // reproduces on the machine you debug it on.
        let lock = NSLock()
        var failures = 0
        func recordFailure() {
            lock.lock()
            failures += 1
            lock.unlock()
        }
        for provider in attempted {
            // Most specific conforming type first — the provider hands back
            // the richest file representation for it.
            let typeId = Self.documentTypeIdentifiers
                .first(where: provider.hasItemConformingToTypeIdentifier) ?? "public.data"
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: typeId) { [weak self] url, error in
                defer { group.leave() }
                // Per item, not just at the end: a ten-file batch off an iCloud
                // volume is seconds of copying, and Cancel should stop it where
                // it stands rather than after every file has landed.
                guard let self, !self.cancelled.isCancelled else { return }
                guard let url else {
                    NSLog("[notesage-share] file load failed: %@", String(describing: error))
                    recordFailure()
                    return
                }
                do {
                    try ShareLibraryAccess.writeDocument(
                        from: url, suggestedName: url.lastPathComponent)
                } catch {
                    NSLog("[notesage-share] file write failed: %@", String(describing: error))
                    recordFailure()
                }
            }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self, !self.cancelled.isCancelled else { return }
            if failures == 0 {
                self.extensionContext?.completeRequest(returningItems: [])
            } else {
                // Never close on failure — a sheet that vanishes having saved
                // nothing is indistinguishable from one that worked.
                self.saveButton.isEnabled = true
                self.statusLabel.stringValue = failures == attempted.count
                    ? L("share.couldNotSaveFiles")
                    : L("share.someFilesFailed", failures)
            }
        }
    }

    private func loadSharedItem() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            // Distinct message per failure, deliberately. All three paths used
            // to say "Nothing to save.", so a screenshot could not tell them
            // apart and diagnosing meant guessing — which is how this shipped.
            fail(L("share.noShareItem"))
            return
        }
        guard let attachments = item.attachments, !attachments.isEmpty else {
            fail(L("share.noAttachments"))
            return
        }
        sharedTitle = item.attributedContentText?.string

        // What actually arrived, named. Read with:
        //   log stream --predicate 'subsystem == "com.notesage.app.ShareExtension"'
        let offered = attachments.flatMap { $0.registeredTypeIdentifiers }
        NSLog("[notesage-share] attachments=%d types=%@",
              attachments.count, offered.joined(separator: ", "))

        // Files first. A shared PDF also advertises `public.file-url`, so
        // checking for a link before checking for a file would route every
        // document down the article path and try to extract prose from it.
        documentProviders = attachments.filter { p in
            Self.documentTypeIdentifiers.contains(where: p.hasItemConformingToTypeIdentifier)
        }
        if !documentProviders.isEmpty {
            let count = documentProviders.count
            titleLabel.stringValue = count == 1
                ? L("share.saveOneFile") : L("share.saveManyFiles", count)
            urlLabel.stringValue = ""
            formatPopup.isHidden = true
            refreshGrantState()
            return
        }

        guard let (provider, identifier) = Self.urlTypeIdentifiers.lazy.compactMap({ type -> (NSItemProvider, String)? in
            attachments.first { $0.hasItemConformingToTypeIdentifier(type) }.map { ($0, type) }
        }).first else {
            fail(L("share.noLinkOffered", offered.joined(separator: ", ")))
            return
        }

        provider.loadItem(forTypeIdentifier: identifier, options: nil) { [weak self] data, error in
            if let error {
                NSLog("[notesage-share] loadItem(%@) failed: %@", identifier, error.localizedDescription)
            }
            let url = Self.urlString(from: data)
            NSLog("[notesage-share] loaded %@ -> %@", identifier, url ?? "<nil>")
            DispatchQueue.main.async { self?.show(url: url, from: identifier, raw: data) }
        }
    }

    /// Coax a URL string out of whatever the provider handed back.
    ///
    /// `loadItem` is typed `NSSecureCoding` and the concrete type depends on
    /// the sender: `NSURL` normally, `NSString` when the link came as text,
    /// `Data` when it arrives as UTF-8 bytes, and a dictionary for the
    /// property-list shape. Casting only to `URL`/`String` dropped the last two
    /// on the floor and reported an empty share.
    private static func urlString(from data: Any?) -> String? {
        switch data {
        case let url as URL: return url.absoluteString
        case let string as String: return string.trimmingCharacters(in: .whitespacesAndNewlines)
        case let bytes as Data: return String(data: bytes, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        case let dict as [String: Any]:
            // The web-page rule's payload; `NSExtensionJavaScriptPreprocessingResultsKey`
            // nests the script's return value one level down.
            let results = dict["NSExtensionJavaScriptPreprocessingResultsKey"] as? [String: Any]
            return (results?["URL"] as? String) ?? (dict["URL"] as? String)
        default: return nil
        }
    }

    private func show(url: String?, from identifier: String, raw: Any?) {
        guard let url, !url.isEmpty else {
            let describedType = raw.map { String(describing: type(of: $0)) } ?? "nil"
            fail(L("share.couldNotReadLink", identifier, describedType))
            return
        }
        guard url.lowercased().hasPrefix("http://") || url.lowercased().hasPrefix("https://") else {
            // A file:// URL or similar is a real share, just not one we capture.
            fail(L("share.notAWebLinkWas", url))
            return
        }
        sharedUrl = url
        titleLabel.stringValue = sharedTitle?.isEmpty == false ? sharedTitle! : L("share.saveToNotesage")
        urlLabel.stringValue = url
        // Save is gated on `sharedUrl != nil`, and the URL arrives HERE —
        // asynchronously, long after `viewDidAppear` ran the check with it
        // still nil. Without this line the button is enabled only by the other
        // caller, `chooseLibrary`'s success path.
        //
        // Which is why the FIRST share worked and every later one did not: the
        // first needs a library grant, and granting re-ran the check once the
        // URL had landed. With a grant already stored the button stays hidden,
        // nothing re-runs the check, and Save is dead for the rest of the
        // extension's life.
        refreshGrantState()
    }

    /// Show the library picker only when there is no usable grant.
    ///
    /// The extension holds its OWN bookmark (see ShareLibraryAccess), so the
    /// first share after installing needs one folder choice. Saying that up
    /// front beats a save that fails at the last moment.
    private func refreshGrantState() {
        let grant = ShareLibraryAccess.currentGrant()
        grantButton.isHidden = grant.granted
        // Either a link or a set of files makes this share saveable.
        saveButton.isEnabled = grant.granted && (sharedUrl != nil || !documentProviders.isEmpty)
        if !grant.granted {
            statusLabel.stringValue = L("share.chooseLibraryToSave")
        }
    }

    // MARK: - Actions

    @objc private func chooseLibrary() {
        ShareLibraryAccess.requestGrant { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .success:
                    self.statusLabel.stringValue = ""
                    self.refreshGrantState()
                case .failure(let error):
                    self.statusLabel.stringValue = error.localizedDescription
                }
            }
        }
    }

    @objc private func cancel() {
        // Raise the flag BEFORE dismissing. `ShareCapture.save` checks it
        // immediately before it writes, so a save already in flight when
        // Cancel lands leaves nothing behind.
        //
        // Cancel deliberately stays enabled after Save is tapped: disabling it
        // would also have closed this bug, but a sheet that cannot be dismissed
        // for the length of a fetch-plus-render is its own bug.
        cancelled.cancel()
        saveButton.isEnabled = false
        extensionContext?.cancelRequest(withError: NSError(
            domain: "com.notesage.app.share", code: NSUserCancelledError))
    }

    @objc private func save() {
        if !documentProviders.isEmpty {
            saveDocuments(documentProviders)
            return
        }
        guard let url = sharedUrl else { return }
        UserDefaults.standard.set(formatPopup.indexOfSelectedItem, forKey: Self.formatKey)
        let format = Format(rawValue: formatPopup.indexOfSelectedItem) ?? .link

        saveButton.isEnabled = false
        statusLabel.stringValue = L("share.saving")

        ShareCapture.save(
            url: url, title: sharedTitle, format: format.captureFormat,
            isCancelled: { [cancelled] in cancelled.isCancelled }
        ) { [weak self] result in
            DispatchQueue.main.async {
                guard let self, !self.cancelled.isCancelled else { return }
                switch result {
                case .success:
                    self.extensionContext?.completeRequest(returningItems: [])
                case .failure(let error):
                    // Never close on failure. A share sheet that vanishes
                    // having saved nothing is indistinguishable from one that
                    // worked, and the user finds out days later.
                    self.saveButton.isEnabled = true
                    self.statusLabel.stringValue = error.localizedDescription
                }
            }
        }
    }

    private func fail(_ message: String) {
        // "Nothing to save" for every failure told the user nothing and told
        // whoever had to debug it less. The message carries the specific
        // cause; the title just says something went wrong.
        titleLabel.stringValue = L("share.cantSaveThis")
        statusLabel.stringValue = message
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.maximumNumberOfLines = 4
        saveButton.isEnabled = false
        formatPopup.isEnabled = false
        NSLog("[notesage-share] %@", message)
    }
}

