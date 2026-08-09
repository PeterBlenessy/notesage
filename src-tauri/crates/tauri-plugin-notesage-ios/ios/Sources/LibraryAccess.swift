// LibraryAccess.swift — Notesage iOS library access.
//
// Security-scoped access to the user's `iCloud Drive/Notesage` folder, persisted
// as a bookmark in the shared App Group so both the app and the Share Extension
// resolve the same grant. iCloud-aware reads via NSFileCoordinator.
//
// Compiled into BOTH targets: the app via this plugin crate's Swift package
// (wired by `tauri ios init`), and the Share Extension as a direct source
// (wired by `src-tauri/ios/integrate-share-extension.py`).
// PRD: docs/prds/2026-06-28-ios-mobile-app.md (tasks #3, #4, #8).

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
            // Cancelling the picker is a routine action, not an error: resolve
            // granted:false so the frontend shows its friendly "No folder was
            // selected" path. Rejecting here surfaced a raw NSError string
            // ("The operation couldn't be completed…") on a simple back-out.
            guard let url = urls.first else {
                completion(.success(LibraryGrant(displayName: "", granted: false)))
                return
            }
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
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            // iCloud placeholders are named ".<name>.icloud" — present the real name.
            let displayName = name.hasPrefix(".") && name.hasSuffix(".icloud")
                ? String(name.dropFirst().dropLast(7)) : name
            // Dotfiles and dot-directories are excluded outright — the mobile
            // browser has no "show hidden" toggle, and `.notesage/` (comment
            // sidecars, project metadata) or `.git/` must not be one tap away.
            // Mirrors the desktop's default-hidden behavior.
            if displayName.hasPrefix(".") { return nil }
            let relPath = url.path.replacingOccurrences(of: root.path + "/", with: "")
            return FileEntryDTO(name: displayName, path: relPath, is_directory: isDir,
                                children: nil, hidden: false)
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

}

/// Retained picker delegate that forwards the selection.
private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
    static var assocKey = 0
    private let onPick: ([URL]) -> Void
    init(onPick: @escaping ([URL]) -> Void) { self.onPick = onPick }
    func documentPicker(_ c: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { onPick(urls) }
    func documentPickerWasCancelled(_ c: UIDocumentPickerViewController) { onPick([]) }
}
