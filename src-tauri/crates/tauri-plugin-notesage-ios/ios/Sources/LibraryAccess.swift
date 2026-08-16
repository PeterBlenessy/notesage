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
import QuickLookThumbnailing
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
    // Files-app-style row metadata (nil when unavailable).
    let modified: Double?     // seconds since 1970
    // Visible children, directories only — counted in the same pass so a
    // folder row can show a count without an IPC call per row (#684).
    let child_count: Int?
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
        let keys: [URLResourceKey] = [.isDirectoryKey, .nameKey, .contentModificationDateKey]
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
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey])
            // Count with the SAME visibility rule as the listing itself, so a
            // folder of dotfiles reads as empty rather than lying about it.
            let childCount: Int? = isDir
                ? (try? fm.contentsOfDirectory(at: url, includingPropertiesForKeys: nil, options: []))?
                    .filter { child in
                        let n = child.lastPathComponent
                        let display = n.hasPrefix(".") && n.hasSuffix(".icloud")
                            ? String(n.dropFirst().dropLast(7)) : n
                        return !display.hasPrefix(".")
                    }.count
                : nil
            return FileEntryDTO(name: displayName, path: relPath, is_directory: isDir,
                                children: nil, hidden: false,
                                modified: values?.contentModificationDate?.timeIntervalSince1970,
                                child_count: childCount)
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

    /// Copy a library file into the app's temp dir (keeping its basename) so
    /// a UIActivityViewController can hand it to other apps — share targets
    /// cannot read through our security-scoped grant.
    static func copyForSharing(_ rel: String) throws -> URL {
        let data = try readBinary(rel)
        let name = (rel as NSString).lastPathComponent
        // Per-invocation directory: sharing the same file twice must never
        // overwrite a copy an earlier (lazily-reading) share target still
        // holds. The caller deletes the directory when its share completes.
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("share", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(name)
        try data.write(to: dest)
        return dest
    }

    // MARK: - Writes (#586 create/edit notes; all `rel` pre-sanitized by the Rust layer)
    //
    // The app's write surface is deliberately this small: overwrite a text
    // file, create a text file, create a folder. No delete, no rename, no
    // binary writes — those stay out of the binary until they have their own
    // issue-scoped design (#618 covers delete).

    /// Overwrite (or create) a UTF-8 file. Coordinated `.forReplacing` write so
    /// iCloud sees one atomic replacement instead of a truncate+append.
    static func writeFile(_ rel: String, text: String) throws {
        guard !rel.isEmpty else { throw LibraryAccessError.ioError("cannot write the library root") }
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let fileURL = root.appendingPathComponent(rel)
        var coordError: NSError?
        var result: Result<Void, Error> = .failure(LibraryAccessError.ioError("uncoordinated"))
        NSFileCoordinator().coordinate(writingItemAt: fileURL, options: .forReplacing, error: &coordError) { url in
            do {
                try Data(text.utf8).write(to: url, options: .atomic)
                result = .success(())
            } catch { result = .failure(error) }
        }
        if let coordError { throw coordError }
        try result.get()
    }

    /// Create a new UTF-8 file, deduping the name (`note.md` → `note-1.md`)
    /// instead of overwriting — same behaviour the Share Extension's document
    /// capture uses. Returns the final relative path actually created.
    static func createFile(_ rel: String, text: String) throws -> String {
        guard !rel.isEmpty else { throw LibraryAccessError.ioError("file name is empty") }
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let (fileURL, finalRel) = deduped(rel, under: root)
        var coordError: NSError?
        var result: Result<Void, Error> = .failure(LibraryAccessError.ioError("uncoordinated"))
        NSFileCoordinator().coordinate(writingItemAt: fileURL, options: [], error: &coordError) { url in
            do {
                try Data(text.utf8).write(to: url, options: .atomic)
                result = .success(())
            } catch { result = .failure(error) }
        }
        if let coordError { throw coordError }
        try result.get()
        return finalRel
    }

    /// Create a new folder, deduping the name. Returns the final relative path.
    /// Create `rel` (and any missing parents) if absent, WITHOUT the dedupe
    /// `createDirectory` applies. Idempotent by design: the caller wants a
    /// directory to exist at an exact path (`.notesage/` for the shared pins
    /// file), not a uniquely-named new one — deduping there would silently
    /// produce `.notesage-1` and split the state.
    static func ensureDirectory(_ rel: String) throws {
        guard !rel.isEmpty else { throw LibraryAccessError.ioError("folder name is empty") }
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let dirURL = root.appendingPathComponent(rel)
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: dirURL.path, isDirectory: &isDir) {
            if isDir.boolValue { return }
            throw LibraryAccessError.ioError("\(rel) exists and is not a folder")
        }
        var coordError: NSError?
        var result: Result<Void, Error> = .failure(LibraryAccessError.ioError("uncoordinated"))
        NSFileCoordinator().coordinate(writingItemAt: dirURL, options: [], error: &coordError) { url in
            do {
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                result = .success(())
            } catch { result = .failure(error) }
        }
        if let coordError { throw coordError }
        try result.get()
    }

    static func createDirectory(_ rel: String) throws -> String {
        guard !rel.isEmpty else { throw LibraryAccessError.ioError("folder name is empty") }
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let (dirURL, finalRel) = deduped(rel, under: root)
        var coordError: NSError?
        var result: Result<Void, Error> = .failure(LibraryAccessError.ioError("uncoordinated"))
        NSFileCoordinator().coordinate(writingItemAt: dirURL, options: [], error: &coordError) { url in
            do {
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
                result = .success(())
            } catch { result = .failure(error) }
        }
        if let coordError { throw coordError }
        try result.get()
        return finalRel
    }

    /// Rename a file WITHIN its directory (single-segment new name — this is
    /// the title-becomes-filename primitive, not a general move). The new
    /// name is deduped on collision. Returns the final relative path.
    static func renameFile(_ rel: String, to newName: String) throws -> String {
        guard !rel.isEmpty, !newName.isEmpty else { throw LibraryAccessError.ioError("empty path") }
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let src = root.appendingPathComponent(rel)
        let dir = (rel as NSString).deletingLastPathComponent
        let targetRel = dir.isEmpty ? newName : "\(dir)/\(newName)"
        // Renaming to the name it already has is a no-op, not a dedupe to
        // `name-1` — the editor calls this on every save.
        if targetRel == rel { return rel }
        let (dst, finalRel) = deduped(targetRel, under: root)
        var coordError: NSError?
        var result: Result<Void, Error> = .failure(LibraryAccessError.ioError("uncoordinated"))
        let coordinator = NSFileCoordinator()
        coordinator.coordinate(
            writingItemAt: src, options: .forMoving,
            writingItemAt: dst, options: .forReplacing,
            error: &coordError
        ) { s, d in
            do {
                try FileManager.default.moveItem(at: s, to: d)
                coordinator.item(at: s, didMoveTo: d)
                result = .success(())
            } catch { result = .failure(error) }
        }
        if let coordError { throw coordError }
        try result.get()
        return finalRel
    }

    /// Generate a thumbnail PNG via the system QuickLook generator — renders
    /// PDFs, images, videos and office documents off the app's main thread
    /// (replaces the WebView-side pdf.js raster for gallery cards). The
    /// security scope is held until the async generation completes.
    static func thumbnail(
        _ rel: String, maxPixel: CGFloat,
        completion: @escaping (Result<Data, Error>) -> Void
    ) {
        do {
            let root = try resolveRoot()
            let scoped = root.startAccessingSecurityScopedResource()
            let fileURL = root.appendingPathComponent(rel)
            let request = QLThumbnailGenerator.Request(
                fileAt: fileURL,
                size: CGSize(width: maxPixel, height: maxPixel),
                scale: 2,
                representationTypes: .thumbnail
            )
            QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { rep, error in
                if scoped { root.stopAccessingSecurityScopedResource() }
                if let rep, let data = rep.uiImage.pngData() {
                    completion(.success(data))
                } else {
                    completion(.failure(error ?? LibraryAccessError.ioError("no thumbnail")))
                }
            }
        } catch { completion(.failure(error)) }
    }

    /// Delete a FILE (never a directory — recursive folder deletion stays off
    /// the surface, #618) with a coordinated `.forDeleting` write. Deletions
    /// inside the iCloud container land in iCloud Drive's "Recently Deleted"
    /// (30-day recovery), which is the safety net for the no-confirm swipe.
    static func deleteFile(_ rel: String) throws {
        guard !rel.isEmpty else { throw LibraryAccessError.ioError("cannot delete the library root") }
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let fileURL = root.appendingPathComponent(rel)
        if (try? fileURL.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            throw LibraryAccessError.ioError("directories cannot be deleted from the app")
        }
        var coordError: NSError?
        var result: Result<Void, Error> = .failure(LibraryAccessError.ioError("uncoordinated"))
        NSFileCoordinator().coordinate(writingItemAt: fileURL, options: .forDeleting, error: &coordError) { url in
            do {
                try FileManager.default.removeItem(at: url)
                result = .success(())
            } catch { result = .failure(error) }
        }
        if let coordError { throw coordError }
        try result.get()
    }

    /// First free name for `rel` under `root`: `stem.ext`, `stem-1.ext`, `stem-2.ext`, …
    private static func deduped(_ rel: String, under root: URL) -> (URL, String) {
        let ns = rel as NSString
        let dir = ns.deletingLastPathComponent
        let ext = ns.pathExtension
        let stem = (ns.lastPathComponent as NSString).deletingPathExtension
        var candidateRel = rel
        var url = root.appendingPathComponent(rel)
        var n = 1
        while FileManager.default.fileExists(atPath: url.path) {
            let name = ext.isEmpty ? "\(stem)-\(n)" : "\(stem)-\(n).\(ext)"
            candidateRel = dir.isEmpty ? name : "\(dir)/\(name)"
            url = root.appendingPathComponent(candidateRel)
            n += 1
        }
        return (url, candidateRel)
    }

    @discardableResult
    static func ensureDownloaded(_ rel: String) throws -> DownloadState {
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let fileURL = root.appendingPathComponent(rel)
        let values = try? fileURL.resourceValues(forKeys: [
            .ubiquitousItemDownloadingStatusKey,
            .ubiquitousItemDownloadingErrorKey,
        ])
        // A non-nil download error (eviction, iCloud denying the fetch, etc.)
        // is a real, documented Foundation signal that the item will never
        // become ready on its own — report it instead of leaving the caller
        // to poll `.downloading` forever.
        if values?.ubiquitousItemDownloadingError != nil { return .failed }
        if values?.ubiquitousItemDownloadingStatus == .current { return .ready }
        try FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
        return .downloading
    }

    /// Return the file's on-disk size in bytes without reading its content —
    /// a cheap metadata probe that lets the mobile reader decline oversized
    /// files before attempting a full read (issue #616: reading a
    /// multi-hundred-MB text file crossed IPC as one JSON string and froze
    /// the WebView's main thread). `.fileSizeKey` is reported for
    /// not-yet-downloaded iCloud placeholders too (the real remote size), so
    /// a huge undownloaded file is declined before a download even starts.
    static func statFile(_ rel: String) throws -> Int64 {
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let fileURL = root.appendingPathComponent(rel)
        let values = try fileURL.resourceValues(forKeys: [.fileSizeKey])
        guard let size = values.fileSize else {
            throw LibraryAccessError.ioError("file size unavailable")
        }
        return Int64(size)
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
