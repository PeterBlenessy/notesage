// LibraryAccess.swift — Notesage iOS library access (reference source).
//
// Security-scoped access to the user's `iCloud Drive/Notesage` folder, persisted
// as a bookmark in the shared App Group so both the app and the Share Extension
// resolve the same grant. iCloud-aware reads via NSFileCoordinator.
//
// PRD: docs/prds/2026-06-28-ios-mobile-app.md (tasks #3, #4, #8).
// NOT yet integrated — see src-tauri/ios/README.md. Set APP_GROUP_ID to the
// real `group.<bundle-id>` and add this file to both the app and the extension
// target membership.

import Foundation
import UIKit
import UniformTypeIdentifiers

enum LibraryAccessError: Error { case noGrant, staleBookmark, notADirectory, ioError(String) }

struct LibraryGrant: Codable { let displayName: String; let granted: Bool }
struct FileEntryDTO: Codable {
    let name: String
    let path: String          // relative to the library root
    let is_directory: Bool
    let children: [FileEntryDTO]?
    let hidden: Bool
}
enum DownloadState: String, Codable { case ready, downloading, failed }

enum LibraryAccess {
    /// Set to the real App Group id (must match the entitlement on both targets).
    static let APP_GROUP_ID = "group.com.notesage.app"
    private static let bookmarkKey = "notesage.library.bookmark"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: APP_GROUP_ID) }

    // MARK: - Grant lifecycle

    /// Present the folder picker pre-pointed at iCloud Drive/Notesage and persist
    /// a security-scoped bookmark for the chosen folder. Must be driven from a
    /// view controller; the Tauri plugin should hop to the main actor and use
    /// the key window's rootViewController.
    @MainActor
    static func pickLibraryFolder(presenter: UIViewController,
                                  completion: @escaping (Result<LibraryGrant, Error>) -> Void) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        picker.allowsMultipleSelection = false
        // Pre-point at iCloud Drive/Notesage so the grant is a confirm tap.
        if let icloud = FileManager.default.url(forUbiquityContainerIdentifier: nil)?
            .deletingLastPathComponent()  // .../Mobile Documents
            .appendingPathComponent("com~apple~CloudDocs/Notesage", isDirectory: true) {
            picker.directoryURL = icloud
        }
        let delegate = PickerDelegate { urls in
            guard let url = urls.first else { completion(.failure(LibraryAccessError.noGrant)); return }
            do {
                let grant = try persistBookmark(for: url)
                completion(.success(grant))
            } catch { completion(.failure(error)) }
        }
        picker.delegate = delegate
        objc_setAssociatedObject(picker, &PickerDelegate.assocKey, delegate, .OBJC_ASSOCIATION_RETAIN)
        presenter.present(picker, animated: true)
    }

    static func persistBookmark(for url: URL) throws -> LibraryGrant {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let data = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        defaults?.set(data, forKey: bookmarkKey)
        return LibraryGrant(displayName: url.lastPathComponent, granted: true)
    }

    static func getLibraryGrant() -> LibraryGrant {
        guard let root = try? resolveRoot() else {
            return LibraryGrant(displayName: "", granted: false)
        }
        return LibraryGrant(displayName: root.lastPathComponent, granted: true)
    }

    static func clearLibraryGrant() { defaults?.removeObject(forKey: bookmarkKey) }

    /// Resolve the bookmarked root URL. Throws on missing/stale bookmark.
    static func resolveRoot() throws -> URL {
        guard let data = defaults?.data(forKey: bookmarkKey) else { throw LibraryAccessError.noGrant }
        var stale = false
        let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        if stale {
            // Best-effort refresh; if it fails the caller treats the grant as stale.
            if url.startAccessingSecurityScopedResource() {
                defer { url.stopAccessingSecurityScopedResource() }
                if let fresh = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) {
                    defaults?.set(fresh, forKey: bookmarkKey)
                } else { throw LibraryAccessError.staleBookmark }
            } else { throw LibraryAccessError.staleBookmark }
        }
        return url
    }

    // MARK: - Reads (all `rel` are pre-sanitized by the Rust layer)

    static func listDirectory(_ rel: String) throws -> [FileEntryDTO] {
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let dir = rel.isEmpty ? root : root.appendingPathComponent(rel)
        return try children(of: dir, root: root)
    }

    private static func children(of dir: URL, root: URL) throws -> [FileEntryDTO] {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.isDirectoryKey, .nameKey]
        let urls = try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys, options: [])
        return urls.compactMap { url in
            let name = url.lastPathComponent
            if name == ".DS_Store" { return nil }
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            // iCloud placeholders are named ".<name>.icloud" — present the real name.
            let displayName = name.hasPrefix(".") && name.hasSuffix(".icloud")
                ? String(name.dropFirst().dropLast(7)) : name
            let relPath = url.path.replacingOccurrences(of: root.path + "/", with: "")
            return FileEntryDTO(name: displayName, path: relPath, is_directory: isDir,
                                children: nil, hidden: displayName.hasPrefix("."))
        }.sorted { ($0.is_directory ? 0 : 1, $0.name.lowercased()) < ($1.is_directory ? 0 : 1, $1.name.lowercased()) }
    }

    static func readFile(_ rel: String) throws -> String {
        let data = try readBinary(rel)
        return String(decoding: data, as: UTF8.self)
    }

    static func readBinary(_ rel: String) throws -> Data {
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let fileURL = root.appendingPathComponent(rel)
        var coordError: NSError?
        var result: Result<Data, Error> = .failure(LibraryAccessError.ioError("uncoordinated"))
        NSFileCoordinator().coordinate(readingItemAt: fileURL, options: [], error: &coordError) { url in
            do { result = .success(try Data(contentsOf: url)) }
            catch { result = .failure(error) }
        }
        if let coordError { throw coordError }
        return try result.get()
    }

    @discardableResult
    static func ensureDownloaded(_ rel: String) throws -> DownloadState {
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let fileURL = root.appendingPathComponent(rel)
        let values = try? fileURL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
        if values?.ubiquitousItemDownloadingStatus == .current { return .ready }
        try FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
        return .downloading
    }

    // MARK: - Capture write (mirror of capture.rs::build_capture_note)

    static func writeCapture(url: String, title: String?, selectionText: String?, tags: [String]) throws -> String {
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        let now = Date()
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime]
        let stampFmt = DateFormatter()
        stampFmt.dateFormat = "yyyy-MM-dd-HHmmss"; stampFmt.timeZone = TimeZone(identifier: "UTC")
        let stamp = stampFmt.string(from: now)
        let slug = Self.slug(title: title, url: url)

        var name = "\(stamp)-\(slug).md"
        var target = inbox.appendingPathComponent(name)
        var n = 1
        while FileManager.default.fileExists(atPath: target.path) {
            name = "\(stamp)-\(slug)-\(n).md"; target = inbox.appendingPathComponent(name); n += 1
        }

        let effectiveTags = tags.isEmpty ? ["inbox"] : tags
        var fm = "---\ntype: capture\nsource_url: \(yamlQuote(url))\n"
        if let t = title?.trimmingCharacters(in: .whitespaces), !t.isEmpty { fm += "title: \(yamlQuote(t))\n" }
        fm += "date_saved: \(yamlQuote(iso.string(from: now)))\ntags:\n"
        for t in effectiveTags { fm += "  - \(yamlQuote(t))\n" }
        fm += "---\n\n\(url)\n"
        if let s = selectionText?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty { fm += "\n\(s)\n" }

        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) { url in
            do { try fm.data(using: .utf8)?.write(to: url) } catch { writeError = error }
        }
        if let coordError { throw coordError }
        if let writeError { throw writeError }
        return "Inbox/\(name)"
    }

    private static func slug(title: String?, url: String) -> String {
        let basis = (title?.trimmingCharacters(in: .whitespaces).isEmpty == false) ? title! : host(of: url)
        var out = ""; var prevDash = false
        for ch in basis.lowercased() {
            if ch.isLetter || ch.isNumber { out.append(ch); prevDash = false }
            else if !prevDash && !out.isEmpty { out.append("-"); prevDash = true }
        }
        while out.hasSuffix("-") { out.removeLast() }
        if out.count > 50 { out = String(out.prefix(50)); while out.hasSuffix("-") { out.removeLast() } }
        return out.isEmpty ? "capture" : out
    }

    private static func host(of url: String) -> String {
        let afterScheme = url.components(separatedBy: "://").last ?? url
        let host = afterScheme.components(separatedBy: CharacterSet(charactersIn: "/?#")).first ?? afterScheme
        let noUser = host.components(separatedBy: "@").last ?? host
        return noUser.components(separatedBy: ":").first ?? noUser
    }

    private static func yamlQuote(_ v: String) -> String {
        "\"" + v.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }
}

/// Retained picker delegate that forwards the selection.
private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
    static var assocKey = 0
    private let onPick: ([URL]) -> Void
    init(onPick: @escaping ([URL]) -> Void) { self.onPick = onPick }
    func documentPicker(_ c: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { onPick(urls) }
    func documentPickerWasCancelled(_ c: UIDocumentPickerViewController) { onPick([]) }
}
