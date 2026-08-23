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

final class ShareViewController: NSViewController {
    private enum Format: Int, CaseIterable {
        case articleHtml, articleMarkdown, link

        var label: String {
            switch self {
            case .articleHtml: return "Article (HTML)"
            case .articleMarkdown: return "Article (Markdown)"
            case .link: return "Link"
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

        saveButton.title = "Save"
        saveButton.bezelStyle = .rounded
        saveButton.keyEquivalent = "\r"
        saveButton.target = self
        saveButton.action = #selector(save)

        let cancelButton = NSButton()
        cancelButton.title = "Cancel"
        cancelButton.bezelStyle = .rounded
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.target = self
        cancelButton.action = #selector(cancel)

        grantButton.title = "Choose Library…"
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

    private func loadSharedItem() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            // Distinct message per failure, deliberately. All three paths used
            // to say "Nothing to save.", so a screenshot could not tell them
            // apart and diagnosing meant guessing — which is how this shipped.
            fail("No share item was received.")
            return
        }
        guard let attachments = item.attachments, !attachments.isEmpty else {
            fail("The share carried no attachments.")
            return
        }
        sharedTitle = item.attributedContentText?.string

        // What actually arrived, named. Read with:
        //   log stream --predicate 'subsystem == "com.notesage.app.ShareExtension"'
        let offered = attachments.flatMap { $0.registeredTypeIdentifiers }
        NSLog("[notesage-share] attachments=%d types=%@",
              attachments.count, offered.joined(separator: ", "))

        guard let (provider, identifier) = Self.urlTypeIdentifiers.lazy.compactMap({ type -> (NSItemProvider, String)? in
            attachments.first { $0.hasItemConformingToTypeIdentifier(type) }.map { ($0, type) }
        }).first else {
            fail("This share had no link. It offered: \(offered.joined(separator: ", "))")
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
            fail("Could not read a link from this share (\(identifier), \(describedType)).")
            return
        }
        guard url.lowercased().hasPrefix("http://") || url.lowercased().hasPrefix("https://") else {
            // A file:// URL or similar is a real share, just not one we capture.
            fail("Notesage captures web links. This was: \(url)")
            return
        }
        sharedUrl = url
        titleLabel.stringValue = sharedTitle?.isEmpty == false ? sharedTitle! : "Save to Notesage"
        urlLabel.stringValue = url
    }

    /// Show the library picker only when there is no usable grant.
    ///
    /// The extension holds its OWN bookmark (see ShareLibraryAccess), so the
    /// first share after installing needs one folder choice. Saying that up
    /// front beats a save that fails at the last moment.
    private func refreshGrantState() {
        let grant = ShareLibraryAccess.currentGrant()
        grantButton.isHidden = grant.granted
        saveButton.isEnabled = grant.granted && sharedUrl != nil
        if !grant.granted {
            statusLabel.stringValue = "Choose your Notesage library folder to save here."
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
        extensionContext?.cancelRequest(withError: NSError(
            domain: "com.notesage.app.share", code: NSUserCancelledError))
    }

    @objc private func save() {
        guard let url = sharedUrl else { return }
        UserDefaults.standard.set(formatPopup.indexOfSelectedItem, forKey: Self.formatKey)
        let format = Format(rawValue: formatPopup.indexOfSelectedItem) ?? .link

        saveButton.isEnabled = false
        statusLabel.stringValue = "Saving…"

        ShareCapture.save(url: url, title: sharedTitle, format: format.captureFormat) {
            [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
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
        titleLabel.stringValue = "Can't save this"
        statusLabel.stringValue = message
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.maximumNumberOfLines = 4
        saveButton.isEnabled = false
        formatPopup.isEnabled = false
        NSLog("[notesage-share] %@", message)
    }
}

