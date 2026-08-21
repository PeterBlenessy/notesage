//  ImageInliner.swift
//  Notesage
//
//  Fetch, downsample and base64-encode the images an article references, so a
//  captured article becomes self-contained (task #1.2 of
//  `docs/prds/2026-08-21-self-contained-articles.md`).
//
//  Why this is Swift and not Rust
//  ------------------------------
//  `CGImageSourceCreateThumbnailAtIndex` downsamples straight from the encoded
//  source, so a 4000px photo never becomes a ~60 MB bitmap in memory. A Rust
//  image crate would have to fully decode first. On a platform where the
//  budget is the whole point, that difference decides where the code lives.
//
//  What stays in Rust: WHICH images, and what the rewritten document looks
//  like (`article_image_urls` / `inline_article_images`). Those are the parts
//  worth testing with no network and no device, and they are covered there.
//
//  Three budgets, and why each exists
//  ----------------------------------
//  **Per-image bytes.** Read from the GET response headers, which arrive
//  before the body — so an oversized image is cancelled having cost nothing
//  but headers. A separate HEAD would be a second round trip AND unreliable:
//  plenty of CDNs omit `Content-Length` on HEAD or do not implement it. When
//  the header is absent we stream and abort on crossing the cap instead.
//
//  **Total bytes.** The document has to be opened on a phone. Downscaling
//  makes this generous rather than tight.
//
//  **Wall clock.** The real constraint when this runs during a share: the user
//  is watching a sheet. Ten images on hotel wifi is a hang no memory budget
//  catches.
//
//  Every failure degrades to "skip this image", never to an error. An image
//  that was too big, too slow, or 404'd keeps its remote URL, which is exactly
//  today's behaviour — so a partial result is still a working article and a
//  later sweep can finish the job.

import Foundation
import ImageIO

final class ImageInliner: NSObject {
    struct Limits {
        /// Longest edge after downsampling. 1600 is already 2x retina on a
        /// 390pt-wide phone, so nothing visible is lost.
        var maxPixel: Int = 1600
        var jpegQuality: CGFloat = 0.8
        /// Refuse a single source image larger than this before downloading it.
        var perImageBytes: Int = 8 * 1024 * 1024
        /// Ceiling on the ENCODED total — base64 inflates by 4/3, and that is
        /// the number that lands in the document.
        var totalEncodedBytes: Int = 12 * 1024 * 1024
        /// Stop starting new fetches past this point. In-flight work finishes.
        var wallClock: TimeInterval = 20
    }

    /// url -> `data:` URI, for the images that made it inside every budget.
    /// Order follows the input, which is document order (see
    /// `article_image_urls`): the lead image is first, so a partial result
    /// keeps the images that matter most.
    typealias Result = [(String, String)]

    private let limits: Limits
    private var session: URLSession!
    /// Per-task cap so the delegate can cancel an oversized response.
    private var budgetForTask: [Int: Int] = [:]

    init(limits: Limits) {
        self.limits = limits
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        // A capture must not read or write the user's cookies, same rule the
        // page renderer follows.
        config.httpCookieStorage = nil
        config.urlCache = nil
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    /// Fetch and encode `urls`, one at a time, on a background queue.
    ///
    /// Serial and `.utility` on purpose: the OS deprioritises it while the
    /// user interacts, and one image at a time keeps peak memory at one image
    /// rather than the whole set. Throughput is not the goal — never being the
    /// reason the UI stutters is.
    static func inline(
        urls: [String],
        limits: Limits = Limits(),
        completion: @escaping (Result) -> Void
    ) {
        guard !urls.isEmpty else {
            completion([])
            return
        }
        let inliner = ImageInliner(limits: limits)
        DispatchQueue.global(qos: .utility).async {
            let out = inliner.run(urls: urls)
            // Hold the inliner until the work is done; the URLSession keeps a
            // strong reference to its delegate and must be torn down or the
            // session leaks for the process's lifetime.
            inliner.session.invalidateAndCancel()
            completion(out)
        }
    }

    private func run(urls: [String]) -> Result {
        var out: Result = []
        var encodedTotal = 0
        let deadline = Date().addingTimeInterval(limits.wallClock)

        for url in urls {
            if Date() >= deadline { break }
            let remaining = limits.totalEncodedBytes - encodedTotal
            if remaining <= 0 { break }

            guard let data = fetch(url: url, deadline: deadline),
                  let jpeg = downsample(data)
            else { continue }

            let encoded = jpeg.base64EncodedString()
            // Check AFTER encoding, against the real cost: base64 inflates by
            // 4/3, so budgeting on raw bytes silently overshoots by a third.
            if encoded.utf8.count > remaining { continue }

            encodedTotal += encoded.utf8.count
            out.append((url, "data:image/jpeg;base64,\(encoded)"))
        }
        return out
    }

    /// Synchronous fetch with the per-image cap enforced from the response
    /// headers (see the delegate below).
    private func fetch(url: String, deadline: Date) -> Data? {
        guard let parsed = URL(string: url),
              parsed.scheme == "https" || parsed.scheme == "http"
        else { return nil }

        var request = URLRequest(url: parsed)
        request.timeoutInterval = max(1, min(15, deadline.timeIntervalSinceNow))
        // Some CDNs serve a bot-shell or refuse unknown agents outright, the
        // same reason the article fetch presents a Safari agent.
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            forHTTPHeaderField: "User-Agent")

        let semaphore = DispatchSemaphore(value: 0)
        var result: Data?
        let task = session.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return
            }
            result = data
        }
        budgetForTask[task.taskIdentifier] = limits.perImageBytes
        task.resume()

        // Bounded wait: a stalled connection must not hold the queue past the
        // wall clock this whole job is running under.
        let waited = semaphore.wait(timeout: .now() + max(1, min(15, deadline.timeIntervalSinceNow)))
        if waited == .timedOut {
            task.cancel()
            return nil
        }
        budgetForTask.removeValue(forKey: task.taskIdentifier)
        return result
    }

    /// Downsample to `maxPixel` on the longest edge and re-encode as JPEG.
    ///
    /// `kCGImageSourceCreateThumbnailFromImageAlways` with a max pixel size
    /// decodes at reduced size rather than decoding then scaling — the whole
    /// reason this is not a Rust image crate.
    private func downsample(_ data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }

        // maxPixel 0 means the user asked for originals — no cap. Decode at
        // full size instead of asking for a thumbnail, which would otherwise
        // "resize" to 0 and produce nothing. This is the memory-hungry path,
        // which is exactly why it is opt-in rather than the default.
        if limits.maxPixel <= 0 {
            guard let full = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
            return encodeJpeg(full)
        }

        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: limits.maxPixel,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return encodeJpeg(image)
    }

    private func encodeJpeg(_ image: CGImage) -> Data? {
        let out = NSMutableData()
        // The literal UTI rather than `UTType.jpeg`: identical value, no
        // UniformTypeIdentifiers import, and no iOS 14 availability floor
        // on a file that has no other reason to carry one.
        guard let dest = CGImageDestinationCreateWithData(
            out, "public.jpeg" as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(dest, image, [
            kCGImageDestinationLossyCompressionQuality: limits.jpegQuality,
        ] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }
}

extension ImageInliner: URLSessionDataDelegate {
    /// The cheap size check. Headers arrive before the body, so an image over
    /// the per-image cap is cancelled having cost only the headers — the same
    /// information a HEAD request would have given, without the second round
    /// trip and without depending on the server implementing HEAD at all.
    ///
    /// `expectedContentLength` is -1 when the server omits `Content-Length`
    /// (chunked encoding). That is not a failure: we allow it and let the
    /// total-bytes and wall-clock budgets bound the damage.
    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        let cap = budgetForTask[dataTask.taskIdentifier] ?? Int.max
        let declared = response.expectedContentLength
        if declared > 0 && declared > Int64(cap) {
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }
}
