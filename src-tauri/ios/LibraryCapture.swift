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

        // The Rust name is timestamped to the second; two shares inside the
        // same second would collide, so disambiguate here where the filesystem
        // is actually visible.
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

    /// Save the fetched page's RAW HTML as a real `.html` file in Inbox/
    /// (user-chosen "Page (HTML)" capture format). Named by the same
    /// timestamp-slug scheme as capture notes.
    static func writeRawHtml(url: String, title: String?, html: String) throws -> String {
        // Inject <base> so the page's RELATIVE stylesheet/script/image URLs
        // resolve against the ORIGINAL site — served from the app's custom
        // scheme they otherwise all 404 and the page renders unstyled.
        var html = html
        if html.range(of: "<base ", options: .caseInsensitive) == nil {
            let baseTag = "<base href=\"\(url)\">"
            if let headRange = html.range(of: "<head[^>]*>", options: [.regularExpression, .caseInsensitive]) {
                html.insert(contentsOf: baseTag, at: headRange.upperBound)
            } else {
                html = baseTag + html
            }
        }
        guard let relPath = callCapture(notesage_capture_rel_path, url, title, nil, "") else {
            throw NSError(
                domain: "Notesage", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Could not derive a capture name"])
        }
        let stem = ((relPath as NSString).lastPathComponent as NSString).deletingPathExtension

        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

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
            do { try html.data(using: .utf8)?.write(to: url) } catch { writeError = error }
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
        var name = (suggestedName as NSString).lastPathComponent
        if name.isEmpty || name == "." || name == ".." { name = "Shared document" }
        let ext = (name as NSString).pathExtension
        let stem = (name as NSString).deletingPathExtension
        var target = inbox.appendingPathComponent(name)
        var n = 1
        while FileManager.default.fileExists(atPath: target.path) {
            name = ext.isEmpty ? "\(stem)-\(n)" : "\(stem)-\(n).\(ext)"
            target = inbox.appendingPathComponent(name)
            n += 1
        }

        var coordError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) { url in
            do { try FileManager.default.copyItem(at: src, to: url) }
            catch { copyError = error }
        }
        if let coordError { throw coordError }
        if let copyError { throw copyError }
        return "Inbox/\(name)"
    }
}
