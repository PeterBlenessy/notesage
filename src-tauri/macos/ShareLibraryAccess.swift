//  ShareLibraryAccess.swift
//  Notesage macOS Share Extension
//
//  Grant, hold and write to the user's Notesage library from inside a
//  sandboxed share extension (phase 1 of
//  `docs/prds/2026-08-22-macos-share-extension.md`).
//
//  Why this exists separately from the iOS version
//  -----------------------------------------------
//  The iOS extension reaches the library through an App Group: the app stores
//  a security-scoped bookmark in a shared UserDefaults suite and the extension
//  resolves it. On macOS with Developer ID signing that route is expensive —
//  App Group entitlements require an embedded provisioning profile the release
//  pipeline does not produce, and a renewal cliff nobody will remember.
//
//  So this extension holds its OWN bookmark, obtained through its own folder
//  picker and kept in its own container. The user points at their library one
//  additional time, ever. That is a real cost and it is the smaller one.
//
//  The host app is NOT sandboxed (Developer ID, unsandboxed) but an app
//  extension is sandboxed regardless, which is what makes any of this
//  necessary — the extension cannot simply open `~/Notesage`.

import AppKit
import Foundation

enum ShareLibraryError: LocalizedError {
    case notGranted
    case staleGrant
    case ioError(String)

    var errorDescription: String? {
        switch self {
        case .notGranted:
            return "Choose your Notesage library folder to save here."
        case .staleGrant:
            // The folder moved or was renamed. Recoverable, and saying so
            // beats a generic failure the user cannot act on.
            return "Your Notesage library moved. Choose it again to save here."
        case .ioError(let message):
            return message
        }
    }
}

enum ShareLibraryAccess {
    /// Where the bookmark lives. The extension's own defaults, not a shared
    /// suite — see the file header for why there is no App Group.
    private static let bookmarkKey = "notesage.share.libraryBookmark"
    private static let displayNameKey = "notesage.share.libraryName"

    // MARK: - Grant

    struct Grant {
        let displayName: String
        let granted: Bool
    }

    /// Resolve the stored grant without prompting.
    ///
    /// A stale bookmark is reported as ungranted rather than thrown away: the
    /// user may simply have the volume unmounted, and discarding the bookmark
    /// would make a temporary condition permanent.
    static func currentGrant() -> Grant {
        guard let url = try? resolveRoot() else {
            return Grant(displayName: "", granted: false)
        }
        return Grant(displayName: url.lastPathComponent, granted: true)
    }

    /// Ask the user for their library folder and remember it.
    ///
    /// Must run on the main queue — it presents a panel.
    static func requestGrant(completion: @escaping (Result<Grant, Error>) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Use as Library"
        panel.message = "Choose your Notesage library folder."
        // Point at the likely answer rather than the file system root: the
        // library is `~/Notesage` unless the user moved it, and an iCloud
        // library lives somewhere nobody navigates to by choice.
        panel.directoryURL = defaultLibraryGuess()

        panel.begin { response in
            guard response == .OK, let url = panel.url else {
                completion(.failure(ShareLibraryError.notGranted))
                return
            }
            do {
                let data = try url.bookmarkData(
                    options: .withSecurityScope,
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                )
                UserDefaults.standard.set(data, forKey: bookmarkKey)
                UserDefaults.standard.set(url.lastPathComponent, forKey: displayNameKey)
                completion(.success(Grant(displayName: url.lastPathComponent, granted: true)))
            } catch {
                completion(.failure(ShareLibraryError.ioError(
                    "Could not remember that folder: \(error.localizedDescription)")))
            }
        }
    }

    static func clearGrant() {
        UserDefaults.standard.removeObject(forKey: bookmarkKey)
        UserDefaults.standard.removeObject(forKey: displayNameKey)
    }

    private static func defaultLibraryGuess() -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let icloud = home.appendingPathComponent(
            "Library/Mobile Documents/com~apple~CloudDocs/Notesage")
        if FileManager.default.fileExists(atPath: icloud.path) { return icloud }
        let local = home.appendingPathComponent("Notesage")
        return FileManager.default.fileExists(atPath: local.path) ? local : home
    }

    // MARK: - Resolving

    /// Resolve the bookmark to a live URL.
    ///
    /// Resolved on EVERY use rather than cached, mirroring iOS. A cached URL
    /// outlives the security scope it was granted under, and the failure mode
    /// is a write that silently lands nowhere.
    private static func resolveRoot() throws -> URL {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else {
            throw ShareLibraryError.notGranted
        }
        var stale = false
        let url = try URL(
            resolvingBookmarkData: data,
            options: .withSecurityScope,
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        )
        if stale {
            // Refresh in place when we still have access — a moved or renamed
            // library should not cost the user a second trip through the
            // picker if the system can still resolve it.
            if url.startAccessingSecurityScopedResource() {
                defer { url.stopAccessingSecurityScopedResource() }
                if let fresh = try? url.bookmarkData(
                    options: .withSecurityScope,
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                ) {
                    UserDefaults.standard.set(fresh, forKey: bookmarkKey)
                }
            } else {
                throw ShareLibraryError.staleGrant
            }
        }
        return url
    }

    // MARK: - Writing

    /// Write a capture into `Inbox/`, returning the path actually used.
    ///
    /// Coordinated, because the library is normally an iCloud folder that a
    /// Mac, a phone and the desktop app all write to. An uncoordinated write
    /// into a syncing folder is how conflict copies appear.
    @discardableResult
    static func writeCapture(relPath: String, contents: String) throws -> String {
        let root = try resolveRoot()
        guard root.startAccessingSecurityScopedResource() else {
            throw ShareLibraryError.staleGrant
        }
        defer { root.stopAccessingSecurityScopedResource() }

        let target = root.appendingPathComponent(relPath)
        let folder = target.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: true)

        let unique = dedupedURL(for: target)
        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(
            writingItemAt: unique, options: .forReplacing, error: &coordError
        ) { url in
            do {
                try contents.data(using: .utf8)?.write(to: url, options: .atomic)
            } catch {
                writeError = error
            }
        }
        if let coordError { throw ShareLibraryError.ioError(coordError.localizedDescription) }
        if let writeError { throw ShareLibraryError.ioError(writeError.localizedDescription) }

        return unique.path.replacingOccurrences(of: root.path + "/", with: "")
    }

    /// `note.md` → `note-1.md` → `note-2.md` on collision.
    ///
    /// Saving the same article twice should produce two notes, not silently
    /// overwrite the first — the user may have annotated it.
    private static func dedupedURL(for url: URL) -> URL {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return url }
        let ext = url.pathExtension
        let stem = url.deletingPathExtension().lastPathComponent
        let folder = url.deletingLastPathComponent()
        // Bounded: an unbounded loop against a pathological directory would
        // hang the share sheet with no way out.
        for n in 1...999 {
            let candidate = folder
                .appendingPathComponent("\(stem)-\(n)")
                .appendingPathExtension(ext)
            if !fm.fileExists(atPath: candidate.path) { return candidate }
        }
        return url
    }
}
