//  ShareCapture.swift
//  Notesage macOS Share Extension
//
//  Phase 3: turn a shared URL into a note on disk.
//
//  Every decision about WHAT a note contains — extraction, picture flattening,
//  the X path, frontmatter, filename derivation — lives in `notesage-capture`
//  and is reached through the same C ABI the iOS extension uses. This file
//  fetches bytes and calls into it. A second implementation of the note format
//  would drift from the first within a release.

import Foundation

/// Localized string lookup. See ShareViewController's copy — the strings are
/// shared with the iOS extension.
private func L(_ key: String, _ args: CVarArg...) -> String {
    let format = NSLocalizedString(key, comment: "")
    return args.isEmpty ? format : String(format: format, arguments: args)
}

enum ShareCaptureError: LocalizedError {
    case badUrl
    case fetchFailed
    case buildFailed

    var errorDescription: String? {
        switch self {
        case .badUrl: return L("share.notAWebLink")
        case .fetchFailed:
            // Distinguished from "no article found": the user can retry a
            // network failure, and cannot retry a page with no article in it.
            return L("share.couldNotReach")
        case .buildFailed: return L("share.couldNotBuildNote")
        }
    }
}

enum ShareCapture {
    enum Format {
        case articleHtml, articleMarkdown, link
    }

    /// Fetch, extract and write. Calls back on an arbitrary queue.
    static func save(
        url: String,
        title: String?,
        format: Format,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        guard let parsed = URL(string: url),
              parsed.scheme == "https" || parsed.scheme == "http"
        else {
            completion(.failure(ShareCaptureError.badUrl))
            return
        }

        if format == .link {
            // No fetch at all: a link note needs nothing the share sheet did
            // not already give us, and making the user wait on the network for
            // it would be gratuitous.
            completion(build(url: url, title: title, html: nil, format: format))
            return
        }

        // An X status needs its metadata BEFORE the page is built: the real
        // title names the file, and the cover image has to be in the document
        // when it is written rather than patched in afterwards. Best-effort —
        // `proceed` runs either way.
        //
        // Same shape as the iOS extension. Both are consumers of one crate,
        // and a capture that behaves differently depending on which machine
        // shared it is a bug on whichever one is worse.
        let proceed: (String?) -> Void = { xJson in
            fetch(parsed) { html in
                // Raw HTML first; a page whose article is already there never
                // pays for a webview.
                if let html {
                    let result = build(
                        url: url, title: title, html: html, format: format, xJson: xJson,
                        requireArticle: true)
                    if case .success = result {
                        completion(result)
                        return
                    }
                }

                // A plain X post has no long-form article by definition, so
                // rendering one is up to five seconds spent to reach the same
                // metadata note it would reach immediately. Only an X ARTICLE
                // is worth the render, and the syndication payload says which
                // this is — `article` is present only for long-form.
                //
                // Without this, fixing the dead-retry bug would have made the
                // commonest X case (share a tweet) several seconds slower. A
                // correctness fix that quietly costs latency is still a
                // regression.
                let isPlainXPost = xJson.map { !$0.contains("\"article\"") } ?? false
                if isPlainXPost {
                    completion(build(url: url, title: title, html: nil, format: format,
                                     xJson: xJson))
                    return
                }

                // Nothing extractable in the fetched HTML — which is what
                // happens on any JavaScript-rendered page, where the article
                // does not exist until a bundle runs. Render and try once more.
                //
                // This chain matches iOS (#611): raw HTML → rendered DOM →
                // fallback note. macOS shipped without the middle step, so
                // every SPA captured as a bare link here while the phone got
                // the article.
                PageRenderer.renderedHTML(url: url) { rendered in
                    // Back OFF main before doing the heavy work.
                    //
                    // `PageRenderer` guarantees its completion on the main
                    // thread — it forces itself there to touch WebKit, and
                    // every exit path is a WKWebView callback or a main-queue
                    // timer. So without this hop the readability parse and the
                    // coordinated disk write below run on main, which is
                    // exactly the freeze `fetch` above goes out of its way to
                    // avoid.
                    //
                    // And it is the MAINLINE case, not an edge one: this path
                    // exists for JavaScript-rendered pages, i.e. most modern
                    // news sites. Narrowing the earlier over-hop fixed one
                    // half and left this one — the same defect, one branch
                    // over.
                    DispatchQueue.global(qos: .userInitiated).async {
                    if let rendered {
                        let result = build(
                            url: url, title: title, html: rendered, format: format, xJson: xJson,
                            requireArticle: true)
                        if case .success = result {
                            completion(result)
                            return
                        }
                    }

                    // With no article from either source but WITH metadata, an
                    // X share still produces a real note.
                    if xJson != nil {
                        let meta = build(
                            url: url, title: title, html: nil, format: format, xJson: xJson)
                        if case .success = meta {
                            completion(meta)
                            return
                        }
                    }

                    // The link note never fails, which is what keeps a share
                    // from ever ending in nothing. Only a page we could not
                    // even fetch reports an error the user can retry.
                    if html == nil {
                        completion(.failure(ShareCaptureError.fetchFailed))
                    } else {
                        completion(build(url: url, title: title, html: nil, format: .link))
                    }
                    }
                }
            }
        }

        if xMetadataEndpoint(for: url) != nil {
            fetchXMetadata(url: url, completion: proceed)
        } else {
            proceed(nil)
        }
    }

    /// X's embed-data endpoint for `url`, or nil when it is not an X status.
    /// The crate decides which hosts and path shapes count — Swift holding a
    /// second opinion is how the two extensions would drift.
    private static func xMetadataEndpoint(for url: String) -> String? {
        callRust { notesage_capture_x_metadata_url(url) }
    }

    /// Fetch X's embed-data JSON (5 s, 512 KB). nil on ANY failure.
    ///
    /// The endpoint is undocumented, unversioned and rate-limits. A capture
    /// missing its enrichment is a worse capture; a capture that FAILS because
    /// enrichment was unavailable would be a bug.
    private static func fetchXMetadata(url: String, completion: @escaping (String?) -> Void) {
        guard let endpoint = xMetadataEndpoint(for: url),
              let parsed = URL(string: endpoint)
        else {
            completion(nil)
            return
        }
        var request = URLRequest(url: parsed)
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil

        URLSession(configuration: config).dataTask(with: request) { data, response, _ in
            let json: String? = {
                guard (response as? HTTPURLResponse)?.statusCode == 200,
                      let data, data.count <= 512 * 1024
                else { return nil }
                return String(data: data, encoding: .utf8)
            }()
            // Main, so the continuation is on the same queue as every other
            // step of the chain. Safe today only because `proceed` does
            // nothing but call `fetch` — and an invariant that holds by
            // accident is one edit away from the crash class above.
            DispatchQueue.main.async { completion(json) }
        }.resume()
    }

    // MARK: - Rust bridge

    /// `requireArticle` means "the caller is still willing to try harder".
    ///
    /// It exists because `notesage_capture_x_contents` NEVER returns null — by
    /// design, it falls back internally to the metadata-only note so a plain
    /// post still saves. That makes an X build unconditionally succeed, so the
    /// raw-HTML attempt always won and the rendered-DOM retry below it was
    /// dead code for every X share. A rate-limited or bot-shell response would
    /// quietly save a metadata stub instead of rendering and getting the real
    /// article.
    ///
    /// So the first two attempts demand a genuine extraction; only the final
    /// fallback accepts the metadata note.
    private static func build(
        url: String, title: String?, html: String?, format: Format, xJson: String? = nil,
        requireArticle: Bool = false
    ) -> Result<String, Error> {
        let relPath: String?
        let contents: String?
        // Whether the bytes we end up with are an HTML DOCUMENT or a markdown
        // note. Not the same as `format == .articleHtml`: both HTML builders
        // decline when there is no article, and we fall back to markdown.
        // Tracking the request rather than the outcome is how "Article (HTML)"
        // came to write a `<!doctype html>` document into a `.md` file.
        var wroteHtmlDocument = false

        if xJson != nil, format != .link {
            // Does this HTML actually contain an article? `article_contents`
            // returns NULL when it does not, which is the only honest signal
            // available — the X builders cannot tell us, because they are
            // built never to fail.
            if requireArticle {
                guard let html,
                      callRust({
                          notesage_capture_article_contents(url, title, nil, nil, html)
                      }) != nil
                else { return .failure(ShareCaptureError.buildFailed) }
            }
            // X routes through its own builders whenever we have metadata,
            // even with no page: `notesage_capture_x_contents` falls back to
            // the metadata-only note rather than returning NULL, so a plain
            // post (nothing long-form to extract) still lands as a real note.
            //
            // The HTML variant DOES decline without an article, which is why
            // it falls through to the markdown builder below rather than
            // failing — a document with no article in it is not worth writing,
            // but the metadata note still is.
            relPath = callRust { notesage_capture_x_rel_path(url, title, xJson) }
            if format == .articleHtml,
               let doc = callRust({ notesage_capture_x_html_contents(url, title, html, xJson) }) {
                contents = doc
                wroteHtmlDocument = true
            } else {
                contents = callRust {
                    notesage_capture_x_contents(url, title, nil, nil, html, xJson)
                }
            }
        } else if let html, format != .link {
            relPath = callRust { notesage_capture_rel_path_from_html(url, title, html) }
            if format == .articleHtml,
               let doc = callRust({
                   notesage_capture_article_html_contents(url, title, nil, nil, html)
               }) {
                contents = doc
                wroteHtmlDocument = true
            } else {
                contents = callRust { notesage_capture_article_contents(url, title, nil, nil, html) }
            }
        } else {
            relPath = callRust { notesage_capture_rel_path(url, title, nil, nil) }
            contents = callRust { notesage_capture_contents(url, title, nil, nil) }
        }

        guard let relPath, let contents, !relPath.isEmpty, !contents.isEmpty else {
            return .failure(ShareCaptureError.buildFailed)
        }
        let finalPath = wroteHtmlDocument ? withExtension(relPath, "html") : relPath
        do {
            return .success(
                try ShareLibraryAccess.writeCapture(relPath: finalPath, contents: contents))
        } catch {
            return .failure(error)
        }
    }

    /// Replace a relative path's extension.
    ///
    /// Every rel-path builder in the crate returns `.md`, because a capture is
    /// a note by default. "Article (HTML)" writes a `<!doctype html>` document
    /// instead and must be named accordingly — otherwise it opens in the
    /// editor as raw markup, which is exactly what the format exists to avoid.
    /// The iOS extension does the same thing in `writeArticleHtml`.
    private static func withExtension(_ relPath: String, _ ext: String) -> String {
        ((relPath as NSString).deletingPathExtension as NSString)
            .appendingPathExtension(ext) ?? relPath
    }

    /// Call a Rust function that returns an owned C string, and free it.
    ///
    /// The crate's contract is that the caller frees with
    /// `notesage_capture_string_free`. Forgetting that leaks per share — small,
    /// but in a process that may be reused across shares it accumulates for no
    /// reason.
    private static func callRust(_ body: () -> UnsafeMutablePointer<CChar>?) -> String? {
        guard let raw = body() else { return nil }
        defer { notesage_capture_string_free(raw) }
        return String(cString: raw)
    }

    // MARK: - Fetch

    /// Fetch a page with a Safari user-agent and a bounded budget.
    ///
    /// The agent is not cosmetic: many sites serve an unrecognised client a
    /// bot-shell with no article in it, which would look to us like a page not
    /// worth extracting.
    private static func fetch(_ url: URL, completion: @escaping (String?) -> Void) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                + "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            forHTTPHeaderField: "User-Agent")

        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil

        URLSession(configuration: config).dataTask(with: request) { data, response, _ in
            let html: String? = {
                guard let http = response as? HTTPURLResponse,
                      (200..<300).contains(http.statusCode),
                      let data,
                      // 5 MB: enough for any article, small enough that a
                      // pathological page cannot exhaust the extension.
                      data.count <= 5 * 1024 * 1024
                else { return nil }
                return String(data: data, encoding: .utf8)
                    ?? String(data: data, encoding: .isoLatin1)
            }()

            // Deliberately NOT hopping to main here.
            //
            // The first fix for the WKWebView main-thread crash hopped the
            // whole completion, which also dragged article extraction (a
            // readability parse over up to 5 MB) and the coordinated disk
            // write onto the main thread for EVERY capture — including the
            // common one that never constructs a webview. If the file
            // coordinator stalls against a syncing iCloud folder, that freezes
            // the extension's UI rather than leaving it showing "Saving…".
            //
            // WebKit is the only main-thread requirement in this chain, and
            // `PageRenderer.renderedHTML` guards itself at the point that
            // actually needs it. AppKit is reached only through the
            // ShareViewController completion, which hops on its own.
            completion(html)
        }.resume()
    }
}
