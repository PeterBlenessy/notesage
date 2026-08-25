//! The capture pipeline contract.
//!
//! Adding a share source touches more than a note builder. A capture has to
//! survive a chain, and every link is in a different language:
//!
//!   builder (Rust) → FFI (C ABI) → ShareViewController (Swift) → saved file
//!     → sweep finds its images → inliner rewrites them
//!     → `article_lead_image` locates one → gallery card shows it
//!
//! Unit tests cover the builders. Nothing covered the chain — so on
//! 2026-08-23 it broke in the two ways this file now makes impossible.
//!
//! **What happened.** X capture shipped in v0.52.0 and TestFlight build 11.
//! `build_x_note`, `x_syndication_url` and `XPost` were written and unit-tested
//! — and never exported over the FFI, so nothing in the app could call them.
//! X articles still saved, because generic readability extraction happens to
//! work on X's server-rendered status pages. What was lost was the metadata
//! path: title, author, and the COVER IMAGE. With no image in the document
//! there was nothing to inline, so `article_lead_image` found nothing and the
//! gallery fell back to a thumbnail of the rendered text. The feature looked
//! present and was structurally absent, and every test passed throughout.
//!
//! Two contracts follow, and they catch different halves:
//!
//!   1. REACHABILITY — a builder that no FFI export can reach is dead code
//!      wearing a test suite. This is the one that would have caught X.
//!   2. DISCOVERABILITY — a format carrying an image must carry it in a form
//!      the sweep can inline and the thumbnail can find. Producing an image
//!      the gallery cannot see is the same defect one stage later.
//!
//! Adding a source means adding a row. Forgetting one fails the build with the
//! stage that broke, rather than shipping a feature that quietly does nothing.

use std::fs;
use std::path::PathBuf;

fn crate_src(file: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src").join(file);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// 1. Reachability
// ---------------------------------------------------------------------------

/// Every `pub fn build_*` note builder, and the FFI export that reaches it.
///
/// `None` means deliberately unexported, and the reason has to be written down
/// — an empty justification is how X got here.
const BUILDER_REACHABILITY: &[(&str, Option<&str>, &str)] = &[
    (
        "build_capture_note",
        Some("notesage_capture_contents"),
        "the plain link note",
    ),
    (
        "build_video_note",
        Some("notesage_capture_video_contents"),
        "oEmbed video metadata capture",
    ),
    (
        "build_article_note",
        Some("notesage_capture_article_contents"),
        "extracted article, markdown format",
    ),
    (
        "build_article_html_document",
        Some("notesage_capture_article_html_contents"),
        "extracted article, HTML format",
    ),
    (
        "build_x_note",
        Some("notesage_capture_x_contents"),
        "X post metadata note — the fallback when there is no article to extract",
    ),
    (
        "build_x_article_note",
        Some("notesage_capture_x_contents"),
        "X article, markdown format: extraction enriched with syndication metadata",
    ),
];

#[test]
fn every_note_builder_is_reachable_or_documented() {
    let lib = crate_src("lib.rs");
    let ffi = crate_src("ffi.rs");

    let mut missing_rows = Vec::new();
    for line in lib.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("pub fn build_") {
            let name = format!("build_{}", rest.split(['(', '<', ' ']).next().unwrap_or(""));
            if !BUILDER_REACHABILITY.iter().any(|(b, _, _)| *b == name) {
                missing_rows.push(name);
            }
        }
    }
    assert!(
        missing_rows.is_empty(),
        "New note builder(s) with no entry in BUILDER_REACHABILITY: {missing_rows:?}.\n\
         Add a row naming the FFI export that reaches it — or `None` with a reason.\n\
         A builder nothing can call is dead code with a passing test suite; that is\n\
         exactly how X capture shipped twice while doing nothing."
    );

    for (builder, export, why) in BUILDER_REACHABILITY {
        match export {
            Some(sym) => assert!(
                ffi.contains(sym),
                "`{builder}` ({why}) claims FFI export `{sym}`, which is absent from ffi.rs.\n\
                 Either the export was renamed or removed — in both cases the builder is\n\
                 now unreachable from the app."
            ),
            None => assert!(
                !why.trim().is_empty(),
                "`{builder}` is unexported with no reason given. Say why, or wire it."
            ),
        }
    }
}

// The `the_unwired_x_path_is_still_unwired` canary lived here until
// 2026-08-24. It tripped when X was wired, which is what it was for, and the
// BUILDER_REACHABILITY rows above now name the real export. Nothing replaces
// it — a canary for a fixed defect is noise.
//
// What DOES replace it is the Swift check below, because the X incident
// exposed that "reachable from ffi.rs" was only half the chain.

/// Read a Share Extension source. These live outside the crate, which is the
/// point: the chain the module note draws crosses that boundary, and a
/// contract that stops at the crate edge stops one link short of where X
/// actually broke.
fn ios_src(file: &str) -> String {
    ext_src("ios", file)
}

/// Same, for the macOS Share Extension. It links the SAME staticlib and the
/// SAME bridging header, so it is a second consumer of every export — and the
/// first version of this file forgot it existed, which let macOS ship without
/// the X path for the whole time iOS had it.
fn macos_src(file: &str) -> String {
    ext_src("macos", file)
}

fn ext_src(dir: &str, file: &str) -> String {
    // `dir` is relative to `src-tauri/` — either a platform folder (`ios`,
    // `macos`) or the iOS plugin package, which lives under `crates/`.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(dir)
        .join(file);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// Does `haystack` name `symbol` as a whole word?
///
/// Needed because Swift reaches these exports two ways and both are correct:
/// called directly (`notesage_capture_x_metadata_url(u)`) or passed as a
/// function value (`callCapture(notesage_capture_rel_path, …)`). Requiring a
/// following `(` would reject the second — a legitimate pattern used four
/// times in LibraryCapture.swift.
fn mentions(haystack: &str, symbol: &str) -> bool {
    let ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut from = 0usize;
    while let Some(rel) = haystack[from..].find(symbol) {
        let start = from + rel;
        let end = start + symbol.len();
        let before_ok = haystack[..start].chars().next_back().map_or(true, |c| !ident(c));
        let after_ok = haystack[end..].chars().next().map_or(true, |c| !ident(c));
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

/// Every FFI export, and the Swift that calls it.
///
/// An export nothing calls is the same defect as a builder nothing exports —
/// one stage further down. X had a working builder and would, with only the
/// first contract, have been declared fixed by adding an export that Swift
/// never invoked.
///
/// Deliberately a text scan rather than a build: the Share Extension only
/// compiles on a Mac with an iOS toolchain, and a contract that cannot run in
/// CI is a contract that runs never.
/// `(export, iOS caller, macOS caller-or-reason)`.
///
/// TWO consumers, not one. Both extensions link the same staticlib through the
/// same bridging header, so an export is only as wired as its least-wired
/// caller — and "wired on iOS" is what X looked like for a whole release while
/// macOS silently had no X path at all.
///
/// A macOS `Err(reason)` is a DELIBERATE omission with the reason written
/// down, exactly like a `None` row in BUILDER_REACHABILITY. An empty reason is
/// not accepted.
type MacExpectation = Result<&'static str, &'static str>;

const EXPORT_CALL_SITES: &[(&str, &str, MacExpectation)] = &[
    ("notesage_capture_contents", "LibraryCapture.swift", Ok("ShareCapture.swift")),
    ("notesage_capture_rel_path", "LibraryCapture.swift", Ok("ShareCapture.swift")),
    ("notesage_capture_rel_path_from_html", "LibraryCapture.swift", Ok("ShareCapture.swift")),
    (
        "notesage_capture_oembed_url",
        "LibraryCapture.swift",
        Err("macOS offers no Video format — its picker is Article (HTML) / Article (Markdown) / Link"),
    ),
    (
        "notesage_capture_video_rel_path",
        "LibraryCapture.swift",
        Err("no Video format on macOS; see notesage_capture_oembed_url"),
    ),
    (
        "notesage_capture_video_contents",
        "LibraryCapture.swift",
        Err("no Video format on macOS; see notesage_capture_oembed_url"),
    ),
    ("notesage_capture_article_contents", "LibraryCapture.swift", Ok("ShareCapture.swift")),
    ("notesage_capture_article_html_contents", "LibraryCapture.swift", Ok("ShareCapture.swift")),
    ("notesage_capture_x_metadata_url", "LibraryCapture.swift", Ok("ShareCapture.swift")),
    ("notesage_capture_x_rel_path", "LibraryCapture.swift", Ok("ShareCapture.swift")),
    ("notesage_capture_x_contents", "LibraryCapture.swift", Ok("ShareCapture.swift")),
    ("notesage_capture_x_html_contents", "LibraryCapture.swift", Ok("ShareCapture.swift")),
    (
        "notesage_capture_x_is_article",
        "ShareViewController.swift",
        Ok("ShareCapture.swift"),
    ),
    ("notesage_capture_string_free", "LibraryCapture.swift", Ok("ShareCapture.swift")),
];

#[test]
fn every_ffi_export_is_called_from_swift_and_declared_in_the_header() {
    let ffi = crate_src("ffi.rs");
    let header = ios_src("NotesageCapture.h");

    // Collect the real export list from the source rather than trusting the
    // table — a NEW export with no row is exactly the gap being closed.
    let mut exports: Vec<String> = Vec::new();
    for line in ffi.lines() {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("pub unsafe extern \"C\" fn ") {
            exports.push(rest.split('(').next().unwrap_or("").trim().to_string());
        }
    }
    assert!(!exports.is_empty(), "no FFI exports found — did the signature style change?");

    for export in &exports {
        let Some((_, ios_file, mac)) = EXPORT_CALL_SITES.iter().find(|(e, _, _)| e == export)
        else {
            panic!(
                "FFI export `{export}` has no entry in EXPORT_CALL_SITES.\n\
                 Name the Swift file that calls it on EACH platform — or an\n\
                 Err(reason) where a platform deliberately does not. An export\n\
                 nothing calls is the same dead code as an unexported builder, one\n\
                 stage later — and that is precisely how X capture looked present\n\
                 while doing nothing."
            );
        };

        // A bare `contains` is not enough: every one of these names is a
        // PREFIX of another. `notesage_capture_rel_path` is a prefix of
        // `notesage_capture_rel_path_from_html`, so a substring check would
        // report the first as present on the strength of the second — passing
        // for entirely the wrong reason, which is the failure mode this whole
        // file exists to prevent. Match on a word boundary instead.
        assert!(
            mentions(&header, export),
            "`{export}` is not declared in NotesageCapture.h, so Swift cannot see it.\n\
             The bridging header is the only thing that makes an export callable.\n\
             Note BOTH extensions share this one header."
        );

        assert!(
            mentions(&ios_src(ios_file), export),
            "`{export}` is declared and exported but never called from iOS's {ios_file}.\n\
             Wire it, or delete it — a reachable-but-uncalled export passes every\n\
             other test in this file while shipping nothing."
        );

        match mac {
            Ok(mac_file) => assert!(
                mentions(&macos_src(mac_file), export),
                "`{export}` is called on iOS but never from macOS's {mac_file}.\n\
                 Same crate, same header, same staticlib — a capture that behaves\n\
                 differently depending on which machine shared it is a bug on\n\
                 whichever one is worse. Wire it, or change the row to an\n\
                 Err(reason) saying why macOS legitimately does not."
            ),
            Err(reason) => assert!(
                !reason.trim().is_empty(),
                "`{export}` is marked macOS-exempt with no reason. Say why, or wire it."
            ),
        }
    }
}

#[test]
fn the_share_controller_routes_x_urls_through_the_x_writer() {
    // The final link: `LibraryCapture` can expose a perfect X writer and
    // `ShareViewController` can still send every X share down the generic
    // article path. That is a one-line omission with no other symptom than
    // the bug we started from.
    let controller = ios_src("ShareViewController.swift");
    assert!(
        controller.contains("xMetadataEndpoint"),
        "iOS ShareViewController never asks whether a URL is an X status, so the\n\
         X path cannot be taken no matter what the crate exports."
    );
    assert!(
        controller.contains("writeXCapture"),
        "iOS ShareViewController never calls writeXCapture — X shares still take\n\
         the generic article path, which is the defect this whole file exists for."
    );

    // Same question on macOS, where the routing lives in ShareCapture rather
    // than the view controller.
    let mac = macos_src("ShareCapture.swift");
    assert!(
        mac.contains("xMetadataEndpoint"),
        "macOS ShareCapture never asks whether a URL is an X status. Desktop\n\
         shares of an X post would fall through to the generic article path —\n\
         the exact bug iOS had, on the other platform."
    );
}

#[test]
fn both_platforms_retry_a_failed_extraction_against_a_rendered_dom() {
    // A network fetch runs no JavaScript, so on an SPA the fetched HTML holds
    // no article and extraction declines. Rendering the page and re-extracting
    // is the second attempt that turns a bare link note back into an article.
    //
    // iOS shipped this in #611; macOS went without it, so every JS-rendered
    // site captured as a link on the Mac while the phone got the article. It
    // is invisible without a side-by-side comparison — nothing errors, the
    // capture just quietly contains less.
    for (label, src) in [
        ("iOS", ios_src("ShareViewController.swift")),
        ("macOS", macos_src("ShareCapture.swift")),
    ] {
        assert!(
            src.contains("PageRenderer.renderedHTML"),
            "{label} never retries against a rendered DOM, so any page whose\n\
             article is assembled by JavaScript degrades to a link note."
        );
    }

    // Reachability, not just presence.
    //
    // The call above existing is NOT the same as it running. macOS shipped
    // with the call present and unreachable for every X share, because
    // `notesage_capture_x_contents` never returns null — so the first attempt
    // always "succeeded" and the retry below it was dead code. This test
    // passed throughout.
    //
    // `requireArticle: true` on the earlier attempts is what makes the retry
    // reachable. Drop it and the dead-code state returns silently.
    // Both platforms. iOS had the identical dead-retry for its markdown X
    // path and was fixed alongside macOS — leaving one side gated and the
    // other not is the divergence this whole file exists to prevent.
    let mac = macos_src("ShareCapture.swift");
    assert_eq!(
        mac.matches("requireArticle: true").count(),
        2,
        "macOS must demand a genuine extraction on BOTH the raw-HTML and\n\
         rendered-DOM attempts. Without it an X share succeeds on the first\n\
         attempt regardless of whether an article was found, and the rendered\n\
         retry becomes unreachable — present in the source, never executed."
    );
    assert!(
        mac.contains("requireArticle: Bool"),
        "the requireArticle parameter is gone; the retry cannot be gated"
    );
    assert!(
        ios_src("ShareViewController.swift").contains("requireArticle: true"),
        "iOS does not demand a genuine extraction, so its X shares succeed on the\n\
         first attempt and the rendered retry never runs"
    );
    assert!(
        ios_src("LibraryCapture.swift").contains("requireArticle: Bool"),
        "iOS's writeXCapture cannot be gated; the retry is unreachable for X"
    );
}

#[test]
fn the_rendered_path_does_its_heavy_work_off_the_main_thread() {
    // `PageRenderer` guarantees its completion on MAIN — it forces itself
    // there to touch WebKit, and every exit is a WKWebView callback or a
    // main-queue timer. So the closure that receives the rendered DOM must hop
    // off before extracting (a readability parse over up to 5 MB) and writing
    // (a blocking coordinated write against what is usually an iCloud folder).
    //
    // Without the hop the extension UI freezes on exactly the case this path
    // exists for — JavaScript-rendered pages, i.e. most news sites. Round two
    // narrowed an over-broad main hop and left this branch on main; the defect
    // was one branch away from the fix for it.
    // BOTH platforms. The first version of this test read only macOS while
    // the release notes claimed cross-platform coverage — and iOS had the
    // identical defect on the identical line, unfixed and unchecked.
    for (label, src) in [
        ("macOS", macos_src("ShareCapture.swift")),
        ("iOS", ios_src("ShareViewController.swift")),
    ] {
    let mac = src;
    let start = mac
        .find("PageRenderer.renderedHTML(url: url) {")
        .unwrap_or_else(|| panic!("{label}: the rendered-DOM call site moved"));
    // Bound by the first `build(` AFTER the call site, not by a byte count.
    // A fixed window stops covering the code the moment someone adds a
    // comment — which is precisely how this assertion first failed against a
    // correct fix, and how an earlier check in this file passed against a
    // broken one.
    let rest = &mac[start..];
    let heavy = ["build(", "writeArticle("]
        .iter()
        .filter_map(|m| rest.find(m))
        .min()
        .unwrap_or_else(|| panic!("{label}: no extraction call after the rendered-DOM completion"));
    let prelude = &rest[..heavy];
    assert!(
        prelude.contains("DispatchQueue.global"),
        "{label}: the rendered-DOM completion reaches extraction and the\n\
         coordinated disk write without leaving the main thread — and\n\
         PageRenderer always calls back on main.\n\n{prelude}"
    );
    }
}

#[test]
fn both_platforms_claim_a_filename_atomically() {
    // Two shared files with the same name, ten concurrent callbacks: without a
    // claim, both see the path free and one silently overwrites the other,
    // with the UI reporting success. A shared file vanishing without a trace.
    //
    // A claim is only a claim if it HOLDS. An earlier version created a
    // placeholder, then deleted it and copied — leaving the path genuinely
    // free in between and reopening the race it closed. `replaceItemAt` swaps
    // atomically and has no such window.
    for (label, src) in [
        ("iOS", ios_src("LibraryCapture.swift")),
        ("macOS", macos_src("ShareLibraryAccess.swift")),
    ] {
        assert!(
            src.contains("claimName"),
            "{label} picks a filename without claiming it — check-then-use across\n\
             concurrent callbacks loses a file silently."
        );
        // The CALL, not the word. The first version matched
        // `src.contains("replaceItemAt")`, which its own explanatory comment
        // satisfied — so swapping the real call for `moveItem` left the test
        // green. Prose is not code, and a guard that reads its own
        // documentation is the purest form of passing for the wrong reason.
        assert!(
            src.contains("FileManager.default.replaceItemAt("),
            "{label} does not swap the staged copy in atomically. remove-then-copy\n\
             leaves the claimed path free in between, which is the race itself."
        );
        // No brittle negative guard here. An exact-string check that encodes
        // one indentation level stops catching a reintroduced remove-then-copy
        // the moment anyone reformats — and the positive `replaceItemAt`
        // assertion above already pins the load-bearing invariant.
    }
}

#[test]
fn both_platforms_accept_shared_files_not_just_links() {
    // Sharing a PDF or an EPUB into the library is a first-class capture, and
    // the activation rule is what decides whether Notesage even APPEARS in the
    // share sheet for one. macOS declared only WebURL, so a PDF could not be
    // shared to the Mac at all — the extension was not offered.
    for (label, plist) in [
        ("iOS", ios_src("ShareExtension-Info.plist")),
        ("macOS", macos_src("ShareExtension-Info.plist")),
    ] {
        assert!(
            plist.contains("NSExtensionActivationSupportsFileWithMaxCount"),
            "{label} does not declare file support, so the share sheet will not\n\
             offer Notesage for a PDF, EPUB or image."
        );
    }

    // Declaring it and handling it are separate — an activation rule that
    // offers the extension for a file it then cannot store is worse than not
    // offering it.
    for (label, src, writer) in [
        ("iOS", ios_src("LibraryCapture.swift"), "writeDocument"),
        ("macOS", macos_src("ShareLibraryAccess.swift"), "writeDocument"),
    ] {
        assert!(
            src.contains(writer),
            "{label} declares file support but has no {writer} to store one."
        );
    }
}

#[test]
fn both_platforms_enter_the_security_scope_before_minting_a_bookmark() {
    // `bookmarkData(options: .withSecurityScope)` requires being INSIDE the
    // URL's security scope. A folder-picker URL carries an implicit grant, but
    // both pickers hand it back ASYNCHRONOUSLY and that grant is not
    // guaranteed to still be live when the completion runs.
    //
    // iOS wrapped it from the start; macOS did not, and threw "you don't have
    // permission" — presenting to the user as "Could not remember that
    // folder" after they had just chosen it. The grant could never be stored,
    // so Save stayed disabled forever.
    //
    // Cheap to reintroduce (the wrap looks redundant), expensive to diagnose:
    // it depends on timing, so it can work on one machine and fail on another.
    for (label, src, func_marker) in [
        (
            "iOS",
            ext_src(
                "crates/tauri-plugin-notesage-ios/ios/Sources",
                "LibraryAccess.swift",
            ),
            "static func persistBookmark(",
        ),
        ("macOS", macos_src("ShareLibraryAccess.swift"), "static func requestGrant("),
    ] {
        let start = src
            .find(func_marker)
            .unwrap_or_else(|| panic!("{label}: `{func_marker}` not found"));
        // Bound the slice by the NEXT declaration rather than a fixed byte
        // count — a fixed window silently stops covering the function the
        // moment someone adds a comment, and then passes for that reason.
        let after = &src[start + func_marker.len()..];
        let end = ["\n    static func ", "\n    private static func ", "\n}"]
            .iter()
            .filter_map(|m| after.find(m))
            .min()
            .map(|i| start + func_marker.len() + i)
            .unwrap_or(src.len());
        let body = &src[start..end];
        let mint = body
            .find("bookmarkData(")
            .unwrap_or_else(|| panic!("{label}: no bookmarkData call in {func_marker}"));
        assert!(
            body[..mint].contains("startAccessingSecurityScopedResource()"),
            "{label} mints a bookmark without first entering the URL's security\n\
             scope. The picker's implicit grant may have lapsed by the time the\n\
             async completion runs, and the throw reads as \"could not remember\n\
             that folder\" — after the user just chose it.\n\n{body}"
        );
    }
}

#[test]
fn the_macos_save_button_is_re_enabled_when_the_url_arrives() {
    // The shared URL arrives ASYNCHRONOUSLY, from `loadItem`'s completion.
    // `viewDidAppear` runs the enablement check before that — with `sharedUrl`
    // still nil — so unless `show(url:)` re-runs it, Save is never enabled by
    // the URL landing.
    //
    // That shipped, and it hid behind the grant flow: the FIRST share needs a
    // library folder, and granting re-ran the check once the URL had arrived.
    // Every share after that found a stored grant, showed no grant button, and
    // left Save permanently disabled. "Works once, then never again" is a
    // miserable shape to debug from a bug report and invisible to any test
    // that only checks a first run.
    //
    // A source scan because the extension is AppKit — it cannot be driven
    // from CI, and a contract that cannot run in CI runs never.
    let src = macos_src("ShareViewController.swift");
    let start = src
        .find("private func show(url: String?")
        .expect("show(url:) not found — did the URL sink get renamed?");
    let end = src[start..]
        .find("\n    /// Show the library picker")
        .map(|i| start + i)
        .unwrap_or(src.len());
    let body = &src[start..end];

    assert!(
        body.contains("sharedUrl = url"),
        "show(url:) no longer assigns sharedUrl — this test is watching the wrong function"
    );
    assert!(
        body.contains("refreshGrantState()"),
        "show(url:) sets sharedUrl but never refreshes the save button.\n\
         Save is gated on `sharedUrl != nil` and the check already ran with it\n\
         nil, so the button stays disabled for every share that does not also\n\
         go through the grant flow — i.e. all of them after the first.\n\n{body}"
    );
}

#[test]
fn an_html_capture_is_not_written_with_a_markdown_name() {
    // Every rel-path builder returns `.md`, because a capture is a note by
    // default. The "Article (HTML)" format writes a `<!doctype html>` document
    // and must be named accordingly — otherwise it opens in the editor as raw
    // markup, which is precisely what that format exists to avoid.
    //
    // iOS got this right from the start; macOS shipped without it, writing
    // HTML documents into `.md` files. Cheap to reintroduce, invisible until
    // someone opens one.
    let ios = ios_src("LibraryCapture.swift");
    assert!(
        ios.contains(r#""\(stem).html""#),
        "iOS writeArticleHtml no longer names its output `.html`."
    );

    let mac = macos_src("ShareCapture.swift");
    assert!(
        mac.contains("withExtension") && mac.contains(r#""html""#),
        "macOS ShareCapture does not rewrite the extension for HTML captures, so\n\
         an Article (HTML) share lands as a `.md` file full of markup."
    );
}

// ---------------------------------------------------------------------------
// 2. Discoverability
// ---------------------------------------------------------------------------

const IMAGE_URL: &str = "https://cdn.example/cover.jpg";
const DATA_URI: &str = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const NOW: &str = "2026-08-23T10:00:00Z";

fn input(url: &str) -> notesage_capture::CaptureInput {
    notesage_capture::CaptureInput {
        url: url.to_string(),
        title: Some("A Title".to_string()),
        ..Default::default()
    }
}

/// A capture that carries an image must carry it somewhere the gallery can
/// reach: the URL has to be findable, rewritable, and the result locatable by
/// `article_lead_image`. A format failing any step shows a thumbnail of text.
#[test]
fn markdown_capture_image_survives_to_the_thumbnail() {
    let meta = notesage_capture::VideoMeta {
        title: Some("A Title".into()),
        thumbnail_url: Some(IMAGE_URL.into()),
        ..Default::default()
    };
    let note = notesage_capture::build_video_note(&input("https://youtu.be/abc"), &meta, NOW);

    let urls = notesage_capture::markdown_image_urls(&note.contents);
    assert!(
        urls.iter().any(|u| u == IMAGE_URL),
        "the sweep cannot find this capture's image, so it will never be inlined.\n\
         found: {urls:?}"
    );

    let inlined = notesage_capture::inline_markdown_images(
        &note.contents,
        &[(IMAGE_URL.to_string(), DATA_URI.to_string())],
    );
    assert!(
        notesage_capture::article_lead_image(&inlined).is_some(),
        "image inlined but `article_lead_image` cannot locate it — the gallery card\n\
         falls back to a thumbnail of the rendered text.\n\n{inlined}"
    );
}

#[test]
fn html_capture_image_survives_to_the_thumbnail() {
    let html = format!(r#"<article><p>Words.</p><img src="{IMAGE_URL}"></article>"#);

    let urls = notesage_capture::article_image_urls(&html);
    assert!(urls.iter().any(|u| u == IMAGE_URL), "sweep cannot find it: {urls:?}");

    let inlined = notesage_capture::inline_article_images(
        &html,
        &[(IMAGE_URL.to_string(), DATA_URI.to_string())],
    );
    assert!(
        notesage_capture::article_lead_image(&inlined).is_some(),
        "HTML capture's image is not thumbnail-discoverable:\n{inlined}"
    );
}

#[test]
fn an_x_captures_cover_survives_to_the_thumbnail() {
    // The exact chain that failed. An X Article's cover is rendered by the
    // client, so extraction never sees it — the note came out imageless and
    // the gallery showed a thumbnail of the article's own text.
    //
    // Runs the whole way: enrich → note → sweep finds the URL → inline →
    // `article_lead_image` locates it. Each step is a place it broke before.
    let post = notesage_capture::XPost {
        article_title: Some("The real subject".into()),
        cover_image_url: Some(IMAGE_URL.into()),
        author_handle: Some("rvaniaaaa".into()),
        ..Default::default()
    };
    let mut article = notesage_capture::Article {
        title: Some("Rania (@rvaniaaaa) on X".into()),
        markdown: "The extracted body of the piece.".into(),
        html: "<p>The extracted body of the piece.</p>".into(),
    };
    notesage_capture::enrich_x_article(&mut article, &post);

    let note = notesage_capture::build_x_article_note(
        &input("https://x.com/rvaniaaaa/status/1"),
        &article,
        &post,
        NOW,
    );

    let urls = notesage_capture::markdown_image_urls(&note.contents);
    assert!(
        urls.iter().any(|u| u == IMAGE_URL),
        "the sweep cannot find the X cover, so it will never be inlined: {urls:?}"
    );

    let inlined = notesage_capture::inline_markdown_images(
        &note.contents,
        &[(IMAGE_URL.to_string(), DATA_URI.to_string())],
    );
    assert!(
        notesage_capture::article_lead_image(&inlined).is_some(),
        "X cover inlined but not thumbnail-discoverable — back to a picture of\n\
         the text, which is the whole reported defect.\n\n{inlined}"
    );
}

#[test]
fn an_x_url_is_not_treated_as_a_video_page() {
    // Load-bearing, and easy to break without noticing. The share sheet hides
    // BOTH article formats for any URL with an oEmbed endpoint (a video page
    // has no article to extract). Adding x.com to `oembed_url` — plausible,
    // since X hosts video — would leave X shares offering only Video and Link,
    // and every path built here would become unreachable. Silently: the picker
    // would still work, captures would still save, and the enrichment would
    // simply never run again.
    for url in [
        "https://x.com/rvaniaaaa/status/1234567890",
        "https://twitter.com/jack/status/20",
    ] {
        assert!(
            notesage_capture::oembed_url(url).is_none(),
            "{url} now has an oEmbed endpoint, so the share sheet will offer only\n\
             Video + Link for it and the X article path can never run.\n\
             If X really needs a video format, it must not displace the article\n\
             formats for status URLs."
        );
        assert!(
            notesage_capture::x_syndication_url(url).is_some(),
            "{url} is no longer recognised as an X status — the enrichment path\n\
             is unreachable for it."
        );
    }
}

#[test]
fn a_capture_with_no_image_is_allowed_to_have_no_thumbnail() {
    // The contract is "an image that exists must survive", not "every note has
    // an image". A link note legitimately has none, and must not be forced to
    // invent one.
    let note = notesage_capture::build_capture_note(&input("https://example.com/x"), NOW);
    assert!(notesage_capture::markdown_image_urls(&note.contents).is_empty());
    assert!(notesage_capture::article_lead_image(&note.contents).is_none());
}
