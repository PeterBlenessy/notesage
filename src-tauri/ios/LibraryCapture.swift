//
//  LibraryCapture.swift
//  Share Extension only.
//
//  Split from LibraryAccess because the APP never captures — the Share
//  Extension does, in its own process. Keeping it out of the plugin's Swift
//  Package means the app target never links libnotesage_capture.a for code it
//  cannot reach.
//
//  Add this file, LibraryAccess.swift (from the plugin package) and
//  ShareViewController.swift to the Share Extension target, and link the
//  capture staticlib there. See README.md.
//
import Foundation

extension LibraryAccess {
    /// Write a link-only capture note into `Inbox/`. Returns the relative path.
    ///
    /// The note's NAME and CONTENTS come from the Rust `notesage-capture`
    /// crate over its C ABI — deliberately not reimplemented here. The format
    /// is shared with the desktop's expectations (`type: capture` frontmatter
    /// that `download-webpage` / `save-research` enrich later), and a second
    /// Swift implementation would drift from it silently and untested.
    ///
    /// Swift owns only what it must: resolving the security-scoped root,
    /// avoiding a collision, and the coordinated write. Those need the
    /// bookmark and NSFileCoordinator, which have no Rust equivalent here.
    static func writeCapture(url: String, title: String?, selectionText: String?, tags: [String]) throws -> String {
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        let joinedTags = tags.joined(separator: ",")
        guard
            let relPath = callCapture(notesage_capture_rel_path, url, title, selectionText, joinedTags),
            let contents = callCapture(notesage_capture_contents, url, title, selectionText, joinedTags)
        else {
            throw NSError(
                domain: "Notesage", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Could not build the capture note"]
            )
        }

        // The Rust name is the note's TITLE (undated since #653's follow-up),
        // so re-sharing the same article collides by design — disambiguate
        // here, where the filesystem is actually visible, rather than
        // overwriting a note the user may have edited.
        var name = (relPath as NSString).lastPathComponent
        var target = inbox.appendingPathComponent(name)
        var n = 1
        let stem = (name as NSString).deletingPathExtension
        while FileManager.default.fileExists(atPath: target.path) {
            name = "\(stem)-\(n).md"
            target = inbox.appendingPathComponent(name)
            n += 1
        }

        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) { url in
            do { try contents.data(using: .utf8)?.write(to: url) } catch { writeError = error }
        }
        if let coordError { throw coordError }
        if let writeError { throw writeError }
        return "Inbox/\(name)"
    }

    /// Rich web capture (#584): build an ARTICLE note from fetched page HTML
    /// (readable extraction + HTML→Markdown happen in Rust). Returns nil —
    /// caller falls back to the link-only note — when the page yields no
    /// genuine article. Throws only on write failures.
    static func writeArticleCapture(url: String, title: String?, selectionText: String?, tags: [String], html: String) throws -> String? {
        let joinedTags = tags.joined(separator: ",")
        // Contents first: extraction is the part that can decline.
        let contents: String? = html.withCString { htmlPtr in
            callCapture({ u, t, sel, tg in
                notesage_capture_article_contents(u, t, sel, tg, htmlPtr)
            }, url, title, selectionText, joinedTags)
        }
        guard let contents else { return nil }
        guard let relPath = callCapture(notesage_capture_rel_path, url, title, selectionText, joinedTags) else {
            return nil
        }

        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        var name = (relPath as NSString).lastPathComponent
        var target = inbox.appendingPathComponent(name)
        var n = 1
        let stem = (name as NSString).deletingPathExtension
        while FileManager.default.fileExists(atPath: target.path) {
            name = "\(stem)-\(n).md"
            target = inbox.appendingPathComponent(name)
            n += 1
        }

        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) { url in
            do { try contents.data(using: .utf8)?.write(to: url) } catch { writeError = error }
        }
        if let coordError { throw coordError }
        if let writeError { throw writeError }
        return "Inbox/\(name)"
    }

    /// The provider's official oEmbed endpoint for `url`, or nil when the URL
    /// is not a video page we recognise. See `oembed_url` in the Rust crate
    /// for why oEmbed is the whole story here rather than downloading video.
    /// Article-ONLY HTML capture (#612): the readable article as a clean,
    /// self-contained document.
    ///
    /// Writes a `.html` file rather than a frontmatter `.md` note — this
    /// format exists to open as a readable page. Image URLs are already
    /// absolute (the extractor resolves them against the source), so no
    /// `<base>` injection is needed.
    ///
    /// Returns nil when the page yields no genuine article, so the caller can
    /// fall through to the rendered-DOM attempt and then the link note — a
    /// share never fails outright.
    static func writeArticleHtml(url: String, title: String?, html: String) throws -> String? {
        let document: String? = html.withCString { htmlPtr in
            callCapture({ u, t, sel, tg in
                notesage_capture_article_html_contents(u, t, sel, tg, htmlPtr)
            }, url, title, nil, "")
        }
        guard let document else { return nil }

        let relPath = html.withCString { htmlPtr -> String? in
            callCapture({ u, t, _, _ in
                notesage_capture_rel_path_from_html(u, t, htmlPtr)
            }, url, title, nil, "")
        }
        guard let relPath else { return nil }

        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        let stem = ((relPath as NSString).lastPathComponent as NSString).deletingPathExtension
        var name = "\(stem).html"
        var target = inbox.appendingPathComponent(name)
        var n = 1
        while FileManager.default.fileExists(atPath: target.path) {
            name = "\(stem)-\(n).html"
            target = inbox.appendingPathComponent(name)
            n += 1
        }

        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) { url in
            do { try document.data(using: .utf8)?.write(to: url) } catch { writeError = error }
        }
        if let coordError { throw coordError }
        if let writeError { throw writeError }
        return "Inbox/\(name)"
    }

    static func oembedEndpoint(for url: String) -> String? {
        url.withCString { u in
            guard let raw = notesage_capture_oembed_url(u) else { return nil }
            defer { notesage_capture_string_free(raw) }
            return String(cString: raw)
        }
    }

    /// X's embed-data endpoint for `url`, or nil when the URL is not an X
    /// status. See `x_syndication_url` in the capture crate for why this is the
    /// metadata path and not the capture path.
    static func xMetadataEndpoint(for url: String) -> String? {
        url.withCString { u in
            guard let raw = notesage_capture_x_metadata_url(u) else { return nil }
            defer { notesage_capture_string_free(raw) }
            return String(cString: raw)
        }
    }

    /// Write an X capture: the extracted article, enriched with the post's own
    /// title, cover image and author.
    ///
    /// `xJson` may be nil (endpoint down, or not fetched) — the note still
    /// builds, it just keeps whatever the extractor found. `html` may be nil
    /// too, in which case this writes the metadata-only note rather than
    /// failing, so an X share always produces something.
    ///
    /// `asHtml` picks the document format. It returns nil when extraction
    /// declines, because an HTML document with no article in it is not worth
    /// writing; the markdown path never returns nil for that reason.
    static func writeXCapture(
        url: String, title: String?, tags: [String], html: String?, xJson: String?, asHtml: Bool
    ) throws -> String? {
        let joinedTags = tags.joined(separator: ",")

        // Two optional C strings to thread through, so the nesting is explicit
        // rather than four combinatorial branches.
        func withTwo<R>(
            _ a: String?, _ b: String?,
            _ body: (UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> R
        ) -> R {
            func withOne<T>(_ v: String?, _ f: (UnsafePointer<CChar>?) -> T) -> T {
                guard let v else { return f(nil) }
                return v.withCString { f($0) }
            }
            return withOne(a) { ap in withOne(b) { bp in body(ap, bp) } }
        }

        let (relPath, contents): (String?, String?) = withTwo(html, xJson) { htmlPtr, jsonPtr in
            let path = callCapture({ u, t, _, _ in
                notesage_capture_x_rel_path(u, t, jsonPtr)
            }, url, title, nil, "")

            let body: String?
            if asHtml {
                body = callCapture({ u, t, _, _ in
                    notesage_capture_x_html_contents(u, t, htmlPtr, jsonPtr)
                }, url, title, nil, "")
            } else {
                body = callCapture({ u, t, sel, tg in
                    notesage_capture_x_contents(u, t, sel, tg, htmlPtr, jsonPtr)
                }, url, title, nil, joinedTags)
            }
            return (path, body)
        }
        guard let relPath, let contents else { return nil }

        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        let ext = asHtml ? "html" : "md"
        let stem = ((relPath as NSString).lastPathComponent as NSString).deletingPathExtension
        var name = "\(stem).\(ext)"
        var target = inbox.appendingPathComponent(name)
        var n = 1
        while FileManager.default.fileExists(atPath: target.path) {
            name = "\(stem)-\(n).\(ext)"
            target = inbox.appendingPathComponent(name)
            n += 1
        }

        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(
            writingItemAt: target, options: .forReplacing, error: &coordError
        ) { url in
            do { try contents.data(using: .utf8)?.write(to: url) } catch { writeError = error }
        }
        if let coordError { throw coordError }
        if let writeError { throw writeError }
        return "Inbox/\(name)"
    }

    /// Write a VIDEO capture note: a labelled link to the source, the author,
    /// and the provider's clean poster as a plain image. `oembedJson` may be
    /// nil — a provider that answers with nothing still yields a usable note.
    static func writeVideoCapture(
        url: String, title: String?, tags: [String], oembedJson: String?
    ) throws -> String {
        let joinedTags = tags.joined(separator: ",")
        let build: (String?) -> (String?, String?) = { json in
            func withJson<R>(_ body: (UnsafePointer<CChar>?) -> R) -> R {
                guard let json else { return body(nil) }
                return json.withCString { body($0) }
            }
            return withJson { jsonPtr in
                (
                    callCapture({ u, t, _, _ in
                        notesage_capture_video_rel_path(u, t, jsonPtr)
                    }, url, title, nil, ""),
                    callCapture({ u, t, sel, tg in
                        notesage_capture_video_contents(u, t, sel, tg, jsonPtr)
                    }, url, title, nil, joinedTags)
                )
            }
        }
        let (relPath, contents) = build(oembedJson)
        guard let relPath, let contents else {
            throw NSError(
                domain: "Notesage", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Could not build the video note"])
        }

        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        // Same dedupe as the other capture writers: the Rust name is the
        // note's TITLE, so re-sharing the same video collides by design.
        var name = (relPath as NSString).lastPathComponent
        var target = inbox.appendingPathComponent(name)
        var n = 1
        let stem = (name as NSString).deletingPathExtension
        while FileManager.default.fileExists(atPath: target.path) {
            name = "\(stem)-\(n).md"
            target = inbox.appendingPathComponent(name)
            n += 1
        }

        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(
            writingItemAt: target, options: .forReplacing, error: &coordError
        ) { url in
            do { try contents.data(using: .utf8)?.write(to: url) } catch { writeError = error }
        }
        if let coordError { throw coordError }
        if let writeError { throw writeError }
        return "Inbox/\(name)"
    }

    /// The relative path a capture with these inputs WOULD get — used by the
    /// share sheet to preview the generated filename before saving.
    static func previewRelPath(url: String, title: String?) -> String? {
        callCapture(notesage_capture_rel_path, url, title, nil, "")
    }

    /// Bridge one `notesage_capture_*` call: pass optionals as NULL, copy the
    /// returned string into Swift, and always free the Rust allocation.
    private static func callCapture(
        _ fn: (UnsafePointer<CChar>?, UnsafePointer<CChar>?, UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>?,
        _ url: String,
        _ title: String?,
        _ selectionText: String?,
        _ tags: String
    ) -> String? {
        func withOptional<R>(_ value: String?, _ body: (UnsafePointer<CChar>?) -> R) -> R {
            guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return body(nil)
            }
            return value.withCString { body($0) }
        }
        return url.withCString { urlPtr in
            withOptional(title) { titlePtr in
                withOptional(selectionText) { selPtr in
                    withOptional(tags.isEmpty ? nil : tags) { tagsPtr in
                        guard let raw = fn(urlPtr, titlePtr, selPtr, tagsPtr) else { return nil }
                        defer { notesage_capture_string_free(raw) }
                        return String(cString: raw)
                    }
                }
            }
        }
    }
}

extension LibraryAccess {
    /// Store a shared DOCUMENT (PDF, EPUB, …) as a real library file in
    /// `Inbox/`, keeping its original name (deduped). Returns the stored
    /// relative path. The source is the temp file `loadFileRepresentation`
    /// hands the extension — copied under coordination so iCloud sees a
    /// complete file appear.
    static func writeDocument(from src: URL, suggestedName: String) throws -> String {
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        // Keep the shared file's own name — that's what the user will look
        // for — minus anything path-like; dedupe with a numeric suffix.
        //
        // CLAIMED under a lock, not merely checked. `saveDocuments` fires up
        // to ten `loadFileRepresentation` completions on arbitrary queues at
        // once, so two items with the same name can both see the path as free
        // and both write it — the second silently overwriting the first, with
        // no error raised and the UI reporting success. A shared file
        // vanishing without a trace is the worst failure this path can have.
        //
        // Kept identical to the macOS implementation deliberately: this race
        // was found on macOS, and fixing only that side would have left the
        // two platforms silently diverged on the same defect.
        var name = (suggestedName as NSString).lastPathComponent
        if name.isEmpty || name == "." || name == ".." { name = "Shared document" }
        guard let target = claimName(inbox.appendingPathComponent(name)) else {
            throw NSError(
                domain: "Notesage", code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Could not reserve a name in Inbox"])
        }
        name = target.lastPathComponent

        // Stage beside the target, then swap ATOMICALLY. Removing the
        // placeholder and copying afterwards would leave the path free in
        // between, reopening the race the claim just closed.
        let staged = inbox.appendingPathComponent(".notesage-staging-\(UUID().uuidString)")
        var coordError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) { url in
            do {
                try FileManager.default.copyItem(at: src, to: staged)
                _ = try FileManager.default.replaceItemAt(url, withItemAt: staged)
            } catch {
                copyError = error
                // Never leave litter: a zero-byte placeholder left under the
                // user's chosen name would push every retry to `name-1`.
                try? FileManager.default.removeItem(at: staged)
                try? FileManager.default.removeItem(at: url)
            }
        }
        if let coordError { throw coordError }
        if let copyError { throw copyError }
        return "Inbox/\(name)"
    }

    /// Serialises name choice across the concurrent `loadFileRepresentation`
    /// callbacks, and CLAIMS the name by creating it — a name that merely
    /// looked free is the race itself. Returns nil when the claim failed.
    private static let nameLock = NSLock()

    private static func claimName(_ preferred: URL) -> URL? {
        nameLock.lock()
        defer { nameLock.unlock() }
        let fm = FileManager.default
        let ext = preferred.pathExtension
        let stem = preferred.deletingPathExtension().lastPathComponent
        let folder = preferred.deletingLastPathComponent()
        var candidate = preferred
        var n = 1
        // Bounded: an unbounded loop against a pathological directory would
        // hang the share sheet with no way out.
        while fm.fileExists(atPath: candidate.path), n <= 999 {
            let named = ext.isEmpty ? "\(stem)-\(n)" : "\(stem)-\(n).\(ext)"
            candidate = folder.appendingPathComponent(named)
            n += 1
        }
        guard fm.createFile(atPath: candidate.path, contents: nil) else { return nil }
        return candidate
    }
}
