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
    (
        "notesage_capture_linked_document_extension",
        "ShareViewController.swift",
        Ok("ShareCapture.swift"),
    ),
    (
        "notesage_capture_disposition_filename",
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
fn no_capture_write_runs_on_the_main_thread() {
    // A readability parse over up to 5 MB plus a coordinated write against
    // what is usually an iCloud folder. On main it freezes the share sheet
    // whenever the coordinator stalls.
    //
    // The previous version of this test anchored on the `PageRenderer` call
    // site and inspected only what came AFTER it — so it was structurally
    // blind to the two earlier write attempts in the same function, including
    // the raw-HTML one, which is the COMMON path. It reported the freeze fixed
    // while two of three call sites still ran on main. Seventh guard in this
    // branch to pass for the wrong reason.
    //
    // So: check every call site, by name, across the whole file.
    for (label, src, writer, hop) in [
        (
            "iOS",
            ios_src("ShareViewController.swift"),
            "writeArticle(url:",
            "writeOffMain(",
        ),
        ("macOS", macos_src("ShareCapture.swift"), "build(", "DispatchQueue.global"),
    ] {
        if label == "iOS" {
            // The hop must be INSIDE writeOffMain's own body. The previous
            // version checked `src.contains("writeOffMain(")`, which the
            // declaration and its call sites satisfy — so stripping the
            // DispatchQueue hop out of the funnel left the guard green while
            // every write ran synchronously on main. Mutation-proven hollow
            // in review round six. Existence is not behaviour.
            let f = src
                .find("private func writeOffMain(")
                .expect("writeOffMain moved — this guard is anchored to it");
            let fend = src[f..]
                .find("\n    /// Reads ONLY the snapshot")
                .map(|i| f + i)
                .unwrap_or(src.len());
            let funnel = &src[f..fend];
            assert!(
                funnel.contains("DispatchQueue.global"),
                "iOS writeOffMain no longer hops off the main thread — every capture\n\
                 write runs on the thread the share sheet draws on.\n\n{funnel}"
            );
            assert!(
                funnel.contains("DispatchQueue.main.async"),
                "iOS writeOffMain no longer completes back on main; its callers touch\n\
                 UIKit from whatever queue the write finished on."
            );

            // Count CALLS, not the declaration. `private func writeArticle(url:`
            // also contains the name, and counting it made the assertion fire
            // against correct code — the mirror image of a guard that passes
            // for the wrong reason, and just as useless.
            let direct = src
                .lines()
                .filter(|l| l.contains("writeArticle(url:") && !l.contains("func "))
                .count();
            // EXACTLY one — the funnel's own call. `<= 1` also accepted ZERO,
            // i.e. writeArticle never called at all and every article capture
            // silently degrading to the fallback note, without failing.
            assert_eq!(
                direct, 1,
                "iOS must call writeArticle exactly once, from inside writeOffMain.\n\
                 {direct} direct calls found: 0 means captures silently degrade to\n\
                 fallback notes; more than 1 means a call site bypassed the funnel\n\
                 and runs on main."
            );
            let _ = writer;
        } else {
            assert!(
                src.contains(hop),
                "{label} has no off-main hop at all — every capture write would run\n\
                 on the thread the share sheet draws on."
            );
        }
    }
}

#[test]
fn the_capture_write_does_not_read_mutable_view_state() {
    // `writeArticle` runs on a background queue. The format picker's menu
    // stays live after Save is tapped and mutates `format` on MAIN, so
    // reading it from the write was an unsynchronised cross-thread read —
    // introduced by moving the write off main, which is the fix that was
    // supposed to make things safer.
    //
    // A snapshot taken on main also pins the user's intent to the moment they
    // pressed Save, which is what they actually meant.
    let src = ios_src("ShareViewController.swift");
    let start = src
        .find("private func writeArticle(url: String")
        .expect("writeArticle moved");
    let end = src[start..]
        .find("\n    /// Fetch the page")
        .map(|i| start + i)
        .unwrap_or(src.len());
    let body = &src[start..end];
    // Strip comments, then strip every `snapshot.<field>` read, and only then
    // ban the bare identifiers. The previous list mixed `self.format` with
    // bare `sharedTitle` — but Swift permits omitting `self.`, so rewriting
    // the body to read bare `xJson` sailed past the `self.xJson` ban.
    // Mutation-proven hollow in review round six: the exact race this guard
    // names could be reintroduced without failing it.
    let code: String = body
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    for field in ["format", "sharedTitle", "xJson", "isXStatus"] {
        // An argument LABEL (`xJson: snapshot.xJson`) is not a read — the
        // label is the identifier followed by `:`. Strip labels as well as
        // snapshot reads, or the guard fires on correct code, which is the
        // mirror image of hollow and just as disqualifying.
        let cleaned = code
            .replace(&format!("snapshot.{field}"), "")
            .replace(&format!("{field}:"), ":");
        // Word boundary: `format` must not match `CaptureFormat` or a label
        // like `format:` in an unrelated signature... but in this body any
        // bare occurrence IS a self-read, so plain containment is right —
        // provided snapshot reads and comments are gone.
        assert!(
            !mentions(&cleaned, field),
            "writeArticle reads `{field}` — mutable view state, from a background\n\
             queue. Take it from the CaptureSnapshot instead.\n\n{body}"
        );
    }
    assert!(
        body.contains("snapshot."),
        "writeArticle no longer reads the snapshot; the parameter is decorative"
    );
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

/// A captured `.html` must still be a standards-mode DOCUMENT after the image
/// sweep has rewritten it (#805).
///
/// Runs the real chain — extract → `build_article_html_document` → the sweep's
/// find + rewrite — because the bug lived BETWEEN those steps. The builder
/// emitted the doctype (a test asserted so, and passed), the sweep's
/// re-serialization dropped it, and the pair was never exercised together. The
/// then-existing HTML test above fed a bare `<article>` fragment in, so it had
/// no doctype to lose.
///
/// The user-visible failure: `document.compatMode === "BackCompat"`, which
/// changes layout and inline sizing and makes iOS WebKit's automatic text-size
/// adjustment more eager — on the least trusted, most variable content the app
/// renders. Inconsistent by nature: only documents whose images were actually
/// inlined got rewritten, so captures made minutes apart split both ways.
#[test]
fn an_inlined_html_capture_is_still_a_standards_mode_document() {
    let source = format!(
        r#"<html><body><article><h2>Heading</h2>
        <p>{}</p><img src="{IMAGE_URL}"></article></body></html>"#,
        "Enough prose to clear the extractor's minimum length bar. ".repeat(12)
    );
    let article = notesage_capture::extract_article(&source, "https://example.com/post")
        .expect("fixture must extract, or this test proves nothing");
    let document = notesage_capture::build_article_html_document(
        &article,
        Some("A Title"),
        "https://example.com/post",
    );

    let urls = notesage_capture::article_image_urls(&document);
    assert!(
        urls.iter().any(|u| u == IMAGE_URL),
        "the sweep cannot find the image in a built document, so the rewrite below\n\
         would never run and this test would pass vacuously. found: {urls:?}"
    );

    let inlined = notesage_capture::inline_article_images(
        &document,
        &[(IMAGE_URL.to_string(), DATA_URI.to_string())],
    );
    assert!(
        inlined.contains(DATA_URI),
        "precondition: the rewrite did not happen, so nothing here is being tested"
    );

    assert!(
        inlined.trim_start().to_ascii_lowercase().starts_with("<!doctype html>"),
        "the image sweep stripped the doctype — the saved article now renders in\n\
         quirks mode (`document.compatMode === \"BackCompat\"`).\n\n\
         got: {}",
        &inlined[..inlined.len().min(160)]
    );
    for tag in ["<head>", "</head>", "<body>", "</body>"] {
        assert!(
            inlined.to_ascii_lowercase().contains(tag),
            "the image sweep stripped `{tag}` from the saved document.\n\n\
             got: {}",
            &inlined[..inlined.len().min(300)]
        );
    }
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

// ---------------------------------------------------------------------------
// 3. Cancellation (#779)
// ---------------------------------------------------------------------------
//
// The save chain is up to twenty seconds long — X metadata ≤5 s, page fetch
// ≤10–15 s, render ≤5 s, then a coordinated iCloud write — and none of it was
// tied to the extension context's lifecycle. Tap Cancel mid-save and the sheet
// dismissed, the chain kept running, the write landed, and `completeRequest`
// was then called on an already-cancelled context.
//
// So an explicitly cancelled share still appeared in the library. Reachable on
// every capture that takes the fetch path, i.e. most articles, and present
// since the first long network call — six review rounds never traced the
// Cancel terminal.
//
// Source scans for the same reason as everything else here: neither extension
// can be driven from CI, and a contract that cannot run in CI runs never.

/// Slice one Swift method body out of `src`, from `marker` to the next
/// declaration at the same nesting level.
///
/// Bounded by the NEXT declaration rather than a byte count: a fixed window
/// stops covering the function the moment someone adds a comment, and then
/// passes for that reason — the failure mode this file has hit repeatedly.
fn swift_body<'a>(src: &'a str, marker: &str) -> &'a str {
    let start = src
        .find(marker)
        .unwrap_or_else(|| panic!("`{marker}` not found — the guard is anchored to a moved symbol"));
    let after = &src[start + marker.len()..];
    let end = [
        "\n    private func ",
        "\n    @objc private func ",
        "\n    private static func ",
        "\n    static func ",
        "\n    override func ",
        "\n    func ",
        "\n    private struct ",
        "\n    private enum ",
        // NOT `private let` / `private var`: a type's own stored properties are
        // declared at this indent, so treating them as boundaries truncates a
        // CLASS body at its first field — which is how the CancelFlag guard
        // first fired against correct code.
        "\n}",
    ]
    .iter()
    .filter_map(|m| after.find(m))
    .min()
    .map(|i| start + marker.len() + i)
    .unwrap_or(src.len());
    &src[start..end]
}

/// Strip `//` comments so a guard cannot be satisfied by prose describing it.
///
/// "A guard that reads its own documentation is the purest form of passing for
/// the wrong reason" — learned here, twice.
fn swift_code(body: &str) -> String {
    body.lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn both_platforms_hold_cancellation_in_a_locked_flag() {
    // A plain `Bool` will not do. The save chain crosses main, two URLSession
    // delegate queues and a background write queue, while Cancel is tapped on
    // main — an unsynchronised flag is a data race on the single value that
    // decides whether anything reaches disk.
    for (label, src) in [
        ("iOS", ios_src("ShareViewController.swift")),
        ("macOS", macos_src("ShareViewController.swift")),
    ] {
        let flag = swift_code(swift_body(&src, "final class CancelFlag {"));
        assert!(
            flag.contains("NSLock"),
            "{label}'s CancelFlag does not take a lock. Cancel is written on main and\n\
             read from the fetch, render and write queues; an unsynchronised Bool is a\n\
             data race on the one value that decides whether a cancelled share still\n\
             lands in the library.\n\n{flag}"
        );
    }
}

#[test]
fn cancel_raises_the_flag_before_dismissing_the_sheet() {
    // Order is the whole fix. `cancelRequest` tears the sheet down
    // immediately; if the flag goes up afterwards, an in-flight write can pass
    // its check in the window between the two and still land.
    for (label, src, marker) in [
        ("iOS", ios_src("ShareViewController.swift"), "@objc private func cancelTapped("),
        ("macOS", macos_src("ShareViewController.swift"), "@objc private func cancel("),
    ] {
        let body = swift_code(swift_body(&src, marker));
        let raise = body.find("cancelled.cancel()").unwrap_or_else(|| {
            panic!(
                "{label}'s Cancel never raises the cancellation flag, so the save chain\n\
                 keeps running after the sheet is gone and a cancelled share still\n\
                 lands in the library.\n\n{body}"
            )
        });
        let dismiss = body
            .find("cancelRequest")
            .unwrap_or_else(|| panic!("{label}'s Cancel no longer dismisses the sheet\n\n{body}"));
        assert!(
            raise < dismiss,
            "{label} dismisses the sheet BEFORE raising the cancellation flag. A write\n\
             that checks the flag in that window passes and lands anyway.\n\n{body}"
        );
    }
}

#[test]
fn no_platform_completes_an_already_cancelled_context() {
    // `completeRequest` on a context that was cancelled is undefined per
    // `NSExtensionContext` — and observably wrong regardless, since reaching
    // it means the write it reports already happened.
    for (label, src, marker) in [
        ("iOS", ios_src("ShareViewController.swift"), "private func finish("),
        ("macOS", macos_src("ShareViewController.swift"), "@objc private func save("),
    ] {
        let body = swift_code(swift_body(&src, marker));
        let complete = body.find("completeRequest").unwrap_or_else(|| {
            panic!("{label}: `{marker}` no longer completes the request — guard is misanchored\n\n{body}")
        });

        // Scope the search to the block that actually reaches `completeRequest`,
        // not the whole method.
        //
        // A plain "does the body mention isCancelled anywhere before it" check
        // was hollow on macOS: `save()` passes `isCancelled:` as an ARGUMENT to
        // `ShareCapture.save`, several lines above, so deleting the real guard
        // on the completion left the test green. Mutation-proven, in the file
        // whose whole subject is guards that pass for the wrong reason.
        //
        // The anchor is the innermost `async {` before the completion, or the
        // method opening when there is none (iOS's `finish()` is synchronous).
        let head = &body[..complete];
        let anchor = head.rfind(".async {").map(|i| i + ".async {".len()).unwrap_or(0);
        assert!(
            head[anchor..].contains("cancelled.isCancelled"),
            "{label} reaches completeRequest without consulting the cancellation flag in\n\
             the same block. Completing an already-cancelled context is undefined per\n\
             NSExtensionContext — and reaching it at all means the write it reports has\n\
             already happened.\n\n{}",
            &head[anchor..]
        );
    }
}

/// Every iOS path that writes to the library: the function, the writer it
/// calls, and how it gets off the main thread.
///
/// `None` for the hop means the caller is ALREADY off main and why — an empty
/// reason is not accepted, exactly like the `None` rows in
/// BUILDER_REACHABILITY.
type Hop = Result<&'static str, &'static str>;

const IOS_WRITE_PATHS: &[(&str, &str, Hop)] = &[
    ("private func writeOffMain(", "writeArticle(url:", Ok("DispatchQueue.global")),
    ("private func saveLink(", "LibraryAccess.writeCapture(", Ok("DispatchQueue.global")),
    (
        "private func saveArticleFallback(",
        "LibraryAccess.writeXCapture(",
        Ok("DispatchQueue.global"),
    ),
    (
        "@objc private func saveTapped(",
        "LibraryAccess.writeVideoCapture(",
        Ok("DispatchQueue.global"),
    ),
    (
        "private func saveDocuments(",
        "LibraryAccess.writeDocument(",
        Err("loadFileRepresentation calls back on an arbitrary queue, never main"),
    ),
];

#[test]
fn every_ios_capture_write_is_off_main_and_checks_cancellation() {
    // `writeOffMain` covered `writeArticle` only. The link note, the X
    // metadata note and the video note all ran their coordinated iCloud writes
    // on the thread the share sheet draws on — the identical freeze three
    // review rounds fixed for articles, live on the SIMPLEST save paths.
    //
    // And every one of them is a place a cancelled share could still land, so
    // the two invariants are checked together: a write that hops but does not
    // check, or checks but does not hop, is still one of the two bugs.
    let src = ios_src("ShareViewController.swift");
    for (marker, writer, hop) in IOS_WRITE_PATHS {
        let body = swift_code(swift_body(&src, marker));
        let write_at = body.find(writer).unwrap_or_else(|| {
            panic!(
                "iOS `{marker}` no longer calls `{writer}`. Either the capture silently\n\
                 stopped happening or this guard is watching a renamed symbol — both\n\
                 need a human.\n\n{body}"
            )
        });

        match hop {
            Ok(hop_marker) => {
                let hop_at = body.find(hop_marker).unwrap_or_else(|| {
                    panic!(
                        "iOS `{marker}` calls `{writer}` with no `{hop_marker}` hop, so a\n\
                         coordinated write against what is usually an iCloud folder runs on\n\
                         the thread the share sheet draws on. A stalled file coordinator\n\
                         freezes the sheet.\n\n{body}"
                    )
                });
                assert!(
                    hop_at < write_at,
                    "iOS `{marker}` hops off main only AFTER writing.\n\n{body}"
                );
            }
            Err(reason) => assert!(
                !reason.trim().is_empty(),
                "iOS `{marker}` is exempt from the off-main hop with no reason given."
            ),
        }

        let check_at = body.find("cancelled.isCancelled").unwrap_or_else(|| {
            panic!(
                "iOS `{marker}` writes via `{writer}` without checking whether the user\n\
                 cancelled. Cancel dismisses the sheet instantly; this write is up to\n\
                 twenty seconds behind it, and an explicitly cancelled share must not\n\
                 appear in the library.\n\n{body}"
            )
        });
        assert!(
            check_at < write_at,
            "iOS `{marker}` checks cancellation only AFTER `{writer}` has already run —\n\
             the bytes are on disk by then.\n\n{body}"
        );
    }
}

#[test]
fn the_macos_link_note_is_written_off_main_and_checks_cancellation() {
    // The `.link` short-circuit skips the fetch, so it ran straight from the
    // button action: a coordinated write on main, on the one path that never
    // declines and that every other path falls through to.
    let src = macos_src("ShareCapture.swift");
    let body = swift_code(swift_body(&src, "static func save("));

    let branch = body
        .find("if format == .link {")
        .expect("macOS `.link` short-circuit moved — this guard is anchored to it");
    let tail = &body[branch..];
    let hop = tail.find("DispatchQueue.global").unwrap_or_else(|| {
        panic!(
            "macOS writes the link note on the calling thread, which is main — `save()`\n\
             is invoked straight from the button action. Same freeze the article path\n\
             went through three rounds to fix, on the simplest save path.\n\n{tail}"
        )
    });
    let check = tail.find("isCancelled()").unwrap_or_else(|| {
        panic!("macOS's link-note branch never consults the cancellation flag\n\n{tail}")
    });
    let build = tail
        .find("build(")
        .expect("macOS's link-note branch no longer builds a note");
    assert!(
        hop < build && check < build,
        "macOS's link-note branch must hop off main AND check cancellation before it\n\
         writes.\n\n{tail}"
    );

    // The chain's own writes, not just the short-circuit. `save()` takes an
    // `isCancelled` closure precisely so the answer can change under a
    // 15-second fetch and a 5-second render; a signature without it means the
    // chain cannot be stopped at all.
    assert!(
        body.contains("isCancelled: @escaping () -> Bool"),
        "macOS `ShareCapture.save` no longer accepts a cancellation check, so nothing\n\
         between the fetch and the write can be stopped.\n\n{body}"
    );
    assert!(
        !swift_code(&src).contains("completion(build("),
        "macOS reports a build result without routing it through the cancellation\n\
         guard (`complete(...)`). A cancelled share would still be reported — and,\n\
         worse, already written."
    );
}

#[test]
fn the_ios_page_renderer_guards_the_main_thread_like_macos() {
    // WKWebView must be created and driven on main. Dormant today — every iOS
    // call site arrives from a `fetch` completion that already hops — but the
    // macOS port added the guard and iOS did not, and an invariant that holds
    // by accident is one edit away from a hang inside WebKit with the share
    // sheet already gone.
    for (label, src) in [
        ("iOS", ios_src("PageRenderer.swift")),
        ("macOS", macos_src("PageRenderer.swift")),
    ] {
        let body = swift_code(swift_body(&src, "static func renderedHTML("));
        assert!(
            body.contains("Thread.isMainThread"),
            "{label}'s PageRenderer builds a WKWebView without checking it is on the\n\
             main thread. In an app extension that is a hang or a crash, and the sheet\n\
             vanishes having saved nothing.\n\n{body}"
        );
    }
}

#[test]
fn the_macos_deduper_refuses_rather_than_returning_an_occupied_name() {
    // `dedupedURL` returned the ORIGINAL url when it exhausted its 999
    // attempts — a url that by definition exists. `writeCapture` then wrote it
    // with `.forReplacing`, overwriting a note the user may have annotated,
    // from the function whose entire purpose is preventing that.
    //
    // The same defect `claimName` was fixed for, one function over. Practically
    // unreachable, structurally identical.
    let src = macos_src("ShareLibraryAccess.swift");
    let body = swift_code(swift_body(&src, "private static func dedupedURL("));
    assert!(
        body.contains("-> URL?"),
        "macOS `dedupedURL` no longer returns an Optional, so exhausting its 999\n\
         attempts hands the caller an occupied path to overwrite.\n\n{body}"
    );
    assert!(
        body.trim_end().ends_with("return nil\n    }") || body.contains("return nil"),
        "macOS `dedupedURL` does not refuse on exhaustion.\n\n{body}"
    );

    let write = swift_code(swift_body(&src, "static func writeCapture("));
    assert!(
        write.contains("guard let unique = dedupedURL("),
        "macOS `writeCapture` does not handle a refused dedupe, so an exhausted\n\
         deduper falls back to overwriting.\n\n{write}"
    );
}

#[test]
fn both_share_extension_localizations_carry_the_same_keys() {
    // The two extensions share ONE set of `.strings` files
    // (`src-tauri/ios/ShareResources/*.lproj`, copied into the macOS bundle by
    // `scripts/build-macos-share-extension.sh`). A key added to `en` and
    // forgotten in `sv` does not fail anything: `NSLocalizedString` falls back
    // to the key's own default, so a Swedish share sheet shows one English
    // line. That is worse than either language on its own — the exact defect
    // #653 fixed, and nothing stopped it recurring.
    let keys = |lang: &str| -> Vec<String> {
        let src = ext_src("ios/ShareResources", &format!("{lang}.lproj/Localizable.strings"));
        let mut found: Vec<String> = src
            .lines()
            .filter_map(|l| l.trim().strip_prefix('"'))
            .filter_map(|rest| rest.split('"').next())
            .map(str::to_string)
            .collect();
        found.sort();
        found.dedup();
        found
    };
    let (en, sv) = (keys("en"), keys("sv"));
    assert!(!en.is_empty(), "no keys parsed from en.lproj — did the file format change?");

    let missing_sv: Vec<_> = en.iter().filter(|k| !sv.contains(k)).collect();
    let missing_en: Vec<_> = sv.iter().filter(|k| !en.contains(k)).collect();
    assert!(
        missing_sv.is_empty() && missing_en.is_empty(),
        "Share Extension localizations have drifted.\n\
         Missing from sv.lproj: {missing_sv:?}\n\
         Missing from en.lproj: {missing_en:?}\n\
         An untranslated key renders as the key's English default inside an\n\
         otherwise-Swedish sheet."
    );
}

#[test]
fn the_settle_script_is_returned_so_the_heuristic_actually_runs() {
    // `callAsyncJavaScript` treats its script as a FUNCTION BODY. Without a
    // `return`, the promise is evaluated and discarded, the call resolves
    // `.success(nil)`, the `as? String` cast fails, and the completion takes
    // its "script failed (CSP, a hostile page)" branch — which captures the
    // DOM immediately at `didFinish`.
    //
    // So the mutation-quiescence settle both PageRenderers are largely ABOUT
    // had never run once, on either platform. Nothing errored. Captures simply
    // contained whatever had loaded at an arbitrary early moment, which is why
    // the same article yielded a different image count on each attempt — a
    // shipped bug that reads, in the source, as a fully implemented feature.
    //
    // Verified directly against the API: without `return` → `success(nil)`,
    // with it → the value.
    for (label, src) in [
        ("iOS", ios_src("PageRenderer.swift")),
        ("macOS", macos_src("PageRenderer.swift")),
    ] {
        let code = swift_code(&src);
        let at = code.find("new Promise").unwrap_or_else(|| {
            panic!("{label}: no settle promise found — this guard is anchored to it")
        });
        // The 7 chars before it, so `return new Promise` passes and a bare
        // `new Promise` at the head of a line does not.
        let before = &code[at.saturating_sub(8)..at];
        assert!(
            before.contains("return"),
            "{label}'s settle script is not returned, so callAsyncJavaScript resolves\n\
             nil and the renderer silently falls back to capturing the DOM at\n\
             didFinish — before the page has assembled itself. The quiescence\n\
             heuristic becomes dead code that still reads as implemented.\n\n\
             found before `new Promise`: {before:?}"
        );

        // The other half: lazy images only load when scrolled into view, and
        // this webview never scrolls on its own. Without the walk, everything
        // below the fold stays a placeholder and the capture keeps whichever
        // images happened to be above it — on a Medium article, 9 of 31.
        // The WALK, not merely the word. A bare `window.scrollTo` also matches
        // the scroll-BACK-to-top at the end of the walk, so deleting the loop
        // body left this green — mutation-proven hollow on the first attempt,
        // in the file whose whole subject is guards that pass for the wrong
        // reason. The moving target is what loads lazy images.
        assert!(
            code.contains("window.scrollTo(0, y)"),
            "{label}'s renderer never scrolls THROUGH the document (only, at most, back\n\
             to the top), so lazy-loaded images below the fold are never fetched and the\n\
             capture silently loses most of the article's pictures."
        );
        assert!(
            code.contains("img.loading = 'eager'"),
            "{label}'s renderer does not force images eager before walking the page."
        );
    }
}

#[test]
fn the_document_write_is_not_gated_on_the_view_controller_being_alive() {
    // #794: a shared PDF stopped reaching `Inbox/` while the sheet closed as
    // though it had worked.
    //
    // The cause was a `[weak self]` capture added to `saveDocuments`'s
    // `loadFileRepresentation` callback in #779, purely to reach the
    // cancellation flag. Until then the write was unconditional; afterwards it
    // depended on the view controller still being alive, and failed SILENTLY
    // when it was not.
    //
    // `CancelFlag` is a lock-guarded class, so the flag can be captured
    // directly from any queue with no reference to `self` at all. Nothing
    // about cancellation ever needed the controller.
    //
    // `both_platforms_accept_shared_files_not_just_links` already asserts the
    // activation rule and that `writeDocument` EXISTS — this asserts the call
    // can actually be reached, which is the same "present but unreachable"
    // shape one layer down.
    let src = ios_src("ShareViewController.swift");
    let body = swift_code(swift_body(&src, "private func saveDocuments("));

    let load = body
        .find("loadFileRepresentation")
        .expect("iOS saveDocuments no longer loads a file representation");
    let write = body
        .find("LibraryAccess.writeDocument")
        .expect("iOS saveDocuments no longer writes the document at all");
    let callback = &body[load..write];
    assert!(
        !callback.contains("[weak self]"),
        "iOS's document write is inside a `[weak self]` closure again, so it is\n\
         skipped whenever the share controller has been released — silently, on\n\
         the path that stores the user's file.\n\n{callback}"
    );

    // And the failure must be visible. `try?` here is what made a failed share
    // indistinguishable from a successful one, with nothing in the log.
    assert!(
        !body.contains("try? LibraryAccess.writeDocument"),
        "iOS swallows the document-write error again. A share that saved nothing\n\
         then closes reporting success, and leaves nothing to diagnose from."
    );
    assert!(
        body.contains("failures"),
        "iOS does not count document-write failures, so it cannot keep the sheet\n\
         open when one happens — macOS has done this since the parity pass."
    );
}

/// The iframe path applied three things to every report via `withReaderInsets`
/// in `Reader.tsx`: body padding, box-sizing, and `-webkit-text-size-adjust`.
/// The native `ReportWebView` translated the padding into a scroll content
/// inset — a better mechanism — and dropped the text-size-adjust, because
/// there is no `WKWebViewConfiguration` setting for it and nothing failed
/// loudly when it went missing. Reports then rendered with WebKit free to
/// inflate their text.
///
/// The two are separate code in separate languages with no shared type, so
/// nothing but a test ties them together. This asserts the native path still
/// carries the property the web path documents as necessary — whichever
/// mechanism it uses to get there.
#[test]
fn native_report_view_keeps_text_size_adjust_parity_with_the_iframe_path() {
    let web = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../src/components/mobile/html-insets.ts"),
    )
    .expect("html-insets.ts");
    assert!(
        web.contains("-webkit-text-size-adjust"),
        "the web fallback dropped text-size-adjust — if that was deliberate, \
         this guard and its native counterpart should go together"
    );

    let native = ext_src(
        "crates/tauri-plugin-notesage-ios/ios/Sources",
        "ReportWebView.swift",
    );
    assert!(
        native.contains("-webkit-text-size-adjust"),
        "ReportWebView does not pin -webkit-text-size-adjust, so WebKit may \
         inflate a report's text. The iframe path it replaced set it via \
         withReaderInsets; the native path has no WKWebViewConfiguration \
         equivalent, so it must inject the CSS itself."
    );
}

/// A report's in-document anchors must be detected against the DOCUMENT's url,
/// not against the shape of the href in the markup.
///
/// `WKNavigationAction.request.url` is always the RESOLVED absolute url. The
/// first version of this handler tested `url.scheme == nil ||
/// absoluteString.hasPrefix("#")` — a description of the markup, not of
/// anything that ever arrives at the delegate. Because the report is loaded
/// with `loadHTMLString(baseURL: nil)`, its base is `about:blank`, so
/// `href="#top"` reaches the handler as `about:blank#top`: scheme "about", no
/// leading "#". Every anchor missed the branch and was emitted as an outbound
/// link, which the app could resolve as neither a remote url nor a library
/// path — so tapping a table-of-contents entry did nothing whatsoever.
///
/// The bug is invisible in review (the condition reads plausibly) and needs a
/// device plus a report containing anchors to see, which is why it survived to
/// a release. Pinning the mechanism is cheaper than rediscovering it.
#[test]
fn report_anchor_taps_are_matched_against_the_document_url() {
    let src = ext_src(
        "crates/tauri-plugin-notesage-ios/ios/Sources",
        "ReportWebView.swift",
    );
    let start = src
        .find("decidePolicyFor navigationAction")
        .expect("navigation policy handler not found");
    let end = src[start..]
        .find("\n  /// Same document")
        .map(|i| start + i)
        .unwrap_or(src.len());
    // Strip comments before asserting. The code below documents the old
    // broken condition by quoting it, and a guard that matched its own
    // explanation would fail for the wrong reason — as this one did, first
    // run, which is the cheapest possible demonstration of why it matters.
    let handler: String = src[start..end]
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    assert!(
        handler.contains("isSameDocument("),
        "the anchor branch must compare the resolved url against the document's \
         own url; matching on scheme or a \"#\" prefix describes the href in the \
         markup and never matches a real navigation"
    );
    assert!(
        !handler.contains("hasPrefix(\"#\")"),
        "`hasPrefix(\"#\")` cannot match: request.url is resolved, so an anchor \
         arrives as `about:blank#...`, never as `#...`"
    );
}
