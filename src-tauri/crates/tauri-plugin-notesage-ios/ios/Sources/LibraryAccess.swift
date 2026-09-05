// LibraryAccess.swift — Notesage iOS library access.
//
// The library root, resolved one of two ways (PRD
// docs/prds/2026-09-05-icloud-container-library.md, Decisions 1, 4, 5, 8):
//
//  - `container` — the app's own iCloud container, `iCloud.com.notesage.app`,
//    whose `Documents/` folder IS the library. No grant, no picker: iCloud
//    creates it on whichever device runs first, and the Files app shows it
//    as "Notesage" under iCloud Drive.
//  - `picked`    — a folder the user chose in the document picker, held as a
//    security-scoped bookmark. The fallback when iCloud is unavailable, and a
//    choice ("Use a different folder…") for anyone who wants it.
//
// The mode lives in the shared App Group defaults beside the bookmark, so
// the app and the Share Extension resolve the same root, and it is
// RECONCILED at the top of every `resolveRoot()` — a switch the app makes is
// honoured by the extension without a relaunch, and vice versa.
//
// Every read and write is NSFileCoordinator-coordinated, in both modes.
//
// Compiled into BOTH targets: the app via this plugin crate's Swift package
// (wired by `tauri ios init`), and the Share Extension as a direct source
// (wired by `src-tauri/ios/integrate-share-extension.py`).
// PRDs: docs/prds/2026-06-28-ios-mobile-app.md (tasks #3, #4, #8),
// docs/prds/2026-09-05-icloud-container-library.md (tasks #3, #4).

import Foundation
import QuickLookThumbnailing
import UIKit
import UniformTypeIdentifiers

enum LibraryAccessError: Error {
    case noGrant, staleBookmark, iCloudUnavailable, notADirectory, ioError(String)
}

/// How the library root is resolved. Raw values are the wire strings the
/// Rust `LibraryKind` enum and the frontend's `IosLibraryKind` use.
enum LibraryKind: String, Codable { case container, picked }

struct LibraryGrant: Codable {
    let displayName: String
    let granted: Bool
    /// How the root was resolved. Nil when not granted.
    let kind: LibraryKind?
    /// Whether the iCloud container could be resolved at all — drives the
    /// onboarding copy (picker fallback vs. "reconnect your folder").
    let icloudAvailable: Bool
}
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
    /// The app's own iCloud container (must match the iCloud entitlement on
    /// both targets and `ICLOUD_CONTAINER` in integrate-share-extension.py).
    static let CONTAINER_ID = "iCloud.com.notesage.app"
    private static let bookmarkKey = "notesage.library.bookmark"
    private static let modeKey = "notesage.library.mode"
    /// `<root>/.notesage/library.json` — mirrors `LIBRARY_MARKER_REL_PATH`
    /// in `src/lib/library-marker.ts` and `src-tauri/src/library_marker.rs`.
    private static let markerRelPath = ".notesage/library.json"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: APP_GROUP_ID) }

    // MARK: - The iCloud container

    /// Per-process cache of the container's `Documents/` root. Outer nil =
    /// not yet resolved; `.some(nil)` = resolved, iCloud unavailable.
    private static var containerCache: URL?? = nil
    private static let containerLock = NSLock()

    /// The container's `Documents/` folder — the library root in `container`
    /// mode — or nil when iCloud is unavailable for this app (no account,
    /// iCloud Drive off for Notesage, an unentitled build).
    ///
    /// The FIRST call per process can block for seconds: it initialises the
    /// container locally. Never call it on the main thread cold — the plugin
    /// resolves it from `setupLibrary` on a background queue and the Share
    /// Extension resolves before its first layout; after that the cached
    /// answer is immediate. Callers that reach here through `resolveRoot()`
    /// on the main thread are relying on that warm cache.
    ///
    /// Creates `Documents/` on first use and, only when it created it, writes
    /// the library marker. A marker that already exists is never touched: the
    /// Mac's migration extends it, and iCloud may be bringing one down from
    /// another device.
    static func containerRoot() -> URL? {
        containerLock.lock()
        defer { containerLock.unlock() }
        if let cached = containerCache { return cached }
        let resolved = resolveContainerRootUncached()
        containerCache = .some(resolved)
        return resolved
    }

    private static func resolveContainerRootUncached() -> URL? {
        let fm = FileManager.default
        guard let container = fm.url(forUbiquityContainerIdentifier: CONTAINER_ID) else {
            return nil
        }
        let root = container.appendingPathComponent("Documents", isDirectory: true)
        var isDir: ObjCBool = false
        let existed = fm.fileExists(atPath: root.path, isDirectory: &isDir) && isDir.boolValue
        if !existed {
            do {
                try fm.createDirectory(at: root, withIntermediateDirectories: true)
            } catch {
                // A container we cannot populate is as good as no container.
                return nil
            }
            writeMarkerIfAbsent(at: root)
        }
        return root
    }

    // MARK: - The library marker (minimal writer + reader)

    /// What `reconcile()` needs from the marker: whether one exists, and
    /// whether it records a migration.
    struct MarkerFacts {
        let exists: Bool
        let migratedFrom: String?
    }

    /// Read `<root>/.notesage/library.json`. An undownloaded iCloud
    /// placeholder (`.notesage/.library.json.icloud`) counts as EXISTING —
    /// the marker was written by some device — but says nothing about a
    /// migration yet; the download is started so the next call can answer.
    static func readMarker(at root: URL) -> MarkerFacts {
        let fm = FileManager.default
        let url = root.appendingPathComponent(markerRelPath)
        if fm.fileExists(atPath: url.path) {
            var coordError: NSError?
            var text: String?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { u in
                text = try? String(contentsOf: u, encoding: .utf8)
            }
            guard let text, let data = text.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  (object["version"] as? Int) == 1,
                  (object["kind"] as? String) == "container"
            else { return MarkerFacts(exists: true, migratedFrom: nil) }
            return MarkerFacts(exists: true, migratedFrom: object["migratedFrom"] as? String)
        }
        let placeholder = url.deletingLastPathComponent()
            .appendingPathComponent(".\(url.lastPathComponent).icloud")
        if fm.fileExists(atPath: placeholder.path) {
            try? fm.startDownloadingUbiquitousItem(at: url)
            return MarkerFacts(exists: true, migratedFrom: nil)
        }
        return MarkerFacts(exists: false, migratedFrom: nil)
    }

    /// `{ version: 1, kind: "container", createdBy: "ios", createdAt }` —
    /// the same bytes `serializeLibraryMarker` produces in TS (two-space
    /// indent, this key order, trailing newline), so the three writers agree.
    /// Best-effort: a marker that cannot be written costs the "follow a
    /// migration" shortcut, not the library.
    private static func writeMarkerIfAbsent(at root: URL) {
        let fm = FileManager.default
        let url = root.appendingPathComponent(markerRelPath)
        if fm.fileExists(atPath: url.path) { return }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let createdAt = formatter.string(from: Date())
        let text = """
        {
          "version": 1,
          "kind": "container",
          "createdBy": "ios",
          "createdAt": "\(createdAt)"
        }

        """
        try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var coordError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: [], error: &coordError) { u in
            // `.withoutOverwriting` keeps the "never touch an existing marker"
            // promise even if one arrived between the check and the write.
            try? Data(text.utf8).write(to: u, options: .withoutOverwriting)
        }
    }

    // MARK: - Library mode

    /// The persisted mode, or nil before the first `reconcile()` on this
    /// account (and after `clearLibraryGrant`).
    static var libraryMode: LibraryKind? {
        defaults?.string(forKey: modeKey).flatMap(LibraryKind.init(rawValue:))
    }

    private static func persistMode(_ mode: LibraryKind?) {
        if let mode { defaults?.set(mode.rawValue, forKey: modeKey) }
        else { defaults?.removeObject(forKey: modeKey) }
    }

    private static var hasBookmark: Bool { defaults?.data(forKey: bookmarkKey) != nil }

    /// Settle the mode against what exists right now. Runs at the top of
    /// EVERY `resolveRoot()` so the app and the extension always agree:
    ///
    ///   mode == nil        → picked if a bookmark exists, else container if
    ///                        iCloud is available, else nil (no grant)
    ///   picked → container when the container's marker says the Mac moved
    ///                        the library (`migratedFrom`), or when the
    ///                        bookmark no longer resolves while a marked
    ///                        container exists (the same move, seen from the
    ///                        other side). The bookmark is cleared then.
    ///
    /// Never the other way: a bookmarked install keeps its folder until the
    /// Mac says otherwise (PRD Decision 5). Persisted only when it changed.
    @discardableResult
    static func reconcile() -> LibraryKind? {
        let stored = libraryMode
        var mode = stored
        var dropBookmark = false
        // Cached after the first call — cheap on every later resolve.
        let container = containerRoot()

        if mode == nil {
            mode = hasBookmark ? .picked : (container != nil ? .container : nil)
        }
        if mode == .picked, let container {
            let marker = readMarker(at: container)
            if marker.migratedFrom != nil {
                mode = .container
                dropBookmark = true
            } else if marker.exists, hasBookmark, (try? resolveBookmark()) == nil {
                mode = .container
                dropBookmark = true
            }
        }
        if dropBookmark { defaults?.removeObject(forKey: bookmarkKey) }
        if mode != stored { persistMode(mode) }
        return mode
    }

    /// The settings action. Switching to `container` KEEPS the bookmark (so
    /// "switch back" is possible) but stops using it; switching to `picked`
    /// needs a bookmark to switch back to — the picker path
    /// (`persistBookmark`) is how one gets there otherwise.
    static func setLibraryMode(_ mode: LibraryKind) throws -> LibraryGrant {
        switch mode {
        case .container:
            guard containerRoot() != nil else { throw LibraryAccessError.iCloudUnavailable }
        case .picked:
            guard hasBookmark else { throw LibraryAccessError.noGrant }
        }
        persistMode(mode)
        return getLibraryGrant()
    }

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
                completion(.success(LibraryGrant(
                    displayName: "", granted: false, kind: nil,
                    icloudAvailable: containerRoot() != nil)))
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

    /// Persist a chosen folder's bookmark AND switch to `picked` mode — a
    /// pick is always a decision to use that folder, whatever the mode was.
    static func persistBookmark(for url: URL) throws -> LibraryGrant {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let data = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        defaults?.set(data, forKey: bookmarkKey)
        persistMode(.picked)
        return LibraryGrant(displayName: url.lastPathComponent, granted: true,
                            kind: .picked, icloudAvailable: containerRoot() != nil)
    }

    /// The grant as the frontend sees it. In `container` mode the display
    /// name is the container's Files-app name, not `Documents`.
    static func getLibraryGrant() -> LibraryGrant {
        let mode = reconcile()
        let available = containerRoot() != nil
        guard let root = try? resolveRoot() else {
            return LibraryGrant(displayName: "", granted: false, kind: nil, icloudAvailable: available)
        }
        let name = mode == .container ? "Notesage" : root.lastPathComponent
        return LibraryGrant(displayName: name, granted: true, kind: mode, icloudAvailable: available)
    }

    /// Forget BOTH the mode and the bookmark. The next `reconcile()` starts
    /// from nothing — which, with iCloud available, lands in `container`.
    static func clearLibraryGrant() {
        defaults?.removeObject(forKey: bookmarkKey)
        defaults?.removeObject(forKey: modeKey)
    }

    /// The library root for the current mode. Every read and write starts
    /// here, so the mode is reconciled on every call (see `reconcile()`).
    static func resolveRoot() throws -> URL {
        switch reconcile() {
        case .container:
            guard let root = containerRoot() else { throw LibraryAccessError.iCloudUnavailable }
            return root
        case .picked:
            return try resolveBookmark()
        case nil:
            throw LibraryAccessError.noGrant
        }
    }

    /// Resolve the bookmarked root URL (`picked` mode). Throws on a missing
    /// or stale bookmark.
    private static func resolveBookmark() throws -> URL {
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

    /// Move a FILE into another directory under the library root (#754).
    ///
    /// Distinct from `renameFile`, which takes a single name segment and stays
    /// in place. This takes a destination DIRECTORY and keeps the filename,
    /// which is what filing a capture out of `Inbox/` means.
    ///
    /// Files only, matching `deleteFile`. Moving a directory would let one
    /// call relocate an arbitrary subtree — a much larger blast radius than
    /// anything else on this surface, and not what the feature is for.
    ///
    /// `destDir` is `""` for the library root. The name is deduped on
    /// collision, so filing two captures with the same title into one folder
    /// keeps both. Returns the relative path actually produced.
    static func moveFile(_ rel: String, toDirectory destDir: String) throws -> String {
        guard !rel.isEmpty else { throw LibraryAccessError.ioError("empty path") }
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }

        let src = root.appendingPathComponent(rel)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: src.path, isDirectory: &isDir) else {
            throw LibraryAccessError.ioError("no such file")
        }
        if isDir.boolValue {
            throw LibraryAccessError.ioError("Only files can be moved")
        }

        // The destination must exist and be a directory. Creating it here
        // would make this two operations behind one name; the picker calls
        // `ensureDirectory` explicitly when the user asks for a new folder.
        if !destDir.isEmpty {
            let dstDirURL = root.appendingPathComponent(destDir)
            var destIsDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: dstDirURL.path, isDirectory: &destIsDir),
                  destIsDir.boolValue
            else {
                throw LibraryAccessError.ioError("Destination folder does not exist")
            }
        }

        let name = (rel as NSString).lastPathComponent
        let targetRel = destDir.isEmpty ? name : "\(destDir)/\(name)"
        // Already there — a no-op rather than a dedupe to `name-1`, so a
        // double tap in the picker cannot silently fork the file.
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
                // Tells the coordination machinery the file's identity moved,
                // so other processes watching it follow rather than seeing a
                // delete plus an unrelated create. The library is an iCloud
                // folder several devices write to.
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
    // Internal, not private: `RecordingLibrary.swift` (app target only) extends
    // this type and needs the same dedupe.
    static func deduped(_ rel: String, under root: URL) -> (URL, String) {
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
