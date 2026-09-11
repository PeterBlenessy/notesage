//
//  Runs the article row's own logic on macOS — no device, no simulator, no
//  XCTest target (the app has none; see `scripts/check-chrome-column.sh` for
//  why this shape exists).
//
//  What is checked here is everything about a saved article's row EXCEPT the
//  parse, which belongs to Rust and is tested there (`notesage-capture`'s own
//  suite covers `article_card_meta`). What Swift owns is:
//
//    * the reading line — four states, and the one that used to be wrong is
//      "0 of 4 min left" on a barely-started article;
//    * the decode of the ABI's JSON, which pins the field names. `CardMeta`
//      serialises camelCase, and a Swift property named `source_url` would
//      decode to nil in complete silence;
//    * which files are even candidates, because asking for a capture header
//      is a file read per row;
//    * the fallback title, so a row is never empty while the read is in
//      flight.
//
//  `ArticleMeta.swift` compiles here because the C ABI call is behind
//  `#if canImport(CNotesageCapture)`, which is false on this target.
//

import Foundation

var failures = 0
func check(_ label: String, _ condition: @autoclosure () -> Bool) {
    if condition() {
        print("  ok   \(label)")
    } else {
        print("  FAIL \(label)")
        failures += 1
    }
}

let en = ArticleMeta.Templates(
    minutes: "{total} min", minutesLeft: "{left} of {total} min left", read: "Read")
let sv = ArticleMeta.Templates(
    minutes: "{total} min", minutesLeft: "{left} av {total} min kvar", read: "Läst")

print("reading line")
check("no estimate yields no line",
    ArticleMeta.readingLine(minutes: nil, progress: 0, templates: en) == nil)
check("unopened shows the total",
    ArticleMeta.readingLine(minutes: 4, progress: 0, templates: en) == "4 min")
check("part-read shows what is left",
    ArticleMeta.readingLine(minutes: 10, progress: 0.5, templates: en) == "5 of 10 min left")
// The bug this pins: `ceil` of a tiny remainder is 1, but a naive `Int()`
// truncation gives 0, and "0 of 4 min left" on an article you have barely
// started reads as finished.
check("a barely-started article never says 0 left",
    ArticleMeta.readingLine(minutes: 4, progress: 0.96, templates: en) == "1 of 4 min left")
check("rounds up rather than down",
    ArticleMeta.readingLine(minutes: 10, progress: 0.35, templates: en) == "7 of 10 min left")
check("at the threshold it reads as read",
    ArticleMeta.readingLine(minutes: 4, progress: 0.97, templates: en) == "Read")
check("past the threshold it reads as read",
    ArticleMeta.readingLine(minutes: 4, progress: 1, templates: en) == "Read")
// Swedish puts the numbers in the same order but the words elsewhere. The
// template travels with the language, so this passes without Swift knowing
// anything about Swedish.
check("the translated template keeps its own word order",
    ArticleMeta.readingLine(minutes: 10, progress: 0.5, templates: sv) == "5 av 10 min kvar")
check("the translated read state is translated",
    ArticleMeta.readingLine(minutes: 4, progress: 1, templates: sv) == "Läst")

print("placeholders")
check("an unknown placeholder is left visible, not blanked",
    ArticleMeta.fill("{left} of {total}", ["left": "2"]) == "2 of {total}")
check("every occurrence is replaced",
    ArticleMeta.fill("{n} and {n}", ["n": "1"]) == "1 and 1")

print("decode")
// The exact shape `notesage_capture_article_card_meta` returns — serde
// camelCase over `CardMeta`. If a field is renamed on either side, this is
// where it shows up rather than as a blank row on a device.
let full = """
{"title":"A headline","excerpt":"The standfirst","minutes":7,"site":"example.com",\
"sourceUrl":"https://example.com/a"}
"""
let meta = ArticleMeta.decode(full)
check("decodes a full header", meta != nil)
check("title", meta?.title == "A headline")
check("excerpt", meta?.excerpt == "The standfirst")
check("minutes", meta?.minutes == 7)
check("site", meta?.site == "example.com")
check("sourceUrl is camelCase, as serde writes it", meta?.sourceUrl == "https://example.com/a")

// Every field but the source is optional in `CardMeta`, and a capture whose
// page carried no standfirst really does produce nulls. A decoder that
// required them would drop the whole row.
let sparse = ArticleMeta.decode(
    #"{"title":null,"excerpt":null,"minutes":null,"site":null,"sourceUrl":"https://x.test/"}"#)
check("decodes a header with only a source", sparse != nil)
check("absent fields decode to nil", sparse?.title == nil && sparse?.minutes == nil)
check("rubbish decodes to nothing", ArticleMeta.decode("not json") == nil)

print("candidates")
check("html is a candidate", ArticleMeta.isCandidate("Inbox/a.html"))
check("htm is a candidate", ArticleMeta.isCandidate("Inbox/a.htm"))
check("case does not matter", ArticleMeta.isCandidate("Inbox/A.HTML"))
// A note has no capture header, and asking for one costs a file read per row
// in a folder of several hundred.
check("markdown is not", !ArticleMeta.isCandidate("Notes/a.md"))
check("pdf is not", !ArticleMeta.isCandidate("Notes/a.pdf"))
check("a name merely containing html is not",
    !ArticleMeta.isCandidate("Notes/html-tricks.md"))

print("row text")
let waiting = ArticleMeta.rowText(
    name: "2026-08-02-101400-a-headline.html", meta: nil, progress: 0, templates: en)
// While the read is in flight the row is already article-shaped, titled from
// the filename. A row that changes shape when the header lands is the jump
// this screen exists to remove.
check("falls back to the filename without its extension",
    waiting.title == "2026-08-02-101400-a-headline")
check("nothing to say yet on the second line", waiting.subtitle == nil)
check("no standfirst yet", waiting.excerpt == nil)

let loaded = ArticleMeta.rowText(name: "x.html", meta: meta, progress: 0, templates: en)
check("shows the article's own title", loaded.title == "A headline")
check("site and reading time, joined", loaded.subtitle == "example.com · 7 min")
check("carries the standfirst", loaded.excerpt == "The standfirst")

let noSite = ArticleMeta.rowText(
    name: "x.html", meta: ArticleCardMeta(title: "T", minutes: 3), progress: 0, templates: en)
check("a header with no site still shows the time", noSite.subtitle == "3 min")
let noneOfIt = ArticleMeta.rowText(
    name: "x.html", meta: ArticleCardMeta(title: "T"), progress: 0, templates: en)
check("nothing to join means no second line", noneOfIt.subtitle == nil)
// A capture whose `<title>` was empty is not a titleless row — it falls back
// like one that has not loaded.
check("an empty title falls back to the filename",
    ArticleMeta.rowText(
        name: "fallback.html", meta: ArticleCardMeta(title: ""), progress: 0, templates: en
    ).title == "fallback")

print("cache")
ArticleMeta.clearCache()
var reads: [String] = []
let header = """
<html><head><title>Cached</title></head><body>\
<p class="byline">By A · 5 min read · site.test</p>\
<a href="https://site.test/a">source</a></body></html>
"""
ArticleMeta.readDocument = { path in
    reads.append(path)
    return path.hasSuffix("capture.html") ? header : "<html><body>just a page</body></html>"
}

// The parse itself is Rust's, and this target does not link it, so every
// answer here is nil. That is fine: what is under test is WHICH reads happen
// and what is remembered, not what comes back.

/// Start a load and wait for its completion to actually be delivered.
///
/// `load` answers on the MAIN queue, because its caller is a cell. A
/// command-line tool has no run loop turning, so a bare semaphore wait would
/// deadlock on a completion that is sitting in the main queue — which is
/// exactly what it did the first time. Pumping the run loop is what makes
/// this harness exercise the real delivery path rather than a shortened one.
func awaitLoad(_ rel: String, modified: Double) -> Bool {
    var delivered = false
    ArticleMeta.load(rel, modified: modified) { _ in delivered = true }
    let deadline = Date().addingTimeInterval(2)
    while !delivered && Date() < deadline {
        RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.01))
    }
    return delivered
}

check("nothing is known before a read", ArticleMeta.peek("Inbox/capture.html", modified: 1) == nil)

check("the load answers on the main queue", awaitLoad("Inbox/capture.html", modified: 1))
check("it read the file once", reads == ["Inbox/capture.html"])
// `.some(nil)` — read, and not a capture — has to be distinguishable from
// "not read yet", or every plain page in the Inbox is re-read on every
// scroll.
check("the answer is remembered, even when it is nothing",
    ArticleMeta.peek("Inbox/capture.html", modified: 1) != nil)

check("a repeat answers from the cache", awaitLoad("Inbox/capture.html", modified: 1))
check("and does not touch the disk again", reads == ["Inbox/capture.html"])

// A file rewritten in place — an update from source, the background image
// sweep — changes mtime, and the row has to follow it.
check("a new modification time is a new read", awaitLoad("Inbox/capture.html", modified: 2))
check("so the file is read again", reads.count == 2)
check("and the old entry is still there",
    ArticleMeta.peek("Inbox/capture.html", modified: 1) != nil)

ArticleMeta.clearCache()
check("clearing forgets everything",
    ArticleMeta.peek("Inbox/capture.html", modified: 1) == nil)

print("")
if failures == 0 {
    print("article meta: all checks passed")
} else {
    print("article meta: \(failures) FAILED")
    exit(1)
}
