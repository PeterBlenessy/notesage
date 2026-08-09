// ShareViewController.swift — Notesage Share Extension (reference source).
//
// Receives a URL (or plain text containing a URL) from the iOS share sheet and
// writes a link-only capture note into the granted library's Inbox/ — without
// launching the host app and without any network call. Reuses the shared grant
// (security-scoped bookmark in the App Group) and the capture formatter from
// LibraryAccess.swift (add that file to this extension target's membership).
//
// PRD: docs/prds/2026-06-28-ios-mobile-app.md (task #9).
// Wired into the NotesageShare app-extension target by
// `src-tauri/ios/integrate-share-extension.py` — see README.md.

import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        handleShare()
    }

    private func handleShare() {
        guard LibraryAccess.getLibraryGrant().granted else {
            show(message: "Open Notesage to set up before sharing.", success: false)
            return
        }
        guard let item = (extensionContext?.inputItems.first as? NSExtensionItem),
              let attachments = item.attachments else {
            finish()
            return
        }
        let title = item.attributedContentText?.string

        // Prefer a URL attachment; fall back to plain text containing a URL.
        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                let url = (data as? URL)?.absoluteString ?? (data as? String)
                self?.save(url: url, title: title)
            }
        } else if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
                let text = data as? String
                let url = text.flatMap { Self.firstURL(in: $0) } ?? text
                self?.save(url: url, title: title, selection: text)
            }
        } else {
            finish()
        }
    }

    private func save(url: String?, title: String?, selection: String? = nil) {
        guard let url, !url.isEmpty else { DispatchQueue.main.async { self.finish() }; return }
        do {
            _ = try LibraryAccess.writeCapture(url: url, title: title, selectionText: selection, tags: [])
            DispatchQueue.main.async { self.show(message: "Saved to Notesage Inbox", success: true) }
        } catch {
            DispatchQueue.main.async { self.show(message: "Couldn’t save to Notesage", success: false) }
        }
    }

    private static func firstURL(in text: String) -> String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        return detector?.firstMatch(in: text, options: [], range: range)?.url?.absoluteString
    }

    private func show(message: String, success: Bool) {
        let alert = UIAlertController(title: success ? "Notesage" : nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Done", style: .default) { _ in self.finish() })
        present(alert, animated: true)
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
