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

enum ShareCaptureError: LocalizedError {
    case badUrl
    case fetchFailed
    case buildFailed

    var errorDescription: String? {
        switch self {
        case .badUrl: return "That does not look like a web link."
        case .fetchFailed:
            // Distinguished from "no article found": the user can retry a
            // network failure, and cannot retry a page with no article in it.
            return "Could not reach that page. Check your connection and try again."
        case .buildFailed: return "Could not build a note from that page."
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

        fetch(parsed) { html in
            guard let html else {
                completion(.failure(ShareCaptureError.fetchFailed))
                return
            }
            // A page with no extractable article degrades to a link note
            // rather than failing. The user asked to save something; saving
            // less is better than saving nothing.
            let result = build(url: url, title: title, html: html, format: format)
            if case .failure = result {
                completion(build(url: url, title: title, html: nil, format: .link))
            } else {
                completion(result)
            }
        }
    }

    // MARK: - Rust bridge

    private static func build(
        url: String, title: String?, html: String?, format: Format
    ) -> Result<String, Error> {
        let relPath: String?
        let contents: String?

        if let html, format != .link {
            relPath = callRust { notesage_capture_rel_path_from_html(url, title, html) }
            contents = format == .articleHtml
                ? callRust { notesage_capture_article_html_contents(url, title, nil, nil, html) }
                : callRust { notesage_capture_article_contents(url, title, nil, nil, html) }
        } else {
            relPath = callRust { notesage_capture_rel_path(url, title, nil, nil) }
            contents = callRust { notesage_capture_contents(url, title, nil, nil) }
        }

        guard let relPath, let contents, !relPath.isEmpty, !contents.isEmpty else {
            return .failure(ShareCaptureError.buildFailed)
        }
        do {
            return .success(try ShareLibraryAccess.writeCapture(relPath: relPath, contents: contents))
        } catch {
            return .failure(error)
        }
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
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  let data,
                  // 5 MB: enough for any article, small enough that a
                  // pathological page cannot exhaust the extension.
                  data.count <= 5 * 1024 * 1024
            else {
                completion(nil)
                return
            }
            completion(String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1))
        }.resume()
    }
}
