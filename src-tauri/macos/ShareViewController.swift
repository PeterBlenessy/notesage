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

    private func loadSharedItem() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = item.attachments
        else {
            fail("Nothing to save.")
            return
        }
        sharedTitle = item.attributedContentText?.string

        guard let provider = attachments.first(where: {
            $0.hasItemConformingToTypeIdentifier("public.url")
        }) else {
            fail("Notesage saves links. This share had none.")
            return
        }
        provider.loadItem(forTypeIdentifier: "public.url", options: nil) { [weak self] data, _ in
            let url = (data as? URL)?.absoluteString ?? (data as? String)
            DispatchQueue.main.async { self?.show(url: url) }
        }
    }

    private func show(url: String?) {
        guard let url, !url.isEmpty else {
            fail("Nothing to save.")
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
        titleLabel.stringValue = "Nothing to save"
        statusLabel.stringValue = message
        saveButton.isEnabled = false
        formatPopup.isEnabled = false
    }
}

