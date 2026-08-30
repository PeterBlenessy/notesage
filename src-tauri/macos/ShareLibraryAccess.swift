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

/// Localized string lookup. See the note on the same helper in
/// ShareViewController — the strings are shared with the iOS extension.
private func L(_ key: String, _ args: CVarArg...) -> String {
    let format = NSLocalizedString(key, comment: "")
    return args.isEmpty ? format : String(format: format, arguments: args)
}

enum ShareLibraryError: LocalizedError {
    case notGranted
    case staleGrant
    case ioError(String)

    var errorDescription: String? {
        switch self {
        case .notGranted:
            return L("share.chooseLibraryToSave")
        case .staleGrant:
            // The folder moved or was renamed. Recoverable, and saying so
            // beats a generic failure the user cannot act on.
            return L("share.libraryMoved")
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
        do {
            let url = try resolveRoot()
            return Grant(displayName: url.lastPathComponent, granted: true)
        } catch {
            // `try?` swallowed this, which is why two grant bugs in a row had
            // nothing to read. The three causes look identical on screen — a
            // greyed-out Save — and are completely different problems: no
            // bookmark stored at all, a bookmark that will not resolve, or one
            // whose security scope the system refuses to re-open.
            NSLog("[notesage-share] currentGrant: not granted — %@", String(describing: error))
            return Grant(displayName: "", granted: false)
        }
    }

    /// Ask the user for their library folder and remember it.
    ///
    /// Must run on the main queue — it presents a panel.
    static func requestGrant(completion: @escaping (Result<Grant, Error>) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = L("share.useAsLibrary")
        panel.message = L("share.chooseLibraryFolder")
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
                // Enter the security scope BEFORE minting the bookmark.
                //
                // `panel.begin` is asynchronous, and the implicit access the
                // panel grants is not guaranteed to still be live by the time
                // this completion runs. Without the explicit scope,
                // `bookmarkData` throws "you don't have permission" — the user
                // picks their library, the panel closes, and the extension
                // reports that it could not remember the folder.
                //
                // iOS has always done this (`persistBookmark`); macOS did not,
                // which is why it worked there and failed here.
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }

                let data = try url.bookmarkData(
                    options: .withSecurityScope,
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                )
                UserDefaults.standard.set(data, forKey: bookmarkKey)
                UserDefaults.standard.set(url.lastPathComponent, forKey: displayNameKey)
                // Prove the bookmark we just wrote can be read back. Writing
                // one and resolving one are separate permissions, and a grant
                // that cannot be resolved presents exactly like no grant at
                // all — the user picks a folder and nothing changes.
                let readBack = (try? resolveRoot()) != nil
                NSLog("[notesage-share] grant stored for %@ (%d bytes); resolves=%@",
                      url.lastPathComponent, data.count, readBack ? "yes" : "NO")
                completion(.success(Grant(displayName: url.lastPathComponent, granted: true)))
            } catch {
                // The full error, not just `localizedDescription` — the
                // localized string for this failure is the useless
                // "you don't have permission to view it", while the underlying
                // NSError carries the domain and code that say which permission.
                NSLog("[notesage-share] bookmarkData failed for %@: %@",
                      url.path, String(describing: error))
                completion(.failure(ShareLibraryError.ioError(
                    L("share.couldNotRemember", error.localizedDescription))))
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
            NSLog("[notesage-share] resolveRoot: no bookmark stored under %@", bookmarkKey)
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
                NSLog("[notesage-share] resolveRoot: bookmark is stale and the security scope would not open")
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

        // CLAIM the name, do not merely check it (#783).
        //
        // `dedupedURL` alone is a check-then-use: it returns a name that looked
        // free, and the coordinated write below is `.forReplacing`. Two writers
        // that both saw the same name free would both write it, the second
        // silently overwriting the first — exactly the failure `claimName` was
        // introduced for on the DOCUMENT path, which this note path never
        // adopted. The window is small and the library is a shared iCloud
        // folder, so the other writer need not even be this process.
        guard let unique = claimName(target) else {
            throw ShareLibraryError.ioError(
                L("share.couldNotFindFreeName", target.lastPathComponent))
        }
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
        // Never leave litter (code review): `claimName` CLAIMED the name by
        // creating a zero-byte file, so a failed write would leave that
        // placeholder occupying the clean name and push every later capture of
        // the same title to `-1`, `-2`, … — defeating the dedup this path
        // exists for. `saveDocuments` already did this on its failure branch.
        if coordError != nil || writeError != nil {
            try? FileManager.default.removeItem(at: unique)
        }
        if let coordError { throw ShareLibraryError.ioError(coordError.localizedDescription) }
        if let writeError { throw ShareLibraryError.ioError(writeError.localizedDescription) }

        return unique.path.replacingOccurrences(of: root.path + "/", with: "")
    }

    /// Store a shared FILE (PDF, EPUB, image, …) in `Inbox/` under its own
    /// name, deduped. Returns the relative path actually used.
    ///
    /// The source is the temp file the share sheet hands the extension. Copied
    /// under coordination for the same reason every other write here is: the
    /// library is normally an iCloud folder that several devices write to, and
    /// an uncoordinated copy into a syncing folder is how conflict copies
    /// appear.
    ///
    /// `copyItem` streams rather than loading the file into memory, so a large
    /// video never sits in the extension's budget — the same property the iOS
    /// path relies on.
    /// Serialises name-choice AND write for concurrent document saves.
    ///
    /// `dedupedURL` is a check-then-use against the filesystem. Ten
    /// `loadFileRepresentation` callbacks land on arbitrary queues at once, so
    /// two items with the same name can both see the target as free and both
    /// write it — the second silently overwriting the first, with no error
    /// raised and the UI reporting success. A shared file vanishing without a
    /// trace is the worst failure this path can have.
    private static let nameLock = NSLock()

    /// Claim a free name by creating a placeholder, under the lock.
    ///
    /// Holding the lock across the whole copy would serialise ten concurrent
    /// document saves behind each other — one large file or one stalled iCloud
    /// coordinator blocking the rest, inside an extension with an execution
    /// budget. So the lock covers the check-and-claim only.
    ///
    /// Claiming means CREATING the file, not just picking a name: a name that
    /// merely looked free is the race we started with. The claim then has to
    /// survive until the real content lands — see `writeDocument`, which
    /// swaps content in atomically rather than deleting the placeholder first.
    /// An earlier version removed it and then copied, which left the path
    /// genuinely free in between and reopened the very race this closes.
    ///
    /// Returns nil when the claim could not be made — `createFile` reports
    /// failure as a discardable Bool, and a claim that silently failed is a
    /// claim two callers both think they hold.
    private static func claimName(_ preferred: URL) -> URL? {
        nameLock.lock()
        defer { nameLock.unlock() }
        // `dedupedURL` returns nil when it exhausts its 999 attempts, rather
        // than handing back a url that exists — `createFile` TRUNCATES, so a
        // claim on an occupied path is silent data loss in the function whose
        // entire purpose is preventing it.
        guard let target = dedupedURL(for: preferred) else { return nil }
        // Belt and braces against a writer OUTSIDE this process taking the name
        // between the check and the claim. The lock only serialises our own
        // callbacks; the library is a shared iCloud folder.
        guard !FileManager.default.fileExists(atPath: target.path) else { return nil }
        guard FileManager.default.createFile(atPath: target.path, contents: nil) else {
            return nil
        }
        return target
    }

    @discardableResult
    static func writeDocument(from src: URL, suggestedName: String) throws -> String {
        let root = try resolveRoot()
        guard root.startAccessingSecurityScopedResource() else {
            throw ShareLibraryError.staleGrant
        }
        defer { root.stopAccessingSecurityScopedResource() }

        let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        // Keep the shared file's own name — that is what the user will look
        // for — minus anything path-like.
        var name = (suggestedName as NSString).lastPathComponent
        if name.isEmpty || name == "." || name == ".." { name = "Shared document" }
        guard let target = claimName(inbox.appendingPathComponent(name)) else {
            // Was an English literal in a file where every other user-facing
            // string goes through `L()` — a Swedish sheet showing one English
            // line is worse than either language on its own (#653).
            throw ShareLibraryError.ioError(L("share.couldNotFindFreeName", name))
        }

        // Stage beside the target, then swap ATOMICALLY.
        //
        // `removeItem` followed by `copyItem` leaves the path free in between,
        // so a second claimant can take the name and both writers end up
        // targeting it — one file silently overwriting the other, which is the
        // exact failure the claim exists to prevent. `replaceItemAt` has no
        // such window, and it cleans up the placeholder as part of the swap.
        //
        // Staging in the SAME directory matters: a cross-volume replace falls
        // back to a copy, and the library is often an iCloud folder on its own
        // volume.
        let staged = inbox.appendingPathComponent(".notesage-staging-\(UUID().uuidString)")
        var coordError: NSError?
        var copyError: Error?
        var landed = target
        NSFileCoordinator().coordinate(
            writingItemAt: target, options: .forReplacing, error: &coordError
        ) { url in
            do {
                try FileManager.default.copyItem(at: src, to: staged)
                // KEEP the returned URL. `replaceItemAt` is documented to fall
                // back to a non-atomic path on filesystems that cannot swap in
                // place, and to land the item at a DIFFERENT url when it does
                // — callers are told to use what it returns. This library is
                // "usually an iCloud folder", which is precisely that class of
                // filesystem, so reporting the path we PLANNED rather than the
                // one it reached would be a success message pointing at
                // nothing.
                landed = try FileManager.default.replaceItemAt(url, withItemAt: staged) ?? url
            } catch {
                copyError = error
                // Never leave litter. A failed share that permanently occupies
                // the user's chosen filename would also push every retry to
                // `name-1`, `name-2`, … with nothing to show for it.
                try? FileManager.default.removeItem(at: staged)
                try? FileManager.default.removeItem(at: url)
            }
        }
        if let coordError { throw ShareLibraryError.ioError(coordError.localizedDescription) }
        if let copyError { throw ShareLibraryError.ioError(copyError.localizedDescription) }
        return "Inbox/\(landed.lastPathComponent)"
    }

    /// `note.md` → `note-1.md` → `note-2.md` on collision.
    ///
    /// Saving the same article twice should produce two notes, not silently
    /// overwrite the first — the user may have annotated it.
    ///
    /// Returns **nil** when the 999 attempts are exhausted, rather than the
    /// original URL. Returning the original was the same defect `claimName` was
    /// fixed for, one function over: the caller then wrote to a path it had
    /// just been told was taken. `writeCapture` uses `.forReplacing`, so the
    /// user's existing note was overwritten — by the function whose entire
    /// purpose is preventing that. Practically unreachable, structurally
    /// identical, and cheaper to close than to keep reasoning about.
    private static func dedupedURL(for url: URL) -> URL? {
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
        return nil
    }
}
